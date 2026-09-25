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
| `gate status` | `observeControlSurface(...)`, `statusGate(...)` | nothing |
| `gate repair` | `previewRepair(...)`, `confirmRepair(...)` | one registration, confirmed |
| `gate deactivate` | `deactivateGate(...)` | withdraws registrations and the receipt |
| `gate uninstall` | `uninstallGate(...)` | unchanged project assets only |
| `gate cleanup` | `previewConfigurationCleanup(...)`, `confirmConfigurationCleanup(...)` | previewed Gate keys only |
| `gate prune` | `previewEvidencePrune(...)`, `confirmEvidencePrune(...)` | blobs only, confirmed |
| `gate locks` | `inspectCoordination(...)` | nothing |
| `gate bypass` | `captureSnapshot(...)`, `resolveBypass(...)`, `store.bypassGrant().write(...)` | one grant file, confirmed |
| `gate sync` | `previewSync(...)`, `syncActivation(...)` (`activation.mjs`), `evaluatePolicyTransition(...)` | one atomic receipt write, confirmed; no registration |

`gate prune` and `gate locks` are the operator surfaces TB-008 and TB-009
deliberately deferred to this slice. They add no removal or recovery logic of
their own: they delegate to `store.previewPrune`/`store.confirmPrune` and to
`openCoordinationLock().inspect()` respectively, and exist so that pruning and
lock inspection are reached the same way every other lifecycle operation is —
preview first, confirm against that exact preview, never implicitly.

## The operator surface (`TB-040`, `TB-041`)

The commands above are reached through one packaged program,
[`scripts/gate.mjs`](../scripts/gate.mjs), implemented in
[`scripts/lib/operator-surface.mjs`](../scripts/lib/operator-surface.mjs) and
installed as the `change-evaluation-gate` bin entry. It resolves the clone, its
configuration, its Activation receipt, and its Evidence store through the same
helpers the authoritative runner resolves them with (`resolveRepositoryRoot`,
`resolveConfiguration`, `resolveReceipt`, `openStore` in
[`hook-runner.mjs`](../scripts/lib/hook-runner.mjs)), calls the lifecycle seams
unchanged, and renders what they returned. It grades nothing itself.

Every lifecycle operation is reached here:

```
gate status     [--json]
gate locks      [--recover <token>] [--json]
gate prune      [--evaluation <id>] [--before <instant>] [--reclaim <bytes>] [--confirm <token>] [--json]
gate repair     [--hook-script <path>] [--confirm <token>] [--json]
gate update     [--confirm <token>] [--json]
gate deactivate [--confirm <token>] [--json]
gate uninstall  --asset <path> ... [--confirm <token>] [--json]
gate cleanup    [--confirm <token>] [--json]
gate bypass     --reason <text> [--reference <ref>] [--actor <name>] [--confirm <token>] [--json]
gate sync       [--acknowledge-weakening] [--confirm <token>] [--json]
```

**Two invocations, never one.** Every command previews by default and writes
nothing. It performs only when a *separate later* invocation names the token the
preview printed. There is no flag that does both: `--confirm` with no token, and
`--preview` given alongside a confirmation, are both refused as
`preview-and-confirm-refused` and say why. That does not stop a caller running
both commands back to back, and it is not meant to — it means no single command
destroys anything. `status` has no confirmed form at all.

**The preview is re-derived, never carried.** Every invocation rebuilds the
preview from the filesystem as it is right now, and the operator's token is
checked against *that*. This is `TB-036`'s rule applied at the command boundary:
nothing the caller holds decides what happens, so a confirmation naming a
preview the clone no longer matches writes nothing and returns a stated refusal
(`NFR-REL-002`).

**The preview owns its instruction.** The `next:` line a preview ends with is
composed from the invocation that produced the preview, not from the command's
name: it carries every value selector that invocation carried, in the order the
command declares them, once per value for a repeatable one, and single-quoted
wherever a POSIX shell would otherwise split or interpret the value (a path
with a space, a `'`, a `$`). Pasting the line unchanged reproduces the preview
and therefore its token, and performs exactly what was shown. The same
selectors are recorded on every document as `invocation.selectors`, so the
`--json` reader has the instruction the person has (`TB-053`).

**A refused confirmation offers no token.** The surface holds two opaque
identities — the token the operator carried and the one this invocation
recomputed — and can tell that they differ, not why: a clone that changed and
an invocation that dropped a selector leave identical evidence. The refusal
therefore names both possibilities, states the invocation it ran as, and its
`next:` line names the preview to read rather than a confirmation to paste.
The recomputed preview is still rendered; what is withheld is the shortcut
past reading it, which is how a `--client cursor` preview once became a git
activation.

