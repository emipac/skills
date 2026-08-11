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
How concurrent evaluations across clients and linked worktrees serialize per Git
common directory, when in-flight work may be shared, and why coordination that
cannot be trusted is `unverified` are defined by the
[evaluation coordination contract](references/evaluation-coordination-contract.md).
Configuring policy never runs an evaluation. Show the complete candidate policy before invoking
the `framework-setup` Gate configuration command, and install it only after the
maintainer explicitly confirms that preview.

Completion criterion: absent configuration remains unconfigured; confirmed
configuration contains exactly the five policy subcontracts and no command or
activation state.

## 3. Stop before activation

Do not create or modify Git hooks, `core.hooksPath`, trust settings, runtime
inputs, activation receipts, active-release pointers, or evidence storage.
Those belong to the separate, explicitly requested, clone-local Activation
transaction defined by the
[Activation transaction contract](references/activation-transaction-contract.md):
it previews exact changes and commands, obtains repository-bound consent,
resolves runners, establishes client-controlled trust, validates the existing
hook chain, self-tests the adapters and the evaluation process, pins a receipt,
and enables authoritative Git last. Configuring policy never starts it, and a
failed transaction leaves the clone configured with no receipt and no
registration.

Everything that happens to a clone *after* it is activated — taking a candidate
release through an explicit atomic `gate update`, observing health without
repairing anything, recovering drift through a confirmed `gate repair`, and
deactivating, uninstalling, or cleaning up configuration without removing shared
state or historical Evidence — belongs to the
[lifecycle command contract](references/lifecycle-command-contract.md). Never
update, repair, remove, or clean up implicitly, and never mutate anything while
merely reporting status.

Report the repository as `configured`, never `activated`, and name activation
as a separate future action.

## Supported preflight adapters

The Gate ships one authoritative integration and three supported v1 preflight
surfaces: local Git `pre-commit`, Claude Code Desktop's local Code tab, Codex
Desktop with a local project, and Cursor IDE's local Agent. Which native events
each surface normalizes, what each declares about its own event, blocking,
trust, repository, session, filesystem, Git, and invocation capabilities, how
every trust, invocation, timeout, capability, and malformed-output failure
becomes `unverified`, and what a surface must prove before it may be called
supported are defined by the
[adapter conformance contract](references/adapter-conformance-contract.md).

Only authoritative Git authorizes a change. A desktop surface presents the same
decision as structured `not-authoritative` preflight feedback and blocks
nothing, and lacking native blocking never disqualifies it. CLI, SSH, remote,
cloud, and background-agent variants are experimental; chat-only or hosted
surfaces without repository, process, and Git access are unsupported.

Installing an adapter never registers it. Adapters are dormant assets until the
Activation transaction self-tests and registers them.

Completion criterion: repository policy may be configured, but the clone has
no Gate-owned operational state and commit behavior is unchanged.
