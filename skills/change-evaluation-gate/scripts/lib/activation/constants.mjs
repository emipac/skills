

/** The ordered steps of one Activation transaction; Git is always enabled last. */
export const ACTIVATION_STEPS = Object.freeze([
  'repository-identity',
  'preview',
  'consent',
  'runner-resolution',
  'trust',
  'hook-chain-validation',
  'self-test',
  'receipt',
  'git-enablement',
]);

/** The versioned on-disk shape of an Activation receipt. */
export const ACTIVATION_RECEIPT_VERSION = 'change-evaluation-gate/activation/v1';

/**
 * Every state one Activation transaction can report about a clone.
 *
 * `configured` and `recovery-required` are both non-activated, but they are not
 * the same clone: the first was fully unwound and may simply be retried, the
 * second still carries something this transaction established and could not
 * take back. Telling a maintainer the first when the truth is the second sends
 * them down the wrong recovery path, which is the whole defect TB-035 fixes.
 */
export const ACTIVATION_STATES = Object.freeze([
  'activated',
  'configured',
  'paused',
  'recovery-required',
]);
