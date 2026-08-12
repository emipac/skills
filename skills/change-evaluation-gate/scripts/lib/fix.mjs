/**
 * The explicit fix operation: the only place a declared mutating command runs.
 *
 * `runFix(request, dependencies) -> result`. It applies each declared mutating
 * command to the maintainer's repository in the order its provider declared,
 * and then delegates one complete non-mutating evaluation of the resulting
 * snapshot. Authorization is read from that new decision and from nothing else:
 * a mutation never authorizes itself, and the decision it invalidated is
 * recorded as superseded rather than reused (FR-POL-009, FR-PROF-010,
 * AC-POL-004).
 *
 * Ordering is provider-declared data. This module reads a fix plan and holds no
 * opinion about which command should run first, so it contains no tool name and
 * no stack branch (SG-OWNER-001).
 *
 * Mutation and evaluation reach the outside world through two separate seams:
 * `executeFix` may mutate the repository, `execute` may not. Evaluation can
 * therefore never be handed the mutating seam by accident.
 */

import { createHash } from 'node:crypto';

import { evaluate } from './evaluate.mjs';
import { FIX_OPERATION, FIX_ROLE } from './mutation.mjs';
import { authorizationFor } from './policy.mjs';

export {
  FIX_OPERATION,
  FIX_ROLE,
  MUTATION_REJECTIONS,
  declaredFixCommands,
  mutatingChecks,
  mutationDiagnostic,
} from './mutation.mjs';

/**
 * What one mutation step did. These are deliberately not Check outcomes: a
 * mutation produces no evidence, and reporting it as `passed` would blur the
 * line the fix operation exists to draw.
 */
export const MUTATION_OUTCOMES = Object.freeze(['applied', 'failed', 'unverified', 'not-run']);

const identity = (value) => `sha256:${createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex')}`;

const classifyMutation = (attempt, successExitCodes) => {
  if (!attempt || typeof attempt !== 'object') {
    return { outcome: 'unverified', reasonCode: 'malformed-output' };
  }

  if (attempt.timedOut === true) {
    return { outcome: 'unverified', reasonCode: 'timeout' };
  }

  if (attempt.error) {
    return { outcome: 'unverified', reasonCode: 'crash' };
  }

  if (attempt.executed !== true || !Number.isInteger(attempt.exitCode)) {
    return { outcome: 'unverified', reasonCode: 'malformed-output' };
  }

  return successExitCodes.includes(attempt.exitCode)
    ? { outcome: 'applied', reasonCode: 'grader-positive' }
    : { outcome: 'failed', reasonCode: 'grader-negative' };
};

/**
 * Resolve the declared fix plan into executable steps.
 *
 * A plan entry naming an unresolved check, or a check that declares no separate
 * fix command, is a visible configuration diagnostic rather than a guessed
 * mutation.
 */
export const planMutations = ({ checks = [], fixPlan = [] } = {}) => {
  const byId = new Map((checks ?? []).map((check) => [check.id, check]));
  const steps = [];
  const diagnostics = [];

  for (const entry of fixPlan ?? []) {
    const check = byId.get(entry?.check_id);

    if (!check) {
      diagnostics.push({
        reasonCode: 'configuration-invalid',
        detail: `The declared fix plan names ${JSON.stringify(entry?.check_id ?? null)}, which no configured provider resolved.`,
      });

      continue;
    }

    if (!check.fix) {
      diagnostics.push({
        reasonCode: 'configuration-invalid',
        detail: `${check.id} is in the declared fix plan but declares no separate fix command.`,
      });

      continue;
    }

    steps.push({ checkId: check.id, order: entry.order ?? 0, check });
  }

  return { steps, diagnostics };
};

