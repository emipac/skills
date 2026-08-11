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
| 1 | `repository-identity` | Scope is `repository`, the trigger is `explicit`, and any expected repository or configuration identity matches the clone in front of it |
| 2 | `preview` | The exact hook locations, resolved commands, adapters, trust requirement, and runtime input names are stated; nothing is written |
| 3 | `consent` | Consent reproduces that exact preview and names this repository and this configuration |
| 4 | `runner-resolution` | Every logical runner resolves to one platform executable whose identity and version are pinned; an unresolved runner never falls back to a shell |
| 5 | `trust` | The client established trust; the gate never grants trust on the operator's behalf |
| 6 | `hook-chain-validation` | The hooks path is this clone's own, and no `pre-commit` hook already exists |
| 7 | `self-test` | The evaluation process reaches a decision and every selected adapter answers |
| 8 | `receipt` | The pinned Activation receipt is published by one atomic rename |
| 9 | `git-enablement` | The gate-owned `pre-commit` shim is registered — and only now can a commit be blocked |

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
| `hooks[]` | Every gate-owned hook location and its ownership |
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

- an existing `pre-commit` hook is **never** overwritten — activation refuses
  with `hook-exists`;
- a `core.hooksPath` that comes from anywhere but this clone's own configuration
  file, or that points outside the clone, governs other repositories too —
  activation refuses with `hooks-path-shared` and never rewrites the setting to
  escape it;
- the shim is published by one atomic rename, is marked with its owner and the
  receipt it belongs to, and does nothing but hand control to the pinned runtime.

## Reason codes

| Step | Reason code |
| --- | --- |
| `repository-identity` | `activation-scope-global`, `activation-scope-unsupported`, `activation-trigger-prohibited`, `repository-identity-mismatch`, `configuration-identity-mismatch` |
| `consent` | `consent-missing`, `consent-preview-mismatch`, `consent-identity-mismatch` |
| `runner-resolution` | `runner-unresolved` |
| `trust` | `trust-not-established` |
| `hook-chain-validation` | `hooks-path-shared`, `hook-exists` |
| `self-test` | `self-test-failed`, `adapter-self-test-failed` |
| `receipt` | `receipt-write-failed` |
| `git-enablement` | `hook-registration-failed`, `activation-record-failed` |

## Deliberately not here

Ordered composition of an existing hook chain (native hook manager integration,
marker-delimited blocks in a repository-local hook, and the owned shim as the
last resort), paused-and-resumed transactions, and non-interactive trust-resume
identity binding are a separate concern. This contract registers a hook only
where none exists and refuses everything else, which is what enabling Git and
proving non-destructiveness requires.

Update, status, repair, deactivation, and uninstall are lifecycle commands of
their own. The desktop adapters themselves, and the approval and injection of
runtime input *values*, are likewise separate: this contract owns the self-test
mechanism and records input names only.
