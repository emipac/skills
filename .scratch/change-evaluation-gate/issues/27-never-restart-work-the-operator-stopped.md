# TB-027 — Never restart work the operator stopped

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: done, defect
Blocked by:
Tracker ID: 27-never-restart-work-the-operator-stopped
Draft key: TB-027

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer who stops an agent stays stopped. Preflight answers a turn the
client says *completed*, stays silent on one the operator aborted or that
errored, and bounds how many times it will say the same thing — so early
feedback can never become a loop the maintainer has to disable the hook to
escape.

## SRS Traceability

- `FR-ADAPT-002`, `FR-ADAPT-003`, `FR-ADAPT-004`, `FR-ADAPT-005`
- `AC-ADAPT-001`, `AC-ADAPT-002`
- `SG-SUPPORT-001`, `SG-TRUST-001`
- `NFR-REL-003`
- `RISK-004`

## Defect this contract fixes

Found on a real Cursor session in `gms`, with the evidence preserved under
`real-project-evidence/change-evaluation-gate/evidence/`.

The maintainer stopped the agent mid-work. The `stop` hook fired anyway,
preflight reported the same failing checks, the client submitted that
`followup_message` as the next user message, and the agent started again. The
maintainer stopped it again; the same thing happened. **The loop only ended
when the hook was commented out.**

The recorded evaluations are the proof. Five preflight envelopes carry the
*identical* `evaluationId`
`sha256:e78a0f52ee3b77c713f5cae2ce3b1724cf8c8f6267f21065498addacf15217de`,
timestamped `12:17:39`, `12:22:14`, `12:22:19`, `12:22:50`, and `12:22:53` —
five evaluations of byte-identical content, each producing an identical
verdict, each re-prompting the agent to fix something no agent turn could fix.

Two causes, both verified against the shipped code:

1. **The runner never reads `status`.** The client's payload declares
   `"status": "completed" | "aborted" | "error"`. `runPreflight`
   (`preflight-runner.mjs`) reads the payload only through
   `runAdapterEvaluation`, and the Cursor `nativeIdentity` declaration
   (`adapters.mjs`) names `hook_event_name`, `session_id`, `cursor_version`,
   and `workspace_roots` — and nothing else. A turn the operator aborted is
   therefore graded, and answered, exactly like one that completed.
2. **The runner never reads `loop_count`.** The same payload carries the
   client's own iteration counter, and the runner ignores it, so nothing
   bounds how many times one unchanged verdict is resubmitted. Every observed
   payload reported `loop_count: 0`, so the client's own limit never engaged;
   the gate cannot delegate this to a counter that does not appear to move.

The first is the serious one. `SG-TRUST-001` describes local enforcement as a
cooperative process the machine owner controls. A preflight surface that
restarts work its operator explicitly stopped is not cooperative — it takes an
action against a stated decision, and it does so through a channel the operator
cannot see coming.

## Domain Concepts

Adapter declaration, Native payload identity, Normalized trigger, Preflight
role, Feedback channel, Turn status, Enforcement authority.

## Approach and Tradeoffs

**Declare the completion signal; do not hardcode it.** `TB-025` established
that a client's payload fields live in its own declaration and that the runner
learns none of them. The turn status is the same kind of fact: extend
`nativeIdentity` with the field that carries it and the values that mean
*completed*, *aborted*, and *errored*. Cursor declares `status` with its three
documented values; a surface that declares no status field is treated as
always-completed, because that is what those surfaces have always been.

**Answer only a completed turn.** An aborted turn produces no feedback at all —
not an `unverified` presentation, not a silent pass, simply nothing, because
the operator asked for nothing. An errored turn is likewise not an invitation
to re-prompt. This is a narrowing of when preflight speaks, never of what it
says when it does.

**Bound repetition on the gate's side.** Extend the declared `feedback` block
with the iteration field and a maximum. The runner reads that field, and past
the declared maximum it stays silent regardless of outcome: a preflight that
has said the same thing N times has nothing to add by saying it again. The
declaration also states what to do when the field is absent or does not
advance, which is exactly the case observed here.

**Silence needs a reason a human can find.** A preflight that deliberately
stays quiet — aborted turn, exhausted loop budget — writes one diagnostic line
to stderr. The client surfaces hook stderr in its own panel (it is how the
maintainer read every decision in this investigation), so the operator can tell
"nothing was wrong" from "I was told not to speak", while the agent's channel
stays clean. This is the same reasoning `TB-018` applied: silence that cannot
be distinguished from success is the defect, not the mitigation.

## Architecture Boundary and Public Seam

The boundary is the desktop preflight entry point and the adapter declarations
it reads; no evaluation, policy, or authority moves. The public seam is the
declared status and iteration fields, and the runner's decision to answer or
stay silent.

First red test: a Cursor-shaped payload with `"status": "aborted"` and a clone
whose required check fails produces **no** stdout at all, where the same
payload with `"status": "completed"` produces the declared feedback.

