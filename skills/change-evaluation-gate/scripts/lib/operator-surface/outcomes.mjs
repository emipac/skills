

export const failure = ({ command = null, reasonCode, detail, ownedBy = null }) => ({
  command,
  failure: { reasonCode, detail, ownedBy },
});

/**
 * Record a refusal this surface decided, as the same Lifecycle event the
 * operation's own seam would have appended.
 *
 * It exists for exactly two operations. `deactivateGate` and `uninstallGate`
 * take no confirmation — every other seam here takes the operator's token
 * itself, refuses against it, and records that refusal — so for those two the
 * comparison happens here, and a refusal that left no record would be the one
 * governed act on this surface that nothing could later prove happened
 * (`NFR-AUD-001`). No new event type, no new store, no parallel log: the
 * operation's own `removal` type, in the clone's own Evidence store, through
 * the store's own append.
 */
export const recordSurfaceRefusal = async ({ evidenceStore, type, before, reason }) => {
  if (!evidenceStore) {
    return null;
  }

  return evidenceStore.appendLifecycleEvent({
    type,
    before,
    after: null,
    outcome: 'refused',
    reason,
  }).catch(() => null);
};

/** One performed-or-refused half of a document, in the one shape every command reports. */
export const mutation = ({ confirmation, performed, reasonCode = null, summary, ...rest }) => ({
  confirmation,
  performed,
  reasonCode: performed ? null : reasonCode,
  summary,
  ...rest,
});
