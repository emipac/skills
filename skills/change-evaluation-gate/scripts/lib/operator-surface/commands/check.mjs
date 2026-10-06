import { OPERATION, PROTOCOL_VERSION } from '../../evaluation-contract.mjs';
import { failure } from '../outcomes.mjs';
import { evaluateActivatedTree } from '../../preflight-runner.mjs';

/**
 * The two trees `gate check` can be asked about, and the request each one is.
 *
 * The working tree is asked exactly as the desktop preflight asks it; the index
 * exactly as the pre-commit hook grades it — the same snapshot kind and the
 * same purpose — so either answer is the answer that hook would give. Neither
 * is inferred from the other (`TB-061`).
 */
const CHECK_SCOPES = Object.freeze({
  worktree: Object.freeze({
    change: { kind: 'worktree', baseRevision: 'HEAD' },
    evaluation: { purpose: 'regression-only', contractRef: null },
    describes: 'the working tree against HEAD, as the desktop preflight evaluates it',
  }),
  staged: Object.freeze({
    change: { kind: 'git-index', baseRevision: 'HEAD' },
    evaluation: { purpose: 'change-acceptance-and-regression', contractRef: null },
    describes: 'the staged index against HEAD, as the pre-commit hook evaluates it',
  }),
});

/**
 * Who asked, as the evaluation request and the Evidence store record it.
 *
 * The request contract requires an invoking identity, and this is the
 * operator's own: it is no declared adapter, so nothing presents it through a
 * client's feedback channel, and no client's loop guard — which counts its own
 * evaluation identity — can ever count what it records (`FR-ADAPT-005`).
 */
const CHECK_CLIENT = Object.freeze({ id: 'gate-check', surface: 'operator-terminal' });

/** What a check is, stated on every rendering of one (`FR-EVAL-001`, `SG-TRUST-001`). */
const CHECK_LIMIT = 'this is what a hook would decide for this tree, not a decision: it authorizes nothing, consumes no bypass grant, and every commit is still evaluated by the pre-commit hook.';

/**
 * `gate check` — evaluate the working tree, or with `--staged` the index, and
 * report the decision a hook would produce.
 *
 * It is an operator act, not a client event: no payload, no adapter, no
 * session, no loop guard, and no feedback channel. It calls the evaluation the
 * preflight calls — `evaluateActivatedTree`, which captures the snapshot,
 * observes the control surface, runs the pinned programs, and calls `evaluate`
 * — so its answer cannot drift from a hook's (`NFR-REL-001`, `SG-EVAL-001`).
 * Its role is `preflight`, so the decision is `not-authoritative` by
 * construction; it reads no bypass grant and writes nothing a hook reads
 * (`FR-EVAL-001`).
 *
 * Evidence: a passing check appends nothing and one that did not pass persists
 * its decision (`RISK-010`), for the working tree and the index alike — the
 * commit runner records every decision because that record is what its
 * authorization rests on, and a check authorizes nothing.
 */
export const operateCheck = async ({ repositoryRoot, environment, selector }) => {
  const scope = selector?.staged === true ? 'staged' : 'worktree';
  const { change, evaluation, describes } = CHECK_SCOPES[scope];
  const invocation = {
    role: 'preflight',
    trigger: 'work-complete',
    adapter: { ...CHECK_CLIENT, version: PROTOCOL_VERSION, capabilities: { nativeBlocking: false } },
    sessionId: `gate-check:${scope}`,
  };
  const started = performance.now();
  let evaluated;

  try {
    evaluated = await evaluateActivatedTree({
      protocolVersion: PROTOCOL_VERSION,
      operation: OPERATION,
      repository: { root: repositoryRoot },
      change: { ...change },
      evaluation: { ...evaluation },
      invocation,
    }, { environment, client: CHECK_CLIENT, recordPassing: false });
  } catch (error) {
    return failure({
      command: 'check',
      reasonCode: 'runner-failed',
      detail: `the evaluation failed internally (${error.message}); nothing about this tree was verified.`,
    });
  }

  if (!evaluated.ok) {
    return failure({ command: 'check', reasonCode: evaluated.reasonCode, detail: evaluated.detail });
  }

  if (evaluated.findings.length > 0) {
    return failure({
      command: 'check',
      reasonCode: 'decision-malformed',
      detail: `the evaluation returned a decision that could not be read against the evaluation contract (${evaluated.findings.length} contract finding${evaluated.findings.length === 1 ? '' : 's'}), so nothing about this tree was verified.`,
    });
  }

  const { decision } = evaluated;
  const reference = decision.evidence.reference ?? null;

  return {
    command: 'check',
    healthy: decision.outcome === 'passed',
    observation: {
      scope,
      describes,
      authoritative: false,
      invocation: {
        role: invocation.role,
        trigger: invocation.trigger,
        adapter: CHECK_CLIENT.id,
        sessionId: invocation.sessionId,
      },
      evaluationId: decision.evaluationId,
      snapshot: {
        kind: decision.snapshot.kind,
        id: decision.snapshot.id,
        baseRevision: decision.snapshot.baseRevision,
      },
      outcome: decision.outcome,
      authorization: decision.authorization,
      checks: decision.checks.map((entry) => ({
        id: entry.id,
        policy: entry.policy,
        outcome: entry.outcome,
        reasonCode: entry.reasonCode,
        summary: entry.summary,
      })),
      diagnostics: decision.diagnostics.map(({ reasonCode, detail }) => ({ reasonCode, detail })),
      graderSurfaces: decision.integrity.changedGraderSurfaces,
      dependencies: decision.environment.dependencies,
      redaction: evaluated.redaction,
      elapsedMs: Math.round(performance.now() - started),
      evidence: {
        appended: decision.evidence.persisted === true,
        evidenceId: reference?.evidenceId ?? null,
        storeRoot: reference?.storeRoot ?? evaluated.store.root ?? null,
        notRecorded: reference?.notRecorded ?? null,
        reasonCode: reference?.reasonCode ?? null,
      },
      limit: CHECK_LIMIT,
    },
    mutation: null,
  };
};
