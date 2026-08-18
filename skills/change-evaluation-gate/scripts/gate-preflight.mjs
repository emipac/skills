#!/usr/bin/env node
/**
 * The packaged desktop preflight runner a client hook can register.
 *
 * This is the program a desktop adapter's registration entry points at. Until
 * it existed, `registerAdapterSurface` wrote an entry naming whatever command
 * it was handed, and a maintainer pointing a desktop preflight hook at
 * `gate-precommit.mjs` got a silent no-op: that program grades the Git index,
 * writes every line to stderr, and claims an authoritative role the desktop
 * declaration forbids.
 *
 * SHAPE: this is a bare packaged script beside `gate-precommit.mjs`, not a
 * `gate` CLI subcommand. The lifecycle command surface is a separate contract.
 *
 * Usage:
 *   node skills/change-evaluation-gate/scripts/gate-preflight.mjs --adapter <id>
 *
 * The adapter id is supplied by the registration command so an unreadable
 * payload can still be answered through that adapter's declared feedback
 * channel. The native payload is read from stdin. The process always exits
 * `0`; the decision travels through the declared channel, never the exit
 * status (SG-SUPPORT-001).
 */

import { runPreflight } from './lib/preflight-runner.mjs';

const readStdin = async () => {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks.map((chunk) => (
    typeof chunk === 'string' ? Buffer.from(chunk) : chunk
  ))).toString('utf8');
};

const main = async () => {
  let result;

  try {
    result = await runPreflight({
      cwd: process.cwd(),
      stdin: await readStdin(),
      argv: process.argv.slice(2),
      environment: process.env,
    });
  } catch (error) {
    // Nothing reaches the client as a bare crash: an internal failure is an
    // unverified preflight, and this entry point has no declared adapter to
    // speak through once the runner itself threw. Empty stdout is not a clean
    // pass, and the reason is written where a maintainer can read it.
    process.stderr.write(`change-evaluation-gate: the preflight runner failed before it could answer (${error.message}); nothing was evaluated.\n`);
    process.exitCode = 0;

    return;
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  // A preflight that deliberately says nothing to the agent still says why to
  // the person: the client shows hook stderr in its own panel, so a silent
  // turn and a clean one are never the same thing to a maintainer.
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  process.exitCode = 0;
};

await main();
