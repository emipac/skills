# TB-028 — Run every check in an environment it can actually start in

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 28-run-checks-in-an-environment-they-can-start-in
Draft key: TB-028

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

An executable activation proved can start is an executable a commit can start.
The environment a check runs in carries what its pinned program needs to
launch, a descriptor that cannot launch is refused at activation with a stated
reason rather than at commit time as a failing check, and no maintainer is ever
told their code failed a tool that never ran.

## SRS Traceability

- `FR-EVAL-001`, `FR-PROF-010`, `FR-CFG-004`, `FR-LIFE-004`
- `AC-EVAL-001`, `AC-CFG-002`, `AC-PROF-005`
- `SG-CMD-001`, `SG-OWNER-001`
- `NFR-REL-003`
- `RISK-001`

## Defect this contract fixes

Found by activating the Gate on a real Laravel project (`gms`) and committing.
The evidence is preserved under
`real-project-evidence/change-evaluation-gate/evidence/`. **Five of six
required checks never executed at all**, and every one of them was reported as
the maintainer's code failing.

The recorded attempts:

```
configuration.format.formatter.1           exit 127   2ms   env: php: No such file or directory
configuration.format.formatter.2           exit 127   1ms   env: node: No such file or directory
configuration.static-analysis.…1           exit 127   5ms   env: php: No such file or directory
configuration.static-analysis.…2           exit 127   1ms   env: node: No such file or directory
configuration.build.build                  exit 127   2ms   env: node: No such file or directory
configuration.broad-tests.test             exit 255  98ms   (php ran; see TB-030)
```

Exit `127` is *command not found*, reached in one to five milliseconds.

The mechanism is exact. `environmentFor` builds the child environment from
`{}` and copies only the names a descriptor declares
(`bounded-execution.mjs:56`), and migration defaults that declaration to the
empty array (`configure.mjs:428`: `allowed_environment: mapping.allowed_environment ?? []`).
`--draft-mapping` asks the maintainer only for the fields it refuses to guess —
profile, runner, args, timeout — so `allowed_environment` is never surfaced and
silently stays `[]`. **The check therefore runs with no environment at all, PATH
included.**

That is survivable for a directly-spawned absolute path: the kernel needs no
PATH to exec `/Users/…/Herd/bin/php`, which is why the one `php-script` check
got far enough to fail on something real. It is fatal for every executable that
is a *script*: `vendor/bin/pint` and `vendor/bin/phpstan` begin
`#!/usr/bin/env php`, `npm` begins `#!/usr/bin/env node`, and `env` resolves
those interpreters through a PATH that does not exist. Most real tool binaries
in both ecosystems are shebang scripts, so the shipped default guarantees
failure for the common case.

**The Activation receipt proves the tools themselves are fine.** It pinned
`Pint 1.30.5`, `PHPStan 2.2.8`, `npm 11.5.1`, and `PHP 8.4.23` — version
strings that can only come from *executing* those binaries during activation.
The gate ran every one of them successfully, wrote down what it proved, and
then launched the identical absolute paths into an environment where they
cannot start.

That is the same disagreement `TB-024` closed, one layer down. `TB-024` made
activation and execution agree on *which program* runs. Nothing makes them
agree on *the environment that program needs to run in*, so activation proves a
program that execution cannot start, and the maintainer is handed the blame.

`RISK-001`'s stated mitigation is exact command evidence. Evidence that says a
formatter rejected the code, when the formatter never started, is that
mitigation inverted.

## Domain Concepts

Command descriptor, Allowed environment, Logical runner, Runner resolution,
Activation receipt, Runtime pin, Bounded execution.

## Approach and Tradeoffs

**State the invariant, then enforce it at activation.** The rule this slice
adds is: *an executable the receipt pins must be launchable in the environment
execution will construct for it.* Activation is where that becomes checkable,
because activation already launches each pinned program to read its version. It
must launch it in the same environment shape execution will use, and a program
that cannot start there is `runner-unresolved` with a stated reason — refused
while the maintainer is watching, not six commits later as a mystery failure.

**Give a pinned executable what it needs to launch.** The descriptor's
`allowed_environment` remains what it has always been: the project's own
declaration of the environment its *command* needs — locale, tokens, tool
configuration. It is not, and should not become, the place a maintainer is
expected to know that `npm` is a Node script. Execution therefore supplies, in
addition to the declared names, a runtime-owned search path sufficient to
resolve the interpreters of the executables the receipt pinned. That set is
derived from the pins themselves rather than inherited wholesale from the
maintainer's shell, so it stays narrow, declared, and reproducible — the
opposite of passing `process.env` through.

**Stop the silent `[]` default.** Migration writing an empty allowed
environment is a guess dressed as a default, and it is the specific guess that
produced this. Either the draft asks for it like every other field it refuses
to infer, or the default states the minimum a command needs. Whichever is
chosen, an existing schema v4 configuration must keep working without being
migrated again (`AC-CFG-002`).

**Refuse rather than widen.** No shell is introduced, no PATH is searched for a
runner that failed to resolve, and nothing here re-resolves a pin — `TB-024`'s
rules are untouched. The only new capability is that the environment handed to
a spawned process is sufficient for that process to start.

