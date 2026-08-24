#!/usr/bin/env node
/**
 * The packaged operator command: `gate`.
 *
 * `gate-precommit.mjs` and `gate-preflight.mjs` deliberately deferred this
 * shape — "a `gate` CLI whose only subcommand was this one would be that
 * surface, half-built and already committed to a shape its own contract has not
 * settled". The contract has settled it: the lifecycle command contract names
 * every operation an activated clone exposes, and this is where they are
 * reached. Neither packaged runner changes, and neither is a subcommand of this
 * one: an activated clone's registered shim still points where it always
 * pointed.
 *
 * `TB-040` shipped the operations that write nothing; `TB-041` added the ones
 * that do. Every command here previews by default and performs only when a
 * separate later invocation names the token of a preview that still describes
 * this clone — there is no flag that does both, and no token that anything
 * bypasses. `gate activate` and `gate fix` remain separate contracts and are
 * refused here by name.
 *
 * Usage:
 *   node .../gate.mjs status     [--json]
 *   node .../gate.mjs locks      [--recover <token>] [--json]
 *   node .../gate.mjs prune      [selector] [--confirm <token>] [--json]
 *   node .../gate.mjs repair     [--hook-script <path>] [--confirm <token>] [--json]
 *   node .../gate.mjs update     [--confirm <token>] [--json]
 *   node .../gate.mjs deactivate [--confirm <token>] [--json]
 *   node .../gate.mjs uninstall  --asset <path> [--confirm <token>] [--json]
 *   node .../gate.mjs cleanup    [--confirm <token>] [--json]
 *
 * Exit status is `0` when the command ran and found nothing wrong or performed
 * what was confirmed, `1` when it ran and the clone needs attention — including
 * a confirmation this clone refused — and `2` when it could not run at all. A
 * `broken` clone and a refused confirmation are not failed invocations, and an
 * agent branches on that difference without reading a word of output.
 *
 * It claims no protection beyond a cooperative local process (`SG-TRUST-001`).
 */

import { EXIT_UNRUNNABLE, runOperatorCommand } from './lib/operator-surface.mjs';

const main = async () => {
  let result;

  try {
    result = await runOperatorCommand({
      cwd: process.cwd(),
      argv: process.argv.slice(2),
      environment: process.env,
    });
  } catch (error) {
    // Nothing reaches the shell as a bare crash: a surface that produced no
    // document says so, and says it as "could not run" rather than as a healthy
    // clone or a completed operation.
    process.stderr.write(`change-evaluation-gate: the command failed before it could report (${error.message}); nothing was observed and nothing was performed.\n`);
    process.exitCode = EXIT_UNRUNNABLE;

    return;
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  process.exitCode = result.exitCode;
};

await main();
