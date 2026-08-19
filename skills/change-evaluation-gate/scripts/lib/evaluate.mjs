/**
 * Gate evaluation process seam: `evaluate(request) -> decision`.
 *
 * One versioned operation materializes the exact proposed snapshot in an
 * isolated execution root, delegates ordered check resolution and execution to
 * the existing `verify-change` seam, and returns one complete decision. It
 * never grades the live worktree, never mutates evaluated source, and never
 * retries a check silently.
 *
 * Repository Gate policy is applied over the completed decision: required and
 * advisory severity, the total budget, and the supported one-shot bypass.
 *
 * Deliberately not implemented here and returned as declared contract fields
 * only: Grader-surface change detection and runtime binding, evidence
 * persistence, and coordination.
 */

import { createHash } from 'node:crypto';

import { coordinationFailureDiagnostic } from './coordination.mjs';
import {
  resolveDeliveryContract,
  resolveScope,
} from './delivery-contract.mjs';
import {
  EVIDENCE_FORMAT,
  PROTOCOL_VERSION,
  REASON_OUTCOMES,
  SNAPSHOT_TARGET_KINDS,
  classifyAttempt,
  reconcileAttempts,
  validateEvaluationRequest,
} from './evaluation-contract.mjs';
import { withoutRunLocalValues } from './evidence-identity.mjs';
import { changedGraderSurfaces, touchesControlSurface } from './grader-surface.mjs';
import { mutationDiagnostic } from './mutation.mjs';
import {
  authorizationFor,
  createBudgetLedger,
  decisionOutcome,
  resolveBypass,
} from './policy.mjs';
import {
  proveServedSource,
  requiresServedSourceBinding,
  unboundRuntime,
} from './runtime-binding.mjs';
import { reconcileControlSurface } from './security-control.mjs';
import { ISOLATION, captureSnapshot, verifySnapshot } from './snapshot.mjs';
import { delegateResolution } from './verification-seam.mjs';

export { PROTOCOL_VERSION };

const HISTORY_VISIBILITY = 'policy-defined';

const CACHE_POLICY = 'declared-only';

const UNKNOWN_RUNNER_VERSION = 'unresolved';

const canonical = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value ?? null);
};

const identity = (value) => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;

const summarize = (checkId, outcome, reasonCode) => `${checkId}: ${outcome} (${reasonCode})`;

export { authorizationFor, decisionOutcome };

/**
 * Resolve the Evaluation scope for one request. A decision that never reached a
 * materialized snapshot cannot have read a contract, so it is regression-only
 * and says which limitation it carries.
 */
const scopeOf = async (request, executionRoot) => {
  const contract = await resolveDeliveryContract(
    executionRoot,
    request?.evaluation?.contractRef ?? null,
  );
  const { scope, limitations } = resolveScope(request?.evaluation?.purpose, contract);

  return {
    scope,
    limitations,
    status: contract.status,
    acceptanceIds: scope === 'change-acceptance-and-regression' ? contract.acceptanceIds : [],
    contractId: contract.contents === null ? null : identity(contract.contents),
  };
};

