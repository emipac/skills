# TB-045 — Let a project declare the secrets Evidence must not keep

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 45-let-a-project-declare-the-secrets-evidence-must-not-keep
Draft key: TB-045

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A project can name the Sensitive runtime inputs its checks receive, that name
reaches the Activation receipt, and the redactor removes those values from
everything the Gate stores — so a check that prints a secret cannot write it
into permanent Evidence.

## SRS Traceability

- `FR-CFG-006`, `FR-LIFE-006`
- `AC-CFG-004`, `AC-EVID-001`
- `SG-SECRET-001`, `SG-OWNER-001`
- `NFR-SEC-003`, `NFR-AUD-001`
- `RISK-006`

## Defect this contract fixes

Value-based redaction is built, tested, and unreachable from any real clone.

Verified: `declaredSecrets(receipt, environment)` (`hook-runner.mjs:732`) reads
`receipt.runtimeInputs`, looks each name up in the environment the checks will
receive, and hands the values to `createRedactor({ secrets })` — the layer that
removes a *known value* wherever it appears, in any form, through
`secretForms`. Both runners open their store through this one path.

Verified: the receipt carries names only, exactly as `FR-CFG-006` requires —
`describeActivation` maps `request.runtimeInputs` to `input.name`
(`activation.mjs:1251`), with the comment "a receipt never carries one".

Verified: nothing in production ever puts anything in `request.runtimeInputs`.
`runtime_inputs` appears **zero times** in `configuration.mjs`, so schema v4 has
no surface that declares one; and the activation command added by `TB-042`
passes `runtimeInputs: []` as a literal (`operator-surface.mjs:859`). The only
callers that populate it are fixtures — `gate-activation-smoke.mjs:372`,
`gate-hook-conformance-smoke.mjs:334`, `gate-security-control-smoke.mjs:186` —
each supplying `APP_TOKEN` to a test that then proves redaction works.

So every real activation pins an empty list, `declaredSecrets` returns nothing,
and the redactor is constructed with no secrets at all. The secret-canary tests
pass because they inject the declaration the product cannot express.

**What is still protected, stated so this is not overclaimed.**
`BUILT_IN_PATTERNS` (`redaction.mjs:28`) runs regardless and catches
`SOMETHING_TOKEN=value`, bearer and basic authorization headers, credentials
inside URLs, and PEM private keys. The gap is narrower than "nothing is
redacted": it is that a declared secret's *value* is not removed when it appears
in a shape no pattern recognizes — a bare token in a stack trace, a key echoed
without its variable name, a password inside a message. `RISK-006` is precisely
"redaction misses a secret in command output", and its stated mitigation begins
with "allowlisted inputs", which is the half that does not exist.

This is the same shape as `TB-023`, `TB-024`, `TB-026`, `TB-031`, `TB-033`, and
`TB-044`: a component built, proved in isolation, and never reached by anything
a maintainer runs. `TB-044` fixed the closest instance — `configuration.mjs`
hard-coded `prerequisites: []`, so no clone could declare a prerequisite either.
This is the same hard-coded-empty defect one field over.

## Domain Concepts

Sensitive runtime input, Approved environment file, Activation receipt,
Declared secret, Redactor, Built-in pattern, Evidence envelope, Residual finding.

## Approach and Tradeoffs

Verified: `createRedactor({ secrets, patterns })` already accepts declared
secrets and project patterns, and `residualFindings` already exists to report a
value that survived. The redaction machinery needs nothing; what is missing is a
way for a project to say which names matter, and a path for that declaration to
reach activation.

Verified: `TB-044` faced the identical problem for `prerequisites` and solved it
by reading the field off the configured entry and projecting it onto the
descriptor, because `validateCommandDescriptor` rejects unknown fields. The
implementer reads that change first and follows its shape unless it does not
fit, rather than inventing a second way to carry a declaration from
configuration into evaluation.

Proposed — declare Sensitive input **names** in configuration, never values.
`FR-CFG-006` and `NFR-SEC-003` both require that a value never enters repository
configuration. A declaration names an environment variable the checks already
receive; the value is read at runtime from the environment and never written
anywhere. The implementer confirms no path can put a value into
`.agent-framework.yaml`, the receipt, an envelope, a blob, or an event.

Proposed — carry it through the existing activation request. `request.runtimeInputs`
is `{ name, source }` today and the receipt already stores names. The
implementer establishes what fills that request in a command-driven activation
and makes the configured declaration reach it, so `gate activate` pins the same
names a fixture does.

Proposed — prove it where it actually persists. A secret-canary fixture whose
check prints the value in a shape **no built-in pattern matches** must find no
raw value in any envelope, blob, decision, or event. A canary that prints
`TOKEN=value` proves the pattern layer, not this one, and would pass today.

