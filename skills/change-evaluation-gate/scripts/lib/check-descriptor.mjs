/**
 * Provider-to-evaluation check descriptor contract.
 *
 * A provider is a pure resolver: proved project facts in, normalized check
 * descriptors out. The gate consumes descriptors through this contract only and
 * never learns which stack produced them (SG-OWNER-001).
 *
 * The Evidence ladder stages are owned by `verify-change` and imported rather
 * than restated here, so the gate cannot quietly fork the settled ladder.
 */

import { evidenceLadderStages } from '../../../verify-change/scripts/verification-plan.mjs';
import { isRepositoryRelativePath, validateCommandDescriptor } from './command-descriptor.mjs';

export const CONTRACT_VERSION = 1;

export const SUPPORTED_CONTRACT_VERSIONS = Object.freeze([1]);

export const LADDER_STAGES = evidenceLadderStages;

/**
 * Contract versions carry the semantics a gate core must understand. Adding a
 * capability name is free; adding a ladder stage or changing outcome semantics
 * means a new entry here and a provider contract-version change, which an
 * unsupporting core rejects rather than silently reinterprets.
 */
export const CONTRACT_VERSION_SEMANTICS = Object.freeze({
  1: Object.freeze({
    stages: LADDER_STAGES,
    outcomes: Object.freeze(['passed', 'failed', 'unverified', 'not-applicable']),
  }),
});

export const CHECK_OUTCOMES = CONTRACT_VERSION_SEMANTICS[CONTRACT_VERSION].outcomes;

/** `required` and `advisory` bind policy to a check; they are never outcomes. */
export const POLICY_BINDINGS = Object.freeze(['required', 'advisory']);

/**
 * Focused and affected-test evidence needs a deterministic selection. A
 * filename is not a selection: relevance inferred from a path is a guess.
 */
export const SELECTION_KINDS = Object.freeze([
  'delivery-matrix',
  'explicit-filter',
  'impact-rule',
]);

export const SELECTION_REQUIRED_STAGES = Object.freeze(['focused', 'affected-tests']);

export const CAPABILITY_GAP_REASONS = Object.freeze([
  'command-not-proved',
  'capability-not-proved',
  'prerequisite-not-proved',
  'selection-not-deterministic',
  'runner-unresolved',
]);

const REQUIRED_DESCRIPTOR_FIELDS = Object.freeze([
  'id',
  'provider',
  'stage',
  'capability',
  'scope',
  'applicability',
  'prerequisites',
  'policy',
  'evaluate',
  'fix',
  'timeout_seconds',
  'declared_writes',
  'evidence',
  'order',
  'selection',
]);

const SCOPES = Object.freeze(['backend', 'frontend', 'both']);

const IDENTIFIER = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;

const CAPABILITY_NAME = /^[a-z][a-z0-9-]*$/;

/**
 * The four kinds of requirement a check may declare.
 *
 * Exported so the one resolver that proves them reads the same list this
 * contract validates against. A second copy is how a kind would come to
 * validate here and be silently unprovable there (`SG-OWNER-001`).
 */
export const PREREQUISITE_KINDS = Object.freeze([
  'executable',
  'configuration',
  'service',
  'environment',
]);

const stageIndex = new Map(LADDER_STAGES.map((stage, index) => [stage, index]));

const isPlainObject = (value) => typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

export const outcomesForVersion = (contractVersion) => (
  CONTRACT_VERSION_SEMANTICS[contractVersion]?.outcomes ?? null
);

/**
 * Normalize one attempt into exactly one of the four contract outcomes.
 * `not-applicable` means the deterministic predicate did not match; evidence
 * that could not be produced is `unverified` and is never reported as
 * inapplicable.
 */
export const resolveOutcome = ({
  applicable,
  executed = false,
  exit_code: exitCode = null,
  timed_out: timedOut = false,
  error = null,
  success_exit_codes: successExitCodes = [0],
} = {}) => {
  if (applicable === false) {
    return 'not-applicable';
  }

  if (timedOut || error || !executed || exitCode === null) {
    return 'unverified';
  }

  return successExitCodes.includes(exitCode) ? 'passed' : 'failed';
};

