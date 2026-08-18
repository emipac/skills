# TB-029 — A check that never started has not failed

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 29-a-check-that-never-started-never-failed
Draft key: TB-029

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A decision distinguishes a grader that ran and said no from a grader that never
ran. A check whose program could not be launched is `unverified` with a reason
naming the harness, so a maintainer reading a denial is never told their code
was rejected by a tool that never saw it.

## SRS Traceability

- `FR-EVAL-008`, `FR-EVAL-001`
- `AC-EVAL-006`, `AC-EVAL-001`
- `SG-EVAL-001`
- `NFR-REL-003`
- `RISK-001`

## Defect this contract fixes

Found in the recorded evidence of a real denied commit, preserved under
`real-project-evidence/change-evaluation-gate/evidence/`. Five required checks
exited `127` — *command not found* — within one to five milliseconds, having
never launched their program. All five were classified:

```
"outcome": "failed",
"reasonCode": "grader-negative"
```

`grader-negative` means the grader ran and returned a negative verdict. Nothing
ran. The maintainer was told, in the commit output, that their formatter and
their static analysis had rejected their work.

`classifyAttempt` (`evaluation-contract.mjs:749`) normalizes an attempt to
`unverified` when it timed out, crashed, produced malformed output, or carries
an already-unverified reason. A process that *starts and exits non-zero* falls
through all of those to `resolveOutcome`, which sees a non-zero exit and
reports `failed` / `grader-negative`. That is correct for a tool reporting a
verdict and wrong for a launch failure, and the two are indistinguishable at
that seam today: the spawn succeeded — the kernel really did run `/usr/bin/env`
— so `attempt.error` is empty and only the exit status and the captured output
carry the truth.

`NFR-REL-003` is explicit that missing prerequisites, invalid configuration,
timeouts, crashes, and malformed output normalize to `unverified`. A program
that could not be launched belongs to that family and is currently the one
member of it reported as a verdict.

This is `RISK-001`'s mitigation inverted a second way. `TB-024` found evidence
naming a command that never ran; this is evidence naming an *outcome* that was
never reached. Both make a denial unactionable, and both blame the maintainer
for a fault in the runner.

## Domain Concepts

Attempt classification, Reason code family, Harness failure, Grader verdict,
Evidence envelope, Bounded execution.

## Approach and Tradeoffs

**Report launch failure where it is known, not where it is guessed.** Bounded
execution is the only participant that knows whether the program it spawned
ever became the program it named. It already distinguishes a spawn that errored
from one that ran; it must also report the case where the process started and
immediately reported that it could not exec what it was asked to. That signal
travels as an attempt-level reason code in the existing unverified family,
rather than being inferred downstream from an exit status.

**Do not classify by exit code alone.** `127` conventionally means *command not
found*, but a project's own tool may legitimately exit `127`, and a descriptor
may declare its own `success_exit_codes`. Deriving "did not start" from the
number alone would trade one wrong verdict for another. The signal belongs to
the executor, which knows what it launched and what the operating system said
about it.

**One reason code, in the family that already exists.** The new code joins
`UNVERIFIED_REASONS` so every existing consumer — outcome reduction, policy,
authorization, evidence, adapter presentation — handles it correctly without
being taught anything. An authoritative role still denies on `unverified`, so
this changes what a maintainer is *told*, not whether the commit proceeds.

**The denial gets more useful, not weaker.** A required check that could not
start still denies the commit. The difference is that the reported reason names
the harness and points at the runner, so the maintainer looks where the fault
actually is.

## Architecture Boundary and Public Seam

The boundary is between bounded execution, which observes how a process
terminated, and the evaluation contract, which classifies attempts. The public
seam is the attempt-level reason code for a program that could not be launched,
and its membership in the unverified family.

First red test: a descriptor whose pinned executable is a script naming an
interpreter that does not exist produces an attempt classified `unverified`
with the launch-failure reason — not `failed` / `grader-negative` — and the
decision denies with that reason stated.

## Safeguards and Invariants

- `NFR-REL-003`: every harness failure normalizes to `unverified`. A launch
  failure is a harness failure and now says so.
- `SG-EVAL-001`: nothing here changes what is graded or what may authorize. An
  `unverified` required check still denies under an authoritative role.
- A verdict is never invented in either direction: a check that could not start
  is not passed, not skipped, and not retried.
- The captured output stays the evidence. The reason code names the family; the
  retained excerpt says exactly what the operating system reported.

## Prohibited Behavior and Non-goals

Do not classify by exit code alone, and do not add an exit-code allowlist for
"probably not found". Do not retry a check that failed to launch. Do not change
`success_exit_codes`, the Evidence ladder, or the reduction of multiple
attempts. Do not fix the *cause* of the launch failures observed here — that is
`TB-028`, and this slice must remain correct whether or not that one has
landed. Do not weaken denial: an unverified required check still denies.

## Risk and Decision Impacts

- `RISK-001`: exact command evidence is the accepted mitigation for local,
  bypassable enforcement. A reason code that misattributes a runner fault to
  the maintainer's code defeats it as surely as a missing record does.
- No disposition changes; the authorization a decision produces is unchanged in
  every case.

## Acceptance Criteria

- [ ] `AC-EVAL-006`, `NFR-REL-003`: an attempt whose program could not be
  launched is `unverified` with the launch-failure reason, never `failed` /
  `grader-negative`.
- [ ] `AC-EVAL-001`: a required check that could not start still denies an
  authoritative evaluation, and the reported reason names the harness rather
  than the maintainer's code.
- [ ] A tool that genuinely runs and exits non-zero — including a project whose
  descriptor declares non-zero `success_exit_codes` — is unaffected and still
  classified `grader-negative` or `passed` exactly as before.
- [ ] `FR-EVID-001`: the retained evidence for a launch failure carries both
  the new reason code and the captured output that proves it, so the envelope
  states what the operating system reported.
- [ ] The reason code is a member of the existing unverified family, and no
  consumer — policy, authorization, presentation, evidence — needs a special
  case for it.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVAL-006`, `NFR-REL-003`: fixtures spawning a real script whose interpreter does not exist, a real tool exiting non-zero, and a descriptor with declared non-zero success codes, asserting all three classifications | `npm run test:unit` | Yes — the unit suite owns attempt classification and bounded execution |
| smoke | both | `AC-EVAL-001`: an activated fixture whose required check cannot launch denies the commit and reports the harness reason in the commit output | `gate-activation-smoke` capability extended by this slice | Yes — the maintainer-facing wording of a denial is only observable through a real `git commit` |

Frontend build and browser evidence are inapplicable; this slice changes local
attempt classification.

## Blocked By

None. It is independent of `TB-028`: that ticket removes the cause observed
here, this one ensures any future launch failure is reported honestly.

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

The negative conformance fixtures cover timeout, crash, malformed output,
snapshot mismatch, integrity drift, and coordination failure — every harness
failure that produces a *distinguishable signal* at the seam. A launch failure
produces the same signal as a verdict: a process that started and exited
non-zero. Every fixture executable in the repository is either this Node
runtime or a `#!/bin/sh` script, both of which always launch, so no test has
ever produced an attempt that could not start.
