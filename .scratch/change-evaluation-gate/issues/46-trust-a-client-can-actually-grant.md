# TB-046 — Trust a client can actually grant

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 46-trust-a-client-can-actually-grant
Draft key: TB-046

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Every declared adapter can be activated. An adapter's trust model names
something the Gate can establish, the contract says what each model means, and
no adapter can declare a model that nothing defines and nothing proves.

## SRS Traceability

- `FR-LIFE-004`, `FR-LIFE-016`, `FR-ADAPT-008`
- `AC-LIFE-002`, `AC-LIFE-009`, `AC-ADAPT-003`
- `SG-HOOK-001`, `SG-TRUST-001`, `SG-OWNER-001`
- `NFR-COMP-001`
- `RISK-004`

## Defect this contract fixes

A maintainer activating Cursor on a real clone reached `trust-pending` and
could not get past it. Nothing was wrong with the clone: the transaction was
waiting for a grant no surface can issue.

Verified: `explicit-workspace-grant` appears in exactly four places
repository-wide — the declaration in `adapters.mjs`, the dispatch added by
`TB-042` in `activation-seams.mjs`, `TB-042`'s ticket, and a test. **No contract
document defines it.** The adapter conformance contract requires every adapter
to declare `trust: { model, failureIsUnverified }` and never states what a model
is, what proves one, or which values exist. An undefined value therefore passed
every review this project has.

Verified, and this is the part that makes it unfixable rather than merely
undeclared: all three desktop adapters register into a project-local file **the
Gate itself writes** —

| Adapter | Registration file | Declared model |
| --- | --- | --- |
| `claude-code-desktop` | `.claude/settings.local.json` | `explicit-workspace-grant` |
| `codex-desktop` | `.codex/hooks.json` | `explicit-project-grant` |
| `cursor` | `.cursor/hooks.json` | `explicit-workspace-grant` |

Trust is step 5 of `ACTIVATION_STEPS`; adapter registration happens after it. So
for every one of these, a client-side review of the registration can only occur
*after* the write that the trust step is blocking. The grant is a consequence of
registration, not a precondition of it.

Verified against the research these declarations came from
(`.scratch/change-evaluation-gate/research/cross-client-hook-and-install-capabilities.md`):
Codex has a real mechanism — non-managed command hooks are skipped until the
exact definition hash is reviewed and trusted — but it fires when Codex reads
the hooks file, which is after the Gate wrote it. Claude Code is documented as
having *no* Codex-style per-definition trust flow. Cursor documents project and
user hook configuration and plugin marketplace review; the framework installs
Agent Skills rather than a Cursor plugin, so no marketplace review applies, and
nothing describes a per-workspace grant a process could read.

The result is that two of the three desktop surfaces are permanently
unactivatable, and the third would be for the same reason. A pause that nothing
can clear is a refusal that does not say so.

## Domain decisions this contract settles

**v1 has one trust model, and it is the one the Gate can establish.**

An adapter is trusted when the maintainer gave repository-bound consent to a
preview naming the exact surface the Gate will register, and the Gate registered
only a surface it owns. That is what authoritative Git already declares —
`repository-hook-registration` — and it is the only thing true of every v1
adapter. All four adapters collapse to it.

**A client review is recorded, never awaited.** Where a client reviews the
registration afterwards, as Codex does, the transaction states that as a fact
about what happens next. It does not wait, because waiting for it can never
succeed.

**The pause stays in the transaction.** `FR-LIFE-016` requires the capability,
and a future client may genuinely grant before registration. What must stop is
wiring an adapter to a pause its client cannot clear.

This was amended into the SRS as revision `0.2.7`, which is the decision source
for this contract.

## Domain Concepts

Trust model, Declared grant, Repository-bound consent, Registration surface,
Adapter conformance, Post-registration review, Paused transaction.

## Approach and Tradeoffs

Verified: `createTrustEstablishment` in `activation-seams.mjs` already dispatches
on `describeAdapter(client.id).capabilities.trust.model`, already satisfies
`repository-hook-registration` from the consent, and already refuses an
unrecognized model rather than granting it. The dispatch is correct; the values
it dispatches on are not.

Proposed — change the declarations, not the dispatch. Three adapters adopt the
model Git declares. The implementer confirms `TB-042`'s test that iterates every
`ADAPTER_IDS` entry and asserts its model is in the dispatch table still passes,
and that the unrecognized-model refusal is unchanged.

Proposed — define the models where adapters are declared. The adapter
conformance contract gains, for each model that exists, what it asserts and what
proves it. The implementer states what a future model would have to supply to be
addable, so the next one is grounded before it ships.

Proposed — make the class un-repeatable. A declared model that the contract does
not define, or that nothing can prove, fails a test. This is the criterion that
would have caught the original defect at declaration time, and it matters more
than the three-line declaration change.

