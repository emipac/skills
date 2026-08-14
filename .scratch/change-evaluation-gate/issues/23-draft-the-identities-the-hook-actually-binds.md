# TB-023 — Draft the check identities the activated hook actually binds

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 23-draft-the-identities-the-hook-actually-binds
Draft key: TB-023

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A policy drafted by `--draft-policy` names the check identities the activated
Git hook will actually bind, so a maintainer who accepts the draft gets the
enforcement the draft claims rather than a policy that configures cleanly and
enforces nothing.

## SRS Traceability

- `FR-PROF-010`, `FR-EVAL-001`, `FR-CFG-004`
- `AC-CFG-002`
- `SG-OWNER-001`
- `NFR-REL-003`

## Defect this contract fixes

Found while verifying `TB-022`, and reproduced against the shipped code. Two
facts, both checked:

**1. The drafter emits provider-plan identities.** Running the new mode against
this repository:

```
node skills/framework-setup/scripts/configure.mjs --project "$PWD" --draft-policy
{ "checks": { "required": ["format.formatter", "broad-tests.test"], … } }
```

**2. The activated hook binds configuration-derived identities.** The packaged
runner resolves its checks through `gateChecksFromConfiguration`
(`skills/change-evaluation-gate/scripts/lib/configuration.mjs:381`, called from
`hook-runner.mjs:397`), which names each check
`configuration.<stage>.<capability>` from `CONFIGURED_STAGES`. Driving it with a
real schema v4 configuration produces:

```
SINGLE ids: [ 'configuration.format.formatter',
              'configuration.static-analysis.static-analysis',
              'configuration.broad-tests.test' ]
MULTI  ids: [ 'configuration.format.formatter.1',
              'configuration.format.formatter.2' ]
```

The two sets do not intersect. `format.formatter` is not
`configuration.format.formatter`.

Three separate divergences, worst first:

- **Prefix.** Every bound identity carries a `configuration.` prefix the
  provider plan does not.
- **Capability.** For static analysis the bound capability is
  `static-analysis`, giving `configuration.static-analysis.static-analysis`.
  The provider's `application`, `rewrite-check`, and `tests` variants have no
  counterpart on this path: one configured stage yields one check.
- **Ordinal.** A stage configuring more than one command across scopes appends
  `.1`, `.2`. A project that formats both backend and frontend binds
  `configuration.format.formatter.1` and `.2` and nothing named
  `configuration.format.formatter`. So the identity depends on the shape of the
  maintainer's own configuration, not on the provider alone.

**Why this is severe rather than cosmetic.** `validateGatePolicy` accepts any
non-empty string (`policy.mjs:61`), so none of this fails loudly. A policy
drafted today validates, configures, activates, and then binds zero required
checks — every commit passes a gate the maintainer believes is enforcing. That
is `NFR-REL-003` inverted: absence of evidence presenting as success. It is the
same failure shape as `TB-020`, where the registered hook program was a silent
no-op that passed every commit.

`TB-022` was correct to derive from the provider seam — its `SG-OWNER-001`
reasoning stands, and its anti-drift test should be kept. The defect is that
the provider plan is the wrong source for *this* consumer.

## Domain Concepts

Check descriptor, Check identity, Verification profile, Provider, Gate policy
subcontract.

## Approach and Tradeoffs

Draft the policy from the same function the hook binds through. Where a schema
v4 configuration exists, derive `checks` by calling
`gateChecksFromConfiguration` and reading the resulting descriptors' `id`,
rather than reading `provider.plan`. One source, one set of names, no
possibility of divergence — the same reasoning `TB-019` applied to preview and
execution, and `TB-021` to reader and writer.

Keep the provider seam for the *binding* (required vs advisory). The
configuration knows which checks exist; the provider knows which ones should
block. Map each configuration-derived check back to the provider plan entry
sharing its stage and capability, and take that entry's declared `policy`.
Where no plan entry matches, emit the check as `advisory` — proposing a
blocking check the provider never declared would be a guess.

Where no v4 configuration exists yet, the drafter cannot know the bound
identities, because they depend on commands that have not been written. Refuse
rather than fall back to provider-plan names: a draft that cannot bind is worse
than no draft, since it is indistinguishable from a working one. The message
should say to migrate first.

## Architecture Boundary and Public Seam

The boundary is `draftGatePolicy` inside
`skills/framework-setup/scripts/configure.mjs`. The public seam is the emitted
`checks` document. First red test: a fixture whose configuration binds
`configuration.format.formatter` and `configuration.broad-tests.test` produces
a draft naming exactly those two identities and neither `format.formatter` nor
`broad-tests.test`.

## Safeguards and Invariants

- `SG-OWNER-001`: `framework-setup` still keeps no copy of the check catalogue.
  `TB-022`'s anti-drift source scan must survive this change unmodified, and
  must additionally reject any literal `configuration.` identity prefix in
  `configure.mjs`.
