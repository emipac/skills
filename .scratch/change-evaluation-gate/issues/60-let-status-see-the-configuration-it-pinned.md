# TB-060 — Let status see the configuration it pinned

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: done, defect
Blocked by:
Tracker ID: 60-let-status-see-the-configuration-it-pinned
Draft key: TB-060

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

`gate status` is the one command a maintainer runs to know where a clone
stands. It reports every control surface the receipt pinned — including the
configuration — and when something has moved, it says what and names the
command that puts it right.

## SRS Traceability

- `FR-LIFE-009`, `FR-LIFE-019`
- `AC-SEC-001`, `AC-LIFE-010`
- `SG-TRUST-001`, `SG-LIFE-001`
- `NFR-SEC-004`, `NFR-OPER-001`
- `RISK-001`

## Defect this contract fixes

Observed on a real project, twice, before it was understood.

### What happened

A maintainer edited `.agent-framework.yaml` — Pint arguments, then
`dependency_roots`, then `dependency_provisioning`, then `sensitive_inputs` —
and each time ran `gate status`:

```
state: activated
health: healthy
findings: 0
```

Each time the receipt still pinned the configuration from before the edit.
The next evaluation ran against the pinned policy, not the file, and reported
drift the maintainer had no way to anticipate from the status that had just
said healthy. Twice the maintainer re-ran an evaluation expecting a change
that could not have taken effect, and once a re-pin was performed with an
unsaved editor buffer because nothing said the file on disk still held the old
value.

### Why

Verified at `operator-surface.mjs:1249-1253`:

```js
const status = await statusGate({
  evidenceStore: clone.store,
  repositoryRoot,
  adapters: clone.receipt === null ? null : observedAdapters(clone.receipt),
});
```

`statusGate` takes a `controlSurface` parameter (`lifecycle.mjs:411`,
default `null`) and already does the right thing with it (`:597-603`):

```js
// Independent drift of a pinned Gate control surface: the clone can no longer
// say what it is enforcing, so it is `broken` rather than merely degraded
// (AC-SEC-001, NFR-SEC-004).
if (controlSurface !== null) {
  findings.push(...reconcileControlSurface({ receipt, observed: controlSurface }).findings);
}
```

The status command never passes one. `observeControlSurface`
(`hook-runner.mjs`) computes exactly the observation — recomputing the
configuration identity by the rule activation pinned it with, re-observing
every pinned runner, the hook block, the receipt's own identity — and the
packaged runners call it on every evaluation. Status does not. So status
reconciles adapter registrations only, and reports `healthy` on a clone whose
pinned policy no longer matches its file.

`NFR-SEC-004` says drift in the trusted configuration shall make health
`broken`. `AC-SEC-001` says each control surface's drift produces `broken`.
The machinery for both exists and is reached by the runners; the one command
whose purpose is to report health does not reach it. Same shape as `TB-044`,
`TB-045`, `TB-047`, `TB-052`, `TB-059`: built, proved, unreached.

### The second half: status says what, not what next

Even where status reports a finding, it does not say what to do. `TB-047`
made status honest about `installed` versus `configured`; `TB-053` made every
preview's `next:` line complete. Status has no `next:` line at all. A
maintainer reading `configuration-drift` has to know that the answer is a new
Activation transaction, and until `TB-062` lands, that it takes four commands.

## Domain decisions this contract settles

**Status observes what the runners observe.** The same `observeControlSurface`
the packaged runners call, with the same configuration-identity rule, so
status and the next evaluation can never disagree about whether the clone has
drifted. One observation, two readers.

**Status says what next.** Every finding that has a remedy names it. Drift of
a gate-owned registration → `gate repair`. Drift of the trusted
configuration → a new Activation transaction (`gate sync` once `TB-062`
lands; until then the deactivate/activate pair). A clone that is `configured`
and not activated → `gate activate`. Nothing to do → `next: nothing`. The
line uses the `git gate` shortcut where the receipt records one.

**Status still writes nothing.** `FR-LIFE-009` and `FR-LIFE-019`: observation
never repairs. This adds an observation and a sentence, not a mutation.

## Domain Concepts

Control surface, Trusted configuration, Configuration identity, Drift,
Health, Next action, Observation.

## Approach and Tradeoffs

Verified: `observeControlSurface({ activation, configuration, resolved })`
returns `{ receipt, observed }` in the shape `reconcileControlSurface`
consumes; the runners already do this pairing. Status has `clone.receipt`
and reads the configuration; it lacks only the call.

Verified: `reconcileControlSurface` already produces named findings per
surface (`trusted-configuration`, `receipt`, `hook-block`, runners), and
`statusGate` already turns any authoritative finding into `broken`.

Proposed — pass the observation. `operateStatus` calls
`observeControlSurface` with the receipt and the configuration it already
resolved, and passes the result as `controlSurface`. The implementer confirms
the runner-pin observation does not spawn anything or write anything (it
checks executables on disk) and states the cost.

