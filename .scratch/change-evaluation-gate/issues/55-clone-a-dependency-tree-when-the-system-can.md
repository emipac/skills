# TB-055 — Clone a dependency tree when the system can

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by: TB-054
Tracker ID: 55-clone-a-dependency-tree-when-the-system-can
Draft key: TB-055

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A project that provides its dependency roots by copy pays for a copy-on-write
clone where the filesystem can perform one, and for a byte copy only where it
cannot. The `copy` strategy stops being the expensive option a maintainer
accepts to get a correct answer.

## SRS Traceability

- `FR-EVAL-004`, `FR-CFG-004`
- `AC-EVAL-001`, `AC-PORT-001`
- `SG-EVAL-001`, `NFR-SEC-001`
- `NFR-PORT-001`, `NFR-PORT-002`, `NFR-OPER-001`, `NFR-REL-001`
- `RISK-002`, `RISK-003`

## Defect this contract fixes

`TB-054` settled that a dependency root provided by symlink is resolved to its
realpath by tooling and therefore reported outside the snapshot, and added a
declared `copy` strategy that fixes it. That contract's premise about the cost
of `copy` was wrong, and this contract corrects the consequence.

Verified on the maintainer's machine, Node 24.11.0, darwin, APFS:

- `fs.copyFile` with `COPYFILE_FICLONE` on a 256 MiB file consumed **256.1 MiB**
  of free space. No clone occurred.
- `COPYFILE_FICLONE_FORCE` returned **`ENOSYS`**, in the system temporary
  directory and inside the repository, for `fs.cp` and for a bare
  `fs.copyFile`.

So Node performs no copy-on-write clone on this platform, and the flag
`TB-054` passes is inert here. It is retained because it is free and does
reflink where libuv implements it.

The system itself is fully capable, which is the point:

| Operation | Time | Free space consumed |
| --- | --- | --- |
| `cp -c -R` (clonefile) | 6.50s | **16.2 MiB** |
| `cp -R` (byte copy) | 10.95s | 355.0 MiB |
| `fs.cp` with `COPYFILE_FICLONE` | 9.9s | 372.9 MiB |

Measured against a real dependency tree of 33,972 files. The same volume holds
the repository, the system temporary directory, and the execution root
(`/dev/disk3s5` for all three), so a clone is available for the Gate's own
snapshots rather than only in principle.

The cost difference is not academic. `TB-054`'s `copy` is comfortable for a
per-commit gate against a large budget and uncomfortable for a preflight that
runs on every agent turn — and it is the preflight where the underlying defect
was found. It also drives `TB-054`'s reported sweep pressure: an orphaned
execution root costs real disk under a byte copy and almost none under a clone.

## Domain decisions this contract settles

**Capability probing, not operating-system labelling.**

`NFR-PORT-002` forbids operating-system-labelled product logic, and this
contract does not introduce any. The Gate does not ask what platform it is on.
It attempts a clone, observes whether the attempt succeeded, and proceeds
accordingly — the same shape as runner resolution in `TB-024` and adapter
capability declaration throughout. No `process.platform` branch is added.

**A fallback inside `copy` is not the prohibited degradation.** `TB-054`
prohibits a `copy` silently served as a `link`, because that reintroduces the
defect the declaration exists to close. Falling back from a clone to a byte
copy is different in kind: both produce a real directory whose contents resolve
inside the execution root, which is the property the declaration buys. The
observable result is identical and only the cost differs. The implementer must
keep these two cases distinct in both code and diagnostics.

**The declaration does not change.** `dependency_provisioning` keeps its two
values and its `link` default. A project that wrote `copy` gets a faster `copy`
with no edit, no migration, and no configuration identity churn.

## Domain Concepts

Copy-on-write clone, Reflink, Byte copy, Capability probe, Provisioning
mechanism, Dependency root, Execution root.

## Approach and Tradeoffs

Verified: `TB-054` placed exactly one function per strategy in a `PROVISIONERS`
table in `snapshot.mjs`, and the `copy` entry is a single `fs.cp` call. The
change is contained to that entry and to whatever records which mechanism ran.

Verified: the Gate already resolves and spawns platform executables — every
configured runner does, and Git is invoked the same way. Spawning a copy program
is not a new class of dependency for this runtime.

Proposed — probe by attempting, never by asking the platform. The implementer
establishes how a clone attempt is made and how its failure is recognised, and
confirms no operating-system name, platform check, or release test appears in
the result. A probe whose cost is paid once per evaluation is acceptable; one
paid per file is not, and the implementer states which they built.

Proposed — the fallback is `TB-054`'s existing `fs.cp`, unchanged. It is proved,
it carries the failure-cleanup and occupied-destination refusals that contract
added, and nothing here should re-derive it.

Proposed — treat an external copy program as a resolved executable, not a name
on `PATH`. A dependency tree is provisioned before any check runs and the
program that provisions it is inside the trust boundary of the evaluation.
`TB-024` already established that the Gate resolves each runner to a concrete
executable and records its identity rather than trusting lookup order; the
implementer establishes whether that reasoning applies here and says what they
concluded. If it does not apply, say why.

Proposed — record the mechanism, not just the strategy. `TB-054` records which
strategy was applied per root; this adds which mechanism performed it, so a
maintainer diagnosing evaluation latency can see whether their filesystem cloned
or copied. That is the difference between a slow evaluation someone can act on
and one they cannot (`NFR-OPER-001`).

Proposed — prove the clone happened rather than assume it. A timing improvement
is weak evidence and a filesystem can be fast for other reasons. Free-space
consumption before and after distinguishes a clone from a copy directly, and is
what established the numbers above.

