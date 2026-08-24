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
hook chain, self-tests the adapters, the evaluation process, and the hook
program it is about to register — by running it against a change it must deny
and requiring a refusal — pins a receipt,
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

The read-only half of that lifecycle is reachable as a command. Run
`change-evaluation-gate status`, `... locks`, or `... prune` — or
`node skills/change-evaluation-gate/scripts/gate.mjs <command>` — to report a
clone's health, inspect its coordination lock, or preview what a prune would
remove. Add `--json` for the same document a person is shown. Exit status is `0`
when nothing is wrong, `1` when the clone needs attention, and `2` when the
command could not run. That surface writes nothing and refuses every mutating
selector, including `--recover`, `--confirm`, and `--force`; use it to diagnose
a clone instead of importing the lifecycle library.

Report the repository as `configured`, never `activated`, and name activation
as a separate future action.

## Supported preflight adapters

The Gate ships one authoritative integration and three declared v1 preflight
surfaces: local Git `pre-commit`, Claude Code Desktop's local Code tab, Codex
Desktop with a local project, and Cursor IDE's local Agent. Which native events
each surface normalizes, what each declares about its own event, blocking,
trust, repository, session, filesystem, Git, invocation, and feedback
capabilities, how every trust, invocation, timeout, capability, and
malformed-output failure becomes `unverified`, and what a surface must prove
before it may be called supported are defined by the
[adapter conformance contract](references/adapter-conformance-contract.md).

Activation registers each desktop surface against the packaged
`gate-preflight.mjs` program. That program evaluates the working tree as
preflight, presents `not-authoritative`, and answers through the adapter's
declared feedback channel — never through its exit status.

Only authoritative Git authorizes a change. A desktop surface presents the same
decision as structured `not-authoritative` preflight feedback and blocks
nothing, and lacking native blocking never disqualifies it. CLI, SSH, remote,
cloud, and background-agent variants are experimental; chat-only or hosted
surfaces without repository, process, and Git access are unsupported.

**Cursor `3.15.6` is `supported`.** Its baseline was driven by a real Cursor
invocation: all eleven checks passed, including `captured-payload-readable`,
which proves the adapter's declared field names read what the client actually
sends rather than what the declaration assumed. The exact version came from
`payload.cursor_version` in the same invocation as the capture, and the record
is `.scratch/change-evaluation-gate/client-baselines/cursor.json`.

`claude-code-desktop`, `codex-desktop`, and authoritative `git` remain
`experimental` / `client-invocation-not-observed`. Their declared fields and
event values come from real captured client payloads and each passes the
offline baseline, but none has been driven end to end by a real client
invocation, and a baseline whose fixtures came from the declaration under test
cannot establish support. Report those three as declared, never as supported.
Git's tier reflects baseline provenance only; it is authoritative regardless.

A tier is always derived from the evidence beside it, never declared. Read the
current tiers from `npm run gate-runtime-portability` rather than from prose —
including this paragraph.

Installing an adapter never registers it. Adapters are dormant assets until the
Activation transaction self-tests and registers them.

Completion criterion: repository policy may be configured, but the clone has
no Gate-owned operational state and commit behavior is unchanged.

## Release qualification

A Gate-capable release carries a compatibility manifest: the release version
read from `package.json`, the environments its runtime portability matrix was
actually executed on, every surface's shared baseline outcomes with the exact
versions they ran under, and the delivery risks that stayed open. What the
manifest must be able to show, and what a maintainer must record to promote a
surface out of `experimental`, are defined by the
[release qualification contract](references/release-qualification-contract.md).

Run `npm run gate-runtime-portability` to execute the matrix and qualify the
manifest here; add `--json` for the whole manifest and `--out <path>` to write
it. Support tiers are derived from the evidence rather than declared, tested
versions are an evidence snapshot rather than a standing allowlist, and an
environment nobody ran the matrix on is `unverified` — untested, not refused.

Completion criterion: every claim in the manifest is one the evidence beside it
produces.