export const assertOutcome = (outcome, contractVersion = CONTRACT_VERSION) => {
  if (POLICY_BINDINGS.includes(outcome)) {
    return {
      code: 'policy-binding-is-not-an-outcome',
      path: 'outcome',
      message: `${outcome} is a policy binding, not a check outcome.`,
    };
  }

  const outcomes = outcomesForVersion(contractVersion);

  if (!outcomes || !outcomes.includes(outcome)) {
    return {
      code: 'outcome-unknown',
      path: 'outcome',
      message: `Outcome ${JSON.stringify(outcome)} is not defined by contract version ${contractVersion}.`,
    };
  }

  return null;
};

export const validateCheckDescriptor = (descriptor) => {
  const errors = [];
  const path = isPlainObject(descriptor) && typeof descriptor.id === 'string'
    ? descriptor.id
    : '<descriptor>';

  if (!isPlainObject(descriptor)) {
    return [{ code: 'descriptor-invalid', path, message: 'Check descriptor must be an object.' }];
  }

  for (const field of REQUIRED_DESCRIPTOR_FIELDS) {
    if (!(field in descriptor)) {
      errors.push({
        code: 'descriptor-field-missing',
        path: `${path}.${field}`,
        message: `Check descriptor is missing ${field}.`,
      });
    }
  }

  for (const field of Object.keys(descriptor)) {
    if (!REQUIRED_DESCRIPTOR_FIELDS.includes(field)) {
      errors.push({
        code: 'descriptor-field-unknown',
        path: `${path}.${field}`,
        message: `Check descriptor does not accept ${field}; extend the contract version instead.`,
      });
    }
  }

  if (typeof descriptor.id !== 'string' || !IDENTIFIER.test(descriptor.id)) {
    errors.push({
      code: 'descriptor-id-invalid',
      path: `${path}.id`,
      message: 'Check identity must be a stable dotted lowercase identifier.',
    });
  } else if (typeof descriptor.provider === 'string'
    && !descriptor.id.startsWith(`${descriptor.provider}.`)) {
    errors.push({
      code: 'descriptor-id-not-namespaced',
      path: `${path}.id`,
      message: 'Check identity must be namespaced by its provider.',
    });
  }

  if (!LADDER_STAGES.includes(descriptor.stage)) {
    errors.push({
      code: 'stage-unknown',
      path: `${path}.stage`,
      message: `Stage ${JSON.stringify(descriptor.stage)} is not an Evidence ladder stage.`,
    });
  }

  if (typeof descriptor.capability !== 'string' || !CAPABILITY_NAME.test(descriptor.capability)) {
    errors.push({
      code: 'capability-invalid',
      path: `${path}.capability`,
      message: 'Capability must be a stack-neutral lowercase name.',
    });
  }

  if (!SCOPES.includes(descriptor.scope)) {
    errors.push({
      code: 'scope-invalid',
      path: `${path}.scope`,
      message: 'Scope must be backend, frontend, or both.',
    });
  }

  if (!isPlainObject(descriptor.applicability)
    || !Array.isArray(descriptor.applicability.changed_path_globs)
    || descriptor.applicability.changed_path_globs.length === 0
    || !Array.isArray(descriptor.applicability.required_facts)) {
    errors.push({
      code: 'applicability-invalid',
      path: `${path}.applicability`,
      message: 'Applicability must declare deterministic changed-path globs and required facts.',
    });
  }

  if (!Array.isArray(descriptor.prerequisites)
    || descriptor.prerequisites.some((prerequisite) => !isPlainObject(prerequisite)
      || !PREREQUISITE_KINDS.includes(prerequisite.kind)
      || typeof prerequisite.name !== 'string'
      || prerequisite.name.length === 0)) {
    errors.push({
      code: 'prerequisites-invalid',
      path: `${path}.prerequisites`,
      message: 'Prerequisites must name proved executables, configuration, services, or environment.',
    });
  }

  if (!POLICY_BINDINGS.includes(descriptor.policy)) {
    errors.push({
      code: 'policy-binding-invalid',
      path: `${path}.policy`,
      message: 'Policy must be the required or advisory binding proposed for this check.',
    });
  }

  errors.push(...validateCommandDescriptor(descriptor.evaluate, `${path}.evaluate`));

  if (descriptor.fix !== null && descriptor.fix !== undefined) {
    errors.push(...validateCommandDescriptor(descriptor.fix, `${path}.fix`));

    if (JSON.stringify(descriptor.fix) === JSON.stringify(descriptor.evaluate)) {
      errors.push({
        code: 'fix-must-differ-from-evaluate',
        path: `${path}.fix`,
        message: 'Evaluation is non-mutating; a fix command must be separately declared.',
      });
    }
  }

  if (!Number.isInteger(descriptor.timeout_seconds) || descriptor.timeout_seconds < 1) {
    errors.push({
      code: 'timeout-invalid',
      path: `${path}.timeout_seconds`,
      message: 'Check timeout must be a positive integer number of seconds.',
    });
  } else if (Number.isInteger(descriptor.evaluate?.timeout_seconds)
    && descriptor.timeout_seconds < descriptor.evaluate.timeout_seconds) {
    errors.push({
      code: 'timeout-below-command',
      path: `${path}.timeout_seconds`,
      message: 'Check timeout must cover its evaluation command timeout.',
    });
  }

  if (!Array.isArray(descriptor.declared_writes)
    || descriptor.declared_writes.some((write) => !isRepositoryRelativePath(write))) {
    errors.push({
      code: 'declared-writes-invalid',
      path: `${path}.declared_writes`,
      message: 'Declared writes must be repository-relative artifact paths.',
    });
  }

  if (!isPlainObject(descriptor.evidence)
    || !Array.isArray(descriptor.evidence.claims)
    || descriptor.evidence.claims.length === 0
    || descriptor.evidence.claims.some((claim) => typeof claim !== 'string' || !claim)
    || !Array.isArray(descriptor.evidence.success_exit_codes)
    || descriptor.evidence.success_exit_codes.length === 0
    || descriptor.evidence.success_exit_codes.some((code) => !Number.isInteger(code))) {
    errors.push({
      code: 'evidence-invalid',
      path: `${path}.evidence`,
      message: 'Evidence must declare at least one claim and its success exit codes.',
    });
  }

  if (!Number.isInteger(descriptor.order) || descriptor.order < 0) {
    errors.push({
      code: 'order-invalid',
      path: `${path}.order`,
      message: 'Order must be a non-negative integer for stable in-stage ordering.',
    });
  }

  if (SELECTION_REQUIRED_STAGES.includes(descriptor.stage)) {
    if (!isPlainObject(descriptor.selection)
      || !SELECTION_KINDS.includes(descriptor.selection.kind)
      || typeof descriptor.selection.value !== 'string'
      || descriptor.selection.value.length === 0) {
      errors.push({
        code: 'selection-not-deterministic',
        path: `${path}.selection`,
        message: 'Focused and affected-test checks require a deterministic selection; filenames alone are not a selection.',
      });
    }
  } else if (descriptor.selection !== null && descriptor.selection !== undefined) {
    errors.push({
      code: 'selection-not-applicable',
      path: `${path}.selection`,
      message: 'Only focused and affected-test stages carry a test selection.',
    });
  }

  return errors;
};

