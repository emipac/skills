import { HOOK_BLOCK_END } from './constants.mjs';
import { managedBlockIn } from './content.mjs';
import { publishHook } from './files.mjs';
import { readHookRegistration } from './observation.mjs';
import { contentIdentity } from '../../evidence-store.mjs';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Withdraw a gate-owned registration using only what a receipt durably pins.
 *
 * Rollback inside a transaction can bind to its in-flight journal. Removal
 * cannot: `gate deactivate` runs in a later process, possibly on a later day,
 * and has nothing but the published receipt. It therefore proves ownership from
 * the durable identities instead — the registration's own content identity and
 * the receipt id it names — and, for a composed block, that removing it really
 * does reproduce the chain the activation promised to preserve.
 *
 * Every mismatch is reported, never repaired and never forced. `dryRun` answers
 * the same question without touching the file, so a caller can prove every
 * registration is safe to remove before it removes the first one (FR-LIFE-010,
 * SG-HOOK-001, SG-LIFE-001).
 */
export const withdrawHookRegistration = async ({
  path: hookPath,
  directory = null,
  ownership = 'gate-owned-shim',
  blockIdentity = null,
  receiptId = null,
  // Every receipt id this clone has issued for this activation, newest first.
  // An update rewrites the receipt but not the registration, so the block goes
  // on naming the receipt that authorized it; all of them are ours.
  acceptedReceiptIds = null,
  priorIdentity = null,
  dryRun = false,
}) => {
  const refuse = (reason) => ({ removable: false, removed: false, reason });
  const accepted = acceptedReceiptIds === null
    ? (receiptId === null ? [] : [receiptId])
    : acceptedReceiptIds.filter((id) => typeof id === 'string' && id.length > 0);

  const contents = await readFile(hookPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (contents === null) {
    return refuse('already-absent');
  }

  const registration = await readHookRegistration(hookPath, ownership);

  if (!registration.present) {
    return refuse('registration-absent');
  }

  if (!registration.wellFormed) {
    return refuse('registration-malformed');
  }

  // Ownership is proved by the pinned block identity when the receipt has one.
  // A receipt written before that field existed pins nothing, so the marker the
  // gate wrote into the block — one of our own receipt ids — is the proof
  // instead. Without either, nothing shows the gate wrote this file.
  const namesOurReceipt = accepted.length > 0 && accepted.includes(registration.receiptId);

  if (blockIdentity === null) {
    if (!namesOurReceipt) {
      return refuse('unknown-registration');
    }
  } else if (registration.blockIdentity !== blockIdentity) {
    return refuse('registration-drifted');
  } else if (accepted.length > 0 && !namesOurReceipt) {
    return refuse('receipt-mismatch');
  }

  const composed = ownership === 'marker-delimited-block';
  let restored = null;

  if (composed) {
    const found = managedBlockIn(contents);

    restored = contents.slice(0, found.begin)
      + contents.slice(found.end + HOOK_BLOCK_END.length + 1);

    if (priorIdentity !== null && contentIdentity(restored) !== priorIdentity) {
      // Removing the block would not give back the hook that was there. The
      // surrounding chain is somebody else's, so it stays exactly as it is.
      return refuse('chain-not-restorable');
    }
  }

  if (dryRun) {
    return { removable: true, removed: false, reason: null };
  }

  if (composed) {
    await publishHook({
      path: hookPath,
      directory: directory ?? path.dirname(hookPath),
      contents: restored,
      mode: (await stat(hookPath)).mode & 0o777,
    });
  } else {
    await rm(hookPath, { force: true });
  }

  return { removable: true, removed: true, reason: null };
};