const buildDecision = ({
  request,
  snapshot,
  checks,
  diagnostics,
  outcome,
  profile,
  policy,
  runnerVersion,
  providerVersions,
  scope,
  delegation,
  surfaces = [],
  runtimeBinding = null,
  bypass = null,
}) => {
  const purpose = scope.scope;
  const contractId = scope.contractId;
  const configurationId = identity({
    profile,
    policy: policy ?? null,
    runnerVersion,
    providerVersions,
    checks: checks.map((check) => ({ id: check.id, stage: check.stage, policy: check.policy })),
  });
  const snapshotId = snapshot?.id ?? null;
  const environmentId = identity({
    isolation: ISOLATION,
    snapshotId,
    configurationId,
    runnerVersion,
    historyVisibility: HISTORY_VISIBILITY,
    cachePolicy: CACHE_POLICY,
  });
  const task = {
    id: identity({ purpose, contractId }),
    purpose,
    contractId,
    contractStatus: scope.status,
  };
  const required = checks.filter((check) => check.policy === 'required');
  const requiredClaims = [...new Set(required.flatMap(
    (check) => check.assertions.map((assertion) => assertion.id),
  ))].sort();
  const provedClaims = [...new Set(required
    .filter((check) => check.outcome === 'passed')
    .flatMap((check) => check.assertions.map((assertion) => assertion.id)))].sort();
  // Only a valid delivery contract states what the change was asked to prove.
  // An acceptance criterion is proved by a passed required acceptance
  // assertion; anything else is an explicit gap (FR-EVAL-007, SG-SCOPE-001).
  const acceptanceCriteria = [...scope.acceptanceIds].sort();
  const provedAcceptanceCriteria = acceptanceCriteria.filter(
    (acceptanceId) => required.some((check) => check.outcome === 'passed'
      && check.assertions.some(
        (assertion) => assertion.kind === 'acceptance' && assertion.id === acceptanceId,
      )),
  );
  const body = {
    protocolVersion: PROTOCOL_VERSION,
    evaluationId: identity({
      protocolVersion: PROTOCOL_VERSION,
      taskId: task.id,
      snapshotId,
      configurationId,
      environmentId,
      sessionId: request?.invocation?.sessionId ?? null,
      role: request?.invocation?.role ?? null,
      trigger: request?.invocation?.trigger ?? null,
      adapter: request?.invocation?.adapter?.id ?? null,
    }),
    outcome,
    authorization: authorizationFor(request?.invocation?.role, outcome),
    task,
    snapshot: {
      kind: SNAPSHOT_TARGET_KINDS.includes(request?.change?.kind) ? request.change.kind : null,
      id: snapshotId,
      baseRevision: request?.change?.baseRevision ?? null,
      executionRoot: snapshot?.executionRoot ?? null,
    },
    environment: {
      id: environmentId,
      isolation: ISOLATION,
      snapshotId,
      sourceMutable: false,
      historyVisibility: HISTORY_VISIBILITY,
      cachePolicy: CACHE_POLICY,
    },
    configurationId,
    profile,
    checks,
    advisories: checks
      .filter((check) => check.policy === 'advisory' && check.outcome !== 'passed')
      .map((check) => check.id),
    bypass,
    coverage: {
      scope: purpose,
      requiredClaims,
      provedClaims,
      gaps: requiredClaims.filter((claim) => !provedClaims.includes(claim)),
      acceptanceCriteria,
      provedAcceptanceCriteria,
      acceptanceGaps: acceptanceCriteria.filter(
        (acceptanceId) => !provedAcceptanceCriteria.includes(acceptanceId),
      ),
      limitations: scope.limitations,
    },
    integrity: {
      configurationId,
      runnerVersion,
      providerVersions,
      environmentId,
      snapshotId,
      changedGraderSurfaces: surfaces,
      controlSurfaceChanged: touchesControlSurface(surfaces),
      runtimeBinding: runtimeBinding ?? unboundRuntime(snapshotId),
    },
    delegation,
    diagnostics,
  };

  return {
    ...body,
    // Run-local values are excluded from the evidence identity: the host-local
    // execution root names where the snapshot was materialized on this machine
    // and an attempt's duration is how long it took here, so including either
    // would make an identical binding produce a different evidence identity
    // (NFR-REL-001). The rule is the store's own, stated once, so the identity
    // the decision computes and the identity the store assigns describe the
    // same thing.
    //
    // `persisted` and `reference` are filled in by the Evidence store when one
    // is bound; an unbound gate still returns a complete, stable identity.
    evidence: {
      id: identity(withoutRunLocalValues(body)),
      format: EVIDENCE_FORMAT,
      persisted: false,
      reference: null,
    },
  };
};

