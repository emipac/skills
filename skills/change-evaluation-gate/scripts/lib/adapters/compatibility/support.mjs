import { describeAdapter } from '../declarations/registry.mjs';

/** The Support tiers a context may hold. */
export const SUPPORT_TIERS = Object.freeze(['supported', 'experimental', 'unsupported']);

/**
 * The one v1 variant that can be supported. Everything else about a client —
 * its CLI, an SSH session, a remote or cloud runner, a background agent — is
 * unproved until it passes this baseline on its own (FR-ADAPT-006).
 */
const SUPPORTED_VARIANT = 'desktop';

/**
 * Classify one integration context into its Support tier.
 *
 * Support is capability-based and evidence-based, never a name on a list
 * (Q-004). Three things must all hold before a context is `supported`: it is
 * one of the v1 clients, on its declared local desktop variant, and its shared
 * baseline was actually run and passed. Drop the evidence and the tier drops to
 * `experimental`; drop the repository, process, or Git capability and the
 * context is `unsupported`, because a surface that cannot reach the repository
 * cannot preflight it at all (FR-ADAPT-006, SG-SUPPORT-001).
 *
 * Enforcement role is not consulted here. A preflight surface with no native
 * blocking is fully supported when its baseline passes; authorization stays
 * with Git either way (FR-ADAPT-007).
 */
export const classifySupport = ({
  adapterId,
  variant = SUPPORTED_VARIANT,
  capabilities = {},
  baseline = null,
} = {}) => {
  const adapter = describeAdapter(adapterId);

  if (adapter === null) {
    return {
      adapterId: adapterId ?? null,
      variant,
      tier: 'unsupported',
      reason: 'not-a-v1-client',
    };
  }

  if (capabilities.repositoryFilesystem !== true
    || capabilities.processExecution !== true
    || capabilities.git !== true) {
    return {
      adapterId: adapter.id,
      variant,
      tier: 'unsupported',
      reason: 'repository-execution-unavailable',
    };
  }

  if (variant !== SUPPORTED_VARIANT) {
    return {
      adapterId: adapter.id,
      variant,
      tier: 'experimental',
      reason: 'variant-not-proved',
    };
  }

  if (baseline === null) {
    return {
      adapterId: adapter.id,
      variant,
      tier: 'experimental',
      reason: 'baseline-not-run',
    };
  }

  if (baseline.passed !== true) {
    return {
      adapterId: adapter.id,
      variant,
      tier: 'experimental',
      reason: 'baseline-failed',
      failedChecks: baseline.failedChecks ?? [],
    };
  }

  // A baseline driven by payloads this repository built from its own
  // declaration cannot establish that the declaration matches the client: the
  // fixture and the thing under test came from the same source. Real captures
  // corrected every declared field on every surface precisely because injected
  // fixtures could not (SG-SUPPORT-001).
  if (baseline.evidence?.payloadSource !== 'captured-client-invocation') {
    return {
      adapterId: adapter.id,
      variant,
      tier: 'experimental',
      reason: 'client-invocation-not-observed',
      versions: baseline.versions ?? null,
    };
  }

  return {
    adapterId: adapter.id,
    variant,
    tier: 'supported',
    reason: 'baseline-passed',
    versions: baseline.versions ?? null,
  };
};
