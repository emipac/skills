# FS-001 — Run a skill script through the path a client installed it at

Status: ready-for-agent
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 01-run-a-skill-script-through-the-path-a-client-installed
Draft key: FS-001

**Status:** ready-for-agent

**Parent feature contract:** none. This is a cross-skill defect in how every
released script decides whether it was run as a command. No feature contract
governs script entry points, and a one-line comparison fix in five files does
not warrant writing one first. Everything below is stated so an implementer can
work without it.

## Outcome

A released skill script does what it was asked to do when it is invoked through
the path a client installed it at, whatever that path is. It never loads, produces nothing, and exits
successfully.

## Defect this contract fixes

Verified, reproduced on a real project (`gms`) that installs for both Claude and
the shared agent layout:

```
node .claude/skills/framework-setup/scripts/configure.mjs --discover   → 0 bytes, exit 0
node .agents/skills/framework-setup/scripts/configure.mjs --discover   → 2758 bytes of JSON
```

Cause. Every released script guards its CLI entry the same way — the only
variant in the repository is this one:

```js
process.argv[1]
&& import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
```

`import.meta.url` is the **resolved** module URL. `path.resolve(process.argv[1])`
is not resolved — it normalizes a path but follows no symbolic link. A client
that installs by linking therefore produces two different URLs for one file:

```
argv-style : file:///…/gms/.claude/skills/framework-setup/scripts/configure.mjs
realpath   : file:///…/gms/.agents/skills/framework-setup/scripts/configure.mjs
```

`.claude/skills/framework-setup` is a symbolic link to
`../../.agents/skills/framework-setup`. The comparison fails, `runCli()` is
never called, the module finishes loading, and the process exits **0** having
printed nothing.

Verified: all five released scripts carrying this guard are affected, and every
one of them works through the real path.

| Skill | Through `.claude/skills` | Through `.agents/skills` |
| --- | --- | --- |
| `framework-setup` | silent, exit 0 | works |
| `srs-modeling` | silent, exit 0 | works |
| `to-spec` | silent, exit 0 | works |
| `to-tickets` | silent, exit 0 | works |
| `verify-change` | silent, exit 0 | works |

`audit-ticket-contracts.mjs` demonstrates it plainly: run through `.agents` it
prints its usage line; run through `.claude` it prints nothing at all.

**Why this is worse than a broken command.** Exit `0` with empty output is
indistinguishable from success. A maintainer's agent hit this and spent several
turns diagnosing the wrong thing — blaming output compression in its tooling,
then writing output to temporary files, then reaching for the module's exported
API — because nothing anywhere reported a failure. The correct diagnosis was
reached eventually, but only after the work had been abandoned once.

This is the same shape as `TB-043` in the Gate: a path reached through a
symbolic link compared unequal to its canonical form, and the mismatch surfaced
as an unrelated-looking failure somewhere far away.

## Approach and Tradeoffs

Verified: the guard is textually identical in all five scripts — a repository-wide
search for `import.meta.url ===` returns exactly one distinct right-hand side.
So there is one rule to change, in five places, with no per-script variation to
reconcile.

Proposed — compare resolved against resolved. `import.meta.url` is already
resolved; resolve the argument side too before comparing. The implementer
confirms the chosen resolution behaves when `process.argv[1]` names a path that
does not exist or cannot be read, since a comparison that throws would turn a
silent no-op into a crash on every import.

Proposed — one definition, not five copies. Five identical comparisons are five
chances to fix four of them. Whether that becomes a shared helper or something
else is the implementer's call, but the same rule must not be independently
restated per script. If a shared module is not workable across skill boundaries
— skills are installed independently and may not import each other — say so and
state what was done instead.

Proposed — prove it through a link. A fixture that invokes a script through a
symbolic link and asserts it produced its real output is the test that would
have caught this. Asserting a script works through its own real path passes
today and proves nothing.

Deliberately not a change to what any script does once it runs, to any script's
arguments, output, or exit statuses, or to how skills are installed. The
installation layout is correct; the scripts are wrong about their own identity.

## Architecture Boundary and Public Seam

The boundary is between the path a client used to invoke a script and the path
the script believes it lives at. The public seam is the entry guard each script
uses to decide whether it is being run as a command.

First red test: a script invoked through a symbolic link to itself performs its
command, where today it exits `0` having done nothing.

## Safeguards and Invariants

- A script imported as a module — not run as a command — still runs no CLI. The
  fix must not make importing a script execute it.
- Every script keeps its current arguments, output, and exit statuses.
- A missing or unreadable `process.argv[1]` is not a crash.
- No skill gains a dependency on another skill's files.

## Prohibited Behavior and Non-goals

Do not change what any script does once it runs. Do not change any script's
arguments, output format, or exit statuses. Do not change how skills are
installed, linked, or copied, and do not remove the `.claude/skills` layout. Do
not make an imported module execute its CLI. Do not special-case an operating
system or a client name.

## Acceptance Criteria

- [ ] Each of the five released scripts, invoked through a symbolic link to
  itself, produces exactly the output it produces through its real path.
- [ ] Each script, imported as a module, still runs no CLI.
- [ ] A `process.argv[1]` naming a path that does not exist does not throw.
- [ ] Every script's existing arguments, output, and exit statuses are unchanged,
  proved by the suites that already cover them.
- [ ] The rule is stated once. If it could not be shared across skill
  boundaries, the report says why and what was done instead.
- [ ] A fixture would fail if any one of the five scripts were reverted to the
  old comparison — so fixing four of five cannot pass.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | invoked-through-a-link, imported-as-a-module, missing-argv, and per-script-coverage fixtures against the real scripts | `npm run test:unit` | Yes — the unit suite owns these scripts |
| smoke | both | a real installation invoked through the linked client path produces the same output as the real path | `npm run test:install`, extended by this slice | Yes — that capability already performs real installations for every client layout |

Frontend build and browser evidence are inapplicable; this slice changes local
script entry points.

## Blocked By

None.

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

Every unit test imports these modules and calls their exported functions, which
is the right way to test them and never exercises the guard. `test:install`
performs real installations for every client layout and then asserts on the
*contents* of installed files — it has never run one. So the one line that
decides whether a script does anything at all is the one line nothing executes.
