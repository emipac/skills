import { configurationIdentity } from './identities.mjs';

/** What a receipt pins about each resolved runner. */
export const pinnedRunnerEntries = (resolved) => resolved.map((entry) => ({
  check_id: entry.check_id,
  role: entry.role,
  runner: entry.runner,
  executable: entry.executable,
  // An executable that is a script needs its interpreter found before it
  // can start, so what activation proved includes where that interpreter
  // was, and the hook runs against the same one (TB-028).
  interpreter: entry.interpreter ?? null,
  version: entry.version,
  // The exact invocation consent was granted against. The executable
  // alone does not say what it would be asked to do, so a widened or
  // narrowed argument vector would otherwise be invisible to every later
  // reconciliation: `evaluation_gate` binds which checks are required,
  // not what they run (TB-031, AC-CFG-004).
  preview: entry.preview ?? null,
}));

/**
 * Every receipt id one activation has been published under, newest first.
 *
 * The registration on disk names the receipt that authorized it, and neither
 * an update nor a sync rewrites that registration, so every id in the lineage
 * is still this activation's. `authorizedReceiptIds` in `lifecycle.mjs` reads
 * the same two fields; it is not imported here only because `lifecycle.mjs`
 * already imports this module.
 */
/** A receipt without its own id: what that id is the content identity of. */
export const receiptBodyOf = (receipt) => {
  const { receiptId: _id, ...body } = receipt ?? {};

  return body;
};

export const receiptLineageOf = (receipt) => [
  receipt?.receiptId ?? null,
  ...(receipt?.receiptLineage ?? []),
].filter((id) => typeof id === 'string' && id.length > 0);

/**
 * Where the Trusted configuration a sync judges against is read from.
 *
 * An Activation receipt pins the configuration's IDENTITY, not the policy, so
 * the policy itself has to come from somewhere, and it is accepted only from a
 * document that reproduces the pinned identity: a receipt that `gate sync`
 * wrote (it pins the policy it judged), the document the caller recovered —
 * the operator surface reads the committed `.agent-framework.yaml` at `HEAD` —
 * or the configuration file itself when its identity never moved. Anything
 * that does not hash to the pinned identity is not the Trusted configuration,
 * whatever it claims (`FR-CFG-005`, `TB-062`). `gate status` reads the pinned
 * section by the same rule, so what it shows as pinned is what a sync judges
 * against (`TB-068`).
 */
export const recoverTrustedConfiguration = ({ prior, trusted }) => {
  const pinned = prior?.configuration?.identity ?? null;
  const candidates = [
    prior?.configuration?.policy === undefined ? null : {
      schemaVersion: prior.configuration.schemaVersion ?? null,
      policy: prior.configuration.policy,
      source: 'receipt',
    },
    trusted ?? null,
  ];

  return candidates.find((candidate) => candidate !== null
    && pinned !== null
    && configurationIdentity(candidate) === pinned) ?? null;
};
