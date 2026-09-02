# TB-052 — Make the bypass switch mean something

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 52-make-the-bypass-switch-mean-something
Draft key: TB-052

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer who enables bypass in their Gate policy either gets a bypass or is
told plainly that they do not. The one outcome that stops being possible is the
current one: a policy switch that reads as enabled, changes nothing, and says
nothing.

## SRS Traceability

- `FR-POL-006`, `FR-POL-007`, `FR-POL-008`, `FR-CFG-002`
- `AC-POL-002`, `AC-CFG-001`
- `SG-BYP-001`, `SG-TRUST-001`, `SG-CFG-001`
- `NFR-AUD-001`
- `RISK-001`

## Defect this contract fixes

Bypass is one of the five policy subcontracts a maintainer configures. Setting
`bypass: { enabled: true, marker: "…" }` currently does nothing at all.

Verified: `resolveBypass` in `policy.mjs:313` returns `null` immediately unless
it is given a `grant`, and neither production runner ever passes one — a search
for `bypass` in `hook-runner.mjs` and `preflight-runner.mjs` finds only two
comment lines about the trust boundary. Verified: `evaluate` reads the grant
from `dependencies.bypass`, which no runner supplies, and the bypass ledger from
`dependencies.bypassLedger`, likewise. The whole path is reachable only from
tests.

So the switch is inert, and inert silently. A maintainer who enables it has every
reason to believe an escape hatch exists. There is no error, no warning, no
diagnostic — the next blocked commit simply stays blocked with no mention of the
bypass they configured.

This is why bypass was separated from `TB-051`. Coordination, delivery contracts
and runtime binding are capabilities nobody switched on, and documenting them
honestly is enough. Bypass is different in kind: **the maintainer has already
switched it on**, in their own configuration file, and the Gate accepted that
configuration without comment. A switch that looks connected and is not is worse
than a documented gap, because the maintainer has already made a decision on the
strength of it.

`FR-POL-006`, `FR-POL-007` and `FR-POL-008` all describe behaviour the runtime
does not have.

## Domain decisions this contract settles

**Wire it, or refuse it loudly. Not silence.**

The implementer chooses which, and the choice is theirs because it depends on
what the code shows once they are in it:

- **Wire it** if the remaining work is genuinely a wiring job — the runner
  accepts a grant, passes it and the ledger through, and `resolveBypass` does the
  rest. `FR-POL-006`'s requirements (one-shot, bound to the exact snapshot, a
  reason, any policy-required marker) are already implemented and must not be
  weakened to make wiring easier.
- **Refuse loudly** if it is not. A policy that enables a bypass the runtime
  cannot honour is a configuration the Gate should decline to run against, with
  a diagnostic naming what is missing — the same treatment any other
  unsupportable configuration gets.

What is not acceptable is leaving it as it is. If the implementer finds a third
answer that is better than both, they state it with evidence rather than
choosing it silently.

**A refusal must not become an accidental bypass.** If the chosen answer is to
refuse a policy with bypass enabled, that refusal denies. It must never allow a
commit that would otherwise have been blocked.

## Domain Concepts

Bypass grant, Bypass policy, One-shot authorization, Snapshot binding, Bypass
ledger, Commit marker, Bypassed outcome.

## Approach and Tradeoffs

Verified: `resolveBypass` already refuses without a grant, already preserves
failed and unverified checks rather than erasing them, and already produces the
visibly distinct `bypassed` outcome rather than `passed`. Whatever this slice
does, it must not weaken any of that.

Verified: `evaluate` already applies a bypass over a completed decision — it
never rewrites a check and never removes a failure. The safety shape is built;
what is missing is any caller.

Proposed — establish first, then choose. The implementer establishes what a
real grant would have to contain, where it would come from, and what the ledger
requires, before deciding between wiring and refusing. A wiring judgement made
without that is a guess.

Proposed — if wiring: the grant enters from outside, never from inside. A bypass
the Gate could construct for itself is not a bypass. The implementer states
where a grant comes from and confirms nothing in the evaluation path can
synthesise one.

Proposed — if refusing: refuse the configuration, not the commit's outcome. The
diagnostic names the bypass policy as unsupportable and the decision is
`unverified`, which denies. A maintainer must be able to reach a working state
by turning bypass off, and the diagnostic should say so.

Proposed — record it either way. `NFR-AUD-001` and `FR-POL-007` require a
bypass to persist machine-readable evidence. A refusal is equally worth
recording: a clone whose policy could not be honoured is a fact about that
clone. The implementer confirms whatever is recorded goes through the existing
Evidence and Lifecycle paths rather than a new one.

