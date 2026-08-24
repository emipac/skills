/**
 * The authoritative Git hook runner.
 *
 * This is the program a registered `pre-commit` shim points at. It resolves the
 * repository, reads the clone's configuration and Activation receipt, builds
 * the versioned evaluation request for the `commit-attempt` trigger, invokes
 * the existing `evaluate` seam against the clone-local Evidence store the
 * receipt identifies, and reports the decision. It adds no policy of its own
 * and reimplements no part of evaluation or persistence. It resolves no runner
 * either: it runs the executables the receipt pinned, so the programs
 * activation proved are the programs a commit is graded by.
 *
 * It exits `0` only on a complete `allow` decision whose Evidence was actually
 * recorded, and completeness is judged by the evaluation contract that defines
 * it rather than by a second rule kept here. Every other path — an unreadable
 * configuration, an absent receipt, a drifted runner pin, a store that cannot
 * be opened or written to, a decision missing the parts that make it one, a
 * crash — exits non-zero with a stated reason, because a runner that cannot
 * prove a decision has not produced one (`NFR-REL-003`).
 *
 * It claims no protection beyond a cooperative local process: a machine owner
 * can remove or bypass it, and nothing here is tamper-proof (`SG-TRUST-001`).
 */

import { execFile } from 'node:child_process';
import { constants, rmSync } from 'node:fs';
import { access, lstat, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  AUTHORITATIVE_HOOK,
  HOOK_PROGRAM_SELF_TEST_SUBJECT_VERSION,
  configurationIdentity,
  readHookRegistration,
  repositoryIdentity,
} from './activation.mjs';
import { describeAdapter } from './adapters.mjs';
import { createBoundedExecutor } from './bounded-execution.mjs';
import { commandPreview, composeArguments, runtimeSearchPath } from './command-descriptor.mjs';
import {
  CONFIGURATION_FILE,
  gateChecksFromConfiguration,
  readRepositoryConfiguration,
} from './configuration.mjs';
import { validateDecision } from './evaluation-contract.mjs';
import { PROTOCOL_VERSION, evaluate } from './evaluate.mjs';
import {
  containedWithin,
  contentIdentity,
  openEvidenceStore,
  resolveGitCommonDirectory,
  STORE_DIRECTORY,
} from './evidence-store.mjs';
import { validateGatePolicy } from './policy.mjs';
import { createRedactor } from './redaction.mjs';

const runFile = promisify(execFile);

const { X_OK } = constants;

/** Where the Activation receipt lives, relative to the Git common directory. */
const ACTIVATION_RECEIPT_PATH = path.join(STORE_DIRECTORY, 'activation', 'receipt.json');

/**
 * The execution-root lifecycle, owned here and used by both runners (TB-038).
 *
 * Every evaluation materializes the proposed snapshot into a fresh `mkdtemp`
 * root and removes it in a `finally`. That covers finishing and crashing. It
 * does not cover the process never reaching `finally`: `SIGINT` from the
 * maintainer pressing Ctrl-C on a slow commit, and `SIGKILL`, which cannot be
 * caught at all. Interruption used to leave a full copy of the snapshot under
 * the system temporary directory until the operating system reclaimed it.
 *
 * Two mechanisms close that, and neither one is allowed to be visible: a
 * disposition for the signals a process *can* catch, which removes the live
 * roots and then lets the signal kill the process exactly as it would have; and
 * a sweep of what earlier runs abandoned, bounded by the gate's own prefixes,
 * the system temporary directory, and an age ceiling. There is deliberately no
 * registry, lockfile, or PID file — the prefix and the directory's own mtime
 * carry everything either mechanism needs, and a registry would be one more
 * thing that can itself be orphaned.
 */

/** The prefixes the gate creates execution roots under, and the only ones it sweeps. */
export const EXECUTION_ROOT_PREFIXES = Object.freeze([
  'gate-hook-runner-exec-',
  'gate-preflight-exec-',
]);

/**
 * How old an execution root must be before a sweep may reclaim it: 24 hours.
 *
 * The ceiling exists to make removing a *live* root belonging to a concurrent
 * evaluation impossible, so it is chosen against the longest run that could
 * plausibly still be in flight rather than against the longest normal one. A
 * configured budget is measured in seconds and capped well below an hour; the
 * only way a root's mtime gets far older than its run is a machine suspended
 * mid-evaluation, and a day covers an overnight sleep with room to spare.
 * Accumulation is bounded at roughly one day's interruptions, which is the
 * hygiene obligation this discharges — not a disk quota.
 */
