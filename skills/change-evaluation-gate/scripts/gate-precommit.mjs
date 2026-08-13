#!/usr/bin/env node
/**
 * The packaged authoritative pre-commit runner.
 *
 * This is the program a registered `pre-commit` shim points at. Until it
 * existed, `registerOwnedHook` wrote a shim around a hook program the caller
 * supplied, every top-level script in this skill was release evidence with its
 * own fixture runner, and a real activation attempt therefore pointed its shim
 * at `scripts/lib/evaluate.mjs` — a pure library that prints nothing and exits
 * `0`. That shim would have allowed every commit while the maintainer believed
 * the clone was enforced.
 *
 * SHAPE: this is a bare packaged script, not the first subcommand of a `gate`
 * CLI. The lifecycle command surface is a separate contract and is explicitly
 * out of scope here; a `gate` CLI whose only subcommand was this one would be
 * that surface, half-built and already committed to a shape its own contract
 * has not settled. A later `gate` CLI can delegate to this entry point without
 * changing what an activated clone already registered.
 *
 * Usage:
 *   node skills/change-evaluation-gate/scripts/gate-precommit.mjs
 *
 * Exit status is `0` only when the authoritative decision authorized the
 * commit. Every failure — unreadable configuration, absent Activation receipt,
 * unresolved runner, malformed decision, internal error — exits non-zero with a
 * stated reason (`NFR-REL-003`). Absence of evidence is never success.
 *
 * When `CHANGE_EVALUATION_GATE_SELF_TEST` names a subject, this program is
 * being proved by activation rather than run against somebody's work: it
 * evaluates that subject and denies it deliberately.
 *
 * It claims no protection beyond a cooperative local process (`SG-TRUST-001`).
 */

import { runHook } from './lib/hook-runner.mjs';

const main = async () => {
  let result;

  try {
    result = await runHook({ cwd: process.cwd(), environment: process.env });
  } catch (error) {
    // Nothing reaches the shell as a bare crash: a runner that produced no
    // decision denies, and says why.
    process.stderr.write(`change-evaluation-gate: the runner failed before it decided (${error.message}); nothing is authorized.\n`);
    process.exitCode = 1;

    return;
  }

  for (const line of result.lines) {
    process.stderr.write(`${line}\n`);
  }

  process.exitCode = result.exitCode;
};

await main();