Proposed — record the post-registration review. Where a client reviews the
registration it was given, the receipt or the transaction's own report says so
in terms a maintainer can act on, so "activated" is not read as "this client is
already running it". The implementer decides where that belongs and states why.

Deliberately not a client API integration, a keychain, a credential, or a new
consent mechanism. Deliberately not a change to `ACTIVATION_STEPS`, their order,
or `git-enablement` staying last. Deliberately not a relaxation of what
registration may write.

## Architecture Boundary and Public Seam

The boundary is between what an adapter declares about trust and what any
surface can actually establish. The public seam is each adapter's declared
`trust.model`, the contract that defines the permitted values, and the
conformance check that refuses one nothing defines.

First red test: activating the `cursor` adapter on a configured fixture clone
completes and registers its declared surface, where today it pauses at
`trust-pending` with no way forward.

## Safeguards and Invariants

- `SG-HOOK-001`: registration still never overwrites an existing hook, never
  alters a shared or global hooks path, never rewrites part of a client
  configuration file the adapter does not own, and still refuses a shape it
  cannot confirm. Nothing here widens what may be written.
- `SG-TRUST-001`: the Gate states what it established and claims nothing about a
  client's own review. Activating an adapter is not a claim that the client has
  accepted the registration.
- `SG-OWNER-001`: Gate core gains no client name and no client-specific branch;
  trust models stay declared data in the adapter layer.
- `FR-LIFE-016`: the pause and resumption path stays intact, with its identity
  checks unchanged.
- `NFR-COMP-001`: every adapter still passes the shared client baseline,
  including the trust-failure case that must produce `unverified`.
- `AC-LIFE-002`: a failed activation still leaves the clone configured with no
  receipt and no registration.

## Prohibited Behavior and Non-goals

Do not integrate with any client API, keychain, credential store, or marketplace.
Do not add a new consent mechanism. Do not change `ACTIVATION_STEPS`, their
order, or `git-enablement` remaining last. Do not remove the `trust-pending`
suspend-and-resume path or weaken its identity checks. Do not widen what
registration may write, or relax the incompatible-shape refusal. Do not make an
unrecognized trust model grant trust — it stays a refusal. Do not change what
`failureIsUnverified` means or what a trust failure produces.

## Risk and Decision Impacts

- `RISK-004`: client hook and trust behavior changes independently of this
  project, which is exactly why a declared model must name something provable
  and why an undeclared one must fail rather than pause.
- `SG-TRUST-001` is unchanged in substance: the Gate was never able to verify a
  client-side grant, and now stops implying it did.

## Acceptance Criteria

- [ ] `AC-LIFE-009`, `FR-LIFE-004`: activating each declared adapter on a
  configured fixture clone completes, registers exactly its declared surface,
  and writes a receipt — where `cursor` and `claude-code-desktop` cannot
  complete today.
- [ ] `AC-ADAPT-003`, `FR-ADAPT-008`: every declared trust model is defined by
  the adapter conformance contract, and a declared model the contract does not
  define fails a test.
- [ ] An unrecognized trust model is still refused rather than granted, and is
  refused rather than paused.
- [ ] `AC-LIFE-002`: an activation that fails after trust still leaves the clone
  configured with no receipt and no registration, proved for a desktop adapter
  as well as for authoritative Git.
- [ ] `FR-LIFE-016`: the pause and resumption path still works for an adapter
  whose grant is pending, proved with an injected reader, and still refuses a
  resumption naming changed identities.
- [ ] `SG-HOOK-001`: a client configuration file whose shape the adapter cannot
  confirm is still reported `unverified` and left byte-for-byte unchanged.
- [ ] `SG-TRUST-001`: nothing the transaction reports claims a client has
  accepted a registration the Gate only wrote.
- [ ] `NFR-COMP-001`: the shared client baseline still passes for every surface,
  including the trust-failure case.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-LIFE-009`, `AC-ADAPT-003`: per-adapter activation, undefined-model, unrecognized-model, and pause-and-resume fixtures against the real transaction | `npm run test:unit` | Yes — the unit suite owns activation and the adapter declarations |
| smoke | both | `AC-LIFE-002`, `FR-LIFE-004`: a real configured clone activated through the packaged command for a desktop adapter registers its declared surface and writes a receipt | `gate-activation-smoke` and `gate-adapter-conformance`, extended by this slice | Yes — those capabilities own real activation and the shared client baseline |

Frontend build and browser evidence are inapplicable; this slice changes local
adapter declarations and their contract.

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

Every activation fixture injects its own trust implementation, so the declared
model has never selected anything — the tests supply the answer the declaration
was supposed to provide. The adapter conformance baseline checks that a *revoked*
grant produces `unverified`, which exercises refusal and says nothing about
whether a grant can be obtained at all. So the one question that mattered — can
any surface issue this grant — is the one nothing asks.
