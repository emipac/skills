# TB-072 — Walk a maintainer to a healthy clone

Status: ready-for-agent
Parent: guided-setup-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by: 67-name-the-next-step-without-a-terminal, 74-let-the-gate-name-the-command-for-each-remedy
Tracker ID: 72-walk-a-maintainer-to-a-healthy-clone
Draft key: TB-072

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/guided-setup/issues/guided-setup-feature-spec.md`

## Outcome

In an interactive terminal, `agent-framework setup` runs the plan `TB-067`
names. For each step it shows the owning operation's complete preview, asks
only what that operation cannot derive (offering its own draft as the default),
and on an explicit yes confirms exactly that preview. It repeats until Gate
status names nothing further. A weaker policy needs the weakening typed back.
The maintainer never writes a draft file or copies a token.

## SRS Traceability

- `FR-GUIDE-001`, `FR-GUIDE-003`, `FR-GUIDE-004`, `NFR-REL-004`
- `AC-GUIDE-001`, `AC-GUIDE-002`
- `SG-GUIDE-001`, `SG-CFG-001`, `SG-OWNER-001`
- `RISK-011`, `RISK-005`, `RISK-008`

## Domain Concepts

Guided setup, Activation consent, Activation transaction, Trusted gate
configuration.

## Approach and Tradeoffs

- Verified: each owning operation prints a preview and a `confirmationToken`
  (Gate `--json` documents) or a preview token (`configure.mjs`), and confirms
  only when the same token is passed back.
- Verified: the migration report names ambiguous commands, and
  `--draft-mapping` / `--draft-policy` produce the drafts a maintainer edits
  today.
- Proposed: a scripted terminal (input answers, captured output, interactive
  flag) is injectable into the command's exported entry for tests; the bin
  passes the real one. Node's built-in line reader, no dependency.
- Proposed: consent is per step and never remembered across steps or runs.
- Proposed, per `RISK-011`'s accepted mitigation: the Gate records that consent
  came through an interactive guided run. If the Gate's confirmation path has
  no way to accept that, add it to the Gate's command interface in this slice
  (feature contract `GAP-005`).

## Architecture Boundary and Public Seam

The Framework command in `framework-setup`, driving `configure.mjs` operations
in-process and the Gate only through its `--json` command. Public seam: the
exported entry with a scripted terminal, plus a twin fixture run through the
direct command sequence. First red test: a schema v3 fixture with scripted
"yes" answers ends with Gate status healthy and nothing further to do.

## Safeguards and Invariants

- `SG-GUIDE-001`: no confirmation without the interactive flag; an answer other
  than an explicit yes confirms nothing and ends the run with the clone at the
  last completed step.
- `SG-CFG-001`: a weaker candidate is refused unless the typed acknowledgement
  names the weakening.
- `SG-OWNER-001`: the Framework command decides the order only; every
  validation and refusal is the owning operation's.

## Prohibited Behavior and Non-goals

- No auto-answering, no default of yes, no consent carried between steps.
- No configuration revision inside setup; those are `TB-069` and `TB-070`.
- No retry of a refused step.

## Risk and Decision Impacts

- `RISK-011`: accepted with the mitigation above; the consent-channel record is
  part of this slice's outcome.
- `RISK-005`: migration is the owning previewed operation, unchanged.
- `RISK-008`: `gate sync` weakening detection, unchanged.

## Acceptance Criteria

- [ ] `AC-GUIDE-001`: from each adoption-state fixture of `TB-067`, scripted yes
  answers reach Gate status healthy with nothing further to do, or completed
  setup with Gate steps unavailable when the Gate module is absent; only
  underivable decisions are asked.
- [ ] `AC-GUIDE-002`: each yes confirms exactly the previewed identity; a no
  stops with nothing further written; a weakening is refused until the typed
  acknowledgement; without the interactive flag nothing is confirmed.
- [ ] `NFR-REL-004`: the guided run and the direct command sequence on twin
  fixtures produce byte-identical configuration and receipt and the same
  Lifecycle event types, apart from the recorded consent channel.
- [ ] Doctor predicting a stop ends the run at that step with the owning reason.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-GUIDE-001`, `AC-GUIDE-002`, `NFR-REL-004`, `SG-GUIDE-001`, `SG-CFG-001`: every adoption state, yes/no, weakening, doctor-stop, no-interactive-flag, and guided-versus-direct twin fixtures | `npm run test:unit` | Yes — the whole flow is observable through the scripted terminal |
| smoke | both | `AC-GUIDE-001`, `RISK-011`: on a real clone, a scripted guided run from schema v3 to activated, then a real commit graded by the hook and the consent channel recorded | `gate-activation-smoke`, extended by this slice | Yes — user-facing and crosses every real operation |

Frontend build and browser evidence are inapplicable.

## Blocked By

- `TB-067` — the plan this slice executes.
- `TB-074` — recovery steps take their commands from the Gate.

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
