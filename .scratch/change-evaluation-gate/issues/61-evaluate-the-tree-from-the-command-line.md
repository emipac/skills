# TB-061 — Evaluate the tree from the command line

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by:
Tracker ID: 61-evaluate-the-tree-from-the-command-line
Draft key: TB-061

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer can ask the Gate "what would this evaluate to?" from a terminal,
against the working tree or the staged index, and read the same decision a
hook would produce — without composing a client payload by hand, without
committing, and without pretending to be a client.

## SRS Traceability

- `FR-EVAL-003`, `FR-EVAL-004`, `FR-ADAPT-005`
- `AC-EVAL-001`, `AC-EVAL-006`
- `SG-EVAL-001`, `SG-TRUST-001`
- `NFR-OPER-001`, `NFR-REL-001`
- `RISK-010`

## Defect this contract fixes

Not a defect in what runs; a gap in how a maintainer reaches it.

### What a maintainer does today

To see whether the current tree passes, the options are:

- **Commit.** Authoritative, but a real commit — and a denied one leaves the
  maintainer reading hook output they cannot re-run.
- **Fire the client hook.** Only from inside the client, on its schedule.
- **Forge a client payload.** During one week of real use the maintainer ran
  this, by hand, seven times:

  ```
  echo '{"hook_event_name":"stop","session_id":"probe-…","cursor_version":"manual",
    "status":"completed","loop_count":0,"workspace_roots":["/…/gms"]}' \
    | node .agents/skills/change-evaluation-gate/scripts/gate-preflight.mjs --adapter cursor
  ```

  It works because `gate-preflight.mjs` reads a native payload from stdin and
  dispatches through the adapter's declared identity. It is also wrong in
  three ways: it claims to be a client that is not running; it burns the
  adapter's loop guard (`TB-027`: after two unchanged verdicts under one
  session id the third is suppressed, which the maintainer hit and had to
  work around with a fresh id); and the answer comes back through the
  client's feedback channel — for cursor an empty string on success, which a
  human cannot distinguish from nothing having run.

### What the runtime already has

Verified: `runPreflight` (`preflight-runner.mjs:134`) reads the payload,
resolves the adapter, captures the worktree (`change: { kind: 'worktree',
baseRevision: 'HEAD' }`, `:344`), calls `evaluate`, and formats the decision
through `formatFeedback` for the adapter. The evaluation itself is
adapter-agnostic; only the envelope around it is client-shaped.

Verified: the packaged commit runner captures the index (`git-index`) and
calls the same `evaluate`. The two scopes a maintainer would want — "what I
have" and "what I staged" — are both already implemented, each behind a hook.

Verified: `gate status` already renders a decision-like document to a terminal
with `line()`/`renderFindings()` in the operator surface; there is an
established way to print structured facts for a human.

## Domain decisions this contract settles

**`gate check` is an operator act, not a client event.** It has no adapter,
no session, no loop guard, no feedback channel. It runs the evaluation and
prints the decision in the operator surface's own voice, exit status carrying
the outcome. It is a preview of what a hook would say, and says so.

**It is not authoritative and never allows anything.** `FR-EVAL-001`: only the
managed `pre-commit` integration authorizes a commit. `gate check` records
`authorization: not-authoritative` exactly as the preflight does, and nothing
it produces can be presented to Git as consent. Its value is information.

**Two scopes, explicit.** `gate check` evaluates the working tree, the
question a maintainer mid-edit is asking. `gate check --staged` evaluates the
index, the question before a commit. Neither is inferred from the other.

**Evidence behaves as the preflight's does.** `RISK-010`: a passing preflight
appends nothing; a failing one persists its decision. `gate check` follows
the same rule under the same reasoning, and says on its output whether it
wrote evidence. The implementer establishes whether `--staged` should follow
the commit runner's rule instead and states it.

## Domain Concepts

Operator evaluation, Working-tree scope, Index scope, Decision rendering,
Non-authoritative result, Evidence retention.

## Approach and Tradeoffs

Verified: the operator surface's command registry, selector table, and
rendering (`operator-surface.mjs`, post-`TB-053`) give a new command a place
to live with `--help`, selector parsing, and refusal handling for free.

Verified: `gate check` mutates nothing under the clone and needs no
preview/confirm pair. It is in the family of `status` and `locks`, not
`activate`. It writes an execution root under the OS temporary directory and
removes it, and may append evidence under the preflight rule — the same
footprint the preflight leaves.

Proposed — lift the evaluation out of `runPreflight` into a function both
callers use. `runPreflight` becomes payload → adapter → *that function* →
feedback; `gate check` becomes selectors → *that function* → operator
rendering. The implementer confirms `runPreflight`'s behaviour is byte-
identical afterward against `gate-hook-conformance-smoke` and the adapter
conformance baseline, and states what the shared function takes.