Proposed — an undeclared name is not an error. A project that declares nothing
behaves exactly as it does now, with the pattern layer alone. This adds a
capability; it does not make configuration harder.

Deliberately not a secret store, a keychain, an injector, or an approval flow
for values. The Gate does not supply secrets to checks — it removes them from
what it keeps. Deliberately not host-path redaction: the preserved `gms`
evidence shows the maintainer's repository path appearing unredacted in stored
blobs through dependency-root symlinks, which is a real and separate gap that
this contract does not address and must not silently absorb.

## Architecture Boundary and Public Seam

The boundary is between what a project knows is sensitive and what the Gate
removes before it stores anything. Today nothing crosses it. The public seam is
the configured declaration, its path into `request.runtimeInputs`, and the
`secrets` the redactor is constructed with.

First red test: a check that prints a declared secret's value in a form no
built-in pattern matches leaves no raw value in the stored envelope or blob,
where today the value is stored verbatim.

## Safeguards and Invariants

- `SG-SECRET-001`: a Sensitive value never persists in committed configuration,
  Evidence, retained output, or Lifecycle events. Declaring a name must not
  create any path for a value to be written.
- `SG-OWNER-001`: Gate core gains no variable name, no tool name, and no stack
  branch. Which names are Sensitive is the project's declaration.
- `FR-CFG-006`, `FR-LIFE-006`: the receipt records names and sources only.
- `NFR-SEC-003`: declared values are redacted from captured output as well as
  from envelopes, blobs, decisions, and events.
- `AC-EVID-001`, `NFR-AUD-001`: redaction happens before persistence, so
  evidence identity is derived over already-redacted bytes and no envelope is
  rewritten afterwards.
- The evaluation runtime is otherwise unchanged: hooks, adapters, snapshots, and
  decisions behave exactly as they do today.

## Prohibited Behavior and Non-goals

Do not allow a Sensitive value in `.agent-framework.yaml`, a receipt, an
envelope, a blob, a decision, or an event — names and sources only. Do not build
a secret store, keychain integration, value injection, or an approval flow for
values. Do not weaken, reorder, or remove `BUILT_IN_PATTERNS`. Do not rewrite
any stored envelope. Do not make an undeclared project behave differently from
today. Do not address host-path redaction — that is a separate contract. Do not
change what the receipt pins beyond the names already specified.

## Risk and Decision Impacts

- `RISK-006`: the accepted mitigation for missed redaction begins with
  allowlisted inputs. That half has never existed in a real clone, so the
  disposition has been resting on the pattern layer alone.
- No authorization changes. Nothing here alters a decision, an outcome, or what
  a commit is allowed to do.

## Acceptance Criteria

- [ ] `AC-CFG-004`, `NFR-SEC-003`: a check that prints a declared secret's value
  in a form matching no built-in pattern leaves no raw value in any envelope,
  blob, decision, or event — proved by searching the stored bytes for the value.
- [ ] `FR-CFG-006`: the declared name and source reach the Activation receipt,
  and no value reaches configuration, the receipt, or any stored record — proved
  by searching each for the value.
- [ ] A clone activated through `gate activate` pins the declared names, so the
  capability is reachable without a fixture supplying it.
- [ ] `AC-EVID-001`: redaction happens before persistence, so an envelope's
  identity is derived over already-redacted bytes and two runs that printed the
  same declared value address one envelope — proved without rewriting any stored
  envelope.
- [ ] A project declaring nothing produces byte-identical behavior to today,
  proved against the existing commit and preflight capabilities.
- [ ] `SG-OWNER-001`: the diff adds no environment-variable name, tool name, or
  stack branch to Gate core, proved by inspection and stated in the report.
- [ ] A declared name absent from the environment at evaluation time is not an
  error and not a silent pass — the implementer states what it is and proves it.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-004`, `AC-EVID-001`: pattern-invisible canary, no-declaration, value-never-written, and missing-name fixtures against the real store and redactor | `npm run test:unit` | Yes — the unit suite owns redaction, the store, and both runners |
| smoke | both | `NFR-SEC-003`: a real activated clone whose check prints a declared value stores no raw value anywhere in its Evidence | `gate-security-control-smoke`, extended by this slice | Yes — that capability already owns secret-canary behavior against a real store |

Frontend build and browser evidence are inapplicable; this slice changes local
configuration and redaction.

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

The secret-canary fixtures construct `runtimeInputs` themselves and hand it
straight to activation, which is the only way to reach the code they are
testing. That proves the redactor and proves the receipt stores names — and it
structurally cannot ask whether any project could produce that input. Every test
that looks at this supplies the one thing that is missing, so the gap is
invisible from inside the suite.
