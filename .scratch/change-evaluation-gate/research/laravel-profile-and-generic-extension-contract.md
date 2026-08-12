# Laravel profile and generic extension contract

Date: 2026-08-04

## Question

How should Laravel-oriented checks map onto the existing Evidence ladder, and
what contract lets other stacks provide equivalent checks without adding
framework branches to the Change Evaluation Gate?

## Decision

Keep one stack-neutral gate runner and make a **verification profile provider**
responsible for translating project facts into normalized check descriptors.
The gate consumes descriptors; it never switches on Laravel, Pint, Rector,
PHPStan, Pest, Node, or any other framework or tool name.

Retain the current Evidence-ladder stages for the first version:

1. focused
2. format
3. static-analysis
4. affected-tests
5. smoke
6. build
7. browser
8. broad-tests

Rector does not justify a new execution stage. Its dry-run is a distinct
`rewrite-check` capability executed in the `static-analysis` stage. The stage
answers *when* a check runs; the capability answers *what evidence* it
provides. This preserves the current ladder while avoiding the false claim
that Rector and PHPStan perform the same analysis.

## Ownership

- `framework-setup` discovers project facts, offers stack profiles, and writes
  confirmed exact checks into the Verification profile.
- A profile provider is a pure resolver: project facts in, normalized check
  descriptors out. It does not execute commands or decide the final gate
  outcome.
- `verify-change` selects applicable checks, executes the Evidence ladder,
  records evidence, and applies the already-decided required/advisory and
  bypass policy.
- The Change Evaluation Gate supplies the lifecycle seam and snapshot binding;
  it reuses the same runner and profile rather than creating a second verifier.

This deepens the existing seams instead of creating a Laravel-specific runner.

## Generic extension contract

Every provider emits zero or more check descriptors with these semantics. The
configuration ticket may choose the serialized JSON/YAML shape, but it must not
drop these fields.

| Field | Contract |
| --- | --- |
| `id` | Stable, namespaced identifier used in evidence and policy overrides, for example `laravel.format.pint`. |
| `stage` | One existing Evidence-ladder stage. Controls ordering only. |
| `capability` | Stack-neutral evidence kind such as `formatter`, `rewrite-check`, `static-analysis`, `test`, `smoke`, `build`, or `browser`. |
| `scope` | Confirmed source scope: `backend`, `frontend`, or `both`. |
| `applicability` | Deterministic predicates over changed paths and proved project facts. A false predicate means `not-applicable`; an unavailable requirement means `unverified`. |
| `prerequisites` | Proved executables, configuration, services, and environment needed to execute. These are evaluated before the command runs. |
| `policy` | `required` or `advisory`, subject to the gate policy. Profiles may propose a default, but installation records the confirmed project policy. |
| `evaluate` | Exact non-mutating invocation, working directory, and permitted inputs. This is the only invocation available to commit evaluation. |
| `fix` | Optional explicitly mutating invocation. It is available only through `gate fix`, never from a commit hook or `gate evaluate`. |
| `timeout` | Per-check timeout within the gate's overall budget. |
| `declaredWrites` | Allowed cache, report, screenshot, and other artifact paths. Evaluation may write declared artifacts but may not modify evaluated source files. |
| `evidence` | Covered evidence claims, success exit codes, and any declared machine-readable report or retained log metadata. Exit `0` is the default success convention. |
| `order` | Stable ordering among checks in the same stage; optional dependencies may refine it without changing the global ladder. |

The runner accepts only descriptors whose provider contract version it
supports. Providers may add new capability names without changing the runner;
adding a new stage or changing outcome semantics requires a contract-version
change.

### Result semantics

For each descriptor, the runner records the resolved invocation, snapshot
identity, applicability decision, start/end time, exit status, timeout, and
outcome. The normalized outcomes are:

- `passed`: applicable, executed, and successful;
- `failed`: applicable, executed, and produced a negative result;
- `unverified`: applicable evidence could not be produced, including a missing
  executable, invalid configuration, timeout, or infrastructure error;
- `not-applicable`: its deterministic applicability predicate did not match.

`required` and `advisory` are policy bindings, not outcomes. They determine
whether `failed` or `unverified` blocks the governed transition.

An explicit gate bypass remains an overall `bypassed` outcome and does not
rewrite any check as `passed`.

### Discovery is not silent activation

A provider may propose a check only when it proves the executable or package,
the relevant configuration, and an exact non-interactive command. Discovery is
presented during installation or reconfiguration; the accepted descriptor is
persisted. A missing capability is visible and is never filled with a guessed
command.

Focused and affected-test checks require deterministic selection from a
delivery matrix, an explicit file/filter/group, or a confirmed project impact
rule. The gate must not infer test relevance from filenames alone. A broad
suite is not a substitute for missing focused evidence, although policy may
choose whether that gap is required or advisory.

## Laravel profile

The Laravel provider maps confirmed project commands as follows. Commands are
illustrative defaults; persisted project commands remain authoritative.