## Architecture Boundary and Public Seam

The boundary is the environment construction between a pinned executable and
its spawned process — today split between `environmentFor` in
`bounded-execution.mjs` and the migration default in `configure.mjs`, with
activation's version probe blind to both. The public seam is the environment
execution constructs, and activation's refusal of a descriptor that cannot
launch in it.

First red test: a `composer-bin` descriptor whose pinned executable is a
`#!/usr/bin/env php` script, with `allowed_environment: []`, executes and
reaches its own exit status rather than exiting `127` — and the same descriptor
in a clone where the interpreter genuinely does not exist is refused at
activation as `runner-unresolved`, never registered.

## Safeguards and Invariants

- `SG-CMD-001`: no shell is introduced. Interpreter resolution is the kernel's
  own shebang handling given a sufficient search path; nothing here parses,
  splits, or re-quotes a stored argument, and an unresolved runner is still
  reported rather than looked up through a shell.
- `SG-OWNER-001`: the rule reads descriptors and pins through the command
  contract and learns nothing about which stack produced them. `php` and `node`
  are not named as special cases.
- `NFR-REL-003`: a descriptor that cannot launch is `unverified` or
  `runner-unresolved` — never `failed`. See `TB-029`, which owns the
  classification half of that guarantee.
- The environment stays minimal and stated. This slice must not become "inherit
  the maintainer's shell": an evaluation whose result depends on an
  undeclared ambient variable is not reproducible (`NFR-REL-001`).
- `AC-CFG-002`: a schema v4 configuration produced by a real migration keeps
  working without being rewritten.

## Prohibited Behavior and Non-goals

Do not pass `process.env` through wholesale. Do not add a shell, a login shell,
or a profile-sourcing step. Do not re-resolve or substitute a pinned executable
— `TB-024` settled that. Do not put `vendor/` or `node_modules/` into the
snapshot; that is `TB-030` and it is a different mechanism with different
consequences. Do not change `composeArguments`, the composition table, or the
descriptor contract's runner rows. Do not silently rewrite an existing clone's
stored `allowed_environment`.

## Risk and Decision Impacts

- `RISK-001`: this restores the mitigation. Exact command evidence only
  mitigates anything if the command ran; today the evidence describes a
  verdict no tool reached.
- No disposition changes. The environment stays declared and narrow, so
  reproducibility is preserved rather than traded away.

## Acceptance Criteria

- [ ] `AC-EVAL-001`, `FR-PROF-010`: in an activated clone whose required check
  is a `composer-bin` descriptor pinned to a `#!/usr/bin/env` script, the check
  executes and reports the tool's own outcome; a commit is denied on genuinely
  bad content and allowed on good content, and no attempt exits `127`.
- [ ] `FR-LIFE-004`, `NFR-REL-003`: a descriptor whose pinned executable cannot
  launch in the environment execution constructs is refused at activation as
  `runner-unresolved` with a stated reason, leaving the clone configured with
  no receipt and no registered hook.
- [ ] `SG-CMD-001`: the environment a check receives contains the descriptor's
  declared names plus the runtime-owned search path and nothing else; a
  variable present in the parent process but neither declared nor required for
  launch is absent from the child.
- [ ] `AC-CFG-002`: an existing schema v4 configuration produced by a real
  migration executes correctly without being migrated again.
- [ ] `AC-PROF-005`: migration no longer produces a descriptor that is
  structurally unable to launch — either the draft surfaces
  `allowed_environment` as a field it refuses to guess, or the written default
  states the minimum, and the choice is recorded in the ticket on completion.
- [ ] `SG-OWNER-001`: a source scan finds no interpreter name special-cased
  outside the command contract.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `SG-CMD-001`, `NFR-REL-003`, `AC-CFG-002`: fixtures spawning a real `#!/usr/bin/env` script through the bounded executor with an empty declared environment, an unlaunchable pin refused at activation, environment-narrowness assertions, and the migration default | `npm run test:unit` | Yes — the unit suite owns bounded execution, the descriptor contract, and migration |
| smoke | both | `AC-EVAL-001`: an activated fixture whose required check is a real shebang script under `vendor/bin` denies a bad commit and allows a good one, with no attempt exiting `127` | `gate-activation-smoke`, extending `vendor-binary-commit` | Yes — that scenario already builds a real vendor binary and is one shebang away from reproducing this defect |

Frontend build and browser evidence are inapplicable; this slice changes local
process execution.

## Blocked By

None. `TB-024` delivered the pins this relies on and `TB-026` delivered the
evidence that made the failure legible.

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

Every fixture in the repository declares `allowed_environment: ['PATH']` and
every fixture executable is either `process.execPath` or a `#!/bin/sh` script —
two shapes that cannot fail this way. `vendor-binary-commit`, added by `TB-024`
specifically to run a real vendor binary, writes its fixture with a `#!/bin/sh`
shebang and `sh` is at an absolute path the kernel finds without PATH. The one
combination that breaks — a declared environment of `[]` plus an executable
whose interpreter must be found on PATH — is the combination a real migration
produces by default and no fixture has ever built.
