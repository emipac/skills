

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

/**
 * The trust models an adapter may declare, what each one asserts, and what
 * proves it.
 *
 * This registry exists because it did not. The contract required every adapter
 * to declare `trust.model` and never said what a model was, so three adapters
 * declared values nothing defined and nothing could establish, and activation
 * paused at `trust-pending` forever on a clone with nothing wrong with it
 * (`TB-046`). A declared value naming nothing is not a weaker declaration than
 * a defined one; it is the absence of one, wearing its shape.
 *
 * A model is defined here and satisfied by exactly one branch of
 * `createTrustEstablishment`'s dispatch, which reads `provenBy` rather than a
 * model name. `mechanism` is the single source for what a receipt records, so
 * the dispatch keeps no second table that could disagree with this one.
 *
 * `declarable` is the rule `FR-LIFE-016` states. Trust is step 5 of
 * `ACTIVATION_STEPS` and adapter registration is step 7, so a model whose proof
 * can only exist AFTER something is registered can never be established by the
 * step that blocks that registration. An adapter may therefore declare only a
 * model an activation can establish before it registers anything.
 *
 * WHAT A FUTURE MODEL MUST SUPPLY TO BE ADDABLE. An entry here stating (1) what
 * being trusted under it asserts, (2) `provenBy` — the observation that proves
 * it, which must be one this process can make for itself before registration,
 * (3) the `mechanism` a receipt records, (4) whether it needs a client grant
 * reader, and (5) whether an adapter may declare it. A `provenBy` this dispatch
 * has no branch for is not addable by declaration alone: the branch that makes
 * the observation is part of the model, not a consequence of naming it
 * (`FR-ADAPT-008`, `SG-TRUST-001`, `RISK-004`).
 */
export const ADAPTER_TRUST_MODELS = Object.freeze({
  'repository-hook-registration': Object.freeze({
    id: 'repository-hook-registration',
    asserts: 'The maintainer gave repository-bound consent to a preview naming the exact surface this adapter would register, and the Gate registers only a surface it owns.',
    provenBy: 'repository-bound-consent',
    mechanism: 'repository-bound-consent',
    requiresClientGrantReader: false,
    declarable: true,
    rationale: 'The proof is the two-invocation confirmation the command already required, bound to this clone. It exists before anything is registered, so the trust step can establish it.',
  }),
  'client-grant-before-registration': Object.freeze({
    id: 'client-grant-before-registration',
    asserts: 'The client has already recorded a grant for THIS clone that a process can read before the Gate registers anything.',
    provenBy: 'client-grant-read',
    mechanism: 'client-grant-read',
    requiresClientGrantReader: true,
    declarable: false,
    rationale: 'No v1 client offers a grant a process can read before registration: all three desktop surfaces register into a project-local file the Gate itself writes, so any client-side review of it happens afterwards. The model is defined and its dispatch kept because `FR-LIFE-016` requires the pause-and-resume capability for a client that one day grants first; it becomes declarable when such a client exists and a grant reader is bound to read it.',
    grantDescription: 'only the client itself can record this grant for this clone, and it has not. Grant it in the client for this clone, then resume.',
  }),
});

/**
 * Why an adapter declares no feedback channel, when it declares none.
 *
 * One `null` used to carry two unrelated meanings. Authoritative Git declares
 * no channel because it needs none: it answers by blocking, so a non-zero exit
 * IS the answer. The desktop surfaces nobody has yet driven with a real client
 * invocation declare no channel because nobody knows how they take an answer
 * back. The runtime could not tell the two apart, so an unobserved surface
 * registered as though it were ready and then evaluated every turn into
 * silence (`TB-048`).
 *
 * `absence` states which one is meant, and the validator rejects a declaration
 * with no channel that says neither. A declared channel has no absence to
 * explain, so `absence` is `null` beside it.
 *
 * `requiresNativeBlocking` is the rule `not-needed` rests on: only a surface
 * that blocks natively has an answer that is not a channel (`FR-ADAPT-004`,
 * `FR-ADAPT-005`, `RISK-004`).
 */
export const FEEDBACK_ABSENCES = Object.freeze({
  'not-needed': Object.freeze({
    id: 'not-needed',
    asserts: 'this surface needs no feedback channel: it answers by blocking, so its exit status is the answer.',
    requiresNativeBlocking: true,
  }),
  'not-observed': Object.freeze({
    id: 'not-observed',
    asserts: 'how this surface takes an answer back has not been observed from a real client invocation, so no channel is declared and none is guessed.',
    requiresNativeBlocking: false,
  }),
});

/** The fields each category must state. An empty category declares nothing. */
export const CAPABILITY_FIELDS = Object.freeze({
  event: Object.freeze(['deterministic', 'normalizedTriggers']),
  blocking: Object.freeze(['native']),
  // `clientReview` is stated, never inferred: a client that reviews a
  // registration AFTER reading it is a fact about what happens next, and an
  // adapter that says nothing about it has not declared that there is none.
  trust: Object.freeze(['model', 'failureIsUnverified', 'clientReview']),
  repository: Object.freeze(['localFilesystemRoot', 'worktreeAware']),
  session: Object.freeze(['identity', 'parallelIsolation']),
  filesystem: Object.freeze(['sameFilesAsClient']),
  git: Object.freeze(['metadata', 'index']),
  invocation: Object.freeze(['nonInteractive', 'mechanism', 'structuredResult', 'timeoutMs']),
  // `absence` is stated even beside a channel, as `null`: "this surface has a
  // channel" and "this surface did not say why it has none" must not look alike.
  feedback: Object.freeze(['channel', 'field', 'none', 'maxIterations', 'absence']),
});

/** The fields a declared post-registration client review must state. */
export const CLIENT_REVIEW_FIELDS = Object.freeze(['when', 'mechanism', 'detail']);
