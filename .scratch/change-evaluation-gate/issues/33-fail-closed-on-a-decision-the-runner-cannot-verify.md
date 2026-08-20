# TB-033 — Fail closed on any decision the runner cannot verify

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: done, defect
Blocked by:
Tracker ID: 33-fail-closed-on-a-decision-the-runner-cannot-verify
Draft key: TB-033

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

`exit 0` means the gate saw a complete decision, produced by checks that
actually ran, recorded where it can be read again. Anything less — a decision
missing its parts, an outcome its own checks contradict, a validator that
throws, an attempt whose program never started — denies, and says which.

## SRS Traceability

- `FR-EVAL-001`, `FR-EVAL-002`, `FR-EVAL-008`
- `AC-EVAL-001`, `AC-EVAL-002`, `AC-EVAL-006`
- `SG-EVAL-001`
- `NFR-REL-003`
- `RISK-001`

## Defect this contract fixes

Found by an external audit of `HEAD` `9569362`, and confirmed against the
shipped code. Two findings, one principle.

### 1. The authoritative hook can exit `0` on a decision that proves nothing

`report` in `hook-runner.mjs` requires only that `authorization` and `outcome`
are strings. A decision of exactly:

```js
{ authorization: 'allow', outcome: 'passed' }
```

— no `checks`, no `evidence`, no `evaluationId`, no snapshot — reaches
`exit 0` and the commit proceeds.

The evidence guard added by `TB-026` does not catch it, and the reason is worth
stating precisely because it is the same mistake in miniature:

```js
const evidenceReasonCode = decision.evidence?.persisted === false ? … : null;
```

That denies a decision which *says* persistence failed. A decision that says
nothing at all evaluates `undefined === false`, which is `false`, so the guard
passes. The check was written to catch a stated failure and does not catch an
absent claim — while the rule the whole feature rests on is that **absence of
evidence is never success** (`NFR-REL-003`).

In production `evaluate` returns a complete decision, so this needs a
malformed, crashed, partially-written, or substituted evaluation to reach. That
is exactly the set of conditions a fail-closed gate exists for. `runHook` also
accepts `evaluate` as an injected seam, so the shape is reachable by
construction.

`validateDecision` already exists in `evaluation-contract.mjs` and is the
function that knows what a complete decision looks like. **The authoritative
runner never calls it.** The same shape as `TB-023`, `TB-024`, `TB-026`, and
`TB-031`: a component built and proved in isolation, never reached by the
runtime that needed it.

### 2. A check whose program never started is reported as a failed verdict

Absorbed from `TB-029`, which this ticket replaces. In the recorded evidence
under `real-project-evidence/`, five checks exited `127` — *command not
found* — in one to five milliseconds, having launched nothing, and every one
was classified:

```json
{ "outcome": "failed", "reasonCode": "grader-negative" }
```

`grader-negative` means the grader ran and returned a negative verdict.
Nothing ran. The maintainer was told their formatter and static analysis had
rejected their work.

`TB-028` removed the cause and `TB-030` removed the neighbouring one, so this
is now about the remaining residue rather than a live failure: a pinned
program whose interpreter chain breaks after activation still reports as the
maintainer's code failing. It belongs here because it is the same principle at
attempt level — never report an outcome that was never observed.

## Domain Concepts

Decision contract, Attempt classification, Authorization, Evidence reference,
Reason code family, Enforcement role.

## Approach and Tradeoffs

**Validate the decision with the function that owns the shape.**
`validateDecision` is the contract's own completeness rule. The runner calls
it, and a decision that fails it denies with a stated reason rather than being
inspected field by field at the call site. A second, weaker copy of "is this
decision complete" living in `report` is how this defect exists.

**Make the validator total.** A malformed input must return findings, never
throw. A validator that throws on the input it exists to reject turns a
refusal into a crash, and the crash path is the one that has to be trusted
least.

**Check for presence, not for a stated failure.** The evidence guard is
inverted: an `allow` is authorized only when evidence was positively persisted
and carries a reference. `persisted !== true` denies, which covers absent,
false, and malformed identically.

**A launch failure is a harness failure.** Bounded execution knows whether the
program it spawned became the program it named; that signal travels as an
attempt-level reason code inside the existing unverified family, so every
downstream consumer handles it without being taught anything. Classification is
never derived from the exit code alone — a project's own tool may legitimately
exit `127`, and descriptors may declare their own success codes.

**Denial stays denial.** Nothing here changes what a genuine failing check
does. It changes what the runner does when it cannot tell.

## Architecture Boundary and Public Seam

The boundary is between a decision the evaluation seam returns and the exit
status the shell receives. The public seam is the runner's use of
`validateDecision`, the evidence-presence rule, and the attempt-level
launch-failure reason.

First red test: `runHook` with an injected `evaluate` returning
`{ authorization: 'allow', outcome: 'passed' }` exits non-zero with a stated
reason — where today it exits `0`.

## Safeguards and Invariants

