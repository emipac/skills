import { openCoordinationLock } from '../coordination.mjs';

/**
 * `gate locks` — the operator surface over TB-009's coordination lock.
 *
 * Inspection reads and judges. It never acquires the lock, never recovers a
 * stale one, and never removes another holder's record: recovery stays the
 * explicit, confirmation-bound operation TB-009 made it, and this command only
 * reports whether one is available (FR-COORD-005, SG-LIFE-001).
 */
export const inspectCoordination = async ({
  repositoryRoot = null,
  gitCommonDirectory = null,
  runGit = undefined,
  staleAfterMs = undefined,
} = {}) => {
  const lock = await openCoordinationLock({
    repositoryRoot,
    gitCommonDirectory,
    ...(runGit === undefined ? {} : { runGit }),
    ...(staleAfterMs === undefined ? {} : { staleAfterMs }),
  });
  const inspection = await lock.inspect();

  return {
    lockPath: lock.lockPath,
    gitCommonDirectory: lock.gitCommonDirectory,
    held: inspection.held,
    stale: inspection.stale,
    staleReasons: inspection.staleReasons,
    liveness: inspection.liveness,
    holder: inspection.record,
    recoveryToken: inspection.recoveryToken,
    // Observation only. Both of these are always false here, by construction.
    acquired: false,
    recovered: false,
    // A live holder is nobody's to take. Only a stale one may be recovered, and
    // only by an operator who reproduces the token above.
    action: inspection.held && inspection.stale ? 'gate locks --recover' : null,
  };
};
