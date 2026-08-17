/**
 * The authoritative Git hook runner.
 *
 * This is the program a registered `pre-commit` shim points at. It resolves the
 * repository, reads the clone's configuration and Activation receipt, builds
 * the versioned evaluation request for the `commit-attempt` trigger, invokes
 * the existing `evaluate` seam, and reports the decision. It adds no policy of
 * its own and reimplements no part of evaluation. It resolves no runner either:
 * it runs the executables the receipt pinned, so the programs activation proved
 * are the programs a commit is graded by.
 *
 * It exits `0` only on an `allow` authorization. Every other path — an
 * unreadable configuration, an absent receipt, a drifted runner pin, a crash —
 * exits non-zero with a stated reason, because a runner that cannot prove a
 * decision has not produced one (`NFR-REL-003`).
 *
 * It claims no protection beyond a cooperative local process: a machine owner
 * can remove or bypass it, and nothing here is tamper-proof (`SG-TRUST-001`).
 */

import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { HOOK_PROGRAM_SELF_TEST_SUBJECT_VERSION } from './activation.mjs';
import { createBoundedExecutor } from './bounded-execution.mjs';
import { commandPreview, composeArguments } from './command-descriptor.mjs';
import {
  CONFIGURATION_FILE,
  gateChecksFromConfiguration,
  readRepositoryConfiguration,
} from './configuration.mjs';
import { PROTOCOL_VERSION, evaluate } from './evaluate.mjs';
import { STORE_DIRECTORY, resolveGitCommonDirectory } from './evidence-store.mjs';
import { validateGatePolicy } from './policy.mjs';

const runFile = promisify(execFile);

const { X_OK } = constants;

/** Where the Activation receipt lives, relative to the Git common directory. */
const ACTIVATION_RECEIPT_PATH = path.join(STORE_DIRECTORY, 'activation', 'receipt.json');

/** The environment variable that names an activation self-test subject. */
export const SELF_TEST_ENV = 'CHANGE_EVALUATION_GATE_SELF_TEST';

/** The subject shape the activation self-test writes. */
export const SELF_TEST_SUBJECT_VERSION = HOOK_PROGRAM_SELF_TEST_SUBJECT_VERSION;

/** The exit status of a runner that did not authorize the change in front of it. */
const DENIED = 1;

const say = (message) => `change-evaluation-gate: ${message}`;

const denied = (reasonCode, message) => ({
  exitCode: DENIED,
  reasonCode,
  lines: [say(message)],
});

/**
 * Answer the activation self-test.
 *
 * Activation proves this program before it registers it: it starts the program
 * in a throwaway subject directory with `CHANGE_EVALUATION_GATE_SELF_TEST`
 * naming a subject that must be denied, and accepts any non-zero exit as proof
 * of denial. That makes a merely crashing runner indistinguishable from an
 * enforcing one at activation time — and a runner that passes by crashing would
 * then block every real commit too.
 *
 * So the subject is actually read and actually judged. It is denied because it
 * carries a failing required check, and it is refused by a distinct reason when
 * it cannot be read, is a version this runner does not model, or does not
 * contain the failing required check that makes it deniable.
 */
const answerSelfTest = async (subjectPath) => {
  let subject;

  try {
    subject = JSON.parse(await readFile(subjectPath, 'utf8'));
  } catch (error) {
    return denied(
      'self-test-subject-unreadable',
      `the self-test subject at ${subjectPath} could not be read (${error.message}); nothing is proved.`,
    );
  }

  if (subject?.subjectVersion !== SELF_TEST_SUBJECT_VERSION) {
    return denied(
      'self-test-subject-unsupported',
      `the self-test subject declares ${JSON.stringify(subject?.subjectVersion ?? null)}, which this runner does not model; nothing is proved.`,
    );
  }

  const selfTestId = subject.selfTestId ?? 'unidentified';
  const deniable = Array.isArray(subject.checks)
    && subject.checks.some((check) => check?.required === true && check?.outcome === 'failed');

  if (subject.expect !== 'denied' || !deniable) {
    return denied(
      'self-test-subject-not-deniable',
      `the self-test subject ${selfTestId} carries no failing required check, so denying it would prove nothing.`,
    );
  }

  return denied(
    'self-test-denied',
    `denied / self-test ${selfTestId}: a required check failed, so this change is not authorized.`,
  );
};

/**
 * Resolve the clone this invocation belongs to.
 *
 * Git starts a hook at the top of the working tree, but the runner is also
 * reachable directly, so the root is asked for rather than assumed.
 */
const resolveRepositoryRoot = async (cwd) => {
  try {
    const { stdout } = await runFile('git', ['rev-parse', '--show-toplevel'], { cwd });

    return { ok: true, root: stdout.trim() };
  } catch (error) {
    return {
      ok: false,
      reasonCode: 'repository-unresolved',
      detail: `no Git repository could be resolved from ${cwd} (${error.message}); nothing is authorized.`,
    };
  }
};

/**
 * Read the clone's configuration and its Gate policy section.
 *
 * The policy is read through the supported reader and validated by the Gate
 * policy contract that owns it. A configuration that cannot be read, or a
 * policy the contract rejects, denies: the runner never invents the policy it
 * is supposed to be bound by.
 */
