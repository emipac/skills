---
name: change-evaluation-gate
description: Install and configure the optional Change Evaluation Gate module, activate a configured clone through its two-invocation command, and diagnose, repair, update, or recover an activated one. Use when a maintainer wants to adopt Gate policy, activate or deactivate commit enforcement in one clone, or find out why a clone is unhealthy.
---

# Change Evaluation Gate

Make the optional Gate module available, configure its repository policy, and —
as a separate explicit act — activate, observe, or recover one clone through the
Gate's own command. Installing does not configure, and configuring does not
activate.

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
The bypass switch is wired: a policy with `bypass.enabled: true` and a
`marker` makes `gate bypass` grantable, a denied commit on such a clone names
that command, and a policy with bypass disabled behaves exactly as it always
has. A grant comes from that command and from nowhere else; never write one by
hand and never import the policy library to construct one.
What a decision may claim, which Grader surfaces a change touched, and when
served HTTP or browser evidence is bound to the evaluated snapshot are defined
by the
[task scope and Grader integrity contract](references/task-scope-and-integrity-contract.md).
Two parts of that contract are built and not switched on. Delivery contracts:
both the hook runner and the preflight runner pass no contract reference
(`contractRef: null`), so every decision the Gate produces today is
`regression-only` with empty acceptance coverage — `acceptanceCriteria`,
`provedAcceptanceCriteria`, and `acceptanceGaps` are always empty and the only
limitation is the fixed regression-only one — and the acceptance-coverage
machinery computes nothing on any run; switching it on means a runner passes
the repository's delivery-contract reference. Served-source runtime binding: no
runner binds a runtime resolver, so a check that declares `smoke` or `browser`
evidence is `unverified` on every run with `prerequisite-missing` — a reason no
reader can act on, because no runtime was ever asked; switching it on means a
runner binds that resolver. Neither is wired by this skill, and neither claim
above should be read as something the Gate does now.
Evaluation itself never mutates: mutation is reachable only through the separate
operation defined by the
[explicit fix contract](references/explicit-fix-contract.md), which requires a
new evaluation of the resulting snapshot before anything is authorized.
Where evidence is stored, what it may retain, how Sensitive values are redacted
before persistence, and how an operator previews and confirms selective blob
pruning without losing the audit trail are defined by the
[bounded Evidence and Lifecycle event contract](references/bounded-evidence-contract.md).
How concurrent evaluations across clients and linked worktrees would serialize
per Git common directory, when in-flight work could be shared, and why
coordination that cannot be trusted is `unverified` are defined by the
[evaluation coordination contract](references/evaluation-coordination-contract.md).
That coordination is built and not switched on: neither runner passes the
coordination seam to evaluation, so every evaluation today is a single-client
gate that serializes nothing, and `gate locks` inspects a lock no evaluation
acquires. Switching it on means a runner binds that seam. Even then only the
file lock could apply here: every hook invocation is its own process, so the
in-process half of that module — the queue, the subscriber map, in-flight
sharing — has nobody to share with in this deployment model. That is a fact
about how the Gate is deployed, not a defect in the code, and it is why the
code stays: this project has repeatedly connected complete subsystems no entry
point could reach rather than deleting them.
Configuring policy never runs an evaluation. Show the complete candidate policy before invoking
the `framework-setup` Gate configuration command, and install it only after the
maintainer explicitly confirms that preview.

Completion criterion: absent configuration remains unconfigured; confirmed
configuration contains exactly the five policy subcontracts and no command or
activation state.

## 3. Never activate implicitly, and operate an activated clone by command

Never write Git hooks, `core.hooksPath`, trust settings, runtime inputs,
activation receipts, active-release pointers, or evidence storage yourself — not
by editing them, and not by importing the activation library and driving it. All
of it belongs to the separate, explicitly requested, clone-local Activation
transaction defined by the
[Activation transaction contract](references/activation-transaction-contract.md):
it previews exact changes and commands, obtains repository-bound consent,
resolves runners, establishes client-controlled trust, validates the existing
hook chain, self-tests the adapters, the evaluation process, and the hook
program it is about to register — by running it against a change it must deny
and requiring a refusal — pins a receipt,
and enables authoritative Git last. Configuring policy never starts it, and a
failed transaction leaves the clone configured with no receipt and no
registration. That transaction is reached by `gate activate`, described below,
and by nothing else — never as a side effect of installing, configuring, or
opening a client. Running that command when the maintainer asked for activation
is not a violation of the paragraph above; it is the only way to satisfy it.

Everything that happens to a clone *after* it is activated — taking a candidate
release through an explicit atomic `gate update`, observing health without
repairing anything, recovering drift through a confirmed `gate repair`, and
deactivating, uninstalling, or cleaning up configuration without removing shared
state or historical Evidence — belongs to the
[lifecycle command contract](references/lifecycle-command-contract.md). Never
update, repair, remove, or clean up implicitly, and never mutate anything while
merely reporting status.