- `NFR-REL-003`: a drafted required check either binds at evaluation or the
  draft is refused. There is no third outcome in which it silently does not.
- Drafting stays read-only: no write to `.agent-framework.yaml`, no hook,
  receipt, or trust decision, no `previewHash`.

## Prohibited Behavior and Non-goals

Do not make `validateGatePolicy` reject unknown identities — that is a real
gap but a separate contract with its own compatibility question, and widening
the validator here would retroactively invalidate existing configured policies.
Do not change `gateChecksFromConfiguration`, `CONFIGURED_STAGES`, or the
ordinal rule; the runtime naming is correct and this ticket conforms to it. Do
not add a provider. Do not change `--draft-mapping`.

## Risk and Decision Impacts

- No parent risk disposition changes. This corrects a defect in `TB-022` rather
  than reopening a settled decision.
- Raises the question of whether unknown check identities should be refused at
  configuration time. Recorded here as an open follow-up, deliberately out of
  scope.

## Acceptance Criteria

- [x] `AC-CFG-002`, `FR-PROF-010`: for a fixture with a schema v4 configuration,
  `--draft-policy` emits `checks` identities that are exactly the `id` values
  `gateChecksFromConfiguration` produces for that same configuration, including
  the `configuration.` prefix, the configured capability, and the `.1` / `.2`
  ordinals where a stage configures more than one command.
- [x] `FR-EVAL-001`, `NFR-REL-003`: a policy taken verbatim from the drafter,
  configured and activated, binds every identity it lists — proved by an
  evaluation in which a required drafted check actually runs and denies a
  commit it should deny, rather than passing for want of a matching check.
- [x] `SG-OWNER-001`: required/advisory bindings still come from the provider's
  declared per-check `policy`; a configuration check with no matching plan
  entry is emitted advisory; and the anti-drift scan still proves
  `configure.mjs` restates no identity from either catalogue.
- [x] A project with no schema v4 configuration is refused with a message
  naming migration as the prerequisite, rather than receiving a provider-named
  draft.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-002`, `FR-PROF-010`, `SG-OWNER-001`: drafted identities equal `gateChecksFromConfiguration` output for single-command, multi-command, and unmatched-plan-entry fixtures; refusal without v4 | `npm run test:unit` | Yes — configured unit suite owns the drafting seam |
| smoke | both | `FR-EVAL-001`, `NFR-REL-003`: the round trip drafts a policy, configures, activates, and a required drafted check denies a commit it must deny | `gate-activation-smoke` capability extended by this slice | Yes — binding at evaluation is the behaviour, and `TB-022`'s round trip stops at `configured` without proving it |

Frontend build and browser evidence are inapplicable; this slice changes
configuration document emission, not a frontend surface.

## Blocked By

`TB-022` — this corrects the drafter that ticket introduces.

## Delivered 2026-08-14

`draftGatePolicy` now sources `checks` identities from
`gateChecksFromConfiguration` — the same function the activated hook binds
through — rather than from the provider's plan. The provider plan is still
consulted, but only to decide required-vs-advisory per identity, matched by
stage and capability; an identity with no matching plan entry binds advisory
rather than guessing required. A project with no schema v4 configuration, or
one whose `verification.commands` proves nothing, is refused with a message
naming migration as the prerequisite, rather than drafting provider-named
identities that would not bind.

`configuration.mjs`, `policy.mjs`, `hook-runner.mjs`, `CONFIGURED_STAGES`, and
`--draft-mapping` are unmodified — confirmed by an empty `git diff --stat`
against each. `SG-OWNER-001`'s anti-drift scan is intact and strengthened: it
now also rejects any string literal beginning `configuration.` inside
`configure.mjs`, so a future change cannot silently hardcode the runtime
prefix instead of deriving it.

The `gate-activation-smoke` round trip that used to stop at `configured: true`
now activates the clone on a drafted policy alone and drives real `git commit`
invocations: a breaking commit is denied by a required drafted check, and a
repaired one is allowed through the same clone. Reverting the fix and rerunning
that scenario reproduces the exact defect this ticket describes — the denial
message names `format.formatter` and `broad-tests.test` as checks "no
configured provider resolved" — which is direct proof the scenario is a real
regression guard rather than a vacuous pass.

Evidence: `npm run validate` (226 Markdown files), `npm run test:unit` (315
pass, 0 fail), `npm run test:install` (clean), `npm run gate-activation-smoke`
(5/5 including `derived-configuration-round-trip`).

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

`TB-022`'s round trip ends at `configured: true` and never activates or
evaluates, so nothing ever asked whether a drafted identity binds. Its policy
assertions compare the draft against the provider plan — the same source the
drafter reads — so the fixture and the thing under test came from one place and
agreed with themselves. That is the exact pattern `TB-013`, `TB-017` through
`TB-021` each closed, recurring one layer further out: this time the agreeing
pair is the drafter and its own test, with the runtime never consulted.
