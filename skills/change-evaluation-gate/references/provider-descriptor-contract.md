# Provider check descriptor contract (version 1)

This is the seam between a stack Verification provider and Gate evaluation.
A provider is a pure resolver: proved project facts in, normalized check
descriptors out. Gate core consumes descriptors and never learns which stack
produced them.

Implementation: `../scripts/lib/check-descriptor.mjs`,
`../scripts/lib/command-descriptor.mjs`, `../scripts/lib/gate-core.mjs`.

## Provider interface

```js
{ id, contract_version, resolve(facts) }
```

`resolve` returns:

```js
{ provider, contract_version, descriptors: [...], capability_gaps: [...] }
```

Gate core rejects a provider whose `contract_version` it does not support,
whose output is attributed to a different provider, or whose descriptors do not
validate. It never repairs, guesses, or partially accepts one provider's output.

## Check descriptor fields

| Field | Contract |
| --- | --- |
| `id` | Stable dotted identifier namespaced by its provider, for example `laravel.format.formatter`. |
| `provider` | The provider that emitted the descriptor. |
| `stage` | One Evidence ladder stage. Controls ordering only. |
| `capability` | Stack-neutral evidence kind, for example `formatter`, `rewrite-check`, `static-analysis`, `test`, `smoke`, `build`, `browser`. |
| `scope` | `backend`, `frontend`, or `both`. |
| `applicability` | `changed_path_globs` and `required_facts`: deterministic predicates only. |
| `prerequisites` | Proved `executable`, `configuration`, `service`, or `environment` requirements. |
| `policy` | The proposed `required` or `advisory` binding. |
| `evaluate` | The only non-mutating invocation available to commit evaluation. |
| `fix` | Optional explicitly mutating invocation; never reachable from evaluation. |
| `timeout_seconds` | Per-check budget; must cover its evaluation command timeout. |
| `declared_writes` | Repository-relative artifact paths evaluation may write. |
| `evidence` | `claims`, `success_exit_codes`, and an optional machine-readable `report`. |
| `order` | Stable ordering within a stage. |
| `selection` | Deterministic test selection; required for `focused` and `affected-tests`, `null` elsewhere. |

## Prerequisites

A prerequisite is `{ kind, name }`, where `kind` is one of `executable`,
`configuration`, `service`, or `environment`. It states what a check needs in
order to produce evidence at all. Whoever owns the check declares it — a stack
provider through its descriptors, or the clone itself beside a configured
verification command. Gate core never proposes one and never learns why one is
needed.

Before a check runs, every prerequisite it declares is proved against the
environment the evaluation built. What is not proved makes the check
`unverified` with `prerequisite-missing`, naming what was not proved; the
command is never started, so nothing about the code is claimed. A required
check in that state denies exactly as it did before — this changes the reason a
maintainer is given, never the authorization.

| Kind | Proved when |
| --- | --- |
| `executable` | `name` resolves on the search path the checks themselves run with — the pinned executables, their pinned interpreters, and the platform's utility directories. |
| `configuration` | `name` is a repository-relative path the evaluated tree holds: tracked content the snapshot materialized, or a declared dependency root that was provided beside it. |
| `service` | Never. Nothing here probes a service, and absence of evidence is not evidence of presence. |
| `environment` | `name` is either a fact the evaluation states about itself, or an environment variable name the check will actually be given — declared in the command's `allowed_environment` and present in the invoking environment. |

The environment facts an evaluation can state are properties of the evaluation,
never of a toolchain. There is one: `source-control-history`, proved only where
the executed tree is the repository itself. An evaluation materializes an exact
snapshot elsewhere so the graded tree cannot move, and a tree of files is not a
repository — so a command whose arguments depend on one says so instead of
reporting whatever its refusal to start looked like.

Nothing is inferred. No exit code, error string, or line of tool output decides
that a failure was environmental: a requirement is declared and proved, or it is
not proved. A heuristic would be worse than no check at all, because it would
sometimes hide a real failure of the code.

## Evidence ladder stages