const executeCheck = async ({ descriptor, executionRoot, execute, budgetRemainingMs }) => {
  const successExitCodes = descriptor.evidence?.success_exit_codes ?? [0];
  let raw;

  try {
    raw = await execute({
      checkId: descriptor.id,
      // Only the non-mutating evaluation command is ever invoked. A descriptor's
      // fix command is never executed by evaluation (FR-EVAL-005).
      role: 'evaluate',
      command: descriptor.evaluate,
      executionRoot,
      timeoutSeconds: descriptor.timeout_seconds,
      // The remaining total budget bounds this attempt as well as its own
      // confirmed timeout; whichever runs out first terminates the tree.
      budgetRemainingMs,
      allowedEnvironment: descriptor.evaluate?.allowed_environment ?? [],
    });
  } catch (error) {
    raw = { executed: false, exitCode: null, error: error.message, durationMs: 0 };
  }

  const rawAttempts = Array.isArray(raw) ? raw : [raw];
  const outputs = [];
  const attempts = rawAttempts.map((attempt, index) => {
    const { outcome, reasonCode } = classifyAttempt(attempt, { successExitCodes });

    // Captured output never enters the decision: the decision states what was
    // decided, and the Evidence store owns bounding and redacting what was
    // seen. An executor that captures nothing simply offers nothing.
    if (typeof attempt?.output === 'string' && attempt.output.length > 0) {
      outputs.push({ checkId: descriptor.id, attempt: index + 1, text: attempt.output });
    }

    return {
      attempt: index + 1,
      outcome,
      reasonCode,
      exitCode: Number.isInteger(attempt?.exitCode) ? attempt.exitCode : null,
      durationMs: Number.isInteger(attempt?.durationMs) ? attempt.durationMs : 0,
    };
  });

  return { attempts, outputs };
};

/**
 * Every applicable check reports at least one atomic Check assertion. A check
 * that declares no claim still states what it decided, under its own stable
 * identity, so a decision never contains a silent check (FR-PROF-005).
 */
const assertionsFor = (descriptor, acceptanceIds, outcome, summary) => {
  const claims = descriptor.evidence?.claims ?? [];
  const declared = claims.length > 0 ? claims : [descriptor.id];

  return declared.map((claim) => ({
    id: claim,
    kind: acceptanceIds.has(claim) ? 'acceptance' : 'regression',
    outcome,
    summary,
  }));
};

const resultFor = (descriptor, attempts, { override = null, acceptanceIds = new Set() } = {}) => {
  const { outcome, reasonCode } = override ?? reconcileAttempts(attempts);
  const summary = summarize(descriptor.id, outcome, reasonCode);

  return {
    id: descriptor.id,
    stage: descriptor.stage,
    policy: descriptor.policy,
    grader: {
      type: 'code',
      method: descriptor.capability,
      target: descriptor.evaluate?.evidence_category ?? descriptor.stage,
    },
    outcome,
    reasonCode,
    summary,
    assertions: assertionsFor(descriptor, acceptanceIds, outcome, summary),
    attempts,
  };
};

/**
 * Grade one exact snapshot and return one complete decision.
 *
 * @param {object} request versioned evaluation request
 * @param {object} dependencies resolved gate inputs and the delegated executor
 */
