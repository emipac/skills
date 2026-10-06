import { describeAdapter } from './declarations/registry.mjs';
import { normalizeNativeInvocation, normalizeTrigger } from './native/identity.mjs';
import { resolveRepositoryRoot } from './native/repository.mjs';
import { presentDecision } from './presentation/decision.mjs';
import { OPERATION, PROTOCOL_VERSION, validateDecision } from '../evaluation-contract.mjs';
import { authorizationFor } from '../policy.mjs';

/** The sentinel a raced invocation resolves with when its timeout wins. */
const TIMED_OUT = Symbol('adapter-invocation-timed-out');

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
