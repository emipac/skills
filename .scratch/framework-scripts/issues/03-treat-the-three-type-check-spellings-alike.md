# FS-003 — Treat the three type-check spellings alike

Status: ready-for-agent
Labels: ready-for-agent, defect
Blocked by: 02-name-every-script-the-setup-did-not-classify
Tracker ID: 03-treat-the-three-type-check-spellings-alike
Draft key: FS-003

**Status:** ready-for-agent

**Parent feature contract:** none. `framework-setup` owns deterministic project
discovery, and no feature contract governs which package-script names it accepts.
Everything below is stated so an implementer can work without one.

## Outcome

`typecheck:check`, `type-check:check`, and `types:check` all mean the same thing
to a project, so the setup treats them the same way. A maintainer does not have
to discover, by reading a table in someone else's source, which spelling of a
type check their project is allowed to use.

## Defect this contract fixes

`FS-002` added `types` as a recognised base name and gave it `check` as an
allowed qualifier. That left three spellings of one concept behaving in two
different ways.

Verified in `configure.mjs`'s `safeQualifiers`:

```
format      check, server, backend, client, frontend
lint        check, server, backend, client, frontend
typecheck          server, backend, client, frontend
type-check         server, backend, client, frontend
types       check, server, backend, client, frontend
```

So today `types:check` is classified as a type check, and `typecheck:check` and
`type-check:check` are declined for an unsafe qualifier. Three names for the
same operation; one of them accepts the suffix people actually write.

The original omission is defensible in isolation. For `format` and `lint` the
bare script mutates — `npm run format` rewrites files — so `:check` exists to
name the read-only variant and had to be allowed. A type check never rewrites
anything, so `:check` reads as redundant. It is not redundant in practice: it is
how projects mark the variant a pipeline runs, and a real project reached this
by naming its script `types:check`.

The consequence is smaller than it was before `FS-002` — a declined script is now
named in the discovery output with `unsafe-qualifier: check`, so it is visible
rather than silent. What remains is that it still gates nothing, and the only
remedy is renaming a project script to match a table the maintainer cannot see.

## This changes behavior for existing projects

Stated plainly because it is the reason this is a separate contract rather than
part of `FS-002`.

A project that already declares `typecheck:check` or `type-check:check` gets a
check it did not have before. Nothing is removed and nothing is reclassified —
the change only ever accepts more — but a name that produced no command will
start producing one, and a maintainer who re-runs configuration will see a
command appear. That is the intended effect and it must be visible in the
release notes, not discovered.

## Approach and Tradeoffs

Verified: `unsafeQualifiers` is checked before `safeQualifiers`, so widening a
safe set cannot admit `watch`, `fix`, `dev`, `only`, `coverage`, or `write`.
Verified: `FS-002` left `addPackageCapability` keying the `typescript` capability
off a base-name list, and `verify-change` gates on that capability — so the
capability path is a second place these three names must agree.

Proposed — allow `check` on all three. `typecheck`, `type-check`, and `types`
get identical qualifier sets. The implementer confirms the capability list
carries all three too, so a project using any spelling is reported as having a
TypeScript capability rather than a lint one.

Proposed — one list, not three parallel ones. These names are the same concept in
at least two tables. The implementer states where the concept is defined and
makes each table read it, so a fourth spelling could not again be added to one
place and missed in another. If a single definition does not fit, say why and
what was done instead.

Proposed — prove the equivalence, not the addition. A test that asserts
`typecheck:check` classifies is weaker than one asserting all three spellings
produce the same category, the same scope, and the same capability from the same
fixture. The second would have failed before `FS-002` and after it; the first
only fails now.

Deliberately not a rename, a deprecation, or a preferred spelling. All three stay
valid. Deliberately not a widening of any other base name's qualifiers, and
deliberately not a new base name.

## Architecture Boundary and Public Seam

The boundary is between what a project calls its type check and what the setup
will accept as one. The public seam is the qualifier table and the capability
list that together decide it.

First red test: a fixture declaring `typecheck:check`, `type-check:check`, and
`types:check` produces the same category, scope, and capability for all three —
where today only the third is classified at all.

## Safeguards and Invariants

- Repeat runs stay byte-identical, and every discovered `AGENTS.md` stays
  byte-for-byte unchanged.
- No unsafe qualifier is admitted for any base name. `typecheck:watch`,
  `type-check:fix`, and `types:write` are still declined.
- No other base name's qualifier set changes.
- A project declaring none of these three names produces identical output to
  today.
- A declined script is still named in the discovery output, as `FS-002`
  established.

## Prohibited Behavior and Non-goals

Do not add a new base name. Do not widen the qualifiers of any base other than
these three. Do not admit any qualifier the unsafe list names. Do not deprecate,
rename, or prefer one spelling over another. Do not change how any script is
scoped, timed, or turned into a command beyond the classification itself. Do not
change the not-classified reporting `FS-002` added, except that these names stop
appearing in it.

## Acceptance Criteria

- [ ] A fixture declaring `typecheck:check`, `type-check:check`, and
  `types:check` classifies all three identically — same category, same scope,
  same capability.
- [ ] Each of the three still declines an unsafe qualifier, proved for at least
  `watch` and `fix`, and the declined script is still named in the discovery
  output with its reason.
- [ ] A project declaring a TypeScript check under any of the three spellings
  reports the TypeScript capability rather than a lint one.
- [ ] No other base name's accepted qualifiers change, proved by a fixture
  covering the bases this slice does not touch.
- [ ] Repeat discovery and repeat configuration are byte-identical.
- [ ] The behavior change is stated in a changeset: a project already declaring
  `typecheck:check` or `type-check:check` gains a check it did not have.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | three-spellings-equivalent, unsafe-qualifier-still-declined, capability-correct, other-bases-unchanged, and byte-identical-repeat fixtures against the real discovery | `npm run test:unit` | Yes — the unit suite owns `framework-setup` discovery |

Smoke, frontend build, and browser evidence are inapplicable; this slice changes
local project discovery and writes no new state.

## Blocked By

- `02-name-every-script-the-setup-did-not-classify` — that contract introduces
  the `types` base and the not-classified reporting this one builds on.

## Unresolved Assumptions

None.

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start.
- [x] The ticket fits one fresh implementation context.
- [x] User-facing and frontend evidence requirements are covered or explicitly inapplicable.

## Why existing coverage missed this

Each recognised name is covered by a fixture that declares that name, so every
spelling is proved to work in the way it was written to work. Nothing compares
two spellings of one concept against each other, so a table where they disagree
reads as correct from inside the suite.
