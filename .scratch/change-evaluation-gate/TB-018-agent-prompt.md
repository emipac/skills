# TB-018 delegation prompt

Hand the block below to one fresh implementation agent. It is written to be
pasted whole; everything it asserts was verified against the repository at
`c9a8668`.

Update the baseline block if commits land before it is used.

---

You are implementing ONE delivery contract in the AI Skills Framework repository.

Working directory: `/Users/emipac/www/ai skill framework/ai-skills-framework`

## Your process

Read and follow `skills/implement/SKILL.md`. Drive VERTICAL RED-GREEN CYCLES:
capture a genuine red caused by MISSING behaviour before implementing, write the
MINIMUM code to turn that one red green, then move on.

Batch-generating everything and validating at the end is explicitly prohibited.
**Warning from the Tech Lead:** several earlier slices in this feature
over-implemented in their first green step, which silently pre-satisfied later
cycles and cost them genuine red-first evidence. Stub each new seam to a no-op
first, capture the behaviour-caused red, then implement only that behaviour.
Flag honestly any test that was NOT red-first — this is checked every time, and
previous agents' honest flags have been valued rather than penalised.

Land work incrementally to disk; an agent in this session was killed mid-run by
an API spend limit.

## Your ticket

`.scratch/change-evaluation-gate/issues/18-package-the-authoritative-git-hook-runner.md`

TB-018 — Package the authoritative Git hook runner. Read it in full, including
"The runner must answer the activation self-test" and "Why release qualification
missed this".

## Read these first

1. `/private/tmp/claude-501/-Users-emipac-www-ai-skill-framework/66ef5074-277d-4639-afb7-af8afca4fa80/scratchpad/gate-delegation-brief.md`
   — conventions and pre-verified gate results. If that path is gone (it is a
   session scratchpad), the conventions you need are restated below.
2. `skills/change-evaluation-gate/references/activation-transaction-contract.md`
   — especially the "Proving the hook program" section.
3. `skills/change-evaluation-gate/references/evaluation-process-contract.md`

Pre-verified: the ticket audit returns `valid: false` overall — NOISE from
co-located Wayfinder files, ZERO errors on any numbered ticket. Confirm by
filtering, then move on. Do not restructure that directory.

## The defect, precisely

Verify each of these yourself before changing anything.

`registerOwnedHook` writes a `/bin/sh` shim whose body is:

```sh
exec <interpreter> <script> "$@"
```

`<interpreter>` and `<script>` come from `runtime.hookProgram`, supplied by the
CALLER. Nothing is shipped. Every top-level `.mjs` under
`skills/change-evaluation-gate/scripts/` is release evidence — smoke,
conformance, portability — and each supplies its own fixture runner.
`package.json` has no `bin`.

A real activation attempt therefore pointed the shim at
`scripts/lib/evaluate.mjs`, the closest thing available. Confirm what that does:

```bash
node skills/change-evaluation-gate/scripts/lib/evaluate.mjs; echo "exit=$?"
# no output, exit=0
```

A pre-commit hook that exits `0` allows the commit. That shim would have been a
**silent no-op passing every commit** while the maintainer believed the clone was
enforced. `FR-EVAL-001` requires an activated repository to invoke the
authoritative gate for every local commit; today there is nothing to invoke.

## What to build

One packaged executable runner that a registered hook can point at. It:

1. resolves the repository root and reads the clone's configuration and
   Activation receipt;
2. builds the versioned evaluation request for the `commit-attempt` trigger;
3. invokes the existing `evaluate` seam — it adds NO policy of its own;
4. prints the decision in a form a human reading `git commit` output can act on;
5. exits `0` **only** on an `allow` authorization.

## THREE HARD DEPENDENCIES

### 1. It must answer the activation self-test, or it cannot be registered

`TB-020` closed the hole that allowed a non-enforcing program. Activation now
EXECUTES the hook program against a known-failing subject and refuses it unless
it exits non-zero. A runner that ignores this protocol will be refused at
activation, so this is a hard requirement, not a nicety.

- the absolute path of a `subject.json` arrives in the environment variable
  `CHANGE_EVALUATION_GATE_SELF_TEST`;
- the program is started with the subject directory as its working directory;
- **a program that finds that variable set is being proved, not run against
  somebody's work.** It must evaluate the named subject instead of its working
  tree;
- the subject pins `subjectVersion`, a per-run `selfTestId`, `expect: "denied"`,
  and the failing required check that makes it deniable;
- exiting non-zero proves denial. Exiting `0` is
  `hook-program-allowed-denied-change` and activation refuses.

**Deny that subject deliberately.** `TB-020` treats ANY non-zero exit as proof,
so a runner that merely crashes would also pass — fail-closed, but for the wrong
reason, and it would then block every real commit too.

