import { cloneShortcut } from '../../activation-seams.mjs';
import { confirmRepair, previewRepair } from '../../lifecycle.mjs';
import { observedAdapters, resolveClone } from '../clone.mjs';
import { namedConfigurationDrift, observeStatusControlSurface } from './status.mjs';
import { runGit } from '../git.mjs';
import { mutation } from '../outcomes.mjs';
import { PACKAGED_HOOK_PROGRAM } from '../runtime.mjs';
import { nextRemedies } from '../../remedies.mjs';

/** `gate repair` — restore drifted gate-owned registrations to what the receipt authorizes. */
export const operateRepair = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const clone = await resolveClone({
    repositoryRoot,
    environment,
    command: 'repair',
    consentChannel: confirmation === null ? null : selector.consentChannel,
  });

  if (clone.failed) {
    return clone.failed;
  }

  const runtime = {
    hookProgram: {
      interpreter: process.execPath,
      script: selector.hookScript ?? PACKAGED_HOOK_PROGRAM,
      args: [],
    },
  };
  // The same observation status reconciles, so a clone whose configuration,
  // descriptors, or receipt drifted is told so here, and told what does
  // recover it, rather than hearing `nothing to repair` (`TB-065`). It is
  // reported, never repaired: what repair restores is unchanged (`AC-LIFE-010`).
  const surface = clone.receipt === null
    ? null
    : await observeStatusControlSurface({ repositoryRoot, receipt: clone.receipt });
  const preview = await previewRepair({
    evidenceStore: clone.store,
    repositoryRoot,
    runtime,
    adapters: observedAdapters(clone.receipt),
    controlSurface: surface?.observed ?? null,
  });
  const unrepairable = surface === null
    ? preview.unrepairable
    : preview.unrepairable.map((finding) => namedConfigurationDrift(finding, {
      repositoryRoot,
      configuration: surface.configuration,
    }));
  const observation = {
    health: preview.status,
    receiptId: preview.receiptId,
    actions: preview.actions,
    // Adapter loss is a reinstall, not a repair. The seam already separates the
    // two and this reports its answer rather than re-deciding it (`RISK-004`).
    unrepairable,
    hookProgram: runtime.hookProgram,
    confirmationToken: preview.confirmationToken,
    // What recovers everything repair will not touch, from the one remedy
    // table status reads (`NFR-OPER-001`, `TB-065`).
    next: nextRemedies(unrepairable, await cloneShortcut({ repositoryRoot, runGit: (args) => runGit(repositoryRoot, args) })),
  };

  if (confirmation === null) {
    return { command: 'repair', healthy: true, observation, mutation: null };
  }

  const result = await confirmRepair({
    evidenceStore: clone.store,
    repositoryRoot,
    runtime,
    preview,
    confirmation,
  });

  return {
    command: 'repair',
    healthy: result.repaired === true,
    observation,
    mutation: mutation({
      confirmation,
      performed: result.repaired === true,
      reasonCode: result.reasonCode,
      actions: result.actions,
      errors: result.errors ?? [],
      summary: result.repaired === true
        ? `${result.actions.length} gate-owned registration(s) were restored to exactly what the Activation receipt authorizes.`
        : `Nothing was repaired (${result.reasonCode}); the observed drift was left exactly as it was found.`,
    }),
  };
};
