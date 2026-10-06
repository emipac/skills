/**
 * The Gate lifecycle command surface.
 *
 * An activated clone can expose a candidate release, update atomically, be
 * observed without being changed, be recovered explicitly, and be deactivated,
 * uninstalled, or cleaned up without losing shared state or history.
 *
 * Three rules shape every command here:
 *
 * 1. **Ordinary distribution is not activation.** Installing a newer skill or
 *    plugin only makes a *candidate* release visible. Only an explicit,
 *    successful `gate update` advances the Active gate release (FR-LIFE-014).
 * 2. **Observation never mutates.** `gate status` reconciles desired against
 *    actual state and reports `healthy`, `degraded`, or `broken`. It repairs
 *    nothing, writes nothing, and records nothing — not even a drift event,
 *    because a write is exactly what it must not do (FR-LIFE-009, FR-LIFE-019).
 * 3. **Removal is conservative and never partial.** Every removal path touches
 *    only unchanged Gate-owned state. Anything drifted, shared, global, or
 *    historical is left alone, and a step that cannot be completed safely
 *    refuses the whole operation rather than half-doing it (SG-LIFE-001,
 *    NFR-REL-002).
 */

export {
  UPDATE_STEPS,
  GATE_HEALTH,
  SHARED_CONFIGURATION_FILE,
  GATE_CONFIGURATION_KEYS,
} from './lifecycle/constants.mjs';

export {
  activeRelease,
  inspectRelease,
} from './lifecycle/release.mjs';

export { authorizedReceiptIds } from './lifecycle/receipts.mjs';

export {
  previewUpdate,
  updateGate,
} from './lifecycle/update.mjs';

export { statusGate } from './lifecycle/status.mjs';

export { deactivateGate } from './lifecycle/deactivate.mjs';

export { uninstallGate } from './lifecycle/uninstall.mjs';

export {
  previewConfigurationCleanup,
  confirmConfigurationCleanup,
} from './lifecycle/cleanup.mjs';

export {
  previewRepair,
  confirmRepair,
} from './lifecycle/repair.mjs';

export {
  previewEvidencePrune,
  confirmEvidencePrune,
} from './lifecycle/evidence-prune.mjs';

export { inspectCoordination } from './lifecycle/coordination.mjs';
