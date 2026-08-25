/**
 * The three Activation dependencies `runActivation` leaves abstract, and the
 * clone-local shortcut an activation registers.
 *
 * `runActivation` destructures `establishTrust`, `selfTestEvaluation`, and
 * `selfTestAdapter` with NO defaults while every other seam has a real one
 * (`TB-042`). That is not an oversight: each of the three is a statement about
 * the machine an activation is happening on, and a library that guessed one
 * would be inventing policy. But leaving all three abstract meant the only
 * callers that ever supplied them were fixtures, and every fixture supplied a
 * stub — so the highest-consequence operation in the system was reachable only
 * through improvised scripts and proved only against implementations that
 * proved nothing.
 *
 * This module is where the real ones live. It is deliberately NOT inside
 * `activation.mjs`: the transaction stays a pure pipeline over injected seams,
 * and this is the one place that says what those seams actually do on a real
 * clone. The operator surface binds them; `gate-activation-smoke` binds the same
 * ones; a later contract that reruns self-tests during `gate update` binds these
 * and not copies of them.
 *
 * THE SHAPE EVERY SELF-TEST HERE TAKES. `TB-035` settled it for the hook
 * program: an exit status is not a decision. A subject is created that the
 * thing under test must answer, the subject carries a per-run identifier the
 * subject cannot know without reading it, and the answer must reproduce that
 * identifier. A run that starts, throws, and dies non-zero has proved only that
 * it is broken. `selfTestHookProgramDenial` is the model; these two are of the
 * same character.
 *
 * WHAT TRUST MEANS HERE. Each adapter declares its own trust model in
 * `adapters.mjs`. `establishActivationTrust` dispatches on the declared model
 * and satisfies it; it invents no policy, weakens nothing, and refuses a model
 * it does not recognize rather than treating it as granted. Authoritative Git
 * declares `repository-hook-registration`: its registration surface is this
 * clone's own hook chain, so there is no client to prompt and the
 * repository-bound consent the command already required IS the grant. The three
 * desktop surfaces declare an explicit grant, which only their client can give;
 * with no grant reader bound there is nothing to read, and the transaction
 * pauses rather than pretending (`FR-LIFE-016`, `AC-LIFE-009`, `SG-TRUST-001`).
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  buildNativePayload,
  describeAdapter,
  runAdapterEvaluation,
  runCompatibilityBaseline,
} from './adapters.mjs';
import { createBoundedExecutor } from './bounded-execution.mjs';
import { createRunnerResolver } from './command-descriptor.mjs';
import { evaluate, evaluateWithoutSubject } from './evaluate.mjs';
import { PROTOCOL_VERSION } from './evaluation-contract.mjs';

const runFile = promisify(execFile);

/**
 * How an actor a person typed is carried.
 *
 * A command surface cannot distinguish a maintainer typing a confirmation from
 * an agent invoking the command twice, so a name reaching it is a claim, not an
 * observation. It is recorded under this provenance and no other, and never
 * under a field that reads as proof (`SG-TRUST-001`).
 */
export const SELF_DECLARED = 'self-declared';

/** Every trust model this dispatch satisfies, and how it satisfies it. */
export const TRUST_MECHANISMS = Object.freeze({
  'repository-hook-registration': 'repository-bound-consent',
  'explicit-workspace-grant': 'client-workspace-grant',
  'explicit-project-grant': 'client-project-grant',
});

/**
 * What the receipt records about the consent that was verified.
 *
 * Every field here is something the transaction OBSERVED. `mechanism` is the
 * dispatch that ran, `trustModel` is what the adapter declared, and `observed`
 * states the one provable fact about a two-invocation confirmation: a
 * confirmation reproducing this exact preview arrived, and it arrived in a
 * separate invocation from the one that produced the preview. Nothing here says
 * a human granted anything, because nothing here saw one.
 */
const trustRecord = ({ mechanism, trustModel, observed, actor }) => ({
  mechanism,
  trustModel,
  observed,
  // Carried, never asserted. A reader that wants to know who ran the command
  // finds a claim labelled as a claim, or nothing at all.
  actor: actor === null || actor === undefined
    ? null
    : { name: String(actor), provenance: SELF_DECLARED },
});

