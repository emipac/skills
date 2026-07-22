---
name: implement
description: Implement one ready delivery contract through vertical red-green cycles, configured verification, review, and explicit contract-amendment decisions.
---

# Implement

Implement one delivery contract in one fresh context. This is the framework's
single implementation orchestrator; `/tdd` supplies the red-green discipline
and `/code-review` supplies the final review.

## 1. Load the contract

Read `.agent-framework.yaml`, the selected tracker adapter, the full ticket and
comments, parent feature contract, linked SRS requirements/acceptance
criteria/safeguards, glossary, ADRs, project guidelines, and configured
verification commands. Inspect the working tree and relevant code.

If the user provides ad-hoc work without a ticket, establish the same minimal
delivery contract in the conversation and get explicit approval before coding.

Completion criterion: every behavior, invariant, non-goal, dependency, public
seam, and required evidence layer is known.

## 2. Enforce readiness

Refuse to start when a blocker is incomplete, a start-blocking assumption is
open, the ticket lacks SRS/feature traceability, the outcome is horizontal or
too large for one context, the public seam is undecided, or the verification
matrix cannot prove the acceptance criteria. Report exact missing fields and
route back to `/to-tickets`, `/to-spec`, or `/srs-modeling` as appropriate.

Completion criterion: status is `ready-for-agent`, every blocker is complete,
and the first failing behavior at the agreed seam can be stated before code is
changed.

## 3. Establish the baseline

Run the narrow existing tests and static checks that cover the seam. Separate
pre-existing failures from contract work. Record the protected files and never
modify `AGENTS.md`.

Completion criterion: the baseline is understood and one exact command can
show the first new behavior red.

## 4. Drive vertical red-green cycles

Use `/tdd` for one acceptance behavior at a time:

1. **Red:** add one behavior test at the agreed public seam. Run the targeted
   command and capture a failure caused by missing behavior, not syntax,
   fixture, environment, or unrelated errors.
2. **Green:** implement only enough end-to-end code to satisfy that behavior.
   Run the same command and capture the pass.
3. Run the ticket's regular static or focused checks when the changed boundary
   requires them.
4. Record the cycle in
   [the evidence log](references/evidence-log.md), then select the next
   acceptance behavior.

Keep each cycle vertical. Do not generate every component and validate in a
batch. After all acceptance behaviors are green, refactor for clarity while
keeping the focused tests green; do not mix speculative refactoring into the
red-green cycle.

Completion criterion: every ticket acceptance ID has red-before-green evidence
at an agreed seam and the implementation contains no behavior outside the
contract.

## 5. Handle implementation learning explicitly

Implementation details may change freely within the contract. When learning
would alter observable behavior, an acceptance criterion, safeguard, non-goal,
public interface, or durable architecture decision, pause implementation and
write a [contract amendment](references/contract-amendment.md).

Present the delta, rationale, affected IDs, risk, and evidence impact to the
user or authorized decision owner. Resume only after an explicit decision:

- accepted → update the owning SRS, feature contract, delivery contract, or ADR
  first, then update tests and continue;
- rejected → preserve the current contract and choose a conforming approach;
- deferred → mark the ticket blocked and stop.

Never canonize incidental private implementation details in durable artifacts.

## 6. Verify, review, and hand off

Run every required row in the ticket verification matrix using the exact
configured commands. Run `/code-review` against repository standards and the
contract. Fix in-scope findings and rerun affected evidence.

Report:

- acceptance IDs delivered;
- red and green commands/outcomes for each cycle;
- verification commands and results;
- safeguards and non-goals preserved;
- accepted contract amendments;
- intentionally skipped evidence with reasons;
- remaining findings or blockers.

Update ticket evidence and project history when required. Commit or push only
when the user explicitly requests it.

Completion criterion: every acceptance criterion is green, every required
verification row passes, review has no unresolved in-scope finding, and the
working tree contains only contract-scoped changes.