const evaluateSnapshot = async (request, dependencies = {}) => {
  const profile = dependencies.profile ?? null;
  const policy = dependencies.policy ?? null;
  const runnerVersion = dependencies.runnerVersion ?? UNKNOWN_RUNNER_VERSION;
  const providerVersions = dependencies.providerVersions ?? {};
  const diagnostics = [];

  const requestErrors = validateEvaluationRequest(request);

  if (requestErrors.length > 0) {
    return buildDecision({
      request,
      snapshot: null,
      checks: [],
      diagnostics: [{
        reasonCode: 'configuration-invalid',
        detail: `The evaluation request is not valid: ${requestErrors.map((error) => `${error.path} ${error.code}`).join('; ')}.`,
      }],
      outcome: 'unverified',
      profile,
      policy,
      runnerVersion,
      providerVersions,
      scope: await scopeOf(request, null),
      delegation: delegateResolution({ checks: [], changedPaths: [] }).delegation,
    });
  }

  if (typeof dependencies.execute !== 'function') {
    return buildDecision({
      request,
      snapshot: null,
      checks: [],
      diagnostics: [{
        reasonCode: 'configuration-invalid',
        detail: 'No verification execution seam was bound; evaluation never builds a parallel verifier.',
      }],
      outcome: 'unverified',
      profile,
      policy,
      runnerVersion,
      providerVersions,
      scope: await scopeOf(request, null),
      delegation: delegateResolution({ checks: [], changedPaths: [] }).delegation,
    });
  }

  // Evaluation is check-only. A binding that offers a declared mutating
  // command as its evaluation command is refused before anything is
  // materialized or executed; mutation is reachable only through the explicit
  // fix operation (FR-POL-009, AC-POL-004).
  const mutation = mutationDiagnostic(dependencies.checks ?? []);

  if (mutation !== null) {
    return buildDecision({
      request,
      snapshot: null,
      checks: [],
      diagnostics: [mutation],
      outcome: 'unverified',
      profile,
      policy,
      runnerVersion,
      providerVersions,
      scope: await scopeOf(request, null),
      delegation: delegateResolution({ checks: [], changedPaths: [] }).delegation,
    });
  }

  const capture = await captureSnapshot({
    repositoryRoot: request.repository.root,
    kind: request.change.kind,
    baseRevision: request.change.baseRevision,
    executionRoot: dependencies.executionRoot,
    runGit: dependencies.runGit,
    // Which directories this project installs its dependencies into is the
    // project's own declaration. Gate core provides what it is told to provide
    // and knows nothing about which stack asked (SG-OWNER-001, FR-EVAL-001).
    dependencyRoots: policy?.execution?.dependency_roots ?? [],
  });

  if (!capture.captured) {
    return buildDecision({
      request,
      snapshot: null,
      checks: [],
      diagnostics: [{ reasonCode: capture.reasonCode, detail: capture.detail }],
      outcome: 'unverified',
      profile,
      policy,
      runnerVersion,
      providerVersions,
      scope: await scopeOf(request, null),
      delegation: delegateResolution({ checks: [], changedPaths: [] }).delegation,
    });
  }

  const { snapshot } = capture;

  // A declared dependency root the clone does not have is stated, by name,
  // before any check runs. Letting the evaluation proceed would produce a
  // fatal error from inside somebody's tool and report it as their code
  // failing, which is the shape this whole class of defect takes
  // (NFR-REL-003).
  for (const unavailable of [...capture.dependencies.missing, ...capture.dependencies.refused]) {
    diagnostics.push({
      reasonCode: 'dependency-root-unavailable',
      detail: `The declared dependency root ${JSON.stringify(unavailable)} could not be provided to this evaluation; a check that needs it cannot run and nothing here is proved.`,
    });
  }

  const scope = await scopeOf(request, snapshot.executionRoot);
  // A change that edits what judges it is reported before any check runs, so
  // the surfaces are named even when execution later fails (FR-EVAL-009).
  const surfaces = await changedGraderSurfaces({
    changedPaths: dependencies.changedPaths ?? capture.changedPaths,
    checks: dependencies.checks ?? [],
    declarations: dependencies.graderSurfaces ?? {},
    executionRoot: snapshot.executionRoot,
  });
  // Independent drift of a pinned Gate control surface ends the decision as
  // `unverified`: a gate that can no longer identify its own runtime, adapters,
  // hooks, receipt, trusted configuration, descriptors, or providers is not in
  // a position to authorize anything, whatever the checks report
  // (AC-SEC-001, NFR-SEC-004). It is reported, never repaired here.
  if (dependencies.controlSurface) {
    const reconciled = reconcileControlSurface({
      receipt: dependencies.controlSurface.receipt ?? null,
      observed: dependencies.controlSurface.observed ?? null,
    });

    if (reconciled.drifted) {
      diagnostics.push({
        reasonCode: reconciled.reasonCode,
        // The drifted surfaces are named, and so is the one confirmed operator
        // action that resolves them. Nothing is repaired here (FR-LIFE-019).
        detail: `The Gate control surface drifted independently of this change (${reconciled.findings.map((finding) => finding.surface).join(', ')}); nothing here is proved. Run \`gate repair\` to re-resolve and re-pin what this clone was activated with.`,
      });
    }
  }

  const acceptanceIds = new Set(scope.acceptanceIds);
  const changedPaths = dependencies.changedPaths ?? capture.changedPaths;
  const resolution = delegateResolution({
    checks: dependencies.checks ?? [],
    changedPaths,
    policy,
  });

  diagnostics.push(...resolution.diagnostics);

  const checks = [];
  const capturedOutputs = [];
  let runtimeBinding = null;

  // The binding is proved once per evaluation, on demand: a change with no
  // served evidence never probes a runtime, and every served check answers to
  // the same proof (FR-EVAL-010).
  const servedSourceBinding = async () => {
    if (runtimeBinding === null) {
      const runtime = typeof dependencies.resolveRuntime === 'function'
        ? await dependencies.resolveRuntime({ executionRoot: snapshot.executionRoot, snapshot })
        : null;

      runtimeBinding = {
        required: true,
        ...await proveServedSource({
          runtime,
          executionRoot: snapshot.executionRoot,
          fetchResource: dependencies.fetchResource,
        }),
        snapshotId: snapshot.id,
      };
    }

    return runtimeBinding;
  };

  const budget = createBudgetLedger({
    totalSeconds: policy?.budget?.total_seconds ?? null,
    skippable: policy?.execution?.budget_skippable ?? [],
  });

  for (const descriptor of resolution.ordered) {
    if (!descriptor.applicable) {
      checks.push(resultFor(descriptor.check, [], {
        acceptanceIds,
        override: { outcome: 'not-applicable', reasonCode: 'not-applicable' },
      }));

      continue;
    }

    // A prerequisite is proved or it is not. With no resolver bound, nothing is
    // proved, so a check that declares one is unverified rather than assumed
    // runnable.
    const missing = (descriptor.check.prerequisites ?? []).filter(
      (prerequisite) => typeof dependencies.resolvePrerequisite !== 'function'
        || dependencies.resolvePrerequisite(prerequisite) !== true,
    );

    if (missing.length > 0) {
      checks.push(resultFor(descriptor.check, [{
        attempt: 1,
        outcome: 'unverified',
        reasonCode: 'prerequisite-missing',
        exitCode: null,
        durationMs: 0,
      }], { acceptanceIds }));

      continue;
    }

    // HTTP and browser evidence is only about this snapshot when the runtime
    // that answers is proved to serve its materialized source. An unproved
    // binding is `unverified` and the check never runs: a result produced
    // against an unknown source is not evidence (SG-EVAL-002).
    if (requiresServedSourceBinding(descriptor.check)) {
      const binding = await servedSourceBinding();

      if (binding.proved !== true) {
        checks.push(resultFor(descriptor.check, [{
          attempt: 1,
          outcome: 'unverified',
          reasonCode: binding.reasonCode,
          exitCode: null,
          durationMs: 0,
        }], { acceptanceIds }));

        continue;
      }
    }

    // Budget admission is decided before the check starts. Only advisory work
    // the project confirmed as skippable is dropped; a required check that the
    // budget cannot cover becomes blocking `unverified` (FR-POL-005).
    const admission = budget.admit(descriptor.check);

    if (!admission.admitted) {
      checks.push(resultFor(descriptor.check, [], {
        acceptanceIds,
        override: { outcome: 'unverified', reasonCode: admission.reasonCode },
      }));

      continue;
    }

    const { attempts, outputs } = await executeCheck({
      descriptor: descriptor.check,
      executionRoot: snapshot.executionRoot,
      execute: dependencies.execute,
      budgetRemainingMs: budget.remainingMs(),
    });

    capturedOutputs.push(...outputs);

    for (const attempt of attempts) {
      budget.consume(attempt.durationMs);
    }

    checks.push(resultFor(descriptor.check, attempts, { acceptanceIds }));
  }

  // SG-EVAL-001 and NFR-SEC-001: the decision may only name the tree the checks
  // actually executed against.
  const verification = await verifySnapshot(snapshot);

  if (!verification.verified) {
    diagnostics.push({ reasonCode: verification.reasonCode, detail: verification.detail });
  }

  // An evaluation-level harness failure normalizes the whole decision, not only
  // one check: a decision can never pass around its own diagnostics.
  const gradedOutcome = diagnostics.some(
    (diagnostic) => REASON_OUTCOMES[diagnostic.reasonCode] === 'unverified',
  )
    ? 'unverified'
    : decisionOutcome(checks);

  // A bypass is applied over the completed decision. It never rewrites a check
  // and never removes a failure: it only changes the outcome to the visibly
  // distinct `bypassed` (FR-POL-007, SG-BYP-001).
  const bypass = resolveBypass({
    grant: dependencies.bypass ?? null,
    policy,
    snapshotId: snapshot.id,
    outcome: gradedOutcome,
    checks,
    ledger: dependencies.bypassLedger ?? null,
  });
  const outcome = bypass?.applied === true ? 'bypassed' : gradedOutcome;

  const graded = {
    request,
    snapshot,
    checks,
    diagnostics,
    outcome,
    bypass,
    profile,
    policy,
    runnerVersion,
    providerVersions,
    scope,
    surfaces,
    runtimeBinding,
    delegation: resolution.delegation,
  };

  return persistEvidence(
    buildDecision(graded),
    { store: dependencies.evidenceStore ?? null, outputs: capturedOutputs, graded },
  );
};

