import { describeActivation } from './description.mjs';
import { previewActivation } from './preview.mjs';
import { entryRefusal, hookChainRefusal, runnerResolutionRefusal, unreportableAdapterRefusal } from './refusals.mjs';

/**
 * The steps of one Activation transaction that are decided by observing this
 * clone and this machine, in the order the transaction takes them (`TB-063`).
 * `inspectActivation` asks exactly these, through the refusals above, which
 * are the ones `runActivation` makes.
 */
export const OBSERVABLE_ACTIVATION_STEPS = Object.freeze([
  'repository-identity',
  'preview',
  'runner-resolution',
  'hook-chain-validation',
]);

/**
 * The steps nothing can answer without performing them, and what each one
 * asks. They are reported as answered by activation, never simulated: consent
 * is the operator's act, trust is the client's, a self-test executes a
 * registered program, and the receipt and the Git registration are the writes
 * activation makes (`TB-063`, `SG-TRUST-001`).
 */
export const STEPS_ANSWERED_BY_ACTIVATION = Object.freeze([
  Object.freeze({
    step: 'consent',
    question: 'the operator confirms the exact activation preview, in a separate invocation; consent is never implied',
  }),
  Object.freeze({
    step: 'trust',
    question: "each selected client's declared trust model is satisfied",
  }),
  Object.freeze({
    step: 'self-test',
    question: 'the evaluation process denies a change it must deny, the registered hook program is executed against such a change, and each selected adapter registers its declared surface and proves it',
  }),
  Object.freeze({
    step: 'receipt',
    question: 'the Activation receipt is published and read back',
  }),
  Object.freeze({
    step: 'git-enablement',
    question: 'the pre-commit registration is written, last',
  }),
]);

/**
 * Ask every question activation asks of this clone and machine before it asks
 * for consent, without activating (`TB-063`).
 *
 * It resolves exactly what `runActivation` resolves — the same identities, the
 * same runner resolution, the same hook-chain validation — and builds the same
 * preview `previewActivation` builds, which writes nothing (`FR-LIFE-004`). It
 * then applies the refusals `runActivation` applies at steps 1, 2, 4, and 6,
 * in that order, and reports the first — step 2's being a selected preflight
 * surface that could not answer (`TB-048`). No consent is read, no trust is sought,
 * nothing is self-tested, and nothing is written; the steps that only
 * performing them could answer are `STEPS_ANSWERED_BY_ACTIVATION`.
 *
 * A policy the preview refuses stops the inspection at `preview`, with the
 * reason code the operator surface refuses an activation preview with.
 */
export const inspectActivation = async (request, dependencies = {}) => {
  const entry = entryRefusal(request);

  if (entry !== null) {
    return { reached: ['repository-identity'], stop: entry, preview: null, described: null };
  }

  const described = await describeActivation(request, dependencies);
  let preview;

  try {
    preview = await previewActivation(request, dependencies);
  } catch (error) {
    return {
      reached: ['repository-identity', 'preview'],
      stop: { step: 'preview', reasonCode: 'activation-unpreviewable', errors: [{ message: error.message }] },
      preview: null,
      described,
    };
  }

  const unreportable = unreportableAdapterRefusal(described.adapters);

  if (unreportable !== null) {
    return { reached: ['repository-identity', 'preview'], stop: unreportable, preview, described };
  }

  const refusals = [
    ['runner-resolution', runnerResolutionRefusal(described)],
    ['hook-chain-validation', hookChainRefusal(described)],
  ];
  const reached = ['repository-identity', 'preview'];

  for (const [step, refused] of refusals) {
    reached.push(step);

    if (refused !== null) {
      return { reached, stop: refused, preview, described };
    }
  }

  return { reached, stop: null, preview, described };
};
