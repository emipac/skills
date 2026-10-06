import { HOOK_BLOCK_END } from './constants.mjs';
import { composeManagedBlock, managedBlockContents, managedBlockIn, shimContents } from './content.mjs';
import { publishHook } from './files.mjs';
import { contentIdentity } from '../../evidence-store.mjs';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Register the authoritative hook.
 *
 * The file is published by one atomic rename, so a Git invocation racing this
 * write sees either no hook or the whole hook, never half of one
 * (NFR-REL-002). Nothing else in the hook chain is read, moved, or rewritten.
 */
export const registerOwnedHook = async ({ hook, path: hookPath, directory, repositoryRoot, program, receipt }) => {
  if (!program?.interpreter || !program?.script) {
    throw new Error('Activation requires a hook program to register.');
  }

  const contents = shimContents({
    hook,
    program: { ...program, script: path.resolve(repositoryRoot, program.script) },
    receipt,
  });

  await publishHook({ path: hookPath, directory, contents, mode: 0o755 });

  return { path: hookPath, ownership: 'gate-owned-shim', identity: contentIdentity(contents) };
};

/**
 * Withdraw a hook this transaction registered — and only that.
 *
 * If the file no longer matches what was written, somebody else owns it now.
 * Rollback reports that and leaves it in place; it never repairs drift it did
 * not cause (SG-HOOK-001, SG-LIFE-001).
 */
export const removeOwnedHook = async ({ path: hookPath, identity = null }) => {
  if (identity === null) {
    return { removed: false, reason: 'unknown-registration' };
  }

  const contents = await readFile(hookPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (contents === null) {
    return { removed: false, reason: 'already-absent' };
  }

  if (contentIdentity(contents) !== identity) {
    throw new Error(`The registered hook at ${hookPath} changed on disk; rollback left it in place rather than repairing drift it did not cause.`);
  }

  await rm(hookPath, { force: true });

  return { removed: true, reason: null };
};

/**
 * Compose the gate into a hook the repository already had.
 *
 * The surrounding chain is preserved byte for byte: the only change is one
 * clearly delimited block, and the file is re-confirmed immediately before it is
 * written so a hook edited since the operator looked at it is never composed
 * into (FR-LIFE-007, FR-LIFE-017, NFR-COMP-002).
 */
export const registerManagedBlock = async ({
  path: hookPath,
  directory,
  repositoryRoot,
  program,
  receipt,
  existing,
}) => {
  if (!program?.interpreter || !program?.script) {
    throw new Error('Activation requires a hook program to register.');
  }

  const contents = await readFile(hookPath, 'utf8');

  if (contentIdentity(contents) !== existing?.identity) {
    throw new Error(`The hook at ${hookPath} changed after it was confirmed; nothing was composed into it.`);
  }

  const block = managedBlockContents({ program, receipt, repositoryRoot });
  const composed = composeManagedBlock(contents, block);
  const mode = (await stat(hookPath)).mode & 0o777;

  await publishHook({ path: hookPath, directory, contents: composed, mode });

  return {
    path: hookPath,
    ownership: 'marker-delimited-block',
    identity: contentIdentity(composed),
    block: contentIdentity(block),
    priorIdentity: existing.identity,
  };
};

/**
 * Withdraw a composed block — and restore exactly the hook that was there.
 *
 * Both the whole file and the block itself must still be what this transaction
 * wrote, and removing the block must reproduce the preserved chain exactly.
 * Anything else means somebody owns that file now, and rollback says so rather
 * than editing their hook (SG-HOOK-001, SG-LIFE-001).
 */
export const removeManagedBlock = async ({
  path: hookPath,
  directory,
  identity = null,
  block = null,
  priorIdentity = null,
}) => {
  if (identity === null) {
    return { removed: false, reason: 'unknown-registration' };
  }

  const contents = await readFile(hookPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (contents === null) {
    return { removed: false, reason: 'already-absent' };
  }

  if (contentIdentity(contents) !== identity) {
    throw new Error(`The composed hook at ${hookPath} changed on disk; rollback left it in place rather than repairing drift it did not cause.`);
  }

  const found = managedBlockIn(contents);

  if (!found.wellFormed || contentIdentity(found.block) !== block) {
    throw new Error(`The gate-owned block in ${hookPath} changed on disk; rollback left it in place rather than repairing drift it did not cause.`);
  }

  const restored = contents.slice(0, found.begin)
    + contents.slice(found.end + HOOK_BLOCK_END.length + 1);

  if (contentIdentity(restored) !== priorIdentity) {
    throw new Error(`Removing the gate-owned block from ${hookPath} would not restore the hook chain this activation preserved; it was left in place.`);
  }

  await publishHook({
    path: hookPath,
    directory,
    contents: restored,
    mode: (await stat(hookPath)).mode & 0o777,
  });

  return { removed: true, reason: null };
};
