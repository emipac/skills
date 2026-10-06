/**
 * The clone-local Activation transaction.
 *
 * Activation is the explicit, repository-bound step that turns a *configured*
 * clone into an *activated* one. It is never reached by installing a skill,
 * running setup, or opening a client: those states are deliberately distinct
 * (FR-LIFE-004).
 *
 * The transaction runs a fixed ordered pipeline and enables authoritative Git
 * last, so nothing can block a commit until every earlier step has proved
 * itself. Every gate-owned change is journalled with its compensating action;
 * a failure at any step unwinds that journal in reverse and leaves the clone
 * configured, with no receipt and no registration (FR-LIFE-005, NFR-REL-002,
 * SG-LIFE-001).
 *
 * The transaction never repairs drift it did not cause and never removes
 * anything it did not write.
 */

export {
  ACTIVATION_STEPS,
  ACTIVATION_RECEIPT_VERSION,
  ACTIVATION_STATES,
} from './activation/constants.mjs';

export {
  AUTHORITATIVE_HOOK,
  HOOK_STRATEGIES,
  HOOK_BLOCK_BEGIN,
  HOOK_BLOCK_END,
  HOOK_RECEIPT_PREFIX,
  HOOK_RECEIPT_PLACEHOLDER,
} from './activation/hooks/constants.mjs';

export {
  repositoryIdentity,
  configurationIdentity,
  adapterIdentity,
  activationTransactionIdentity,
} from './activation/identities.mjs';

export { detectHookManager } from './activation/hooks/discovery.mjs';

export {
  normalizeHookRegistration,
  hookBlockIdentity,
  hookRegistrationReceiptId,
  plannedHookRegistration,
} from './activation/hooks/content.mjs';

export { readHookRegistration } from './activation/hooks/observation.mjs';

export {
  HOOK_PROGRAM_SELF_TEST_ENV,
  HOOK_PROGRAM_SELF_TEST_SUBJECT_VERSION,
  selfTestHookProgramDenial,
} from './activation/hooks/self-test.mjs';

export {
  registerOwnedHook,
  removeOwnedHook,
  registerManagedBlock,
  removeManagedBlock,
} from './activation/hooks/registration.mjs';

export { withdrawHookRegistration } from './activation/hooks/removal.mjs';

export { restoreHookRegistration } from './activation/hooks/repair.mjs';

export { previewActivation } from './activation/inspection/preview.mjs';

export { unreportableAdapterRefusal } from './activation/inspection/refusals.mjs';

export {
  OBSERVABLE_ACTIVATION_STEPS,
  STEPS_ANSWERED_BY_ACTIVATION,
  inspectActivation,
} from './activation/inspection/inspect.mjs';

export { activate } from './activation/activate.mjs';

export { recoverTrustedConfiguration } from './activation/receipts.mjs';

export { previewSync } from './activation/sync/preview.mjs';

export { syncActivation } from './activation/sync/transaction.mjs';
