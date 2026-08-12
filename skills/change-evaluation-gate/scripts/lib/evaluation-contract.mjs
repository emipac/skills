/**
 * The versioned evaluation process contract.
 *
 * `evaluate(request) -> decision` is the gate's only public seam. The request
 * is client independent: it names what to grade and who is asking, and it never
 * carries client-native payloads, verification commands, or policy overrides.
 * The decision is a complete envelope: a returned decision is transport
 * success even when authorization is denied (NFR-AUD-002).
 *
 * Casing boundary: the process contract (request, decision, executor seam) is
 * camelCase; the provider check descriptor contract owned by `check-descriptor`
 * stays snake_case. Descriptors are consumed, never embedded in a decision.
 */

import { CHECK_OUTCOMES, POLICY_BINDINGS, resolveOutcome } from './check-descriptor.mjs';
import { CONTRACT_STATUSES } from './delivery-contract.mjs';
import { GRADER_SURFACE_KINDS } from './grader-surface.mjs';
import { ISOLATION } from './snapshot.mjs';

export const PROTOCOL_VERSION = '1.0';

export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['1.0']);

export const OPERATION = 'evaluate';

/** The exact snapshot targets an adapter may name. Never the live worktree. */
export const SNAPSHOT_TARGET_KINDS = Object.freeze(['git-index', 'worktree']);

/** Enforcement role. Only an authoritative role may allow or deny. */
export const ENFORCEMENT_ROLES = Object.freeze(['authoritative', 'preflight']);

/** Normalized triggers. Client-native event names are normalized by adapters. */
export const TRIGGERS = Object.freeze(['commit-attempt', 'work-complete']);

export const EVALUATION_PURPOSES = Object.freeze([
  'change-acceptance-and-regression',
  'regression-only',
]);

export const DECISION_OUTCOMES = Object.freeze(['passed', 'failed', 'unverified', 'bypassed']);

export const AUTHORIZATIONS = Object.freeze(['allow', 'deny', 'not-authoritative']);

export const EVIDENCE_FORMAT = 'change-evaluation-gate/v1';

/**
 * What a Check assertion claims. Only an `acceptance` assertion may carry a
 * stable acceptance ID requested by a valid delivery contract; broad regression
 * evidence is always `regression` (FR-PROF-005, SG-SCOPE-001).
 */
export const ASSERTION_KINDS = Object.freeze(['acceptance', 'regression']);

/**
 * Every reason a check or a decision can carry, and the single outcome each
 * one normalizes to. Every harness failure family maps to `unverified`; none of
 * them can ever produce `passed` (NFR-REL-003).
 */
export const REASON_OUTCOMES = Object.freeze({
  'grader-positive': 'passed',
  'grader-negative': 'failed',
  'not-applicable': 'not-applicable',
  'prerequisite-missing': 'unverified',
  'configuration-invalid': 'unverified',
  timeout: 'unverified',
  'budget-exhausted': 'unverified',
  crash: 'unverified',
  'malformed-output': 'unverified',
  'snapshot-mismatch': 'unverified',
  'integrity-drift': 'unverified',
  'coordination-failure': 'unverified',
  'attempt-conflict': 'unverified',
  // Evidence could not be captured without risking a raw Sensitive value. Safe
  // handling that cannot be proved can never produce a pass (SG-SECRET-001).
  'sensitive-capture-unsafe': 'unverified',
});

export const REASON_CODES = Object.freeze(Object.keys(REASON_OUTCOMES));

export const UNVERIFIED_REASONS = Object.freeze(
  REASON_CODES.filter((reason) => REASON_OUTCOMES[reason] === 'unverified'),
);

const REQUEST_FIELDS = Object.freeze([
  'protocolVersion',
  'operation',
  'repository',
  'change',
  'evaluation',
  'invocation',
]);

