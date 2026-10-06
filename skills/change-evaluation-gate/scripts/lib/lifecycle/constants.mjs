

/**
 * The ordered steps of one `gate update`, with the release switch always last.
 *
 * Nothing before `release-switch` touches the published receipt, so a failure
 * at any earlier step leaves the previous Active gate release in place by
 * construction rather than by compensation (FR-LIFE-008).
 */
export const UPDATE_STEPS = Object.freeze([
  'preview',
  'compatibility',
  'migration',
  'self-test',
  'release-switch',
]);

/** The health values `gate status` may report (FR-LIFE-009). */
export const GATE_HEALTH = Object.freeze(['healthy', 'degraded', 'broken']);

/** The name of the shared framework configuration file the Gate never owns. */
export const SHARED_CONFIGURATION_FILE = '.agent-framework.yaml';

/** The top-level `.agent-framework.yaml` keys the Gate owns and may clean up. */
export const GATE_CONFIGURATION_KEYS = Object.freeze(['evaluation_gate']);
