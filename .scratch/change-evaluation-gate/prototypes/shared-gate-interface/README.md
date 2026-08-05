# PROTOTYPE — shared gate interface

## Question

Can one client-independent JSON request and one structured decision keep the
Change Evaluation Gate deep while Git, Claude Code Desktop, Codex Desktop, and
Cursor IDE remain thin adapters? This prototype exercises the request,
decision, and adapter-response shapes against passing, failing, unverified,
advisory, bypassed, regression-only, and conflicting-attempt evaluations. It
does not execute project commands and is not production code.

## Run

```bash
node .scratch/change-evaluation-gate/prototypes/shared-gate-interface/prototype.mjs
```

Use `a` to cycle adapters, `s` to cycle scenarios, and `q` to quit. The screen
shows the complete request, the core decision, and the native adapter response
after every action.

## Proposed seam

```text
native event
    -> thin adapter
    -> gate evaluate < versioned JSON request
    -> Verification profile + Evidence ladder
    -> versioned JSON decision
    -> thin adapter response
```

The request contains no verification commands or client-native payloads. It may
select a repository-owned delivery contract so the core can distinguish
task-specific acceptance from regression-only evidence. The core materializes
the exact change snapshot in an isolated execution root, resolves checks as
code-based graders, executes their assertions, preserves attempt history,
applies policy, and writes coverage and integrity evidence. A successful process
exchange returns exit `0` even when the decision is `failed` or `unverified`;
adapters map `authorization` to their native exit/output rules.

These additions apply the outcome-grading and isolation lessons from
[Anthropic's agent-evaluation guidance](../../research/anthropic-agent-evals-gate-lessons.md)
without requiring agent transcripts, repeated model trials, weighted required
scores, or `pass@k` authorization.