**What refuses is what records.** Where a seam takes the confirmation itself —
`confirmRepair`, `updateGate`, `confirmConfigurationCleanup`,
`confirmEvidencePrune`, `recoverStale` — the token is handed straight to it and
the seam does the refusing and appends its own Lifecycle event. Only
`deactivateGate` and `uninstallGate` take no confirmation, so the surface
compares the token for those two and records the refusal through one helper, as
the same `removal` event their own `record` would have appended, in the same
store (`NFR-AUD-001`). No new event type, no new store, no parallel log.

**One document, two readers.** Every invocation builds exactly one document and
renders it once — as `--json` for an agent, or as a summary for a person. The
document carries `observation` (what this invocation would do) and `mutation`
(what it did). `mutation` is `null` on every preview, which makes "this run
wrote nothing" a field rather than a promise in prose (`NFR-OPER-001`).

**Exit status, in the `diff`/`grep` shape:**

| Status | Meaning |
| --- | --- |
| `0` | the command ran and found nothing wrong, or performed what was confirmed |
| `1` | the clone needs attention — `degraded`, `broken`, a stale lock, or a confirmation this clone refused |
| `2` | the command could not run |

A `broken` clone and a refused confirmation are not failed invocations. An agent
branches on that difference without reading a word of output, and
`document.failure` is `null` for every invocation that actually reached an
operation.

**No back door.** `--force`, `--yes`, `--no-confirm`, and a bare positional token
are refused with exit `2`. `gate activate` and `gate fix` remain separate
contracts and are refused by name. There is no interactive prompt anywhere: a
prompt is exactly what would lock an agent out of a surface both callers must
reach.

**An agent may run all of it, and the surface says what that means.** The threat
is real and accepted deliberately: an agent blocked by a failing check could
deactivate the Gate and commit. It is accepted because the Gate is already
cooperative — `SG-TRUST-001`, and `--no-verify` has always been one flag away —
and because an operation run here is *recorded*, where a hand-rolled script is
not. Every document carries the trust boundary rather than implying enforcement
the Gate does not have.

**Where each operation's arguments come from.** The surface resolves what it can
and states what it cannot:

| Operation | Input the clone does not record | How it is resolved |
| --- | --- | --- |
| `repair` | the hook program (the receipt pins the registration's identity, not the program that produced it) | the packaged `gate-precommit.mjs` beside this module, overridable with `--hook-script`. A wrong program cannot write anything: the planned bytes fail to reproduce the pinned identity and `restoreHookRegistration` refuses with `registration-not-reproducible`. |
| `update` | the candidate release (the receipt records what the caller that ran activation declared) | the nearest package manifest above this module — the distribution an ordinary install or plugin update actually bumps — with `PROTOCOL_VERSION` as the protocol the installed gate speaks. A protocol or id mismatch is refused at `compatibility`. |
| `uninstall` | the project-installed asset manifest (activation records none) | named by the operator with repeatable `--asset`, described from disk at preview time. `uninstallGate` still refuses anything outside the project, the shared configuration, historical Evidence, or a modified asset. |

`gate update` runs no self-test of its own: `updateGate`'s self-test seams keep
their library defaults, and the document says so in `selfTestsRerun: false`
rather than reporting an injected pass as a proof the clone cannot support.
`gate status` is what reconciles the clone afterwards.

**Adapter observation.** An adapter the receipt pinned that the installed gate
no longer declares (`describeAdapter`) is not observed as present, which is the
loss `statusGate` already grades by the authority the receipt recorded.

**Control-surface observation** (`TB-060`). On an activated clone `gate status`
reads the configuration with `resolveConfiguration`, pins its checks with
`pinnedRunners`, and passes `observeControlSurface`'s observation to
`statusGate` as `controlSurface` — the same observer, configuration reader, and
runner pinning the authoritative and preflight runners use before every
evaluation. One observation, two readers: a clone whose trusted configuration,
descriptors, receipt, runtime, adapter set, managed hook block, or providers
moved since activation is `broken` to status exactly when its next commit is
`unverified` with `integrity-drift` (`NFR-SEC-004`, `AC-SEC-001`). Before this
the surface passed no observation, and status reported `healthy` over a policy
the next commit was denied for. Runner pinning re-observes each pinned
executable with one `access(2)` and composes each argument vector in-process: no
pinned program is started and nothing is written. A trusted-configuration
finding names `.agent-framework.yaml` as its `path`; the receipt pins an
identity, not a document, so which key moved is not reported.

A supporting adapter the installed gate no longer declares is therefore both an
`adapter-lost` finding (still `supporting`) and drift of the pinned `adapters`
surface, which the runners deny every commit for — so that clone is `broken`,
not `degraded`. `degraded` remains the grade for a supporting surface whose
registration is lost while everything the runners pinned still matches.

**Status says what next** (`NFR-OPER-001`, `TB-060`). The rendering ends with
one `next:` line and the document carries the same answer as
`observation.next`: `instruction` (exactly what the line prints), `shortcut`
(`git gate` when this clone's `.git/config` holds the alias activation writes
for this command, byte for byte, otherwise `null` and the line says `gate`),
`remedies` (each with the finding codes it answers, in the order they must be
performed), and `informational` (codes that need nothing). A clone with nothing
to act on prints `next: nothing`, and its rendering is otherwise unchanged. The
document also gains `observation.controlSurface` — the `observed` surface and
the `drifted` surface names, or `null` on a clone with no receipt. No existing
field changed. `STATUS_REMEDIES` (`operator-surface.mjs`) is the one table:

| Finding | Remedy |
| --- | --- |
| `hook-absent`, `hook-block-tampered`, `hook-receipt-mismatch`, `control-surface-drift` on `managed-hooks` | `gate repair` |
| `control-surface-drift` on `trusted-configuration`, `command-descriptors` | `gate sync` (`TB-062`) — both are pinned from `.agent-framework.yaml`, and a sync re-pins both under the adapter set the receipt already pins |
| `control-surface-drift` on `receipt`, `runtime`, `adapters`, `providers`; `adapter-lost`, `authoritative-adapter-lost`, `adapter-registration-absent`, `adapter-registration-unverified` | a new Activation transaction: `gate deactivate`, then `gate activate`, each previewed and confirmed |
| `adapter-registration-drifted`, `adapter-registration-ambiguous` | reconcile the client's changed entry by hand — deactivation refuses a drifted entry and the Gate never overwrites a client's own file — then run `gate status` again |
| `activation-absent` | `gate activate` |
| `gate-policy-invalid`, `configuration-unreadable` | correct `.agent-framework.yaml` |
| `gate-policy-missing`, `configuration-missing`, `repository-unresolved` | informational — nothing is enforced, and adopting the Gate is a choice |

A finding with no entry fails the unit suite, which enumerates every code
`statusGate` can emit from its source. Deactivation leaves the `git gate` alias
in place, so the pair runs through it end to end. Where a clone needs both a
sync and a new Activation transaction, `next:` names only the pair: it re-pins
the configuration as well, and a sync refuses a clone whose adapter set moved.

**Observation creates nothing** (`TB-041`). `openCoordinationLock` used to ensure
its own directory existed before it read anything, so the first `gate locks` on a
clone that had never taken a lock created an empty
`change-evaluation-gate/coordination/`. Directory creation moved to the two paths
that write — acquisition and stale recovery — and inspection now creates nothing
at all. A clone that was never activated is likewise never given an Evidence
store by being looked at: a store is opened only when the receipt exists or when
a confirmation needs somewhere to record what it did.

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
| A pinned Gate control surface drifted (`gate status` observes it; `TB-060`) | `broken` |
| The authoritative registration is absent | `broken` |
| The gate-owned block no longer matches its durable identity | `broken` |
| The gate-owned block names a different Activation receipt | `broken` |

## The state a clone is reported to be in

`gate status` reports all three lifecycle states, and it decides between the
first two by asking `resolveConfiguration` — the same reader the authoritative
runner, the preflight runner, and `gate activate` ask — rather than inferring
the answer from the Activation receipt alone (`AC-CFG-001`, `FR-CFG-001`):

| The clone | State | Health | Finding |
| --- | --- | --- | --- |
| Holds no readable `evaluation_gate` section | `installed` | `healthy` | the reader's own reason code, naming the missing policy |
| Holds a policy section, has no receipt | `configured` | `healthy` | `activation-absent` (plus `gate-policy-invalid` when the contract rejects the policy it holds) |
| Has an Activation receipt | `activated` | graded by the table above | whatever reconciliation found |

An unconfigured clone is `healthy`: there is nothing being enforced, so there is
nothing drifted. `broken` never means "not set up" — it goes on meaning what
`FR-LIFE-009` says it means for a clone that is enforcing something. A policy
section the policy contract rejects still means the clone HOLDS a policy, so it
is `configured` with the invalidity reported, and `gate activate` refuses it
with the same reason code `gate status` names.

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

**`gate bypass`** (`TB-052`) grants one one-shot bypass of the staged
snapshot, the only way a grant reaches the authoritative runner. The preview
materializes the index through the runners' own `captureSnapshot`, reports the
snapshot identity and staged paths, and applies the policy's own
`resolveBypass` rule to the grant it would write, so a disabled policy, an
unconfigured marker, a missing reason, or a missing policy-required reference
is refused here by the same code and the same rejection code the hook would
use, and no token is offered. The token binds the snapshot identity, the
reason, the reference, the actor, the marker, and the receipt's configuration
identity: staging anything after the preview refuses the confirmation. The
confirmation writes `bypass/grant.json` under the Evidence store and appends
one `bypass` Lifecycle event; a refused confirmation appends a `bypass` event
with outcome `refused`. What the grant then does belongs to the
[Gate policy contract](gate-policy-contract.md#where-a-grant-comes-from): the
next commit attempt spends it, applied or refused, and a bypassed commit is
recorded as `bypassed`, never `passed`, with every failed check preserved.

## `gate sync` (`TB-062`)

A maintainer who changed the Gate policy re-pins it with one previewed,
confirmed command that keeps the adapters the clone already has. Until this,
every policy edit took `deactivate` and `activate` — four invocations, two of
them withdrawing registrations the next two put back byte for byte — and
nothing between the edit and the pin ever asked whether the new policy was
weaker than the one that authorized it (`FR-CFG-005`, `SG-CFG-001`).

**It is an Activation transaction** (`FR-LIFE-019`). `syncActivation` takes
activation's ordered steps — `repository-identity → preview → consent →
runner-resolution → trust → hook-chain-validation → self-test → receipt →
git-enablement` — runs the same evaluation, hook-program, and adapter
self-tests, and records one `activation` Lifecycle event, `before` the prior
receipt id and `after` the new one. It writes exactly one thing: the receipt,
by one atomic write that is read back. The adapter set comes from the receipt
and from nothing else; the registration the receipt pins for each surface is
kept, never rewritten, and must be exactly what this sync would write — the
hook block's receipt-independent identity reproduced by the installed hook
program, each client entry's command the one this sync would register. Git is
authoritative throughout: under the prior receipt until the switch, under the
new one after it, and `git-enablement` re-confirms on disk the registration the
new receipt authorizes. The new receipt keeps `activatedAt` and the Active gate
release (`gate update` alone moves that), pins the candidate configuration's
identity *and its policy*, the commands it resolves to, and the Sensitive input
names it declares, records `supersedes` (the prior receipt, the prior
configuration identity, the preview, and any weakening acknowledged), and adds
the prior id to `receiptLineage`, so the untouched registration naming it stays
this activation's for status, repair, and deactivation. A failure at any step
restores the prior receipt byte for byte and leaves the clone `activated`
exactly as it was (`AC-LIFE-009`); only a restore that itself fails reports
`recovery-required`.

**The preview says what changed and whether it is weaker.** It names the
Trusted identity the receipt pins, the candidate identity the file produces, the
findings `evaluatePolicyTransition` produces for the pair (`weakened`,
`weakenings`, `candidateValid`), the adapters and registrations kept, the
commands, and the runtime input names. The rendering heads the transition
`WEAKER than the trusted policy (n)` or `not weaker than the trusted policy`.
The token is the content identity of all of it. The Trusted *policy* is read
from a document that reproduces the pinned identity, in order: the receipt
itself when `gate sync` wrote it (an activation receipt pins the identity only),
the configuration file when its identity never moved, and the committed
`.agent-framework.yaml` at `HEAD` — which is where it ordinarily still is,
because a drifted clone denies every commit. What no document reproduces is
refused as `trusted-configuration-unrecoverable` rather than guessed.

**A weakening is refused by default and confirmable by name.** A weaker
candidate is refused as `weakening-unacknowledged`, with every weakening named
and no token. `gate sync --acknowledge-weakening` previews the same candidate
with the acknowledgement bound in and offers a token; the confirmation must
carry the same flag, so the token names the candidate and the acknowledgement
together. At confirmation `evaluatePolicyTransition` receives that candidate
identity as its approval, which is the candidate-hash approval `FR-CFG-005`
asks for. A candidate that is not weaker needs nothing extra. Nothing skips the
check; the flag only acknowledges its result.

**Refusals** (no token; a confirmation anyway appends an `activation` event with
outcome `refused` and writes nothing):

| Reason | `next:` |
| --- | --- |
| `receipt-drifted` — the receipt no longer reproduces its own identity | `gate deactivate, then gate activate` |
| `adapter-set-changed` — the installed gate declares a different adapter set than the receipt pins | `gate deactivate, then gate activate` |
| `hook-registration-drifted` | `gate repair` |
| `hook-registration-not-reproducible` — the installed hook program would write a different registration | `gate deactivate, then gate activate` |
| `adapter-registration-changed` | `gate status` |
| `nothing-to-sync` — configuration, commands, and input names are what the receipt pins (exit `0`) | `nothing to sync` |
| `trusted-configuration-unrecoverable` | `gate deactivate, then gate activate` |
| `candidate-policy-invalid` | correct `.agent-framework.yaml` |
| `weakening-unacknowledged` | `gate sync --acknowledge-weakening` |

**Honest limits.** "Weaker" is what `policyWeakenings` recognizes today: a
trusted required check the candidate demotes to advisory or no longer binds.
Loosening the budget, enabling bypass, or making work budget-skippable is not
recognized as a weakening and previews as `not weaker`. No check runs during a
sync, so the "satisfy both policies" half of `FR-CFG-005` is not exercised
here: that is the commit-time evaluation of a policy-changing commit under the
old policy, a separate seam in the runners and its own contract. And like
every surface here, it resists nobody (`SG-TRUST-001`).

## Recovery

Drift changes only through a confirmed `gate repair` or a new Activation
transaction — `gate sync` for a changed configuration. `gate status` does not repair it; an ordinary update does not
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
- `tests/gate-operator-surface.test.mjs` — the packaged operator surface against
  real activated clones: healthy, degraded, and broken health through the
  command, a configured clone that was never activated, free/live/stale lock
  inspection, a prune preview and its token, the two renderings agreeing from
  one invocation, mutation refusal by name, the exit status separating an
  unhealthy clone from a failed invocation, and a whole-clone snapshot —
  directories included — proving every observation writes nothing. For the half
  that writes: a confirmation naming a preview the clone no longer matches,
  proved for all seven confirmable operations against a genuinely changed clone;
  the single-invocation refusal; a clobbered managed block restored by a
  confirmed repair and left alone by every other command; a repair that cannot
  reproduce the pinned registration; deactivation, uninstall, and cleanup
  preserving shared, global, and historical state; a distribution bump that
  changes nothing until confirmed and a failed update that preserves the prior
  release; a confirmed prune and its tombstones; stale-lock recovery against its
  own token and never against a live holder; and every operation and refusal
  recorded while `status` records none. `TB-060` adds clones activated through
  the real command: a configuration edited after activation is `broken` with a
  `trusted-configuration` finding, its commit is denied `integrity-drift`, and
  the named deactivate/activate pair makes it healthy again; a healthy clone
  prints `next: nothing` and otherwise exactly what it printed before; status
  runs no pinned program; and every finding code maps to a remedy. `TB-062`
  adds `gate sync`: a weakened policy is refused with the weakening named and no
  token; a not-weaker one is pinned by one confirmation and the next commit is
  graded under it with no drift; an acknowledged weakening is pinned only by the
  token that binds candidate and acknowledgement, the second sync judging
  against the policy the first pinned; the hook and a desktop client's
  registration file are byte-identical across a sync; a failed self-test and a
  failure after the receipt switch both leave the prior receipt and
  registrations intact; and a changed adapter set, a drifted receipt, and an
  unrecoverable trusted policy are each refused and name what to do.
- `tests/gate-coordination.test.mjs` — that opening and inspecting the
  coordination lock creates no file and no directory, and that acquisition does.
- `npm run gate-lifecycle-smoke` — the packaged update and removal lifecycle
  against throwaway Git repositories, real registered hooks, and real
  `git commit` invocations, plus `packaged-observation` and `packaged-repair`,
  which drive `gate.mjs` as a real child process against a real activated clone
  that really blocks a commit, has its block clobbered, stops blocking, and is
  repaired back to exactly what its receipt authorizes — and
  `packaged-configuration-drift`, which activates through the packaged command
  so the real runner is registered, edits the configuration, and proves status,
  the denied commit, and the named `git gate sync` agree, with the registered
  hook byte-identical throughout and the next real commit graded under the new
  policy.