const REQUEST_SECTION_FIELDS = Object.freeze({
  repository: ['root'],
  change: ['kind', 'baseRevision'],
  evaluation: ['purpose', 'contractRef'],
  invocation: ['role', 'trigger', 'adapter', 'sessionId'],
});

const ADAPTER_FIELDS = Object.freeze(['id', 'surface', 'version', 'capabilities']);

const DECISION_FIELDS = Object.freeze([
  'protocolVersion',
  'evaluationId',
  'outcome',
  'authorization',
  'task',
  'snapshot',
  'environment',
  'configurationId',
  'profile',
  'checks',
  'advisories',
  'bypass',
  'coverage',
  'integrity',
  'evidence',
  'delegation',
  'diagnostics',
]);

const DECISION_SECTION_FIELDS = Object.freeze({
  task: ['id', 'purpose', 'contractId', 'contractStatus'],
  snapshot: ['kind', 'id', 'baseRevision', 'executionRoot'],
  environment: [
    'id',
    'isolation',
    'snapshotId',
    'sourceMutable',
    'historyVisibility',
    'cachePolicy',
  ],
  coverage: [
    'scope',
    'requiredClaims',
    'provedClaims',
    'gaps',
    'acceptanceCriteria',
    'provedAcceptanceCriteria',
    'acceptanceGaps',
    'limitations',
  ],
  integrity: [
    'configurationId',
    'runnerVersion',
    'providerVersions',
    'environmentId',
    'snapshotId',
    'changedGraderSurfaces',
    'controlSurfaceChanged',
    'runtimeBinding',
  ],
  evidence: ['id', 'format', 'persisted', 'reference'],
  delegation: ['seam', 'ladder', 'invokedRoles'],
});

const CHECK_FIELDS = Object.freeze([
  'id',
  'stage',
  'policy',
  'grader',
  'outcome',
  'reasonCode',
  'summary',
  'assertions',
  'attempts',
]);

const isPlainObject = (value) => typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

const isAbsolutePath = (value) => isNonEmptyString(value)
  && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value));

const isIdentityDigest = (value) => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);

const unknownFieldErrors = (value, allowed, path, code) => Object.keys(value ?? {})
  .filter((field) => !allowed.includes(field))
  .map((field) => ({
    code,
    path: `${path}.${field}`,
    message: `${path} does not accept ${field}; the process contract carries no client-native payload, command, or policy override.`,
  }));

/**
 * Validate one evaluation request. Unknown fields are rejected rather than
 * ignored so a client cannot smuggle commands or policy through the seam.
 */
