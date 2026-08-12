# TB-019 — Bind runner arguments to their resolved executable

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 19-bind-runner-arguments-to-their-resolved-executable
Draft key: TB-019

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A resolved Command descriptor produces the invocation the maintainer's original
command described, so the previewed and executed command are the one they
approved rather than a mangled version of it.

## SRS Traceability

- `FR-CFG-003`, `FR-CFG-004`
- `AC-CFG-002`
- `SG-CMD-001`

## Defect this contract fixes

Found while previewing a real activation. Each logical runner names an
executable, and each descriptor carries an argument array, but nothing defines
how the two compose. `commandPreview` concatenates them directly:

```js
export const commandPreview = (command, executable) => [executable, ...command.args].join(' ');
```

Migration stores the binary name inside `args` for `composer-bin`, so a resolver
that derives the executable from `args[0]` — the only thing it can do — produces
the binary twice. And `package-script` resolves to `npm` while its descriptor
holds only the script name, so the `run` subcommand is missing. Reproduced
against the descriptors a real migration produced:

| Check | Previewed invocation | Correct invocation |
| --- | --- | --- |
| format backend | `vendor/bin/pint pint --dirty --format agent` | `vendor/bin/pint --dirty --format agent` |
| format frontend | `npm format:check` | `npm run format:check` |
| tests | `php artisan test --compact` | `php artisan test --compact` |

`php-script` is correct by accident: `artisan` genuinely is an argument to
`php`, so direct concatenation happens to be right for that one runner.

`FR-CFG-004` requires activation to resolve each logical runner to a platform
executable and preview the equivalent human-readable command. The preview is
what a maintainer approves, and two of six previews describe a command that
would not run.

## Domain Concepts

Command descriptor, Verification profile, Grader surface, and Trusted gate
configuration.

## Approach and Tradeoffs

Make composition part of the runner's own definition rather than something each
caller reinvents. A runner states how its executable and its arguments combine —
`composer-bin` treats the first argument as the binary under the vendor
directory and passes the rest, `package-script` invokes its script through
`run`, `php-script` and `repository-script` pass their arguments through — and
both preview and execution use that one rule.

Keeping the rule with the runner rather than with the resolver is deliberate.
The resolver's job is to find an executable and record its identity and version;
if it also had to know how each runner shapes its arguments, every caller would
carry a copy of that knowledge and they would drift, which is how this defect
reached a preview in the first place.

Correcting composition rather than rewriting stored descriptors keeps existing
schema v4 contracts valid. A migrated repository must not need re-migrating.

## Architecture Boundary and Public Seam

The boundary is Command descriptor resolution inside the existing
`command-descriptor` seam. The public seam is the previewed invocation and the
arguments handed to the bounded executor. First red test: a `composer-bin`
descriptor whose first argument names its binary, and a `package-script`
descriptor naming a script, each preview and execute as the command the
maintainer originally wrote.

## Safeguards and Invariants

- `SG-CMD-001`: composition stays structural. No command text is shell-parsed,
  no argument is re-split, and a runner that cannot be resolved is still
  reported rather than looked up in a shell.

## Prohibited Behavior and Non-goals

Do not re-parse or re-split stored argument arrays, introduce shell invocation,
change the stored descriptor shape, require existing schema v4 repositories to
migrate again, or add a runner beyond the four already declared. Do not silently
correct a descriptor whose arguments cannot be composed — report it.

## Risk and Decision Impacts

- No parent risk disposition changes. This restores the behaviour
  `AC-CFG-002` already claims, and correcting it does not widen the command
  surface.

## Acceptance Criteria

- [ ] `AC-CFG-002`: each declared runner composes its resolved executable with
  its stored arguments into the invocation the original command described, and
  the previewed invocation is byte-identical to what execution runs.
- [ ] `AC-CFG-002`: existing schema v4 descriptors produced by migration compose
  correctly without being rewritten, and a descriptor whose arguments cannot be
  composed for its runner is reported rather than silently adjusted.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-002`, `SG-CMD-001`: composition fixtures for all four runners, driven by the exact descriptors a real migration produced, asserting preview and execution agree | `npm run test:unit` | Yes — configured unit suite owns the Command descriptor seam |
| broad-tests | both | `AC-CFG-002`: existing descriptor validation, shell-construct refusal, and Grader surface behaviour remain unchanged | `npm run test:unit` | Yes — configured regression suite protects the established command contract |

Frontend build and browser evidence are inapplicable; this slice changes command
composition, not a frontend surface.

## Blocked By

None. `TB-003` delivered the Command descriptor contract and `TB-001` delivered
the migration that produces these descriptors; both are done.

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

`resolveExecutables` is tested with an injected resolver, and every fixture
supplies an executable that concatenates correctly with its own arguments. The
composition rule was never asserted against descriptors that migration actually
produces, so preview and reality agreed in the tests and disagreed in a clone.
