/**
 * The packaged desktop preflight runner.
 *
 * A desktop client's hook process starts this module. It reads the native
 * payload, looks up the adapter named on the command line, invokes the shared
 * `runAdapterEvaluation` seam against the working tree, and answers through
 * the feedback channel that adapter declared. It adds no policy, no
 * authority, and no evaluation of its own (FR-ADAPT-001, SG-SUPPORT-001).
 *
 * The exit status is always `0`. The client this program answers has no
 * exit-code contract for the event that launched it; everything the agent is
 * told travels through the declared channel.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  describeAdapter,
  formatFeedback,
  normalizeTurn,
  runAdapterEvaluation,
} from './adapters.mjs';
import { createBoundedExecutor } from './bounded-execution.mjs';
import { composeArguments, runtimeSearchPath } from './command-descriptor.mjs';
import { gateChecksFromConfiguration } from './configuration.mjs';
import { evaluate } from './evaluate.mjs';
import { openEvidenceStore } from './evidence-store.mjs';
import {
  commandOwner,
  contractFindings,
  observeControlSurface,
  openStore,
  pinnedRunners,
  resolveConfiguration,
  resolveReceipt,
} from './hook-runner.mjs';

const adapterIdFromArgv = (argv) => {
  const index = argv.indexOf('--adapter');

  if (index === -1 || typeof argv[index + 1] !== 'string' || argv[index + 1] === '') {
    return null;
  }

  return argv[index + 1];
};

const parseNative = (stdin) => {
  try {
    const native = JSON.parse(stdin);

    if (typeof native !== 'object' || native === null || Array.isArray(native)) {
      return { ok: false, detail: 'the native payload is not a JSON object.' };
    }

    return { ok: true, native };
  } catch (error) {
    return { ok: false, detail: `the native payload could not be read (${error.message}).` };
  }
};

const answer = ({ adapterId, view }) => ({
  exitCode: 0,
  stdout: formatFeedback({ adapterId, view }),
  stderr: '',
  view,
});

/**
 * Say nothing to the agent, and say why to the human.
 *
 * Silence is a decision here — the operator stopped, or an unchanged verdict
 * has been repeated enough — and silence a maintainer cannot distinguish from a
 * clean turn is the defect this runner exists to have stopped making. The
 * client surfaces hook stderr in its own panel, so the reason lands where a
 * person will see it while the agent's channel stays empty.
 */
const silence = ({ detail }) => ({
  exitCode: 0,
  stdout: '',
  stderr: `change-evaluation-gate: ${detail}\n`,
  view: null,
});

const unverified = ({ adapter, detail, family = 'output' }) => ({
  adapterId: adapter.id,
  surface: adapter.surface,
  role: adapter.role,
  outcome: 'unverified',
  authorization: 'not-authoritative',
  blocking: false,
  exitCode: 0,
  failure: { family, detail },
  presentation: {
    kind: 'unverified',
    evaluationId: null,
    outcome: 'unverified',
    authorization: 'not-authoritative',
    detail,
    checks: [],
  },
});

/**
 * How many times this exact evaluation has already been appended to this
 * clone's Evidence store, including the append this run just made.
 *
 * A store that cannot be read bounds nothing rather than silencing everything:
 * an unreadable log is not evidence that a verdict was already delivered.
 */
const timesAlreadyRecorded = async (store, evaluationId) => {
  if (store === null || typeof store.readLog !== 'function' || evaluationId === null) {
    return 0;
  }

  try {
    return (await store.readLog())
      .filter((entry) => entry?.evaluationId === evaluationId)
      .length;
  } catch {
    return 0;
  }
};

/**
 * Evaluate one native payload as a worktree preflight for the named adapter,
 * persisting evidence through the same store wiring the authoritative runner
 * uses (FR-EVID-001).
 */
