# TB-025 — Package the desktop preflight runner a client hook can register

Status: blocked
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: blocked, defect
Blocked by: TB-026
Tracker ID: 25-package-the-desktop-preflight-runner
Draft key: TB-025

**Status:** blocked — by `TB-026` alone; the SRS amendment this needed is
approved as revision `0.2.5`

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer who registers the Gate in a supported desktop client gets early
preflight feedback in the client that registered it. A packaged preflight
program evaluates the work in front of the agent, presents the result as
`not-authoritative`, and answers through the output channel that client's own
declaration names — so the agent is told what failed, while only the Git
integration ever grants or denies commit authorization.

## SRS Traceability

- `FR-ADAPT-001`, `FR-ADAPT-002`, `FR-ADAPT-003`, `FR-ADAPT-005`,
  `FR-ADAPT-008`, `FR-EVAL-002`, `FR-EVID-001`
- `AC-ADAPT-001`, `AC-ADAPT-002`, `AC-ADAPT-003`
- `SG-SUPPORT-001`, `SG-EVAL-001`, `SG-OWNER-001`
- `NFR-REL-003`
- `RISK-004`

## Defect this contract fixes

Found by a maintainer wiring the Gate into Cursor on a real project. The
adapter layer declares exactly where Cursor registers a command
(`adapters.mjs:311`: `.cursor/hooks.json`, container `hooks`, flat command,
trigger `work-complete`), and `registerAdapterSurface` writes that entry for
whatever command it is handed. **Nothing ships for it to point at.** The only
packaged program in the skill is `gate-precommit.mjs`; every other top-level
script is a release-evidence capability with its own harness.

So the maintainer pointed the client's `stop` hook at the authoritative
pre-commit runner:

```json
"stop": [{ "command": "node .../scripts/gate-precommit.mjs" }]
```

That runs, and does nothing useful, for three independent reasons — each
verified against the shipped code:

1. **It cannot answer the client.** Cursor's `stop` hook reads a JSON object on
   **stdout** carrying an optional `followup_message`, which the client submits
   as the next user message. `gate-precommit.mjs` writes every decision line to
   **stderr** and speaks only through its exit status
   (`gate-precommit.mjs:52`). Nothing reaches the agent. The client documents
   exit-code semantics for its shell-execution hooks, not for `stop`, so the
   non-zero exit is not a denial either — it is nothing at all.
2. **It grades the wrong thing.** `runHook` builds its request with
   `change: { kind: 'git-index', baseRevision: 'HEAD' }` (`hook-runner.mjs:407`)
   — deliberately, because a commit must be judged on the snapshot it would
   create. At turn end the agent's edits are normally unstaged, so the index
   equals `HEAD` and the evaluation covers an empty change. The agent's actual
   work is never looked at.
3. **It claims the wrong role.** The runner declares
   `role: 'authoritative'`, while the Cursor declaration is `role: 'preflight'`
   with `blocking.native: false`, and `presentDecision` returns
   `not-authoritative` for every desktop adapter. A preflight surface answering
   with an authoritative allow/deny is precisely what `SG-SUPPORT-001` forbids.

This is the same shape as `TB-018`: a registration seam that works, pointed at
the closest available program, because the program it needs was never packaged.
`TB-018` produced a silent no-op that passed every commit; this one produces a
silent no-op that tells the agent nothing.

## Domain Concepts

Adapter declaration, Normalized trigger, Native payload identity, Preflight
role, Decision presentation, Enforcement authority.

## Approach and Tradeoffs

**Ship one preflight program, and keep every client-specific fact in the
declaration.** Add `gate-preflight.mjs` beside `gate-precommit.mjs`. It reads
the native payload on stdin, hands it to the existing `runAdapterEvaluation`
seam — which already normalizes the native event through the adapter's declared
paths, reads session identity, resolves the repository root upward from the
declared field, and drops the payload — evaluates, and presents the result
through `presentDecision`.

**The feedback channel is declared, not coded.** The runner must not learn that
Cursor's field is called `followup_message` any more than it knows the file is
`.cursor/hooks.json`: that is exactly the knowledge `FR-ADAPT-008` moved into
the declarations, and a second client with a different field would otherwise
fork the runner. Extend each adapter declaration with a `feedback` block naming
the channel (`stdout-json`), the field, and what silence looks like. An adapter
that declares no feedback channel prints nothing and says so — it is not a
failure, it is a client that cannot be talked to.

