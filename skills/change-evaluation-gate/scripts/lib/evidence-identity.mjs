/**
 * The one content-identity rule, and the one normalization it is computed over.
 *
 * There is a single content-identity scheme in this gate: a SHA-256 over a
 * canonical serialization, in which key order never changes an identity. Every
 * pinned identity — repository, configuration, adapter, receipt, registration,
 * envelope, preview token — is that same function of that same serialization.
 *
 * What this module adds is the statement of which bytes an Evidence identity is
 * a function of. An evaluation identity is a function of what was evaluated
 * (`NFR-REL-001`), so values that describe *this run on this machine* are
 * replaced by a stated constant before anything is hashed:
 *
 * - the host-local execution root, wherever it appears — the field that names
 *   it, and every string that quotes it, including what a check printed;
 * - the wall-clock duration of each Check attempt.
 *
 * Neither says anything about the change that was graded. Both varied on every
 * run of the same content in the recorded real-world evidence, which is exactly
 * how one evaluation came to be stored as five envelopes.
 *
 * The elided values are not lost. They are run-local facts about one append, so
 * they are recorded on the append-only log entry the store writes, which is
 * per-append and never content-addressed (`FR-EVID-002`, `NFR-AUD-001`).
 *
 * The stored envelope also states its own persistence, which is self-
 * referential: the reference names the identity of the bytes carrying it. That
 * cycle is broken the way `activation.mjs` already breaks the receipt cycle —
 * by hashing with the one self-referential value replaced by a constant, and
 * substituting the real value into the bytes that are written. A reader
 * recomputes the identity by putting the constant back, which `envelopeIdentity`
 * does for envelopes of either store version.
 */

import { createHash } from 'node:crypto';

const canonical = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value ?? null);
};

const digestOf = (value) => createHash('sha256').update(value).digest('hex');

/** Content identity over a canonical serialization; never over host paths. */
export const contentIdentity = (value) => `sha256:${digestOf(canonical(value))}`;

/**
 * The stand-in for a value that describes this run on this machine rather than
 * what was evaluated. It is deliberately readable: an auditor reading it is
 * told the value was elided by rule, and the append-only log entry for that
 * append still carries it (`NFR-REL-001`).
 */
export const RUN_LOCAL_PLACEHOLDER = '<run-local>';

/**
 * The stand-in for the envelope's own identity inside the envelope, which
 * cannot be known until the bytes carrying it are hashed (`NFR-AUD-001`).
 */
export const EVIDENCE_IDENTITY_PLACEHOLDER = '<evidence-identity>';

/**
 * Every spelling of one host path this machine may produce.
 *
 * A macOS temporary directory is reached both as `/var/...` and as its resolved
 * `/private/var/...`, and a child process prints whichever one it resolved. A
 * rule that elided only the spelling the runner happened to hold would leave
 * the other one in the stored bytes.
 */
export const hostPathVariants = (root) => {
  if (typeof root !== 'string' || root.length === 0) {
    return [];
  }

  const variants = new Set([root]);

  if (root.startsWith('/private/')) {
    variants.add(root.slice('/private'.length));
  } else if (root.startsWith('/')) {
    variants.add(`/private${root}`);
  }

  // Longest first, so a path that is a prefix of another never elides half of it.
  return [...variants].sort((left, right) => right.length - left.length);
};

/** Replace every occurrence of one host path, in a string or anywhere inside a value. */
export const withoutHostPaths = (value, variants) => {
  if (variants.length === 0) {
    return value;
  }

  if (typeof value === 'string') {
    return variants.reduce(
      (text, variant) => text.split(variant).join(RUN_LOCAL_PLACEHOLDER),
      value,
    );
  }

  if (Array.isArray(value)) {
    return value.map((entry) => withoutHostPaths(entry, variants));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, withoutHostPaths(entry, variants)]),
    );
  }

  return value;
};

/**
 * One decision with every run-local value elided.
 *
 * This is the projection an Evidence identity is a function of, and it is the
 * projection the store writes. The decision the caller receives is untouched: a
 * maintainer reading a runner's diagnostics still gets the real execution root
 * and the real durations (`NFR-REL-001`, prohibited non-goal: the runner's
 * diagnostics keep the path).
 */
export const withoutRunLocalValues = (decision) => {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return decision ?? null;
  }

  const variants = hostPathVariants(decision.snapshot?.executionRoot ?? null);
  const elided = withoutHostPaths(decision, variants);

  if (!Array.isArray(elided.checks)) {
    return elided;
  }

  return {
    ...elided,
    checks: elided.checks.map((check) => (Array.isArray(check?.attempts)
      ? {
        ...check,
        attempts: check.attempts.map((attempt) => ({
          ...attempt,
          durationMs: RUN_LOCAL_PLACEHOLDER,
        })),
      }
      : check)),
  };
};

/**
 * The decision as it is stored: run-local values elided, and stating its own
 * persistence with the self-reference replaced by the placeholder.
 *
 * A record of a decision inside the store that says the decision was never
 * recorded is a small lie in an audit trail, and the kind an auditor reasonably
 * reads as evidence having been lost (`NFR-AUD-001`, `FR-EVID-001`).
 */
export const storedDecision = (decision, { blobIds = [] } = {}) => {
  const normalized = withoutRunLocalValues(decision);

  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    return normalized ?? null;
  }

  return {
    ...normalized,
    evidence: {
      ...(normalized.evidence ?? {}),
      persisted: true,
      reference: {
        evidenceId: EVIDENCE_IDENTITY_PLACEHOLDER,
        // The store root and the append instant are facts about this append on
        // this machine; the log entry carries both.
        storeRoot: RUN_LOCAL_PLACEHOLDER,
        appendedAt: RUN_LOCAL_PLACEHOLDER,
        blobIds,
        reasonCode: null,
      },
    },
  };
};

const withSelfReference = (envelope, evidenceId) => {
  const decision = envelope?.decision ?? null;

  if (!decision || typeof decision !== 'object' || Array.isArray(decision)
    || !decision.evidence?.reference || typeof decision.evidence.reference !== 'object') {
    return envelope;
  }

  return {
    ...envelope,
    decision: {
      ...decision,
      evidence: {
        ...decision.evidence,
        reference: { ...decision.evidence.reference, evidenceId },
      },
    },
  };
};

/** The exact bytes an envelope of a given identity is stored as. */
export const withEvidenceIdentity = (envelope, evidenceId) => ({
  ...withSelfReference(envelope, evidenceId),
  evidenceId,
});

/**
 * The identity of a stored envelope, recomputed from its own bytes.
 *
 * The two values an envelope carries that were not hashed are put back: its
 * top-level identity, and the self-reference inside its decision. An envelope
 * written before this rule existed carries neither a self-reference nor elided
 * values, so the same recomputation answers for it unchanged (`FR-EVID-004`,
 * `SG-EVID-001`).
 */
export const envelopeIdentity = (stored) => {
  const { evidenceId: unused, ...body } = stored ?? {};

  return contentIdentity(withSelfReference(body, EVIDENCE_IDENTITY_PLACEHOLDER));
};
