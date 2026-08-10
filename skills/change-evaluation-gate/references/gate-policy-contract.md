# Gate policy contract

Repository Gate policy decides *which* configured checks block, *how long* one
evaluation may take, and *whether* a supported bypass exists. It names check
identities and limits only: Verification stays the sole owner of command
definitions, profiles, scopes, and applicability (`SG-OWNER-001`).

## Subcontracts

The `evaluation_gate` section of schema v4 has exactly five subcontracts, and
nothing else is expressible. A baseline exemption or a persistent pass cache
therefore cannot be configured into existence (`FR-POL-004`).

| Subcontract | Contents |
| --- | --- |
| `checks` | `required` and `advisory` check identities |
| `budget` | `total_seconds`, the confirmed total evaluation budget |
| `bypass` | `enabled`, optional `require_reference`, and the commit-visible `marker` |
| `execution` | execution policy, including `budget_skippable` advisory identities |
| `evidence` | evidence policy |

No subcontract may carry a command, runner, argument list, working directory,
allowed environment, evidence category, profile, capability, activation, trust,
or receipt property. Plan validation rejects those names outright.

Plan validation also rejects a missing subcontract, a non-positive total budget,
an identity bound as both required and advisory, a duplicate identity, a
required identity listed as budget-skippable, and an enabled bypass with no
configured marker. There is no universal timeout or budget default to fall back
on (`Q-007`, `NFR-PERF-001`).

## Severity

A provider *proposes* a binding; only repository policy decides. When a policy
is configured, a check it does not name as required is recorded as advisory and
cannot block. An advisory outcome never compensates for a required one, and an
advisory failure is never silently promoted to blocking (`SG-POL-001`).

A policy that cannot bound the evaluation is one `configuration-invalid`
diagnostic and the decision is `unverified`: an unusable policy fails closed
rather than evaluating with invented limits.

## Authorization binding

Final authorization is recomputed conjunctively over the required checks of a
decision that still describes the exact current snapshot, configuration,
environment, and runner and provider tool environment. A completed pass from an
earlier evaluation never authorizes a changed snapshot; it is `unverified` with
a `snapshot-mismatch` or `integrity-drift` diagnostic (`FR-POL-003`,
`SG-EVAL-001`). Reauthorization can only be as strict as the recorded decision:
it never upgrades a recorded `unverified` because the checks read positively.

There is no baseline exemption and no persistent pass cache in v1.

## Budget

Both limits apply to every check: the project-confirmed per-check timeout and
the remaining total budget, whichever runs out first. A timed-out check
terminates its whole process group, not only its direct child, so background
completion can never authorize the current commit (`FR-POL-005`).

Only advisory checks the project listed in `execution.budget_skippable` may be
dropped when the remaining budget cannot cover them; they are recorded as
`budget-exhausted` and stay visible as advisories. Required work is never
skipped: it is attempted with whatever budget remains, and a required check the
budget cannot cover at all becomes blocking `unverified`.

## Bypass

Bypass is optional and may be disabled outright (`FR-POL-008`). A bypass grant
is supplied to evaluation out of band — the process request carries no policy
override — and names its actor, reason, optional reference, request time, and
the exact snapshot identity it applies to.

A grant is refused, leaving the graded outcome untouched, when:

| Rejection | Meaning |
| --- | --- |
| `bypass-disabled` | Repository policy disables bypass |
| `marker-unconfigured` | Bypass is enabled with no commit-visible marker |
| `reason-missing` | No reason was supplied |
| `reference-missing` | Policy requires a reference and none was supplied |
| `snapshot-mismatch` | The grant names a different snapshot |
| `bypass-already-consumed` | The grant is one-shot and was already used |
| `nothing-to-bypass` | The decision passed on its own |

An accepted bypass sets the outcome to `bypassed` — never `passed` — preserves
every failed and unverified check exactly as graded, records actor, reason,
reference, snapshot identity, and the preserved failures, carries a
machine-readable evidence identity, and supplies the configured commit-visible
marker for the Git adapter to emit (`FR-POL-006`, `FR-POL-007`, `SG-BYP-001`).

Bypass and local enforcement are cooperative, not tamper-proof: the record
states `tamperEvident: false`, and the Gate never claims to prevent raw Git
`--no-verify`, hook removal, or machine-owner tampering (`SG-TRUST-001`,
`RISK-001`).

## Declared but not yet implemented

- Bypass evidence is identified inside the decision but is not written to disk;
  evidence persistence and pruning are a later slice.
- The commit-visible marker is supplied by the decision; emitting it into the
  commit is the activated Git adapter's responsibility.
- The one-shot ledger is an injected seam; its durable store is a later slice.
