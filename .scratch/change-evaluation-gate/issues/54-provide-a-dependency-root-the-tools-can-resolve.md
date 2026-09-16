# TB-054 — Provide a dependency root the tools can resolve

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 54-provide-a-dependency-root-the-tools-can-resolve
Draft key: TB-054

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A check that resolves a path finds the snapshot it is grading, not the
repository the snapshot was taken from. A project can say how its dependency
roots are provided, and a maintainer whose tooling resolves symlinks is no
longer told their code is broken when it is not.

## SRS Traceability

- `FR-EVAL-004`, `FR-CFG-002`, `FR-EVAL-003`
- `AC-EVAL-001`, `AC-CFG-001`, `AC-PORT-001`
- `SG-EVAL-001`, `NFR-SEC-001`
- `NFR-PORT-002`, `NFR-OPER-001`, `NFR-REL-001`
- `RISK-002`, `RISK-003`

## Defect this contract fixes

Found on a real project, and reproduced twice from opposite directions.

Verified at `snapshot.mjs:305`: every declared dependency root is provided into
the execution root by `symlink(...)`. The stated reason is sound — a dependency
tree is large enough that copying it per evaluation would make the budget
meaningless.

The consequence was not stated: **a tool that resolves a path to its realpath
sees the dependency, and therefore the project, outside the snapshot.** That is
not a quirk of one tool. It is the default behaviour of PHP's `__DIR__`, of
Node's module resolver, and of anything calling `realpath()`.

### Reproduction 1 — ESLint, proved by isolation

A snapshot was built by hand: `git archive HEAD` into a temporary root, then
`node_modules`, `vendor`, and the project's three generated JavaScript roots
provided beside it. Only the form of the three generated roots was changed
between runs. Nothing else — same tree, same `eslint.config.js`, same ESLint.

| `resources/js/{actions,routes,wayfinder}` | Result |
| --- | --- |
| symlinked to the original repository | 33 `import/order` errors |
| real directories | 0 errors, exit 0, zero bytes of output |

The mechanism is legible in the rule's own output. The project maps `@/*` to
`./resources/js/*` and orders groups `builtin, external, internal, parent,
sibling, index` with `alphabetize: asc`. `eslint-import-resolver-typescript`
follows the symlink to its realpath, which is outside the snapshot root, so
`@/routes` is classified `external` rather than `internal` — the same group as
`@inertiajs/svelte`, where alphabetical order then demands `@/routes` come
first. Hence the reported "should occur before".

### Reproduction 2 — Pest, proved by isolation

Same snapshot, same tests. Only `vendor`'s form changed.

| `vendor` | Pest's derived namespace | Result |
| --- | --- | --- |
| symlink | the test file's entire absolute path | `InvalidTestClassName`; nothing ran |
| real copy | `P\Tests\Feature\Auth\AuthenticationTest` | 40 tests booted and executed |

PHP resolves `__DIR__` inside `vendor/autoload.php` to its realpath, so Pest
computes the project root as the original repository, cannot relativize test
files living under the execution root, and falls back to the absolute path as a
namespace. `pest()->extend(TestCase::class)` stays bound to the original tree
and never binds the snapshot's tests, which therefore run as bare PHPUnit cases
— no application, no facades, `Call to undefined method ...::get()`.

**One mechanism, two tools.** The maintainer was told their formatter, their
static analysis, and their test suite had failed. All three passed when run by
hand. An earlier agent, reading those failures as facts about the code, began
editing the project's `tests/Pest.php` and `eslint.config.js` to satisfy them.

That is `TB-044`'s defect in a new place: an environment fault reported as a
code fault, and this time convincingly enough to nearly degrade a real test
suite.

### Two further findings, established while proving the above

**A symlinked root is writable through.** A check that writes into `vendor/` or
`node_modules/` writes into the maintainer's real repository. Copying contains
it. This is reasoned from what a symlink is, not measured, and the implementer
should confirm it rather than inherit it — but if it holds, provisioning by
copy closes an isolation hole as well as a correctness one.

**Nothing about dependency roots reaches Evidence.** Verified:
`provideDependencyRoots` computes `provided`, `missing`, and `refused`, and a
search of the decision envelope for each of those names, and for
`dependencyRoots`, returns nothing. A check that fails because a root was not
provided is undiagnosable from the evidence, which `NFR-OPER-001` requires it
not to be.

## Domain decisions this contract settles

**How a root is provided is the project's declaration, not the Gate's
inference.**

A new `evaluation_gate.execution.dependency_provisioning` scalar, `link` or
`copy`, with **`link` as the default**. Every existing clone keeps its current
behaviour, no configuration identity churns on upgrade, and a project whose
tooling resolves symlinks says so once.

**No operating-system-labelled product logic**, which `NFR-PORT-002` already
requires. The Gate must not detect the filesystem and choose. A maintainer on
APFS and a maintainer on NTFS write the same word and get correct behaviour at
different speeds. Detection would be OS logic wearing a disguise, and it is the
same "silently decide something" pattern this project has now rejected for
trust models (`TB-046`), feedback channels (`TB-048`), and bypass (`TB-052`).

