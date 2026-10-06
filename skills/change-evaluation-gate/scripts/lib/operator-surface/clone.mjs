import { describeAdapter } from '../adapters.mjs';
import { openEvidenceStore, resolveGitCommonDirectory } from '../evidence-store.mjs';
import { openStore, resolveConfiguration, resolveReceipt } from '../hook-runner.mjs';
import { failure } from './outcomes.mjs';

/**
 * The adapters this INSTALLED gate still declares, under the ids the Activation
 * receipt pinned.
 *
 * An adapter the receipt names and the gate no longer declares is not observed
 * at all, which is exactly the loss `statusGate` already grades by the
 * authority the receipt recorded. Nothing here decides what that loss means —
 * `RISK-004` is graded in one place, and this is not it.
 */
export const observedAdapters = (receipt) => (receipt?.adapters ?? [])
  .map((adapter) => ({ adapter, declared: describeAdapter(adapter?.id ?? null) }))
  .filter(({ declared }) => declared !== null)
  .map(({ adapter, declared }) => ({
    id: adapter.id,
    version: declared.version,
    authoritative: declared.role === 'authoritative',
  }));

/**
 * Resolve this clone's Activation receipt and, when the command needs one, its
 * Evidence store — through the same helpers the authoritative and preflight
 * runners resolve them with.
 *
 * A store is opened only when the invocation genuinely needs one, because
 * `openEvidenceStore` creates the store it opens: observing a clone that has no
 * Evidence store must not be the thing that gives it one. A CONFIRMATION does
 * need one — the write it performs has to leave a record — and that is the one
 * case where opening it is the right answer rather than a side effect.
 *
 * The evidence policy bounds what an APPEND may cost, and a configuration this
 * clone cannot read is not a reason to refuse to operate on it: the store opens
 * with no ceilings and the command continues.
 */
export const resolveClone = async ({
  repositoryRoot,
  environment,
  command,
  receiptRequired = true,
  wantStore = true,
  consentChannel = null,
}) => {
  const activation = await resolveReceipt(repositoryRoot);

  if (!activation.ok
    && (receiptRequired || activation.reasonCode !== 'activation-receipt-missing')) {
    return {
      failed: failure({ command, reasonCode: activation.reasonCode, detail: activation.detail }),
    };
  }

  const receipt = activation.ok ? activation.receipt : null;
  // `'when-activated'` is how `status` asks for a store without being the thing
  // that creates one: a clone that was never activated has nothing to open.
  const needStore = wantStore === true || (wantStore === 'when-activated' && receipt !== null);

  if (!needStore) {
    return { receipt, store: null };
  }

  const gitCommonDirectory = activation.ok
    ? activation.gitCommonDirectory
    : await resolveGitCommonDirectory({ repositoryRoot }).catch(() => null);

  if (gitCommonDirectory === null) {
    return {
      failed: failure({
        command,
        reasonCode: 'repository-unresolved',
        detail: 'the Git common directory could not be resolved, so this clone has nowhere to record what was done.',
      }),
    };
  }

  const configuration = await resolveConfiguration(repositoryRoot);
  const opened = await openStore({
    repository: { root: repositoryRoot },
    activation: { ...activation, receipt, gitCommonDirectory },
    configuration: configuration.ok ? configuration : { policy: null },
    environment,
    openStoreSeam: openEvidenceStore,
    consentChannel,
  });

  if (!opened.ok) {
    return { failed: failure({ command, reasonCode: opened.reasonCode, detail: opened.detail }) };
  }

  return { receipt, store: opened.store };
};
