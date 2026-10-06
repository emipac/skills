import { describeAdapter } from '../declarations/registry.mjs';
import { runAdapterEvaluation } from '../evaluation.mjs';
import { normalizeNativeInvocation, normalizeTrigger } from '../native/identity.mjs';
import { presentDecision } from '../presentation/decision.mjs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

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
  const turn = adapter.nativeIdentity.turn ?? null;

  return {
    [adapter.nativeIdentity.event]: nativeEvent,
    [adapter.nativeIdentity.sessionId]: sessionId,
    [declaration.field]: declaration.shape === 'path-array' ? [repositoryRoot] : repositoryRoot,
    // A surface that declares a turn sends one on every event, so a payload
    // built from its declaration carries one too. Building one without it would
    // model a client that does not exist and hide every rule that reads it.
    ...(turn === null ? {} : {
      [turn.status]: turn.completed[0],
      [turn.iteration]: 0,
    }),
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
