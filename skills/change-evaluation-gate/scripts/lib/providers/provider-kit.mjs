/**
 * Provider-side assembly kit.
 *
 * This is provider scaffolding, not gate core. It turns a provider's declared
 * check plan plus proved project facts into normalized descriptors, and it
 * refuses to invent anything: a plan entry with no proved command, or a test
 * check with no deterministic selection, becomes a visible capability gap
 * rather than a guessed descriptor (FR-PROF-004).
 */

import { SELECTION_KINDS, SELECTION_REQUIRED_STAGES } from '../check-descriptor.mjs';

const scopeGlobs = (scope, scopes) => {
  const roots = scope === 'both'
    ? [...(scopes?.backend ?? []), ...(scopes?.frontend ?? [])]
    : (scopes?.[scope] ?? []);

  const globs = roots
    .filter((root) => typeof root === 'string' && root.length > 0)
    .map((root) => `${root.replace(/\/+$/, '')}/**`);

  return globs.length > 0 ? globs : ['**'];
};

/**
 * @param {string} providerId
 * @param {ReadonlyArray<object>} plan declared checks in stable order
 * @param {object} facts proved project facts
 */
export const resolveFromPlan = (providerId, plan, facts) => {
  const proved = facts?.proved ?? {};
  // A plan entry marked `earnable` proposes `advisory` until the project
  // confirms it. Confirmation alone never creates a check: an unproved entry
  // stays a capability gap, so a required binding is always both proved and
  // confirmed (FR-PROF-009).
  const confirmed = new Set(facts?.confirmed_required ?? []);
  const descriptors = [];
  const capabilityGaps = [];

  // A single proved invocation that already covers a second concern absorbs
  // that concern's evidence claim instead of running the same analysis twice.
  const mergedClaims = new Map();

  for (const entry of plan) {
    if (!entry.merge_into) {
      continue;
    }

    if (proved[entry.merge_into]?.covers_tests === true) {
      mergedClaims.set(
        entry.merge_into,
        [...(mergedClaims.get(entry.merge_into) ?? []), ...entry.claims],
      );
    }
  }

  for (const entry of plan) {
    if (entry.merge_into && mergedClaims.has(entry.merge_into)) {
      continue;
    }

    const fact = proved[entry.key];

    if (!fact || !fact.evaluate) {
      capabilityGaps.push({
        provider: providerId,
        capability: entry.capability,
        stage: entry.stage,
        reason: 'command-not-proved',
        detail: `${providerId} has no proved non-mutating command for ${entry.capability} at the ${entry.stage} stage.`,
      });

      continue;
    }

    const requiresSelection = SELECTION_REQUIRED_STAGES.includes(entry.stage);

    if (requiresSelection && !SELECTION_KINDS.includes(fact.selection?.kind)) {
      capabilityGaps.push({
        provider: providerId,
        capability: entry.capability,
        stage: entry.stage,
        reason: 'selection-not-deterministic',
        detail: `${providerId} cannot select ${entry.stage} tests without a delivery matrix, explicit filter, or confirmed impact rule; a filename is not a selection.`,
      });

      continue;
    }

    const scope = fact.evaluate.source_scope;

    descriptors.push({
      id: `${providerId}.${entry.id}`,
      provider: providerId,
      stage: entry.stage,
      capability: entry.capability,
      scope,
      applicability: {
        changed_path_globs: entry.applies_to_all
          ? ['**']
          : scopeGlobs(scope, facts?.scopes),
        required_facts: entry.required_facts ?? [],
      },
      prerequisites: fact.prerequisites ?? [],
      policy: entry.earnable && confirmed.has(entry.key) ? 'required' : entry.policy,
      evaluate: fact.evaluate,
      fix: fact.fix ?? null,
      timeout_seconds: fact.timeout_seconds ?? fact.evaluate.timeout_seconds,
      declared_writes: fact.declared_writes ?? [],
      evidence: {
        claims: [...entry.claims, ...(mergedClaims.get(entry.key) ?? [])],
        success_exit_codes: fact.success_exit_codes ?? [0],
        report: fact.report ?? null,
      },
      order: entry.order,
      selection: requiresSelection ? fact.selection : null,
    });
  }

  return { descriptors, capabilityGaps, fixPlan: resolveFixPlan(providerId, plan, descriptors) };
};

/**
 * The provider's own mutation ordering.
 *
 * A plan entry declares `fix_order` when the provider knows its mutating
 * command must run at a particular point relative to its siblings. Only an
 * entry that actually resolved a separately declared fix command contributes a
 * step, so an unproved fix is silently absent rather than invented
 * (FR-PROF-010).
 */
export const resolveFixPlan = (providerId, plan, descriptors) => {
  const resolved = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));

  return plan
    .filter((entry) => Number.isInteger(entry.fix_order))
    .map((entry) => ({ entry, descriptor: resolved.get(`${providerId}.${entry.id}`) }))
    .filter(({ descriptor }) => Boolean(descriptor?.fix))
    .sort((left, right) => left.entry.fix_order - right.entry.fix_order
      || left.entry.id.localeCompare(right.entry.id))
    .map(({ entry, descriptor }) => ({ check_id: descriptor.id, order: entry.fix_order }));
};

export const createProvider = ({ id, contractVersion, plan }) => Object.freeze({
  id,
  contract_version: contractVersion,
  plan,
  resolve(facts) {
    const { descriptors, capabilityGaps, fixPlan } = resolveFromPlan(id, plan, facts);

    return {
      provider: id,
      contract_version: contractVersion,
      descriptors,
      capability_gaps: capabilityGaps,
      fix_plan: fixPlan,
    };
  },
});
