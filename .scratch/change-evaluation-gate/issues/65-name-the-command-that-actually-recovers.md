# TB-065 — Name the command that actually recovers

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 65-name-the-command-that-actually-recovers
Draft key: TB-065

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

When the Gate denies a commit and tells a maintainer what to run, the command
it names is one that recovers the drift it just described. A maintainer
following the Gate's own instruction reaches a working clone instead of a
refusal.

## SRS Traceability

- `FR-LIFE-019`, `FR-POL-003`
- `AC-LIFE-010`, `AC-SEC-001`
- `SG-LIFE-001`, `SG-TRUST-001`
- `NFR-OPER-001`, `NFR-SEC-004`, `NFR-REL-003`
- `RISK-001`

## Defect this contract fixes

Five places tell a maintainer to run `gate repair` for drift that
`gate repair` cannot touch.

### The instruction, verified

`evaluate.mjs:538` and `:848`, both identical:

```js
detail: `The Gate control surface drifted independently of this change (${…});
  nothing here is proved. Run \`gate repair\` to re-resolve and re-pin what this
  clone was activated with.`,
```

`hook-runner.mjs:640`, used at `:671`, `:679`, and `:689`:

```js
const REPAIR = 'run `gate repair` to re-resolve and re-pin the commands this clone was activated with';
```

— appended to `runner-unpinned`, `runner-pin-drift` (twice: a changed runner,
and a pinned executable that is gone).

### What `gate repair` actually does, verified

`previewRepair` (`lifecycle.mjs:1213-1263`) filters `gate status`'s findings
through exactly one set:

```js
const repairable = new Set(['hook-absent', 'hook-block-tampered', 'hook-receipt-mismatch']);
```

Every action it builds is `kind: 'hook-registration'`, restored to the
`blockIdentity` and `priorIdentity` the receipt already pins. Everything else
is returned in `unrepairable`, and the module states why:

> Adapter loss is a reinstall, not a repair: nothing here pretends to reinstate
> a client the machine no longer has (`RISK-004`).

Command descriptors, the trusted configuration, and runner pins are not in that
set, and by design cannot be: repair restores a registration to what the receipt
authorizes, and none of these drifts is a registration. A maintainer whose
descriptors drifted runs `gate repair`, receives `nothing-previewed` or an
unrepairable report, and has learned nothing about what to do instead.

### What it cost, on a real project

A maintainer activated a clone. An agent then corrected two genuinely wrong
check descriptors in `.agent-framework.yaml` — a formatter invoked with a
mutating flag, and a static analyser with too little memory. Both edits were
right. Both changed the composed runner previews away from what the receipt
pinned.

The decision read directly from the runner afterwards:

| | |
| --- | --- |
| every check | `passed` |
| outcome | `unverified` |
| diagnostic | `integrity-drift` — the `command-descriptors` surface |
| the instruction | "Run `gate repair` to re-resolve and re-pin…" |

The correct recovery was a new Activation transaction. The Gate named the one
command that would not perform it. `NFR-OPER-001` requires a decision to be
"sufficient to diagnose a denial"; a correct diagnosis followed by a wrong
remedy is the failure mode that requirement exists to prevent, because a
maintainer trusts the remedy more than the diagnosis.

This is the same shape as `TB-060`'s second half — status names a finding and
not what to do — from the other side: here the Gate does name an action, and it
is the wrong one, which is worse than silence.

## Domain decisions this contract settles

**A remedy is derived from the drifted surface, never fixed in the string.**
Each control surface and each runner-pin reason code has exactly one recovery,
and it is looked up rather than written inline at each site. Five copies of one
sentence is what let the sentence be wrong in five places at once.

**There is one remedy table, and both readers use it.** `TB-060` gives
`gate status` a finding-to-remedy table for its `next:` line; these diagnostics
need the same mapping for the same surfaces. Whichever contract lands first owns
the table and the other consumes it — the implementer states which happened.
Two tables that can disagree about how to recover one drift is the defect
reappearing.

**A gate-owned registration is repaired; everything else is re-established.**
`FR-LIFE-019` already settles that recovery is an explicit `gate repair` **or**
an Activation transaction. The remedies split on exactly that line:
hook-registration drift names `gate repair`; a drifted configuration, descriptor
set, receipt, provider, or runner pin names a new Activation transaction —
`gate sync` once `TB-062` provides it, and the deactivate/activate pair until
then.

**The remedy uses the clone's own shortcut.** An activated clone carries
`git gate`; where the receipt records one, the named command uses it, exactly as
`TB-060` requires of status.

## Domain Concepts

Control surface, Runner pin, Drift, Recovery, Remedy, Activation transaction,
Diagnosability.

## Approach and Tradeoffs

Verified: the drifted surfaces are enumerable and already named. The control
surfaces are `runtime`, `adapters`, `managed-hooks`, `receipt`,
`trusted-configuration`, `command-descriptors`, and `providers`
(`security-control.mjs`), and `reconcileControlSurface` already returns a
finding per surface. The runner-pin reason codes are `runner-unpinned` and
`runner-pin-drift` (`hook-runner.mjs:670-689`).

Verified: `reconcileControlSurface` returns `findings[].surface`, so the
diagnostic at `evaluate.mjs:538` and `:848` already knows which surface drifted
at the moment it composes its sentence. It joins them into a list and then
discards the distinction when choosing what to recommend.

Proposed — one exported mapping from drifted surface and reason code to a
remedy, and every one of the five sites renders through it. The implementer
establishes where it lives so both the runners and the operator surface reach it
without the operator surface importing the runner, and states that placement.

Proposed — a surface with no entry is a test failure, not a default. The
fixture enumerates every control surface and every runner-pin reason code and
fails if any lacks a remedy, so a surface added later cannot silently inherit a
wrong one.

Proposed — say what the remedy will and will not preserve. A maintainer told to
deactivate and activate should know from the message that configuration and
historical evidence survive it; that is the difference between following the
instruction and hesitating over it.

Deliberately not changing what `gate repair` repairs. Its three findings are
the ones a receipt can authorize a restoration of, and widening that set would
make repair re-pin a policy nobody consented to — which is `TB-062`'s
transaction, under consent, for exactly that reason. Deliberately not changing
any outcome, reason code, or authorization; this slice changes the sentence that
follows them.

## Architecture Boundary and Public Seam

The boundary is between detecting a drift and naming its recovery. The public
seam is the remedy mapping and the five diagnostic sites that render through it.

First red test: an evaluation denied for `command-descriptors` drift names a new
Activation transaction, where today it names `gate repair`, which refuses.

## Safeguards and Invariants

- `FR-LIFE-019`: recovery stays explicit and operator-driven; nothing here
  repairs, re-pins, or writes.
- `SG-LIFE-001`: the drift is left exactly as found; this changes a message.
- `NFR-OPER-001`: every drift a decision reports names a command that recovers
  it.
- `AC-SEC-001`, `NFR-SEC-004`: drift still makes health `broken` and an
  authoritative evaluation `unverified`; no outcome changes.
- `NFR-REL-003`: a pinned program is still never silently re-resolved to a
  different one.
- `SG-TRUST-001`: naming a recovery is not a claim to resist anything.
- `AC-LIFE-010`: `gate repair` keeps repairing exactly its three findings.

## Prohibited Behavior and Non-goals

Do not widen what `gate repair` repairs. Do not make any diagnostic perform a
recovery, or suggest one that writes without consent. Do not change an outcome,
reason code, or authorization. Do not add a second remedy table. Do not name
`gate sync` before `TB-062` provides it — name the deactivate/activate pair
until then. Do not suggest `--no-verify`, deleting a hook, or editing a receipt
as a recovery.

## Risk and Decision Impacts

- `RISK-001`: a clone appearing governed when it is not. A maintainer who runs
  the named command, sees it refuse, and concludes the Gate is broken is one
  step from disabling it.
- No disposition changes; no safeguard is withdrawn.

## Acceptance Criteria

- [ ] `NFR-OPER-001`, `FR-LIFE-019`: each control surface's drift names a
  recovery that performs it — hook-registration drift names `gate repair`, and
  configuration, descriptor, receipt, provider, and runtime drift name a new
  Activation transaction.
- [ ] `runner-unpinned` and both `runner-pin-drift` cases name a recovery that
  performs them, and no longer name `gate repair`.
- [ ] A fixture enumerates every control surface and every runner-pin reason
  code and fails if any has no remedy entry.
- [ ] One mapping serves every site; no second table exists, proved by the
  absence of any remaining inline remedy string.
- [ ] `AC-LIFE-010`: `gate repair` still previews and repairs exactly
  `hook-absent`, `hook-block-tampered`, and `hook-receipt-mismatch`, and still
  reports everything else as unrepairable.
- [ ] Where the receipt records the clone-local shortcut, the named command uses
  it.
- [ ] `AC-SEC-001`: outcomes, reason codes, and authorization for every drift
  are byte-identical to today.
- [ ] The remedy states that configuration and historical evidence survive it.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `NFR-OPER-001`, `FR-LIFE-019`, `AC-LIFE-010`, `AC-SEC-001`: remedy-per-surface, remedy-per-runner-pin-code, every-surface-has-an-entry, single-table, repair-scope-unchanged, outcomes-unchanged, and shortcut-used fixtures against the real reconciliation and runner pinning | `npm run test:unit` | Yes — the unit suite owns reconciliation, the runners, and the operator surface |
| smoke | both | `AC-SEC-001`, `AC-LIFE-010`: on a real activated clone whose descriptors are edited, the denial names a recovery and performing exactly that recovery returns the clone to a passing commit | `gate-lifecycle-smoke` and `gate-security-control-smoke`, extended by this slice | Yes — that the named command actually recovers is only observable by running it on a real clone |

Frontend build and browser evidence are inapplicable; this slice changes the
remedy a diagnostic names.

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

The integrity fixtures assert what a drift produces — `broken` health, an
`unverified` authoritative result, the right reason code — because that is what
the safeguards are written about. No fixture reads the remedy sentence, and no
fixture runs it. The suite proves the Gate notices; nothing proved the Gate
tells you something true about what to do next, because a remedy string is
prose and prose was never treated as behaviour.