Deliberately not a new configuration value, a new strategy, or a change to the
`link` default. Deliberately not the hardlink strategy — it is cheaper than a
byte copy on disk but shares an inode, so an in-place write reaches the
maintainer's own repository (verified: an in-place write through a hardlink
mutated the source; an atomic replace did not). A clone has no such exposure and
supersedes it. Deliberately not widening the orphan sweep budget, which is its
own contract.

## Architecture Boundary and Public Seam

The boundary is between what a provisioning strategy promises — a real directory
whose contents resolve inside the execution root — and what it costs to keep
that promise. The public seam is the `copy` provisioner in `snapshot.mjs` and
the mechanism each provisioning attempt records.

First red test: providing a dependency tree under `copy` on a filesystem that
supports cloning consumes storage proportional to the tree, where it should
consume almost none.

## Safeguards and Invariants

- `FR-EVAL-004`, `SG-EVAL-001`: a provided root stays outside the snapshot path
  list, the snapshot identity, and the immutability re-check under every
  mechanism, and the identity of an unchanged tree is unchanged by which
  mechanism ran.
- `NFR-SEC-001`: evaluated source stays immutable. A cloned file is an
  independent file; writing to it must not reach the maintainer's repository,
  and this must be proved rather than assumed.
- `NFR-PORT-002`: no operating-system-labelled product logic is added.
- `NFR-REL-001`: an identical binding resolves the same ordered checks, the same
  identities, and the same decision whichever mechanism provisioned the roots.
- `TB-054`'s safety properties are preserved exactly: an occupied destination is
  refused, a failed attempt removes what it created, and a `copy` is never
  silently served as a `link`.
- `AC-PORT-001`: paths containing spaces are handled, which matters more here
  because a program is being invoked with them.

## Prohibited Behavior and Non-goals

Do not branch on the operating system, its name, or its release. Do not add a
configuration value, a strategy, or a flag. Do not change the `link` default or
what `link` does. Do not weaken any safety property `TB-054` added. Do not let a
failed clone leave a partial tree, and do not let it degrade to a `link`. Do not
change the snapshot identity, the path list, or the immutability re-check. Do
not add a runtime dependency. Do not widen the orphan sweep budget. Do not
implement a hardlink strategy.

## Risk and Decision Impacts

- `RISK-003`: commit latency is a live risk and `TB-054` added to it under
  `copy`. This contract reduces it on filesystems that can clone, and leaves it
  unchanged elsewhere.
- `RISK-002`: isolation is unchanged. A cloned file is independent, so the
  containment `TB-054` established is preserved, not traded away.
- No safeguard is withdrawn and no disposition changes.

## Acceptance Criteria

- [ ] `FR-EVAL-004`: under `copy`, providing a dependency tree on a filesystem
  that supports cloning consumes storage far below the size of the tree, proved
  by free-space measurement rather than by timing.
- [ ] The result is indistinguishable from today's `copy` in content: the same
  files, the same contents, the same resolution behaviour for a tool that
  resolves realpaths.
- [ ] A filesystem that cannot clone still provisions correctly through the
  existing byte copy, and the outcome is identical apart from cost.
- [ ] `NFR-PORT-002`, `AC-PORT-001`: no operating-system name, platform check,
  or release test appears in the provisioning path, and the portability matrix
  passes on the environment it runs on, including a path containing spaces.
- [ ] `SG-EVAL-001`, `NFR-REL-001`: the snapshot identity, its path list, and
  its immutability re-check are identical whichever mechanism provisioned the
  roots.
- [ ] `NFR-SEC-001`: a write into a provisioned root does not reach the
  maintainer's repository under any mechanism, proved by a fixture that writes
  and then reads the source.
- [ ] `NFR-OPER-001`: the mechanism that performed each provisioning is recorded
  in evidence beside the strategy `TB-054` already records.
- [ ] `TB-054`'s safety properties still hold: occupied destination refused,
  failed attempt cleaned up, `copy` never served as `link` — each proved by the
  fixtures that contract added, unchanged.
- [ ] `AC-EVAL-001`: an activated clone still blocks a required failure and
  allows a passing snapshot, under both provisioning strategies.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `NFR-PORT-002`, `NFR-SEC-001`, `NFR-OPER-001`: no-platform-branch, mechanism-recorded, fallback-still-correct, write-does-not-reach-source, and TB-054-safety-properties-unchanged fixtures against the real snapshot module | `npm run test:unit` | Yes — the unit suite owns the snapshot module and its provisioners |
| smoke | both | `FR-EVAL-004`, `AC-PORT-001`, `AC-EVAL-001`, `SG-EVAL-001`: a real dependency tree provided under `copy` consumes storage far below its size where the filesystem can clone; identity, path list and re-check are equal under every mechanism; a path containing spaces is provisioned; a required failure still blocks | `gate-runtime-portability` and `gate-activation-smoke`, extended by this slice | Yes — free-space behaviour and executable invocation are only observable against a real filesystem and a real execution root |

Frontend build and browser evidence are inapplicable; this slice changes local
snapshot provisioning.

## Blocked By

`TB-054`, which introduces the `copy` strategy this contract makes cheap. There
is nothing to optimize until that lands.

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

`TB-054` was written and implemented against a documented behaviour rather than
a measured one — that Node's copy flag performs a copy-on-write clone where the
filesystem supports one and falls back where it does not. The first half is not
true on the platform it was measured on, and no test would have caught it,
because every fixture asserts that a provisioned root is present and correct,
which a byte copy satisfies perfectly. Cost is not a property any check
observes, and free-space consumption had never been measured by anything in this
repository.
