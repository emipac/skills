import { contentIdentity } from '../evidence-store.mjs';
import { SHARED_CONFIGURATION_FILE } from './constants.mjs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

/**
 * Judge one listed asset without touching it.
 *
 * Every answer other than `null` is a reason the Gate does not own that file,
 * and the reasons are exactly the four things SG-LIFE-001 forbids removing:
 * something outside this project, the shared configuration, historical
 * Evidence, or a file the maintainer has since made their own.
 */
const refuseAsset = async ({ asset, repositoryRoot, configurationPath, storeRoot }) => {
  const resolved = path.resolve(asset?.path ?? '');

  if (!isInside(path.resolve(repositoryRoot), resolved)) {
    // Global and machine-wide assets are shared with every other clone. v1 has
    // no global uninstall, and this is where that promise is kept.
    return { path: resolved, reason: 'asset-outside-project' };
  }

  if (resolved === path.resolve(configurationPath)) {
    return { path: resolved, reason: 'shared-configuration' };
  }

  if (isInside(path.resolve(storeRoot), resolved)) {
    return { path: resolved, reason: 'historical-evidence' };
  }

  const contents = await readFile(resolved, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (contents === null) {
    // Already in the desired state. This is not a safety condition, so it must
    // not refuse the operation the way a modified asset does — otherwise an
    // interrupted uninstall could never be completed on a retry.
    return { path: resolved, reason: 'asset-absent', satisfied: true };
  }

  if (asset?.identity == null || contentIdentity(contents) !== asset.identity) {
    // The installed asset is not the asset that was installed.
    return { path: resolved, reason: 'asset-modified' };
  }

  return null;
};

/**
 * Run one `gate uninstall`.
 *
 * Uninstall is the narrowest removal the Gate has. It requires a prior
 * deactivation — an activated clone is never uninstalled out from under its own
 * authoritative hook — and then removes only project-installed assets that are
 * still byte-for-byte what was installed.
 *
 * Global assets, the shared configuration file, and historical Evidence are
 * refused by construction rather than by convention, and one refusal refuses
 * the whole uninstall: a maintainer who asked to remove five things and got
 * three has been given partial success, which is exactly what SG-LIFE-001
 * forbids (FR-LIFE-011, AC-LIFE-005).
 */
export const uninstallGate = async ({
  evidenceStore = null,
  repositoryRoot = null,
  configurationPath = null,
  assets = [],
} = {}) => {
  const receipt = await evidenceStore?.activationReceipt().read() ?? null;
  const configuration = configurationPath
    ?? path.join(repositoryRoot ?? '.', SHARED_CONFIGURATION_FILE);
  const preserved = ['shared-configuration', 'global-assets', 'historical-evidence'];

  const record = async (result) => {
    if (evidenceStore) {
      await evidenceStore.appendLifecycleEvent({
        type: 'removal',
        before: null,
        after: null,
        outcome: result.uninstalled ? 'succeeded' : 'refused',
        reason: result.uninstalled
          ? `Uninstall removed ${result.removed.length} unchanged project-installed asset(s); the shared configuration, global assets, and all historical Evidence were preserved.`
          : `Uninstall refused (${result.reasonCode}); nothing was removed.`,
      }).catch(() => null);
    }

    return result;
  };

  if (receipt !== null) {
    return record({
      uninstalled: false,
      reasonCode: 'deactivation-required',
      errors: [{
        message: 'An activated clone must be deactivated before its project assets may be removed.',
      }],
      removed: [],
      refused: [],
      preserved,
    });
  }

  const refused = [];
  const alreadyAbsent = new Set();

  for (const asset of assets) {
    const refusal = await refuseAsset({
      asset,
      repositoryRoot,
      configurationPath: configuration,
      storeRoot: evidenceStore?.root ?? path.join(repositoryRoot ?? '.', '.git'),
    });

    if (refusal === null) {
      continue;
    }

    if (refusal.satisfied === true) {
      // Nothing to remove and nothing to protect: skip it and keep going.
      alreadyAbsent.add(refusal.path);

      continue;
    }

    refused.push(refusal);
  }

  if (refused.length > 0) {
    return record({
      uninstalled: false,
      reasonCode: 'asset-refused',
      errors: refused,
      removed: [],
      refused,
      preserved,
    });
  }

  const removed = [];

  for (const asset of assets) {
    const resolved = path.resolve(asset.path);

    if (alreadyAbsent.has(resolved)) {
      continue;
    }

    await rm(resolved, { force: true });
    removed.push({ kind: 'project-asset', path: resolved });
  }

  return record({
    uninstalled: true,
    reasonCode: null,
    errors: [],
    removed,
    refused: [],
    preserved,
  });
};
