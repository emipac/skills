# TB-022 — Generate migration mapping and Gate policy drafts from proved project facts

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, usability
Blocked by:
Tracker ID: 22-generate-migration-mapping-and-gate-policy-drafts
Draft key: TB-022

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer can ask the tooling for a `mapping.json` and a `policy.json` draft
derived from their own project, rather than hand-authoring both from
documentation and provider source. Each draft is a starting point the existing
preview-and-confirm flow still gates; neither is written into
`.agent-framework.yaml` and neither skips a confirmation.

## SRS Traceability

- `FR-CFG-003`, `FR-CFG-004`, `FR-PROF-010`
- `AC-CFG-002`
- `SG-CMD-001`, `SG-OWNER-001`

## Defect this contract fixes

Both files that a maintainer must author by hand are authorable only by reading
implementation source, and both have a documented trap that exists purely
because no tool emits the file.

**`mapping.json`.** `--migrate-v4` already reports exactly which paths it
cannot prove, as an `ambiguities` array of `{ path, value, required }`. The
mapping file the maintainer must then write is keyed by those same paths — but
inverted: the report names the field that is *missing*, the mapping supplies
it. Real users paste the report back as the mapping and hit
`Unsupported migration mapping section: status`, because the report's own
envelope keys (`status`, `fromVersion`, `previewHash`, `ambiguities`) are not
mapping sections. `docs/framework-guide.html` carries a critical callout
warning against this specific move. The warning exists because the tool that
knows the answer does not emit it.

**`policy.json`.** Check identities are `stage.slug` strings owned by the
matching provider — `format.formatter`, `static-analysis.application`,
`broad-tests.test` and so on, enumerated in
`skills/change-evaluation-gate/scripts/lib/providers/laravel.mjs` and
`providers/node-package.mjs`. Nothing surfaces that list. Worse, the validator
in `skills/change-evaluation-gate/scripts/lib/policy.mjs` accepts any non-empty
string:

```js
const isCheckIdentity = (value) => typeof value === 'string' && value.length > 0;
```

So a wrong identity configures cleanly and only manifests at evaluation, as a
check that silently is not the one the maintainer meant. Three separate
vocabularies compound this: ladder stages (`static-analysis`), command
categories (`static_analysis`), and check identities
(`static-analysis.application`) differ in both wording and punctuation, and
only the third is valid here.

**Templates are not the fix.** A static template reproduces the five-key
skeleton the guide already prints and answers neither question. The values a
maintainer cannot supply are exactly the ones the framework already proves:
which paths are ambiguous, which provider matches, which capabilities that
provider resolved. Drafts must be *derived*, not templated.

## Domain Concepts

Migration mapping, Gate policy subcontract, Check descriptor, Provider,
Capability, Verification profile.

## Approach and Tradeoffs

Add two read-only draft emitters to
`skills/framework-setup/scripts/configure.mjs`, alongside the existing modes:

1. `--draft-mapping` runs the same discovery `--migrate-v4` runs, then emits a
   mapping document pre-keyed with every reported ambiguity, each carrying the
   field the report said was missing and a `null` placeholder value. The output
   is a valid mapping skeleton the maintainer fills in, so the inversion cannot
   be got wrong — the keys are already correct.
2. `--draft-policy` resolves the provider that matches the project, enumerates
   its check plan, and emits all five subcontracts with `checks.required` and
   `checks.advisory` populated from each descriptor's own declared default
   binding.

Emit a `null` rather than a guessed value wherever the framework has not proved
one. `null` is visibly unfilled; a plausible default is a guess wearing the
costume of a proved fact, and this framework's whole premise is that those are
different. A draft containing `null` must not be accepted by the existing
`--mapping` / `--policy` readers.

Derive the policy draft's identities by resolving descriptors through the
existing provider seam, never by re-listing them in `framework-setup`. A
hard-coded second copy of the check catalogue would drift from the providers,
which is the failure mode `TB-021` and `TB-019` each closed elsewhere.

Do not fold these into `--discover`. Drafting is a distinct request with a
distinct output, and overloading discovery would make an ordinary read emit
files the caller did not ask for.

## Architecture Boundary and Public Seam

