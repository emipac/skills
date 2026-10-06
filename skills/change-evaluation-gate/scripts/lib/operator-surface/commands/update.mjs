import { PROTOCOL_VERSION } from '../../evaluation-contract.mjs';
import { inspectRelease, previewUpdate, updateGate } from '../../lifecycle.mjs';
import { resolveClone } from '../clone.mjs';
import { mutation } from '../outcomes.mjs';
import { installedDistribution } from '../runtime.mjs';

/** `gate update` — take the installed distribution's release, and only on confirmation. */
export const operateUpdate = async ({ repositoryRoot, environment, confirmation }) => {
  const clone = await resolveClone({ repositoryRoot, environment, command: 'update' });

  if (clone.failed) {
    return clone.failed;
  }

  const distribution = await installedDistribution();
  const candidate = {
    id: clone.receipt?.runtime?.gate?.id ?? null,
    version: distribution.version,
    // What the installed gate actually speaks. A candidate that speaks a
    // different protocol than the receipt pinned is refused at `compatibility`
    // rather than absorbed in place, which is the seam's judgement, not this
    // surface's.
    protocolVersion: PROTOCOL_VERSION,
  };
  const release = inspectRelease({ receipt: clone.receipt, distribution: candidate });
  const preview = previewUpdate({ receipt: clone.receipt, candidate, migrations: [] });
  const observation = {
    active: release.active,
    candidate: release.candidate,
    candidateAvailable: release.candidateAvailable,
    // Reading a newer distribution is not taking it, and this states so on
    // every document rather than only in prose (`FR-LIFE-014`).
    advancesActiveRelease: false,
    distribution,
    migrations: preview.migrations,
    // This surface reruns no self-test of its own: `updateGate`'s defaults are
    // the library's, and reporting an injected pass as a proof would be a claim
    // the clone cannot support. `gate status` is what reconciles it afterwards.
    selfTestsRerun: false,
    action: release.action,
    confirmationToken: preview.previewId,
  };

  if (confirmation === null) {
    return { command: 'update', healthy: true, observation, mutation: null };
  }

  const result = await updateGate({
    evidenceStore: clone.store,
    candidate,
    migrations: [],
    confirmation,
  });

  return {
    command: 'update',
    healthy: result.updated === true,
    observation,
    mutation: mutation({
      confirmation,
      performed: result.updated === true,
      reasonCode: result.reasonCode,
      step: result.step,
      order: result.order,
      state: result.state,
      release: result.release,
      receiptId: result.receipt?.receiptId ?? null,
      rollback: result.rollback,
      errors: result.errors ?? [],
      summary: result.updated === true
        ? `The Active gate release advanced from ${result.release.from?.version ?? 'none'} to ${result.release.to?.version ?? 'none'} by one atomic receipt write.`
        : `The update failed at ${result.step} (${result.reasonCode}); the previous Active gate release ${result.release.from?.version ?? 'none'} is preserved unchanged.`,
    }),
  };
};
