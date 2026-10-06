

/** The authoritative hook the Gate registers; nothing else is authoritative. */
export const AUTHORITATIVE_HOOK = 'pre-commit';

/**
 * The declared hook composition order (FR-LIFE-017).
 *
 * Registration always prefers the least invasive thing that works: a hook
 * manager's own integration point first, then a confirmed marker-delimited
 * block inside an existing repository-local hook, and only where no hook exists
 * at all a clearly owned shim. Nothing in this list overwrites a hook or moves
 * a hooks path.
 */
export const HOOK_STRATEGIES = Object.freeze([
  'native-hook-manager',
  'marker-delimited-block',
  'gate-owned-shim',
]);

/** The delimiters of the gate-owned block inside an existing hook. */
export const HOOK_BLOCK_BEGIN = '# >>> change-evaluation-gate managed block >>>';

export const HOOK_BLOCK_END = '# <<< change-evaluation-gate managed block <<<';

/** The line by which a gate-owned registration names the activation that wrote it. */
export const HOOK_RECEIPT_PREFIX = '# activation-receipt: ';

/**
 * The stand-in for the receipt id inside a normalized registration.
 *
 * A gate-owned registration names the receipt that authorized it, and the
 * receipt names the registration it authorized — a cycle no hash can close. It
 * is broken by hashing the registration with exactly that one self-referential
 * value replaced by a constant. What remains is a *receipt-independent* content
 * identity: it can be computed before the receipt exists, pinned inside it, and
 * recomputed from the file on disk at any later time.
 *
 * The elided value is not lost. It is the receipt's own `receiptId`, so a
 * reader compares the literal line against the receipt it came from. The two
 * checks together cover every byte of the registration with no circularity.
 */
export const HOOK_RECEIPT_PLACEHOLDER = '<activation-receipt>';
