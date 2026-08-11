# Activation transaction contract

Activation is the explicit, clone-local, repository-bound transaction that turns
a **configured** repository into an **activated** one. It previews exactly what
it will do, obtains consent bound to that preview, proves every dependency, and
enables authoritative Git **last**. Any failure leaves the clone configured.

Installing assets, running setup, opening a client, or updating a plugin never
activates anything. There is no global activation in v1.

## The ordered pipeline

The transaction runs these steps in exactly this order and never reorders them.

| # | Step | What must hold |
| --- | --- | --- |
| 1 | `repository-identity` | Scope is `repository`, the trigger is `explicit`, a non-interactive run names both expected identities, any expected repository or configuration identity matches the clone in front of it, and a resumption's repository, configuration, and selected-adapter identities are unchanged |
| 2 | `preview` | The exact hook locations, strategy, resolved commands, adapters, trust requirement, and runtime input names are stated; a resumption's preview and transaction identities are unchanged; nothing is written |
| 3 | `consent` | Consent reproduces that exact preview and names this repository and this configuration |
| 4 | `runner-resolution` | Every logical runner resolves to one platform executable whose identity and version are pinned; an unresolved runner never falls back to a shell |
| 5 | `trust` | The client established trust; the gate never grants trust on the operator's behalf. A client that has not answered yet **pauses** the transaction rather than failing it |
| 6 | `hook-chain-validation` | The hooks path is this clone's own, the selected composition strategy is safe, and no gate-owned block is already present |
| 7 | `self-test` | The evaluation process reaches a decision and every selected adapter answers |
| 8 | `receipt` | The pinned Activation receipt is published by one atomic rename |
| 9 | `git-enablement` | The selected strategy registers the authoritative `pre-commit` — and only now can a commit be blocked |

Git is last on purpose: until step 9 completes, nothing the transaction has done
can stop a commit, so an abandoned or failed activation cannot leave a
repository that refuses to work.

## The receipt

`<git-common-dir>/change-evaluation-gate/evidence/activation/receipt.json`

The receipt is the one part of the clone-local store that is not append-only,
because it is *current state*, not history. It is published by a single atomic
rename and withdrawn by a single removal, so an interrupted transaction leaves
either a whole receipt or none. Its audit trail stays append-only: every
transition also appends an immutable `activation` Lifecycle event, so withdrawing
a receipt never withdraws the record that it existed.

It pins:

| Field | Pins |
| --- | --- |
| `previewId` | The exact preview consent was granted against |
| `repository`, `configuration` | Clone identity, schema version, and policy identity |
| `runtime.gate`, `runtime.runnerVersion` | The active runtime |
| `runtime.runners[]` | Each resolved executable and its version |
| `adapters[]` | Each adapter, its version, and its self-test result |
| `hooks[]` | Every gate-owned hook location and its ownership — the ownership label *is* the selected strategy |
| `hookChain` | The selected strategy, the hook manager if any, the exact path, and the identity of the prior hook chain this activation preserved |
| `trust` | Which client granted trust, by whom, and when |
| `runtimeInputs[]` | Runtime input **names** only — never a value |
| `selfTests[]` | Every self-test that had to pass first |

## Rollback

Every gate-owned change is journalled with its compensating action and unwound
last-in-first-out on any failure: hook registration, then the receipt, then each
registered adapter in reverse, then trust. The result reports the step, a reason
code, and the actions it unwound.

Rollback removes only unchanged gate-owned content. If a registered hook no
longer matches what the transaction wrote, somebody else owns that file now:
rollback reports a failure and leaves it in place rather than repairing drift it
did not cause (`SG-HOOK-001`, `SG-LIFE-001`).

An activation that cannot be recorded is withdrawn again. Authoritative
enforcement that leaves no audit record is not activation.

## Hook registration

Registration is non-destructive, always:

- an existing `pre-commit` hook is **never** overwritten — activation either
  composes a confirmed marker-delimited block into it or refuses with
  `hook-exists`;
- a `core.hooksPath` that comes from anywhere but this clone's own configuration
  file, or that points outside the clone, governs other repositories too —
  activation refuses with `hooks-path-shared` and never rewrites the setting to
  escape it. A hook confirmation is not permission to reach into it;
- everything the gate writes is published by one atomic rename, is marked with
  its owner and the receipt it belongs to, and does nothing but hand control to
  the pinned runtime.

### The declared composition order

`hook-chain-validation` selects exactly one strategy, in this order, and
`git-enablement` performs only that one (`FR-LIFE-017`). The chosen strategy is
the `ownership` label the preview and the receipt both carry.

