/**
 * Supported desktop preflight adapters and the authoritative Git adapter.
 *
 * An adapter is thin on purpose. It normalizes a native client event and
 * identity into the client-independent evaluation request, invokes the shared
 * `evaluate` seam, and presents the returned decision. It never reimplements
 * policy, never authorizes anything, and never hands a native payload to gate
 * core (FR-ADAPT-001, FR-ADAPT-003).
 *
 * Authorization is re-derived here from the adapter's Enforcement role through
 * the one policy seam that owns it. A preflight surface therefore cannot
 * present `allow` or `deny` however the decision it was handed was authorized:
 * only authoritative Git authorizes a change (FR-ADAPT-007, SG-SUPPORT-001).
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';

import {
  OPERATION,
  PROTOCOL_VERSION,
  validateDecision,
} from './evaluation-contract.mjs';
import { authorizationFor } from './policy.mjs';

/**
 * The capability categories every adapter declares for itself.
 *
 * These are the axes of the shared client compatibility baseline: deterministic
 * event delivery, non-interactive invocation with a visible structured result,
 * repository and session identity, filesystem and Git access, trust failure
 * handling, parallel isolation, and declared native blocking. An adapter states
 * all eight; nothing is inherited from another client (FR-ADAPT-004,
 * NFR-COMP-001).
 */
export const ADAPTER_CAPABILITY_CATEGORIES = Object.freeze([
  'event',
  'blocking',
  'trust',
  'repository',
  'session',
  'filesystem',
  'git',
  'invocation',
]);

/** The fields each category must state. An empty category declares nothing. */
const CAPABILITY_FIELDS = Object.freeze({
  event: Object.freeze(['deterministic', 'normalizedTriggers']),
  blocking: Object.freeze(['native']),
  trust: Object.freeze(['model', 'failureIsUnverified']),
  repository: Object.freeze(['localFilesystemRoot', 'worktreeAware']),
  session: Object.freeze(['identity', 'parallelIsolation']),
  filesystem: Object.freeze(['sameFilesAsClient']),
  git: Object.freeze(['metadata', 'index']),
  invocation: Object.freeze(['nonInteractive', 'mechanism', 'structuredResult', 'timeoutMs']),
});

/** The sentinel a raced invocation resolves with when its timeout wins. */
const TIMED_OUT = Symbol('adapter-invocation-timed-out');

const isPlainObject = (value) => typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

/**
 * Validate one adapter capability declaration.
 *
 * A missing category is an error rather than a default, and an unknown one is
 * an error rather than an ignored extra: an adapter that does not state a
 * capability has not declared it, and a gate that defaults it would be
 * assuming another client's contract (FR-ADAPT-004).
 */
export const validateAdapterDeclaration = (capabilities) => {
  if (!isPlainObject(capabilities)) {
    return [{
      code: 'adapter-capability-invalid',
      path: 'capabilities',
      message: 'An adapter capability declaration must be an object.',
    }];
  }

  const errors = [];

  for (const category of ADAPTER_CAPABILITY_CATEGORIES) {
    if (!isPlainObject(capabilities[category])) {
      errors.push({
        code: 'adapter-capability-missing',
        path: `capabilities.${category}`,
        message: `An adapter must declare its ${category} capability explicitly.`,
      });

      continue;
    }

    for (const field of CAPABILITY_FIELDS[category]) {
      if (!(field in capabilities[category])) {
        errors.push({
          code: 'adapter-capability-incomplete',
          path: `capabilities.${category}.${field}`,
          message: `The ${category} capability must state ${field}.`,
        });
      }
    }
  }

  for (const category of Object.keys(capabilities)) {
    if (!ADAPTER_CAPABILITY_CATEGORIES.includes(category)) {
      errors.push({
        code: 'adapter-capability-unknown',
        path: `capabilities.${category}`,
        message: `${category} is not a declared adapter capability category.`,
      });
    }
  }

  return errors;
};

/**
 * The v1 adapter set. Q-003 closed the question of additional clients: no
 * client beyond authoritative Git and these three local desktop surfaces
 * enters v1, and a later one needs its own compatibility evidence.
 */
