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
 * handling, parallel isolation, declared native blocking, and the feedback
 * channel by which a running adapter returns a preflight result to its client.
 * An adapter states all nine; nothing is inherited from another client
 * (FR-ADAPT-004, NFR-COMP-001).
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
  'feedback',
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
  feedback: Object.freeze(['channel', 'field', 'none']),
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
    // Authoritative Git does not register in a client configuration file at
    // all: its registration surface is this clone's own hook chain, which
    // activation composes through the declared hook strategy order. It says so
    // rather than leaving the field absent, because an adapter that declares no
    // registration surface has not told anyone where it registers
    // (FR-ADAPT-008).
    registration: Object.freeze({ kind: 'repository-hook-chain' }),
    nativeEvents: Object.freeze({ 'commit-attempt': 'pre-commit' }),
    // Nothing here is pending observation: Git's hook contract is specified,
    // and this surface is driven by the Gate's own hook program.
    unverifiedTriggers: Object.freeze([]),
    nativeIdentity: Object.freeze({
      event: 'hook',
      sessionId: 'commitProcessId',
      clientVersion: null,
      // Git invokes `pre-commit` at the repository root by its own contract, so
      // this surface receives a root rather than a path that might be inside
      // one. It declares that, instead of inheriting a desktop client's
      // resolution rule.
      repositoryRoot: Object.freeze({
        field: 'repositoryRoot',
        shape: 'path',
        resolution: 'declared-root',
      }),
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
      feedback: Object.freeze({
        channel: null,
        field: null,
        none: '',
      }),
    }),
  }),
  'claude-code-desktop': Object.freeze({
    id: 'claude-code-desktop',
    version: '1.0.0',
    surface: 'claude-code-desktop-local-code-tab',
    role: 'preflight',
    // Observed from a real client configuration: this surface registers inside a
    // GENERAL settings file that also holds `permissions`, so registration is a
    // merge into a document the adapter mostly does not own (FR-ADAPT-008,
    // SG-HOOK-001).
    registration: Object.freeze({
      kind: 'client-configuration-file',
      file: '.claude/settings.local.json',
      ownership: 'shared-settings-file',
      container: Object.freeze(['hooks']),
      // Registration is keyed by the SAME declared native event the trigger
      // table already carries. One declared event name per adapter serves both
      // registration and trigger matching — but only per client, never shared.
      trigger: 'work-complete',
      blockSchema: 'matcher-group',
      matcher: '',
      commandType: 'command',
      // This file carries no version key of its own, so this client cannot
      // signal a breaking change to its registration format.
      schemaVersion: null,
    }),
    // Observed from a real client payload: `hook_event_name: "Stop"`.
    //
    // This client's hook events are fully enumerated and NONE of them is a
    // before-commit event, so the optional `commit-attempt` mapping is simply
    // absent — the same conservative non-declaration `codex-desktop` makes.
    // Deriving one from a tool-use event and a matcher would be a guessed
    // trigger, which FR-ADAPT-003 forbids.
    nativeEvents: Object.freeze({ 'work-complete': 'Stop' }),
    unverifiedTriggers: Object.freeze([]),
    nativeIdentity: Object.freeze({
      event: 'hook_event_name',
      sessionId: 'session_id',
      clientVersion: null,
      // Observed `cwd` was NOT a repository root, while another client's `cwd`
      // was. Neither assumption is safe, so this surface declares that its
      // value is a path *within* a repository and must be resolved upward.
      repositoryRoot: Object.freeze({
        field: 'cwd',
        shape: 'path',
        resolution: 'resolve-upward',
      }),
    }),
    capabilities: Object.freeze({
      event: Object.freeze({
        deterministic: true,
        normalizedTriggers: Object.freeze(['work-complete']),
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
      feedback: Object.freeze({
        channel: null,
        field: null,
        none: '',
      }),
    }),
  }),
  'codex-desktop': Object.freeze({
    id: 'codex-desktop',
    version: '1.0.0',
    surface: 'codex-desktop-local-project',
    role: 'preflight',
    // Observed from a real client configuration: a DEDICATED hooks file whose
    // block shape happens to match the other capitalised-event surface today.
    // That convergence is an observation, not a guarantee, so this declaration
    // is its own and is not shared: one client's change may never silently
    // redefine another's (FR-ADAPT-004, FR-ADAPT-008).
    registration: Object.freeze({
      kind: 'client-configuration-file',
      file: '.codex/hooks.json',
      ownership: 'dedicated-hooks-file',
      container: Object.freeze(['hooks']),
      trigger: 'work-complete',
      blockSchema: 'matcher-group',
      matcher: '',
      commandType: 'command',
      schemaVersion: null,
    }),
    // This surface exposes no deterministic pre-commit event. The optional
    // `before-commit-attempt` mapping is therefore simply absent; the adapter
    // does not invent one (FR-ADAPT-003).
    // Observed from a real client payload: `hook_event_name: "Stop"`.
    nativeEvents: Object.freeze({ 'work-complete': 'Stop' }),
    unverifiedTriggers: Object.freeze([]),
    nativeIdentity: Object.freeze({
      event: 'hook_event_name',
      sessionId: 'session_id',
      clientVersion: null,
      // Observed as a repository root here and NOT one under another client.
      // Same field name, same shape, different truth — so this surface
      // declares its own resolution rule rather than sharing one.
      repositoryRoot: Object.freeze({
        field: 'cwd',
        shape: 'path',
        resolution: 'resolve-upward',
      }),
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
      feedback: Object.freeze({
        channel: null,
        field: null,
        none: '',
      }),
    }),
  }),
  cursor: Object.freeze({
    id: 'cursor',
    version: '1.0.0',
    surface: 'cursor-ide-local-agent',
    role: 'preflight',
    // A DEDICATED hooks file that is INDEPENDENTLY VERSIONED and whose block
    // shape is FLAT: no matcher, no type, just a command. It is the only v1
    // surface that can signal a breaking change to its own registration format,
    // which is exactly why the schema-versioning behaviour is declared rather
    // than assumed (FR-ADAPT-008, RISK-004).
    //
    // Reported by the Product Owner rather than read from a live configuration,
    // unlike this surface's payload evidence. It is declared here so a real
    // client-driven run can confirm or refute it.
    registration: Object.freeze({
      kind: 'client-configuration-file',
      file: '.cursor/hooks.json',
      ownership: 'dedicated-hooks-file',
      container: Object.freeze(['hooks']),
      trigger: 'work-complete',
      blockSchema: 'flat-command',
      matcher: null,
      commandType: null,
      schemaVersion: Object.freeze({ key: 'version', value: 1 }),
    }),
    // Observed from a real client payload: `hook_event_name: "stop"`, in
    // lowercase, where the other two surfaces send `"Stop"`.
    nativeEvents: Object.freeze({ 'work-complete': 'stop' }),
    // Not observed and not disproven. No capture has yet shown whether this
    // surface emits a deterministic pre-commit event, so it is neither claimed
    // nor forgotten: it is absent from `nativeEvents` and from
    // `capabilities.event.normalizedTriggers`, so nothing can normalize to it,
    // and recorded here so release qualification knows what is still open.
    // This is a different absence from the other two surfaces', whose client
    // event sets are enumerated and contain no such event (FR-ADAPT-003,
    // Q-004).
    unverifiedTriggers: Object.freeze(['commit-attempt']),
    nativeIdentity: Object.freeze({
      event: 'hook_event_name',
      sessionId: 'session_id',
      // This client self-reports its exact version in every payload.
      clientVersion: 'cursor_version',
      // This surface sends an ARRAY of workspace roots and supports multi-root
      // workspaces, so its declaration differs in shape from both other
      // desktop surfaces.
      repositoryRoot: Object.freeze({
        field: 'workspace_roots',
        shape: 'path-array',
        resolution: 'resolve-upward',
      }),
    }),
    capabilities: Object.freeze({
      event: Object.freeze({
        deterministic: true,
        normalizedTriggers: Object.freeze(['work-complete']),
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
      feedback: Object.freeze({
        channel: 'stdout-json',
        field: 'followup_message',
        none: '',
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
/** Read one declared top-level field out of a native payload, or `null`. */
const readNativeField = (payload, field) => (
  typeof field === 'string' && isPlainObject(payload) ? payload[field] ?? null : null
);

/** Read a declared field that must be a non-empty string, or `null`. */
const readNativeString = (payload, field) => {
  const value = readNativeField(payload, field);

  return typeof value === 'string' && value.length > 0 ? value : null;
};

/**
 * Read the repository-root CANDIDATE one adapter's declaration yields.
 *
 * A candidate is not a repository root. It is whatever this client put in its
 * declared field, which real captures show may be a repository root, a path
 * inside one, a path inside none at all, or — on a multi-root client — a set of
 * roots with no single answer. Resolving that into an actual root is a separate
 * step; this one only reads, and says exactly why it read nothing.
 */
const readRepositoryRootCandidate = (adapter, native) => {
  const declaration = adapter.nativeIdentity.repositoryRoot;
  const value = readNativeField(native, declaration.field);

  // A client that declares an array of workspace roots needs an explicit rule:
  // the dotted-scalar reader cannot resolve one, and a multi-root workspace has
  // no single repository root at all.
  if (declaration.shape === 'path-array') {
    if (!Array.isArray(value)) {
      return {
        candidate: null,
        detail: `${adapter.id} declares ${declaration.field} as an array of workspace roots, and this payload does not carry one.`,
      };
    }

    const roots = value.filter((entry) => typeof entry === 'string' && entry.length > 0);

    if (roots.length === 1) {
      return { candidate: roots[0], detail: null };
    }

    // Selecting an element would be a guess (FR-ADAPT-005, SG-EVAL-001).
    return {
      candidate: null,
      detail: roots.length === 0
        ? `${adapter.id} read no workspace root from ${declaration.field}.`
        : `${adapter.id} read ${roots.length} workspace roots from ${declaration.field}: a multi-root workspace has no single repository root.`,
    };
  }

  const candidate = typeof value === 'string' && value.length > 0 ? value : null;

  return {
    candidate,
    detail: candidate === null
      ? `${adapter.id} read no repository path from ${declaration.field}.`
      : null,
  };
};

/**
 * Normalize one native client payload into the identity the gate contract
 * names, using the adapter's *own* declared fields.
 *
 * This is the entire native boundary. At most four values are read out — the
 * native event, the repository-root candidate, the client's session identity,
 * and, where the client self-reports it, its exact version — and the rest of
 * the payload is left where it was. Nothing client-native has a way past this
 * function, because nothing else is ever copied (FR-ADAPT-003).
 *
 * A payload whose declared fields do not resolve belongs to some other client.
 * The adapter reports that it cannot read it rather than guessing.
 */
export const normalizeNativeInvocation = ({ adapterId, native } = {}) => {
  const adapter = describeAdapter(adapterId);

  if (adapter === null || !isPlainObject(native)) {
    return null;
  }

  const repositoryRoot = readRepositoryRootCandidate(adapter, native);

  return {
    adapterId: adapter.id,
    nativeEvent: readNativeString(native, adapter.nativeIdentity.event),
    repositoryRootCandidate: repositoryRoot.candidate,
    repositoryRootDetail: repositoryRoot.detail,
    sessionId: readNativeString(native, adapter.nativeIdentity.sessionId),
    clientVersion: readNativeString(native, adapter.nativeIdentity.clientVersion),
  };
};

/** Whether one directory is a repository root, by the only marker Git guarantees. */
const hasRepositoryMarker = async (directory) => {
  try {
    // A worktree or submodule carries `.git` as a file rather than a directory,
    // so the marker's kind is deliberately not inspected.
    await stat(path.join(directory, '.git'));

    return true;
  } catch {
    return false;
  }
};

/**
 * Resolve the repository root that contains one path, or `null`.
 *
 * The path a client sends is not a repository root. Real captures show the same
 * field carrying a repository root under one client and a directory *above* the
 * repository under another, so neither assumption is safe. This walks upward
 * from the given path and returns the first real repository root it finds.
 *
 * When no repository contains the path, the answer is `null` and the caller
 * reports `unverified`. It never falls back to the path it was given: a
 * repository root the Gate guessed is worse than one it admits it lacks
 * (FR-ADAPT-005, SG-EVAL-001).
 */
export const resolveRepositoryRoot = async (candidate, { isRepositoryRoot } = {}) => {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return null;
  }

  const test = typeof isRepositoryRoot === 'function' ? isRepositoryRoot : hasRepositoryMarker;
  let directory = path.resolve(candidate);

  for (;;) {
    if (await test(directory) === true) {
      return directory;
    }

    const parent = path.dirname(directory);

    if (parent === directory) {
      return null;
    }

    directory = parent;
  }
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
 * Render one presented decision through the adapter's declared feedback channel.
 *
 * The runner never learns a client field name: it asks this function, and this
 * function reads the field from the declaration (FR-ADAPT-004, SG-OWNER-001).
 * A passing preflight returns the declared silence form so a clean turn is not
 * interrupted. Every other outcome — a failed required check, unverified
 * coverage, or a harness fault — occupies the declared field. An adapter that
 * declares no channel returns none.
 */
export const formatFeedback = ({ adapterId, view } = {}) => {
  const adapter = describeAdapter(adapterId);
  const feedback = adapter?.capabilities?.feedback ?? null;

  if (feedback === null || feedback.channel === null) {
    return typeof feedback?.none === 'string' ? feedback.none : '';
  }

  const silent = view?.outcome === 'passed' && view?.failure == null;

  if (silent) {
    return typeof feedback.none === 'string' ? feedback.none : '';
  }

  if (feedback.channel !== 'stdout-json' || typeof feedback.field !== 'string') {
    return typeof feedback.none === 'string' ? feedback.none : '';
  }

  const failing = (view?.presentation?.checks ?? []).filter(
    (check) => check?.outcome !== 'passed' && check?.outcome !== 'not-applicable',
  );
  let message;

  if (view?.failure) {
    message = `Preflight (not a commit decision): unverified — ${view.failure.detail ?? 'the evaluation could not be completed'}.`;
  } else if (failing.length > 0) {
    message = `Preflight (not a commit decision): ${failing.map((check) => `${check.id} ${check.outcome}`).join('; ')}.`;
  } else {
    message = `Preflight (not a commit decision): ${view?.outcome ?? 'unverified'}.`;
  }

  return `${JSON.stringify({ [feedback.field]: message })}\n`;
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
  const trigger = normalizeTrigger({ adapterId, nativeEvent: event });

  if (trigger === null) {
    return failedPresentation({
      adapter,
      family: 'capability',
      detail: `${adapter.id} declares no normalized trigger for the native event ${JSON.stringify(event)}.`,
    });
  }

  if (identity !== null && identity.sessionId === null) {
    return failedPresentation({
      adapter,
      family: 'capability',
      detail: `${adapter.id} could not read a session identity from this native payload.`,
    });
  }

  if (identity !== null && identity.repositoryRootCandidate === null) {
    return failedPresentation({
      adapter,
      family: 'capability',
      detail: identity.repositoryRootDetail,
    });
  }

  let invocationContext = context;

  if (identity !== null) {
    const declaration = adapter.nativeIdentity.repositoryRoot;
    const repositoryRoot = declaration.resolution === 'resolve-upward'
      ? await resolveRepositoryRoot(identity.repositoryRootCandidate, dependencies)
      : identity.repositoryRootCandidate;

    if (repositoryRoot === null) {
      return failedPresentation({
        adapter,
        family: 'capability',
        detail: `${adapter.id} resolved no repository root from the ${declaration.field} path this client sent: ${JSON.stringify(identity.repositoryRootCandidate)}.`,
      });
    }

    invocationContext = {
      ...context,
      repository: { root: repositoryRoot },
      session: { id: identity.sessionId },
    };
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
/**
 * How the payloads that drove one baseline run were obtained.
 *
 * This is the difference between "the declaration is internally coherent" and
 * "a real client actually invoked this adapter". A baseline can be executed
 * offline by injecting payloads built from the adapter's own declaration, which
 * proves a great deal — but it cannot prove the declaration matches the client,
 * because the same declaration wrote the fixture. Only a run driven by a real
 * client invocation proves that (SG-SUPPORT-001, AC-ADAPT-002, Q-004).
 */
export const BASELINE_PAYLOAD_SOURCES = Object.freeze([
  'captured-client-invocation',
  'synthetic-fixture',
]);

/**
 * Whether a value is a native payload a client actually sent.
 *
 * Only the shape is judged here — that it is a plain object carrying at least
 * one key. Whether *this* adapter can read it is the baseline's own
 * `captured-payload-readable` check, which is where a declaration that does not
 * match the client is supposed to fail rather than be filtered out quietly.
 */
const isCapturedPayload = (value) => typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && Object.keys(value).length > 0;

/**
 * The extra check a run driven by a real client invocation can report, and a
 * fixture-only run cannot reach. It is not in `BASELINE_CHECKS` because every
 * surface owes those outcomes on every run; this one exists only when there is
 * a captured payload to read.
 */
export const CAPTURED_BASELINE_CHECKS = Object.freeze(['captured-payload-readable']);

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

/**
 * Build a native payload in *this* adapter's declared shape.
 *
 * The baseline drives each surface through the same field names, and the same
 * field *shapes*, the adapter says its client uses, so a fixture cannot pass by
 * being written in the gate's preferred shape rather than the client's. Every
 * value here is synthetic; only the shape comes from the client.
 */
export const buildNativePayload = (adapter, { nativeEvent, repositoryRoot, sessionId }) => {
  const declaration = adapter.nativeIdentity.repositoryRoot;

  return {
    [adapter.nativeIdentity.event]: nativeEvent,
    [adapter.nativeIdentity.sessionId]: sessionId,
    [declaration.field]: declaration.shape === 'path-array' ? [repositoryRoot] : repositoryRoot,
  };
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
  // A payload the client itself sent, if this run was given one. Everything
  // below drives through it rather than through the adapter's own declaration,
  // which is the whole difference between proving the declaration matches the
  // client and restating it.
  const captured = isCapturedPayload(dependencies.capturedPayload)
    ? dependencies.capturedPayload
    : null;
  // The label cannot be asserted. `captured-client-invocation` is earned only
  // by supplying the invocation, because a claim that a real client drove this
  // run is exactly the claim SG-SUPPORT-001 will not take on trust.
  const claimed = BASELINE_PAYLOAD_SOURCES.includes(dependencies.evidence?.payloadSource)
    ? dependencies.evidence.payloadSource
    : 'synthetic-fixture';
  const payloadSource = claimed === 'captured-client-invocation' && captured === null
    ? 'synthetic-fixture'
    : claimed;
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
    const event = nativeEvent
      ?? adapter.nativeEvents['work-complete']
      ?? adapter.nativeEvents['commit-attempt'];
    // A captured payload is replayed in the client's own words. Only the two
    // values the baseline must vary — the event under test and the session it
    // isolates — are substituted, and only through the adapter's declared field
    // names, so a declaration that does not match the client cannot read them.
    const rootDeclaration = adapter.nativeIdentity.repositoryRoot;
    const native = captured === null
      ? buildNativePayload(adapter, { nativeEvent: event, repositoryRoot, sessionId })
      : {
        ...captured,
        [adapter.nativeIdentity.event]: event,
        [adapter.nativeIdentity.sessionId]: sessionId,
        // The client named its own workspace; the baseline grades a throwaway
        // repository. Only the location moves, and it moves in the shape the
        // adapter declared, so an array-shaped surface stays array-shaped.
        [rootDeclaration.field]: rootDeclaration.shape === 'path-array'
          ? [repositoryRoot]
          : repositoryRoot,
      };
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

  // 0. When a real invocation was supplied, this adapter's declared field names
  //    must actually read it. This is the check that a fixture-only run cannot
  //    reach and that a wrong declaration cannot survive: the payload comes from
  //    the client, the field names come from the adapter, and either they agree
  //    or the surface is not describing this client (SG-SUPPORT-001).
  if (captured !== null) {
    const identity = normalizeNativeInvocation({ adapterId, native: captured });
    const readable = identity !== null
      && identity.nativeEvent !== null
      && identity.repositoryRoot !== null
      && identity.sessionId !== null;

    record(
      'captured-payload-readable',
      readable,
      readable
        ? `The declared field names read the client's own payload: event ${JSON.stringify(identity.nativeEvent)}, plus a repository root and a session identity.`
        : 'The declared field names could not read a native payload this client actually sent.',
    );
  }

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
    evidence: { payloadSource },
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

  // A baseline driven by payloads this repository built from its own
  // declaration cannot establish that the declaration matches the client: the
  // fixture and the thing under test came from the same source. Real captures
  // corrected every declared field on every surface precisely because injected
  // fixtures could not (SG-SUPPORT-001).
  if (baseline.evidence?.payloadSource !== 'captured-client-invocation') {
    return {
      adapterId: adapter.id,
      variant,
      tier: 'experimental',
      reason: 'client-invocation-not-observed',
      versions: baseline.versions ?? null,
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

/** The registration surface kinds an adapter may declare (FR-ADAPT-008). */
export const REGISTRATION_SURFACE_KINDS = Object.freeze([
  'client-configuration-file',
  'repository-hook-chain',
]);

/** The block schemas a declared client configuration surface may use. */
export const REGISTRATION_BLOCK_SCHEMAS = Object.freeze(['matcher-group', 'flat-command']);

/**
 * What a client-configuration registration surface must state.
 *
 * `schemaVersion` is required even when it is `null`, because "this format is
 * not independently versioned" is a claim about the client, not an absence.
 */
const REGISTRATION_FIELDS = Object.freeze([
  'file',
  'ownership',
  'container',
  'trigger',
  'blockSchema',
  'matcher',
  'commandType',
  'schemaVersion',
]);

/**
 * Validate one adapter registration declaration.
 *
 * A missing field is an error rather than a default and an unknown block schema
 * is an error rather than a guess: an adapter that has not stated where and how
 * it registers has not declared a registration surface, and a gate that filled
 * one in would be assuming another client's file, block shape, or format
 * version (FR-ADAPT-008, AC-ADAPT-003).
 */
export const validateRegistrationDeclaration = (registration) => {
  if (!isPlainObject(registration)) {
    return [{
      code: 'adapter-registration-invalid',
      path: 'registration',
      message: 'An adapter must declare its registration surface.',
    }];
  }

  if (!REGISTRATION_SURFACE_KINDS.includes(registration.kind)) {
    return [{
      code: 'adapter-registration-kind-unknown',
      path: 'registration.kind',
      message: `${registration.kind} is not a declared registration surface kind.`,
    }];
  }

  // A surface that registers through this clone's own hook chain states that,
  // and owes nothing about a client configuration file it never writes.
  if (registration.kind !== 'client-configuration-file') {
    return [];
  }

  const errors = REGISTRATION_FIELDS
    .filter((field) => !(field in registration))
    .map((field) => ({
      code: 'adapter-registration-incomplete',
      path: `registration.${field}`,
      message: `A client configuration registration surface must state ${field}.`,
    }));

  if ('blockSchema' in registration
    && !REGISTRATION_BLOCK_SCHEMAS.includes(registration.blockSchema)) {
    errors.push({
      code: 'adapter-registration-schema-unknown',
      path: 'registration.blockSchema',
      message: `${registration.blockSchema} is not a declared registration block schema.`,
    });
  }

  return errors;
};