/**
 * Establish trust for one activation by the model the selected adapter declares.
 *
 * The consent is bound in by the caller that constructed it, because
 * `runActivation` hands this seam only the client and the repository — which is
 * correct: the transaction owns the consent checks and this seam owns what the
 * declared model requires beyond them.
 *
 * @param {object} options
 * @param {object|null} options.consent the repository-bound consent this invocation carries
 * @param {string|null} options.actor a name a person supplied, carried as self-declared
 * @param {Function|null} options.readClientGrant asks a desktop client whether it has granted
 * @returns {Function} the `establishTrust` seam `runActivation` calls
 */
export const createTrustEstablishment = ({
  consent = null,
  actor = null,
  readClientGrant = null,
  clock = () => new Date(),
} = {}) => async ({ client, repository }) => {
  const adapter = describeAdapter(client?.id ?? null);

  if (adapter === null) {
    return {
      established: false,
      pending: false,
      reason: 'adapter-undeclared',
      detail: `${JSON.stringify(client?.id ?? null)} is not an adapter this gate declares, so it declares no trust model to satisfy.`,
    };
  }

  const trustModel = adapter.capabilities?.trust?.model ?? null;
  const mechanism = TRUST_MECHANISMS[trustModel] ?? null;

  // A model nobody here knows how to satisfy is refused. Treating it as granted
  // would be the one failure mode the whole declaration exists to prevent.
  if (mechanism === null) {
    return {
      established: false,
      pending: false,
      reason: 'trust-model-unrecognized',
      detail: `${adapter.id} declares the trust model ${JSON.stringify(trustModel)}, which this activation does not know how to satisfy; it is refused rather than assumed.`,
    };
  }

  if (trustModel === 'repository-hook-registration') {
    // This adapter's registration surface is the clone's own hook chain, so
    // there is no client configuration to ask and no prompt to answer. The
    // grant is the repository-bound consent, and it must be bound to THIS
    // clone — the transaction checks the same binding at its consent step, and
    // a seam that skipped it would be a second, weaker answer to one question.
    if (!consent) {
      return {
        established: false,
        pending: false,
        reason: 'consent-missing',
        detail: `${adapter.id} satisfies ${trustModel} with repository-bound consent, and this invocation carries none.`,
      };
    }

    if (consent.repositoryIdentity !== repository?.identity) {
      return {
        established: false,
        pending: false,
        reason: 'consent-repository-mismatch',
        detail: `The consent names the clone ${consent.repositoryIdentity ?? 'none'}; this activation is for ${repository?.identity ?? 'none'}.`,
      };
    }

    return {
      established: true,
      pending: false,
      at: consent.grantedAt ?? clock().toISOString(),
      grantedBy: trustRecord({
        mechanism,
        trustModel,
        observed: {
          // The provable fact, and the only one: a confirmation reproducing
          // this exact preview arrived in an invocation separate from the one
          // that produced it.
          confirmationInSeparateInvocation: true,
          previewId: consent.previewId ?? null,
          repositoryIdentity: consent.repositoryIdentity ?? null,
          configurationIdentity: consent.configurationIdentity ?? null,
        },
        actor,
      }),
    };
  }

  // An explicit grant belongs to the client that owns it. Nothing here can
  // grant it, and nothing here may act as if it had.
  const grant = readClientGrant === null
    ? null
    : await readClientGrant({ client, repository, trustModel }).catch((error) => ({
      granted: false,
      detail: error.message,
    }));

  if (grant?.granted === true) {
    return {
      established: true,
      pending: false,
      at: grant.at ?? clock().toISOString(),
      grantedBy: trustRecord({
        mechanism,
        trustModel,
        observed: {
          confirmationInSeparateInvocation: true,
          clientGrantRead: true,
          previewId: consent?.previewId ?? null,
          repositoryIdentity: consent?.repositoryIdentity ?? null,
          configurationIdentity: consent?.configurationIdentity ?? null,
        },
        actor,
      }),
    };
  }

  return {
    established: false,
    // A pause, not a refusal: the clone is untouched and the transaction may be
    // resumed against the identities it recorded once the client has granted.
    pending: true,
    reason: `${trustModel}-not-granted`,
    detail: grant?.detail
      ?? `${adapter.id} declares ${trustModel}: only ${adapter.id} itself can grant this clone, and it has not. Grant it in ${adapter.id} for this ${trustModel === 'explicit-workspace-grant' ? 'workspace' : 'project'}, then resume.`,
  };
};

