import { ACTIVATION_STEPS } from './constants.mjs';

/**
 * The state a refusal may claim, derived from what its rollback achieved.
 *
 * The failures were always collected; nothing read them. A compensating action
 * that failed means a gate-owned change survived the transaction, so the clone
 * is not merely configured and must not say that it is (SG-LIFE-001).
 */
const stateAfterRollback = (rollback, resting = 'configured') => (
  rollback.failures.length > 0 ? 'recovery-required' : resting
);

const refusal = (step, reasonCode, errors = []) => ({
  activated: false,
  state: 'configured',
  step,
  reasonCode,
  errors,
  receipt: null,
  order: [],
  rollback: { performed: false, actions: [], failures: [], remains: [] },
  resumption: null,
});

/**
 * The bookkeeping one Activation transaction reports itself through.
 *
 * It owns the journal, the step order, the compensating unwind, and the two
 * ways a transaction can end without activating. It is a separate object only
 * so the pipeline can be wrapped: an exception thrown after a gate-owned
 * mutation has to reach the same unwind and the same report as a refusal, and
 * it cannot do that from inside the pipeline that threw (SG-LIFE-001).
 */
export const activationTransaction = ({
  evidenceStore,
  // What a fully unwound failure leaves the clone as. An activation that
  // unwinds leaves it `configured`; a `gate sync` that unwinds leaves it
  // activated under the receipt it started from (`TB-062`).
  restingState = 'configured',
  // How the Lifecycle event names this transaction. Activation's own words are
  // the default and are unchanged; `gate sync` states its own.
  describeEvent = null,
}) => {
  // Compensating actions, unwound last-in-first-out.
  const journal = [];
  const order = [];

  const outcomeOf = (result) => {
    if (result.activated) {
      return 'succeeded';
    }

    // A pause is not a failure: the transaction is intact and may be resumed
    // with the identities it recorded.
    return result.state === 'paused' ? 'refused' : 'failed';
  };

  const reasonOf = (result) => {
    if (result.activated) {
      return `Activation completed through ${result.step}; authoritative Git was enabled last.`;
    }

    if (result.state === 'paused') {
      return `Activation paused at ${result.step} (${result.reasonCode}); no gate integration is active and it may be resumed only with the identities it recorded.`;
    }

    // A clone that still carries something this transaction established is not
    // a clone that "remains configured", and saying so would send the
    // maintainer to the wrong recovery path (FR-LIFE-019).
    if (result.state === 'recovery-required') {
      return `Activation failed at ${result.step} (${result.reasonCode}) and could not be fully rolled back; the clone requires recovery: ${result.rollback.remains.join(' ')}`;
    }

    return `Activation failed at ${result.step} (${result.reasonCode}); every gate-owned change was rolled back and the clone remains configured.`;
  };

  const record = async (result) => {
    if (evidenceStore) {
      await evidenceStore.appendLifecycleEvent({
        type: 'activation',
        before: result.resumption?.previewId ?? result.receipt?.previewId ?? null,
        after: result.resumption?.transactionId ?? result.receipt?.receiptId ?? null,
        outcome: outcomeOf(result),
        reason: reasonOf(result),
        ...(describeEvent === null ? {} : describeEvent(result)),
      });
    }

    return result;
  };

  const rollback = async () => {
    const actions = [];
    const failures = [];
    const remains = [];

    for (const entry of [...journal].reverse()) {
      actions.push(entry.name);

      try {
        await entry.undo();
      } catch (error) {
        // What the failed compensation left behind, stated by the journal entry
        // that established it. Nothing is retried and nothing is invented; the
        // maintainer is told exactly which change survived and where it is.
        const surviving = entry.remains
          ?? `The gate-owned change "${entry.name}" could not be taken back.`;

        failures.push({ action: entry.name, message: error.message, remains: surviving });
        remains.push(surviving);
      }
    }

    return { performed: journal.length > 0, actions, failures, remains };
  };

  const fail = async (step, reasonCode, errors = []) => {
    const unwound = await rollback();
    const result = {
      ...refusal(step, reasonCode, errors),
      state: stateAfterRollback(unwound, restingState),
      order,
      rollback: unwound,
    };

    // A store that cannot record the refusal must not mask the refusal itself.
    return record(result).catch(() => result);
  };

  /**
   * Suspend the transaction without activating anything.
   *
   * Everything gate-owned is still unwound, so a paused transaction leaves no
   * integration active anywhere; what survives is the identity it may be
   * resumed against, and nothing else (FR-LIFE-016, SG-HOOK-001).
   */
  const suspend = async (step, reasonCode, errors, resumption) => {
    const unwound = await rollback();
    const recovering = stateAfterRollback(unwound) === 'recovery-required';
    const result = {
      ...refusal(step, reasonCode, errors),
      // A pause that could not put the clone back is not a pause: something the
      // transaction established is still there, and it is reported as such.
      state: recovering ? 'recovery-required' : 'paused',
      order,
      rollback: unwound,
      resumption: recovering ? null : resumption,
    };

    return record(result).catch(() => result);
  };

  /** The step the transaction had reached, for a failure that named none. */
  const currentStep = () => order.at(-1) ?? ACTIVATION_STEPS[0];

  return { journal, order, record, rollback, fail, suspend, currentStep };
};
