import { hookBlockIdentity, hookRegistrationReceiptId, managedBlockIn } from './content.mjs';
import { readFile } from 'node:fs/promises';

/**
 * Read back a gate-owned registration from disk, without judging it.
 *
 * A composed block is exactly the delimited region; an owned shim is the whole
 * file, because the gate wrote all of it. The caller compares what is returned
 * against what its receipt pinned; nothing here repairs, rewrites, or removes.
 */
export const readHookRegistration = async (hookPath, ownership = 'gate-owned-shim') => {
  const contents = await readFile(hookPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (contents === null) {
    return { present: false, region: null, blockIdentity: null, receiptId: null, wellFormed: true };
  }

  if (ownership !== 'marker-delimited-block') {
    return {
      present: true,
      region: contents,
      blockIdentity: hookBlockIdentity(contents),
      receiptId: hookRegistrationReceiptId(contents),
      wellFormed: true,
    };
  }

  const found = managedBlockIn(contents);

  if (!found.present || !found.wellFormed) {
    return {
      present: found.present,
      region: null,
      blockIdentity: null,
      receiptId: null,
      wellFormed: found.wellFormed,
    };
  }

  return {
    present: true,
    region: found.block,
    blockIdentity: hookBlockIdentity(found.block),
    receiptId: hookRegistrationReceiptId(found.block),
    wellFormed: true,
  };
};