export const validateEvaluationRequest = (request) => {
  const errors = [];

  if (!isPlainObject(request)) {
    return [{
      code: 'request-invalid',
      path: '<request>',
      message: 'An evaluation request must be an object.',
    }];
  }

  errors.push(...unknownFieldErrors(request, REQUEST_FIELDS, 'request', 'request-field-unknown'));

  for (const [section, fields] of Object.entries(REQUEST_SECTION_FIELDS)) {
    if (isPlainObject(request[section])) {
      errors.push(...unknownFieldErrors(
        request[section],
        fields,
        `request.${section}`,
        'request-field-unknown',
      ));
    }
  }

  if (isPlainObject(request.invocation?.adapter)) {
    errors.push(...unknownFieldErrors(
      request.invocation.adapter,
      ADAPTER_FIELDS,
      'request.invocation.adapter',
      'request-field-unknown',
    ));
  }

  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(request.protocolVersion)) {
    errors.push({
      code: 'protocol-version-unsupported',
      path: 'request.protocolVersion',
      message: `Protocol version ${JSON.stringify(request.protocolVersion)} is not supported; supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}.`,
    });
  }

  if (request.operation !== OPERATION) {
    errors.push({
      code: 'operation-unsupported',
      path: 'request.operation',
      message: `Operation ${JSON.stringify(request.operation)} is not the evaluation operation; fix and installation are separate interfaces.`,
    });
  }

  if (!isAbsolutePath(request.repository?.root)) {
    errors.push({
      code: 'repository-root-invalid',
      path: 'request.repository.root',
      message: 'The request must name an absolute repository root.',
    });
  }

  if (!SNAPSHOT_TARGET_KINDS.includes(request.change?.kind)) {
    errors.push({
      code: 'snapshot-target-invalid',
      path: 'request.change.kind',
      message: `Snapshot target ${JSON.stringify(request.change?.kind)} is not an exact evaluation target; supported: ${SNAPSHOT_TARGET_KINDS.join(', ')}.`,
    });
  }

  if (!isNonEmptyString(request.change?.baseRevision)) {
    errors.push({
      code: 'base-revision-invalid',
      path: 'request.change.baseRevision',
      message: 'The request must name the base revision the snapshot is taken against.',
    });
  }

  if (!EVALUATION_PURPOSES.includes(request.evaluation?.purpose)) {
    errors.push({
      code: 'purpose-invalid',
      path: 'request.evaluation.purpose',
      message: `Evaluation purpose ${JSON.stringify(request.evaluation?.purpose)} is not a contract purpose.`,
    });
  }

  const contractRef = request.evaluation?.contractRef;

  if (!(contractRef === null || isNonEmptyString(contractRef))) {
    errors.push({
      code: 'contract-reference-invalid',
      path: 'request.evaluation.contractRef',
      message: 'The delivery-contract reference is optional and must be null or a repository-relative path.',
    });
  }

  if (!ENFORCEMENT_ROLES.includes(request.invocation?.role)) {
    errors.push({
      code: 'role-invalid',
      path: 'request.invocation.role',
      message: `Enforcement role ${JSON.stringify(request.invocation?.role)} is not a contract role.`,
    });
  }

  if (!TRIGGERS.includes(request.invocation?.trigger)) {
    errors.push({
      code: 'trigger-invalid',
      path: 'request.invocation.trigger',
      message: `Trigger ${JSON.stringify(request.invocation?.trigger)} is not a normalized trigger.`,
    });
  }

  const adapter = request.invocation?.adapter;

  if (!isPlainObject(adapter)
    || !isNonEmptyString(adapter.id)
    || !isNonEmptyString(adapter.surface)
    || !isNonEmptyString(adapter.version)
    || !isPlainObject(adapter.capabilities)
    || typeof adapter.capabilities.nativeBlocking !== 'boolean') {
    errors.push({
      code: 'adapter-identity-invalid',
      path: 'request.invocation.adapter',
      message: 'The adapter must name its id, surface, version, and declared capabilities.',
    });
  }

  if (!isNonEmptyString(request.invocation?.sessionId)) {
    errors.push({
      code: 'session-identity-invalid',
      path: 'request.invocation.sessionId',
      message: 'The request must carry a session identity.',
    });
  }

  return errors;
};

const validateAssertion = (assertion, path, errors) => {
  if (!isPlainObject(assertion)
    || !isNonEmptyString(assertion.id)
    || !ASSERTION_KINDS.includes(assertion.kind)
    || !CHECK_OUTCOMES.includes(assertion.outcome)
    || !isNonEmptyString(assertion.summary)) {
    errors.push({
      code: 'assertion-invalid',
      path,
      message: 'Every Check assertion must carry a stable identity, its acceptance or regression kind, one contract outcome, and a summary.',
    });
  }
};

const validateAttempt = (attempt, path, errors) => {
  if (!isPlainObject(attempt)
    || !Number.isInteger(attempt.attempt)
    || attempt.attempt < 1
    || !CHECK_OUTCOMES.includes(attempt.outcome)
    || !REASON_CODES.includes(attempt.reasonCode)
    || !Number.isInteger(attempt.durationMs)
    || !(attempt.exitCode === null || Number.isInteger(attempt.exitCode))) {
    errors.push({
      code: 'attempt-invalid',
      path,
      message: 'Every preserved Check attempt must carry an ordinal, outcome, contract reason code, duration, and exit code or null.',
    });

    return;
  }

  if (REASON_OUTCOMES[attempt.reasonCode] !== attempt.outcome) {
    errors.push({
      code: 'attempt-reason-mismatch',
      path,
      message: `Reason ${JSON.stringify(attempt.reasonCode)} normalizes to ${REASON_OUTCOMES[attempt.reasonCode]}, not ${JSON.stringify(attempt.outcome)}.`,
    });
  }
};