export const EXECUTION_ROOT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Housekeeping ceilings. The maintainer is waiting on the gate, not on a sweep,
 * so the sweep gives up rather than delaying a commit.
 */
const SWEEP_ENTRY_CEILING = 512;
const SWEEP_DEADLINE_MS = 250;

/** Live roots this process owns, so a caught signal knows what to remove. */
const liveExecutionRoots = new Set();

/** The installed signal handlers, or `null` when this process owns no root. */
let signalDisposition = null;

const releaseSignalDisposition = () => {
  if (signalDisposition === null) {
    return;
  }

  for (const [signal, handler] of signalDisposition) {
    process.removeListener(signal, handler);
  }

  signalDisposition = null;
};

/**
 * Remove every live root synchronously.
 *
 * Synchronous on purpose: a signal handler that awaited would be racing the
 * process's own death, and the whole point is that the removal completes before
 * the signal is honored.
 */
const removeLiveExecutionRootsSync = () => {
  for (const root of liveExecutionRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Failing to reclaim disk is never a reason to interfere with a signal.
    }
  }

  liveExecutionRoots.clear();
};

/**
 * Install the disposition for the signals a process can catch.
 *
 * The handler cleans up, uninstalls itself, and re-raises the same signal at
 * this process. With no listener left, Node restores the signal's default
 * disposition, so the process dies exactly as it would have with no handler at
 * all — same signal, same status reported to the parent shell. A gate that
 * declined to die when the maintainer pressed Ctrl-C would be strictly worse
 * than the orphan this removes, so the signal is honored, never swallowed.
 */
const installSignalDisposition = () => {
  if (signalDisposition !== null) {
    return;
  }

  const handlers = new Map();

  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      removeLiveExecutionRootsSync();
      releaseSignalDisposition();
      process.kill(process.pid, signal);
    };

    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  signalDisposition = handlers;
};

/**
 * Materialize a fresh execution root and take responsibility for it.
 *
 * @param {string} prefix one of `EXECUTION_ROOT_PREFIXES`
 * @returns {Promise<string>} the created root
 */
export const createExecutionRoot = async (prefix) => {
  const root = await mkdtemp(path.join(tmpdir(), prefix));

  liveExecutionRoots.add(root);
  installSignalDisposition();

  return root;
};

/**
 * Remove an execution root and stop treating it as live.
 *
 * This is what the runners' `finally` blocks call. The removal it performs is
 * the removal they already performed; what it adds is that a signal arriving
 * afterwards no longer tries to remove a directory that is already gone, and
 * that a process owning no roots carries no handlers of ours.
 *
 * @param {string} root the root returned by `createExecutionRoot`
 */
export const releaseExecutionRoot = async (root) => {
  liveExecutionRoots.delete(root);

  if (liveExecutionRoots.size === 0) {
    releaseSignalDisposition();
  }

  await rm(root, { recursive: true, force: true });
};

/**
 * Reclaim execution roots an earlier run abandoned.
 *
 * `SIGKILL` cannot be caught, so some roots will always be left behind; this is
 * what collects them, at the start of a run, with no bookkeeping beyond the
 * prefix and the directory's own mtime.
 *
 * It never throws and never reports. Failing to reclaim disk may not change a
 * decision, an outcome, a diagnostic, or an exit status, so every failure —
 * an unreadable temporary directory, an unremovable root, a racing sweep in a
 * concurrent runner — is simply the end of this sweep.
 *
 * @param {object} [options]
 * @param {string} [options.temporaryRoot] directory to sweep; must be the system
 *   temporary directory or a directory inside it
 * @param {number} [options.olderThanMs] the age ceiling
 * @param {() => number} [options.now] clock seam
 * @returns {Promise<{ removed: string[], considered: number }>} for tests; callers ignore it
 */