Proposed — render `next:`. A small table from finding code to remedy, in the
operator surface where `renderConfirmation` lives. The implementer establishes
the full set of finding codes status can emit and gives each a remedy or an
explicit "no remedy; this is informational". A finding with no entry is a
test failure, not a silent omission.

Proposed — the configuration-drift finding names what moved when it can.
The receipt pins an identity, not a document, so a diff is not available;
but the finding can say "configuration identity changed since activation"
and name the file. If the implementer finds a cheap way to say which
subcontract changed, welcome; not required.

Deliberately not repairing anything from status. Deliberately not changing
what `broken` means. Deliberately not adding a mutation, a flag, or a store.

## Architecture Boundary and Public Seam

The boundary is between what a clone is enforcing and what its status
command says it is enforcing. The public seam is `operateStatus`'s call into
`statusGate`, and the `next:` line the status rendering gains.

First red test: a clone whose `.agent-framework.yaml` changed since activation
reports `broken` with a `trusted-configuration` finding and a `next:` naming
a new Activation transaction, where today it reports `healthy` with nothing.

## Safeguards and Invariants

- `FR-LIFE-009`, `FR-LIFE-019`: status observes and never repairs; nothing is
  written.
- `NFR-SEC-004`, `AC-SEC-001`: trusted-configuration drift is `broken`, as
  the runners already treat it.
- `SG-LIFE-001`: status never silently repairs drift; every finding is left exactly as observed.
- `SG-TRUST-001`: the same limit statement stays; noticing is the claim,
  resisting is not.
- `NFR-OPER-001`: every finding a maintainer can act on names the action.
- A clone with no drift reports exactly what it reports today plus
  `next: nothing`.
- Status and the next evaluation agree, because they share one observation.

## Prohibited Behavior and Non-goals

Do not repair, re-pin, or write anything from status. Do not add a second
configuration-identity rule; use the runners'. Do not change what any finding
code means. Do not change `gate status --json`'s existing fields; add to it.
Do not implement `gate sync` — `TB-062` owns it; name it in `next:` only once
it exists, and name the deactivate/activate pair until then.

## Risk and Decision Impacts

- `RISK-001`: a clone appearing governed when it is not. A status that says
  healthy over a drifted policy is that risk in its quietest form.
- No disposition changes; no safeguard is withdrawn.

## Acceptance Criteria

- [x] `NFR-SEC-004`, `AC-SEC-001`: a clone whose configuration changed since
  activation reports `broken` with a `trusted-configuration` finding, proved
  against a real activated clone.
- [x] `FR-LIFE-009`, `AC-LIFE-010`, `SG-LIFE-001`: status still writes nothing and repairs no drift, proved by hashing the
  clone's `.git` and working tree before and after.
- [x] Status and the next evaluation agree: the same clone that status calls
  drifted is denied `integrity-drift` on commit, and one status calls healthy
  is not.
- [x] `NFR-OPER-001`: every finding status can emit maps to a `next:` remedy
  or an explicit informational marker, proved by a fixture enumerating the
  codes.
- [x] A healthy clone prints `next: nothing` and is otherwise byte-identical
  to today's output.
- [x] `gate status --json` gains `next` and `controlSurface` fields; existing
  fields are unchanged.
- [x] Runner-pin observation during status spawns no process and is measured.
  (Proved by a pinned check that marks a file whenever it runs: five status
  runs leave no mark, the following commit does. Pinning costs one `access(2)`
  per pinned runner plus an in-process argument composition. On the
  implementing machine a healthy one-check clone's `gate status` went from
  about 16 ms to about 22 ms per invocation; the difference is the
  configuration read, the pinning, and one `git config` read for the
  shortcut — a Git process, not a pinned program.)
- [x] `SKILL.md` and `docs/framework-guide.html` lead with `git gate status` — the clone-local alias activation records — rather than the packaged script path, and every `next:` line status prints uses it where the receipt records one.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `NFR-SEC-004`, `AC-SEC-001`, `NFR-OPER-001`, `FR-LIFE-009`: drifted-configuration-is-broken, healthy-unchanged, every-finding-has-a-next, status-writes-nothing, json-fields-added fixtures against the real operator surface and lifecycle | `npm run test:unit` | Yes — the unit suite owns the operator surface and status |
| smoke | both | `AC-LIFE-010`, `AC-SEC-001`: a real activated clone, configuration edited, status reports `broken` and names the remedy, the following commit is denied for the same reason, and status after re-activation is healthy | `gate-lifecycle-smoke`, extended by this slice | Yes — status and evaluation agreeing is only observable on a real clone |

Frontend build and browser evidence are inapplicable; this slice changes one
command's observation and rendering.

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

Every status fixture activates a clone and asks status about it unchanged, or
removes a hook and asks again. None edits the configuration between
activation and status, because the configuration fixtures are generated and
nothing in the suite edits a generated file by hand. The runners' fixtures do
edit it — and prove drift is denied — but they never ask status what it
thinks first.
