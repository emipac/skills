# TB-066 — Say a Gate configuration is unversioned, once

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: done, defect
Blocked by:
Tracker ID: 66-say-a-gate-configuration-is-unversioned-once
Draft key: TB-066

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer whose Gate configuration is not in version control is told exactly
that — plainly, as the durable fact it is, and not once per agent turn. The
changed-Grader-surface report goes back to meaning that somebody edited
something, so it is still read on the turn when it is true.

## SRS Traceability

- `FR-EVAL-009`, `FR-CFG-005`
- `AC-SEC-001`
- `SG-CFG-001`, `SG-TRUST-001`
- `NFR-OPER-001`
- `RISK-008`

## Defect this contract fixes

`TB-064` made the preflight channel carry changed Grader surfaces, so a change
that edits what grades it can no longer pass unnoticed. Within one session of
real use, that line became noise.

### What a maintainer saw

```
Preflight (not a commit decision): passed.
Changed Grader surfaces (this change edits what grades it; stated for visibility):
- gate-configuration .agent-framework.yaml
```

Nobody had edited `.agent-framework.yaml`. It reads identically on the turn
somebody does.

### Why, verified

`changedGraderSurfaces` (`grader-surface.mjs:100-104`) intersects the declared
configuration paths with `changedPaths`:

```js
for (const relative of configurationPaths) {
  if (changed.has(relative)) {
    record('gate-configuration', relative);
  }
}
```

`changedPaths` comes from `listChangedPaths` (`snapshot.mjs:445-461`), which is
explicit about untracked paths and right to be:

```js
if (indexStatus === '?') {
  // An untracked path is nothing to the index, so it is not part of a
  // `git-index` change. For a worktree change it is the most common shape
  // the change takes — a file the agent just created …
  if (kind !== 'git-index') {
    changed.add(relative);
  }
```

So on a clone whose `.agent-framework.yaml` is untracked — which is the state a
project is in until somebody deliberately commits it, and `framework-setup`
never does — the file is in `changedPaths` on **every** worktree snapshot. The
observed project had `.agent-framework.yaml`, `phpstan.neon`, and `rector.php`
all untracked and not ignored.

Two consequences, both verified in that project's evidence:

| | |
| --- | --- |
| `integrity.changedGraderSurfaces` | names `.agent-framework.yaml` on every preflight, unconditionally |
| `integrity.controlSurfaceChanged` | `true` on every preflight, via `touchesControlSurface` |

### Why that is worse than a cosmetic defect

A warning that fires on every turn is not read on the turn it is true. This one
is aimed at an agent, in a prompt, on a loop — the fastest possible way to train
a reader to skip a line. `RISK-008` is a change weakening the surface judging
it; `TB-064` existed because detection without delivery is not visibility, and
delivery that is always identical is not delivery either.

The asymmetry makes it worse. A **commit** never reports it, because the
`git-index` snapshot excludes untracked paths by the same rule. So the surface
that matters at authorization time is silent exactly there, and loud where it
authorizes nothing.

And the fact underneath is real and unsaid: a Gate configuration outside version
control has no history, no review, and nothing to diff an agent's claimed edit
against. That project had already lost one round of an agent's edits with no way
to tell whether they were ever written. The Gate can see that and says nothing
about it.

## Domain decisions this contract settles

**An untracked Grader surface is unversioned, not changed.** The two are
different facts and get different words. A surface Git does not track is
reported as `unversioned`; a tracked surface whose content moved in this change
is reported as `changed`. A path can never be both, and the untracked one never
enters `changedGraderSurfaces`.

**Unversioned is durable, so it is stated where durable facts live and not on
every turn.** The decision and the evidence envelope record it every time,
because a decision describes its own conditions completely. The maintainer-facing
channel is what must not repeat it: the implementer establishes how the preflight
channel says it at most once for a run of unchanged turns, and states the rule
they chose and what resets it. `gate status` is the natural home for the standing
statement and already has a `next:` line to carry the remedy.

**The remedy is named, and it is the maintainer's.** Commit the file. The Gate
never stages, commits, or modifies anything in the working tree
(`FR-LIFE-009`), and an unversioned configuration is not a refusal — a clone may
legitimately run this way, and saying so once is the whole obligation.

**Nothing about `changed` loosens.** A tracked configuration that moved is
reported exactly as it is today, on every evaluation that carries it, with no
suppression and no once-only rule. `SG-CFG-001` and `RISK-008` are untouched:
this contract removes a false positive, never a true one.

**No intent is inferred, in either word.** `AC-SEC-001`: changed Grader surfaces
stay visible without automatic malicious classification, and so does an
unversioned one. Neither word implies anybody did anything wrong.

## Domain Concepts

Grader surface, Gate configuration, Untracked path, Changed path, Unversioned
surface, Control surface, Visibility, Signal fatigue.

## Approach and Tradeoffs

Verified: the seam is small and already parameterised.
`changedGraderSurfaces({ changedPaths, checks, declarations, executionRoot })`
receives the path set; `listChangedPaths` produces it and already distinguishes
`indexStatus === '?'` from every other status, so the untracked set is available
at exactly the point it is currently merged away.

Verified: `touchesControlSurface(surfaces)` derives `controlSurfaceChanged` from
the returned surfaces, so removing untracked paths from `changed` corrects that
field with no second change.

Verified: this is not the `integrity-drift` reconciliation. That compares pinned
identities against observed ones and is unaffected; the observed project was
`healthy` and `passed` throughout while this line fired.

Proposed — carry the untracked set alongside the changed set rather than
recomputing it. A second `git status` pass would be a second source of truth for
the same question, which is the shape `SG-EVAL-001` exists to prevent.