const ADAPTER_REGISTRY = Object.freeze({
  git: Object.freeze({
    id: 'git',
    version: '1.0.0',
    surface: 'git-pre-commit',
    role: 'authoritative',
    nativeEvents: Object.freeze({ 'commit-attempt': 'pre-commit' }),
    nativeIdentity: Object.freeze({
      event: 'hook',
      repositoryRoot: 'repositoryRoot',
      sessionId: 'commitProcessId',
    }),
    capabilities: Object.freeze({
      event: Object.freeze({ deterministic: true, normalizedTriggers: Object.freeze(['commit-attempt']) }),
      blocking: Object.freeze({ native: true }),
      trust: Object.freeze({ model: 'repository-hook-registration', failureIsUnverified: true }),
      repository: Object.freeze({ localFilesystemRoot: true, worktreeAware: true }),
      session: Object.freeze({ identity: 'commit-process', parallelIsolation: true }),
      filesystem: Object.freeze({ sameFilesAsClient: true }),
      git: Object.freeze({ metadata: true, index: true }),
      invocation: Object.freeze({
        nonInteractive: true,
        mechanism: 'git-hook',
        structuredResult: true,
        timeoutMs: 600_000,
      }),
    }),
  }),
  'claude-code-desktop': Object.freeze({
    id: 'claude-code-desktop',
    version: '1.0.0',
    surface: 'claude-code-desktop-local-code-tab',
    role: 'preflight',
    nativeEvents: Object.freeze({
      'work-complete': 'code-tab.turn-completed',
      'commit-attempt': 'code-tab.before-commit',
    }),
    nativeIdentity: Object.freeze({
      event: 'event',
      repositoryRoot: 'workspace.path',
      sessionId: 'session.id',
    }),
    capabilities: Object.freeze({
      event: Object.freeze({
        deterministic: true,
        normalizedTriggers: Object.freeze(['work-complete', 'commit-attempt']),
      }),
      blocking: Object.freeze({ native: false }),
      trust: Object.freeze({ model: 'explicit-workspace-grant', failureIsUnverified: true }),
      repository: Object.freeze({ localFilesystemRoot: true, worktreeAware: true }),
      session: Object.freeze({ identity: 'client-session', parallelIsolation: true }),
      filesystem: Object.freeze({ sameFilesAsClient: true }),
      git: Object.freeze({ metadata: true, index: true }),
      invocation: Object.freeze({
        nonInteractive: true,
        mechanism: 'child-process',
        structuredResult: true,
        timeoutMs: 300_000,
      }),
    }),
  }),
  'codex-desktop': Object.freeze({
    id: 'codex-desktop',
    version: '1.0.0',
    surface: 'codex-desktop-local-project',
    role: 'preflight',
    // This surface exposes no deterministic pre-commit event. The optional
    // `before-commit-attempt` mapping is therefore simply absent; the adapter
    // does not invent one (FR-ADAPT-003).
    nativeEvents: Object.freeze({ 'work-complete': 'project.task-finished' }),
    nativeIdentity: Object.freeze({
      event: 'type',
      repositoryRoot: 'project.root',
      sessionId: 'conversationId',
    }),
    capabilities: Object.freeze({
      event: Object.freeze({
        deterministic: true,
        normalizedTriggers: Object.freeze(['work-complete']),
      }),
      blocking: Object.freeze({ native: false }),
      trust: Object.freeze({ model: 'explicit-project-grant', failureIsUnverified: true }),
      repository: Object.freeze({ localFilesystemRoot: true, worktreeAware: true }),
      session: Object.freeze({ identity: 'client-session', parallelIsolation: true }),
      filesystem: Object.freeze({ sameFilesAsClient: true }),
      git: Object.freeze({ metadata: true, index: true }),
      invocation: Object.freeze({
        nonInteractive: true,
        mechanism: 'child-process',
        structuredResult: true,
        timeoutMs: 300_000,
      }),
    }),
  }),
  cursor: Object.freeze({
    id: 'cursor',
    version: '1.0.0',
    surface: 'cursor-ide-local-agent',
    role: 'preflight',
    nativeEvents: Object.freeze({
      'work-complete': 'agent.run-finished',
      'commit-attempt': 'agent.before-commit',
    }),
    nativeIdentity: Object.freeze({
      event: 'name',
      repositoryRoot: 'folder.path',
      sessionId: 'agentRunId',
    }),
    capabilities: Object.freeze({
      event: Object.freeze({
        deterministic: true,
        normalizedTriggers: Object.freeze(['work-complete', 'commit-attempt']),
      }),
      blocking: Object.freeze({ native: false }),
      trust: Object.freeze({ model: 'explicit-workspace-grant', failureIsUnverified: true }),
      repository: Object.freeze({ localFilesystemRoot: true, worktreeAware: true }),
      session: Object.freeze({ identity: 'client-session', parallelIsolation: true }),
      filesystem: Object.freeze({ sameFilesAsClient: true }),
      git: Object.freeze({ metadata: true, index: true }),
      invocation: Object.freeze({
        nonInteractive: true,
        mechanism: 'child-process',
        structuredResult: true,
        timeoutMs: 300_000,
      }),
    }),
  }),
});