export const validateCapabilityGap = (gap, providerId) => {
  const errors = [];

  if (!isPlainObject(gap)) {
    return [{
      code: 'capability-gap-invalid',
      path: `${providerId}:<gap>`,
      message: 'Capability gap must be an object.',
    }];
  }

  const path = `${providerId}:${gap.capability ?? '<capability>'}`;

  if (gap.provider !== providerId) {
    errors.push({
      code: 'capability-gap-invalid',
      path,
      message: 'A capability gap must be attributed to the provider that reported it.',
    });
  }

  if (typeof gap.capability !== 'string' || !CAPABILITY_NAME.test(gap.capability)) {
    errors.push({
      code: 'capability-gap-invalid',
      path,
      message: 'A capability gap must name a stack-neutral capability.',
    });
  }

  if (gap.stage !== null && !LADDER_STAGES.includes(gap.stage)) {
    errors.push({
      code: 'capability-gap-invalid',
      path,
      message: 'A capability gap must name an Evidence ladder stage or null.',
    });
  }

  if (!CAPABILITY_GAP_REASONS.includes(gap.reason)) {
    errors.push({
      code: 'capability-gap-invalid',
      path,
      message: `Capability gap reason ${JSON.stringify(gap.reason)} is not a contract reason.`,
    });
  }

  if (typeof gap.detail !== 'string' || gap.detail.length === 0) {
    errors.push({
      code: 'capability-gap-invalid',
      path,
      message: 'A capability gap must state why the capability is unproved.',
    });
  }

  return errors;
};

