# Refused to present a decision the gate itself would refuse

Delivered TB-037, a small defect slice found while reviewing TB-033: that
ticket made the authoritative runner judge every decision with
`validateDecision` before it may exit `0`, and the preflight runner gained no
equivalent of its own. The two runners could therefore hold two definitions of
a readable decision, which is the divergence `AC-EVAL-002` exists to prevent.

- Gave both runners one definition. `contractFindings` — the total wrapper
  TB-033 put around `validateDecision` in `hook-runner.mjs` — is now exported,
  and `preflight-runner.mjs` judges the decision its evaluation seam returns
  with that same function. The preflight carries no completeness rule of its
  own, and a source scan asserts it never inspects a decision field to decide
  whether the decision is complete.
- Reused the refusal that was already there. A decision the contract rejects
  takes the `unverified` path an unreadable payload, an unmatched event, an
  unresolvable repository root, and an internal failure already take. The slice
  added a condition, not a mechanism.
- Kept the message short, because it is a prompt. What the preflight presents is
  submitted to an agent as its next user message, so the detail says the
  decision could not be read against the evaluation contract and how many
  findings there were. The findings themselves are counted, never reproduced.
- Recorded what the ticket assumed and what was actually true about Evidence.
  The preflight never appends anything itself: the append happens inside
  `evaluate`, before the decision returns, so no check the preflight can make
  arrives in time to stop an envelope `evaluate` already wrote. What this slice
  does guarantee is narrower and honest — a decision handed back across the
  preflight's own evaluation seam is judged before it is presented, and the
  preflight persists nothing on that path.
- Recorded that the defect was smaller than the ticket described. A malformed
  decision was already refused inside `runAdapterEvaluation`, which has
  validated its seam's return since TB-013, so the preflight never rendered one
  as check results. What was genuinely missing was the preflight's own judgement
  of the same decision by the same rule, and a message fit for an agent to read.

Scope held: preflight stays `not-authoritative` and non-blocking, and the
program still always exits `0`. TB-027's rules are untouched — an interrupted
turn is still answered with nothing and the repetition budget still applies.
No change to `presentDecision`, `formatFeedback`, the adapter declarations, or
the authoritative runner's behaviour; the only edit to `hook-runner.mjs` is the
`export` keyword on a helper it already had.

Verification: `npm run test:unit` (387 passing), `npm run validate` (29 skills,
258 Markdown files), `npm run test:install`, and regression runs of all nine
capabilities — `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance`, `gate-security-control-smoke`, and
`gate-runtime-portability`. The red test ran first and failed on the message:
the preflight presented `The evaluation returned output the process contract
rejects: decision-field-missing at decision.protocolVersion.` — a contract
finding where a short instruction belongs, and no count.
