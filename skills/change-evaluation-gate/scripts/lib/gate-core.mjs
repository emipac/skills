/**
 * Gate core: the stack-neutral consumer of provider check descriptors.
 *
 * This module knows contract versions, ladder ordering, and capability gaps.
 * It knows no stack, framework, or tool name, and it contains no branch on a
 * provider identity (SG-OWNER-001). A new provider that speaks a supported
 * contract version needs no change here (NFR-MAINT-001).
 */

import {
  CONTRACT_VERSION,
  SUPPORTED_CONTRACT_VERSIONS,
  orderChecks,
  validateProviderOutput,
} from './check-descriptor.mjs';

const isProvider = (provider) => typeof provider === 'object'
  && provider !== null
  && typeof provider.id === 'string'
  && provider.id.length > 0
  && typeof provider.resolve === 'function';

export const collectChecks = (requests) => {
  const errors = [];
  const checks = [];
  const capabilityGaps = [];
  // Mutation ordering is provider-declared data that core carries but never
  // computes. Core has no opinion about which command should run first
  // (SG-OWNER-001).
  const fixPlan = [];

  for (const request of requests ?? []) {
    const provider = request?.provider;

    if (!isProvider(provider)) {
      errors.push({
        code: 'provider-invalid',
        path: '<provider>',
        message: 'A provider must expose a stable id and a pure resolve function.',
      });

      continue;
    }

    if (!SUPPORTED_CONTRACT_VERSIONS.includes(provider.contract_version)) {
      errors.push({
        code: 'unsupported-contract-version',
        path: provider.id,
        message: `Provider declares contract version ${JSON.stringify(provider.contract_version)}; supported: ${SUPPORTED_CONTRACT_VERSIONS.join(', ')}.`,
      });

      continue;
    }

    const output = provider.resolve(request.facts);
    const outputErrors = validateProviderOutput(output, provider.id);

    errors.push(...outputErrors);

    if (Array.isArray(output?.capability_gaps)) {
      capabilityGaps.push(...output.capability_gaps);
    }

    if (outputErrors.length === 0) {
      checks.push(...output.descriptors);
      fixPlan.push(...(Array.isArray(output.fix_plan) ? output.fix_plan : []));
    }
  }

  return {
    valid: errors.length === 0,
    contract_version: CONTRACT_VERSION,
    checks: orderChecks(checks),
    capability_gaps: capabilityGaps,
    fix_plan: fixPlan,
    errors,
  };
};