The eight ordered stages are owned by `verify-change` and imported, not
restated: `focused`, `format`, `static-analysis`, `affected-tests`, `smoke`,
`build`, `browser`, `broad-tests`.

Stage answers *when* a check runs; capability answers *what evidence* it
provides. A rewrite check therefore runs in `static-analysis` as a distinct
capability rather than earning a stage of its own.

## Outcomes and policy bindings

Exactly four outcomes: `passed`, `failed`, `unverified`, and `not-applicable`.

- `not-applicable` means the deterministic predicate did not match.
- `unverified` means applicable evidence could not be produced — missing
  executable, invalid configuration, timeout, or infrastructure error.

`required` and `advisory` are policy bindings, not outcomes. They decide whether
`failed` or `unverified` blocks a governed transition.

## Extension rules

- A provider may add a **capability** name freely; Gate core has no capability
  list and needs no branch.
- Adding an Evidence ladder **stage** or changing **outcome** semantics requires
  a new contract version. A core that does not support that version rejects the
  provider instead of reinterpreting it.

## Command safety

Command descriptors are the schema v4 shape: logical runner, argument array,
repository-relative working directory, timeout, allowed environment names,
evidence category, and source scope.

- Only `composer-bin`, `php-script`, `package-script`, and `repository-script`
  are accepted; any other runner is `runner-unresolved`.
- Shell operators, pipes, redirection, substitutions, quotes, globs, escapes,
  newlines, and inline environment assignments are rejected before execution.
- Complex behavior belongs in an explicitly declared `repository-script`, which
  is reported as a Grader surface.
- Activation resolves each logical runner to a platform executable, records and
  pins its identity and version, and previews the human-readable command. An
  unresolved runner is reported, never looked up through a shell.
- Resolution happens once, at activation. A `composer-bin` runner resolves to
  the absolute path of the named binary under the vendor directory of the
  descriptor's own working directory; a name containing a path separator is
  refused rather than joined. The authoritative hook runs the executables the
  receipt pinned and never re-resolves them: a pin that is absent, or that no
  longer matches its runner, denies and names `gate repair`. Substituting a
  different program is never a recovery.
- Resolving an executable includes resolving what it needs in order to start.
  Most real tool binaries are scripts naming an interpreter in their first
  line, so resolution reads that line and pins the interpreter beside the
  executable; an interpreter that cannot be found leaves the runner
  `runner-unresolved` and refuses activation, rather than becoming an
  `exit 127` at commit time that reads like the maintainer's code failing.
- A check runs with the environment names its descriptor declares, plus a
  runtime-owned search path built from the pinned executables, their pinned
  interpreters, and the platform's own utility directories — in that order.
  Nothing of the invoking shell is inherited, so no version manager or
  package-manager prefix can change which program a pinned command reaches. A
  descriptor that also declares `PATH` has its ambient value appended after the
  runtime's own entries, never before them.

### Argument composition

How a resolved executable and a stored argument array combine is stated by the
runner, not by the resolver and not by each caller. One rule serves both the
preview and the executor, so the previewed invocation is byte-identical to the
one execution runs.

| Runner | Composition |
| --- | --- |
| `composer-bin` | The leading argument names the binary under the vendor directory and is consumed by resolution; the rest is passed to it. |
| `package-script` | The arguments name a package script, reached through the `run` subcommand. |
| `php-script` | Arguments are passed through unchanged. |
| `repository-script` | Arguments are passed through unchanged. |

Composition only selects, reorders, or prefixes whole stored arguments. It never
parses, splits, joins, or re-quotes one. A descriptor whose arguments its runner
cannot compose — a `composer-bin` descriptor with no binary name, for example —
is reported as `command-args-uncomposable` and refused, never adjusted into
something that happens to run.

## Capability gaps

A plan entry with no proved command, or a focused/affected check with no
deterministic selection, produces a visible capability gap instead of a
descriptor. Recognized reasons: `command-not-proved`, `capability-not-proved`,
`prerequisite-not-proved`, `selection-not-deterministic`, `runner-unresolved`.

Test relevance is never inferred from filenames. A selection must come from a
delivery matrix, an explicit filter, or a confirmed impact rule.