/** The versioned on-disk shape of an evaluation-process self-test subject. */
export const EVALUATION_SELF_TEST_SUBJECT_VERSION = 'change-evaluation-gate/evaluation-self-test-subject/v1';

/** The identity of the synthetic check one evaluation self-test grades. */
export const EVALUATION_SELF_TEST_CHECK = 'activation.evaluation-self-test';

/**
 * The probe the self-test subject's required check runs.
 *
 * It answers by WRITING what it read, so the proof survives an evaluation that
 * deliberately keeps captured output out of the decision. A probe that never ran
 * leaves no answer, and a probe that ran without reading its subject writes the
 * wrong identifier.
 */
export const EVALUATION_SELF_TEST_PROBE = [
  "import { readFileSync, writeFileSync } from 'node:fs';",
  '',
  "const subject = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
  '',
  'writeFileSync(process.argv[3], `${JSON.stringify({',
  '  selfTestId: subject.selfTestId,',
  '  subjectVersion: subject.subjectVersion,',
  '  expect: subject.expect,',
  '}, null, 2)}\\n`, "utf8");',
  'process.stdout.write(`change-evaluation-gate: self-test ${subject.selfTestId} must be denied\\n`);',
  '',
  '// A required check that fails. An evaluation process that enforces anything',
  '// has to turn this into a refusal.',
  'process.exit(1);',
  '',
].join('\n');

/**
 * The synthetic check the evaluation self-test grades.
 *
 * It is the gate's own, not the clone's: activation must never run a
 * maintainer's test suite to prove itself, and a self-test bound to whatever
 * that clone happens to have configured would prove something different on
 * every machine. What is under test is the evaluation process — that it reads a
 * subject, runs the required check bound to it, and denies when that check
 * fails.
 */
const selfTestCheck = ({ subjectPath, answerPath }) => ({
  id: EVALUATION_SELF_TEST_CHECK,
  provider: 'configuration',
  stage: 'broad-tests',
  capability: 'test',
  scope: 'both',
  applicability: { changed_path_globs: ['**'], required_facts: [] },
  prerequisites: [],
  policy: 'advisory',
  evaluate: {
    runner: 'repository-script',
    args: ['probe.mjs', subjectPath, answerPath],
    working_directory: '.',
    timeout_seconds: 60,
    allowed_environment: ['PATH'],
    evidence_category: 'test',
    source_scope: 'both',
  },
  fix: null,
  timeout_seconds: 60,
  declared_writes: [],
  evidence: { claims: ['test:broad'], success_exit_codes: [0], report: null },
  order: 10,
  selection: null,
});

/** A throwaway repository with one committed baseline and one worktree change. */
const selfTestRepository = async (root, probe) => {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'probe.mjs'), probe, 'utf8');
  await writeFile(path.join(root, 'subject.txt'), 'baseline\n', 'utf8');

  const git = (args) => runFile('git', args, { cwd: root });

  await git(['init', '--quiet']);
  await git(['add', '--all']);
  await git([
    '-c', 'user.email=self-test@change-evaluation-gate.invalid',
    '-c', 'user.name=Change Evaluation Gate self-test',
    '-c', 'commit.gpgsign=false',
    'commit', '--quiet', '--message', 'self-test baseline',
  ]);

  // The change the evaluation has to be about. `probe.mjs` stays committed and
  // unchanged: it is a Grader surface, and a run whose own grader moved would
  // be `unverified` for a reason that has nothing to do with this proof.
  await writeFile(path.join(root, 'subject.txt'), 'baseline\nchanged\n', 'utf8');
};

/**
 * Prove that the evaluation process denies a change it must deny.
 *
 * The one thing an activation could never say about the runtime it was about to
 * pin was that it decides anything. A process that resolves, materializes, and
 * then returns a shape would leave every commit authorized while activation
 * reported a healthy activated clone — the same defect `TB-035` closed for the
 * hook program, one layer down.
 *
 * So the process is run against a throwaway subject it must refuse: a real
 * repository, a real materialized snapshot, a real spawned check process, and a
 * required check that fails. It must reach a refusal AND show that it read the
 * subject, by the probe's answer naming the subject's own per-run `selfTestId`.
 * Nothing of the maintainer's is read, run, or left behind.
 */
