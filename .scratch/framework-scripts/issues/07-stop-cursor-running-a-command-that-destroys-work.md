# FS-007 — Stop Cursor running a command that destroys work

Status: ready-for-agent
Labels: ready-for-agent, enhancement
Blocked by: 06-stop-an-agent-running-a-command-that-destroys-work
Tracker ID: 07-stop-cursor-running-a-command-that-destroys-work
Draft key: FS-007

**Status:** ready-for-agent

**Parent feature contract:** none. Extends FS-006's guardrail to Cursor, per
the maintainer's decision of 2026-10-06 to cover every client with hooks.

## Outcome

A maintainer who opted the repository into the guardrail can register it for
Cursor too. Cursor's agent is then stopped before a shell command that FS-006's
rules block, and is told why, while every other command runs. The guardrail
sits in `.cursor/hooks.json` beside any Gate entry without disturbing it.

## Approach and Tradeoffs

- Verified: `.cursor/hooks.json` is the file the Gate registers into, with
  `"version": 1` and a flat `hooks` container. The Gate pins only its own entry,
  so a sibling guardrail entry is not Gate drift.
- Proposed, and to be observed first: Cursor's `beforeShellExecution` hook
  receives the command in its JSON input and blocks with a JSON answer on
  stdout, such as a `permission` of `deny` with a message for the user and one
  for the agent. Before any code, run a real Cursor with a trivial
  `beforeShellExecution` hook. Record the exact input fields, the answer that
  blocks, and what the agent sees, in the same way the Gate's adapter
  qualification findings were recorded.
  If the observed contract cannot block, stop and report; do not ship a hook
  that cannot stop anything.
- Proposed: the same guardrail program answers in Cursor's format when told it
  runs under Cursor, for example by a client argument in the registered
  command. The rules and the message text stay FS-006's.
- Proposed: `agent-framework guardrail add cursor` and `remove cursor` preview
  and confirm exactly as FS-006 does. They merge one `beforeShellExecution`
  entry and create the file with `"version": 1` only when it is missing.

## Architecture Boundary and Public Seam

The guardrail program with a Cursor payload on stdin, and the Framework command
on fixtures. First red test: a recorded Cursor `beforeShellExecution` payload
for `git reset --hard` produces the observed blocking answer.

## Safeguards and Invariants

- FS-006's safeguards hold.
- The Gate's own entry in `.cursor/hooks.json` is byte-for-byte unchanged by
  `add` and `remove`, and `gate status` stays healthy on an activated fixture.

## Prohibited Behavior and Non-goals

- No change to the Gate's Cursor adapter or its registration.
- No claim of Cursor support from documentation alone; the contract must be
  observed in a real client.

## Acceptance Criteria

- [ ] The observed Cursor contract (input fields, blocking answer, agent-visible
  message) is recorded in the repository with the client version it was
  observed on.
- [ ] A Cursor payload for each FS-006 rule is blocked with the observed
  answer, and an allowed command passes.
- [ ] `guardrail add cursor` and `remove cursor` preview, confirm, and keep the
  Gate's entry and every other entry unchanged. On an activated fixture,
  `gate status` stays `healthy`.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | the Cursor payload contract, registration beside a Gate entry, and status still healthy | `npm run test:unit` | Yes — observable at the program and the command |
| smoke | both | a guardrail registered next to an activated Gate leaves the clone healthy | `gate-activation-smoke`, extended by this slice | Yes — two owners share one client file |

Frontend build and browser evidence are inapplicable.

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