### 2. Compose arguments through the shared rule

`TB-019` put runner argument composition in ONE place:
`composeArguments` in `scripts/lib/command-descriptor.mjs`. `commandPreview` and
`bounded-execution.mjs`'s `spawn` both derive from it, which is what stops
preview and execution drifting.

Use it. Do not re-derive how `composer-bin` or `package-script` compose. A
descriptor its runner cannot compose reports `command-args-uncomposable` — that
is a refusal to surface, not a case to work around.

### 3. There is NO configuration reader — build one properly

Nothing parses `.agent-framework.yaml` into a usable object.
`grader-surface.mjs` only NAMES the path as a control surface; `lifecycle.mjs`
only removes top-level keys line-by-line for cleanup. Neither reads it.

The real activation attempt hand-rolled a regular-expression parser including
`replace(/'/g, '"')`, which corrupts any value containing an apostrophe. **Do
not do that.** A consumer needing the configuration should not have to
reconstruct it, so building a supported reader is part of this slice.

## HARD CONSTRAINTS

- **No path may exit `0` without an `allow` authorization.** Unreadable
  configuration, missing receipt, unresolvable runner, malformed output, crash,
  timeout — every one exits non-zero with a stated reason (`NFR-REL-003`).
  Absence of evidence is never success.
- Do not implement policy, duplicate the Evidence ladder, or reimplement any
  part of `evaluate`.
- Do not add desktop adapter invocation, the `gate` lifecycle command surface,
  or activation changes beyond pointing at the packaged runner.
- Never touch this repository's Git state, `.git/hooks/`, or `core.hooksPath`;
  never run `git commit` here. Reuse `assertThrowawayRepository` as established
  in `tests/gate-activation.test.mjs`.
- Node built-ins only. No new dependencies.

## Acceptance criteria

- `AC-EVAL-001`: in an activated throwaway clone, a commit whose required check
  fails is refused by the registered hook with a non-zero exit and a stated
  reason, and a commit whose required checks pass is accepted.
- `AC-EVAL-001`: the runner exits non-zero when it cannot read the
  configuration, cannot find the receipt, cannot resolve a runner, or fails
  internally; no failure path exits `0`.

Safeguards: `SG-EVAL-001` (evaluate the proposed snapshot, never the mutable
live worktree), `NFR-REL-003` (every harness failure normalizes to `unverified`
and denies), `SG-TRUST-001` (claim no protection beyond a cooperative local
process; do not describe anything as tamper-proof).

## Evidence required

1. `npm run test:unit`
2. `gate-activation-smoke` — **extended by this slice**, then RUN. It already
   drives real blocked and allowed commits in a throwaway clone using a FIXTURE
   hook program; it must now drive the PACKAGED runner. That substitution is the
   whole point: the fixture supplying the missing thing is why release
   qualification passed while this defect existed.

Also run `npm run validate`, `npm run test:install`, and regression-run the other
eight capabilities: `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke`, `gate-hook-conformance-smoke`,
`gate-lifecycle-smoke`, `gate-adapter-conformance`,
`gate-security-control-smoke`, `gate-runtime-portability`. Report every outcome.

## Conventions

- If this slice adds a new npm capability, name the script EXACTLY the capability
  name (1:1, no `test:` prefix), implement it as an `.mjs` under
  `skills/change-evaluation-gate/scripts/`, and register it in
  `verification.capabilities` in `.agent-framework.yaml`. It must be
  non-interactive, offline, `--json`-capable, and exit non-zero on failure.
  **This slice likely needs no new capability** — it extends
  `gate-activation-smoke`.
- Never modify `AGENTS.md` (it is in `protected_files`).
- Add a `docs/history/` entry and a `.changeset/` entry.
- Do NOT commit or push.

## Baseline (verify before you start; update if commits landed since)

HEAD `c9a8668`, tree clean. `npm run test:unit` **268 pass, 0 fail**;
`npm run validate` OK (29 skills, 218 Markdown files); `npm run test:install` OK;
all nine capabilities exit 0. Do not break these.

## Open decision to make and record

The ticket leaves one non-blocking assumption: whether the runner is a bare
script or the first subcommand of a `gate` CLI. A packaged entry point is
required either way and lifecycle operations stay agent-driven for now, but
choosing the CLI shape would make this the natural home for later
`gate status` and `gate activate`. Decide during implementation and say which
you chose and why.

## Report

Acceptance IDs delivered; red→green evidence per cycle, flagging any test that
was NOT red-first; exact verification commands and outcomes including the
extended smoke; safeguards preserved; contract amendments; the CLI-shape
decision; and anything you deliberately did not do. Confirm explicitly that this
repository's Git state and hooks were never touched. Be honest about failures —
a red suite reported as green is the worst possible outcome.