All of that lifecycle is reachable as one command. On an activated clone run it
as `git gate <command>` — start with `git gate status` — a shortcut activation
wrote into that clone's own `.git/config` and nowhere else. Before activation,
or where that shortcut is absent, run `change-evaluation-gate <command>` where
that executable is on the path, or run this installed skill's own
`scripts/gate.mjs` with Node. Resolve that script beside the `SKILL.md` you are
reading rather than assuming a path: an installed skill sits wherever the client
placed it, so the same literal path does not hold across projects. The command
is `activate`, `status`, `locks`, `prune`, `repair`, `update`, `deactivate`,
`uninstall`, `cleanup`, `bypass`, or `sync`. Add `--json` for the same document
a person is shown.

`git gate status` reconciles every control surface the receipt pinned — the
configuration included, through the same observation the commit runner makes —
so a clone whose `.agent-framework.yaml` changed since activation is `broken`
exactly when its next commit is denied `integrity-drift`. It ends with one
`next:` line naming what recovers each finding: `git gate repair` for a
gate-owned Git hook registration, `git gate sync` for a changed configuration
or the commands it resolves to, `git gate deactivate` then `git gate activate`
for anything else the receipt pinned (which re-pins the configuration too),
`gate activate` for a configured clone, and `nothing` when nothing needs doing.
Report that line; every command it names previews first, and none of them is
performed implicitly.
Exit status is `0` when nothing is wrong or the confirmed operation was
performed, `1` when the clone needs attention — including a confirmation it
refused — and `2` when the command could not run.

**Every command previews and writes nothing.** To perform one, run it again
naming the token the preview printed: `gate repair --confirm <token>`,
`gate locks --recover <token>`, and so on. No flag previews and confirms in one
invocation, no `--yes` or `--force` exists, and a confirmation naming a preview
the clone no longer matches performs nothing and says so. Use this surface to
activate, to diagnose, *and* to recover a clone, instead of importing the
lifecycle library or writing a script against it. `gate fix` is a separate
contract and is refused here by name.

`gate activate` is the same two invocations. `gate activate` previews exactly
what the transaction would change and writes nothing; `gate activate --confirm
<token>` performs it. Name the client with `--client <adapter-id>` when it is
not authoritative Git; a desktop client that has not granted trust pauses the
transaction, leaves no integration active, and prints the
`gate activate --resume <transaction-id> --confirm <token>` that resumes it.
A configured clone is a prerequisite: activation never configures one on the way
past. `--actor <name>` is carried into the receipt as **self-declared** and
never as proven — this command cannot see who ran it, and its receipt does not
pretend otherwise.

`gate bypass --reason <text> [--reference <ref>] [--actor <name>]` is the
same two invocations, and the only way a bypass grant exists. The preview
identifies the exact staged snapshot and refuses, by the policy's own
rejection code, a bypass the policy would refuse at commit time — disabled,
no marker, no reason, no policy-required reference; `gate bypass ... --confirm
<token>` writes one one-shot grant bound to that snapshot. The next commit
attempt spends it: staged exactly as previewed and otherwise denied, the commit
proceeds as `bypassed`, never `passed`, with every failed check preserved and
the configured marker printed for the maintainer to put in the message; staged
differently, the grant is refused as `snapshot-mismatch` and spent. Only run it
when the maintainer explicitly asks to bypass a denied commit, show them the
preview, and never confirm on their behalf.

`gate sync [--acknowledge-weakening]` is the same two invocations, and the one
step that re-pins a changed `.agent-framework.yaml` under the adapter set the
receipt already pins. It is an Activation transaction that registers nothing:
every registration it keeps must be exactly what it would write, or it refuses
and names `gate repair`, `gate status`, or `gate deactivate` then `gate
activate` — the last also whenever the installed gate's adapter set differs
from the receipt's. The preview names the trusted identity, the candidate
identity, and every way `evaluatePolicyTransition` finds the candidate weaker
than the trusted policy, which it reads from a document that reproduces the
pinned identity — a receipt `gate sync` wrote, or the committed file at `HEAD`
— and refuses to guess when neither does. A weaker candidate offers no token;
`gate sync --acknowledge-weakening` offers one that binds the candidate and the
acknowledgement together. Show the maintainer that preview, name the weakening
in your own words, and never add `--acknowledge-weakening` or confirm on their
behalf.

When this skill configured the policy, report the repository as `configured`,
never `activated`, and name activation as a separate explicit action. When
reporting on a clone the surface observed, report the state that surface
found — an activated clone is `activated` — and never infer a state the surface
did not report.

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

Completion criterion: installing or configuring leaves the clone with no
Gate-owned operational state and commit behavior unchanged; only a confirmed
`gate activate` registers an adapter, and it registers exactly the ones the
maintainer confirmed in its preview.

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