**The subject is the working tree, and the runner says so.** Preflight runs
where no commit has been proposed, so it evaluates the worktree with
`role: 'preflight'` and `trigger: 'work-complete'`. That is not a weakening of
`SG-EVAL-001`: the safeguard binds what may *authorize*, and this surface
authorizes nothing. The presentation must never describe a worktree preflight as
the decision a commit would receive.

**It exits `0`.** The client defines no exit-code contract for this event, so
the exit status carries no meaning and must not be used to signal a decision.
Everything the maintainer or agent is told travels through the declared channel.

## Architecture Boundary and Public Seam

The boundary is the packaged entry point between a desktop client's hook process
and the existing adapter presentation seam; the runner adds no policy, no
authority, and no evaluation of its own. The public seam is the program's stdin
contract (a native payload), its declared stdout channel, and the `feedback`
block added to the adapter declarations.

First red test: a Cursor-shaped `stop` payload on stdin, in a clone whose
required check fails, produces stdout JSON whose declared feedback field names
the failing check — and the same run in a passing clone produces no follow-up at
all, so a clean turn is never interrupted.

## Safeguards and Invariants

- `SG-SUPPORT-001`: the presented result is `not-authoritative` and
  non-blocking for every desktop adapter, whatever the outcome. Only the Git
  integration authorizes a commit.
- `SG-OWNER-001`: the runner reads clients through their declarations and
  carries no client name, field name, or file path of its own.
- `SG-EVAL-001`: a worktree preflight is reported as a preflight. It never
  claims to be the decision the proposed commit would receive.
- `NFR-REL-003`: trust failure, unreadable payload, capability mismatch,
  timeout, and internal error all present as `unverified` through the same
  channel. An unverified preflight is never presented as a clean one.
- `FR-ADAPT-003`: `commit-attempt` stays in Cursor's `unverifiedTriggers`. This
  slice does not claim an event no capture has shown.

## Prohibited Behavior and Non-goals

Do not make preflight blocking, and do not use the exit status to signal a
decision. Do not touch `gate-precommit.mjs`, `runHook`, or the authoritative
path. Do not add a client name or a native field name to any module outside the
adapter declarations. Do not stage, commit, or modify repository content. Do not
build a second Evidence wiring: `FR-EVID-001` covers this evaluation like any
other, and `TB-026` establishes the one path from a packaged runner to the
store, which this runner reuses. Do not build the `gate` lifecycle CLI, and do
not extend activation's adapter registration beyond pointing at this program.

## Risk and Decision Impacts

- `RISK-004`: a client changing its hook format or feedback contract is the
  accepted risk, which is why the format lives in a declaration a single edit
  can correct. Encoding the field in the runner would spread that risk across
  the runtime.
- `FR-ADAPT-003` maps `before-commit-attempt` only where a surface provides it.
  Cursor's `commit-attempt` stays in `unverifiedTriggers`, unclaimed and
  undisproven; this slice does not resolve it and does not need to.
- `Q-004` is Resolved and stays resolved: support remains capability-based and
  tested versions are evidence snapshots. The confirming capture named below is
  a release-evidence entry under that resolution, not a reopening of it.

## Acceptance Criteria

- [ ] `AC-ADAPT-001`, `FR-ADAPT-002`: a native `stop` payload on stdin, in a
  clone whose required check fails, produces the declared stdout feedback
  naming the failing check; the same clone passing produces no follow-up.
- [ ] `AC-ADAPT-001`, `SG-SUPPORT-001`: whatever the outcome, the presented
  result is `not-authoritative` and non-blocking, and the program exits `0`.
- [ ] `AC-ADAPT-002`, `NFR-REL-003`: an unreadable payload, an unknown adapter,
  an unresolvable repository root, and an internal failure each present as
  `unverified` through the declared channel rather than as silence or a clean
  preflight.
- [ ] `SG-OWNER-001`: a source scan of the kind `TB-024` uses shows no client
  name and no native field name outside `adapters.mjs` — the feedback field
  included.
