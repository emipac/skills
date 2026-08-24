# TB-042 — Activate a clone from a command

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by: 40-let-a-maintainer-and-an-agent-observe-the-gate
Tracker ID: 42-activate-a-clone-from-a-command
Draft key: TB-042

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer, or an agent acting for one, can activate an already-configured
clone by running a command: one invocation shows the exact preview, a second
confirms that preview, and the transaction runs unchanged. The receipt records
what the Gate can prove about that consent and claims nothing more.

## SRS Traceability

- `FR-LIFE-004`, `FR-LIFE-005`, `FR-LIFE-006`, `FR-LIFE-016`
- `AC-LIFE-002`, `AC-LIFE-008`, `AC-LIFE-009`
- `SG-LIFE-001`, `SG-HOOK-001`, `SG-TRUST-001`
- `NFR-REL-002`, `NFR-AUD-001`
- `RISK-001`

## Defect this contract fixes

Activation has no entrypoint. Verified: `activate()` appears repository-wide
only in `tests/` and at `gate-activation-smoke.mjs:432`. Verified: the sole
`bin` entry is `change-evaluation-gate-precommit`. A clone therefore becomes
activated only when somebody writes a throwaway script that imports
`activation.mjs` and reconstructs its argument shapes from the test suite —
which is how the one activated clone this project has was produced.

That is worse than an inconvenience. Activation is the transaction that
establishes trust, composes a hook chain, self-tests the runtime, and pins the
receipt every later commit reads. Reaching it through improvised scripts means
the highest-consequence operation in the system is the one least likely to be
run the same way twice, and the one whose real path is exercised only by
fixtures.

Verified: three dependencies of `runActivation` are destructured with no
defaults — `establishTrust`, `selfTestEvaluation`, `selfTestAdapter`
(`activation.mjs:1505-1509`) — while every other seam has a real default. A
command surface must supply all three.

## Domain Concepts

Activation transaction, Preview, Repository-bound consent, Client-controlled
trust, Trust model, Activation receipt, Resumption, Self-test.

## Domain decisions this contract settles

**Trust for an authoritative Git activation is satisfied by repository-bound
consent, and the receipt records only what can be proved.**

Verified: each adapter declares its own trust model — `git` declares
`repository-hook-registration`, `cursor` and `claude-code-desktop` declare
`explicit-workspace-grant`, `codex-desktop` declares `explicit-project-grant`
(`adapters.mjs`). Verified: the Git adapter's own comment states that its
registration surface is the clone's hook chain rather than a client
configuration file, so there is no client prompt to answer. Verified: all four
declare `failureIsUnverified: true`, and the conformance baseline asserts a
revoked grant yields `unverified` with `family: 'trust'`
(`adapters.mjs:1205-1218`).

So `establishTrust` does not invent policy: it dispatches on the declared
model. For a desktop model it asks the client and returns `pending` when the
operator has not granted yet — the existing pause and resumption path. For
Git's model, the repository-bound consent this command already requires is the
grant.

**What the receipt may claim.** A command surface cannot distinguish a human
typing a confirmation from an agent invoking the command twice. Recording an
operator as the grantor would be an unverifiable claim inside the receipt hash
that every later commit reads. The receipt therefore records the fact that is
provable — that a confirmation reproducing this exact preview arrived in a
separate invocation — and any human-supplied actor is carried as self-declared,
never as proven.

## Approach and Tradeoffs

Verified: the transaction already enforces repository-bound consent at step 3
(`activation.mjs:1641-1662`): a missing consent fails `consent-missing`, a
consent naming a different preview fails `consent-preview-mismatch`, and a
consent whose repository or configuration identity differs fails
`consent-identity-mismatch`. Verified: the consent object the smoke builds
carries `previewId`, `repositoryIdentity`, `configurationIdentity`, `actor`, and
`grantedAt` (`gate-activation-smoke.mjs:425-431`). The identity binding this
slice needs already exists and is proved.

Verified: `previewActivation` returns a `previewId` derived from the preview
body by `contentIdentity`, and that body already includes the hooks, resolved
commands, adapters, dependency roots, runtime input names, and
`trust: { client, required: true }` (`activation.mjs:1270-1291`). A preview is
already showable and already addressable; nothing new must be computed to let a
maintainer read one.

Proposed — two invocations, never one, on the surface `TB-040` establishes.
The first previews and writes nothing; the second carries the preview
identifier and runs the transaction. The implementer confirms a single
invocation that both previews and activates is refused, and that the second
invocation recomputes the preview rather than trusting a value handed to it —
the rule `TB-036` established for every other confirmed operation.

Proposed — one `establishTrust` that reads the declared model. It resolves the
selected adapter's `capabilities.trust.model` and satisfies it: consent for
Git's model, the client's own grant for a desktop model, `pending` when a
desktop client has not granted. The implementer confirms every declared model in
the registry is handled and that an unrecognized model is refused rather than
treated as granted.

Proposed — real self-tests, not stubs. `selfTestHookProgram` already defaults to
an implementation that executes the registered program against a change it must
deny. `selfTestEvaluation` and `selfTestAdapter` get implementations of the same
character: they must establish that the thing answered, not merely that it
exited. `TB-035` established the shape — proof that the subject was read, not an
exit status. The implementer confirms a stub that always reports success fails
the fixtures added here.

