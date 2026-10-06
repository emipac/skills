

export const releaseOf = (gate) => (gate === null || gate === undefined ? null : {
  id: gate.id ?? null,
  version: gate.version ?? null,
  protocolVersion: gate.protocolVersion ?? null,
});

/** The Active gate release one receipt pins. */
export const activeRelease = (receipt) => releaseOf(receipt?.runtime?.gate ?? null);

/**
 * What an ordinary distribution makes available.
 *
 * A newer installed skill, plugin, or package is a *candidate* and nothing
 * more: this function reads a receipt and a distribution and reports the
 * difference. It writes nothing and advances nothing (FR-LIFE-014,
 * AC-LIFE-007).
 */
export const inspectRelease = ({ receipt = null, distribution = null } = {}) => {
  const active = activeRelease(receipt);
  const candidate = releaseOf(distribution);
  const available = candidate !== null
    && (active === null || candidate.version !== active.version);

  return {
    active,
    candidate,
    candidateAvailable: available,
    // Naming the command is the whole point: nothing else advances the release.
    advancesActiveRelease: false,
    action: available ? 'gate update' : null,
  };
};