/**
 * Grade one exact snapshot under the bound coordination seam.
 *
 * A host that binds coordination serializes evaluation per Git common
 * directory. A lease that cannot be obtained ends the evaluation before
 * anything is materialized or executed: the decision is `unverified` with the
 * `coordination-failure` reason, which an authoritative role can only ever turn
 * into `deny` (FR-COORD-001, FR-COORD-005, NFR-REL-003, SG-COORD-001).
 *
 * A gate with no coordination bound is a single-client gate; it never pretends
 * to have serialized anything.
 *
 * @param {object} request versioned evaluation request
 * @param {object} dependencies resolved gate inputs, executor, and coordination
 */
export const evaluate = async (request, dependencies = {}) => {
  if (typeof dependencies.coordination?.acquire !== 'function') {
    return evaluateSnapshot(request, dependencies);
  }

  let lease;

  try {
    lease = await dependencies.coordination.acquire({ request });
  } catch (error) {
    lease = { acquired: false, reasonCode: 'lock-unavailable', detail: error.message };
  }

  if (lease?.acquired !== true) {
    return buildDecision({
      request,
      snapshot: null,
      checks: [],
      diagnostics: [coordinationFailureDiagnostic(
        `${lease?.reasonCode ?? 'lock-unavailable'}: ${lease?.detail ?? 'the evaluation lock could not be acquired.'}`,
      )],
      outcome: 'unverified',
      profile: dependencies.profile ?? null,
      policy: dependencies.policy ?? null,
      runnerVersion: dependencies.runnerVersion ?? UNKNOWN_RUNNER_VERSION,
      providerVersions: dependencies.providerVersions ?? {},
      scope: await scopeOf(request, null),
      delegation: delegateResolution({ checks: [], changedPaths: [] }).delegation,
    });
  }

  try {
    return await evaluateSnapshot(request, dependencies);
  } finally {
    if (typeof lease.release === 'function') {
      await lease.release();
    }
  }
};

