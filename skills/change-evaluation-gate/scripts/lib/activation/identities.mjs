import { contentIdentity } from '../evidence-store.mjs';

/**
 * A clone identity. It names one clone's resolved Git metadata, which is
 * exactly the scope activation is bound to; it is not a project identity and
 * never travels between machines.
 */
export const repositoryIdentity = (gitCommonDirectory) => contentIdentity({ gitCommonDirectory });

/** The identity of the approved repository policy the receipt pins. */
export const configurationIdentity = (configuration) => contentIdentity({
  schemaVersion: configuration?.schemaVersion ?? null,
  policy: configuration?.policy ?? null,
});

/**
 * The identity of the selected adapter set.
 *
 * A transaction that paused with one adapter set may not resume with another:
 * the operator consented to self-testing and activating exactly these
 * integrations (FR-LIFE-016).
 */
export const adapterIdentity = (adapters = []) => contentIdentity(
  adapters.map((adapter) => ({
    id: adapter?.id ?? null,
    version: adapter?.version ?? null,
    authoritative: adapter?.authoritative === true,
  })),
);

/**
 * The identity of one Activation transaction.
 *
 * It binds the four things a resumption may never change: the clone, the
 * approved policy, the selected adapters, and the exact preview consent was
 * granted against. Trust prompts are the one legitimate reason to pause, and
 * the machine may have changed while the operator was answering one.
 */
export const activationTransactionIdentity = ({
  repositoryIdentity: repository = null,
  configurationIdentity: configuration = null,
  adapterIdentity: adapters = null,
  previewId = null,
}) => contentIdentity({ repository, configuration, adapters, previewId });
