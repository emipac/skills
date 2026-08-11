# Lifecycle command contract

Delivered by TB-012. Implemented in
[`scripts/lib/lifecycle.mjs`](../scripts/lib/lifecycle.mjs), with the durable
registration identity and the two registration writes in
[`scripts/lib/activation.mjs`](../scripts/lib/activation.mjs).

This contract covers what happens to an *already activated* clone: how it takes
a new release, how its health is observed, how drift is recovered, and how it is
removed. Activation itself is the
[activation transaction contract](activation-transaction-contract.md); pruning
and the Evidence store are the
[bounded evidence contract](bounded-evidence-contract.md); the coordination lock
is the [evaluation coordination contract](evaluation-coordination-contract.md).

## The three rules

1. **Ordinary distribution is not activation.** Installing a newer skill,
   plugin, or package makes a *candidate* release visible and does nothing else.
   Only an explicit, successful `gate update` advances the Active gate release
   (`FR-LIFE-014`, `AC-LIFE-007`).
2. **Observation never mutates.** `gate status` reconciles desired against
   actual state and reports `healthy`, `degraded`, or `broken`. It repairs
   nothing, writes nothing, and — deliberately — records no Lifecycle event, not
   even a `drift-detected` one: a write is exactly what it must not do
   (`FR-LIFE-009`, `FR-LIFE-019`).
3. **Removal is conservative and never partial.** Every removal path touches
   only unchanged Gate-owned state, and proves every item safe to remove before
   it removes the first one. Drifted, shared, global, and historical state is
   left alone (`SG-LIFE-001`, `NFR-REL-002`).

## Commands

| Command | Seam | Writes |
| --- | --- | --- |
| candidate release | `inspectRelease({ receipt, distribution })` | nothing |
| `gate update` | `previewUpdate(...)`, `updateGate(...)` | one atomic receipt write, last |
| `gate status` | `statusGate(...)` | nothing |
| `gate repair` | `previewRepair(...)`, `confirmRepair(...)` | one registration, confirmed |
| `gate deactivate` | `deactivateGate(...)` | withdraws registrations and the receipt |
| `gate uninstall` | `uninstallGate(...)` | unchanged project assets only |
| `gate cleanup` | `previewConfigurationCleanup(...)`, `confirmConfigurationCleanup(...)` | previewed Gate keys only |
| `gate prune` | `previewEvidencePrune(...)`, `confirmEvidencePrune(...)` | blobs only, confirmed |
| `gate locks` | `inspectCoordination(...)` | nothing |

`gate prune` and `gate locks` are the operator surfaces TB-008 and TB-009
deliberately deferred to this slice. They add no removal or recovery logic of
their own: they delegate to `store.previewPrune`/`store.confirmPrune` and to
`openCoordinationLock().inspect()` respectively, and exist so that pruning and
lock inspection are reached the same way every other lifecycle operation is —
preview first, confirm against that exact preview, never implicitly.

## `gate update`

`UPDATE_STEPS` is frozen and ends at `release-switch`:

```
preview → compatibility → migration → self-test → release-switch
```

Nothing before `release-switch` touches the published receipt, so a failure at
any earlier step preserves the previous Active gate release *by construction*
rather than by compensation. Migrations this update applied are unwound
last-applied-first; a migration that cannot be undone is refused at
`compatibility` rather than run, because an update that cannot go back is not an
atomic switch. A candidate that changes the protocol version, or that is a
different gate, is refused before anything runs.

The switch itself is one atomic receipt write. The new receipt carries a
`supersedes` record naming the prior receipt id, the prior release, the preview
it was authorized against, and the migrations that ran.

## Health

`statusGate` grades by *authority*, never by count:

| Observation | Health |
| --- | --- |
| Everything reconciles | `healthy` |
| A non-authoritative adapter is gone or unresponsive | `degraded` |
| An authoritative adapter is gone or unresponsive | `broken` |
| The authoritative registration is absent | `broken` |
| The gate-owned block no longer matches its durable identity | `broken` |
| The gate-owned block names a different Activation receipt | `broken` |

A configured-but-not-activated clone reports `state: 'configured'` and
`healthy`: there is nothing being enforced, so there is nothing drifted.

Adapter loss is reported, never requalified and never repaired: reinstating a
client the machine no longer has is a reinstall, not a repair (`RISK-004`).

## The durable identity of a gate-written registration

**The problem.** The registration the Gate writes — an owned shim, or a
marker-delimited block inside somebody's existing hook — names the Activation
receipt that authorized it, on a line of the form:

```
# activation-receipt: sha256:…
```

