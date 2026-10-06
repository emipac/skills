# FS-008 — Stop Codex running a command that destroys work

Status: ready-for-agent
Labels: ready-for-agent, enhancement
Blocked by: 06-stop-an-agent-running-a-command-that-destroys-work
Tracker ID: 08-stop-codex-running-a-command-that-destroys-work
Draft key: FS-008

**Status:** ready-for-agent

**Parent feature contract:** none. Extends FS-006's guardrail to Codex, per the
maintainer's decision of 2026-10-06 to cover every client with hooks.

## Outcome

A maintainer who opted the repository into the guardrail can register it for
Codex. The result is one of two outcomes, and neither is guessed:

- Codex's agent is stopped before a shell command that FS-006's rules block,
  and is told why.
- Registering for Codex is refused with a stated reason, because Codex offers no
  observed hook that can stop a shell command.

## Approach and Tradeoffs

- Verified: the Gate declares Codex Desktop's registration surface as
  `.codex/hooks.json` with matcher groups. It also records that Codex's feedback
  channel has not been observed (`feedback-channel-unobserved`, TB-048).
  Nothing in the repository has observed a Codex hook that runs before a shell
  command.
- Proposed, and to be observed first: run a real Codex with a trivial
  pre-shell-command hook, if Codex has one. Record the event name, the input
  fields, the answer that blocks, and what the agent sees, together with the
  Codex version.
- If no such hook is observed, ship the refusal:
  - `guardrail add codex` is refused (for example `client-hook-unobserved`),
    naming what is missing, with nothing written;
  - the guide says so.

  This mirrors how TB-048 refuses a surface that cannot answer.
- If one is observed, ship it exactly as FS-007 ships Cursor: the observed
  answer format, and `add`/`remove` with preview and confirmation.

## Architecture Boundary and Public Seam

The guardrail program with a recorded Codex payload, or the Framework
command's refusal, on fixtures. First red test: either a recorded Codex payload
for `git clean -fd` produces the observed blocking answer, or
`guardrail add codex` is refused with the stated reason and nothing written.

## Safeguards and Invariants

- FS-006's safeguards hold.
- No Codex support is claimed from documentation alone.

## Prohibited Behavior and Non-goals

- No change to the Gate's Codex adapter.
- No registration that cannot block.

## Acceptance Criteria

- [ ] The observation, or the absence of a usable hook, is recorded in the
  repository with the Codex version.
- [ ] Either every FS-006 rule is blocked through the observed Codex contract
  and `add`/`remove codex` preview and confirm, or `add codex` is refused with
  a stated reason and nothing written. The guide states which.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | the Codex payload contract or the refusal, and an unchanged clone | `npm run test:unit` | Yes — observable at the program and the command |

Smoke evidence: required only if registration ships; then the
`npm run test:install` row from FS-006 is extended. Frontend build and browser
evidence are inapplicable.

## Blocked By

- `FS-006` — the guardrail program and its registration operation.

## Unresolved Assumptions

None.

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] Acceptance criteria trace to the SRS and feature contract.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Risks and resolved decisions are traced to the parent contract.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start.
- [x] The ticket fits one fresh implementation context.
- [x] User-facing and frontend evidence requirements are covered or explicitly inapplicable.
