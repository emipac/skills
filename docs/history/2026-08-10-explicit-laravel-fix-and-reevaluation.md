# Explicit Laravel fix and reevaluation

Delivered TB-007 as the separation between check-only evaluation and mutation:
the Gate may fix code, but only when asked by name, and never on its own
authority.

- Made commit evaluation reject mutating descriptors. A command declared in a
  check's `fix` slot is the mutating one; a check that offers a declared fix
  command as its check-only `evaluate` command is refused before any snapshot is
  materialized and before any check runs, whether it borrowed its own fix or
  another check's. The whole binding is refused rather than quietly evaluated
  without the offending check.
- Added the explicit fix operation `runFix(request, dependencies)`. Mutation is
  reachable only through `operation: 'fix'` and only through the separate
  `executeFix` seam, so the evaluation seam can never be handed a mutating
  command by accident.
- Kept mutation ordering provider-owned. A provider plan entry declares
  `fix_order`, the provider emits the resolved `fix_plan`, and gate core carries
  it without computing it. The Laravel provider declares a structural rewrite
  before formatting; gate core and the fix orchestration name no tool and no
  stack.
- Gave mutations their own outcome vocabulary — `applied`, `failed`,
  `unverified`, `not-run` — rather than Check outcomes, because a mutation
  produces no evidence. A mutation that does not apply halts the remaining
  declared order.
- Required a new evaluation after every fix. Authorization is read from the
  post-fix decision or from nowhere: a fix whose every mutation applied cleanly
  still denies when its reevaluation could not complete, and the superseded
  decision is recorded rather than reused.
- Made Laravel policy defaults earned. Proved style, rewrite-check,
  static-analysis, and broad-test checks are proposed as required; focused,
  affected-test, smoke, build, and browser checks are `earnable` and stay
  advisory until the project confirms them. Confirming an unproved check never
  conjures a command — it stays a visible capability gap.
- Added the `gate-fix-smoke` capability, which drives the whole workflow against
  real spawned processes and a real materialized snapshot, offline and with no
  PHP toolchain.

Scope held: no evidence persistence or pruning, no coordination or locking, no
activation, hooks, or receipt, and no dual-policy transition or redaction.

Verification: `npm run test:unit` (144 passing), `npm run gate-fix-smoke`,
`npm run gate-runtime-binding-smoke`, `npm run validate`, and
`npm run test:install`.
