

/**
 * Every receipt id this activation has been published under, newest first.
 *
 * An update rewrites the receipt and mints a new id, but it does not rewrite the
 * registration on disk — the block goes on naming the receipt that authorized
 * it. All of them belong to this activation, so a registration naming any of
 * them is still ours, and only a registration naming something else is a
 * genuine mismatch (FR-LIFE-008, FR-LIFE-009).
 */
export const authorizedReceiptIds = (receipt) => [
  receipt?.receiptId ?? null,
  ...(receipt?.receiptLineage ?? []),
].filter((id) => typeof id === 'string' && id.length > 0);
