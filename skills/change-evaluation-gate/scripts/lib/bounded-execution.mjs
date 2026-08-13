/**
 * Bounded execution of resolved evaluation commands.
 *
 * Two limits are enforced together: the per-check timeout confirmed by the
 * project and the total evaluation budget. Neither has a framework-invented
 * default (Q-007, NFR-PERF-001).
 *
 * Nothing here defines a command. It receives an already-validated Command
 * descriptor and an activation-time executable resolution, and it never
 * interprets shell text (SG-OWNER-001, SG-CMD-001).
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

import { composeArguments } from './command-descriptor.mjs';

/** Grace between the polite and the final signal to a timed-out tree. */
export const TERMINATION_GRACE_MS = 100;

/**
 * How much output one attempt may hold in memory when capture is enabled.
 *
 * Capture is opt-in because execution alone never needs it: a check is graded
 * by its exit code. Only Evidence wants what the check said, and the Evidence
 * store bounds and redacts it again before anything is persisted. This limit
 * exists so a runaway writer cannot exhaust memory before that happens; it is
 * the per-blob ceiling, never more (FR-EVID-003).
 */
export const DEFAULT_CAPTURE_LIMIT_BYTES = 4 * 1024 * 1024;

const signalTree = (child, signal) => {
  try {
    // The child leads its own process group, so the negative pid reaches every
    // descendant it spawned. Killing only the direct child would leave
    // background work running, and background completion must never be able to
    // authorize the current commit (FR-POL-005).
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The tree already exited; there is nothing left to terminate.
    }
  }
};

const terminateTree = async (child) => {
  signalTree(child, 'SIGTERM');

  await new Promise((resolve) => { setTimeout(resolve, TERMINATION_GRACE_MS); });

  signalTree(child, 'SIGKILL');
};

const environmentFor = (allowedEnvironment, source) => {
  const environment = {};

  for (const name of allowedEnvironment ?? []) {
    if (source[name] !== undefined) {
      environment[name] = source[name];
    }
  }

  return environment;
};

/**
 * Create the bounded executor for one evaluation.
 *
 * @param {object} options total budget, executable resolution, and clock
 */
export const createBoundedExecutor = ({
  totalSeconds = null,
  resolveExecutable,
  environment = process.env,
  captureOutput = false,
  captureLimitBytes = DEFAULT_CAPTURE_LIMIT_BYTES,
} = {}) => {
  const totalMs = Number.isInteger(totalSeconds) ? totalSeconds * 1000 : null;
  let consumedMs = 0;

  const remainingMs = () => (totalMs === null ? null : Math.max(totalMs - consumedMs, 0));

  const execute = async ({
    command,
    executionRoot,
    timeoutSeconds,
    budgetRemainingMs = null,
  }) => {
    const resolution = resolveExecutable?.(command) ?? null;

    if (!resolution?.executable) {
      return {
        executed: false,
        exitCode: null,
        durationMs: 0,
        reasonCode: 'configuration-invalid',
      };
    }

    // Whichever bound runs out first wins: the check's confirmed timeout, this
    // executor's own budget, or the remaining evaluation budget supplied by the
    // caller (NFR-PERF-001).
    const bounds = [
      timeoutSeconds * 1000,
      remainingMs(),
      budgetRemainingMs,
    ].filter((bound) => Number.isFinite(bound));
    const limitMs = Math.max(Math.min(...bounds), 1);
    const startedAt = Date.now();

    // Execution never composes its own argument vector. It derives it from the
    // runner's own rule, the same rule the preview used, so the command a
    // maintainer approved is the command that runs.
    const composition = composeArguments(command);

    if (composition.error) {
      return {
        executed: false,
        exitCode: null,
        durationMs: 0,
        reasonCode: 'configuration-invalid',
      };
    }

    const child = spawn(resolution.executable, composition.args, {
      cwd: path.join(executionRoot, command.working_directory ?? '.'),
      env: environmentFor(command.allowed_environment, environment),
      stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      // The check leads its own process group so the whole tree can be
      // terminated on timeout or budget exhaustion.
      detached: true,
    });
    const capture = { bytes: 0, chunks: [], truncated: false };

    if (captureOutput) {
      // stdout and stderr are interleaved into one stream: a check reports one
      // story, and splitting it would misrepresent what it said.
      for (const stream of [child.stdout, child.stderr]) {
        stream?.on('data', (chunk) => {
          const room = Math.max(captureLimitBytes - capture.bytes, 0);

          if (room === 0 || chunk.length > room) {
            capture.truncated = true;
          }

          if (room > 0) {
            const kept = chunk.subarray(0, Math.min(chunk.length, room));

            capture.chunks.push(kept);
            capture.bytes += kept.length;
          }
        });
      }
    }

    const captured = () => (captureOutput
      ? {
        output: Buffer.concat(capture.chunks).toString('utf8'),
        outputTruncated: capture.truncated,
      }
      : {});

    const attempt = await new Promise((resolve) => {
      let settled = false;

      const timer = setTimeout(async () => {
        settled = true;

        await terminateTree(child);

        resolve({
          executed: true,
          exitCode: null,
          timedOut: true,
          durationMs: Date.now() - startedAt,
          ...captured(),
        });
      }, limitMs);

      child.on('error', (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve({
          executed: false,
          exitCode: null,
          error: error.message,
          durationMs: Date.now() - startedAt,
          ...captured(),
        });
      });

      // With capture enabled the pipes must be drained before the attempt is
      // settled, so `close` — not `exit` — is the completion signal.
      child.on(captureOutput ? 'close' : 'exit', (code) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        resolve({
          executed: true,
          exitCode: code,
          timedOut: false,
          durationMs: Date.now() - startedAt,
          ...captured(),
        });
      });
    });

    consumedMs += attempt.durationMs;

    return attempt;
  };

  return { execute, remainingMs };
};