export const ADAPTER_IDS = Object.freeze(Object.keys(ADAPTER_REGISTRY));

export const DESKTOP_ADAPTER_IDS = Object.freeze(
  ADAPTER_IDS.filter((id) => ADAPTER_REGISTRY[id].role === 'preflight'),
);

/** Resolve one adapter's static identity, or `null` when it is not a v1 adapter. */
export const describeAdapter = (adapterId) => ADAPTER_REGISTRY[adapterId] ?? null;

/**
 * Normalize one native client event to a contract trigger, or `null`.
 *
 * Normalization is looked up in the adapter's *own* declared event table. An
 * event this surface does not declare — including another client's native
 * event name — is never guessed into a trigger, because a guessed trigger is
 * an assumed contract (FR-ADAPT-003, FR-ADAPT-004).
 */
/** Read one declared dotted path out of a native payload, or `null`. */
const readNativePath = (payload, dottedPath) => dottedPath
  .split('.')
  .reduce(
    (value, segment) => (isPlainObject(value) ? value[segment] ?? null : null),
    payload,
  );

/**
 * Normalize one native client payload into the identity the gate contract
 * names, using the adapter's *own* declared field paths.
 *
 * This is the entire native boundary. Three values are read out — the native
 * event, the repository root, and the client's session identity — and the rest
 * of the payload is left where it was. Nothing client-native has a way past
 * this function, because nothing else is ever copied (FR-ADAPT-003).
 *
 * A payload whose declared paths do not resolve belongs to some other client.
 * The adapter reports that it cannot read it rather than guessing.
 */
export const normalizeNativeInvocation = ({ adapterId, native } = {}) => {
  const adapter = describeAdapter(adapterId);

  if (adapter === null || !isPlainObject(native)) {
    return null;
  }

  const read = (field) => {
    const value = readNativePath(native, adapter.nativeIdentity[field]);

    return typeof value === 'string' && value.length > 0 ? value : null;
  };

  return {
    adapterId: adapter.id,
    nativeEvent: read('event'),
    repositoryRoot: read('repositoryRoot'),
    sessionId: read('sessionId'),
  };
};

export const normalizeTrigger = ({ adapterId, nativeEvent } = {}) => {
  const adapter = describeAdapter(adapterId);

  if (adapter === null || typeof nativeEvent !== 'string' || nativeEvent.length === 0) {
    return null;
  }

  const match = Object.entries(adapter.nativeEvents)
    .find(([, declared]) => declared === nativeEvent);

  return match === undefined ? null : match[0];
};

/** The structured, client-independent view of one check on any surface. */
const presentCheck = (check) => ({
  id: check.id,
  stage: check.stage,
  policy: check.policy,
  outcome: check.outcome,
  reasonCode: check.reasonCode,
  summary: check.summary,
});

/**
 * Present one returned decision on one adapter's surface.
 *
 * The same decision reaches every surface unchanged. What differs is only the
 * role-derived authorization and whether the surface blocks: a deny blocks the
 * authoritative Git surface, while a preflight surface shows the identical
 * structured result and lets the host process continue (AC-ADAPT-001).
 */
export const presentDecision = ({ adapterId, decision }) => {
  const adapter = describeAdapter(adapterId);

  if (adapter === null || decision === null || typeof decision !== 'object') {
    return null;
  }

  const authorization = authorizationFor(adapter.role, decision.outcome);
  const blocking = authorization === 'deny';

  return {
    adapterId: adapter.id,
    surface: adapter.surface,
    role: adapter.role,
    outcome: decision.outcome,
    authorization,
    blocking,
    exitCode: blocking ? 1 : 0,
    presentation: {
      kind: blocking ? 'blocked' : 'preflight',
      evaluationId: decision.evaluationId,
      outcome: decision.outcome,
      authorization,
      checks: (decision.checks ?? []).map(presentCheck),
    },
  };
};

