# Drove framework-setup from the plan, and gave newcomers a quick start

The `framework-setup` skill documented every Guided setup command, but its own
workflow predated them. An agent following it guessed the next step, invented
draft paths, never used `config suggest` or the named revisions, never reached
activation, and was told to "rerun the identical configure command" to prove
idempotency — which, on a schema v4 file, rewrites it as v3 and drops the Gate
section (recorded as FS-005).

- Rewrote `SKILL.md` as a lean workflow driven by
  `agent-framework setup --json`: discover, base configuration, an explicit
  opt-in question for the Gate, migration and Gate policy, `config suggest`
  before activation, doctor and activation with the Git-or-Cursor client
  question, then verify and report.
- Stated the rules that keep an agent on the rails: ask the plan for the state
  before and after every step; run its commands verbatim, draft paths included;
  run any preview, but confirm only after the maintainer approves that exact
  preview in the conversation; never answer the interactive prompts or pass
  `--consent-channel`; never hand-edit `evaluation_gate`; run base setup only in
  `no-configuration` or `schema-v3`.
- Moved the command reference and the direct migration and Gate-configuration
  transactions, unchanged, into `references/framework-command.md` and
  `references/schema-and-gate-transactions.md`. `SKILL.md` went from 498 to 226
  lines.
- Added to the framework guide: how to run the `agent-framework` command (direct
  path, alias, or `npm link`); a seven-step quick start for a new project; an
  agent shortcut using the skill; a warning that the guided client question is
  not about the tracker; and how to add Cursor to a clone already activated for
  Git. Corrected the claim that a desktop client is "a separate, later
  invocation".

Verification: `npm run validate`, `npm run test:install`, and
`npm run test:unit` (795 passing).

## Decomposed the Framework command

- Extracted `agent-framework.mjs` into 20 modules under
  `scripts/lib/agent-framework/`, grouped into setup, configuration, guardrail,
  and report responsibilities, with command dispatch and supporting helpers.
- Kept the original executable path, all ten public exports, and the CLI block.
  The entry point went from 2,550 to 44 lines. All 128 declarations are unchanged
  apart from the entry-script path anchor required by its new module location.
- Preserved the existing Gate locator, entry-point helper, and terminal module
  in place. The extracted modules have no circular imports.
- Extended the ownership test to inspect every extracted module and added a
  regression test for the original public exports.

Verification: setup, entry-point, Claude Code guardrail registration, and Cursor
guardrail registration tests passed; `npm run validate`, `npm run test:install`,
and `git diff --check` passed. The installation smoke needed network access to
fetch the skills installer after the sandbox could not resolve npm's registry.
PHP, Filament, and browser test layers do not apply to this Node CLI decomposition.

## Decomposed configuration setup

- Extracted `configure.mjs` into the planned 27 modules under
  `scripts/lib/configure/`, grouping discovery, migration, Gate policy,
  revisions, guardrail registration, and base setup separately.
- Kept the original command path, CLI guard, and all 19 public exports. The
  entry point went from 3,235 to 32 lines. All 120 declarations are unchanged
  apart from six location-dependent path references required by extraction.
- Preserved lazy Gate imports, preview and confirmation behavior, write
  mechanisms, and the existing callers in `lib/agent-framework/`. The extracted
  modules have no circular imports.
- Extended the check-catalogue ownership test to scan every extracted module,
  added public-export and standalone-install regression tests, and updated the
  installation smoke to inspect the evidence default in the extracted drafter.

Verification: 70 configuration/draft tests and 129 Framework command,
entry-point, and guardrail registration tests passed. `npm run validate`,
`npm run test:install`, and whitespace checks passed. PHP, Filament, and browser
test layers do not apply to this Node CLI decomposition.

## Decomposed Gate lifecycle

- Extracted `scripts/lib/lifecycle.mjs` into the planned 11 modules under
  `scripts/lib/lifecycle/`, separating release inspection, update, status,
  deactivation, uninstall, configuration cleanup, repair, evidence pruning,
  coordination inspection, constants, and receipt lineage.
- Kept the original import path and all 19 public exports. The facade went
  from 1,452 to 64 lines. All 27 declarations are byte-identical apart from
  export keywords, including their complete transaction and observation bodies.
- Preserved confirmation hashes, update and rollback order, ownership and
  drift checks, read-only status, and existing write mechanisms. The extracted
  modules have no internal circular imports.
- Extended the remedy-literal guard to all nested Gate library modules and
  the client-name guard to the lifecycle implementation. Updated the
  status-finding coverage test to inspect its new source location and added
  a regression test for all public exports.

Verification: the 108-test baseline passed; after extraction, 298 affected
tests passed. Lifecycle, activation, hook-conformance, and installation smoke
checks passed, along with `npm run validate` and whitespace checks. PHP,
Filament, and browser test layers do not apply to this Node library decomposition.

## Decomposed Gate activation

- Extracted `scripts/lib/activation.mjs` into 22 modules under
  `scripts/lib/activation/`, grouping hook handling, adapter registration,
  read-only inspection, activation, sync, receipt helpers, and transaction
  bookkeeping.
- Kept the original import path and all 37 public exports. The facade went
  from 2,920 to 86 lines. All 73 declarations are byte-identical apart from
  export keywords; the activation and sync pipeline bodies remain intact.
- Preserved preview and receipt identities, consent checks, transaction order,
  reverse rollback, hook ownership and drift checks, atomic publication, and
  sync's retention of existing registrations. The extracted modules have no
  internal circular imports.
- Extended the client-ownership assertion to scan the extracted implementation
  recursively and added a regression test for the public exports.