const validateCheckResult = (check, index, errors) => {
  const path = `decision.checks[${index}]`;

  if (!isPlainObject(check)) {
    errors.push({ code: 'check-result-invalid', path, message: 'A check result must be an object.' });

    return;
  }

  errors.push(...unknownFieldErrors(check, CHECK_FIELDS, path, 'check-result-field-unknown'));

  for (const field of CHECK_FIELDS) {
    if (!(field in check)) {
      errors.push({
        code: 'check-result-field-missing',
        path: `${path}.${field}`,
        message: `A check result is missing ${field}.`,
      });
    }
  }

  if (!isNonEmptyString(check.id) || !isNonEmptyString(check.stage)) {
    errors.push({
      code: 'check-result-invalid',
      path,
      message: 'A check result must name its stable check identity and Evidence ladder stage.',
    });
  }

  if (!POLICY_BINDINGS.includes(check.policy)) {
    errors.push({
      code: 'check-result-invalid',
      path: `${path}.policy`,
      message: 'A check result must carry its required or advisory policy binding.',
    });
  }

  if (!CHECK_OUTCOMES.includes(check.outcome) || !REASON_CODES.includes(check.reasonCode)) {
    errors.push({
      code: 'check-result-invalid',
      path: `${path}.outcome`,
      message: 'A check result must carry one contract outcome and one contract reason code.',
    });
  }

  if (!isPlainObject(check.grader)
    || check.grader.type !== 'code'
    || !isNonEmptyString(check.grader.method)
    || !isNonEmptyString(check.grader.target)) {
    errors.push({
      code: 'check-result-invalid',
      path: `${path}.grader`,
      message: 'A configured check is a deterministic code-based grader and must name its method and target.',
    });
  }

  if (!Array.isArray(check.assertions) || check.assertions.length === 0) {
    errors.push({
      code: 'check-result-invalid',
      path: `${path}.assertions`,
      message: 'A check result must carry at least one atomic Check assertion.',
    });
  } else {
    check.assertions.forEach((assertion, assertionIndex) => {
      validateAssertion(assertion, `${path}.assertions[${assertionIndex}]`, errors);
    });
  }

  if (!Array.isArray(check.attempts)) {
    errors.push({
      code: 'check-result-invalid',
      path: `${path}.attempts`,
      message: 'A check result must preserve its attempt history.',
    });
  } else {
    check.attempts.forEach((attempt, attemptIndex) => {
      validateAttempt(attempt, `${path}.attempts[${attemptIndex}]`, errors);
    });
  }
};

