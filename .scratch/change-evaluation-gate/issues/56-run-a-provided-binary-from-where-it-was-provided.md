# TB-056 — Run a provided binary from where it was provided

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by: TB-054
Tracker ID: 56-run-a-provided-binary-from-where-it-was-provided
Draft key: TB-056

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A check whose executable lives inside a dependency root runs the copy of that
executable the snapshot was given, so the program and the tree it grades are
the same tree. A maintainer who declares `copy` to make their tools resolve the
snapshot does not lose a check that passed under `link`.

## SRS Traceability

- `FR-CFG-004`, `FR-EVAL-004`, `FR-LIFE-004`
- `AC-EVAL-001`, `AC-EVAL-006`, `AC-CFG-004`
- `SG-EVAL-001`, `NFR-SEC-001`
- `NFR-REL-001`, `NFR-REL-003`, `NFR-OPER-001`
- `RISK-002`

## Defect this contract fixes

Found the first time `TB-054`'s `copy` strategy was run against a real project,
and reproduced in isolation.

### What happened

A Laravel and TypeScript project activated with
`dependency_provisioning: copy`. Two checks that had failed under `link` for
`TB-054`'s reason now passed — ESLint entirely, and Pest to the point of
booting the application. One check that had passed under `link` now failed:

```
Fatal error: Cannot redeclare class ComposerAutoloaderInitf1af0ac2398eab26dc310b182abfae22
  (previously declared in …/gatepreflightexec…/vendor/composer/autoload_real.php:5)
  in /Users/emipac/www/gms/vendor/composer/autoload_real.php on line 5
```

Two `autoload_real.php` files — one in the snapshot's provided `vendor`, one in
the maintainer's original repository — declaring the same generated class in
one process.

### Why

Verified in the Activation receipt. Every `composer-bin` runner is pinned to an
absolute path in the **original repository**:

```json
{"check_id":"configuration.static-analysis.static-analysis.1","role":"evaluate",
 "runner":"composer-bin","executable":"/Users/emipac/www/gms/vendor/bin/phpstan",
 "interpreter":"/Users/emipac/Library/Application Support/Herd/bin/php",
 "version":null,
 "preview":"/Users/emipac/www/gms/vendor/bin/phpstan analyse --memory-limit=512M"}
```

Verified at `command-descriptor.mjs:549-551`: `composer-bin` is resolved by
`resolveVendorBinary(command, repositoryRoot)` — against the repository root,
at activation. Verified at `hook-runner.mjs:517-575`: `pinnedRunners` takes
`pin.executable` verbatim, checks it is executable, and hands it on. Verified
at `bounded-execution.mjs:210-211`: the process is spawned as
`spawn(resolution.executable, …, { cwd: path.join(executionRoot, …) })`.

So the executable is in the original repository and the working directory is
the execution root. The Composer shim at `vendor/bin/phpstan` sets
`$GLOBALS['_composer_autoload_path'] = __DIR__ . '/../autoload.php'` — the
original repository's autoloader, because `__DIR__` is where the shim was
launched from. PHPStan then loads the project's autoloader relative to the
project it was pointed at — the execution root, whose `vendor` is now a
separate copy. Same class name, two files.

### Why `link` never showed it

Under `link`, the execution root's `vendor` is a symlink to the original `vendor`.
Both paths resolve to one realpath, and PHP deduplicates `require_once` by
realpath. The defect existed, and one filesystem indirection hid it. This is
`TB-054`'s mechanism observed from the other side: the realpath collapse that
broke path-resolving tools was the same collapse that let a doubly-loaded
program appear singly loaded.

### Reproduced in isolation

A snapshot built by hand — `git archive HEAD` plus a real copy of `vendor` —
with the same working directory and the same arguments, changing only which
binary is invoked:

| Binary invoked | Result |
| --- | --- |
| original repository's `/Users/emipac/www/gms/vendor/bin/phpstan` | the fatal above, verbatim |
| the snapshot's own `./vendor/bin/phpstan` | `{"tool":"phpstan","result":"passed","errors":0}` |

### Why only PHPStan

Verified: `vendor/bin/pint` carries the identical shim and sets the identical
`_composer_autoload_path`. Pint passed under `copy` regardless, so it does not
additionally load the project's autoloader — its build is self-contained. Pest
runs through `php artisan test`, whose runner is `php-script`: the executable
is the interpreter, outside every dependency root, and `artisan` is found from
the working directory, so only the snapshot's `vendor` is ever loaded. Every
`package-script` check resolves to `npm`, likewise outside the project, which
finds `node_modules` from the working directory.

The defect is therefore specific to the one runner kind resolved *into* the
project tree, and to tools under it that load both their own autoloader and
the project's. PHPStan is one such tool; it is not plausibly the only one.

### The pin carries no content identity

