import { quotedProgram } from '../hooks/content.mjs';
import { registerAdapterSurface, withdrawAdapterRegistration } from '../../adapter-registration.mjs';
import { describeAdapter } from '../../adapters.mjs';
import path from 'node:path';

/**
 * The command one desktop surface would run.
 *
 * Desktop registration points at the packaged preflight program when the
 * pinned hook program is `gate-precommit.mjs`, and at the fixture program
 * otherwise. Every command names the adapter it is answering so an
 * unreadable payload can still be returned through that adapter's declared
 * feedback channel. A program the gate cannot safely quote yields no
 * command, and a registration without one refuses rather than inventing one.
 *
 * Stated once, because `gate sync` has to know whether the registration it is
 * keeping is the one this activation would write (`TB-062`).
 */
export const desktopCommandFor = (request, adapterId) => {
  const hookProgram = request.runtime?.hookProgram ?? null;
  const preflightProgram = request.runtime?.preflightProgram ?? (
    hookProgram !== null && path.basename(hookProgram.script ?? '') === 'gate-precommit.mjs'
      ? {
        ...hookProgram,
        script: path.join(path.dirname(hookProgram.script), 'gate-preflight.mjs'),
      }
      : hookProgram
  );

  return quotedProgram({
    program: {
      ...preflightProgram,
      args: [...(preflightProgram?.args ?? []), '--adapter', adapterId],
    },
    repositoryRoot: request.repository.root,
  });
};

/**
 * Register one selected adapter in the surface that adapter declares.
 *
 * This is the whole of activation's knowledge of desktop registration: which
 * clone it is in and which command it should run. Which file, which container,
 * which block schema, which event-key casing, and whether the format carries
 * its own version all come from the adapter's declaration (FR-ADAPT-008).
 */
export const registerDeclaredSurface = async (adapter, { repository, command }) => registerAdapterSurface({
  adapterId: adapter.id,
  repositoryRoot: repository.root,
  command,
});

/**
 * Withdraw one registration this transaction wrote — and only that.
 *
 * The compensating action is the mirror of the registration: it takes back the
 * one entry the transaction added, when that entry is still exactly what was
 * written, and leaves every other byte of the client's file alone.
 */
export const withdrawDeclaredSurface = async (adapter, { repository, registration }) => (
  withdrawAdapterRegistration({
    adapterId: adapter.id,
    repositoryRoot: repository.root,
    registration,
  })
);

/**
 * The client review that follows a registration this transaction just wrote.
 *
 * Some clients review a registration only AFTER reading it — one v1 surface
 * skips a non-managed command hook until its exact definition is reviewed and
 * trusted in that client — which is after the write the trust step would have
 * been blocking. So it is recorded rather than awaited, and here, on the entry
 * for the registration it is about, because that is what `gate status` re-reads
 * and what a maintainer opens to find out what this activation actually did.
 *
 * Every word of it comes from the adapter's own declaration: this function
 * names no client and reads no client-specific field (`SG-OWNER-001`). It
 * states what the client will do next and claims nothing about whether the
 * client has accepted anything — the Gate only wrote the entry (`SG-TRUST-001`,
 * `FR-LIFE-004`).
 */
export const pendingClientReview = (adapterId) => {
  const declared = describeAdapter(adapterId)?.capabilities?.trust?.clientReview ?? null;

  return declared === null
    ? null
    : {
      when: declared.when,
      mechanism: declared.mechanism,
      // Nothing observed it. The Gate wrote a registration; whether the client
      // has reviewed it is the client's to know.
      observedByGate: false,
      detail: declared.detail,
    };
};

/**
 * What a receipt pins about one adapter registration.
 *
 * Only a registration in a client-owned configuration file is pinned here. An
 * adapter that registers through this clone's own hook chain is already pinned
 * by the receipt's `hookChain`, and an injected fixture seam that returns
 * something else pins nothing at all rather than a guess at its meaning.
 */
export const pinnedRegistration = (result) => (
  result?.kind === 'client-configuration-file'
    ? {
      kind: result.kind,
      path: result.path ?? null,
      eventKey: result.eventKey ?? null,
      blockSchema: result.blockSchema ?? null,
      command: result.command ?? null,
      entryIdentity: result.entryIdentity ?? null,
      // What the registration had to add around its own entry, so a later
      // removal returns the client's file to the shape its owner wrote.
      created: result.created ?? null,
      registered: result.registered === true,
      confirmed: result.confirmed === true,
      // A surface the transaction could not confirm is pinned as `unverified`,
      // so the receipt records what the clone actually has rather than what was
      // selected (FR-ADAPT-008, AC-ADAPT-003).
      state: result.registered === true ? 'registered' : 'unverified',
      reason: result.reason ?? null,
    }
    : null
);