/**
 * Every way an adapter can fail to obtain a decision, and the contract reason
 * each one carries.
 *
 * All five reasons normalize to `unverified` through the evaluation contract's
 * own table. That is the point of FR-ADAPT-005: a trust failure, a failed
 * invocation, a timeout, a capability the surface does not have, and output the
 * gate cannot parse are five different faults with one honest answer — the
 * change was not verified. None of them may look like a clean preflight.
 */
export const ADAPTER_FAILURE_REASONS = Object.freeze({
  trust: 'prerequisite-missing',
  invocation: 'crash',
  timeout: 'timeout',
  capability: 'configuration-invalid',
  output: 'malformed-output',
});

const failedPresentation = ({ adapter, family, detail }) => {
  const authorization = authorizationFor(adapter.role, 'unverified');
  const blocking = authorization === 'deny';

  return {
    adapterId: adapter.id,
    surface: adapter.surface,
    role: adapter.role,
    outcome: 'unverified',
    authorization,
    blocking,
    exitCode: blocking ? 1 : 0,
    failure: { family, reasonCode: ADAPTER_FAILURE_REASONS[family], detail },
    presentation: {
      kind: 'unverified',
      evaluationId: null,
      outcome: 'unverified',
      authorization,
      reasonCode: ADAPTER_FAILURE_REASONS[family],
      detail,
      checks: [],
    },
  };
};

/**
 * Build the client-independent evaluation request for one adapter invocation.
 *
 * This is the whole normalization boundary. What crosses it is what the process
 * contract names: repository root, change target, evaluation purpose, and the
 * invocation's role, normalized trigger, adapter identity, and session identity.
 * Nothing client-native crosses (FR-ADAPT-003, NFR-COMP-001).
 */
const requestFor = ({ adapter, trigger, context }) => ({
  protocolVersion: PROTOCOL_VERSION,
  operation: OPERATION,
  repository: { root: context.repository.root },
  change: { kind: context.change.kind, baseRevision: context.change.baseRevision },
  evaluation: {
    purpose: context.evaluation.purpose,
    contractRef: context.evaluation.contractRef ?? null,
  },
  invocation: {
    role: adapter.role,
    trigger,
    adapter: {
      id: adapter.id,
      surface: adapter.surface,
      version: adapter.version,
      capabilities: { nativeBlocking: adapter.capabilities.blocking.native },
    },
    sessionId: context.session.id,
  },
});

/**
 * Invoke the shared evaluation process for one adapter and present the result.
 *
 * The adapter does exactly four things: normalize, confirm trust, invoke
 * non-interactively under its declared timeout, and present. Everything it
 * cannot do honestly ends as `unverified` (FR-ADAPT-003, FR-ADAPT-005).
 */
