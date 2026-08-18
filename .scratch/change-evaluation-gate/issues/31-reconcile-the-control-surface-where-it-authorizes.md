# TB-031 — Enforce the configuration that was activated

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 31-reconcile-the-control-surface-where-it-authorizes
Draft key: TB-031

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A commit is graded by the policy the maintainer approved, or it is not graded
at all. The authoritative runner reconciles every Gate control surface the
Activation receipt pinned — the trusted configuration first among them —
against what is on the machine now, and drift ends the decision as `unverified`
with `integrity-drift` pointing at `gate repair`. Changing which checks are
required, what they run, or how severely they bind stops being something a
clone silently starts enforcing.

## SRS Traceability

- `FR-EVAL-001`, `FR-LIFE-019`, `FR-CFG-002`
- `AC-SEC-001`, `AC-EVAL-001`, `AC-CFG-004`
- `SG-TRUST-001`, `SG-POL-001`
- `NFR-SEC-004`, `NFR-REL-003`
- `RISK-001`

## Defect this contract fixes

Found while reviewing the recorded evidence of real commits in `gms`
(`real-project-evidence/change-evaluation-gate/evidence/`), and independently
raised as a `P0` by an external audit of `HEAD` `9569362` — *"activation does
not bind the approved configuration identity: policy severity, command
arguments, or checks can be changed after activation while retaining the same
runner path; the hook evaluates the changed configuration."*

Those are one defect, not two. The receipt already pins the trusted
configuration identity, `reconcileControlSurface` already compares it against
what is observed, and nothing calls it — so the binding the audit asks for is
the wiring this ticket describes, and enforcing the activated configuration is
what that wiring *does*.

Every decision in the recorded evidence, on both the authoritative and the
preflight path, carries `"diagnostics": []` — and always will, because
control-surface reconciliation never runs.

**This is the sharpest defect in the product's own threat model.** The gate is
built for an AI-assisted workflow where an agent edits the repository, and the
recorded evidence shows `controlSurfaceChanged: true` because that agent had
`.agent-framework.yaml` staged. An agent whose commit is blocked can weaken the
policy that blocks it — drop the failing check from `required`, widen a
command, lower a severity — and the very next commit is graded against the
weakened configuration with no re-consent and no signal. Nothing about that
requires an attacker; it is an ordinary agent doing what it was asked to do,
which is what makes it worth denying.

`evaluateSnapshot` guards it:

```js
if (dependencies.controlSurface) {
  const reconciled = reconcileControlSurface({ receipt, observed });
  if (reconciled.drifted) { diagnostics.push({ … }); }
}
```

A repository-wide search finds exactly two callers that ever supply
`controlSurface`: `gate-security-control-smoke.mjs` and
`tests/gate-security-control.test.mjs`. **Neither `hook-runner.mjs` nor
`preflight-runner.mjs` passes it.** The two entry points that reach a real
maintainer — the only two that turn an outcome into an authorization — never
reconcile anything.

`reconcileControlSurface` itself is complete and correct. It compares the
receipt's pinned runtime, adapters, managed hooks, receipt id, trusted
configuration, command descriptors, and providers against what is observed, and
its own contract states the consequence: *"a gate that can no longer identify
its own runtime, adapters, hooks, receipt, trusted configuration, descriptors,
or providers is not in a position to authorize anything, whatever the checks
report."* `NFR-SEC-004` and `AC-SEC-001` say the same. Today that sentence
describes a function nothing calls in production.

So a clone whose registered hook was swapped, whose adapter set changed, whose
configuration identity no longer matches the one consent was granted against,
or whose descriptors were edited after activation, continues to authorize
commits on the strength of checks alone — and the receipt it is nominally bound
to is never compared to anything.

This is the same shape as `TB-023`, `TB-024`, and `TB-026`: a component built,
proved, and then never reached by the runtime that was supposed to consume it.
It is the fourth instance, and the first where the unreached component is a
security control.

## Domain Concepts

Control surface, Activation receipt, Runtime pin, Integrity drift, Observed
identity, Enforcement authority, Lifecycle health.

## Approach and Tradeoffs

**Observe from what the runner already reads.** `runHook` resolves the Git
common directory, reads the receipt, reads the configuration, and resolves the
pinned runners before it evaluates — which is nearly the whole observed
surface. What remains is the registered hook's own block identity and the
adapter registrations, both of which the receipt already names and both of
which are readable from disk without executing anything. Reconciliation is
observation: it opens files, compares identities, and writes nothing.

**One observation, both entry points.** The authoritative runner and the
preflight runner assemble the same observed surface, from one shared function,
for the same reason `TB-024` gave resolution one owner and `TB-026` gave the
store one wiring. A second copy of "what does this machine look like now" is
how the two would come to disagree.

**Drift denies where it can, and reports where it cannot.** Under an
authoritative role, `integrity-drift` is `unverified`, which denies. Under
preflight, the same finding is presented as `unverified` and
`not-authoritative` — it warns, it never blocks, and `SG-SUPPORT-001` is
untouched. `reconcileControlSurface` already takes `role` and computes the
authorization itself; both callers pass their own.

**Report, never repair.** `FR-LIFE-019` gives recovery to a confirmed operator
action. This slice detects and denies; `gate repair` is named in the message
and nothing else is done about it.