/** Validate one decision envelope against the process contract. */
export const validateDecision = (decision) => {
  const errors = [];

  if (!isPlainObject(decision)) {
    return [{
      code: 'decision-invalid',
      path: '<decision>',
      message: 'A decision must be an object.',
    }];
  }

  errors.push(...unknownFieldErrors(decision, DECISION_FIELDS, 'decision', 'decision-field-unknown'));

  for (const field of DECISION_FIELDS) {
    if (!(field in decision)) {
      errors.push({
        code: 'decision-field-missing',
        path: `decision.${field}`,
        message: `The decision is missing ${field}.`,
      });
    }
  }

  for (const [section, fields] of Object.entries(DECISION_SECTION_FIELDS)) {
    if (!isPlainObject(decision[section])) {
      errors.push({
        code: 'decision-field-missing',
        path: `decision.${section}`,
        message: `The decision is missing the ${section} section.`,
      });

      continue;
    }

    errors.push(...unknownFieldErrors(
      decision[section],
      fields,
      `decision.${section}`,
      'decision-field-unknown',
    ));

    for (const field of fields) {
      if (!(field in decision[section])) {
        errors.push({
          code: 'decision-field-missing',
          path: `decision.${section}.${field}`,
          message: `The decision ${section} section is missing ${field}.`,
        });
      }
    }
  }

  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(decision.protocolVersion)) {
    errors.push({
      code: 'protocol-version-unsupported',
      path: 'decision.protocolVersion',
      message: 'A decision must name a supported protocol version.',
    });
  }

  if (!isIdentityDigest(decision.evaluationId)) {
    errors.push({
      code: 'evaluation-identity-invalid',
      path: 'decision.evaluationId',
      message: 'A decision must carry a reproducible evaluation identity digest.',
    });
  }

  if (!DECISION_OUTCOMES.includes(decision.outcome)) {
    errors.push({
      code: 'outcome-invalid',
      path: 'decision.outcome',
      message: `Decision outcome ${JSON.stringify(decision.outcome)} is not a contract outcome.`,
    });
  }

  if (!AUTHORIZATIONS.includes(decision.authorization)) {
    errors.push({
      code: 'authorization-invalid',
      path: 'decision.authorization',
      message: `Authorization ${JSON.stringify(decision.authorization)} is not a contract authorization.`,
    });
  }

  if (!isIdentityDigest(decision.task?.id)
    || !EVALUATION_PURPOSES.includes(decision.task?.purpose)
    || !CONTRACT_STATUSES.includes(decision.task?.contractStatus)
    || !(decision.task?.contractId === null || isIdentityDigest(decision.task?.contractId))) {
    errors.push({
      code: 'task-identity-invalid',
      path: 'decision.task',
      message: 'A decision must carry Evaluation scope identity, purpose, delivery-contract status, and delivery-contract identity or null.',
    });
  }


  if (!(decision.snapshot?.kind === null || SNAPSHOT_TARGET_KINDS.includes(decision.snapshot?.kind))
    || !(decision.snapshot?.id === null || isIdentityDigest(decision.snapshot?.id))) {
    errors.push({
      code: 'snapshot-identity-invalid',
      path: 'decision.snapshot',
      message: 'A decision must carry the evaluated snapshot kind and its identity, or null when no snapshot was captured.',
    });
  }

  if (decision.environment?.isolation !== ISOLATION
    || decision.environment?.sourceMutable !== false
    || decision.environment?.snapshotId !== decision.snapshot?.id) {
    errors.push({
      code: 'environment-identity-invalid',
      path: 'decision.environment',
      message: 'The environment must name the materialized snapshot it isolates and must never report mutable source.',
    });
  }

  if (!isIdentityDigest(decision.configurationId)) {
    errors.push({
      code: 'configuration-identity-invalid',
      path: 'decision.configurationId',
      message: 'A decision must carry the trusted configuration identity.',
    });
  }

  if (!Array.isArray(decision.checks)) {
    errors.push({
      code: 'checks-invalid',
      path: 'decision.checks',
      message: 'A decision must list its check results.',
    });
  } else {
    decision.checks.forEach((check, index) => validateCheckResult(check, index, errors));
  }

  if (!Array.isArray(decision.advisories)) {
    errors.push({
      code: 'advisories-invalid',
      path: 'decision.advisories',
      message: 'A decision must list advisory check identities, even when empty.',
    });
  }

  if (!(decision.bypass === null || isPlainObject(decision.bypass))) {
    errors.push({
      code: 'bypass-invalid',
      path: 'decision.bypass',
      message: 'Bypass data must be an object or null.',
    });
  }

  for (const field of [
    'requiredClaims',
    'provedClaims',
    'gaps',
    'acceptanceCriteria',
    'provedAcceptanceCriteria',
    'acceptanceGaps',
    'limitations',
  ]) {
    if (!Array.isArray(decision.coverage?.[field])) {
      errors.push({
        code: 'coverage-invalid',
        path: `decision.coverage.${field}`,
        message: `Coverage must list ${field}, even when empty.`,
      });
    }
  }

  if (decision.coverage?.scope !== decision.task?.purpose
    || !EVALUATION_PURPOSES.includes(decision.coverage?.scope)) {
    errors.push({
      code: 'coverage-invalid',
      path: 'decision.coverage.scope',
      message: 'Coverage must name the same Evaluation scope the decision task carries.',
    });
  }

  // SG-SCOPE-001 as a contract invariant rather than an implementation habit:
  // a regression-only decision can never carry acceptance coverage, and it must
  // say what its evidence does not prove.
  if (decision.coverage?.scope === 'regression-only') {
    const claimed = ['acceptanceCriteria', 'provedAcceptanceCriteria', 'acceptanceGaps']
      .filter((field) => (decision.coverage?.[field] ?? []).length > 0);

    if (claimed.length > 0) {
      errors.push({
        code: 'coverage-scope-violation',
        path: 'decision.coverage',
        message: `Regression-only evidence never claims acceptance coverage; ${claimed.join(', ')} must be empty.`,
      });
    }

    if ((decision.coverage?.limitations ?? []).length === 0) {
      errors.push({
        code: 'coverage-scope-violation',
        path: 'decision.coverage.limitations',
        message: 'Regression-only evidence must report the coverage limitation it carries.',
      });
    }

    if ((decision.checks ?? []).some(
      (check) => (check?.assertions ?? []).some((assertion) => assertion?.kind === 'acceptance'),
    )) {
      errors.push({
        code: 'coverage-scope-violation',
        path: 'decision.checks',
        message: 'Regression-only evidence never presents an acceptance-linked Check assertion.',
      });
    }
  }

  if (!isNonEmptyString(decision.integrity?.runnerVersion)
    || !isPlainObject(decision.integrity?.providerVersions)
    || !Array.isArray(decision.integrity?.changedGraderSurfaces)
    || typeof decision.integrity?.controlSurfaceChanged !== 'boolean'
    || decision.integrity?.configurationId !== decision.configurationId
    || decision.integrity?.snapshotId !== decision.snapshot?.id
    || decision.integrity?.environmentId !== decision.environment?.id) {
    errors.push({
      code: 'integrity-invalid',
      path: 'decision.integrity',
      message: 'Integrity must bind the runner, provider, configuration, environment, and snapshot identities of this evaluation and report its Grader surface changes.',
    });
  }

  const binding = decision.integrity?.runtimeBinding;

  if (!isPlainObject(binding)
    || typeof binding.required !== 'boolean'
    || !(binding.proved === null || typeof binding.proved === 'boolean')
    || !Array.isArray(binding.probes)
    || !(binding.servedSourceId === null || isIdentityDigest(binding.servedSourceId))
    || !(binding.reasonCode === null || REASON_CODES.includes(binding.reasonCode))) {
    errors.push({
      code: 'runtime-binding-invalid',
      path: 'decision.integrity.runtimeBinding',
      message: 'Integrity must state whether served-source binding was required, whether it was proved, and the probes that decided it.',
    });
  } else if (binding.required === true && binding.proved !== true
    && decision.checks.some((check) => check.outcome === 'passed'
      && (check.assertions ?? []).some((assertion) => assertion.kind === 'acceptance'))) {
    // SG-EVAL-002: unproved served-source binding can never underwrite an
    // acceptance claim about the snapshot.
    errors.push({
      code: 'runtime-binding-violation',
      path: 'decision.integrity.runtimeBinding',
      message: 'HTTP or browser evidence never authorizes a snapshot whose served source was not proved.',
    });
  }

  for (const [index, surface] of (decision.integrity?.changedGraderSurfaces ?? []).entries()) {
    if (!isPlainObject(surface)
      || !GRADER_SURFACE_KINDS.includes(surface.kind)
      || !isNonEmptyString(surface.path)
      || !(surface.checkId === null || isNonEmptyString(surface.checkId))
      || !(surface.role === null || isNonEmptyString(surface.role))
      || !(surface.identity === null || isIdentityDigest(surface.identity))) {
      errors.push({
        code: 'grader-surface-invalid',
        path: `decision.integrity.changedGraderSurfaces[${index}]`,
        message: 'Every reported Grader surface must name its kind, repository-relative path, owning check or null, role or null, and evaluated content identity or null.',
      });
    }
  }

  if (!isIdentityDigest(decision.evidence?.id)
    || decision.evidence?.format !== EVIDENCE_FORMAT
    || typeof decision.evidence?.persisted !== 'boolean') {
    errors.push({
      code: 'evidence-identity-invalid',
      path: 'decision.evidence',
      message: 'A decision must carry an evidence identity, its format, and whether the envelope was persisted.',
    });
  }

  if (!Array.isArray(decision.diagnostics)) {
    errors.push({
      code: 'diagnostics-invalid',
      path: 'decision.diagnostics',
      message: 'A decision must list its diagnostics, even when empty.',
    });
  } else {
    decision.diagnostics.forEach((diagnostic, index) => {
      if (!isPlainObject(diagnostic)
        || !REASON_CODES.includes(diagnostic.reasonCode)
        || !isNonEmptyString(diagnostic.detail)) {
        errors.push({
          code: 'diagnostics-invalid',
          path: `decision.diagnostics[${index}]`,
          message: 'Every diagnostic must carry a contract reason code and a readable detail.',
        });
      }
    });
  }

  return errors;
};

