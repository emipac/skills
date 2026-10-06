import { desktopCommandFor } from '../adapters/registration.mjs';
import { AUTHORITATIVE_HOOK } from '../hooks/constants.mjs';
import { hookBlockIdentity, plannedHookRegistration } from '../hooks/content.mjs';
import { readHookRegistration } from '../hooks/observation.mjs';
import { receiptLineageOf } from '../receipts.mjs';
import { reconcileAdapterRegistration } from '../../adapter-registration.mjs';

/**
 * The gate-owned Git registration a sync keeps, as it is on disk now.
 *
 * `intact` is the receipt's own test — the pinned block identity, naming a
 * receipt this activation issued. `reproducible` is the test that makes keeping
 * it honest: the registration this sync would write for the hook program it is
 * given is the registration already there, byte for byte once the receipt-id
 * line is elided. A sync never writes it either way (`TB-062`).
 */
export const keptHookRegistration = async ({ prior, request }) => {
  const chain = prior?.hookChain ?? {};
  const ownership = chain.strategy
    ?? prior?.hooks?.find((hook) => hook?.hook === AUTHORITATIVE_HOOK)?.ownership
    ?? 'gate-owned-shim';
  const registration = typeof chain.path === 'string' && chain.path !== ''
    ? await readHookRegistration(chain.path, ownership)
    : { present: false, wellFormed: true, blockIdentity: null, receiptId: null };
  let planned = null;

  try {
    planned = plannedHookRegistration({
      strategy: chain.strategy ?? ownership,
      hook: AUTHORITATIVE_HOOK,
      program: request.runtime?.hookProgram ?? null,
      repositoryRoot: request.repository.root,
    });
  } catch {
    planned = null;
  }

  const pinned = chain.blockIdentity ?? null;

  return {
    hook: AUTHORITATIVE_HOOK,
    path: chain.path ?? null,
    ownership,
    blockIdentity: registration.blockIdentity ?? null,
    receiptId: registration.receiptId ?? null,
    intact: pinned !== null
      && registration.present === true
      && registration.wellFormed === true
      && registration.blockIdentity === pinned
      && receiptLineageOf(prior).includes(registration.receiptId),
    reproducible: pinned !== null && planned !== null && hookBlockIdentity(planned) === pinned,
    action: 'keep',
  };
};

/**
 * Every client-file registration a sync keeps, reconciled through the adapter's
 * own declaration, and whether it is the entry this sync would write.
 */
export const keptAdapterRegistrations = async ({ prior, request }) => {
  const kept = [];

  for (const adapter of prior?.adapters ?? []) {
    const registration = adapter?.registration ?? null;

    if (registration?.kind !== 'client-configuration-file') {
      continue;
    }

    const observed = await reconcileAdapterRegistration({
      adapterId: adapter.id,
      repositoryRoot: request.repository.root,
      registration,
    });
    let command = null;

    try {
      command = desktopCommandFor(request, adapter.id);
    } catch {
      command = null;
    }

    const state = observed?.state ?? 'unverified';
    const reproducible = command !== null && command === registration.command;

    kept.push({
      adapter: adapter.id,
      path: registration.path ?? null,
      entryIdentity: registration.entryIdentity ?? null,
      state,
      reproducible,
      intact: registration.registered === true && state === 'registered' && reproducible,
      detail: observed?.detail ?? null,
      action: 'keep',
    });
  }

  return kept;
};
