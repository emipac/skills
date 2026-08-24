#!/usr/bin/env node
/**
 * The packaged operator command: `gate`.
 *
 * `gate-precommit.mjs` and `gate-preflight.mjs` deliberately deferred this
 * shape — "a `gate` CLI whose only subcommand was this one would be that
 * surface, half-built and already committed to a shape its own contract has not
 * settled". The contract has settled it: the lifecycle command contract already
 * names `gate status`, `gate locks`, and `gate prune`, and this is where they
 * are reached. Neither packaged runner changes, and neither is a subcommand of
 * this one: an activated clone's registered shim still points where it always
 * pointed.
 *
 * This slice ships the three operations that write nothing. The confirmed half
 * of the lifecycle is a separate contract and is refused here by name.
 *
 * Usage:
 *   node skills/change-evaluation-gate/scripts/gate.mjs status [--json]
 *   node skills/change-evaluation-gate/scripts/gate.mjs locks  [--json]
 *   node skills/change-evaluation-gate/scripts/gate.mjs prune  [selector] [--json]
 *
 * Exit status is `0` when the command ran and found nothing wrong, `1` when it
 * ran and the clone needs attention, and `2` when it could not run at all. A
 * `broken` clone is not a failed invocation, and an agent branches on that
 * difference without reading a word of output.
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
    // observation says so, and says it as "could not run" rather than as a
    // healthy clone.
    process.stderr.write(`change-evaluation-gate: the observation failed before it could report (${error.message}); nothing was observed.\n`);
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
