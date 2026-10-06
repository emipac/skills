import { openCoordinationLock } from '../../coordination.mjs';
import { inspectCoordination } from '../../lifecycle.mjs';
import { resolveClone } from '../clone.mjs';
import { mutation } from '../outcomes.mjs';

/** `gate locks` — inspect the coordination lock, and recover one stale lock on confirmation. */
export const operateLocks = async ({ repositoryRoot, environment, confirmation }) => {
  const inspection = await inspectCoordination({ repositoryRoot });
  const observation = {
    ...inspection,
    // The recovery token IS this command's confirmation token; naming it twice
    // would be two tokens for one decision.
    confirmationToken: inspection.recoveryToken,
  };

  if (confirmation === null) {
    return {
      command: 'locks',
      // A lock nobody is holding and a lock somebody is really holding are both
      // fine. Only a stale one is a clone that needs an operator.
      healthy: !(inspection.held && inspection.stale),
      observation,
      mutation: null,
    };
  }

  const clone = await resolveClone({ repositoryRoot, environment, command: 'locks' });

  if (clone.failed) {
    return clone.failed;
  }

  // The lock seam re-inspects and checks the token itself, so a live holder is
  // never taken and a confirmation that was never shown this lock recovers
  // nothing — and it audits both outcomes through the store it is given.
  const lock = await openCoordinationLock({ repositoryRoot, store: clone.store });
  const recovery = await lock.recoverStale({ confirmation });

  return {
    command: 'locks',
    healthy: recovery.recovered === true,
    observation,
    mutation: mutation({
      confirmation,
      performed: recovery.recovered === true,
      reasonCode: recovery.reasonCode,
      recoveredPath: recovery.recoveredPath ?? null,
      summary: recovery.recovered === true
        ? `The stale lock was recovered and its record preserved at ${recovery.recoveredPath}.`
        : `Nothing was recovered (${recovery.reasonCode}): ${recovery.detail}`,
    }),
  };
};