export const runAdapterEvaluation = async (
  { adapterId, nativeEvent = null, native = null, context = {} } = {},
  dependencies = {},
) => {
  const adapter = describeAdapter(adapterId);

  if (adapter === null) {
    return null;
  }

  // A native payload is read through the adapter's own declared paths and then
  // dropped; only the three normalized values continue.
  const identity = native === null ? null : normalizeNativeInvocation({ adapterId, native });
  const event = identity === null ? nativeEvent : identity.nativeEvent;
  const invocationContext = identity === null ? context : {
    ...context,
    repository: { root: identity.repositoryRoot },
    session: { id: identity.sessionId },
  };
  const trigger = normalizeTrigger({ adapterId, nativeEvent: event });

  if (trigger === null) {
    return failedPresentation({
      adapter,
      family: 'capability',
      detail: `${adapter.id} declares no normalized trigger for the native event ${JSON.stringify(event)}.`,
    });
  }

  if (identity !== null && (identity.repositoryRoot === null || identity.sessionId === null)) {
    return failedPresentation({
      adapter,
      family: 'capability',
      detail: `${adapter.id} could not read a repository root and a session identity from this native payload.`,
    });
  }

  const trust = typeof dependencies.establishTrust === 'function'
    ? await dependencies.establishTrust({ adapterId: adapter.id, repository: invocationContext.repository })
      .catch((error) => ({ established: false, detail: error.message }))
    : { established: true, detail: 'no trust seam is bound' };

  if (trust?.established !== true) {
    return failedPresentation({
      adapter,
      family: 'trust',
      detail: trust?.detail ?? `${adapter.id} could not establish trust for this repository.`,
    });
  }

  const timeoutMs = Number.isInteger(dependencies.timeoutMs)
    ? dependencies.timeoutMs
    : adapter.capabilities.invocation.timeoutMs;

  let timer = null;
  let decision;

  try {
    decision = await Promise.race([
      dependencies.evaluate(requestFor({ adapter, trigger, context: invocationContext })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      }),
    ]);
  } catch (error) {
    return failedPresentation({ adapter, family: 'invocation', detail: error.message });
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }

  if (decision === TIMED_OUT) {
    return failedPresentation({
      adapter,
      family: 'timeout',
      detail: `The evaluation did not return within the declared ${timeoutMs}ms invocation timeout.`,
    });
  }

  const errors = validateDecision(decision);

  if (errors.length > 0) {
    return failedPresentation({
      adapter,
      family: 'output',
      detail: `The evaluation returned output the process contract rejects: ${errors[0].code} at ${errors[0].path}.`,
    });
  }

  return { ...presentDecision({ adapterId: adapter.id, decision }), failure: null };
};

/**
 * The shared client compatibility baseline.
 *
 * These are the exact dimensions NFR-COMP-001 names. A surface is not
 * supported because it declares a capability; it is supported because these
 * checks were *run against it* and held. That is SG-SUPPORT-001 in one list.
 */
export const BASELINE_CHECKS = Object.freeze([
  'deterministic-event',
  'non-interactive-invocation',
  'repository-identity',
  'session-identity',
  'filesystem-access',
  'git-access',
  'structured-result-visible',
  'trust-failure-unverified',
  'parallel-session-isolation',
  'declared-native-blocking',
]);

/** Write one value at a declared dotted path, building intermediate objects. */
const writeNativePath = (payload, dottedPath, value) => {
  const segments = dottedPath.split('.');
  const leaf = segments.pop();
  const container = segments.reduce((node, segment) => {
    node[segment] = node[segment] ?? {};

    return node[segment];
  }, payload);

  container[leaf] = value;

  return payload;
};

/**
 * Build a native payload in *this* adapter's declared shape.
 *
 * The baseline drives each surface through the same field paths the adapter
 * says its client uses, so a fixture cannot pass by being written in the
 * gate's preferred shape rather than the client's.
 */
const baselineNativePayload = (adapter, { nativeEvent, repositoryRoot, sessionId }) => {
  const payload = {};

  writeNativePath(payload, adapter.nativeIdentity.event, nativeEvent);
  writeNativePath(payload, adapter.nativeIdentity.repositoryRoot, repositoryRoot);
  writeNativePath(payload, adapter.nativeIdentity.sessionId, sessionId);

  return payload;
};

/**
 * Run the shared compatibility baseline against one declared surface.
 *
 * Every check is *executed*, never inferred from the declaration, and every
 * outcome is recorded with the exact Gate, Git, Node.js, client, and operating
 * system versions it was observed under. Those exact versions are the evidence
 * Q-004 requires: they are a snapshot of what was tested, not a permanent
 * allowlist, and an untested version simply has no verified claim yet
 * (AC-ADAPT-002, NFR-COMP-001).
 */