export const selfTestEvaluationDenial = async ({
  runnerVersion = null,
  // The program the self-test subject's required check runs. It is a seam so a
  // fixture can supply one that answers WITHOUT reading its subject, or that
  // reads it and allows anyway, and observe that this refuses both — which is
  // the difference between a self-test and a stub.
  probe = EVALUATION_SELF_TEST_PROBE,
} = {}) => {
  const subjectRoot = await mkdtemp(path.join(tmpdir(), 'gate-evaluation-self-test-'));
  const worktree = path.join(subjectRoot, 'subject');
  const executionRoot = path.join(subjectRoot, 'execution');
  const subjectPath = path.join(subjectRoot, 'subject.json');
  const answerPath = path.join(subjectRoot, 'answer.json');
  const selfTestId = randomUUID();

  try {
    await writeFile(subjectPath, `${JSON.stringify({
      subjectVersion: EVALUATION_SELF_TEST_SUBJECT_VERSION,
      selfTestId,
      expect: 'denied',
    }, null, 2)}\n`, 'utf8');
    await mkdir(executionRoot, { recursive: true });
    await selfTestRepository(worktree, probe);

    const resolve = createRunnerResolver({ repositoryRoot: worktree });
    const executor = createBoundedExecutor({
      resolveExecutable: (command) => resolve(command.runner, command),
    });
    const decision = await evaluate({
      protocolVersion: PROTOCOL_VERSION,
      operation: 'evaluate',
      repository: { root: worktree },
      change: { kind: 'worktree', baseRevision: 'HEAD' },
      evaluation: { purpose: 'regression-only', contractRef: null },
      invocation: {
        role: 'authoritative',
        trigger: 'commit-attempt',
        adapter: {
          id: 'git',
          surface: 'git-pre-commit',
          version: '1.0.0',
          capabilities: { nativeBlocking: true },
        },
        sessionId: `activation-self-test-${selfTestId}`,
      },
    }, {
      executionRoot,
      runnerVersion: runnerVersion ?? 'change-evaluation-gate/activation-self-test',
      providerVersions: {},
      policy: {
        checks: { required: [EVALUATION_SELF_TEST_CHECK], advisory: [] },
        budget: { total_seconds: 120 },
        bypass: { enabled: false, marker: null },
        execution: { budget_skippable: [] },
        evidence: {},
      },
      checks: [selfTestCheck({ subjectPath, answerPath })],
      execute: executor.execute,
    });

    const graded = (decision?.checks ?? []).find(
      (check) => check.id === EVALUATION_SELF_TEST_CHECK,
    ) ?? null;

    if (graded === null) {
      return {
        ok: false,
        reason: 'evaluation-process-unproved',
        detail: `The evaluation process returned ${JSON.stringify(decision?.outcome ?? null)} without grading the self-test check at all; it decided nothing about the subject it was given.`,
      };
    }

    // A process that answered names the subject it answered. The probe writes
    // back the per-run `selfTestId` it read, which nothing can produce without
    // having actually run against this subject.
    const answered = await readFile(answerPath, 'utf8')
      .then((contents) => JSON.parse(contents))
      .catch(() => null);

    if (answered?.selfTestId !== selfTestId) {
      return {
        ok: false,
        reason: 'evaluation-process-unproved',
        detail: `The evaluation process graded ${graded.outcome} without the self-test subject ${selfTestId} ever being read; a process that merely reports an outcome is not a process that evaluated anything.`,
      };
    }

    if (decision.outcome !== 'failed' || graded.outcome !== 'failed') {
      return {
        ok: false,
        reason: 'evaluation-process-allowed-denied-change',
        detail: `The evaluation process read the self-test subject ${selfTestId} and answered ${decision.outcome} with the required check graded ${graded.outcome}; a required check that fails has to deny.`,
      };
    }

    return {
      ok: true,
      reason: null,
      detail: `The evaluation process read the self-test subject ${selfTestId}, graded its required check ${graded.outcome}, and denied the change.`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'evaluation-process-cannot-run',
      detail: `The evaluation process could not be proved on this machine: ${error.message}.`,
    };
  } finally {
    await rm(subjectRoot, { recursive: true, force: true });
  }
};

