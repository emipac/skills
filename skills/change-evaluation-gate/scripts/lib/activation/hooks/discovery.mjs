import { AUTHORITATIVE_HOOK } from './constants.mjs';
import { managedBlockIn } from './content.mjs';
import { existingHook } from './files.mjs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** The directory a Husky-managed clone keeps its project hooks in. */
const MANAGED_HOOK_DIRECTORY = '.husky';

/**
 * Hook managers whose integration point is a declaration rather than a file the
 * gate could add. Editing somebody's `lefthook.yml` on their behalf is exactly
 * the silent change SG-HOOK-001 forbids, so these require manual registration.
 */
const DECLARATIVE_HOOK_MANAGERS = Object.freeze([
  { id: 'lefthook', files: ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml'] },
  { id: 'pre-commit', files: ['.pre-commit-config.yaml', '.pre-commit-config.yml'] },
]);

/** Interpreters whose scripts the gate can safely compose a `/bin/sh` block into. */
const COMPOSABLE_INTERPRETERS = /^#!\s*\S*\/(?:env\s+)?(?:sh|bash|dash|ksh|zsh)\b/;

/**
 * Find this clone's hook manager, if it has one.
 *
 * Detection is by layout only: no manager is executed, no network is touched,
 * and an absent manager is an ordinary answer rather than a failure. It is a
 * dependency so a fixture can state exactly which manager it is standing in.
 */
export const detectHookManager = async ({ repositoryRoot, hooksPath }) => {
  if (hooksPath?.configured && !hooksPath.shared) {
    // Husky owns `.husky`. From v9 Git is pointed at the generated `_` runner
    // directory inside it, which is the manager's own file to write; either way
    // the manager's integration point for a project hook is `.husky` itself.
    const directory = hooksPath.directory;
    const candidate = path.basename(directory) === '_' ? path.dirname(directory) : directory;

    if (path.basename(candidate) === MANAGED_HOOK_DIRECTORY) {
      const stats = await stat(candidate).catch(() => null);

      if (stats?.isDirectory()) {
        return { id: 'husky', registration: 'managed-directory', directory: candidate, configuration: null };
      }
    }
  }

  for (const manager of DECLARATIVE_HOOK_MANAGERS) {
    for (const file of manager.files) {
      const stats = await stat(path.join(repositoryRoot, file)).catch(() => null);

      if (stats?.isFile()) {
        return { id: manager.id, registration: 'declarative', directory: null, configuration: file };
      }
    }
  }

  return null;
};

const samePath = async (left, right) => {
  const resolve = async (value) => realpath(value).catch(() => path.resolve(value));

  return (await resolve(left)) === (await resolve(right));
};

/**
 * Where this clone's hooks actually live, and whether that location is this
 * clone's own business.
 *
 * A `core.hooksPath` that comes from anywhere but this clone's own
 * configuration file governs other repositories too. Activation will not
 * register into it and will not rewrite the setting to escape it: the operator
 * resolves that themselves (SG-HOOK-001).
 */
export const resolveHooksPath = async ({ repositoryRoot, gitCommonDirectory, runGit }) => {
  const raw = await runGit(repositoryRoot, ['config', '--show-origin', '--get', 'core.hooksPath'])
    .then((stdout) => stdout.trim())
    .catch(() => '');

  if (raw.length === 0) {
    return {
      configured: false,
      value: null,
      origin: null,
      shared: false,
      directory: path.join(gitCommonDirectory, 'hooks'),
    };
  }

  const [origin, value] = raw.split('\t');
  const originPath = origin.startsWith('file:') ? origin.slice('file:'.length) : null;
  const directory = path.resolve(repositoryRoot, value);
  const cloneLocalConfig = path.join(gitCommonDirectory, 'config');
  const fromCloneLocalConfig = originPath !== null
    && await samePath(path.resolve(repositoryRoot, originPath), cloneLocalConfig);
  // Even a clone-local setting is shared when it points outside the clone.
  const insideClone = directory.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`)
    || directory.startsWith(`${gitCommonDirectory}${path.sep}`);

  return {
    configured: true,
    value,
    origin,
    shared: !fromCloneLocalConfig || !insideClone,
    directory,
  };
};

/**
 * Choose the hook composition strategy in the declared order (FR-LIFE-017).
 *
 * The order is not a preference, it is a safety ranking: the manager's own
 * integration point disturbs least, a marker-delimited block inside an existing
 * hook disturbs the surrounding chain not at all but needs the operator to
 * confirm that exact hook, and an owned shim is only ever created where there is
 * no hook to preserve. Every branch that cannot be taken safely carries the
 * reason code the transaction will refuse with; none of them writes anything.
 */
export const resolveHookStrategy = async ({ request, repositoryRoot, gitCommonDirectory, hooksPath, detect }) => {
  const fallbackPath = path.join(hooksPath.directory, AUTHORITATIVE_HOOK);
  const refuse = (fields) => ({
    manager: null,
    strategy: null,
    directory: hooksPath.directory,
    path: fallbackPath,
    existing: null,
    contents: null,
    priorIdentity: null,
    ...fields,
  });

  // A hooks path that governs other repositories is never registered into and
  // never rewritten to escape, whatever else is true of this clone.
  if (hooksPath.shared) {
    return refuse({
      action: 'refuse-shared-hooks-path',
      ownership: 'gate-owned-shim',
      reasonCode: 'hooks-path-shared',
      errors: [hooksPath],
    });
  }

  const manager = await detect({ repositoryRoot, gitCommonDirectory, hooksPath });

  if (manager?.registration === 'declarative') {
    return refuse({
      manager,
      action: 'refuse-hook-manager-manual',
      ownership: 'native-hook-manager',
      reasonCode: 'hook-manager-manual-registration',
      errors: [{ manager: manager.id, configuration: manager.configuration }],
    });
  }

  const native = manager?.registration === 'managed-directory';
  const directory = native ? manager.directory : hooksPath.directory;
  const hookPath = path.join(directory, AUTHORITATIVE_HOOK);
  const found = await existingHook(hookPath);
  const ownership = native ? 'native-hook-manager' : 'gate-owned-shim';
  const base = {
    manager: manager ?? null,
    directory,
    path: hookPath,
    existing: found?.descriptor ?? null,
    contents: found?.contents ?? null,
    priorIdentity: found?.descriptor.identity ?? null,
    errors: [],
  };

  if (found === null) {
    return {
      ...base,
      strategy: native ? 'native-hook-manager' : 'gate-owned-shim',
      action: native ? 'create-native-registration' : 'create-owned-shim',
      ownership,
      reasonCode: null,
    };
  }

  // Gate-owned content already inside somebody's hook is never quietly reused,
  // repaired, or replaced. The operator resolves it (AC-LIFE-003).
  const block = managedBlockIn(found.contents);

  if (block.present) {
    return {
      ...base,
      strategy: null,
      action: 'refuse-marker-drift',
      ownership: 'marker-delimited-block',
      reasonCode: 'hook-marker-drift',
      errors: [{
        path: hookPath,
        marker: block.wellFormed ? 'already-registered' : 'unbalanced',
        resolution: 'manual',
      }],
    };
  }

  const confirmation = request.hookConfirmation ?? null;

  if (confirmation === null) {
    return {
      ...base,
      strategy: null,
      action: 'refuse-existing-hook',
      ownership,
      reasonCode: 'hook-exists',
      errors: [found.descriptor],
    };
  }

  // A confirmation is for one exact hook, as the operator read it. A hook edited
  // since then is a different hook and has to be looked at again.
  if (confirmation.strategy !== 'marker-delimited-block'
    || path.resolve(confirmation.path ?? '') !== hookPath
    || confirmation.hookIdentity !== found.descriptor.identity) {
    return {
      ...base,
      strategy: null,
      action: 'refuse-existing-hook',
      ownership,
      reasonCode: 'hook-confirmation-mismatch',
      errors: [{
        expected: {
          strategy: 'marker-delimited-block',
          path: hookPath,
          hookIdentity: found.descriptor.identity,
        },
        actual: {
          strategy: confirmation.strategy ?? null,
          path: confirmation.path ?? null,
          hookIdentity: confirmation.hookIdentity ?? null,
        },
      }],
    };
  }

  // The block is `/bin/sh`. Composing it into a hook written in something else
  // would break the chain rather than preserve it.
  if (!COMPOSABLE_INTERPRETERS.test(found.contents)) {
    return {
      ...base,
      strategy: null,
      action: 'refuse-uncomposable-chain',
      ownership,
      reasonCode: 'hook-chain-uncomposable',
      errors: [{ path: hookPath, resolution: 'manual' }],
    };
  }

  return {
    ...base,
    strategy: 'marker-delimited-block',
    action: 'compose-marker-block',
    ownership: 'marker-delimited-block',
    reasonCode: null,
  };
};