/**
 * Normalize one raw executor attempt into exactly one contract outcome and one
 * reason code. Passed and failed are decided by the exit code through the
 * settled `resolveOutcome` semantics; every other shape is a harness failure
 * and can only become `unverified` (NFR-REL-003).
 */
export const classifyAttempt = (attempt, { applicable = true, successExitCodes = [0] } = {}) => {
  if (applicable === false) {
    return { outcome: 'not-applicable', reasonCode: 'not-applicable' };
  }

  if (!isPlainObject(attempt)) {
    return { outcome: 'unverified', reasonCode: 'malformed-output' };
  }

  if (UNVERIFIED_REASONS.includes(attempt.reasonCode)) {
    return { outcome: 'unverified', reasonCode: attempt.reasonCode };
  }

  if (attempt.timedOut === true) {
    return { outcome: 'unverified', reasonCode: 'timeout' };
  }

  if (attempt.error) {
    return { outcome: 'unverified', reasonCode: 'crash' };
  }

  if (attempt.malformedOutput === true) {
    return { outcome: 'unverified', reasonCode: 'malformed-output' };
  }

  const outcome = resolveOutcome({
    applicable: true,
    executed: attempt.executed === true,
    exit_code: Number.isInteger(attempt.exitCode) ? attempt.exitCode : null,
    timed_out: false,
    error: null,
    success_exit_codes: successExitCodes,
  });

  if (outcome === 'unverified') {
    return { outcome, reasonCode: 'malformed-output' };
  }

  return {
    outcome,
    reasonCode: outcome === 'passed' ? 'grader-positive' : 'grader-negative',
  };
};

/**
 * Reduce a check's preserved attempts to one outcome. Equivalent attempts that
 * disagree are a conflict: the gate never picks the convenient one and never
 * silently retries, so the check becomes `unverified` (FR-EVAL-008, RISK-007).
 */
export const reconcileAttempts = (attempts) => {
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return { outcome: 'unverified', reasonCode: 'malformed-output' };
  }

  const outcomes = new Set(attempts.map((attempt) => attempt.outcome));

  if (outcomes.size > 1) {
    return { outcome: 'unverified', reasonCode: 'attempt-conflict' };
  }

  return { outcome: attempts[0].outcome, reasonCode: attempts[0].reasonCode };
};