**Copy is portable by construction, not by branching.** Verified on the
maintainer's machine: `fs.constants.COPYFILE_FICLONE` exists and `fs.cp`
accepts it as `mode`. It performs a copy-on-write clone where the filesystem
supports one and **silently falls back to a full byte copy where it does not**.
So one code path is correct everywhere; only speed varies.

Measured on that machine, `vendor` at 33,972 files:

| Method | Time |
| --- | --- |
| system `cp -c` (clonefile) | 5.7s |
| `fs.cp` with `COPYFILE_FICLONE` | 10.2s |
| `fs.cp` plain | 11.3s |

The gap between the first two is directory traversal in JavaScript, not bytes.
Reflink is available on macOS APFS and on Linux btrfs and XFS with
`reflink=1`; it is **not** available on Linux ext4 or Windows NTFS, where the
same call is a full copy. Only the macOS row was measured here; the rest is
documented platform behaviour and the implementer should treat it as such.

## Domain Concepts

Dependency root, Provisioning strategy, Execution root, Materialized snapshot,
Realpath resolution, Copy-on-write clone, Reflink fallback.

## Approach and Tradeoffs

Verified: the seam is one function. `provideDependencyRoots`
(`snapshot.mjs:293-321`) classifies roots and provides each one; the single
line to change is the `symlink` at `:305`.

Verified: a provided root is deliberately absent from the snapshot's path list,
and therefore outside the identity, the immutability re-check, and every
path-based rule. Whatever this slice does must keep it outside all three — a
copied root that entered the snapshot identity would make every evaluation
irreproducible.

Proposed — add the strategy, default to today's behaviour. The implementer
adds the scalar, its validation in `policy.mjs` beside `dependency_roots`, and
its projection through configuration, preview, and receipt. `link` behaves
byte-for-byte as it does today.

Proposed — record which strategy actually happened, per root. `COPYFILE_FICLONE`
falls back silently, which is right for correctness and wrong for
diagnosability. `COPYFILE_FICLONE_FORCE` fails instead. The implementer
establishes whether attempting `FORCE`, catching, and retrying plain is worth
the complexity of knowing which occurred, and either does it or states why not.
Either way `provided`, `missing`, and `refused` reach Evidence, which closes the
`NFR-OPER-001` gap above.

Proposed — say what cleanup now costs. Removing an execution root currently
unlinks a symlink; under `copy` it removes tens of thousands of real files. The
implementer confirms `sweepOrphanedExecutionRoots` still completes, and that a
crashed evaluation does not leak a full dependency tree per run.

Proposed — treat the Windows symlink separately and honestly. Verified:
`snapshot.mjs:305` passes `'dir'`, and a Windows directory symlink requires
elevated privilege or Developer Mode while a junction requires neither. So the
`link` strategy has an independent reason to fail there, silently, through the
`catch` at `:307`. The implementer decides whether this slice corrects it or
records it; what is not acceptable is leaving a silent failure undocumented.
This repository claims one environment and records every other as `unverified`,
and that claim stays true either way.

Deliberately not making `copy` the default. It may become the honest default
once proved across environments, and this contract does not pre-empt that.
Deliberately not per-root strategies — `node_modules` and `vendor` do have
different demands, and a list form can extend a scalar later without breaking
it. Deliberately not changing what a dependency root *is*, nor which roots a
project declares.

## Architecture Boundary and Public Seam

The boundary is between the tree a check is asked to grade and the tree its
tooling concludes it is looking at. The public seam is
`provideDependencyRoots`, the `dependency_provisioning` declaration that selects
its strategy, and what each provisioning attempt records.

First red test: a check whose tool resolves a dependency to its realpath grades
the execution root, where today it grades the original repository and reports
the difference as a fault in the code.

## Safeguards and Invariants

- `FR-EVAL-004`: the exact proposed snapshot is materialized in a separate
  execution root. A dependency that resolves back to the original repository
  defeats that for every tool that asks where a file is.
- `SG-EVAL-001`, `NFR-SEC-001`: evaluated source stays immutable and the
  snapshot identity keeps matching the execution root. A provided root stays
  outside the snapshot path list, the identity, and the immutability re-check
  under both strategies.
- `NFR-PORT-002`: no operating-system-labelled product logic is added. The
  strategy is declared, never detected.
- `NFR-REL-001`: an identical binding still resolves the same ordered checks
  and the same identities under either strategy.
- `NFR-OPER-001`: a root that was not provided is named in Evidence.
- `AC-CFG-001`: an absent `evaluation_gate` still means not configured, and the
  five-subcontract shape is unchanged.
- A clone that declares nothing behaves exactly as it does today.

## Prohibited Behavior and Non-goals