/**
 * A valid decision produced by the shipped decision path, for one adapter
 * invocation the self-test drives.
 *
 * `evaluateWithoutSubject` is the gate's own answer for a turn with no change
 * to grade: it materializes nothing, spawns nothing, and still returns a
 * decision the process contract accepts. Hand-building one here would be a
 * second definition of what a decision is.
 */
const selfTestDecision = (request) => evaluateWithoutSubject(request, { checks: [] });

/**
 * Prove that one selected adapter surface actually answers for this clone.
 *
 * An adapter is a declaration until something drives it. The stub every fixture
 * supplied — `{ ok: true }` — proved that a declaration exists, which was
 * already known from reading the registry.
 *
 * This runs the shipped compatibility baseline against THIS clone, which
 * executes every dimension `NFR-COMP-001` names rather than inferring one, and
 * then drives one further invocation carrying a per-run session identity. The
 * adapter must hand the gate a normalized request naming this exact clone and
 * this exact session, and must present back the identity of the decision that
 * request produced. A surface that answers without reading cannot reproduce a
 * value it never saw.
 */
export const selfTestAdapterSurface = async (adapter, { repository } = {}) => {
  const declared = describeAdapter(adapter?.id ?? null);

  if (declared === null) {
    return {
      ok: false,
      reason: 'adapter-undeclared',
      detail: `${JSON.stringify(adapter?.id ?? null)} is not an adapter this gate declares, so there is no surface to prove.`,
    };
  }

  const repositoryRoot = repository?.root ?? null;

  if (repositoryRoot === null) {
    return {
      ok: false,
      reason: 'adapter-self-test-unrunnable',
      detail: `${declared.id} could not be proved: this activation named no repository root.`,
    };
  }

  const selfTestId = randomUUID();
  const sessionId = `activation-self-test-${selfTestId}`;
  const seen = [];

  try {
    const baseline = await runCompatibilityBaseline({
      adapterId: declared.id,
      repositoryRoot,
    }, {
      evaluate: selfTestDecision,
      runGit: async (args) => (await runFile('git', args, { cwd: repositoryRoot })).stdout.trim(),
      versions: {
        gate: declared.version,
        node: process.version,
        os: `${process.platform} ${process.arch}`,
        client: null,
      },
    });

    if (baseline?.passed !== true) {
      return {
        ok: false,
        reason: 'adapter-baseline-failed',
        detail: `${declared.id} failed the shared compatibility baseline on this clone: ${JSON.stringify(baseline?.failedChecks ?? null)}.`,
      };
    }

    const presented = await runAdapterEvaluation({
      adapterId: declared.id,
      native: buildNativePayload(declared, {
        nativeEvent: declared.nativeEvents['work-complete']
          ?? declared.nativeEvents['commit-attempt'],
        repositoryRoot,
        sessionId,
      }),
      context: {
        change: { kind: 'worktree', baseRevision: 'HEAD' },
        evaluation: { purpose: 'regression-only', contractRef: null },
      },
    }, {
      establishTrust: async () => ({ established: true, detail: 'the activation self-test grant' }),
      evaluate: async (request) => {
        seen.push(request);

        return selfTestDecision(request);
      },
    });

    const request = seen[0] ?? null;

    // The subject was read: the adapter carried THIS clone and THIS per-run
    // session across its own normalization boundary. Neither value is knowable
    // to a surface that answered from nowhere.
    if (request === null
      || request.repository?.root !== repositoryRoot
      || request.invocation?.sessionId !== sessionId) {
      return {
        ok: false,
        reason: 'adapter-unproved',
        detail: `${declared.id} did not carry the self-test invocation ${sessionId} for ${repositoryRoot} across its normalization boundary; it named ${JSON.stringify(request?.invocation?.sessionId ?? null)} for ${JSON.stringify(request?.repository?.root ?? null)}.`,
      };
    }

    const answered = await selfTestDecision(request);

    if (presented?.failure !== null
      || presented?.presentation?.evaluationId !== answered.evaluationId) {
      return {
        ok: false,
        reason: 'adapter-unproved',
        detail: `${declared.id} did not present back the decision it was given for ${sessionId}: ${JSON.stringify(presented?.failure ?? presented?.presentation?.evaluationId ?? null)}.`,
      };
    }

    return {
      ok: true,
      reason: null,
      detail: `${declared.id} passed the shared compatibility baseline on this clone and presented the decision it was given for the self-test invocation ${sessionId}.`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'adapter-self-test-unrunnable',
      detail: `${declared.id} could not be proved on this clone: ${error.message}.`,
    };
  }
};