export const compareChecks = (left, right) => {
  const stageDelta = stageIndex.get(left.stage) - stageIndex.get(right.stage);

  if (stageDelta !== 0) {
    return stageDelta;
  }

  if (left.order !== right.order) {
    return left.order - right.order;
  }

  return left.id.localeCompare(right.id);
};

export const orderChecks = (checks) => [...checks].sort(compareChecks);

/**
 * Validate one provider's complete output: supported contract version, correct
 * attribution, valid descriptors, and unique identities.
 */
export const validateProviderOutput = (output, providerId) => {
  const errors = [];

  if (!isPlainObject(output)) {
    return [{
      code: 'provider-output-invalid',
      path: providerId,
      message: 'A provider must return an output object.',
    }];
  }

  if (output.provider !== providerId) {
    errors.push({
      code: 'provider-attribution-mismatch',
      path: providerId,
      message: 'Provider output must be attributed to the provider that produced it.',
    });
  }

  if (!SUPPORTED_CONTRACT_VERSIONS.includes(output.contract_version)) {
    errors.push({
      code: 'unsupported-contract-version',
      path: providerId,
      message: `Contract version ${JSON.stringify(output.contract_version)} is not supported by this gate core; supported: ${SUPPORTED_CONTRACT_VERSIONS.join(', ')}.`,
    });

    return errors;
  }

  const descriptors = Array.isArray(output.descriptors) ? output.descriptors : null;

  if (!descriptors) {
    errors.push({
      code: 'provider-output-invalid',
      path: providerId,
      message: 'Provider output must list descriptors.',
    });

    return errors;
  }

  const seenIds = new Set();
  const seenClaims = new Set();

  for (const descriptor of descriptors) {
    errors.push(...validateCheckDescriptor(descriptor));

    if (typeof descriptor?.id === 'string') {
      if (seenIds.has(descriptor.id)) {
        errors.push({
          code: 'duplicate-check-identity',
          path: descriptor.id,
          message: 'Check identities must be unique within a provider.',
        });
      }

      seenIds.add(descriptor.id);
    }

    for (const claim of descriptor?.evidence?.claims ?? []) {
      if (seenClaims.has(claim)) {
        errors.push({
          code: 'duplicate-evidence-claim',
          path: `${descriptor.id}.evidence`,
          message: `Evidence claim ${JSON.stringify(claim)} is already claimed by another check.`,
        });
      }

      seenClaims.add(claim);
    }
  }

  const gaps = Array.isArray(output.capability_gaps) ? output.capability_gaps : null;

  if (!gaps) {
    errors.push({
      code: 'provider-output-invalid',
      path: providerId,
      message: 'Provider output must list capability gaps, even when empty.',
    });

    return errors;
  }

  for (const gap of gaps) {
    errors.push(...validateCapabilityGap(gap, providerId));
  }

  return errors;
};