## Safeguards and Invariants

- `SG-TRUST-001`: the gate never resumes, restarts, or re-prompts work the
  operator stopped. An operator decision is an input to this runner, never
  something it overrides.
- `SG-SUPPORT-001`: unchanged. Preflight stays `not-authoritative` and
  non-blocking; this slice only narrows when it speaks.
- `SG-OWNER-001`: the status field, its values, and the iteration field live in
  the adapter declaration. No client name or native field name enters the
  runner.
- `NFR-REL-003`: a payload whose declared status field is present but carries
  an undeclared value is `unverified`, not assumed complete. Guessing that an
  unknown status means "finished" is how this defect would return.
- `FR-ADAPT-005`: an aborted turn is *silence*, which is distinct from an
  `unverified` presentation. Both are declared outcomes; neither is a pass.

## Prohibited Behavior and Non-goals

Do not make preflight blocking, and do not use the exit status to signal
anything. Do not touch `gate-precommit.mjs`, `runHook`, or the authoritative
path — a `git commit` is an explicit operator action and is unaffected by any
of this. Do not add a retry, backoff, or queue. Do not suppress feedback on a
completed turn merely because its verdict repeats; the loop budget is the only
repetition rule. Do not infer completion from `output_tokens`, timing, or any
field the adapter does not declare.

## Risk and Decision Impacts

- `RISK-004`: a client changing its payload contract is the accepted risk, and
  it is why the status field is declared rather than read directly. One
  declaration edit absorbs a rename.
- No disposition changes. This narrows an existing surface; it removes no
  capability and grants none.

## Acceptance Criteria

- [x] `SG-TRUST-001`, `FR-ADAPT-003`: a payload whose declared status means
  *aborted* produces no feedback on any channel, in a clone whose required
  checks fail. The same payload meaning *completed* produces the declared
  feedback.
- [x] `NFR-REL-003`: a payload carrying an undeclared status value presents as
  `unverified` through the declared channel rather than being treated as
  completed.
- [x] `FR-ADAPT-004`, `SG-OWNER-001`: the status field, its declared values,
  and the iteration field are read from the adapter declaration; a source scan
  of the kind `TB-024` uses finds no native field name outside `adapters.mjs`.
- [x] `FR-ADAPT-002`: past the declared iteration maximum the runner stays
  silent on the agent's channel, and a surface whose payload never advances its
  iteration field is bounded by that same maximum rather than looping
  unbounded.
- [x] Every deliberate silence writes one stderr diagnostic naming why, so a
  quiet hook and a clean turn are distinguishable by a human reading the hook
  panel.
- [x] A surface that declares no status field keeps its current behaviour
  exactly, so this slice changes nothing for the two desktop adapters that
  never sent one.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `SG-TRUST-001`, `NFR-REL-003`, `SG-OWNER-001`: aborted, errored, completed, undeclared-status, absent-status, and loop-budget fixtures against `runPreflight`, plus the declaration scan | `npm run test:unit` | Yes — the unit suite owns the preflight runner and the adapter declarations |
| smoke | both | `AC-ADAPT-001`: the packaged program launched as a child process with an aborted payload writes nothing to stdout, and with a completed payload writes the declared feedback | `gate-adapter-conformance` capability, extending `packaged-preflight-answers-client` | Yes — it is the only capability that launches a desktop entry point as a process |

Frontend build and browser evidence are inapplicable; this slice is a local
process entry point.

## Blocked By

None. `TB-025` delivered the runner, the feedback declaration, and the
conformance scenario this extends.

## SRS amendment this contract required

Drafted as revision `0.2.6`, awaiting Product Owner approval. The turn-status
half needed none: a client event that fires for both a finished turn and an
aborted one is only `work-complete` when it says so, and `FR-ADAPT-003` already
requires normalizing a deterministic native event to the trigger it actually
means. The iteration bound is new — `FR-ADAPT-004`'s feedback enumeration,
approved at `0.2.5`, names the channel, the field, and the silent form, and now
also names the maximum. `AC-ADAPT-002` carries the matching assertion. Both rows
are marked `Draft` and the document header still states the approved `0.2.5`.

## Unresolved Assumptions

1. **The status values are read from published client documentation and one
   real payload capture.** The capture in
   `real-project-evidence/` shows `"status": "completed"`; `aborted` and
   `error` come from the client's documented contract. Confirm the aborted
   spelling with one real interrupted turn and record it beside the existing
   baselines. Not start-blocking: an unmatched value is `unverified` by the
   criteria above, which fails safe rather than resuming work.

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

`TB-025`'s fixtures drive one payload and assert what comes back. Nothing drove
*two* payloads in sequence, and nothing modelled an operator who intervenes
between them, so the runner's total ignorance of `status` and `loop_count` was
invisible: every field it does not read is a field no single-payload fixture
can miss. The conformance scenario proved the program answers a client; it
never asked whether the client should have been answered at all.