| # | Strategy | Chosen when | What is written |
| --- | --- | --- | --- |
| 1 | `native-hook-manager` | The clone has a hook manager with a managed hook directory of its own (a `.husky` directory, whether Git points at it or at its generated `_` runner directory) and no `pre-commit` in it | One clearly owned file at the manager's own integration point. The manager's generated runner and its configuration are never touched |
| 2 | `marker-delimited-block` | A repository-local `pre-commit` already exists, is a POSIX shell script, and the operator confirmed **that exact hook** by path and content identity | One marker-delimited block, and nothing else |
| 3 | `gate-owned-shim` | No `pre-commit` hook exists at all | One whole gate-owned file |

A hook manager whose only integration point is a declaration — `lefthook.yml`,
`.pre-commit-config.yaml` — is detected and then refused with
`hook-manager-manual-registration`. Editing somebody's manager configuration on
their behalf is the silent change `SG-HOOK-001` forbids.

### Preserving and executing the chain

The block is placed **directly after the shebang**, not appended. Most hooks end
in `exit 0`, so an appended block would never execute; a block at the top always
does, stops the commit when the gate refuses it, and otherwise falls straight
through to the hook's original body. Every original byte is preserved: removing
the block again reproduces the prior hook exactly, and rollback refuses to
proceed unless it does.

`NFR-COMP-002` is proved by fixtures rather than asserted: the
`gate-hook-conformance-smoke` capability composes into a real hook whose only
job is to leave an observable trace, then makes a real `git commit` and requires
both that trace *and* the gate decision to appear.

### Marker drift

Any gate-owned block found in a hook at activation time — malformed, duplicated,
or perfectly intact — is drift. Activation refuses with `hook-marker-drift` and
states `resolution: manual`. The gate cannot tell whose block it is or what it
was meant to be, and repairing, reusing, or replacing it would be exactly the
guess `SG-HOOK-001` forbids.

## Pausing for trust, and resuming

Trust belongs to the client. When the client reports the operator has not
answered yet (`{ established: false, pending: true }`), the transaction
**pauses** instead of failing:

- the result is `state: 'paused'`, reason code `trust-pending`, and the journal
  is still unwound, so **no gate integration is active anywhere**;
- it carries a `resumption` naming the transaction identity plus the four
  identities that may not change: repository, configuration, selected adapters,
  and the exact preview;
- the pause is recorded as an `activation` Lifecycle event with outcome
  `refused`.

Resuming means passing that `resumption` back as `request.resume`. Every
identity is re-derived from the machine and compared **before consent is read
and long before anything is written**, so a resumption that no longer applies
mutates nothing (`FR-LIFE-016`, `AC-LIFE-009`).

## Non-interactive activation

`interactive: false` means "do not ask", never "this is the right repository".
A non-interactive run must additionally name both
`repository.expectedIdentity` and `configuration.expectedIdentity`; either one
missing refuses with `non-interactive-identity-missing`, and either one wrong
refuses with the corresponding mismatch — all at `repository-identity`, before
any clone-local mutation (`FR-LIFE-015`, `AC-LIFE-008`). Consent is still
required separately: a flag never implies it.

## Reason codes

| Step | Reason code |
| --- | --- |
| `repository-identity` | `activation-scope-global`, `activation-scope-unsupported`, `activation-trigger-prohibited`, `non-interactive-identity-missing`, `repository-identity-mismatch`, `configuration-identity-mismatch`, `resume-repository-mismatch`, `resume-configuration-mismatch`, `resume-adapter-mismatch` |
| `preview` | `resume-preview-mismatch`, `resume-transaction-mismatch` |
| `consent` | `consent-missing`, `consent-preview-mismatch`, `consent-identity-mismatch` |
| `runner-resolution` | `runner-unresolved` |
| `trust` | `trust-not-established`, `trust-pending` (a **pause**, not a failure) |
| `hook-chain-validation` | `hooks-path-shared`, `hook-manager-manual-registration`, `hook-marker-drift`, `hook-exists`, `hook-confirmation-mismatch`, `hook-chain-uncomposable` |
| `self-test` | `self-test-failed`, `adapter-self-test-failed` |
| `receipt` | `receipt-write-failed` |
| `git-enablement` | `hook-registration-failed`, `activation-record-failed` |

## Deliberately not here

The receipt records the composition strategy, the location, and the prior chain
identity, but **not** the identity of the block or shim the gate wrote: that
content embeds the receipt id, so it cannot be hashed into the receipt that
names it. Rollback binds to it through the in-flight journal instead. A durable
gate-owned content identity belongs with `gate status` and `gate repair`.

Update, status, repair, deactivation, and uninstall are lifecycle commands of
their own. The desktop adapters themselves, and the approval and injection of
runtime input *values*, are likewise separate: this contract owns the self-test
mechanism and records input names only.