Deliberately not a new bypass mechanism, a wider grant, or a way to bypass more
than one snapshot. Deliberately not a change to what `resolveBypass` preserves,
to the `bypassed` outcome, or to the five-subcontract policy shape.

## Architecture Boundary and Public Seam

The boundary is between a policy a maintainer wrote and the behaviour the
runtime gives them. The public seam is the runner's handling of the configured
bypass policy — whether it accepts a grant and passes it, or refuses the
configuration — and the diagnostic it produces.

First red test: a clone whose policy enables bypass no longer behaves identically
to one whose policy disables it — where today the two are indistinguishable in
every observable respect.

## Safeguards and Invariants

- `SG-BYP-001`: a bypass never erases a failure. Failed and unverified checks are
  retained, the outcome is the visibly distinct `bypassed`, and evidence is
  persisted.
- `SG-TRUST-001`: nothing here implies the Gate resists the machine owner. A
  bypass is a supported, recorded escape hatch, not a hole.
- `SG-CFG-001`: a candidate snapshot must never weaken the policy that authorizes
  its own transition. Nothing in this slice lets a change enable its own bypass.
- `FR-POL-008`: a policy that disables bypass keeps behaving exactly as it does
  today, and that is the overwhelmingly common case.
- `NFR-AUD-001`: whatever this slice does is recorded through the existing
  Evidence and Lifecycle paths.
- A refusal denies. No path added here can turn a blocked commit into an allowed
  one.

## Prohibited Behavior and Non-goals

Do not weaken any requirement of `FR-POL-006` — one-shot, bound to the exact
snapshot, reason required, policy-required marker — to make wiring simpler. Do
not let the Gate construct its own grant. Do not let a bypass erase, rewrite, or
hide a failed or unverified check. Do not change the `bypassed` outcome or make
it resemble `passed`. Do not change the five-subcontract policy shape. Do not
touch coordination, delivery contracts, or runtime binding — `TB-051` owns those
and settles them as documentation. Do not leave the silent case in place under
any circumstance.

## Risk and Decision Impacts

- `RISK-001`: the accepted residual is a maintainer who knowingly bypasses a gate
  they activated. A maintainer who believes they configured a bypass and did not
  is outside that disposition — they are neither bypassing knowingly nor
  protected.
- No safeguard is withdrawn. `SG-BYP-001` is either enforced for the first time
  on a real path, or the configuration that would need it is refused.

## Acceptance Criteria

- [ ] `FR-POL-008`, `AC-CFG-001`: a clone whose policy enables bypass is
  observably different from one whose policy disables it — either a bypass is
  available, or the configuration is refused with a diagnostic naming why.
- [ ] `SG-BYP-001`, `AC-POL-002`: if a bypass is available, it is one-shot, bound
  to the exact snapshot, requires a reason and any policy-required marker,
  retains every failed and unverified check, and returns `bypassed` rather than
  `passed`.
- [ ] Nothing in the evaluation path can construct a grant for itself, proved by
  a fixture that supplies none and gets no bypass.
- [ ] If the configuration is refused, the refusal denies — proved by a fixture
  where a commit that would have been blocked is still blocked.
- [ ] `NFR-AUD-001`: whatever happens is recorded through the existing Evidence
  and Lifecycle paths, with no new event type, store, or log.
- [ ] `FR-POL-008`: a policy with bypass disabled behaves byte-for-byte as it
  does today, proved against the existing commit capabilities.
- [ ] The silent case is gone: no configuration enabling bypass produces a run
  indistinguishable from one that disabled it.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-POL-002`, `AC-CFG-001`, `SG-BYP-001`: enabled-and-disabled, no-self-granted-bypass, refusal-still-denies, five-subcontract-shape-unchanged, and preserved-failure fixtures against the real runner | `npm run test:unit` | Yes — the unit suite owns policy resolution and both runners |
| smoke | both | `FR-POL-008`, `NFR-AUD-001`: a real clone whose policy enables bypass behaves observably differently from one that disables it, and the Evidence store records what happened | `gate-security-control-smoke`, extended by this slice | Yes — that capability already owns bypass and policy-binding behaviour against a real store |

Frontend build and browser evidence are inapplicable; this slice changes local
policy handling.

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

Every bypass test supplies a grant, because a bypass without a grant is not a
bypass and there would be nothing to assert. So the suite proves thoroughly what
happens when a grant arrives and has never asked whether one can. The
configuration side is equally well covered — the policy shape is validated, the
disabled case is proved — and neither half ever meets the other.
