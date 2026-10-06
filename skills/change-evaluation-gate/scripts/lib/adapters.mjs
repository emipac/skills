/**
 * Supported desktop preflight adapters and the authoritative Git adapter.
 *
 * An adapter is thin on purpose. It normalizes a native client event and
 * identity into the client-independent evaluation request, invokes the shared
 * `evaluate` seam, and presents the returned decision. It never reimplements
 * policy, never authorizes anything, and never hands a native payload to gate
 * core (FR-ADAPT-001, FR-ADAPT-003).
 *
 * Authorization is re-derived here from the adapter's Enforcement role through
 * the one policy seam that owns it. A preflight surface therefore cannot
 * present `allow` or `deny` however the decision it was handed was authorized:
 * only authoritative Git authorizes a change (FR-ADAPT-007, SG-SUPPORT-001).
 */

export {
  ADAPTER_CAPABILITY_CATEGORIES,
  ADAPTER_TRUST_MODELS,
  FEEDBACK_ABSENCES,
} from './adapters/declarations/contracts.mjs';

export { validateAdapterDeclaration } from './adapters/declarations/capabilities.mjs';

export {
  ADAPTER_IDS,
  DESKTOP_ADAPTER_IDS,
  describeAdapter,
} from './adapters/declarations/registry.mjs';

export {
  normalizeNativeInvocation,
  normalizeTurn,
  normalizeTrigger,
} from './adapters/native/identity.mjs';

export { resolveRepositoryRoot } from './adapters/native/repository.mjs';

export { presentDecision } from './adapters/presentation/decision.mjs';

export {
  FEEDBACK_LIMITS,
  formatFeedback,
  unreportableSurface,
} from './adapters/presentation/feedback.mjs';

export {
  ADAPTER_FAILURE_REASONS,
  runAdapterEvaluation,
} from './adapters/evaluation.mjs';

export {
  BASELINE_PAYLOAD_SOURCES,
  CAPTURED_BASELINE_CHECKS,
  BASELINE_CHECKS,
  buildNativePayload,
  runCompatibilityBaseline,
} from './adapters/compatibility/baseline.mjs';

export {
  SUPPORT_TIERS,
  classifySupport,
} from './adapters/compatibility/support.mjs';

export {
  REGISTRATION_SURFACE_KINDS,
  REGISTRATION_BLOCK_SCHEMAS,
  validateRegistrationDeclaration,
} from './adapters/declarations/registration.mjs';