const resolveConfiguration = async (repositoryRoot) => {
  const read = await readRepositoryConfiguration({ repositoryRoot });

  if (!read.ok) {
    return { ok: false, reasonCode: read.reasonCode, detail: read.detail };
  }

  const policy = read.configuration?.evaluation_gate ?? null;

  if (policy === null) {
    return {
      ok: false,
      reasonCode: 'gate-policy-missing',
      detail: `${CONFIGURATION_FILE} declares no evaluation_gate section, so this clone has no Gate policy to enforce.`,
    };
  }

  const issues = validateGatePolicy(policy);

  if (issues.length > 0) {
    return {
      ok: false,
      reasonCode: 'gate-policy-invalid',
      detail: `the Gate policy cannot bound an evaluation: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join(' ')}`,
    };
  }

  return { ok: true, configuration: read.configuration, policy };
};

/**
 * Read the Activation receipt this clone was activated by.
 *
 * The receipt is the record that authoritative enforcement was activated here
 * and what runtime it pinned. Without it the runner cannot say which activation
 * it is acting for, so it denies rather than acting as an unpinned gate of its
 * own invention.
 */
const resolveReceipt = async (repositoryRoot) => {
  let common;

  try {
    common = await resolveGitCommonDirectory({
      repositoryRoot,
      runGit: async (root, args) => (await runFile('git', args, { cwd: root })).stdout,
    });
  } catch (error) {
    return {
      ok: false,
      reasonCode: 'repository-unresolved',
      detail: `the Git common directory could not be resolved (${error.message}); nothing is authorized.`,
    };
  }

  const receiptPath = path.join(common, ACTIVATION_RECEIPT_PATH);
  let receipt;

  try {
    receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      reasonCode: error.code === 'ENOENT' ? 'activation-receipt-missing' : 'activation-receipt-unreadable',
      detail: error.code === 'ENOENT'
        ? `no Activation receipt at ${receiptPath}; this clone is configured but not activated.`
        : `the Activation receipt at ${receiptPath} could not be read (${error.message}); nothing is authorized.`,
    };
  }

  return { ok: true, receipt, receiptPath, gitCommonDirectory: common };
};

/** What a maintainer does about a receipt that no longer describes this machine. */
const REPAIR = 'run `gate repair` to re-resolve and re-pin the commands this clone was activated with';

/**
 * Take every executable from the pin the Activation receipt recorded.
 *
 * Activation is where resolution belongs: it is the step that obtains consent
 * for exact commands and then pins what it resolved. Re-resolving here would
 * let the hook run a program activation never proved — which is precisely the
 * defect this closes, so a pin is honoured or the commit is denied. A pinned
 * executable that is gone, no longer executable, or no longer the runner it was
 * pinned for is drift, and substituting a different program for it is never a
 * recovery (`NFR-REL-003`).
 *
 * `composeArguments` stays the single place a descriptor's argument vector is
 * derived, so the invocation activation previewed and the one this runs cannot
 * diverge.
 */
const pinnedRunners = async (checks, { receipt, compose }) => {
  const pins = new Map((receipt?.runtime?.runners ?? [])
    .filter((entry) => entry?.role === 'evaluate' && typeof entry?.check_id === 'string')
    .map((entry) => [entry.check_id, entry]));
  const resolved = new Map();

  for (const check of checks) {
    const command = check.evaluate;
    const pin = pins.get(check.id) ?? null;

    if (typeof pin?.executable !== 'string' || pin.executable === '') {
      return {
        ok: false,
        reasonCode: 'runner-unpinned',
        detail: `the Activation receipt pins no executable for ${check.id}; this clone was activated with different commands, so nothing is authorized. ${REPAIR}.`,
      };
    }

    if (pin.runner !== command.runner) {
      return {
        ok: false,
        reasonCode: 'runner-pin-drift',
        detail: `${check.id} now names the ${command.runner} runner, but the Activation receipt pinned ${pin.runner}; the pinned program is never replaced by a different one. ${REPAIR}.`,
      };
    }

    const usable = await access(pin.executable, X_OK).then(() => true, () => false);

    if (!usable) {
      return {
        ok: false,
        reasonCode: 'runner-pin-drift',
        detail: `${check.id} was activated against ${pin.executable}, which is no longer an executable on this machine; it is never re-resolved to a different program. ${REPAIR}.`,
      };
    }

    const composition = compose(command);

    if (composition.error) {
      return {
        ok: false,
        reasonCode: composition.error.code,
        detail: `${check.id} declares a ${command.runner} command its own runner cannot compose: ${composition.error.message}`,
      };
    }

    resolved.set(check.id, {
      executable: pin.executable,
      version: pin.version ?? null,
      preview: commandPreview(command, pin.executable),
    });
  }

  return { ok: true, resolved };
};

/** Which check a bounded-execution callback is resolving an executable for. */
const commandOwner = (checks, command) => checks.find(
  (check) => check.evaluate === command,
)?.id ?? null;