export const sweepOrphanedExecutionRoots = async ({
  temporaryRoot = tmpdir(),
  olderThanMs = EXECUTION_ROOT_RETENTION_MS,
  now = Date.now,
} = {}) => {
  const removed = [];
  let considered = 0;

  try {
    const systemRoot = await realpath(tmpdir()).catch(() => path.resolve(tmpdir()));
    const sweepRoot = await realpath(temporaryRoot).catch(() => path.resolve(temporaryRoot));

    // SG-LIFE-001: the gate reclaims inside the directory it was given to
    // create workspaces in, and nowhere else. Never the repository, never the
    // Evidence store, never a path a maintainer chose.
    if (sweepRoot !== systemRoot && !containedWithin(systemRoot, sweepRoot)) {
      return { removed, considered };
    }

    const deadline = now() + SWEEP_DEADLINE_MS;
    const entries = await readdir(sweepRoot);

    for (const entry of entries) {
      if (considered >= SWEEP_ENTRY_CEILING || now() >= deadline) {
        break;
      }

      if (!EXECUTION_ROOT_PREFIXES.some((prefix) => entry.startsWith(prefix))) {
        continue;
      }

      considered += 1;

      const candidate = path.join(sweepRoot, entry);

      try {
        // `lstat`, so a symlink wearing the prefix is a decoy rather than a
        // path out of the temporary directory. Only a real directory is a root.
        // eslint-disable-next-line no-await-in-loop
        const described = await lstat(candidate);

        if (!described.isDirectory() || now() - described.mtimeMs < olderThanMs) {
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        await rm(candidate, { recursive: true, force: false });
        removed.push(candidate);
      } catch {
        // A root that cannot be read or removed stays; nothing is said.
      }
    }
  } catch {
    // A sweep that cannot run at all is a sweep that reclaimed nothing.
  }

  return { removed, considered };
};

/** The environment variable that names an activation self-test subject. */
export const SELF_TEST_ENV = 'CHANGE_EVALUATION_GATE_SELF_TEST';

/** The subject shape the activation self-test writes. */
export const SELF_TEST_SUBJECT_VERSION = HOOK_PROGRAM_SELF_TEST_SUBJECT_VERSION;

/** The exit status of a runner that did not authorize the change in front of it. */
const DENIED = 1;

/** The one client identity this runner ever acts as. */
const GIT_ADAPTER = Object.freeze({ id: 'git', surface: 'git-pre-commit' });

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
 *
 * It is exported so the operator surface resolves the clone it is observing
 * exactly the way the authoritative runner resolves the clone it is grading. A
 * second definition of "which clone is this" is a second answer waiting to
 * disagree with this one (`TB-040`).
 */
export const resolveRepositoryRoot = async (cwd) => {
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
export const resolveConfiguration = async (repositoryRoot) => {
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
export const resolveReceipt = async (repositoryRoot) => {
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
export const pinnedRunners = async (checks, { receipt, compose }) => {
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
      // An executable that is a script cannot start without the interpreter
      // activation resolved for it, so the pin carries that too and the
      // runtime search path is built from both (TB-028).
      interpreter: pin.interpreter ?? null,
      version: pin.version ?? null,
      preview: commandPreview(command, pin.executable),
    });
  }

  return { ok: true, resolved };
};

/** The one gate program identity this runner ever acts as. */
const GATE_ID = 'change-evaluation-gate';

/**
 * The identity of the gate-owned hook registration as it is on disk now.
 *
 * A receipt that pinned no block identity — a declarative hook manager, or a
 * manual registration — pinned nothing to observe, so nothing is observed. A
 * receipt that DID pin one is compared against the file it named: a
 * registration that is gone, unreadable, or no longer well formed observes as
 * `null`, which is drift rather than an assumed match (`NFR-SEC-004`).
 */
const observeHookRegistration = async (receipt) => {
  if ((receipt?.hookChain?.blockIdentity ?? null) === null) {
    return null;
  }

  const hookPath = receipt?.hookChain?.path ?? null;

  if (typeof hookPath !== 'string' || hookPath === '') {
    return null;
  }

  const ownership = receipt?.hookChain?.strategy
    ?? receipt?.hooks?.find((hook) => hook?.hook === AUTHORITATIVE_HOOK)?.ownership
    ?? 'gate-owned-shim';

  try {
    return (await readHookRegistration(hookPath, ownership)).blockIdentity;
  } catch {
    return null;
  }
};

/**
 * Assemble the Gate control surface as this machine presents it right now.
 *
 * This is the ONE observer both runners reach (`SG-OWNER-001`): the
 * authoritative runner and the preflight runner ask the same question of the
 * same machine, because a second copy of "what does this clone look like now"
 * is how the two would come to disagree — the reason `TB-024` gave resolution
 * one owner and `TB-026` gave the Evidence store one wiring.
 *
 * It is OBSERVATION. Nothing is opened for writing, nothing is repaired, and
 * nothing is re-pinned; recovery stays a confirmed operator action
 * (`FR-LIFE-019`). It is also not resistance: a machine owner can change every
 * identity below, and noticing is the entire claim (`SG-TRUST-001`, `ASM-001`).
 *
 * Each surface is observed at the same identity the receipt pinned it with, or
 * it is observed as absent. In particular the configuration identity is
 * computed by `configurationIdentity` — the rule `activate` pinned it with —
 * because an observation that hashed the file differently would report drift on
 * every commit, and one that hashed less than the receipt pinned would miss the
 * policy edit this reconciliation exists to catch (`AC-CFG-004`).
 *
 * Two surfaces are stated rather than re-derived, and this is their honest
 * limit. The gate's own release version and `runnerVersion` are declared by the
 * caller that ran activation and are not readable from this machine at decision
 * time, so what is asserted about the runtime is what IS observable: the
 * program deciding now is this gate, speaking this protocol version. And
 * activation pins no provider identities at all, so none are observed; a
 * receipt that names some cannot be matched by this machine, and an
 * unobservable surface is drift rather than an assumed match.
 */
export const observeControlSurface = async ({ activation, configuration, resolved = new Map() }) => {
  const receipt = activation?.receipt ?? null;
  const { receiptId: _pinned, ...body } = receipt ?? {};
  const runners = [];

  for (const pin of receipt?.runtime?.runners ?? []) {
    const executable = typeof pin?.executable === 'string' && pin.executable !== ''
      && await access(pin.executable, X_OK).then(() => true, () => false)
      ? pin.executable
      : null;
    // The invocation this clone would run for that check now, composed by
    // `pinnedRunners` through the one shared composition rule — so the pinned
    // preview and the observed one cannot diverge for any reason except an
    // edited descriptor. A pin that carries no preview pinned nothing here to
    // compare, and a pin for a role this evaluation does not resolve is not
    // observable through it.
    const preview = typeof pin?.preview === 'string' && pin?.role === 'evaluate'
      ? { preview: resolved.get(pin.check_id)?.preview ?? null }
      : {};

    runners.push({ ...pin, executable, ...preview });
  }

  return {
    receipt,
    observed: {
      runtime: {
        gate: { ...(receipt?.runtime?.gate ?? {}), id: GATE_ID, protocolVersion: PROTOCOL_VERSION },
        runnerVersion: receipt?.runtime?.runnerVersion ?? null,
      },
      // The adapter set the INSTALLED gate declares, under the ids activation
      // consented to. An adapter this gate no longer declares observes as
      // absent rather than as the version the receipt remembers.
      adapters: (receipt?.adapters ?? []).map((adapter) => {
        const declared = describeAdapter(adapter?.id ?? null);

        return {
          id: adapter?.id ?? null,
          version: declared?.version ?? null,
          authoritative: declared?.role === 'authoritative',
        };
      }),
      hookBlockIdentity: await observeHookRegistration(receipt),
      // The receipt's own content identity, recomputed from the file that was
      // just read. It is what makes the surfaces below meaningful: a receipt
      // edited to re-pin a weakened configuration would otherwise match itself.
      receiptId: receipt === null ? null : contentIdentity(body),
      configurationId: configurationIdentity({
        schemaVersion: configuration?.configuration?.schema_version ?? null,
        policy: configuration?.policy ?? null,
      }),
      // The pinned descriptors, with each executable re-observed on disk. A
      // pinned program that is gone observes as absent; `pinnedRunners` already
      // denies that for an evaluating check by name, and this covers the pins
      // that no declared check resolves through (TB-024).
      runners,
      providers: {},
    },
  };
};

/** Which check a bounded-execution callback is resolving an executable for. */
export const commandOwner = (checks, command) => checks.find(
  (check) => check.evaluate === command,
)?.id ?? null;

/**
 * A best-effort, explicitly unauthenticated actor for the Lifecycle record.
 *
 * Local attribution is a convenience, never an authentication claim: a machine
 * owner controls every input to it (NFR-AUD-001, SG-TRUST-001).
 */
const resolveActor = async (repositoryRoot) => {
  try {
    const { stdout } = await runFile('git', ['config', 'user.name'], { cwd: repositoryRoot });
    const name = stdout.trim();

    return { name: name.length > 0 ? name : null, source: 'git-config' };
  } catch {
    return { name: null, source: 'git-config' };
  }
};

/**
 * The runtime input values this activation named, read from this process's own
 * environment so the redactor can catch one if a check happens to print it.
 *
 * The receipt itself never carries a value — only the name a maintainer
 * approved (`activation.mjs`) — so the value is read fresh from the
 * environment this invocation actually runs in.
 */
const declaredSecrets = (receipt, environment) => (receipt?.runtimeInputs ?? [])
  .filter((name) => typeof name === 'string' && typeof environment[name] === 'string' && environment[name] !== '')
  .map((name) => ({ name, source: 'approved-environment-file', value: environment[name] }));

/**
 * Open the clone-local Evidence store the Activation receipt already
 * identifies.
 *
 * The store lives under the Git common directory `resolveReceipt` already
 * resolved, and its ceilings are the clone's own `evaluation_gate.evidence`
 * policy. A store that cannot be opened is a diagnosable local fault the
 * runner denies against, never a reason to grade a commit unrecorded
 * (`FR-EVID-001`, `FR-EVID-002`, `NFR-REL-003`).
 *
 * `openStoreSeam` is `openEvidenceStore` by default; it is a parameter only so
 * a test can prove the open-failure and append-failure paths deterministically,
 * the same way `evaluate` is already injectable to prove the crash path below.
 */
export const openStore = async ({
  repository, activation, configuration, environment, openStoreSeam, client = GIT_ADAPTER,
}) => {
  const identity = {
    actor: await resolveActor(repository.root),
    client: { ...client, version: activation.receipt?.receiptVersion ?? '1.0.0' },
    gate: activation.receipt?.runtime?.gate
      ?? { id: 'change-evaluation-gate', version: null, protocolVersion: PROTOCOL_VERSION },
    repository: { identity: repositoryIdentity(activation.gitCommonDirectory) },
  };

  try {
    const store = await openStoreSeam({
      repositoryRoot: repository.root,
      gitCommonDirectory: activation.gitCommonDirectory,
      evidencePolicy: configuration.policy?.evidence ?? null,
      identity,
      redactor: createRedactor({ secrets: declaredSecrets(activation.receipt, environment) }),
    });

    return { ok: true, store };
  } catch (error) {
    return {
      ok: false,
      reasonCode: 'evidence-store-unavailable',
      detail: `the clone-local Evidence store could not be opened (${error.message}); nothing is authorized.`,
    };
  }
};

/** How many contract findings a denial names before it summarizes the rest. */
const REPORTED_FINDINGS = 6;

/**
 * Judge the decision by the contract that defines it.
 *
 * `validateDecision` is the evaluation contract's own completeness rule, and it
 * is the only one this runner consults. Inspecting a field here would be a
 * second, weaker definition of a complete decision living beside the real one,
 * which is precisely how a decision of `{ authorization: 'allow', outcome:
 * 'passed' }` — no checks, no evidence, no evaluation identity, no snapshot —
 * came to exit `0` (`AC-EVAL-002`).
 *
 * The validator is total, so a finding is what a malformed decision produces.
 * A throw would still be a refusal: this path decides whether a commit is
 * authorized, and it never lets an unexpected error read as the absence of a
 * problem (`NFR-REL-003`).
 *
 * It is exported so the preflight runner judges the same decision by the same
 * rule. Two runners with two definitions of a complete decision is the
 * divergence `AC-EVAL-002` exists to prevent (`TB-037`).
 */
export const contractFindings = (decision) => {
  try {
    return validateDecision(decision);
  } catch (error) {
    return [{
      path: '<decision>',
      message: `the decision contract could not judge this decision (${error.message}).`,
    }];
  }
};

/**
 * Say what the decision was, in a form a maintainer reading `git commit` output
 * can act on, and translate it into an exit status.
 *
 * Only an `allow` authorization exits `0`. A decision this runner cannot read
 * is not an allow: absence of a denial has never been evidence of one
 * (`NFR-REL-003`).
 */
const report = (decision) => {
  const findings = contractFindings(decision);

  if (findings.length > 0) {
    const named = findings.slice(0, REPORTED_FINDINGS)
      .map((finding) => `${finding.path}: ${finding.message}`);
    const remaining = findings.length - named.length;

    return {
      exitCode: DENIED,
      reasonCode: 'decision-malformed',
      lines: [
        say('the evaluation returned no decision this runner can verify, so nothing is authorized.'),
        ...named.map((detail) => say(`  ${detail}`)),
        ...(remaining > 0 ? [say(`  and ${remaining} further contract findings.`)] : []),
      ],
    };
  }

  const { authorization, outcome } = decision;
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
    // Evidence is bound on every authoritative evaluation now, so a decision
    // that reached `allow` with nothing recorded means the store itself failed
    // — the unsafe-capture refusal already turns into `deny` before reaching
    // here. Absence of a record is not a reason to withhold a passing decision
    // in general (`NFR-OPER-001`), but the authoritative path's own contract is
    // stricter: nothing here authorizes a commit it cannot also prove
    // (`NFR-REL-003`, `RISK-001`).
    //
    // The rule is stated as presence rather than as a stated failure. Asking
    // whether persistence was reported as `false` denies a decision that admits
    // it failed and passes one that says nothing at all, because `undefined ===
    // false` is `false` — and absence of evidence is never success. An allow is
    // authorized only by evidence that was positively persisted and carries the
    // reference it can be read back by.
    const persisted = decision.evidence.persisted === true
      && typeof decision.evidence.reference?.evidenceId === 'string'
      && decision.evidence.reference.evidenceId !== '';
    const evidenceReasonCode = persisted
      ? null
      : decision.evidence.reference?.reasonCode ?? 'evidence-not-persisted';

    if (evidenceReasonCode !== null) {
      lines.push(say(`evidence-persistence-failed: ${evidenceReasonCode}: this commit's evidence could not be recorded, so it is not authorized.`));

      return { exitCode: DENIED, reasonCode: 'evidence-persistence-failed', lines };
    }

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
  openEvidenceStore: openStoreSeam = openEvidenceStore,
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

  const store = await openStore({
    repository, activation, configuration, environment, openStoreSeam,
  });

  if (!store.ok) {
    return denied(store.reasonCode, store.detail);
  }

  // What earlier interrupted runs abandoned, reclaimed before this run adds
  // its own. Bounded and silent: it can neither delay this commit nor change
  // anything the maintainer is told (TB-038).
  await sweepOrphanedExecutionRoots();

  const executionRoot = await createExecutionRoot('gate-hook-runner-exec-');
  const executor = createBoundedExecutor({
    totalSeconds: configuration.policy?.budget?.total_seconds ?? null,
    resolveExecutable: (command) => runners.resolved.get(commandOwner(checks, command)) ?? null,
    environment,
    // The Evidence envelope's whole purpose is a bounded, redacted excerpt of
    // what a check printed; capturing nothing would leave that purpose unmet
    // on the one path a maintainer actually reaches (FR-EVID-003).
    captureOutput: true,
    // What the pinned programs need in order to start at all (TB-028).
    runtimePath: runtimeSearchPath([...runners.resolved.values()]),
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
          ...GIT_ADAPTER,
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
      evidenceStore: store.store,
      // The commit is graded by the configuration this clone activated, or it
      // is not graded at all. Without this the receipt pins a policy identity
      // nothing ever compares, and an agent whose commit was blocked can demote
      // the check that blocked it and commit against the weakened policy with
      // no re-consent and no signal (`AC-SEC-001`, `AC-CFG-004`, `NFR-SEC-004`).
      controlSurface: await observeControlSurface({ activation, configuration, resolved: runners.resolved }),
    });
  } catch (error) {
    // A runner that crashed produced no decision. It denies, and it says so,
    // rather than letting a thrown error reach the shell as an exit status
    // nobody can read (NFR-REL-003).
    return denied('runner-failed', `the evaluation failed internally (${error.message}); nothing is authorized.`);
  } finally {
    await releaseExecutionRoot(executionRoot);
  }

  return report(decision);
};
