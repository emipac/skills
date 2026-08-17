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
  runAdapterEvaluation,
} from './adapters.mjs';
import { createBoundedExecutor } from './bounded-execution.mjs';
import { composeArguments } from './command-descriptor.mjs';
import { gateChecksFromConfiguration } from './configuration.mjs';
import { evaluate } from './evaluate.mjs';
import { openEvidenceStore } from './evidence-store.mjs';
import {
  commandOwner,
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
  view,
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

  if (adapter === null) {
    return { exitCode: 0, stdout: '', view: null };
  }

  const parsed = parseNative(stdin);

  if (!parsed.ok) {
    return answer({
      adapterId: adapter.id,
      view: unverified({ adapter, detail: parsed.detail }),
    });
  }

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

    const executionRoot = await mkdtemp(path.join(tmpdir(), 'gate-preflight-exec-'));
    const executor = createBoundedExecutor({
      totalSeconds: configuration.policy?.budget?.total_seconds ?? null,
      resolveExecutable: (command) => runners.resolved.get(commandOwner(checks, command)) ?? null,
      environment,
      captureOutput: true,
    });

    try {
      return await evaluateSeam(request, {
        executionRoot,
        runnerVersion: activation.receipt?.runtime?.runnerVersion ?? 'change-evaluation-gate/unpinned',
        providerVersions: { configuration: '1.0.0' },
        resolvePrerequisite: () => true,
        checks,
        policy: configuration.policy,
        execute: executor.execute,
        evidenceStore: store.store,
      });
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

  return answer({ adapterId: adapter.id, view });
};