Verified from the receipt above: `version` is `null` and there is no hash of
the executable. `FR-CFG-004` says activation shall "record its identity and
version"; what is recorded is a path. Today "the same program" means "the same
path", which is exactly the definition `copy` breaks — the provided copy is the
same bytes at a different path.

## Domain decisions this contract settles

**A provided root is where its binaries run from.** If a dependency root is
provided into the execution root, an executable pinned under that root is
invoked from the provided location, not from the original repository. Under
`link` the two locations are one file and nothing observable changes. Under
`copy` they are two files, and the one beside the tree being graded is the one
that runs.

**Same bytes or nothing.** The pin has no content identity, so this contract
proves equivalence at the moment it matters: the pinned executable and the
provided one are hashed, and a mismatch is `runner-pin-drift`, denying as any
other pin drift does. Neither is run. This keeps `TB-024`'s rule intact — the
Gate never substitutes a different program for the one activation proved — by
establishing that the provided copy is not a different program.

**Consent was granted to a program, and the receipt says which one.** The
preview a maintainer confirmed names the original path, because that is where
resolution found the program. This contract does not re-resolve; it runs the
provided copy of exactly what was resolved, and records both the pinned path
and the invoked path in evidence so the relationship is legible rather than
implied. Whether a future receipt should pin a content identity directly, so
`FR-CFG-004`'s "identity" is a hash rather than a path, is a stronger form of
this that the implementer may propose but this contract does not require.

**The interpreter is never re-based.** It is outside every dependency root by
construction — `TB-028` resolves it from the executable's own first line and it
lives wherever the platform put it — and moving it would be substitution.

## Domain Concepts

Pinned executable, Provided dependency root, Execution root, Runner kind,
Composer shim, Autoloader, Content equivalence, Runner pin drift.

## Approach and Tradeoffs

Verified: three participants know three different things. `pinnedRunners`
knows the pin but not the snapshot. `bounded-execution` knows the execution
root but not the repository root or which roots were provided. The evaluation
in `evaluate.mjs` sees the captured snapshot — including `TB-054`'s
`dependencies.provided` — and the resolved runners. That is where the two facts
meet.

Proposed — re-base at the seam where both facts are known. For each resolved
runner, if `executable` lies under `path.join(repositoryRoot, root)` for some
`root` in `dependencies.provided`, the invoked path is
`path.join(executionRoot, root, remainder)` where `remainder` is the path below that root. Roots that were `missing` or
`refused` never re-base — the original binary is all there is, and under `copy`
that case is `TB-054`'s stated failure, not this contract's. The implementer
states where they put it and why.

Proposed — prove equivalence before invoking. Hash the pinned executable and
the re-based one. Equal: invoke the re-based one, and let `unlaunchable`
(`bounded-execution.mjs:119`) check the path that will actually be spawned.
Unequal: `runner-pin-drift`, deny, run neither. The implementer confirms the
hash cost is paid once per check per evaluation and states what it measured.

Proposed — keep drift observation on the pin. `observeControlSurface`
(`hook-runner.mjs:641`) re-observes each pinned executable at its pinned path
for control-surface reconciliation. That is a fact about the original
repository and stays exactly as it is. Re-basing changes what is invoked, not
what is observed.

Proposed — record both paths. `NFR-OPER-001` requires a denial to be
diagnosable from evidence. A maintainer reading an evaluation should see the
pinned path, the invoked path, and — if they differ — which root made them
differ. The implementer confirms this goes through the existing decision and
Evidence shape rather than a new field family, and says what shape they chose.

Proposed — prove `link` is untouched by construction, not by assumption. Under
`link`, the re-based path is a symlink to the pinned one; hashing both reads
one file, and spawning either starts one program. The implementer proves an
undeclared clone and an explicit `link` clone produce byte-identical evidence
before and after this change.

Deliberately not re-basing the interpreter, any `package-script` or
`php-script` executable, or anything outside a provided root — those were
never inside the tree and never had two locations. Deliberately not changing
how activation resolves or pins. Deliberately not a per-root provisioning
strategy, which is the answer to a different question (`node_modules` is
49,120 of the 83,199 files provided on the project above and needed no copy for
correctness; the preflight took roughly one minute under `copy`). Deliberately
not `TB-055`'s cloning. Deliberately not the missing environment file that
`TB-045` owns.

## Architecture Boundary and Public Seam

The boundary is between the program activation proved and the location that
program is run from. The public seam is the resolved-runner set the evaluation
hands to bounded execution — specifically the `executable` each entry carries —
together with the pin-drift reason a mismatch produces and the two paths
evidence records.

First red test: a `composer-bin` check under `copy` whose tool loads both its
own autoloader and the project's fails with a redeclared class, where the same
check under `link` passes — and after this change passes under both.

## Safeguards and Invariants

- `TB-024` / `NFR-REL-003`: the Gate never runs a program activation did not
  prove. A provided copy is invoked only after it is proved byte-identical to
  the pinned executable; otherwise the check is `unverified` by
  `runner-pin-drift` exactly as today.