/** The clone-local Git alias an activation offers as a shortcut. */
export const COMMAND_ALIAS_NAME = 'gate';

/** Nothing may be written into a Git alias that a shell could not be handed back. */
const QUOTABLE = /^[^"\\\n\r]+$/;

/**
 * Register the convenience shortcut in THIS clone's own Git configuration.
 *
 * `FR-LIFE-003` makes activation clone-local and repository-specific, so the
 * shortcut has to be too. A `package.json` entry — the obvious place — is
 * tracked and shared: it would push `gate` scripts to every teammate who pulls,
 * including those who never activated, which is exactly the separation the
 * installed/configured/activated model exists to hold. `.git/config` is
 * untracked by construction: the alias appears when the clone activates and is
 * gone when the clone is, and a `!` alias runs from the top of the working tree,
 * so it works from any subdirectory.
 *
 * A name already in use — in ANY scope, because a local alias would shadow a
 * global one and shadowing is overwriting from where the maintainer stands — is
 * left exactly as it is. Nothing is written globally or system-wide, ever.
 */
export const registerCommandAlias = async ({
  repositoryRoot,
  command,
  interpreter = process.execPath,
  aliasName = COMMAND_ALIAS_NAME,
  runGit = null,
} = {}) => {
  const git = runGit ?? (
    async (args) => (await runFile('git', args, { cwd: repositoryRoot })).stdout
  );
  const name = `alias.${aliasName}`;

  if (!QUOTABLE.test(interpreter) || !QUOTABLE.test(command)) {
    return {
      registered: false,
      reason: 'alias-command-unquotable',
      name,
      value: null,
      detail: 'The installed command\'s path cannot be safely quoted into a Git alias, so none was written.',
    };
  }

  const value = `!"${interpreter}" "${command}"`;

  // Any scope. A local alias silently shadowing a global one is not "leaving it
  // alone", whatever `.git/config` says afterwards.
  const existing = await git(['config', '--get', name])
    .then((stdout) => stdout.trim())
    .catch(() => '');

  if (existing !== '') {
    return {
      registered: false,
      reason: 'alias-name-in-use',
      name,
      value: existing,
      detail: `\`git ${aliasName}\` is already defined as ${JSON.stringify(existing)}; activation left it exactly as it was.`,
    };
  }

  try {
    await git(['config', '--local', name, value]);
  } catch (error) {
    return {
      registered: false,
      reason: 'alias-registration-failed',
      name,
      value: null,
      detail: `The shortcut \`git ${aliasName}\` could not be registered (${error.message}); the clone is activated and the command is still reachable by its own path.`,
    };
  }

  return {
    registered: true,
    reason: null,
    name,
    value,
    detail: `\`git ${aliasName}\` now runs this clone's activated Gate command; it lives in this clone's own .git/config and travels nowhere.`,
  };
};

/**
 * Withdraw a shortcut this activation wrote — and only that.
 *
 * The value must still be the one that was written. An alias somebody has since
 * changed belongs to them now, and removing it would be repairing drift the
 * gate did not cause (`SG-HOOK-001`).
 */
export const withdrawCommandAlias = async ({
  repositoryRoot,
  registration,
  runGit = null,
} = {}) => {
  if (registration?.registered !== true) {
    return { removed: false, reason: 'nothing-registered' };
  }

  const git = runGit ?? (
    async (args) => (await runFile('git', args, { cwd: repositoryRoot })).stdout
  );
  const current = await git(['config', '--local', '--get', registration.name])
    .then((stdout) => stdout.trim())
    .catch(() => '');

  if (current === '') {
    return { removed: false, reason: 'already-absent' };
  }

  if (current !== registration.value) {
    return { removed: false, reason: 'alias-changed' };
  }

  await git(['config', '--local', '--unset', registration.name]);

  return { removed: true, reason: null };
};