export const runCompatibilityBaseline = async (
  { adapterId, repositoryRoot, contextOverrides = {} } = {},
  dependencies = {},
) => {
  const adapter = describeAdapter(adapterId);

  if (adapter === null) {
    return null;
  }

  const clock = dependencies.clock ?? (() => new Date());
  const checks = [];
  const record = (id, ok, detail) => {
    checks.push({ id, ok, detail });

    return ok;
  };

  const context = {
    change: { kind: 'worktree', baseRevision: 'HEAD' },
    evaluation: { purpose: 'regression-only', contractRef: null },
    ...contextOverrides,
  };

  /** One baseline invocation, capturing exactly what gate core was handed. */
  const invoke = async ({ sessionId, overrides = {}, nativeEvent = null }) => {
    const seen = [];
    const native = baselineNativePayload(adapter, {
      nativeEvent: nativeEvent ?? adapter.nativeEvents['work-complete'] ?? adapter.nativeEvents['commit-attempt'],
      repositoryRoot,
      sessionId,
    });
    const result = await runAdapterEvaluation({ adapterId, native, context }, {
      establishTrust: dependencies.establishTrust ?? (async () => ({ established: true, detail: 'baseline grant' })),
      ...overrides,
      evaluate: async (request) => {
        seen.push(request);

        return (overrides.evaluate ?? dependencies.evaluate)(request);
      },
    });

    return { result, request: seen[0] ?? null };
  };

  // 1. A deterministic native event maps to the same normalized trigger every
  //    time, and an event the surface does not declare maps to nothing.
  const declaredEvent = adapter.nativeEvents['work-complete'] ?? adapter.nativeEvents['commit-attempt'];
  const repeated = [0, 1, 2].map(() => normalizeTrigger({ adapterId, nativeEvent: declaredEvent }));

  record(
    'deterministic-event',
    adapter.capabilities.event.deterministic === true
      && repeated.every((trigger) => trigger !== null && trigger === repeated[0])
      && normalizeTrigger({ adapterId, nativeEvent: `${declaredEvent}.undeclared` }) === null,
    `${declaredEvent} normalized to ${repeated[0]} on every attempt.`,
  );

  const primary = await invoke({ sessionId: 'baseline-session-1' });

  // 2. The gate was invoked non-interactively and returned a decision.
  record(
    'non-interactive-invocation',
    adapter.capabilities.invocation.nonInteractive === true
      && primary.result.failure === null
      && primary.request !== null,
    primary.result.failure === null
      ? 'The surface invoked the gate non-interactively and received a decision.'
      : `The invocation failed: ${primary.result.failure.family}.`,
  );

  // 3 and 4. Repository and session identity crossed the boundary intact.
  record(
    'repository-identity',
    primary.request?.repository.root === repositoryRoot,
    `The request named ${primary.request?.repository.root ?? 'no repository root'}.`,
  );
  record(
    'session-identity',
    primary.request?.invocation.sessionId === 'baseline-session-1',
    `The request named session ${primary.request?.invocation.sessionId ?? 'none'}.`,
  );

  // 5. The surface reaches the same files the client edits.
  let filesystemDetail;

  try {
    await stat(path.join(repositoryRoot, '.git'));
    filesystemDetail = 'The declared repository root is readable from this surface.';
  } catch (error) {
    filesystemDetail = error.message;
  }

  record(
    'filesystem-access',
    adapter.capabilities.filesystem.sameFilesAsClient === true
      && filesystemDetail.startsWith('The declared'),
    filesystemDetail,
  );

  // 6. The surface reaches the matching Git metadata.
  let gitDetail;
  let gitVersion = null;

  try {
    const commonDirectory = await dependencies.runGit(['rev-parse', '--git-dir']);

    gitVersion = await dependencies.runGit(['--version']);
    gitDetail = `Git metadata resolved to ${commonDirectory}.`;
  } catch (error) {
    gitDetail = error.message;
  }

  record(
    'git-access',
    adapter.capabilities.git.metadata === true && gitVersion !== null,
    gitDetail,
  );

  // 7. The user can actually see a structured result.
  record(
    'structured-result-visible',
    adapter.capabilities.invocation.structuredResult === true
      && Array.isArray(primary.result.presentation?.checks)
      && typeof primary.result.presentation?.outcome === 'string'
      && primary.result.presentation?.evaluationId !== undefined,
    `The surface presented a ${primary.result.presentation?.kind ?? 'missing'} result.`,
  );

  // 8. A trust failure is unverified, not a silent pass.
  const untrusted = await invoke({
    sessionId: 'baseline-session-trust',
    overrides: {
      establishTrust: async () => ({ established: false, detail: 'the baseline revoked the grant' }),
    },
  });

  record(
    'trust-failure-unverified',
    adapter.capabilities.trust.failureIsUnverified === true
      && untrusted.result.outcome === 'unverified'
      && untrusted.result.failure?.family === 'trust',
    `A revoked grant produced ${untrusted.result.outcome}.`,
  );

  // 9. Parallel sessions do not borrow each other's identity.
  const [left, right] = await Promise.all([
    invoke({ sessionId: 'baseline-session-a' }),
    invoke({ sessionId: 'baseline-session-b' }),
  ]);

  record(
    'parallel-session-isolation',
    adapter.capabilities.session.parallelIsolation === true
      && left.request?.invocation.sessionId === 'baseline-session-a'
      && right.request?.invocation.sessionId === 'baseline-session-b',
    'Two concurrent sessions each carried their own identity.',
  );

  // 10. The declared blocking capability is what the surface actually does. A
  //     surface that declares none must not block, and that is not a failure:
  //     Git remains the authoritative seam (FR-ADAPT-007, SG-SUPPORT-001).
  const denied = presentDecision({
    adapterId,
    decision: { outcome: 'failed', evaluationId: null, checks: [] },
  });

  record(
    'declared-native-blocking',
    denied.blocking === (adapter.capabilities.blocking.native === true && adapter.role === 'authoritative'),
    `Declared native blocking ${adapter.capabilities.blocking.native}; a deny decision ${denied.blocking ? 'blocked' : 'did not block'} this surface.`,
  );

  return {
    adapterId: adapter.id,
    surface: adapter.surface,
    role: adapter.role,
    passed: checks.every((check) => check.ok),
    checks,
    versions: {
      gate: dependencies.versions?.gate ?? null,
      git: gitVersion,
      node: dependencies.versions?.node ?? null,
      os: dependencies.versions?.os ?? null,
      client: dependencies.versions?.client ?? null,
    },
    recordedAt: clock().toISOString(),
    failedChecks: checks.filter((check) => !check.ok).map((check) => check.id),
  };
};

