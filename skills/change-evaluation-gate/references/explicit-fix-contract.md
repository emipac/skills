# Explicit fix contract

Evaluation is check-only. Mutation exists, but only as a separate operation the
maintainer asks for by name, and a mutation never authorizes itself.

Implementation: `../scripts/lib/mutation.mjs`, `../scripts/lib/fix.mjs`.
Capability: `npm run gate-fix-smoke`.

## Check-only evaluation

A Command descriptor declared in a check's `fix` slot is the mutating one. Before
any snapshot is materialized and before any check runs, evaluation screens the
resolved checks and refuses the whole binding when a check offers a declared fix
command as its check-only `evaluate` command (`FR-POL-009`, `AC-POL-004`).

| Rejection | Meaning |
| --- | --- |
| `evaluate-is-own-fix` | The check offers its own declared fix command as its evaluation command |
| `evaluate-is-declared-fix` | The check offers a fix command another check declared |

The refusal is one `configuration-invalid` diagnostic and an `unverified`
decision. Evaluation is refused as a whole rather than silently continuing
without the offending check: a run that dropped it would still be grading a
binding the project never configured.

## Provider-declared fix ordering

A provider plan entry declares `fix_order` when its mutating command must run at
a particular point relative to its siblings. The provider output carries the
resolved `fix_plan`, gate core aggregates it, and the fix operation executes it
in exactly that order.

Ordering is provider-owned data. Gate core and the fix orchestration hold no
opinion about which command should run first and contain no tool name
(`SG-OWNER-001`). The Laravel provider declares a structural rewrite before
formatting, because a rewrite creates formatting work and the reverse order
would leave the tree unformatted (`FR-PROF-010`).

Fix order is independent of the Evidence ladder: the ladder runs `format` before
`static-analysis`, and the Laravel fix plan is the reverse.

## The fix operation

`runFix(request, dependencies) -> result`. The request is the evaluation
envelope carrying `operation: 'fix'`; any other operation is refused without
mutating anything.

Mutation and evaluation reach the outside world through two separate seams:
`executeFix` may mutate the repository, `execute` may not. Evaluation can
therefore never be handed the mutating seam by accident.

| Mutation outcome | Meaning |
| --- | --- |
| `applied` | The declared fix command ran and reported success |
| `failed` | The declared fix command ran and reported failure |
| `unverified` | The mutation could not be attributed a result |
| `not-run` | An earlier mutation did not apply, so the declared order halted |

These are deliberately not Check outcomes. A mutation produces no evidence, and
reporting one as `passed` would blur the line this operation exists to draw.

A mutation that does not apply halts the remaining declared order, because a
later mutation assumes the earlier one landed.

## Reevaluation

Whatever the mutations did, the fix then delegates one complete non-mutating
evaluation of the resulting snapshot.

| Result field | Contract |
| --- | --- |
| `reevaluation` | The complete post-fix decision, or `null` when the operation was refused before mutating |
| `authorization` | Read from the post-fix decision only; `deny` when no snapshot was graded |
| `authorizedBy` | The post-fix evaluation identity, never the superseded one |
| `supersededEvaluationId` | The decision the fix invalidated, recorded rather than reused |
| `newSnapshot` | Whether the graded tree differs from the superseded decision's tree |

Authorization comes from the new decision or from nowhere. A fix whose every
mutation applied cleanly still denies when its reevaluation could not complete,
and the pre-fix decision never authorizes the mutated tree
(`AC-POL-004`, `RISK-007`).

## Earned policy defaults

A provider plan entry marked `earnable` proposes `advisory` until the project
confirms it through `confirmed_required`. Confirmation alone never creates a
check: an unproved entry stays a visible capability gap, so a required binding
is always both proved and confirmed (`FR-PROF-009`).

For Laravel, proved style, rewrite-check, static-analysis, and broad-test checks
are proposed as required because their applicability is unconditional. Focused,
affected-test, smoke, build, and browser evidence is earnable. Defaults are
earned, not assumed.

The repository Gate policy remains the only thing that decides severity; a
provider only ever proposes.
