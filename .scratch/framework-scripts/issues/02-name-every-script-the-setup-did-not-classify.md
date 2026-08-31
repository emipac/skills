# FS-002 — Name every script the setup did not classify

Status: ready-for-agent
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 02-name-every-script-the-setup-did-not-classify
Draft key: FS-002

**Status:** ready-for-agent

**Parent feature contract:** none. `framework-setup` owns deterministic project
discovery and configuration, and no feature contract governs how it decides
which package scripts are verification commands. Everything below is stated so
an implementer can work without one.

## Outcome

A project script the setup does not recognise is named in the discovery output,
so a maintainer can see it was left out and decide what to do. And a script
whose name begins `types` is recognised, because it is a type check.

## Defect this contract fixes

Verified on a real project (`gms`) that installs this framework.

`package.json` declares `"types:check": "svelte-check --tsconfig ./tsconfig.json"`.
Running it checks 4238 files and exits `0`. It is a real, installed, working
type check: `svelte-check` is declared at `^4.1.4` and its binary is present.

It is absent from the generated `.agent-framework.yaml`. That project's
`static_analysis.frontend` holds only `lint:check`, which runs ESLint and checks
no types at all. So a TypeScript or Svelte type error in that project can reach
a commit with nothing to stop it, and nothing said so.

Cause. `discoverVerification` classifies each package script by splitting its
name at the colon and looking the first part up in `scriptCategories`
(`configure.mjs:1263`), whose keys are `format`, `lint`, `typecheck`,
`type-check`, `test`, `smoke`, `build`, and `e2e`. The base of `types:check` is
`types`, which is not a key, so the resolver returns `null`
(`configure.mjs:1365-1367`) and the script is dropped.

Two things follow, and the second is the one that matters.

- **`types` is a missing synonym.** The table already carries `typecheck` and
  `type-check`. A third spelling of the same thing was not thought of. Verified:
  the same project's `composer.json` also names a `types:check` script, so this
  is a convention the project uses rather than a one-off.
- **A dropped script leaves no trace anywhere.** Verified: the discovery output
  for that project contains `lint:check` and does not contain `types:check`. It
  is not in the configuration, not in the discovery report, not in the
  `ambiguities` list, and produces no warning. Adding `types` fixes one name and
  leaves the silence, so the next unrecognised name is lost the same way.

Verified: an explicit script scope cannot rescue it either. The `scriptScopes`
branch is checked *after* the unknown-base return, so a maintainer who declared a
scope for the script still gets nothing.

## Approach and Tradeoffs

Verified: `discoverVerification` already returns `{ profile, capabilities,
commands }` (`configure.mjs:1442`), and `discoverProject` already embeds that
under `verification` (`configure.mjs:1537`). There is one place a list of
unclassified scripts would belong, and it is already the thing `--discover`
prints.

Verified: the migration path already has a vocabulary for "the tool cannot work
this out" — `status: "requires-mapping"` with an `ambiguities` array. It is used
where the tool needs an answer before it can proceed.

Proposed — add `types` to the category table, mapped exactly as `typecheck` and
`type-check` already are. The implementer confirms the qualifier rules that
apply to those two apply to it, so `types:check` is accepted and a name like
`types:watch` is still refused for the same reason `typecheck:watch` is.

Proposed — report what was not classified, and do not ask about it. Each script
the resolver declined is named in the discovery output, with the reason it was
declined where one is available. This is information, not a question: nothing
blocks, nothing must be answered, and the configuration written is byte-identical
to what it is today. A project's `dev`, `setup`, and `post-autoload-dump` scripts
genuinely are not verification commands, so asking about every unrecognised name
would be worse than useless — while listing them cannot be wrong about intent.
The implementer decides the exact field and shape and states it.

Proposed — keep it out of `ambiguities`. That list means "answer this before I
can continue", and these do not block. Putting them there would make every
project with an ordinary `dev` script look unconfigurable. If the implementer
finds a reason this belongs there after all, they say so rather than assuming.

Deliberately not a guess about intent. Nothing infers that an unrecognised
script is probably a check from its name, its qualifier, or what it runs. The
tool reports what it did not classify and stops there.

Deliberately not a change to what a recognised script produces. The commands,
categories, scopes, timeouts, and capabilities derived today stay exactly as
they are, apart from `types` now being recognised.

## Architecture Boundary and Public Seam

The boundary is between the scripts a project declares and the ones the setup
turns into verification commands. Today anything that falls outside is
discarded with no record. The public seam is the discovery output, which gains
the list of scripts that were declined.

First red test: discovery of a project declaring `types:check` names that script
as a classified type check, and discovery of a project declaring an unrecognised
script names it in the not-classified list — where today neither appears at all.

## Safeguards and Invariants

- Repeat runs stay byte-identical. `framework-setup` must retain unit coverage
  proving this, and the new output must be ordered deterministically.
- Every discovered `AGENTS.md` stays byte-for-byte unchanged.
- The configuration written for a project that declares no new script names is
  identical to what it is today, `types` aside.
- Nothing new blocks. A project with unrecognised scripts is still fully
  configurable without answering anything about them.
- The unsafe-qualifier rules still refuse what they refuse today; recognising
  `types` must not admit `types:watch`, `types:fix`, or any other qualifier the
  table already treats as unsafe.

## Prohibited Behavior and Non-goals

Do not infer that an unrecognised script is a verification command. Do not add
an unrecognised script to any category, capability, or command list. Do not put
unclassified scripts in `ambiguities` or make them block a migration. Do not
prompt, warn on stderr, or change any exit status. Do not change how recognised
scripts are classified, scoped, or timed. Do not rename or edit any project's
scripts. Do not extend this to composer scripts unless the same resolver already
governs them — establish that first and say what you found.

## Acceptance Criteria

- [ ] A project declaring `types:check` gets it classified as a type check,
  exactly as `typecheck:check` and `type-check:check` are.
- [ ] A qualifier the table treats as unsafe is still refused for `types`, so
  recognising the base does not widen what is accepted.
- [ ] A project declaring a script the resolver declines has that script named
  in the discovery output, with the reason where one is available.
- [ ] That project still configures without answering anything about those
  scripts, and nothing about the written configuration changes because of them.
- [ ] Repeat discovery and repeat configuration are byte-identical, and the
  not-classified list is ordered deterministically.
- [ ] A project whose scripts are all recognised produces discovery output whose
  meaning is unchanged, and an empty not-classified list rather than a missing
  one.
- [ ] The real case is covered: a fixture declaring `types:check` alongside
  `dev`, `setup`, and `post-autoload-dump` classifies the first and names the
  other three without asking about any of them.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | types-recognised, unsafe-qualifier-still-refused, unclassified-reported, nothing-blocks, and byte-identical-repeat fixtures against the real discovery | `npm run test:unit` | Yes — the unit suite owns `framework-setup` discovery and configuration |

Smoke, frontend build, and browser evidence are inapplicable; this slice changes
local project discovery and writes no new state.

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

Every discovery fixture declares scripts the table already knows, because a
fixture is written to prove a classification works. A script the table does not
know has never been declared in one, so the branch that discards it has never
produced an observable result to assert on. The suite proves what the tool
recognises and has never asked what it does with everything else.