/** The Support tiers a context may hold. */
export const SUPPORT_TIERS = Object.freeze(['supported', 'experimental', 'unsupported']);

/**
 * The one v1 variant that can be supported. Everything else about a client —
 * its CLI, an SSH session, a remote or cloud runner, a background agent — is
 * unproved until it passes this baseline on its own (FR-ADAPT-006).
 */
const SUPPORTED_VARIANT = 'desktop';

/**
 * Classify one integration context into its Support tier.
 *
 * Support is capability-based and evidence-based, never a name on a list
 * (Q-004). Three things must all hold before a context is `supported`: it is
 * one of the v1 clients, on its declared local desktop variant, and its shared
 * baseline was actually run and passed. Drop the evidence and the tier drops to
 * `experimental`; drop the repository, process, or Git capability and the
 * context is `unsupported`, because a surface that cannot reach the repository
 * cannot preflight it at all (FR-ADAPT-006, SG-SUPPORT-001).
 *
 * Enforcement role is not consulted here. A preflight surface with no native
 * blocking is fully supported when its baseline passes; authorization stays
 * with Git either way (FR-ADAPT-007).
 */
export const classifySupport = ({
  adapterId,
  variant = SUPPORTED_VARIANT,
  capabilities = {},
  baseline = null,
} = {}) => {
  const adapter = describeAdapter(adapterId);

  if (adapter === null) {
    return {
      adapterId: adapterId ?? null,
      variant,
      tier: 'unsupported',
      reason: 'not-a-v1-client',
    };
  }

  if (capabilities.repositoryFilesystem !== true
    || capabilities.processExecution !== true
    || capabilities.git !== true) {
    return {
      adapterId: adapter.id,
      variant,
      tier: 'unsupported',
      reason: 'repository-execution-unavailable',
    };
  }

  if (variant !== SUPPORTED_VARIANT) {
    return {
      adapterId: adapter.id,
      variant,
      tier: 'experimental',
      reason: 'variant-not-proved',
    };
  }

  if (baseline === null) {
    return {
      adapterId: adapter.id,
      variant,
      tier: 'experimental',
      reason: 'baseline-not-run',
    };
  }

  if (baseline.passed !== true) {
    return {
      adapterId: adapter.id,
      variant,
      tier: 'experimental',
      reason: 'baseline-failed',
      failedChecks: baseline.failedChecks ?? [],
    };
  }

  return {
    adapterId: adapter.id,
    variant,
    tier: 'supported',
    reason: 'baseline-passed',
    versions: baseline.versions ?? null,
  };
};