export const runPreflight = async ({
  cwd: _cwd = process.cwd(),
  stdin = '',
  argv = [],
  environment = process.env,
  composeArguments: compose = composeArguments,
  evaluate: evaluateSeam = evaluate,
  openEvidenceStore: openStoreSeam = openEvidenceStore,
} = {}) => {
  const adapterId = adapterIdFromArgv(argv);
  const adapter = describeAdapter(adapterId);

  // No adapter, no declaration, and therefore no channel to answer through.
  // This is a misconfigured registration — a hook wired without `--adapter` —
  // and it is reported rather than left looking exactly like a clean turn.
  if (adapter === null) {
    return silence({
      detail: `no declared adapter was named on the command line${adapterId === null ? '' : ` (${adapterId})`}; this hook cannot answer any client. Register it with --adapter <id>.`,
    });
  }

  const parsed = parseNative(stdin);

  if (!parsed.ok) {
    return answer({
      adapterId: adapter.id,
      view: unverified({ adapter, detail: parsed.detail }),
    });
  }

  const turn = normalizeTurn({ adapterId: adapter.id, native: parsed.native });

  // The operator's decision is an input to this runner, never something it
  // overrides: a turn that was stopped is answered with nothing at all.
  if (turn.state === 'interrupted') {
    return silence({
      detail: `the turn ended as ${JSON.stringify(turn.status)} rather than completing, so nothing was evaluated and nothing is suggested.`,
    });
  }

  if (turn.state === 'unreadable') {
    return answer({
      adapterId: adapter.id,
      view: unverified({
        adapter,
        family: 'capability',
        detail: `${adapter.id} reported a turn status of ${JSON.stringify(turn.status)}, which it does not declare; a status this surface never declared is not evidence that the turn completed`,
      }),
    });
  }

  const maxIterations = adapter.capabilities.feedback?.maxIterations ?? null;

  // The client's own counter, where it advances. Every captured payload from a
  // real loop reported zero, so this bounds nothing on its own — it is the
  // cheap check, and the record below is the one that holds.
  if (Number.isInteger(maxIterations) && Number.isInteger(turn.iteration)
    && turn.iteration >= maxIterations) {
    return silence({
      detail: `this turn is auto-follow-up ${turn.iteration} of at most ${maxIterations}; the same preflight result has been reported enough.`,
    });
  }

  // The store this evaluation appended to, kept so the answer can be bounded by
  // what the gate has already recorded rather than by a client counter.
  let openedStore = null;

  // How many contract findings the returned decision produced, or `null` when
  // the contract accepted it. Only the count is kept: what the preflight
  // presents is submitted to an agent as its next user message, so a full dump
  // of findings would put a wall of contract text where a short instruction
  // belongs (`FR-ADAPT-005`).
  let rejectedFindingCount = null;

  const evaluateActivated = async (request) => {
    const configuration = await resolveConfiguration(request.repository.root);

    if (!configuration.ok) {
      throw new Error(configuration.detail);
    }

    const activation = await resolveReceipt(request.repository.root);

    if (!activation.ok) {
      throw new Error(activation.detail);
    }

    const { checks, errors } = gateChecksFromConfiguration(configuration.configuration);

    if (errors.length > 0) {
      throw new Error(
        `the configured verification commands cannot be evaluated: ${errors.map((issue) => `${issue.path}: ${issue.message}`).join(' ')}`,
      );
    }

    const runners = await pinnedRunners(checks, { receipt: activation.receipt, compose });

    if (!runners.ok) {
      throw new Error(runners.detail);
    }

    const store = await openStore({
      repository: { root: request.repository.root },
      activation,
      configuration,
      environment,
      openStoreSeam,
      client: {
        id: adapter.id,
        surface: adapter.surface,
        version: adapter.version,
      },
    });

    if (!store.ok) {
      throw new Error(store.detail);
    }

    openedStore = store.store;

    const executionRoot = await mkdtemp(path.join(tmpdir(), 'gate-preflight-exec-'));
    const executor = createBoundedExecutor({
      totalSeconds: configuration.policy?.budget?.total_seconds ?? null,
      resolveExecutable: (command) => runners.resolved.get(commandOwner(checks, command)) ?? null,
      environment,
      captureOutput: true,
      runtimePath: runtimeSearchPath([...runners.resolved.values()]),
    });

    try {
      const decision = await evaluateSeam(request, {
        executionRoot,
        runnerVersion: activation.receipt?.runtime?.runnerVersion ?? 'change-evaluation-gate/unpinned',
        providerVersions: { configuration: '1.0.0' },
        resolvePrerequisite: () => true,
        checks,
        policy: configuration.policy,
        execute: executor.execute,
        evidenceStore: store.store,
        // The same observation the authoritative runner makes, from the same
        // owner, so the two can never disagree about what this machine is
        // (`SG-OWNER-001`). Under preflight the same drift presents as
        // `unverified` and `not-authoritative`: it warns a maintainer, and it
        // blocks nothing (`SG-SUPPORT-001`).
        controlSurface: await observeControlSurface({ activation, configuration, resolved: runners.resolved }),
      });

      // The same contract the authoritative runner judges by, consulted at the
      // earliest point this runner owns the decision. A decision that runner
      // would refuse is not a set of check results this surface may render as
      // though someone had produced them (`AC-EVAL-002`, `NFR-REL-003`).
      const findings = contractFindings(decision);

      if (findings.length > 0) {
        rejectedFindingCount = findings.length;
      }

      return decision;
    } finally {
      await rm(executionRoot, { recursive: true, force: true });
    }
  };

  const view = await runAdapterEvaluation({
    adapterId: adapter.id,
    native: parsed.native,
    context: {
      change: { kind: 'worktree', baseRevision: 'HEAD' },
      evaluation: { purpose: 'regression-only', contractRef: null },
    },
  }, {
    evaluate: evaluateActivated,
    establishTrust: async () => ({ established: true, detail: 'preflight grant' }),
  });

  if (view === null) {
    return answer({
      adapterId: adapter.id,
      view: unverified({ adapter, family: 'capability', detail: `${adapter.id} is not a declared adapter.` }),
    });
  }

  // A decision the contract rejects gets the answer every other unreadable
  // result on this surface already gets. Nothing about authority changes: this
  // narrows what the preflight is willing to say about a decision, not what it
  // is allowed to do (`AC-ADAPT-002`, `SG-SUPPORT-001`).
  if (rejectedFindingCount !== null) {
    return answer({
      adapterId: adapter.id,
      view: unverified({
        adapter,
        detail: `the evaluation returned a decision that could not be read against the evaluation contract, so nothing about this working tree was verified (${rejectedFindingCount} contract finding${rejectedFindingCount === 1 ? '' : 's'})`,
      }),
    });
  }

  const evaluationId = view.presentation?.evaluationId ?? null;
  const reported = await timesAlreadyRecorded(openedStore, evaluationId);

  // An evaluation identity is a function of what was evaluated, so a repeated
  // identity is the same verdict about the same content. The gate counts its
  // own append-only record, which advances even when the client's counter does
  // not — which is exactly what the observed loop did.
  if (Number.isInteger(maxIterations) && reported > maxIterations) {
    return silence({
      detail: `this verdict has now been reported ${reported} times for unchanged content, past the ${maxIterations} this surface declares; nothing has changed and nothing further is suggested.`,
    });
  }

  return answer({ adapterId: adapter.id, view });
};