The boundary is draft emission inside `configure.mjs`, upstream of every
existing write path. The public seam is the two new CLI modes and their emitted
document shapes. First red test: a project whose migration reports two
ambiguities produces a `--draft-mapping` document whose `commands` keys are
exactly those two paths, and feeding that document back — with its `null`s
replaced — reaches `"status": "ready"` without a single `Unsupported migration
mapping section` error.

## Safeguards and Invariants

- `SG-CMD-001`: drafting never resolves, executes, or invents a command. The
  mapping draft carries only the field names the ambiguity report already
  named.
- `SG-OWNER-001`: the policy draft reads identities through the provider
  contract. `framework-setup` never learns which stack produced them and never
  keeps its own copy of the catalogue.
- Drafting writes nothing to `.agent-framework.yaml`, creates no hook, receipt,
  or trust decision, and does not make the Gate configured. It is a read plus a
  document on stdout.
- A draft is never self-confirming: it carries no `previewHash`, and the
  existing preview-and-confirm flow is unchanged.

## Prohibited Behavior and Non-goals

Do not auto-write `mapping.json` or `policy.json` to disk unless an explicit
`--out <path>` is given, and refuse rather than overwrite an existing file. Do
not chain drafting into migration or Gate configuration. Do not invent a
default `timeout_seconds`, budget, or bypass marker. Do not add a new provider.
Do not widen the accepted policy grammar — this ticket makes the right values
discoverable, it does not change which values are legal.

## Risk and Decision Impacts

- No parent risk disposition changes. This adds a read-only convenience over
  contracts `TB-001`, `TB-002`, and `TB-003` already settled.
- `Q-004` is unaffected: drafting proves nothing about support tiers.

## Acceptance Criteria

- [x] `AC-CFG-002`, `SG-CMD-001`: `--draft-mapping` on a project with a known
  set of ambiguities emits a document whose `commands` keys are exactly those
  ambiguity paths, containing exactly the fields each ambiguity's `required`
  array named, with `null` values; the document contains no `status`,
  `fromVersion`, `previewHash`, or `ambiguities` key; and once its `null`s are
  replaced it is accepted by `--migrate-v4 --mapping` and reaches
  `"status": "ready"`.
- [x] `FR-PROF-010`, `SG-OWNER-001`: `--draft-policy` emits all five
  subcontracts, with `checks.required` and `checks.advisory` derived from the
  matching provider's declared per-check default binding and partitioned
  without overlap; the emitted document passes `validateGatePolicy` with zero
  issues; and the identities are obtained through the provider seam rather than
  a catalogue restated in `framework-setup`.
- [x] `SG-CMD-001`: neither draft mode writes `.agent-framework.yaml`, and a
  draft still containing `null` is refused by the corresponding reader rather
  than accepted with a guessed value.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-002`, `FR-PROF-010`, `SG-OWNER-001`: draft shapes for a Laravel and a Node fixture, the ambiguity-to-key mapping, provider-derived bindings, and refusal of `null`-bearing drafts | `npm run test:unit` | Yes — configured unit suite owns the configure seam |
| smoke | both | `AC-CFG-002`: a full round trip — draft the mapping, fill it, migrate, draft the policy, configure the Gate — against a fixture project, ending `configured: true` with no hand-written JSON | `gate-activation-smoke` capability extended by this slice | Yes — the round trip is the behaviour, and no existing selector covers it |

Frontend build and browser evidence are inapplicable; this slice emits
configuration documents, not a frontend surface.

## Blocked By

None. `TB-001` (migration), `TB-002` (Gate policy configuration), and `TB-003`
(provider check descriptors) are all done.

`TB-021` is independent and does not block this. Drafting emits documents for
the writers' input; `TB-021` fixes the reader that consumes the writers'
output. Landing this one first is reasonable, but note that a project drafted,
migrated, and configured through this ticket still cannot activate until
`TB-021` lands.

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

Nothing missed a defect here — no test asserts that a maintainer can *discover*
what to write. Every existing test for migration and Gate configuration
supplies its mapping and policy fixtures inline, already correct, because the
test author had the source open. That is the same shape of blind spot
`TB-017` through `TB-021` each found: the fixture supplied the exact thing the
real user could not.