Proposed — surface the pause rather than resolving it. A desktop adapter that
returns `pending` leaves the clone untouched and the command reports what must
be granted and how to resume. The resumption identities the transaction records
are what a resume invocation must reproduce; nothing here relaxes them.

Deliberately not a new consent mechanism, a credential, a keychain entry, or an
identity provider. Deliberately not activation without configuration: a clone
that is not configured is refused, not configured on the way past.

## Architecture Boundary and Public Seam

The boundary is between an operator's decision to activate and the transaction
that performs it — today crossed only by improvised scripts. The public seam is
the activation command's two invocations, the consent it constructs from the
preview, and the three dependency implementations it supplies to
`runActivation`.

First red test: activating a configured fixture clone through the command
produces a receipt whose trust record names the consent that was actually
verified, and a commit against that clone is then evaluated authoritatively —
where today no command can activate anything.

## Safeguards and Invariants

- `SG-TRUST-001`: the receipt records only provable consent, and neither the
  command nor its output implies the Gate resists the machine owner or knows who
  was at the keyboard.
- `SG-LIFE-001`: a failed activation leaves the clone configured with no receipt
  and no registration, or reports `recovery-required` naming what remains —
  exactly as `TB-035` established. This slice adds no new failure handling.
- `SG-HOOK-001`: activation never overwrites an existing hook, never silently
  alters a shared or global hooks path, never rewrites part of a client
  configuration file the adapter does not own, and never resumes against changed
  identities.
- `FR-LIFE-016`: a paused transaction leaves no gate integration active and
  resumes only with the same repository, configuration, adapter, and preview
  identities.
- `NFR-REL-002`: the receipt is published by one atomic rename and confirmed
  before authoritative Git is enabled; `git-enablement` stays last.
- `NFR-AUD-001`: the activation is recorded by the Lifecycle event the
  transaction already appends.
- `ACTIVATION_STEPS` and their order are unchanged, and the evaluation runtime —
  hooks, adapters, snapshots, decisions — behaves exactly as it does today.

## Prohibited Behavior and Non-goals

Do not change `ACTIVATION_STEPS`, their order, or `git-enablement` remaining
last. Do not change `activate`, `runActivation`, or the transaction's failure
and rollback reporting. Do not add a flag that previews and activates in one
invocation, and do not add any bypass of the consent identity checks. Do not
record an operator identity as proven. Do not implement `repair`, `update`,
`deactivate`, `uninstall`, `cleanup`, or `fix` — other contracts own them. Do
not configure a repository, migrate a schema, or write
`.agent-framework.yaml`. Do not weaken any trust model to make a clone
activate.

## Risk and Decision Impacts

- `RISK-001`: the accepted residual is a maintainer who knowingly bypasses a
  gate they activated. A reachable, repeatable activation narrows the unknowing
  case, which the disposition does not cover.
- `SG-TRUST-001` is unchanged: exposing activation to a command does not alter a
  boundary that was already cooperative, and the receipt is more honest about
  what it knows than an improvised script's would be.

## Acceptance Criteria

- [ ] `AC-LIFE-002`, `FR-LIFE-004`: activating a configured fixture clone
  through the command runs every step in the settled order, enables Git last,
  and produces a clone whose commits are evaluated authoritatively.
- [ ] `AC-LIFE-008`: a confirmation naming a different preview, or one presented
  against a changed repository or configuration identity, performs no mutation
  and returns a stated refusal; an exact match proceeds.
- [ ] `FR-LIFE-006`, `SG-TRUST-001`: the receipt's trust record names the
  consent mechanism that was verified; any supplied actor is marked
  self-declared, and no field asserts a human the command could not observe.
- [ ] `AC-LIFE-009`, `FR-LIFE-016`: a desktop adapter whose client has not
  granted trust pauses, leaves no gate integration active, and resumes only with
  the identities it recorded.
- [ ] A single invocation that would preview and activate together is refused,
  and says which two invocations to run instead.
- [ ] A stubbed self-test that reports success without the subject answering
  fails the fixtures, so the supplied implementations cannot be hollow.
- [ ] `SG-LIFE-001`: a clone whose activation fails at any step commits exactly
  as it did while configured, or reports `recovery-required` naming what remains.
- [ ] The evaluation runtime is unchanged, proved by the existing commit and
  preflight capabilities passing untouched.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-LIFE-008`, `AC-LIFE-009`: consent-mismatch, changed-identity, single-invocation-refusal, trust-model-dispatch, pending-and-resume, and hollow-self-test fixtures against the real command | `npm run test:unit` | Yes — the unit suite owns the activation transaction |
| smoke | both | `AC-LIFE-002`: a real configured throwaway clone activated through the packaged command evaluates a real commit authoritatively, and a failed activation leaves it committing as it did while configured | `gate-activation-smoke`, extended by this slice | Yes — that capability already drives real activations and real commits |

Frontend build and browser evidence are inapplicable; this slice adds a local
command-line surface over an existing transaction.

## Blocked By

- `40-let-a-maintainer-and-an-agent-observe-the-gate` — the command surface, its
  two renderings, and its exit statuses are established there and are not
  redesigned here.

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

Every activation fixture builds its own consent object in the same function
scope as the preview it came from, and injects its own trust and self-test
implementations. That proves the transaction, and it structurally cannot ask
whether a consent could survive a round trip through a shell, whether a real
trust implementation exists at all, or whether the self-tests a real activation
would use are anything more than the fixtures' stubs. The three seams with no
defaults are precisely the three the tests always supply.
