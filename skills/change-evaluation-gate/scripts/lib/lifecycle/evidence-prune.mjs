

/**
 * `gate prune --preview` — the operator surface over TB-008's pruning seam.
 *
 * TB-008 built the store's preview-and-confirm removal path but deliberately
 * left the operator-facing command to the lifecycle slice, because pruning is a
 * lifecycle operation and shares this module's rules: preview first, confirm
 * against the exact preview, and never delete anything implicitly.
 *
 * This wrapper adds no removal logic of its own — it delegates to the store —
 * and states plainly that a preview removed nothing (FR-EVID-004, SG-EVID-001).
 */
export const previewEvidencePrune = async ({ evidenceStore = null, selector = {} } = {}) => {
  const preview = await evidenceStore.previewPrune(selector);

  return { ...preview, removed: false, action: preview.blobs.length > 0 ? 'gate prune --confirm' : null };
};

/**
 * `gate prune --confirm` — remove exactly what a preview identified.
 *
 * Blobs are the only thing a prune ever removes. Envelopes, decisions,
 * Lifecycle events, pruning records, and tombstones are append-only history and
 * survive every prune, so a pruned clone can still prove what it once held and
 * that it was removed on purpose (FR-EVID-004, SG-EVID-001, SG-LIFE-001).
 */
export const confirmEvidencePrune = async ({
  evidenceStore = null,
  preview = null,
  confirmation = null,
} = {}) => {
  const result = await evidenceStore.confirmPrune({ preview, confirmation });

  return {
    ...result,
    preserved: ['envelopes', 'decisions', 'lifecycle-events', 'pruning-records', 'tombstones'],
  };
};
