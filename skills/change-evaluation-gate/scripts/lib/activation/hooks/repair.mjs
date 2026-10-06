import { AUTHORITATIVE_HOOK, HOOK_BLOCK_END, HOOK_RECEIPT_PLACEHOLDER } from './constants.mjs';
import { composeManagedBlock, hookBlockIdentity, managedBlockIn, plannedHookRegistration } from './content.mjs';
import { publishHook } from './files.mjs';
import { contentIdentity } from '../../evidence-store.mjs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Restore a gate-owned registration to exactly what the receipt authorizes.
 *
 * This is the *only* write that recovers from drift, and it is reached only by
 * an explicit, confirmed `gate repair` — never by status and never by an
 * ordinary update (FR-LIFE-019).
 *
 * It refuses unless the registration it is about to write reproduces the
 * durable identity the receipt pinned, and — for a composed block — unless the
 * surrounding chain is still the chain the activation promised to preserve. A
 * repair that would take over somebody else's hook is not a repair
 * (SG-HOOK-001, SG-LIFE-001).
 */
export const restoreHookRegistration = async ({
  path: hookPath,
  directory = null,
  hook = AUTHORITATIVE_HOOK,
  ownership = 'gate-owned-shim',
  program = null,
  repositoryRoot = null,
  receiptId = null,
  blockIdentity = null,
  priorIdentity = null,
  dryRun = false,
}) => {
  const refuse = (reason) => ({ restorable: false, restored: false, reason });

  if (blockIdentity === null || receiptId === null) {
    return refuse('unknown-registration');
  }

  let planned = null;

  try {
    planned = plannedHookRegistration({ strategy: ownership, hook, program, repositoryRoot });
  } catch (error) {
    return refuse('program-unquotable');
  }

  // The registration this repair would write must be the registration the
  // receipt authorized. Anything else is a new activation, not a repair.
  if (hookBlockIdentity(planned) !== blockIdentity) {
    return refuse('registration-not-reproducible');
  }

  const authorized = planned.split(HOOK_RECEIPT_PLACEHOLDER).join(receiptId);
  const composed = ownership === 'marker-delimited-block';
  const contents = await readFile(hookPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (!composed) {
    if (dryRun) {
      return { restorable: true, restored: false, reason: null };
    }

    await publishHook({
      path: hookPath,
      directory: directory ?? path.dirname(hookPath),
      contents: authorized,
      mode: 0o755,
    });

    return { restorable: true, restored: true, reason: null };
  }

  if (contents === null) {
    // There is no chain left to compose into, and inventing one would create a
    // hook this repair cannot claim to have preserved.
    return refuse('chain-absent');
  }

  const found = managedBlockIn(contents);

  if (found.present && !found.wellFormed) {
    return refuse('registration-malformed');
  }

  const chain = found.present
    ? contents.slice(0, found.begin) + contents.slice(found.end + HOOK_BLOCK_END.length + 1)
    : contents;

  if (priorIdentity !== null && contentIdentity(chain) !== priorIdentity) {
    return refuse('chain-not-restorable');
  }

  if (dryRun) {
    return { restorable: true, restored: false, reason: null };
  }

  await publishHook({
    path: hookPath,
    directory: directory ?? path.dirname(hookPath),
    contents: composeManagedBlock(chain, authorized),
    mode: (await stat(hookPath)).mode & 0o777,
  });

  return { restorable: true, restored: true, reason: null };
};
