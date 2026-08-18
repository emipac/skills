/**
 * Gate policy application.
 *
 * Policy is applied to one completed evaluation binding: required checks bind
 * conjunctively, advisory checks record without blocking, the confirmed budget
 * bounds execution, and an explicitly configured one-shot bypass is the only
 * supported escape hatch.
 *
 * Policy names check identities only. Command definitions stay owned by
 * Verification (SG-OWNER-001); nothing here defines, copies, or rewrites one.
 */

import { createHash } from 'node:crypto';

import { EVIDENCE_FORMAT } from './evaluation-contract.mjs';

/**
 * The Gate policy section has exactly five subcontracts. Nothing else is
 * expressible, so a baseline exemption or a persistent pass cache cannot be
 * configured into existence (FR-POL-004).
 */
export const GATE_POLICY_SUBCONTRACTS = Object.freeze([
  'checks',
  'budget',
  'bypass',
  'execution',
  'evidence',
]);

/**
 * Property names a Gate policy subcontract may never carry. Verification owns
 * command definitions, profiles, runners, and activation; Gate policy names
 * check identities and limits only (SG-OWNER-001).
 */
export const RESERVED_POLICY_PROPERTIES = Object.freeze([
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

const isPlainObject = (value) => typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

const isCheckIdentity = (value) => typeof value === 'string' && value.length > 0;

const isIdentityList = (value) => Array.isArray(value) && value.every(isCheckIdentity);

/**
 * A repository-relative directory that cannot climb out of the repository.
 *
 * The separator is compared as text rather than resolved, so the same
 * declaration is judged identically on every platform: a path that would escape
 * is refused wherever the policy is read, not only where it is executed.
 */
const isContainedRoot = (value) => {
  if (typeof value !== 'string' || value === '' || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    return false;
  }

  return value.split(/[\\/]+/).every((segment) => segment !== '..');
};

const isContainedRootList = (value) => Array.isArray(value) && value.every(isContainedRoot);

const error = (code, path, message) => ({ code, path, message });

const checksErrors = (checks) => {
  if (!isPlainObject(checks)
    || !isIdentityList(checks.required)
    || !isIdentityList(checks.advisory)) {
    if (isPlainObject(checks)
      && [checks.required, checks.advisory].some(
        (list) => Array.isArray(list) && !list.every(isCheckIdentity),
      )) {
      return [error(
        'gate-policy-check-identity-invalid',
        'evaluation_gate.checks',
        'Every bound check must be a stable check identity.',
      )];
    }

    return [error(
      'gate-policy-checks-invalid',
      'evaluation_gate.checks',
      'The checks subcontract must list required and advisory check identities.',
    )];
  }

  const errors = [];
  const advisory = new Set(checks.advisory);

  for (const list of ['required', 'advisory']) {
    const seen = new Set();

    for (const id of checks[list]) {
      if (seen.has(id)) {
        errors.push(error(
          'gate-policy-check-duplicated',
          `evaluation_gate.checks.${list}`,
          `Check ${JSON.stringify(id)} is bound more than once.`,
        ));
      }

      seen.add(id);
    }
  }

  for (const id of new Set(checks.required)) {
    if (advisory.has(id)) {
      errors.push(error(
        'gate-policy-check-ambiguous',
        'evaluation_gate.checks',
        `Check ${JSON.stringify(id)} is bound as both required and advisory; severity must be unambiguous.`,
      ));
    }
  }

  return errors;
};

const bypassErrors = (bypass) => {
  if (!isPlainObject(bypass) || typeof bypass.enabled !== 'boolean') {
    return [error(
      'gate-policy-bypass-invalid',
      'evaluation_gate.bypass',
      'The bypass subcontract must state explicitly whether bypass is enabled.',
    )];
  }

  const errors = [];

  if ('require_reference' in bypass && typeof bypass.require_reference !== 'boolean') {
    errors.push(error(
      'gate-policy-bypass-invalid',
      'evaluation_gate.bypass.require_reference',
      'A required bypass reference must be stated as a boolean.',
    ));
  }

  if ('marker' in bypass && !(bypass.marker === null || isCheckIdentity(bypass.marker))) {
    errors.push(error(
      'gate-policy-bypass-invalid',
      'evaluation_gate.bypass.marker',
      'The commit-visible bypass marker must be a non-empty string or null.',
    ));
  } else if (bypass.enabled === true && !isCheckIdentity(bypass.marker)) {
    // An enabled bypass that emits no commit-visible marker would be invisible,
    // which is exactly what FR-POL-007 forbids.
    errors.push(error(
      'gate-policy-bypass-invalid',
      'evaluation_gate.bypass.marker',
      'An enabled bypass must configure the commit-visible marker it emits.',
    ));
  }

  return errors;
};

/**
 * Validate one repository Gate policy before it can bound an evaluation.
 *
 * Plan validation is where missing limits are rejected: there is no universal
 * timeout or budget default to fall back on (Q-007, NFR-PERF-001).
 */
export const validateGatePolicy = (policy) => {
  if (!isPlainObject(policy)) {
    return [error(
      'gate-policy-invalid',
      'evaluation_gate',
      'The Gate policy section must be an object.',
    )];
  }

  const errors = [];

  for (const subcontract of Object.keys(policy)) {
    if (!GATE_POLICY_SUBCONTRACTS.includes(subcontract)) {
      errors.push(error(
        'gate-policy-subcontract-unknown',
        `evaluation_gate.${subcontract}`,
        `Gate policy has exactly five subcontracts: ${GATE_POLICY_SUBCONTRACTS.join(', ')}.`,
      ));
    }
  }

  for (const subcontract of GATE_POLICY_SUBCONTRACTS) {
    if (!(subcontract in policy)) {
      errors.push(error(
        'gate-policy-subcontract-missing',
        `evaluation_gate.${subcontract}`,
        `The Gate policy section is missing the ${subcontract} subcontract.`,
      ));

      continue;
    }

    for (const property of Object.keys(policy[subcontract] ?? {})) {
      if (RESERVED_POLICY_PROPERTIES.includes(property)) {
        errors.push(error(
          'gate-policy-command-ownership',
          `evaluation_gate.${subcontract}.${property}`,
          `Gate policy never carries ${property}; Verification is the sole owner of command definitions.`,
        ));
      }
    }
  }

  if ('checks' in policy) {
    errors.push(...checksErrors(policy.checks));
  }

  if ('budget' in policy
    && (!isPlainObject(policy.budget)
      || !Number.isInteger(policy.budget.total_seconds)
      || policy.budget.total_seconds < 1)) {
    errors.push(error(
      'gate-policy-budget-invalid',
      'evaluation_gate.budget.total_seconds',
      'The budget subcontract must confirm a positive total evaluation budget in seconds.',
    ));
  }

  if ('bypass' in policy) {
    errors.push(...bypassErrors(policy.bypass));
  }

  const skippable = policy.execution?.budget_skippable;

  if (skippable !== undefined) {
    if (!isIdentityList(skippable)) {
      errors.push(error(
        'gate-policy-execution-invalid',
        'evaluation_gate.execution.budget_skippable',
        'Budget-skippable work must be listed as check identities.',
      ));
    } else {
      const required = new Set(
        isIdentityList(policy.checks?.required) ? policy.checks.required : [],
      );

      for (const id of skippable) {
        if (required.has(id)) {
          errors.push(error(
            'gate-policy-skippable-required',
            'evaluation_gate.execution.budget_skippable',
            `Check ${JSON.stringify(id)} is required; required work is never skipped to meet the budget.`,
          ));
        }
      }
    }
  }

  // Which directories a project installs its dependencies into is the
  // project's own declaration; this contract only requires that each one is a
  // repository-relative directory that stays inside the repository. A
  // declaration that could climb out would reach content the repository does
  // not contain (SG-CMD-001).
  const dependencyRoots = policy.execution?.dependency_roots;

  if (dependencyRoots !== undefined && !isContainedRootList(dependencyRoots)) {
    errors.push(error(
      'gate-policy-execution-invalid',
      'evaluation_gate.execution.dependency_roots',
      'Dependency roots must be listed as repository-relative directories that stay inside the repository.',
    ));
  }

  return errors;
};

/** Every reason a requested bypass can be refused (SG-BYP-001). */
export const BYPASS_REJECTIONS = Object.freeze([
  'bypass-disabled',
  'marker-unconfigured',
  'reason-missing',
  'reference-missing',
  'snapshot-mismatch',
  'bypass-already-consumed',
  'nothing-to-bypass',
]);

const digest = (value) => `sha256:${createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex')}`;

const isFilled = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Resolve one explicitly requested bypass against repository policy and the
 * completed decision.
 *
 * A bypass is never a pass: it neither rewrites a check nor removes a failure.
 * It is one-shot, bound to the exact snapshot, and refused without its required
 * reason and reference (FR-POL-006, FR-POL-007, FR-POL-008, SG-BYP-001).
 */
export const resolveBypass = ({
  grant = null,
  policy = null,
  snapshotId = null,
  outcome = null,
  checks = [],
  ledger = null,
} = {}) => {
  if (!grant) {
    return null;
  }

  const preservedFailures = checks
    .filter((check) => check.outcome === 'failed')
    .map((check) => check.id);
  const preservedUnverified = checks
    .filter((check) => check.outcome === 'unverified')
    .map((check) => check.id);
  const marker = policy?.bypass?.marker ?? null;
  const id = digest({
    snapshotId: grant.snapshotId ?? null,
    actor: grant.actor ?? null,
    reason: grant.reason ?? null,
    reference: grant.reference ?? null,
    requestedAt: grant.requestedAt ?? null,
  });
  const record = {
    id,
    requested: true,
    applied: false,
    rejectionCode: null,
    actor: grant.actor ?? null,
    reason: isFilled(grant.reason) ? grant.reason.trim() : null,
    reference: isFilled(grant.reference) ? grant.reference.trim() : null,
    requestedAt: grant.requestedAt ?? null,
    snapshotId: grant.snapshotId ?? null,
    marker,
    oneShot: true,
    preservedFailures,
    preservedUnverified,
    // Local enforcement and its evidence are cooperative, never tamper-proof
    // against the machine owner (SG-TRUST-001, RISK-001).
    tamperEvident: false,
    evidence: null,
  };

  const reject = (rejectionCode) => ({ ...record, rejectionCode });

  if (policy?.bypass?.enabled !== true) {
    return reject('bypass-disabled');
  }

  if (!isFilled(marker)) {
    return reject('marker-unconfigured');
  }

  if (!isFilled(grant.reason)) {
    return reject('reason-missing');
  }

  if (policy.bypass.require_reference === true && !isFilled(grant.reference)) {
    return reject('reference-missing');
  }

  if (!isFilled(grant.snapshotId) || grant.snapshotId !== snapshotId) {
    return reject('snapshot-mismatch');
  }

  if (ledger?.isConsumed?.(id) === true) {
    return reject('bypass-already-consumed');
  }

  // A passing decision has nothing to bypass; recording one would misrepresent
  // an honest pass as an escape hatch.
  if (outcome === 'passed') {
    return reject('nothing-to-bypass');
  }

  const applied = {
    ...record,
    applied: true,
    bypassedOutcome: outcome,
    evidence: {
      id: digest({
        id,
        snapshotId,
        outcome,
        preservedFailures,
        preservedUnverified,
        marker,
      }),
      format: EVIDENCE_FORMAT,
      persisted: false,
    },
  };

  ledger?.consume?.(applied);

  return applied;
};

/** Required checks bind conjunctively over the current binding (SG-POL-001). */
export const decisionOutcome = (checks) => {
  const required = (checks ?? []).filter((check) => check.policy === 'required');

  if (required.some((check) => check.outcome === 'unverified')) {
    return 'unverified';
  }

  if (required.some((check) => check.outcome === 'failed')) {
    return 'failed';
  }

  return 'passed';
};

/** Only an authoritative role may allow or deny; preflight never claims authority. */
export const authorizationFor = (role, outcome) => {
  if (role !== 'authoritative') {
    return 'not-authoritative';
  }

  return ['passed', 'bypassed'].includes(outcome) ? 'allow' : 'deny';
};

/**
 * Bind repository policy to resolved checks.
 *
 * A provider proposes a binding; only the repository Gate policy decides which
 * check identities are required. A proposal the policy never adopted is
 * recorded as advisory rather than allowed to block, and an identity bound to
 * both severities is invalid configuration rather than a silent choice
 * (FR-CFG-002, SG-POL-001).
 *
 * Policy names check identities only. No command definition is read here.
 */
export const bindPolicy = (checks, policy) => {
  if (!policy?.checks) {
    return { bound: [...(checks ?? [])], diagnostics: [] };
  }

  const required = new Set(policy.checks.required ?? []);
  const advisory = new Set(policy.checks.advisory ?? []);
  const known = new Set((checks ?? []).map((check) => check.id));
  // Plan validation and binding resolution are the same configuration failure,
  // so they are reported as one diagnostic rather than a burst of them.
  const reasons = validateGatePolicy(policy).map((issue) => `${issue.path}: ${issue.message}`);

  for (const id of [...required, ...advisory]) {
    if (!known.has(id)) {
      reasons.push(`Gate policy binds check ${JSON.stringify(id)}, which no configured provider resolved.`);
    }
  }

  const bound = (checks ?? []).map((check) => ({
    ...check,
    policy: required.has(check.id) && !advisory.has(check.id) ? 'required' : 'advisory',
  }));

  return {
    bound,
    diagnostics: reasons.length === 0 ? [] : [{
      reasonCode: 'configuration-invalid',
      detail: `The Gate policy cannot bound this evaluation: ${reasons.join(' ')}`,
    }],
  };
};

/**
 * The total evaluation budget.
 *
 * Only advisory work the project explicitly confirmed as skippable may be
 * dropped to stay inside the budget. Required work is never skipped: when the
 * budget is exhausted a required check becomes blocking `unverified` rather
 * than quietly disappearing (FR-POL-005, SG-POL-001).
 */
export const createBudgetLedger = ({ totalSeconds = null, skippable = [] } = {}) => {
  const totalMs = Number.isInteger(totalSeconds) && totalSeconds > 0 ? totalSeconds * 1000 : null;
  const eligible = new Set(skippable ?? []);
  let consumedMs = 0;

  const remainingMs = () => (totalMs === null ? null : Math.max(totalMs - consumedMs, 0));

  return {
    remainingMs,
    consume: (durationMs) => {
      consumedMs += Number.isFinite(durationMs) ? durationMs : 0;
    },
    /** Whether one check may still start, and why it may not. */
    admit: (check) => {
      const remaining = remainingMs();

      if (remaining === null) {
        return { admitted: true, reasonCode: null, skipped: false };
      }

      const needMs = (check.timeout_seconds ?? 0) * 1000;

      if (remaining >= needMs) {
        return { admitted: true, reasonCode: null, skipped: false };
      }

      if (check.policy === 'advisory' && eligible.has(check.id)) {
        return { admitted: false, reasonCode: 'budget-exhausted', skipped: true };
      }

      if (remaining <= 0) {
        return { admitted: false, reasonCode: 'budget-exhausted', skipped: false };
      }

      // Required work is attempted with whatever budget remains; the executor
      // terminates its process tree when the remainder runs out.
      return { admitted: true, reasonCode: null, skipped: false, clampedMs: remaining };
    },
  };
};

/** The identity a decision must match to authorize the current attempt. */
export const bindingOf = (decision) => ({
  snapshotId: decision?.snapshot?.id ?? null,
  configurationId: decision?.configurationId ?? null,
  environmentId: decision?.environment?.id ?? null,
  runnerVersion: decision?.integrity?.runnerVersion ?? null,
  providerVersions: decision?.integrity?.providerVersions ?? {},
  role: decision?.authorization === 'not-authoritative' ? 'preflight' : 'authoritative',
});

const sameVersions = (left, right) => {
  const leftKeys = Object.keys(left ?? {}).sort();
  const rightKeys = Object.keys(right ?? {}).sort();

  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
};

/**
 * Every way a completed decision can fail to describe the attempt being
 * authorized. Each one denies: stale evidence never authorizes a changed
 * commit, a changed configuration, or a changed tool environment
 * (FR-POL-003, FR-POL-004, SG-EVAL-001).
 */
const bindingDiagnostics = (decision, binding) => {
  const diagnostics = [];

  if (decision?.snapshot?.id !== binding?.snapshotId) {
    diagnostics.push({
      reasonCode: 'snapshot-mismatch',
      detail: 'The decision was produced for a different snapshot; a completed pass never authorizes a changed snapshot.',
    });
  }

  if (decision?.configurationId !== binding?.configurationId) {
    diagnostics.push({
      reasonCode: 'integrity-drift',
      detail: 'The decision was produced under a different trusted configuration identity.',
    });
  }

  if (decision?.integrity?.runnerVersion !== binding?.runnerVersion
    || !sameVersions(decision?.integrity?.providerVersions, binding?.providerVersions)) {
    diagnostics.push({
      reasonCode: 'integrity-drift',
      detail: 'The decision was produced under a different runner or provider tool environment.',
    });
  }

  // The environment identity is derived from the snapshot, configuration, and
  // runner, so it is only reported when no component above already named the
  // drift; otherwise one changed commit would be reported twice.
  if (diagnostics.length === 0 && decision?.environment?.id !== binding?.environmentId) {
    diagnostics.push({
      reasonCode: 'integrity-drift',
      detail: 'The decision was produced in a different evaluation environment.',
    });
  }

  return diagnostics;
};

/**
 * Recompute the authorization of one completed decision against the binding
 * that is being authorized right now.
 *
 * Authorization is never read off a stored outcome: it is recomputed
 * conjunctively over the required checks of a decision that still describes
 * this exact snapshot, configuration, environment, and tool environment.
 * There is no baseline exemption and no persistent pass cache (FR-POL-004).
 */
export const authorizeDecision = (decision, binding) => {
  const diagnostics = bindingDiagnostics(decision, binding);

  if (diagnostics.length > 0) {
    return {
      outcome: 'unverified',
      authorization: authorizationFor(binding?.role, 'unverified'),
      diagnostics,
    };
  }

  if (decision?.outcome === 'bypassed') {
    return {
      outcome: 'bypassed',
      authorization: authorizationFor(binding?.role, 'bypassed'),
      diagnostics,
    };
  }

  const recomputed = decisionOutcome(decision?.checks ?? []);
  // Reauthorization can only ever be as strict as the recorded decision. An
  // evaluation that was unverified for its own reasons — a harness diagnostic,
  // drift, incomplete coverage — is never upgraded because its checks happen to
  // read positively (NFR-REL-003).
  const outcome = recomputed === 'passed' && decision?.outcome !== 'passed'
    ? (decision?.outcome ?? 'unverified')
    : recomputed;

  return {
    outcome,
    authorization: authorizationFor(binding?.role, outcome),
    diagnostics,
  };
};
