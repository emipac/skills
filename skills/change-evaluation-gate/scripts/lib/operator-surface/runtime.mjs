import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** This module's own directory — the installed gate is what runs it. */
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The hook program an activation performed by THIS installed gate would have
 * registered.
 *
 * The Activation receipt pins the registration's durable identity but not the
 * program that produced it, so a repair has to state one. This is the honest
 * default: the packaged pre-commit runner sitting beside this module. A clone
 * activated against some other program is not repaired by guessing — the
 * planned bytes will not reproduce the pinned identity and
 * `restoreHookRegistration` refuses with `registration-not-reproducible`, which
 * is why `--hook-script` exists to name the real one rather than to override a
 * refusal.
 */
export const PACKAGED_HOOK_PROGRAM = path.resolve(HERE, '..', 'gate-precommit.mjs');

/**
 * The release the INSTALLED distribution offers.
 *
 * The gate's own version is not readable from an activated clone's receipt —
 * the receipt records what the caller that ran activation declared — but it IS
 * readable from the distribution running this command, which is the thing an
 * ordinary `npm install` or plugin update actually bumps. The nearest package
 * manifest above this module is that distribution.
 *
 * Reading it makes a candidate visible and nothing else: `inspectRelease` states
 * that it advances no Active gate release, and only a confirmed `gate update`
 * ever does (`FR-LIFE-014`, `AC-LIFE-007`).
 */
export const installedDistribution = async () => {
  let directory = HERE;

  for (let depth = 0; depth < 12; depth += 1) {
    const manifestPath = path.join(directory, 'package.json');
    const manifest = await readFile(manifestPath, 'utf8')
      .then((contents) => JSON.parse(contents))
      .catch(() => null);

    if (manifest !== null && typeof manifest.version === 'string') {
      return { version: manifest.version, manifest: manifestPath };
    }

    const parent = path.dirname(directory);

    if (parent === directory) {
      break;
    }

    directory = parent;
  }

  return { version: null, manifest: null };
};