| Check | Stage | Capability | Evaluate | Optional fix | Activation rule |
| --- | --- | --- | --- | --- | --- |
| Focused Pest test | `focused` | `test` | `php artisan test --compact <file-or-filter>` or confirmed `./vendor/bin/pest` equivalent | none | A delivery matrix or explicit selection supplies the target. |
| Pint | `format` | `formatter` | `./vendor/bin/pint --test` with a confirmed path selection when safe | `./vendor/bin/pint` with the project's confirmed options | Pint is installed and configured or accepted with its project defaults. |
| Rector | `static-analysis` | `rewrite-check` | `./vendor/bin/rector process --dry-run` | `./vendor/bin/rector process` | Rector is installed and its configuration resolves the intended source paths. |
| PHPStan/Larastan application analysis | `static-analysis` | `static-analysis` | `./vendor/bin/phpstan analyse` or an exact source-scoped equivalent | none | PHPStan configuration and application paths are confirmed. Larastan is represented by the configured PHPStan invocation, not a separate runner. |
| PHPStan/Larastan test analysis | `static-analysis` | `static-analysis` | `./vendor/bin/phpstan analyse tests` | none | Tests are not already covered by the confirmed application-analysis invocation and the project supports analysing them. |
| Affected Pest suite | `affected-tests` | `test` | Exact test files, `--filter`, `--group`, or `--testsuite` invocation | none | A deterministic impact rule selects it. |
| Laravel smoke check | `smoke` | `smoke` | Confirmed smoke group, route probe, console test, or browser smoke invocation | none | The repository declares the smoke contract and its required services. Laravel has no universal smoke command. |
| Build | `build` | `build` | Confirmed project build command, commonly a package script such as `npm run build` | none | The changed scope affects a declared build capability. A Laravel backend alone does not imply a frontend build. |
| Browser check | `browser` | `browser` | Confirmed Pest Browser, Dusk, or equivalent real-browser suite | none | User-visible behavior is affected and the repository has a proved browser capability and environment. Livewire/component tests alone are not browser evidence. |
| Broad Pest suite | `broad-tests` | `test` | `php artisan test --compact` or the confirmed project equivalent | none | Laravel tests are configured and the gate budget/policy requires the broad suite. |

If one PHPStan command already analyses both application and test paths, the
provider emits one descriptor with separate application and test evidence
claims. It must not run the same analysis twice merely to populate two labels.

The Laravel preset should propose discovered, deterministic code-health checks
(Pint, Rector, PHPStan/Larastan, and the broad test suite) as required. Focused,
affected, smoke, build, and browser checks become required only when their
applicability and exact command are proved for the project. The installer must
show the proposed policy before persisting it.

## Evaluation and fix ordering

Evaluation is always non-mutating. Within the Laravel profile, Pint runs in the
format stage; Rector dry-run and PHPStan checks then run in stable declared
order in the static-analysis stage. An explicit fix workflow should run Rector
before Pint because structural rewrites can create formatting changes, then
rerun the complete non-mutating evaluation against the resulting snapshot.

## Current framework gap

The existing `framework-setup` discovery already recognizes Pint, PHPStan, and
Laravel tests, and the Verification profile already stores free-form
capabilities and exact commands by scope and category. It currently:

- records a mutating Pint command rather than a separate check-only/fix pair;
- does not discover Rector;
- does not distinguish application analysis from test analysis;
- has no descriptor fields for applicability, required/advisory policy,
  prerequisites, timeouts, declared writes, or evidence semantics;
- discovers smoke, build, and end-to-end commands mainly from package scripts.

These are schema and discovery gaps for later implementation tickets, not a
reason to replace `framework-setup` or `verify-change`.

## Rejected alternatives

- **Framework branches in the gate:** couples lifecycle enforcement to every
  supported stack and makes plugins impossible to version independently.
- **One opaque `quality` command:** easy to invoke but loses per-check policy,
  timeout, evidence, and actionable failure reporting.
- **Run all installed tools automatically:** package presence does not prove a
  valid configuration, intended scope, or safe non-mutating command.
- **Use mutating formatters or Rector in commit evaluation:** changes the
  snapshot being approved and violates the check-only gate policy.
- **Add a Rector stage now:** expands the global state machine for one tool even
  though stage and capability are intentionally separate dimensions.

## Primary sources

- [Laravel 13 testing](https://laravel.com/docs/13.x/testing) documents
  `vendor/bin/pest`, `vendor/bin/phpunit`, `php artisan test`, suite arguments,
  and parallel execution.
- [Laravel Pint](https://laravel.com/docs/13.x/pint) distinguishes mutating
  formatting from the non-mutating `--test` check and supports path targeting.
- [PHPStan command-line usage](https://phpstan.org/user-guide/command-line-usage)
  defines `analyse`, path arguments, and exit-code behavior.
- [Larastan](https://github.com/larastan/larastan) is a Laravel extension loaded
  through PHPStan configuration and executed with `phpstan analyse`.
- [Rector documentation](https://getrector.com/documentation/how-rector-works)
  distinguishes mutating `process` from `process --dry-run`.
- [Pest CLI API](https://pestphp.com/docs/cli-api-reference) documents file,
  filter, group, and test-suite selection.
- [Pest browser testing](https://pestphp.com/docs/browser-testing) documents
  real-browser execution, while Pest's browser-testing overview documents
  `assertNoSmoke()` for declared route smoke coverage.

## Conclusion

The generic unit of extension is a normalized check descriptor inside the
existing Verification profile. Laravel is the first provider of those
descriptors, not a special mode of the Change Evaluation Gate. This contract
is sufficient input for the later shared-interface and configuration-schema
tickets without committing those tickets to a particular serialization or
runtime implementation.
