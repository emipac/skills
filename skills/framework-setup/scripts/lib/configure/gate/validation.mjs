import { gatePolicyKeys } from '../contracts.mjs';
import { revisionRefusal } from '../refusals.mjs';

const gateForbiddenOwnershipFields = new Set([
  'activation',
  'activated',
  'allowed_environment',
  'args',
  'capabilities',
  'client',
  'command',
  'commands',
  'evidence_category',
  'executable',
  'hook',
  'profile',
  'profiles',
  'receipt',
  'runner',
  'source_scope',
  'trust',
  'version',
  'working_directory',
]);

const gateForbiddenOwnershipField = (value) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (gateForbiddenOwnershipFields.has(key)) {
      return key;
    }

    const nestedField = gateForbiddenOwnershipField(nestedValue);

    if (nestedField) {
      return nestedField;
    }
  }

  return null;
};

export const validateGatePolicy = async (policy) => {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('Gate policy must be an object');
  }

  const policyKeys = Object.keys(policy);
  const unsupportedKey = policyKeys.find((key) => !gatePolicyKeys.includes(key));
  const missingKey = gatePolicyKeys.find((key) => !policyKeys.includes(key));

  if (unsupportedKey) {
    throw new Error(`Unsupported Gate policy subcontract: ${unsupportedKey}`);
  }

  if (missingKey) {
    throw new Error(`Missing Gate policy subcontract: ${missingKey}`);
  }

  if (policyKeys.length !== gatePolicyKeys.length) {
    throw new Error('Gate policy must contain exactly five subcontracts');
  }

  const forbiddenOwnershipField = gateForbiddenOwnershipField(policy);

  if (forbiddenOwnershipField) {
    throw new Error(
      `Gate policy cannot own verification or activation field: ${forbiddenOwnershipField}`,
    );
  }

  const checks = policy.checks;

  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) {
    throw new Error('Gate checks policy must be an object');
  }

  const checkKeys = Object.keys(checks);

  if (
    checkKeys.length !== 2
    || !checkKeys.includes('required')
    || !checkKeys.includes('advisory')
  ) {
    throw new Error('Gate checks policy must contain only required and advisory identities');
  }

  for (const category of ['required', 'advisory']) {
    const identities = checks[category];

    if (
      !Array.isArray(identities)
      || new Set(identities).size !== identities.length
      || identities.some((identity) => typeof identity !== 'string' || !identity.trim())
    ) {
      throw new Error(`Gate ${category} check identities must be unique non-empty strings`);
    }
  }

  const overlappingIdentity = checks.required.find((identity) => checks.advisory.includes(identity));

  if (overlappingIdentity) {
    throw new Error(
      `Gate check identity cannot be both required and advisory: ${overlappingIdentity}`,
    );
  }

  const budget = policy.budget;

  if (
    !budget
    || typeof budget !== 'object'
    || Array.isArray(budget)
    || Object.keys(budget).length !== 1
    || !Number.isInteger(budget.total_seconds)
    || budget.total_seconds <= 0
  ) {
    throw new Error('Gate budget policy must contain a positive total_seconds integer');
  }

  for (const subcontract of ['bypass', 'execution', 'evidence']) {
    const value = policy[subcontract];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Gate ${subcontract} policy must be an object`);
    }
  }

  const { validateGatePolicy: validateRuntimeGatePolicy } = await import(
    '../../../../../change-evaluation-gate/scripts/lib/policy.mjs',
  );
  const runtimeIssues = validateRuntimeGatePolicy(policy);

  if (runtimeIssues.length > 0) {
    throw new Error(runtimeIssues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join(' '));
  }
};

/** Validate one policy with the Gate policy validator, refusing by its own reason. */
export const validatedPolicy = async (policy, reasonCode, prefix) => {
  try {
    await validateGatePolicy(policy);
  } catch (error) {
    throw error.code === 'ERR_MODULE_NOT_FOUND'
      ? revisionRefusal('gate-validator-unavailable', `The Gate policy validator could not be loaded (${error.message}). Nothing was written.`)
      : revisionRefusal(reasonCode, `${prefix}: ${error.message} Nothing was written.`);
  }
};