Verification: 297 affected tests passed, along with the activation, lifecycle,
and hook-conformance smoke checks. `npm run validate`, `npm run test:install`,
and whitespace checks passed. Installation verification needed network access
after the sandbox could not resolve npm's registry. PHP, Filament, and browser
test layers do not apply to this Node library decomposition.

## Decomposed Gate adapters

- Extracted `scripts/lib/adapters.mjs` into 12 modules under
  `scripts/lib/adapters/`, separating declaration contracts, the static client
  registry, capability and registration validation, native identity and
  repository normalization, decision and feedback presentation, evaluation,
  compatibility baselines, support classification, and shared value checks.
- Kept the original import path and all 27 public exports. The facade went
  from 1,895 to 68 lines. All 52 declarations are byte-identical apart from
  export keywords, including the complete frozen registry, invocation pipeline,
  and compatibility baseline.
- Preserved client roles, trust and feedback declarations, native field shapes,
  timeout behavior, role-derived authorization, feedback limits, remedy lookup,
  captured-payload evidence, and support classification. The extracted modules
  have no internal circular imports.
- Extended client-name coverage to every extracted module outside the registry,
  pointed native-field ownership and installation checks at the moved registry,
  and added a regression test for the public exports. The existing recursive
  remedy guard covers the new implementation.

Verification: the 84-test baseline passed; after extraction, 222 affected tests
passed. Adapter conformance, runtime portability, and installation smoke checks
passed, along with `npm run validate` and whitespace checks. PHP, Filament, and
browser test layers do not apply to this Node library decomposition.

## Decomposed the Gate operator surface

- Extracted `scripts/lib/operator-surface.mjs` into the planned 32 modules
  under `scripts/lib/operator-surface/`, separating argument parsing, command
  contracts, clone resolution, runtime discovery, outcomes, document assembly,
  command dispatch, 13 command handlers, and text rendering.
- Kept the original import path and all 15 public exports, including the
  `PACKAGED_COMMAND` re-export. The facade went from 3,639 to 91 lines.
  All 101 declarations are unchanged apart from export keywords and the
  `HERE` directory anchor required to preserve the original installed paths.
- Preserved complete parser and handler bodies, confirmation and selector
  behavior, preview hashes, consent metadata, exit codes, JSON and text output,
  store-opening conditions, and the bounded installed-manifest search.
  The extracted modules have no internal circular imports.
- Extended the doctor platform-branch scan and control-surface ownership
  assertion to inspect the extracted operator implementation. Added public
  export and packaged-path regression coverage; the existing recursive remedy
  guard continues to cover every new module.

Verification: the 132-test analysis baseline passed; after extraction, 159
affected tests passed. Activation, lifecycle, hook-conformance, and installation
smoke checks passed, along with `npm run validate` and whitespace checks. PHP,
Filament, and browser test layers do not apply to this Node CLI decomposition.

## Added a local project dashboard

- Added `agent-framework ui [--project <directory>] [--port <0..65535>]`,
  a dependency-free loopback dashboard bound to one canonical project. Server,
  jobs, operation contracts, validation, setup review, worktree discovery, and
  report export live in focused modules under Framework's `scripts/lib/ui/`;
  native browser assets live in `scripts/ui-assets/`.
- Added overview, guided setup, checks and snapshot results, effective/pinned
  configuration, activity and evidence, maintenance, and beginner guides.
  Existing commands still own behavior; Framework reaches Gate only through
  its executable/JSON boundary. Static report export keeps the existing
  non-interactive format and downloads HTML without changing the project.
- Kept mutations behind exact reviewed, expiring, one-use previews and separate
  confirmations. Configuration revisions and re-pinning remain independent.
  Initial setup refuses existing configuration and linked destination paths.
  Added authentication, Host/Origin checks, a static asset allowlist, bounded
  serial jobs, safe text rendering, and graceful owner-operation shutdown.
- Added read-only `gate history` for verified, bounded clone-wide evidence and
  coordination facts. It creates no store, authorizes log reads through their
  selected envelope, and verifies retained bytes. The dashboard distinguishes
  Git worktrees from temporary evaluation snapshots and does not infer live
  per-check progress or invent durable records for passing operator checks.
- Used staged subagent investigations, implementation, parent verification,
  and independent reviews. Fixed an asynchronous startup import cycle, setup
  symlink escapes, confirmation eviction at queue capacity, and hidden owner
  refusals before completing browser verification.

Verification: all 55 final affected tests passed. The full regression suite
(894 passed, one existing skip),
installation checks for all five clients through installed and linked paths,
activation smoke (23 scenarios), lifecycle smoke (7 scenarios), repository
validation, and whitespace checks passed. Real browser checks covered
activation preview/cancel/confirm, focus restoration, check results, pinned
values, session URL removal, report download, and responsive tables. The final
browser run reported no console errors and no secret-canary output. Loopback
tests required approved execution outside the sandbox; activation smoke used
an isolated temporary directory to avoid cross-suite directory-list changes.

Added a dashboard usage guide to `docs/framework-guide.html` as Section 16,
with contents, installation, and quick-start links. It covers launch options,
the seven screens, reviewed setup, checks and evidence, maintenance, session
credentials, and static report downloads while preserving existing anchors
and policy examples. Updated the displayed release to 0.12.0.

Verification: all 23 guide and Gate configuration tests passed, along with
repository validation and whitespace checks. Browser checks confirmed the
new section, seven-screen table, desktop and mobile widths without horizontal
page overflow, and no console errors or warnings.