Do not detect the operating system or filesystem and choose a strategy. Do not
make `copy` the default in this slice. Do not add a provided root to the
snapshot path list, the snapshot identity, or the immutability re-check. Do not
change which roots a project declares or what `dependency_roots` means. Do not
add a new policy subcontract. Do not change the evaluation ladder, the decision
shape, or any check's outcome mapping. Do not silently degrade one strategy into
the other — a `copy` that could not copy is a stated failure, not a quiet link.

## Risk and Decision Impacts

- `RISK-002`: checks interfering with developer state is an accepted risk
  mitigated by isolation. A symlinked root is a hole in that isolation, because
  a check writing through it writes into the maintainer's own repository.
- `RISK-003`: commit latency is a live risk and this slice adds to it under
  `copy`. The measured cost above is the input to that judgement, and the
  default is unchanged so no existing clone pays it unasked.
- No safeguard is withdrawn. `SG-EVAL-001` is enforced for the first time
  against tooling that resolves paths.

## Acceptance Criteria

- [ ] `FR-CFG-002`, `AC-CFG-001`: `evaluation_gate.execution.dependency_provisioning`
  accepts `link` and `copy`, rejects anything else with a named diagnostic, and
  defaults to `link` when absent.
- [ ] A clone declaring nothing produces byte-identical behaviour to today,
  proved against the existing evaluation capabilities.
- [ ] `FR-EVAL-004`: under `copy`, a check whose tool resolves a dependency to
  its realpath resolves inside the execution root — proved by a fixture that
  fails under `link` and passes under `copy`, with nothing else changed.
- [ ] `AC-PORT-001`, `NFR-PORT-002`: provisioning contains no operating-system
  branch, and the portability matrix passes on the environment it is run on.
- [ ] `AC-EVAL-001`: in an activated fixture repository every commit still
  invokes the Gate, a snapshot whose required checks pass is allowed, and one
  with a required failure is blocked — under both provisioning strategies.
- [ ] `SG-EVAL-001`, `NFR-SEC-001`: under both strategies a provided root stays
  outside the snapshot path list, the snapshot identity, and the immutability
  re-check, and the identity of an unchanged tree is unchanged by the strategy.
- [ ] `NFR-OPER-001`: `provided`, `missing`, and `refused` reach the decision's
  evidence, and a check that fails because a root was unavailable can be
  diagnosed from it without rerunning anything.
- [ ] A `copy` that cannot be performed is reported as a failure, never
  silently downgraded to a link.
- [ ] Execution-root cleanup still completes under `copy`, and an interrupted
  evaluation leaves no dependency tree behind that the existing sweep cannot
  remove.
- [ ] The Windows `symlink('dir')` privilege failure is either corrected or
  recorded, and the report states which and why.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `FR-CFG-002`, `AC-CFG-001`, `NFR-OPER-001`: declaration-accepted, declaration-rejected, default-is-link, provisioning-recorded, copy-failure-is-not-a-link, and identity-unchanged-by-strategy fixtures against the real snapshot module | `npm run test:unit` | Yes — the unit suite owns configuration validation and the snapshot module |
| smoke | both | `FR-EVAL-004`, `SG-EVAL-001`, `AC-EVAL-001`, `AC-PORT-001`: a real clone whose tooling resolves realpaths fails under `link` and passes under `copy` with nothing else changed; a provided root stays outside the snapshot identity under both; every commit still invokes the Gate and a required failure still blocks; the portability matrix passes with no operating-system branch; cleanup completes | `gate-activation-smoke` and `gate-runtime-portability`, extended by this slice | Yes — the defect is only observable against a real execution root with a real tool resolving real paths |

Frontend build and browser evidence are inapplicable; this slice changes local
snapshot provisioning and one configuration scalar.

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

Every fixture that exercises a dependency root asserts that the root is
*reachable* — that the autoloader, module tree, or binary can be found — and by
that measure a symlink is a complete success. No fixture has ever asked a tool
where it thinks the file is. The two projects' worth of tooling that answers
that question differently were never in the suite, because the suite's own
checks are Node scripts run from the execution root with no alias resolution and
no framework bootstrap. The defect needed a tool that resolves realpaths and a
project whose imports depend on the answer.

## Reproduction

Preserved so the implementer can re-run it rather than re-derive it. Against a
Laravel and TypeScript project with generated JavaScript roots:

1. Extract `git archive HEAD` into a temporary directory, which stands in for
   the execution root.
2. Provide `node_modules`, `vendor`, and the generated roots beside it by
   symlink.
3. Run the project's ESLint: 33 `import/order` errors.
4. Replace the three generated roots with real directories, change nothing
   else, and run it again: 0 errors.
5. Run the project's Pest suite with `vendor` symlinked:
   `InvalidTestClassName`, or a namespace derived from the test file's absolute
   path; nothing runs.
6. Replace `vendor` with a real copy, change nothing else, and run again: the
   namespace is correct and the suite boots.

Step 6 also surfaces a second, unrelated gap in that project — its untracked
environment file is not in the snapshot, so the application has no encryption
key. That belongs to `TB-045` and the `FR-CFG-006` runtime-input path, not to
this contract, and it must not be conflated with the defect above.
