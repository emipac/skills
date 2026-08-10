---
name: change-evaluation-gate
description: Install or explicitly configure the optional Change Evaluation Gate module while keeping repository configuration separate from clone-local activation. Use when a maintainer wants to adopt Gate policy, inspect whether the Gate is configured, or confirm that distribution remains dormant.
---

# Change Evaluation Gate

Make the optional Gate module available and configure its repository policy
without activating commit enforcement. Configuration does not activate the Gate.

## 1. Confirm the lifecycle state

Keep these states distinct:

- **installed** — Gate assets are available to the selected client;
- **configured** — schema v4 contains an explicitly approved
  `evaluation_gate` policy;
- **activated** — a later clone-local Activation transaction has established
  trust, registered integrations, passed self-tests, and written a receipt.

Installation never edits `.agent-framework.yaml`, creates a hook or receipt,
establishes trust, or blocks a commit. Project-local installation is the
default; global installation requires the maintainer to select it explicitly.

Completion criterion: the maintainer knows the current state and no installed
asset is interpreted as configuration consent.

## 2. Configure through framework-setup

Read `.agent-framework.yaml` and the `framework-setup` configuration reference.
Schema v3 must first use the explicit previewed v4 migration; migration itself
must leave `evaluation_gate` absent.

For schema v4, prepare the five repository-policy subcontracts only:

1. required and advisory Verification check identities;
2. total evaluation budget;
3. bypass policy;
4. execution policy;
5. evidence policy.

Verification remains the sole owner of profiles, scopes, capabilities, command
descriptors, and check applicability. Gate policy references check identities
and never copies commands. Stack providers supply those identities through the
[provider check descriptor contract](references/provider-descriptor-contract.md),
and evaluation consumes them through the
[evaluation process contract](references/evaluation-process-contract.md).
The five subcontracts, their limits, and the supported bypass are defined by the
[Gate policy contract](references/gate-policy-contract.md).
What a decision may claim, which Grader surfaces a change touched, and when
served HTTP or browser evidence is bound to the evaluated snapshot are defined
by the
[task scope and Grader integrity contract](references/task-scope-and-integrity-contract.md).
Evaluation itself never mutates: mutation is reachable only through the separate
operation defined by the
[explicit fix contract](references/explicit-fix-contract.md), which requires a
new evaluation of the resulting snapshot before anything is authorized.
Where evidence is stored, what it may retain, how Sensitive values are redacted
before persistence, and how an operator previews and confirms selective blob
pruning without losing the audit trail are defined by the
[bounded Evidence and Lifecycle event contract](references/bounded-evidence-contract.md).
Configuring policy never runs an evaluation. Show the complete candidate policy before invoking
the `framework-setup` Gate configuration command, and install it only after the
maintainer explicitly confirms that preview.

Completion criterion: absent configuration remains unconfigured; confirmed
configuration contains exactly the five policy subcontracts and no command or
activation state.

## 3. Stop before activation

Do not create or modify Git hooks, `core.hooksPath`, trust settings, runtime
inputs, activation receipts, active-release pointers, or evidence storage.
Those are clone-local Activation transaction responsibilities delivered by
later Gate lifecycle work.

Report the repository as `configured`, never `activated`, and name activation
as a separate future action.

Completion criterion: repository policy may be configured, but the clone has
no Gate-owned operational state and commit behavior is unchanged.
