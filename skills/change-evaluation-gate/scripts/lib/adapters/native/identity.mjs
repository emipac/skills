import { describeAdapter } from '../declarations/registry.mjs';
import { isPlainObject } from '../values.mjs';

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

/**
 * Read how the turn that fired this event ended, through the adapter's own
 * declaration.
 *
 * A client whose event fires for both a finished turn and a stopped one has not
 * told the gate `work-complete` merely by firing it: only the declared
 * completed values mean that. An interrupted turn is the operator's decision,
 * and a preflight that answered it would put a message in front of the agent
 * that restarts the work the operator just stopped (FR-ADAPT-003).
 *
 * Returns one of three states. `completed` is the only one that is evaluated;
 * `interrupted` is answered with nothing; `unreadable` is `unverified`, because
 * a status this surface never declared is not evidence that the turn finished.
 * A surface declaring no turn at all has always been completed and stays that
 * way.
 */
export const normalizeTurn = ({ adapterId, native } = {}) => {
  const adapter = describeAdapter(adapterId);

  if (adapter === null) {
    return null;
  }

  const declaration = adapter.nativeIdentity.turn ?? null;

  if (declaration === null) {
    return { declared: false, state: 'completed', status: null, iteration: null };
  }

  const iterationValue = isPlainObject(native) ? native[declaration.iteration] : null;
  const iteration = Number.isInteger(iterationValue) ? iterationValue : null;
  const status = readNativeString(native, declaration.status);
  const state = (() => {
    if (declaration.completed.includes(status)) {
      return 'completed';
    }

    return declaration.interrupted.includes(status) ? 'interrupted' : 'unreadable';
  })();

  return { declared: true, state, status, iteration };
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