Proposed — report unversioned surfaces of every declared kind, not only the Gate
configuration. An untracked provider source or a `repository-script` a check
invokes is the same fact about the same class of file, and the observed project
had two more untracked files that a check reads. The implementer establishes
whether a test file is worth reporting this way or is ordinary new work, and
states the answer.

Proposed — the once-only rule belongs to the channel, not to the decision. The
implementer establishes it beside `TB-039`'s loop guard and `TB-027`'s
suppression, which already own "this client has been told this", and states what
resets it — a new session, a changed surface set, or a run of turns.

Deliberately not refusing, blocking, or degrading health for an unversioned
configuration. Deliberately not staging or committing anything. Deliberately not
changing what `changed` means, what `integrity-drift` means, or what the
`git-index` snapshot contains.

## Architecture Boundary and Public Seam

The boundary is between a file Git does not track and a file that moved. The
public seam is `changedGraderSurfaces`'s inputs and result, the decision fields
derived from it, and the preflight channel's rendering of both.

First red test: two consecutive preflights on a clone whose untracked
`.agent-framework.yaml` nobody touched report no changed Grader surface, and the
second does not repeat the unversioned statement — where today both report it as
changed.

## Safeguards and Invariants

- `RISK-008`, `SG-CFG-001`: a tracked Grader surface edited by the change is
  still reported, every time, unsuppressed.
- `FR-EVAL-009`: the decision still binds every Grader surface fact it observes;
  only the channel is rate-limited.
- `AC-SEC-001`: neither `changed` nor `unversioned` classifies intent.
- `FR-LIFE-009`: nothing is staged, committed, or written to the working tree.
- `NFR-OPER-001`: the unversioned statement names the file and the remedy.
- `SG-TRUST-001`: this reports; it resists nothing, and a maintainer may run an
  unversioned configuration indefinitely.
- `controlSurfaceChanged` is true only when a tracked control surface moved.

## Prohibited Behavior and Non-goals

Do not refuse, deny, or degrade health because a surface is unversioned. Do not
stage or commit anything, or instruct a client to. Do not suppress a genuinely
changed surface, ever, under any rate limit. Do not add a second enumeration of
Git status. Do not change the `git-index` snapshot's exclusion of untracked
paths — it is correct. Do not treat every untracked file as a Grader surface;
only declared surfaces are reported, as today.

## Risk and Decision Impacts

- `RISK-008`: a Grader surface weakened by the change evaluating it. A warning
  that always fires is one nobody reads; this restores the signal.
- No disposition changes; no safeguard is withdrawn.

## Acceptance Criteria

- [x] `FR-EVAL-009`: an untracked declared Grader surface is reported as
  `unversioned` and never appears in `changedGraderSurfaces`, proved against a
  clone whose `.agent-framework.yaml` is untracked and unmodified. (Recorded as
  `integrity.unversionedGraderSurfaces`, a required integrity field; the
  contract refuses a path in both lists. Every declared kind is reported this
  way, a test matched by a declared glob included — no runner declares test
  globs today.)
- [x] `controlSurfaceChanged` is `false` on that clone, and `true` when a
  tracked control surface actually moves. (Also `true` for a configuration
  staged for the first time: it is tracked.)
- [x] `RISK-008`, `SG-CFG-001`: a tracked `.agent-framework.yaml` edited by the
  change is reported as changed on every evaluation, with no suppression.
  (The `TB-027` loop guard still bounds a whole unchanged message, exactly as
  before.)
- [x] The preflight channel states the unversioned fact at most once across a
  run of unchanged turns, by a stated rule, and states what resets it. (Rule:
  stated unless the decision the Evidence store recorded immediately before this
  evaluation's own append recorded the same set of kind and path — so not on
  later turns, changed or not, in any session. Reset: a recorded decision whose
  set differs. Fails toward stating on an empty or unreadable record.)
- [x] The decision and the evidence envelope record the unversioned surfaces
  every time, regardless of what the channel said.
- [x] `NFR-OPER-001`: the statement names each unversioned surface and the
  remedy, and the remedy is the maintainer's to perform. (Channel and `gate
  status`'s `next:` line render it from `REMEDIES` as `version-control`.)
- [x] `FR-LIFE-009`: nothing is staged, committed, or written to the working
  tree, proved by hashing the clone before and after.
- [x] An untracked file that is not a declared Grader surface is reported by
  neither word.
- [x] `AC-SEC-001`: no output implies intent for either word.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `FR-EVAL-009`, `SG-CFG-001`, `AC-SEC-001`, `NFR-OPER-001`: untracked-is-unversioned-not-changed, control-surface-false-when-untracked, tracked-edit-still-changed-every-time, channel-says-it-once, decision-records-it-always, undeclared-untracked-file-silent, and no-intent-language fixtures against the real surface detection, snapshot enumeration, and channel | `npm run test:unit` | Yes — the unit suite owns Grader surface detection, `listChangedPaths`, and the preflight channel |
| smoke | both | `AC-SEC-001`, `RISK-008`: on a real activated clone, consecutive preflights over an untracked configuration report it once and never as changed, and committing that file then editing it reports a change on the next evaluation | `gate-hook-conformance-smoke` and `gate-security-control-smoke`, extended by this slice | Yes — repetition across turns is only observable across real consecutive runs |

Frontend build and browser evidence are inapplicable; this slice changes how one
observation is classified and delivered.

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

Every Grader surface fixture commits its configuration and then edits it,
because that is the behaviour under test and a committed file is what a fixture
naturally builds. No fixture leaves the configuration untracked, so no fixture
ever asked what the Gate says about a clone in the state every real project
starts in and most stay in. The repetition needed two consecutive turns to be
visible at all, and the suite asserts one evaluation at a time.
