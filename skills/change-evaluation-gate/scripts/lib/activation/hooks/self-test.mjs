import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The environment variable that names the self-test subject.
 *
 * A hook program that finds it set is being proved, not run against somebody's
 * work: it must evaluate the named subject rather than the working tree it was
 * started in, and exit non-zero when the subject must be denied.
 */
export const HOOK_PROGRAM_SELF_TEST_ENV = 'CHANGE_EVALUATION_GATE_SELF_TEST';

/** The versioned on-disk shape of a hook-program self-test subject. */
export const HOOK_PROGRAM_SELF_TEST_SUBJECT_VERSION = 'change-evaluation-gate/self-test-subject/v1';

/** How long the registered hook program is given to reach its decision. */
const HOOK_PROGRAM_SELF_TEST_TIMEOUT_MS = 30_000;

/** Run one program to completion, reporting whether it started at all. */
const runProgram = ({ interpreter, argv, cwd, env, timeoutMs }) => new Promise((resolve) => {
  const child = spawn(interpreter, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  let settled = false;

  const settle = (outcome) => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timer);
    resolve(outcome);
  };

  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    settle({ started: true, exitCode: null, signal: 'SIGKILL', stdout, stderr, error: 'timed out' });
  }, timeoutMs);

  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', (error) => settle({
    started: false, exitCode: null, signal: null, stdout, stderr, error: error.message,
  }));
  child.on('close', (exitCode, signal) => settle({
    started: true, exitCode, signal, stdout, stderr, error: null,
  }));
});

/**
 * Prove that the program about to be registered actually denies.
 *
 * The one artifact activation never used to execute is the program it writes
 * into `pre-commit`. Presence of an interpreter and a script proves nothing: a
 * program pointed at a pure library prints nothing and exits `0`, so the
 * installed hook would allow every commit while activation reported a healthy
 * activated clone (FR-LIFE-004, NFR-REL-003).
 *
 * So the program is run against a throwaway subject that must be denied — never
 * the maintainer's own work, and nothing is left behind — and it must both exit
 * non-zero *and* show that it read the subject, by naming the subject's own
 * per-run `selfTestId` in its output. A program that cannot start, that is
 * killed before it decides, that allows the subject, or that exits non-zero
 * without ever answering it is unproved and refused (NFR-REL-003). Repairing it
 * is not this transaction's business.
 */
export const selfTestHookProgramDenial = async ({
  program,
  repositoryRoot,
  timeoutMs = HOOK_PROGRAM_SELF_TEST_TIMEOUT_MS,
}) => {
  if (!program?.interpreter || !program?.script) {
    return { ok: false, reason: 'hook-program-missing', detail: 'Activation has no hook program to prove.' };
  }

  const subjectRoot = await mkdtemp(path.join(tmpdir(), 'gate-hook-program-self-test-'));
  const subjectPath = path.join(subjectRoot, 'subject.json');
  const selfTestId = randomUUID();

  try {
    await writeFile(subjectPath, `${JSON.stringify({
      subjectVersion: HOOK_PROGRAM_SELF_TEST_SUBJECT_VERSION,
      selfTestId,
      // What the program is being asked to prove, stated in the subject itself
      // so no program has to guess why it was started.
      expect: 'denied',
      change: { kind: 'self-test', root: subjectRoot },
      checks: [{
        id: 'hook-program-self-test',
        required: true,
        outcome: 'failed',
        detail: 'A required check that fails; a program that enforces must deny this change.',
      }],
    }, null, 2)}\n`, 'utf8');

    const outcome = await runProgram({
      interpreter: program.interpreter,
      argv: [path.resolve(repositoryRoot, program.script), ...(program.args ?? [])],
      cwd: subjectRoot,
      env: { ...process.env, [HOOK_PROGRAM_SELF_TEST_ENV]: subjectPath },
      timeoutMs,
    });

    // A program that never ran has proved nothing. Its non-zero result is the
    // shell failing to start it, not the gate denying anything.
    if (!outcome.started) {
      return {
        ok: false,
        reason: 'hook-program-cannot-start',
        detail: `The registered hook program could not be started: ${outcome.error}.`,
      };
    }

    if (outcome.exitCode === null) {
      return {
        ok: false,
        reason: 'hook-program-unproved',
        detail: `The registered hook program never reached a decision (${outcome.error ?? outcome.signal}).`,
      };
    }

    // A program that answered names the subject it answered. The subject
    // carries a per-run `selfTestId` no program can know without reading it, so
    // repeating it is the cheapest available proof that this run reached a
    // decision about *this* subject rather than about nothing at all.
    const answered = `${outcome.stdout}${outcome.stderr}`.includes(selfTestId);

    if (outcome.exitCode === 0) {
      return {
        ok: false,
        reason: 'hook-program-allowed-denied-change',
        detail: 'The registered hook program exited 0 for a change it had to deny; it enforces nothing.',
        exitCode: 0,
      };
    }

    // A non-zero exit alone is an exit status, not a decision. A program that
    // started, threw, and died `1` without ever naming the subject proves only
    // that it is broken — fail-closed, but for the wrong reason (NFR-REL-003).
    if (!answered) {
      return {
        ok: false,
        reason: 'hook-program-unproved',
        detail: `The registered hook program exited ${outcome.exitCode} without naming the self-test subject ${selfTestId}; a program that merely fails to run is not a program that denies.`,
        exitCode: outcome.exitCode,
      };
    }

    return {
      ok: true,
      reason: null,
      detail: `The registered hook program denied the self-test subject ${selfTestId} with exit ${outcome.exitCode}.`,
      exitCode: outcome.exitCode,
    };
  } finally {
    await rm(subjectRoot, { recursive: true, force: true });
  }
};