- `NFR-REL-003`: every path that cannot prove a decision denies. Absence of a
  denial has never been evidence of one, and absence of evidence is never
  success.
- `SG-EVAL-001`: an `allow` requires a decision naming the snapshot it graded.
- `AC-EVAL-002`: completeness is judged by the contract that defines it; the
  runner adds no second definition.
- A validator refusal is a refusal, not an exception. Nothing in this path may
  throw on input it exists to reject.
- Denial semantics for real failures are unchanged.

## Prohibited Behavior and Non-goals

Do not add policy to the runner or re-derive authorization — `authorizationFor`
owns that. Do not weaken or bypass any existing denial. Do not classify a
launch failure by exit code alone, and do not add an exit-code allowlist. Do
not build a decision-repair path: a decision that cannot be verified is
refused, never patched. Do not extend this to the preflight runner's
presentation, which is `not-authoritative` by construction and cannot authorize
anything.

## Risk and Decision Impacts

- `RISK-001`: local enforcement is bypassable by design, and the accepted
  residual is a maintainer who *chooses* `--no-verify`. A hook that exits `0`
  on a decision nobody produced is a bypass nobody chose, which is outside the
  accepted disposition entirely.
- No disposition changes; this restores the failure semantics already approved.

## Acceptance Criteria

- [x] `AC-EVAL-001`, `NFR-REL-003`: a decision missing checks, evidence,
  evaluation identity, or snapshot denies with a stated reason, driven through
  the real `runHook` rather than a library call.
- [x] `AC-EVAL-002`: completeness is judged by `validateDecision`; a source
  scan finds no second completeness rule in the runner.
- [x] `NFR-REL-003`: an `allow` whose evidence was not positively persisted
  denies — absent, `false`, and malformed evidence all take the same path.
- [x] `AC-EVAL-002`: `validateDecision` returns findings for every malformed
  input in a fixture set including `null`, primitives, arrays, and objects with
  wrong-typed members, and throws for none of them.
- [x] `AC-EVAL-006`, `NFR-REL-003`: an attempt whose program could not be
  launched is `unverified` with a launch-failure reason, never `failed` /
  `grader-negative`; a tool that genuinely runs and exits non-zero — including
  under declared non-zero success codes — is classified exactly as before.
- [x] Every existing denial and every existing allow behaves identically,
  proved by the unchanged commit fixtures in `gate-activation-smoke`.

## Decisions this slice recorded

**`AC-EVAL-006`: the launch-failure signal is taken before the spawn, not read
out of how the process terminated.** The approach section describes bounded
execution reporting "the case where the process started and immediately
reported that it could not exec what it was asked to". No such observation
exists at that seam. When a script's shebang names `/usr/bin/env php` and `php`
is gone, the kernel really does run `env`, so the spawn succeeds, no error is
raised, and the only remaining differences from a genuine verdict are the exit
status — which the ticket rightly prohibits classifying by — and the captured
text, which would mean parsing another program's diagnostics. Bounded execution
therefore checks the chain it is about to launch: the executable and, when the
receipt pinned one, the interpreter that executable names, both immediately
before spawning. That is still the executor deciding from what it knows it was
about to run, it produces no verdict for a program that never started, and it
covers the residue `TB-029` identified — a pinned program whose interpreter
chain breaks after activation. An exec-level `ENOENT`, `ENOEXEC`, `EACCES`,
`EPERM`, or `EISDIR` reported by the spawn itself carries the same reason; a
raised error of any other kind stays `crash`, which is what it is.

**The denial names the contract's findings rather than restating them.** A
refused decision prints the first six findings by path and message and
summarizes the remainder. Composing a runner-authored explanation of what was
missing would have been the second completeness rule this ticket exists to
remove, one sentence at a time.

**No smoke capability was extended.** `TB-029`'s matrix asked
`gate-activation-smoke` to grow a scenario whose required check cannot launch.
That belonged to a ticket about a live failure; here the acceptance criterion is
that the *existing* commit fixtures are unchanged and still allow and deny
exactly as before, which a new scenario would not prove. The capability ran
unmodified.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVAL-001`, `AC-EVAL-002`, `AC-EVAL-006`, `NFR-REL-003`: malformed-decision fixtures through `runHook`, total-validator fixtures, evidence-presence fixtures, and launch-failure classification | `npm run test:unit` | Yes — the unit suite owns the runner and the decision contract |
| smoke | both | `AC-EVAL-001`: a real `git commit` still denies a failing change and allows a passing one, unchanged | `gate-activation-smoke` | Yes — the regression that matters is that fail-closed did not become fail-always |

Frontend build and browser evidence are inapplicable; this slice changes local
decision handling.

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

`tests/gate-hook-runner.test.mjs` has a case named *a decision that is not an
allow authorization never exits 0*, and it injects `{ outcome: 'passed' }` —
no `authorization` — which the string check catches. The adjacent shape that
*claims* `allow` was never tried, so the guard was proved against the input it
handles and never against the input it exists for. `validateDecision` is
thoroughly tested and simply has no production caller.