/**
 * Say what the decision was, in a form a maintainer reading `git commit` output
 * can act on, and translate it into an exit status.
 *
 * Only an `allow` authorization exits `0`. A decision this runner cannot read
 * is not an allow: absence of a denial has never been evidence of one
 * (`NFR-REL-003`).
 */
const report = (decision) => {
  const authorization = decision?.authorization ?? null;
  const outcome = decision?.outcome ?? null;

  if (typeof authorization !== 'string' || typeof outcome !== 'string') {
    return denied(
      'decision-malformed',
      'the evaluation returned no readable decision, so nothing is authorized.',
    );
  }

  const lines = [say(`${outcome} / ${authorization}`)];

  for (const check of decision.checks ?? []) {
    if (check?.outcome === 'passed' || check?.outcome === 'not-applicable') {
      continue;
    }

    lines.push(say(`  ${check?.id}: ${check?.outcome} (${check?.reasonCode ?? 'no reason recorded'})`));
  }

  for (const diagnostic of decision.diagnostics ?? []) {
    lines.push(say(`  ${diagnostic?.reasonCode}: ${diagnostic?.detail}`));
  }

  if (authorization === 'allow') {
    return { exitCode: 0, reasonCode: null, lines };
  }

  lines.push(say('this commit was not authorized. Fix the reported evidence and commit again.'));
  // Local enforcement is a cooperative process on this machine and claims
  // nothing more; it is not tamper-proof (SG-TRUST-001).
  lines.push(say('local enforcement only; it can be removed or bypassed by whoever owns this machine.'));

  return { exitCode: DENIED, reasonCode: 'denied', lines };
};

/**
 * Run the authoritative gate for one commit attempt.
 *
 * @param {object} options working directory and environment of this invocation
 * @returns {Promise<{ exitCode: number, reasonCode: string|null, lines: string[] }>}
 */
export const runHook = async ({
  cwd = process.cwd(),
  environment = process.env,
  composeArguments: compose = composeArguments,
  evaluate: evaluateSeam = evaluate,
} = {}) => {
  const selfTestSubject = environment[SELF_TEST_ENV] ?? null;

  // A program that finds this variable set is being proved, not run against
  // somebody's work: it evaluates the named subject, never its working tree.
  if (selfTestSubject !== null) {
    return answerSelfTest(selfTestSubject);
  }

  const repository = await resolveRepositoryRoot(cwd);

  if (!repository.ok) {
    return denied(repository.reasonCode, repository.detail);
  }

  const configuration = await resolveConfiguration(repository.root);

  if (!configuration.ok) {
    return denied(configuration.reasonCode, configuration.detail);
  }

  const activation = await resolveReceipt(repository.root);

  if (!activation.ok) {
    return denied(activation.reasonCode, activation.detail);
  }

  const { checks, errors } = gateChecksFromConfiguration(configuration.configuration);

  if (errors.length > 0) {
    return denied(
      'configuration-invalid',
      `the configured verification commands cannot be evaluated: ${errors.map((issue) => `${issue.path}: ${issue.message}`).join(' ')}`,
    );
  }

  const runners = await pinnedRunners(checks, { receipt: activation.receipt, compose });

  if (!runners.ok) {
    return denied(runners.reasonCode, runners.detail);
  }

  const executionRoot = await mkdtemp(path.join(tmpdir(), 'gate-hook-runner-exec-'));
  const executor = createBoundedExecutor({
    totalSeconds: configuration.policy?.budget?.total_seconds ?? null,
    resolveExecutable: (command) => runners.resolved.get(commandOwner(checks, command)) ?? null,
    environment,
  });
  let decision;

  try {
    decision = await evaluateSeam({
      protocolVersion: PROTOCOL_VERSION,
      operation: 'evaluate',
      repository: { root: repository.root },
      // The proposed snapshot is what a commit would create, so the index is
      // graded and the mutable worktree never is (SG-EVAL-001).
      change: { kind: 'git-index', baseRevision: 'HEAD' },
      evaluation: { purpose: 'change-acceptance-and-regression', contractRef: null },
      invocation: {
        role: 'authoritative',
        trigger: 'commit-attempt',
        adapter: {
          id: 'git',
          surface: 'git-pre-commit',
          version: activation.receipt?.receiptVersion ?? '1.0.0',
          capabilities: { nativeBlocking: true },
        },
        sessionId: `hook-runner-${activation.receipt?.receiptId ?? 'unpinned'}`,
      },
    }, {
      executionRoot,
      runnerVersion: activation.receipt?.runtime?.runnerVersion ?? 'change-evaluation-gate/unpinned',
      providerVersions: { configuration: '1.0.0' },
      resolvePrerequisite: () => true,
      checks,
      policy: configuration.policy,
      execute: executor.execute,
    });
  } catch (error) {
    // A runner that crashed produced no decision. It denies, and it says so,
    // rather than letting a thrown error reach the shell as an exit status
    // nobody can read (NFR-REL-003).
    return denied('runner-failed', `the evaluation failed internally (${error.message}); nothing is authorized.`);
  } finally {
    await rm(executionRoot, { recursive: true, force: true });
  }

  return report(decision);
};