The receipt in turn must name the registration, so that `gate status` and
`gate repair` can tell later whether the block on disk is still the block the
Gate wrote. That is a cycle: the receipt id is a hash of the receipt body, so
the body cannot contain a hash of content that contains the receipt id. TB-011
left `receipt.hookChain` recording only the *prior* chain identity for exactly
this reason, and bound rollback to the transaction's in-flight journal instead.
An in-flight journal is no use to `gate status`, which runs in a later process.

**The approach.** Break the cycle by hashing the registration with exactly that
one self-referential value replaced by a constant:

- `HOOK_RECEIPT_PLACEHOLDER` (`<activation-receipt>`) stands in for the receipt
  id.
- `normalizeHookRegistration(text)` rewrites only lines starting with
  `HOOK_RECEIPT_PREFIX`, preserving every other byte.
- `hookBlockIdentity(text)` is the content identity of that normalization.
- `plannedHookRegistration({ strategy, hook, program, repositoryRoot })` builds
  the exact bytes a strategy would write, already normalized. It depends only on
  the strategy, the pinned hook program, and the clone root — never on the
  receipt — so it can be computed at the `receipt` step, *before* the receipt
  that will name it exists.

The receipt therefore carries `hookChain.blockIdentity`, and the elided value is
not lost: it is the receipt's own `receiptId`. A reader recomputes the
normalized identity from disk and separately compares the literal receipt-id
line against the receipt it came from. **Together the two checks cover every
byte of the registration, with no circularity.** A tamper inside the block
changes the normalized identity (`hook-block-tampered`); a registration left
behind by a superseded activation fails the literal comparison
(`hook-receipt-mismatch`).

This is what makes removal and repair possible from a receipt alone:

- `withdrawHookRegistration` refuses unless the registration still matches its
  pinned identity and names its receipt, and — for a composed block — unless
  removing it reproduces the exact prior chain the activation preserved.
- `restoreHookRegistration` refuses unless the registration it is about to write
  reproduces the pinned identity. A repair that would write anything else is a
  new activation, not a repair.

Both take `dryRun`, so a caller proves every registration safe before it changes
the first one.

**Limits.** This is cooperative local state, not tamper-proof enforcement: a
machine owner can edit the receipt as easily as the hook (`SG-TRUST-001`). What
the identity buys is that *accidental* and *third-party* drift is detected
rather than silently tolerated, and that no removal or repair ever writes over a
file it cannot prove it wrote.

## Removal

**`gate deactivate`** withdraws exactly two things: the gate-owned
registrations the receipt pins, and the receipt itself. It proves every
registration removable first; if any drifted, the whole deactivation refuses
with `registration-drifted`, removes nothing, and repairs nothing. Preserved:
the shared configuration, project-installed assets, global assets, and every
byte of historical Evidence.

**`gate uninstall`** requires a prior deactivation (`deactivation-required`) and
removes only project-installed assets that are still byte-for-byte what was
installed. Four things are refused by construction, and one refusal refuses the
whole uninstall:

| Reason | Meaning |
| --- | --- |
| `asset-outside-project` | global or machine-wide; v1 has no global uninstall |
| `shared-configuration` | `.agent-framework.yaml` is never a Gate asset |
| `historical-evidence` | anything under the Evidence store root |
| `asset-modified` | the maintainer has since made it theirs |

**`gate cleanup`** removes only the previewed top-level Gate keys
(`GATE_CONFIGURATION_KEYS`) from the shared configuration file, and never
deletes the file. It is deliberately line-oriented rather than a
parse-and-reserialize: reserializing would rewrite comments, quoting, ordering,
and anchors that have nothing to do with the Gate, which is a silent change to
shared state. The confirmation token binds both the located line ranges and the
identity of the file that was read, so a file edited since the preview removes
nothing (`configuration-changed`).

## Recovery

Drift changes only through a confirmed `gate repair` or a new Activation
transaction. `gate status` does not repair it; an ordinary update does not
repair it; a distribution bump does not repair it. `previewRepair` reconciles
through `statusGate` (so it, too, writes nothing) and states exactly which
registrations it would restore; `confirmRepair` runs only when the operator
reproduces that preview's token, proves every action first, and then writes.

## Prohibited

No automatic update, automatic repair, automatic removal, background cleanup,
global uninstall, Evidence deletion, or status-time mutation of any kind.

## Verified by

- `tests/gate-lifecycle.test.mjs` — update failure and preservation, health
  grading, durable-identity tamper detection, candidate versus active release,
  deactivation, uninstall, cleanup, repair, the two operator commands, and a
  whole-clone snapshot proving `gate status` mutates nothing.
- `npm run gate-lifecycle-smoke` — the packaged update and removal lifecycle
  against throwaway Git repositories, real registered hooks, and real
  `git commit` invocations.