const buildResult = ({
  request,
  steps,
  mutations,
  reevaluation,
  priorDecision,
  diagnostics,
}) => {
  const role = request?.invocation?.role ?? null;
  const priorSnapshotId = priorDecision?.snapshot?.id ?? null;
  const reevaluatedSnapshotId = reevaluation?.snapshot?.id ?? null;
  // Authorization comes from the new decision or from nowhere. A fix that could
  // not be reevaluated denies, however cleanly every mutation applied.
  const authorization = reevaluation === null || reevaluatedSnapshotId === null
    ? authorizationFor(role, 'unverified')
    : reevaluation.authorization;

  return {
    protocolVersion: reevaluation?.protocolVersion ?? null,
    operation: FIX_OPERATION,
    fixId: identity({
      operation: FIX_OPERATION,
      repository: request?.repository?.root ?? null,
      sessionId: request?.invocation?.sessionId ?? null,
      steps: steps.map(({ checkId, order }) => ({ checkId, order })),
      supersededEvaluationId: priorDecision?.evaluationId ?? null,
    }),
    ordered: steps.map(({ checkId }) => checkId),
    mutations,
    mutated: mutations.some(({ outcome }) => outcome === 'applied'),
    halted: mutations.some(({ outcome }) => outcome === 'not-run'),
    supersededEvaluationId: priorDecision?.evaluationId ?? null,
    supersededSnapshotId: priorSnapshotId,
    reevaluation,
    // A reported fact, not the authorization rule: it says whether the graded
    // tree is a different tree from the one the superseded decision named.
    newSnapshot: reevaluatedSnapshotId !== null && reevaluatedSnapshotId !== priorSnapshotId,
    authorization,
    authorizedBy: reevaluation?.evaluationId ?? null,
    diagnostics,
  };
};

/**
 * Run the explicit fix operation and reevaluate the resulting snapshot.
 *
 * @param {object} request a fix request; the same envelope evaluation uses,
 *   carrying `operation: 'fix'`
 * @param {object} dependencies resolved checks, the provider-declared fix plan,
 *   the mutating `executeFix` seam, the superseded decision, and every
 *   dependency the delegated evaluation needs
 */
export const runFix = async (request, dependencies = {}) => {
  const {
    checks = [],
    fixPlan = [],
    executeFix = null,
    priorDecision = null,
    ...evaluationDependencies
  } = dependencies;
  const diagnostics = [];

  if (request?.operation !== FIX_OPERATION) {
    return buildResult({
      request,
      steps: [],
      mutations: [],
      reevaluation: null,
      priorDecision,
      diagnostics: [{
        reasonCode: 'configuration-invalid',
        detail: `Mutation requires the explicit ${FIX_OPERATION} operation; ${JSON.stringify(request?.operation ?? null)} never mutates.`,
      }],
    });
  }

  const { steps, diagnostics: planDiagnostics } = planMutations({ checks, fixPlan });

  diagnostics.push(...planDiagnostics);

  if (typeof executeFix !== 'function') {
    return buildResult({
      request,
      steps,
      mutations: [],
      reevaluation: null,
      priorDecision,
      diagnostics: [...diagnostics, {
        reasonCode: 'configuration-invalid',
        detail: 'No mutating execution seam was bound; the fix operation never falls back to the evaluation seam.',
      }],
    });
  }

  const mutations = [];
  let halted = false;

  for (const step of steps) {
    if (halted) {
      mutations.push({
        checkId: step.checkId,
        order: step.order,
        outcome: 'not-run',
        reasonCode: 'configuration-invalid',
        exitCode: null,
        durationMs: 0,
      });

      continue;
    }

    let attempt;

    try {
      attempt = await executeFix({
        checkId: step.checkId,
        role: FIX_ROLE,
        command: step.check.fix,
        repositoryRoot: request.repository.root,
        timeoutSeconds: step.check.timeout_seconds,
        allowedEnvironment: step.check.fix?.allowed_environment ?? [],
      });
    } catch (error) {
      attempt = { executed: false, exitCode: null, error: error.message, durationMs: 0 };
    }

    const { outcome, reasonCode } = classifyMutation(
      attempt,
      step.check.evidence?.success_exit_codes ?? [0],
    );

    mutations.push({
      checkId: step.checkId,
      order: step.order,
      outcome,
      reasonCode,
      exitCode: Number.isInteger(attempt?.exitCode) ? attempt.exitCode : null,
      durationMs: Number.isInteger(attempt?.durationMs) ? attempt.durationMs : 0,
    });

    // Ordering exists because a later mutation assumes the earlier one landed.
    // Continuing past a failure would apply the plan out of its declared order.
    if (outcome !== 'applied') {
      halted = true;
      diagnostics.push({
        reasonCode: 'configuration-invalid',
        detail: `${step.checkId} did not apply its declared fix command; the remaining declared mutations were not run.`,
      });
    }
  }

  // Whatever the mutations did, only a complete non-mutating evaluation of the
  // resulting snapshot may authorize it.
  const reevaluation = await evaluate(
    { ...request, operation: 'evaluate' },
    { ...evaluationDependencies, checks },
  );

  return buildResult({ request, steps, mutations, reevaluation, priorDecision, diagnostics });
};