- `FR-EVAL-004`, `SG-EVAL-001`: the program and the tree it grades are the same
  tree. Nothing this contract does moves a provided root into the snapshot path
  list, identity, or immutability re-check.
- `NFR-SEC-001`: evaluated source stays immutable. Running a binary from a
  provided copy changes where a tool writes its caches; the implementer
  confirms nothing new reaches the maintainer's repository.
- `NFR-REL-001`: an identical binding resolves the same ordered checks and the
  same identities; only the invoked path of an executable under a provided root
  changes, and only when that root was provided by copy.
- `NFR-OPER-001`: pinned path and invoked path are both in evidence.
- `FR-LIFE-004`: the receipt and its preview are unchanged; consent is neither
  re-obtained nor widened.
- An undeclared clone and a `link` clone are byte-identical to today.

## Prohibited Behavior and Non-goals

Do not re-resolve any executable at evaluation time. Do not invoke a re-based
path whose content differs from the pinned executable. Do not re-base the
interpreter, or any executable outside a provided dependency root. Do not
change activation-time resolution, the pin's shape, or the receipt. Do not
change what `observeControlSurface` observes. Do not add a provided root to
the snapshot identity. Do not introduce a per-root provisioning strategy, a
content-identity pin as a general feature, or a change to `TB-054`'s
declaration. Do not touch runtime inputs.

## Risk and Decision Impacts

- `RISK-002`: `TB-054` closed a write-through hole by giving the snapshot its
  own dependency tree; this contract makes the tools inside that tree run from
  it, so a tool's own writes — caches, temporary files — land in the copy too.
- No disposition changes. The pinned program is the program that runs; what
  changes is that it runs from beside the code it grades.

## Acceptance Criteria

- [ ] `FR-EVAL-004`, `AC-EVAL-001`: a `composer-bin` check whose tool loads
  both its own and the project's autoloader passes under `copy`, proved by a
  fixture that fails before this change with a redeclared class and passes
  after, and blocks a required failure under both strategies.
- [ ] `NFR-REL-003`, `AC-EVAL-006`: a provided executable whose content differs
  from the pinned one produces `runner-pin-drift`, denies, and runs neither.
- [ ] The interpreter and every executable outside a provided root are invoked
  exactly as today, proved by the existing pin fixtures unchanged.
- [ ] A root that was `missing` or `refused` never re-bases; the pinned path is
  invoked or the check is `unverified` as `TB-054` already specifies.
- [ ] `NFR-REL-001`: an undeclared clone and an explicit `link` clone produce
  byte-identical evidence before and after this change.
- [ ] `NFR-OPER-001`: evidence records the pinned path and the invoked path for
  every runner, and names the root when they differ.
- [ ] `NFR-SEC-001`: a tool run from a provided copy writes nothing into the
  maintainer's repository, proved by a fixture that runs a writing tool and
  reads the source afterwards.
- [ ] `FR-LIFE-004`, `AC-CFG-004`: the Activation receipt, its runner pins, and
  the preview a maintainer confirmed are unchanged by this contract.
- [ ] `observeControlSurface` still observes each pinned executable at its
  pinned path, proved by the existing reconciliation fixtures unchanged.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `NFR-REL-003`, `AC-EVAL-006`, `NFR-REL-001`, `NFR-OPER-001`, `AC-CFG-004`: re-base-under-provided-root, no-re-base-outside-root, no-re-base-when-missing, content-mismatch-is-drift, interpreter-untouched, link-byte-identical, both-paths-recorded, and receipt-unchanged fixtures against the real runner and evaluation modules | `npm run test:unit` | Yes — the unit suite owns pinned-runner resolution, bounded execution, and the evaluation seam |
| smoke | both | `FR-EVAL-004`, `AC-EVAL-001`, `SG-EVAL-001`, `NFR-SEC-001`: a real activated clone with a `composer-bin`-style check that loads two autoloaders is blocked with a redeclared class under `copy` before this change and allowed after, still blocked on a required failure under both strategies, and the maintainer's repository is unchanged by the tool's own writes | `gate-activation-smoke`, extended by this slice | Yes — the defect is only observable with a real spawned process against a real provided root |

Frontend build and browser evidence are inapplicable; this slice changes where
a resolved executable is invoked from.

## Blocked By

`TB-054`, which introduces the provided-root set (`dependencies.provided`) this
contract consults and the `copy` strategy that makes two locations differ.

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

Every runner fixture in this repository resolves to a script the suite wrote,
run by the Node interpreter the suite is already running under — nothing is
resolved into a dependency root, because the suite has no dependency roots
with binaries in them. And until `TB-054`, a provided root and its original
were one file under every strategy that existed, so a program loaded from
both places was loaded once. The defect needed a real Composer shim, a tool
that loads two autoloaders, and a provisioning strategy that makes two paths
two files. All three arrived together, on a real project, on the first run.
