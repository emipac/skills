# TB-057 — Provide each dependency root the way it needs

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by: TB-054
Tracker ID: 57-provide-each-dependency-root-the-way-it-needs
Draft key: TB-057

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A project pays to copy only the dependency roots whose tools resolve realpaths,
and links the rest. A maintainer whose largest dependency tree needs no copy
does not copy it on every evaluation to fix a tool that never reads it.

## SRS Traceability

- `FR-EVAL-004`, `FR-CFG-002`
- `AC-EVAL-001`, `AC-CFG-001`
- `SG-EVAL-001`, `NFR-SEC-001`
- `NFR-REL-001`, `NFR-OPER-001`, `NFR-PORT-002`
- `RISK-003`

## Defect this contract fixes

`TB-054` made `dependency_provisioning` a single scalar applied to every
declared root, and said why: a scalar is the smaller provable step, and a list
form can extend it later without breaking it. This is that extension, with the
measurement that justifies it.

### What a real project provides

Verified on the project `TB-054` was found on, counting files per declared
root:

| Root | Files | Needed as a real directory by |
| --- | --- | --- |
| `node_modules` | 49,120 | **nothing** |
| `vendor` | 33,972 | Pest (PHP resolves `__DIR__` to realpath) |
| `resources/js/actions`, `routes`, `wayfinder` | 107 | ESLint (`import/order` classifies by resolved location) |

**83,199 files provided by copy; 49,120 of them buy nothing.**

The last column is measured, not inferred. The snapshot was rebuilt by hand
with `node_modules` **symlinked** and only the three generated roots copied,
and the project's ESLint run gave exit 0 with zero bytes of output — the same
result as copying everything. Pest's need for `vendor` was proved in `TB-054`.

### Why it matters after `TB-055`

`TB-055` makes a copy cheap on filesystems that can clone. It does not make it
free: cloning is still a directory traversal, measured at 6.5 seconds per
34,000 files on APFS, and on ext4 or NTFS it is a full byte copy regardless.
A per-root declaration removes the largest tree from that cost on every
platform. The two contracts compound rather than compete.

### The cost today

Reported by the maintainer: a preflight under `copy` took roughly one minute,
against a suite that runs in about two seconds by hand. `TB-054` measured
providing `vendor` alone at 9.9 seconds; `node_modules` is 1.4 times larger by
file count. A preflight fires on every agent turn.

## Domain decisions this contract settles

**One declaration, two shapes.** `dependency_provisioning` keeps accepting the
scalar `TB-054` defined, and additionally accepts a map from declared root to
strategy. A scalar applies to every root, as today. A map names a strategy per
root, and a root the map does not name is provided by `link` — the default
`TB-054` chose, for the same reason: an undeclared thing behaves as it always
has.

**A map may only name declared roots.** A key that is not in `dependency_roots`
is a configuration error with a diagnostic naming it, not a silent no-op. A
declaration that names a root nothing declared is the class of silent
misconfiguration `TB-049` and `TB-052` exist to end.

**No inference.** The Gate does not decide which roots need a copy by looking
at what is inside them. A maintainer says so, once, and the reason is in their
configuration where the next maintainer can read it.

## Domain Concepts

Dependency root, Provisioning strategy, Per-root declaration, Default
strategy, Execution root.

## Approach and Tradeoffs

Verified: `TB-054`'s `provideDependencyRoots` already iterates declared roots
one at a time and already takes `provisioning` as an argument. Applying a
strategy per root is a change to what is looked up per iteration, not to the
loop.

Verified: `TB-054` records `provisioning` once per evaluation in
`environment.dependencies`. With per-root strategies that becomes a fact per
root, and the implementer establishes how the recorded shape carries it
without breaking a reader of the scalar form.

Proposed — validate the map beside the scalar. `policy.mjs` already rejects an
unknown strategy at `evaluation_gate.execution.dependency_provisioning`; the
map form is validated at the same path, with each value held to the same two
strategies and each key held to `dependency_roots`.

Proposed — preview and receipt say what each root gets. `TB-054` renders
`dependency roots: … (provided by copy)`. With a map that line names each
root's strategy, so the consent a maintainer grants is to the mixed
provisioning they declared, not to a summary of it.

Proposed — establish the interaction with `TB-056` before assuming it. That
contract re-bases a pinned executable under a root *provided by copy*. Under a
map, `vendor` may be copied while `node_modules` is linked in the same
evaluation. The implementer confirms re-basing consults the strategy the root
actually received, not a per-evaluation scalar, and states which contract
lands first and what the other must adapt to.