- [ ] `FR-ADAPT-002`: the program evaluates the working tree with the
  `work-complete` trigger and the `preflight` role, and its output never
  describes itself as the decision a commit would receive.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-ADAPT-001`, `AC-ADAPT-002`, `SG-OWNER-001`, `NFR-REL-003`: payload, presentation, feedback-channel, failure-family, and declaration-scan fixtures | `npm run test:unit` | Yes — configured unit suite owns the adapter presentation seam |
| smoke | both | `AC-ADAPT-001`, `FR-ADAPT-002`: the packaged program driven as a child process with a real client-shaped payload on stdin against a throwaway clone, asserting the declared stdout contract for a failing and a passing turn | `gate-adapter-conformance` capability extended by this slice | Yes — that capability owns adapter surfaces and today never launches a packaged program |

Frontend build and browser evidence are inapplicable; this slice is a local
process entry point, not repository frontend code.

## SRS amendment this contract requires

**Approved as revision `0.2.5` on 2026-08-17.** `FR-ADAPT-004` and
`AC-ADAPT-002` in `docs/specifications/change-evaluation-gate-srs.md` now carry
the declared feedback channel, so this slice implements approved requirements
rather than proposing them. The reasoning is kept here because it is the
contract the implementation must satisfy.

The feedback channel was not covered by the SRS as approved at `0.2.4`, and was
added in the manner that revision used when real-client evidence showed the
three surfaces register differently:

- `FR-ADAPT-004` enumerates the capabilities an adapter declares — event,
  blocking, trust, repository, session, filesystem, Git, and invocation. A
  feedback channel is not among them.
- `FR-ADAPT-008` covers the registration surface — which file, which block
  schema, whether it is independently versioned — not how a running adapter
  answers its client.

So the same real-client finding that produced `FR-ADAPT-008` applies again one
level down: the surfaces differ in how they take an answer back, and the runtime
must not learn those differences. The amendment therefore extends
`FR-ADAPT-004`'s declared capability set with the feedback channel and extends
`AC-ADAPT-002` — the acceptance criterion that already covers `FR-ADAPT-004` —
to require that adapters declaring different channels are answered through their
own declarations, with no client name or native field name outside the adapter
layer, and that a surface declaring no channel is left unanswered rather than
guessed at. No identifier is added and no traceability mapping moves, so the
existing coverage audit holds.

The declaration must match the approved text: the channel, the field that
carries the result, and the form that returns none. An adapter declaring no
channel returns none — that is a client that cannot be talked to, not a
failure.

## Blocked By

`TB-026`, for the Evidence path only. `FR-EVID-001` requires every evaluation to
produce an envelope, so this runner persists like any other caller; `TB-026`
establishes that wiring from a packaged runner to the clone-local store, and
building it twice is the divergence `TB-024` just finished removing elsewhere.
Nothing else blocks: `TB-013` and `TB-016` delivered the desktop declarations
and registration surfaces, and `TB-018` established the packaged-program shape
this follows.

## Unresolved Assumptions

1. **The client's `stop` output contract is read from published documentation,
   not from a captured run.** `followup_message` on stdout, auto-submitted as
   the next user message, bounded by a `loop_count` limit, is what the client
   documents as of 2026-08-17; every other declared fact about this surface
   came from a real payload capture. Confirm it with one client-driven run and
   record the capture beside the existing baselines, in the same way
   `nativeEvents` was confirmed. Not start-blocking: if the field name proves
   wrong, one declaration changes and no runtime code does — which is the
   reason for declaring it.

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] Acceptance criteria trace to the SRS and feature contract.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Risks and resolved decisions are traced to the parent contract.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start — the `FR-ADAPT-004` /
  `AC-ADAPT-002` amendment is approved as SRS revision `0.2.5`.
- [x] The ticket fits one fresh implementation context.
- [x] User-facing and frontend evidence requirements are covered or explicitly inapplicable.

## Why existing coverage missed this

`gate-adapter-conformance` proves declarations, payload normalization, support
tiers, and presentation — all through direct function calls. No capability has
ever launched a desktop entry point as a process, because there is none to
launch. The registration seam was proved by writing an entry naming a command,
never by that command answering a client. This is the same gap `TB-018` closed
for the authoritative surface, and `TB-020` then deepened by requiring the
registered program to actually run.