**Detection is not resistance.** A machine owner can change any of these
identities, and noticing is the entire claim (`SG-TRUST-001`, `ASM-001`).
Nothing here should be described, in code or in output, as preventing tampering.

## Architecture Boundary and Public Seam

The boundary is between the Activation receipt's pinned identities and the
identities observable on this machine at decision time. The public seam is the
shared observed-surface function and the two runners' use of it; the
reconciliation rule itself does not move.

First red test: an activated throwaway clone whose `.agent-framework.yaml` is
edited after activation — a required check dropped from `required` — denies the
next commit with `integrity-drift`, naming the trusted-configuration surface,
where today the same clone commits normally under the weakened policy.

**The observed configuration identity must be computed the way the receipt's
was.** `configurationIdentity` in `activation.mjs` is that rule, and the
comparison is only meaningful if both sides use it: an observation that hashes
the file differently would report drift on every commit, and one that hashes
less than the receipt pinned would miss the edit this ticket exists to catch.

## Safeguards and Invariants

- `AC-SEC-001`, `NFR-SEC-004`: independent drift of any pinned control surface
  makes an authoritative evaluation `unverified` with `integrity-drift`,
  whatever the checks report.
- `SG-TRUST-001`: this is observation on a cooperative local process. It
  detects; it does not resist, and it claims nothing more.
- `FR-LIFE-019`: nothing is repaired, rewritten, or re-pinned. The message
  names `gate repair` and stops there.
- `SG-SUPPORT-001`: a preflight surface reporting drift is still
  `not-authoritative` and non-blocking.
- Observation writes nothing. No file is opened for writing, and a failure to
  observe is itself `unverified` rather than an assumed match.

## Prohibited Behavior and Non-goals

Do not change `reconcileControlSurface`, the set of control surfaces, or the
drift reason code. Do not repair, re-pin, or re-activate anything. Do not make
a *changed Grader surface* — a commit that edits `.agent-framework.yaml`, a
test, or a provider — into drift: that is ordinary work, it is reported as
visibility by `TB-006`, and conflating the two would accuse a maintainer of
tampering for editing their own configuration. Do not add a lifecycle command
surface or a health view; `gate status` is a separate contract.

## Risk and Decision Impacts

- `RISK-001`: local enforcement is bypassable by design, and the accepted
  mitigation is that what happened is recorded and what changed is noticed.
  A control surface nothing reconciles is that mitigation missing.
- No disposition changes. This wires an approved requirement to the runtime;
  it grants no new capability and makes no new claim.

## Acceptance Criteria

- [ ] `AC-SEC-001`, `NFR-SEC-004`: in an activated clone, drift of each pinned
  control surface — runtime, adapters, managed hooks, receipt, trusted
  configuration, command descriptors, providers — makes the next commit-time
  evaluation `unverified` with `integrity-drift` and denies it.
- [ ] `AC-CFG-004`, `SG-POL-001`: an activated clone whose Gate policy is
  edited afterwards denies the next commit rather than enforcing the edit —
  proved separately for a check moved out of `required`, a changed command
  argument, and an added or removed check identity, each driven through a real
  `git commit`. This is the audit's `P0`, and it is the case a maintainer or an
  agent reaches without doing anything unusual.
- [ ] `AC-CFG-004`: the observed configuration identity is computed by
  `configurationIdentity`, the same rule the receipt was pinned with, so an
  unedited clone never reports drift and an edited one always does.
- [ ] `AC-EVAL-001`: an activated clone with no drift is unaffected: the same
  commits are allowed and denied exactly as before, with no added diagnostic.
- [ ] `SG-SUPPORT-001`: the preflight runner reports the same drift as
  `unverified` and `not-authoritative`, blocking nothing.
- [ ] `FR-LIFE-019`: a drifted clone is reported, never repaired; the message
  names the drifted surface and `gate repair`, and no gate-owned file is
  written by the observation.
- [ ] `FR-EVAL-009`: a commit that edits a declared Grader surface is *not*
  reported as drift, proving the two remain distinct.
- [ ] `SG-OWNER-001`: exactly one function assembles the observed control
  surface, and both runners reach it — proved by a source scan of the kind
  `TB-024` uses.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-SEC-001`, `NFR-SEC-004`, `FR-EVAL-009`: per-surface drift fixtures against both runners, a no-drift baseline, an unobservable-surface case, and the single-observer source scan | `npm run test:unit` | Yes — the unit suite owns both runners and the security control |
| smoke | both | `AC-SEC-001`, `AC-CFG-004`, `AC-EVAL-001`: an activated throwaway clone whose Gate policy is weakened after activation denies a real `git commit` with `integrity-drift`; the same for an edited hook block; and an undrifted clone still commits | `gate-security-control-smoke` extended to drive the packaged runner, with the real-commit half in `gate-activation-smoke` | Yes — today that capability proves the rule against a hand-assembled surface and never against the shipped entry point |

Frontend build and browser evidence are inapplicable; this slice changes local
decision-time observation.

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

`gate-security-control-smoke` and `tests/gate-security-control.test.mjs` both
assemble a receipt and an observed surface by hand and call `evaluate` with
`controlSurface` supplied. They prove the rule thoroughly and they are the only
callers that ever satisfy the `if (dependencies.controlSurface)` guard, so the
guard reads as satisfied everywhere it is tested and is false everywhere it
matters. A dependency that is optional at the seam and absent in production is
invisible to any fixture that supplies it.