Proposed — prove the saving, not just the correctness. A fixture with two
declared roots, one mapped `copy` and one unmapped, provides one by copy and
one by link and records both. The project measurement above is the motivating
number; the fixture is the property.

Deliberately not changing what `link` or `copy` do, not adding a third
strategy, not inferring a strategy from a root's contents, and not changing
`dependency_roots`. Deliberately not `TB-055`'s cloning or `TB-058`'s sweep.

## Architecture Boundary and Public Seam

The boundary is between one declaration for every root and one declaration for
each. The public seam is `evaluation_gate.execution.dependency_provisioning`,
its validation, and the per-root strategy the preview, receipt, and evidence
carry.

First red test: a configuration declaring a map is accepted and provisions each
root by its own strategy, where today a map is rejected as an unknown
strategy.

## Safeguards and Invariants

- `FR-CFG-002`, `AC-CFG-001`: the five-subcontract policy shape is unchanged;
  this widens one existing key's accepted values.
- `NFR-REL-001`: an identical binding resolves the same checks and identities;
  provisioning form is outside the snapshot identity under every strategy.
- `SG-EVAL-001`, `NFR-SEC-001`: a provided root stays outside the snapshot path
  list, identity, and immutability re-check whether linked or copied.
- `NFR-OPER-001`: evidence names each root's strategy, so a failure traceable to
  a linked root is diagnosable.
- `NFR-PORT-002`: no operating-system logic; the map is declared.
- A scalar declaration behaves byte-for-byte as `TB-054` defined it; an absent
  declaration is `link` for every root.

## Prohibited Behavior and Non-goals

Do not infer a strategy from a root's contents, name, or size. Do not accept a
map key that is not a declared root. Do not change the scalar form's meaning
or the `link` default. Do not add a strategy. Do not change `dependency_roots`.
Do not touch cloning or the orphan sweep. Do not weaken any `TB-054` safety
property — occupied destination refused, failed attempt cleaned, no silent
degradation between strategies — for any root.

## Risk and Decision Impacts

- `RISK-003`: commit and preflight latency. This removes the largest avoidable
  cost from `copy` on every platform; the maintainer's one-minute preflight is
  the number it is measured against.
- No safeguard is withdrawn.

## Acceptance Criteria

- [ ] `FR-CFG-002`, `AC-CFG-001`: `dependency_provisioning` accepts a map from
  declared root to `link` or `copy`; a key naming an undeclared root, or a
  value naming an unknown strategy, is rejected with a diagnostic naming it.
- [ ] A root the map does not name is provided by `link`.
- [ ] A scalar declaration and an absent declaration behave exactly as `TB-054`
  defined, proved by that contract's fixtures unchanged.
- [ ] `FR-EVAL-004`: in one evaluation, a root mapped `copy` is a real
  directory and a root left unmapped is a link, proved by a fixture that
  inspects both.
- [ ] `NFR-OPER-001`: evidence, preview, and receipt name each root's strategy.
- [ ] `SG-EVAL-001`, `NFR-REL-001`: the snapshot identity is unchanged by any
  mix of strategies.
- [ ] `AC-EVAL-001`: a required failure still blocks and a passing snapshot is
  still allowed under a mixed declaration.
- [ ] The interaction with `TB-056` is established and stated: re-basing
  consults the strategy each root actually received.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `FR-CFG-002`, `AC-CFG-001`, `NFR-OPER-001`, `NFR-REL-001`: map-accepted, undeclared-key-rejected, unknown-value-rejected, unmapped-root-links, scalar-unchanged, mixed-recorded, and identity-unchanged fixtures against the real policy and snapshot modules | `npm run test:unit` | Yes — the unit suite owns policy validation and provisioning |
| smoke | both | `FR-EVAL-004`, `SG-EVAL-001`, `AC-EVAL-001`: a real activated clone with a mixed declaration provides one root by copy and one by link, the preview names both, a required failure still blocks | `gate-activation-smoke`, extended by this slice | Yes — the preview and receipt are only observable through a real activation |

Frontend build and browser evidence are inapplicable; this slice changes one
configuration key's accepted shape and per-root provisioning.

## Blocked By

`TB-054`, which introduces the scalar this contract widens.

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

Nothing missed a defect; `TB-054` chose a scalar knowingly. What no fixture
could have shown is the proportion — that on a real project the one root
needing no copy is the largest of the five by a wide margin. That number only
exists once a real project with real dependency trees is provisioned, and the
suite's own fixtures have dependency roots of a handful of files.