/**
 * Append the completed decision to the bound Evidence store and report the
 * result on the decision itself.
 *
 * Persistence never invents a pass and never rewrites a check. It has exactly
 * one way to change a decision: a capture the store cannot prove safe makes the
 * decision `unverified`, because evidence that might carry a raw Sensitive
 * value is not evidence (SG-SECRET-001, RISK-006).
 */
const persistEvidence = async (decision, { store, outputs, graded }) => {
  if (store === null || typeof store.appendEvidence !== 'function') {
    return decision;
  }

  let result;

  try {
    result = await store.appendEvidence({ decision, outputs });
  } catch (error) {
    // A store that cannot be written is a diagnosable local fault, never a
    // reason to withhold a completed decision (NFR-OPER-001).
    result = { appended: false, reasonCode: 'evidence-store-unavailable', detail: error.message };
  }

  if (result.appended === true) {
    return {
      ...decision,
      evidence: {
        ...decision.evidence,
        persisted: true,
        reference: {
          evidenceId: result.evidenceId,
          storeRoot: store.root ?? null,
          appendedAt: result.entry?.appendedAt ?? null,
          blobIds: result.entry?.blobIds ?? [],
          reasonCode: null,
        },
      },
    };
  }

  const reference = {
    evidenceId: null,
    storeRoot: store.root ?? null,
    appendedAt: null,
    blobIds: [],
    reasonCode: result.reasonCode ?? 'evidence-store-unavailable',
  };

  if (result.reasonCode !== 'unsafe-capture') {
    return { ...decision, evidence: { ...decision.evidence, persisted: false, reference } };
  }

  const unsafe = buildDecision({
    ...graded,
    outcome: 'unverified',
    diagnostics: [...graded.diagnostics, {
      reasonCode: 'sensitive-capture-unsafe',
      detail: 'A declared Sensitive value survived redaction, so no evidence was persisted and nothing here is proved.',
    }],
  });

  return { ...unsafe, evidence: { ...unsafe.evidence, persisted: false, reference } };
};