Proposed — render the decision fully. Outcome, authorization, every check
with its outcome and reason code, the dependency record `TB-054`/`TB-057`
established, the redaction summary `TB-045` established, elapsed time, and
whether evidence was appended and where. A maintainer should learn from one
run everything the envelope would tell them, without opening the store.

Proposed — exit status carries the outcome: `0` passed, `1` failed or
unverified, `2` could not run. Same contract as every other operator command.

Proposed — `--json` mirrors the rendered document, as `status --json` does.

Deliberately not a new evaluation path, a new scope, a new adapter, or a way
to authorize anything. Deliberately not replacing the preflight or changing
what any client receives.

## Architecture Boundary and Public Seam

The boundary is between an evaluation a hook triggers and one a maintainer
asks for. The public seam is the shared evaluation function both callers use,
and the `check` command in the operator surface.

First red test: `gate check` on an activated clone prints the same six check
outcomes the last preflight recorded, with exit status matching the outcome,
where today no such command exists.

## Safeguards and Invariants

- `FR-EVAL-001`: nothing here authorizes a commit; `gate check` is
  non-authoritative by construction and says so.
- `SG-EVAL-001`: the same materialized-snapshot evaluation, the same
  immutability re-check; no evaluation against a live tree.
- `FR-ADAPT-005`: no client is impersonated, no feedback channel is used, no
  loop guard is consumed.
- `NFR-REL-001`: `gate check` and the preflight produce the same decision
  for the same tree, proved by running both.
- `RISK-010`: evidence growth follows the preflight's rule.
- `SG-TRUST-001`: the limit statement stays on the output.

## Prohibited Behavior and Non-goals

Do not let `gate check` authorize, bypass, consume a grant, or write anything
a hook would read. Do not impersonate an adapter or emit through a feedback
channel. Do not add a scope beyond worktree and staged. Do not change what
the preflight or the commit runner do. Do not add a preview/confirm pair to
a command that mutates nothing.

## Risk and Decision Impacts

- `RISK-010`: a maintainer running `gate check` often could grow evidence;
  the preflight rule (passing appends nothing) bounds it the same way.
- No disposition changes; nothing this command does affects a commit.

## Acceptance Criteria

- [ ] `AC-EVAL-001`, `FR-EVAL-003`: `gate check` evaluates the working tree and prints every check's
  outcome and reason, the outcome, and `authorization: not-authoritative`;
  exit status carries the outcome.
- [ ] `AC-EVAL-006`: `gate check --staged` evaluates the index, is distinguishable in output, and a missing prerequisite or crashed check renders `unverified` with its reason code exactly as the hook would;
  the two scopes never share a snapshot identity for a tree whose index and worktree differ.
- [ ] `NFR-REL-001`: for one tree, `gate check` and the preflight produce
  the same check outcomes and the same snapshot identity.
- [ ] `FR-ADAPT-005`: no adapter is invoked, no loop-guard state is read or
  written, no feedback channel is used — proved by running `gate check`
  three times on an unchanged tree and getting three full answers.
- [ ] `RISK-010`: a passing `gate check` appends no evidence; a failing one
  persists its decision, and the output says which and where.
- [ ] `FR-EVAL-001`: a commit after a passing `gate check` still runs the
  hook and is still evaluated; nothing from `check` is consulted.
- [ ] `runPreflight` behaviour is byte-identical after the refactor, proved
  by the adapter conformance baseline and hook-conformance smoke unchanged.
- [ ] `--json` mirrors the rendered document; `gate --help` and the command
  contract list the command.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `FR-ADAPT-005`, `NFR-REL-001`, `AC-EVAL-006`, `RISK-010`: no-adapter-touched, unverified-reason-rendered-as-hook-would, three-runs-three-answers, passing-appends-nothing, failing-persists, staged-vs-worktree, exit-status, json-mirror fixtures against the real operator surface and the shared evaluation function | `npm run test:unit` | Yes — the unit suite owns the operator surface and the runners |
| smoke | both | `AC-EVAL-001`, `SG-EVAL-001`, `FR-EVAL-001`: on a real activated clone `gate check` and a real preflight agree, and a commit after a passing check still runs the hook | `gate-hook-conformance-smoke` and `gate-activation-smoke`, extended by this slice | Yes — agreement with the real preflight is only observable on a real clone |

Frontend build and browser evidence are inapplicable; this slice adds one
operator command over an existing evaluation.

## Blocked By

None.

## Unresolved Assumptions

None.

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] Acceptance criteria trace to the SRS and feature contract.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Risks and resolved decisions are traced to the parent contract.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start.
- [x] The ticket fits one fresh implementation context.
- [x] User-facing and frontend evidence requirements are covered or explicitly inapplicable.

## Why existing coverage missed this

Nothing was missed; there was no requirement for an operator to run an
evaluation. The suite drives evaluations through the hooks it tests. The
need became visible only when a real maintainer had to answer "does it pass
now?" between edits, and the only tool available was to counterfeit a client.
