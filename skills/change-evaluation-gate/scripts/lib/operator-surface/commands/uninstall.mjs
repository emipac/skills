import { contentIdentity } from '../../evidence-store.mjs';
import { SHARED_CONFIGURATION_FILE, uninstallGate } from '../../lifecycle.mjs';
import { resolveClone } from '../clone.mjs';
import { UNINSTALL_PRESERVES } from '../constants.mjs';
import { instructionSelectors, mismatchExplanation } from '../instructions.mjs';
import { mutation, recordSurfaceRefusal } from '../outcomes.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * What one uninstall would remove, re-derived from the files themselves.
 *
 * The Activation receipt records no asset manifest — nothing in an activated
 * clone knows which project files an installer put there — so the operator
 * names them, and this states exactly what is at those paths right now. A file
 * edited between the preview and the confirmation changes its identity here and
 * the token stops reproducing; a file the Gate must never touch is refused by
 * `uninstallGate` itself, whichever paths were named.
 */
const uninstallPreview = async ({ repositoryRoot, assets, configurationPath }) => {
  const described = [];

  for (const asset of assets ?? []) {
    const resolved = path.resolve(repositoryRoot, asset);
    const contents = await readFile(resolved, 'utf8').catch(() => null);

    described.push({
      path: resolved,
      present: contents !== null,
      identity: contents === null ? null : contentIdentity(contents),
    });
  }

  const body = {
    assets: described,
    configurationPath,
    preserved: [...UNINSTALL_PRESERVES],
  };

  return { ...body, confirmationToken: contentIdentity(body) };
};

/** `gate uninstall` — remove only unchanged project-installed assets, after deactivation. */
export const operateUninstall = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const configurationPath = path.join(repositoryRoot, SHARED_CONFIGURATION_FILE);
  const observation = await uninstallPreview({
    repositoryRoot,
    assets: selector.assets,
    configurationPath,
  });

  if (confirmation === null) {
    return { command: 'uninstall', healthy: true, observation, mutation: null };
  }

  const clone = await resolveClone({
    repositoryRoot,
    environment,
    command: 'uninstall',
    // Uninstall is the one command that REQUIRES no receipt: an activated clone
    // is never uninstalled out from under its own authoritative hook, and
    // `uninstallGate` is the seam that says so.
    receiptRequired: false,
  });

  if (clone.failed) {
    return clone.failed;
  }

  if (confirmation !== observation.confirmationToken) {
    await recordSurfaceRefusal({
      evidenceStore: clone.store,
      type: 'removal',
      before: confirmation,
      reason: 'preview-mismatch: the confirmation did not reproduce the uninstall preview its token names; nothing was removed.',
    });

    return {
      command: 'uninstall',
      healthy: false,
      observation,
      mutation: mutation({
        confirmation,
        performed: false,
        reasonCode: 'preview-mismatch',
        expected: observation.confirmationToken,
        summary: `Nothing was removed (preview-mismatch): ${mismatchExplanation('uninstall', instructionSelectors('uninstall', selector))}`,
      }),
    };
  }

  const result = await uninstallGate({
    evidenceStore: clone.store,
    repositoryRoot,
    configurationPath,
    assets: observation.assets.map(({ path: assetPath, identity }) => ({
      path: assetPath,
      identity,
    })),
  });

  return {
    command: 'uninstall',
    healthy: result.uninstalled === true,
    observation,
    mutation: mutation({
      confirmation,
      performed: result.uninstalled === true,
      reasonCode: result.reasonCode,
      removed: result.removed,
      refused: result.refused,
      preserved: result.preserved,
      errors: result.errors ?? [],
      summary: result.uninstalled === true
        ? `${result.removed.length} unchanged project-installed asset(s) were removed; ${result.preserved.join(', ')} were preserved.`
        : `Nothing was removed (${result.reasonCode}); one refusal refuses the whole uninstall rather than leaving a maintainer with partial success.`,
    }),
  };
};
