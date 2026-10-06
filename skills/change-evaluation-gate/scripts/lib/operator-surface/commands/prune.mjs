import { confirmEvidencePrune, previewEvidencePrune } from '../../lifecycle.mjs';
import { resolveClone } from '../clone.mjs';
import { mutation } from '../outcomes.mjs';

/** `gate prune` — preview exactly what a prune would remove, and remove it on confirmation. */
export const operatePrune = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const clone = await resolveClone({ repositoryRoot, environment, command: 'prune' });

  if (clone.failed) {
    return clone.failed;
  }

  const preview = await previewEvidencePrune({ evidenceStore: clone.store, selector });

  if (confirmation === null) {
    return {
      command: 'prune',
      // A preview is never bad news. What it names may be a lot of evidence,
      // and that is information, not a fault.
      healthy: true,
      observation: preview,
      mutation: null,
    };
  }

  const result = await confirmEvidencePrune({
    evidenceStore: clone.store,
    preview,
    confirmation,
  });

  return {
    command: 'prune',
    healthy: result.pruned === true,
    observation: preview,
    mutation: mutation({
      confirmation,
      performed: result.pruned === true,
      reasonCode: result.reasonCode,
      removed: result.removed ?? [],
      reclaimedBytes: result.reclaimedBytes ?? 0,
      preserved: result.preserved ?? [],
      summary: result.pruned === true
        ? `${(result.removed ?? []).length} previewed blob(s) were removed, ${result.reclaimedBytes} byte(s) reclaimed, and a tombstone written for each; ${(result.preserved ?? []).join(', ')} were preserved.`
        : `Nothing was removed (${result.reasonCode}): ${result.reason ?? 'the confirmation did not reproduce a preview of this store.'}`,
    }),
  };
};
