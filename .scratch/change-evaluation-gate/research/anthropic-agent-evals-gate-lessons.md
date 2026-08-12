# Lessons from Anthropic's agent-evaluation guidance

Date: 2026-08-04

## Question

What should the Change Evaluation Gate adopt from Anthropic's
[Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents),
especially its treatment of code-based graders, without turning a commit gate
into a benchmark of the agent's whole trajectory?

## Conclusion

The article strongly validates the gate's deterministic, code-first direction,
but it also exposes one critical risk: assigning an identity to a Git snapshot
does not prove that commands actually ran in an isolated materialization of
that snapshot. The shared interface should make the evaluated task, grader
assertions, execution environment, attempt history, coverage, and harness
failures explicit.

The Change Evaluation Gate is not an agent-evaluation harness in Anthropic's
sense. It evaluates one real proposed code state, produced by a human or an
agent, for change acceptance and regression safety. It does not compare models,
sample independent agent trials, or require access to a client transcript. That
boundary is important: Anthropic recommends grading what an agent produced
rather than rigidly enforcing the path it took, because valid trajectories can
vary.

## Translating the article's model

Anthropic defines a task, trial, grader, transcript, outcome, evaluation
harness, agent harness, and evaluation suite as separate concepts. It also
distinguishes an agent's transcript from the final state of its environment.
For the gate, the closest mappings are:

| Anthropic term | Gate interpretation | Boundary |
| --- | --- | --- |
| Task | One snapshot plus its selected regression profile and, when available, its delivery-contract acceptance criteria. | A profile alone is not a full task-specific specification. |
| Trial | One gate evaluation of that task. | Repeated agent runs are not part of commit authorization. |
| Grader | One normalized check descriptor, such as Pint, Rector, PHPStan, a Pest suite, a build, or a browser state check. | Keep the existing public term `check`; define it formally as a code-based grader. |
| Assertion | An atomic claim within a check, such as a test case or an acceptance criterion covered by the result. | One command may prove several claims and may produce several assertion results. |
| Transcript | The agent's tool calls, messages, and intermediate steps. | Not portable across Git, Claude Code Desktop, Codex Desktop, and Cursor IDE; not required by the gate. |
| Outcome | The materialized repository/application state after the change. | This is the primary grading target. |
| Evaluation harness | The gate core, snapshot materializer, command runner, evidence recorder, and policy engine. | The product should still be called the Change Evaluation Gate. |
| Agent harness | Claude Code Desktop, Codex Desktop, Cursor IDE, or another system that produced the change. | The gate must not depend on it for authoritative evidence. |
| Evaluation suite | The ordered set of applicable profile checks and contract-specific checks. | The existing Evidence ladder supplies the execution order. |

This mapping preserves the existing architecture: client adapters provide a
change-evaluation request, while the core resolves the repository-owned profile
and runs normalized checks.

## Why code-based graders fit

Anthropic lists binary tests, static analysis, outcome verification, string
matching, tool-call verification, and transcript analysis as code-based grader
methods. Their main advantages are speed, cost, objectivity, reproducibility,
debuggability, and precise conditions; their weaknesses are brittleness and a
lack of nuance. For coding agents, Anthropic says deterministic graders are a
natural fit and emphasizes thorough tests of the generated code.

The Laravel profile already selects the strongest subset for a change gate:

- Pest and browser suites are binary tests and outcome/state verification.
- PHPStan/Larastan, Rector dry-run, and Pint check deterministic code
  properties.
- Builds verify that a declared artifact can be produced.
- Smoke checks verify a repository-declared runtime outcome.

The gate should prefer state and behavior assertions over string matching or
source-shape assertions. A format check can enforce formatting, but it does not
prove business acceptance. A build can prove artifact production, but not that
the artifact behaves correctly. Each check therefore needs explicit evidence
claims rather than an undifferentiated green status.

## Adopt in the shared interface now

### 1. Represent the evaluation task explicitly

The current request identifies a repository and change target, but not whether
the evaluation is proving only regression safety or also task-specific
acceptance. Anthropic's insistence on unambiguous tasks and success criteria
shows why that distinction must be visible.

Add a core-resolved task identity to the request/decision contract:

```json
{
  "evaluation": {
    "purpose": "change-acceptance-and-regression",
    "contractRef": ".agent-framework/delivery-contract.json"
  }
}
```

`contractRef` should be optional and repository-relative. The adapter must not
send commands or client-native task text. The core resolves and hashes the
contract from the evaluated repository context. If no acceptance contract is
available, the decision must say that it proves configured regression checks
only; it must not imply that the user's requested behavior was proved.

### 2. Keep checks, but define them as code-based graders with assertions

Do not rename the established generic check descriptor merely to copy the
article's vocabulary. Add structured grader metadata and atomic assertion
results:

```json
{
  "id": "laravel.tests.focused",
  "stage": "focused",
  "grader": {
    "type": "code",
    "method": "binary-test",
    "target": "outcome"
  },
  "policy": "required",
  "assertions": [
    {
      "id": "AC-AUTH-001",
      "outcome": "passed",
      "summary": "Empty passwords are rejected."
    }
  ],
  "outcome": "passed"
}
```

`method` should be an extensible semantic value such as `binary-test`,
`static-analysis`, `artifact-build`, `state-check`, or `format-check`.
`target` should be `outcome` or `artifact` in v1. Transcript-targeted graders
are deliberately outside authoritative gate evaluation.

Required authorization remains binary: every applicable required check must
pass. Assertion-level results and counts improve diagnosis and coverage but do
not introduce weighted thresholds or partial authorization.

### 3. Prove that execution matches the named snapshot

Anthropic warns that shared files, caches, resource exhaustion, and visible Git
history can correlate trials or artificially improve results; it recommends a
clean, isolated environment for each trial. The gate has a more immediate
version of this problem: a `git-index` identifier is misleading if commands
actually read unstaged files from the live worktree.

For authoritative Git evaluation, the core must materialize the exact staged
tree into an isolated execution root, or return `unverified`. The decision
should record:

```json
{
  "environment": {
    "id": "env-...",
    "isolation": "materialized-snapshot",
    "root": "<redacted-or-logical-id>",
    "snapshotId": "git-tree:4d3c2b1",
    "sourceMutable": false,
    "historyVisibility": "policy-defined",
    "cachePolicy": "declared-only"
  }
}
```

Desktop preflight may evaluate an explicitly captured worktree snapshot, but
it needs the same materialization guarantee. Parallel client sessions must not
share mutable evaluation roots. Declared dependency caches may be mounted or
reused only under an explicit policy and must not obscure the source snapshot
identity.

### 4. Preserve attempts and separate grader rejection from harness failure

The existing `failed` versus `unverified` distinction is sound. It matches the
article's warning that low scores can come from grading bugs, ambiguous tasks,
or harness constraints rather than poor work. Strengthen each check result with
attempt history and a stable reason classification:

```json
{
  "attempts": [
    {
      "attempt": 1,
      "startedAt": "...",
      "durationMs": 1234,
      "exitCode": 1,
      "outcome": "failed",
      "reasonCode": "grader-negative"
    }
  ],
  "outcome": "failed"
}
```

Useful reason families are `grader-negative`, `prerequisite-missing`,
`configuration-invalid`, `timeout`, `process-crash`, `output-malformed`, and
`snapshot-mismatch`. The last six normalize to `unverified`; only a completed
negative code grader normalizes to `failed`.

The core should never silently retry required checks. A deliberate rerun may
still be allowed by the settled policy, but prior attempts must remain visible
in the evaluation evidence so a last-attempt pass does not hide flakiness.

### 5. Add coverage and integrity summaries to the decision

Anthropic recommends robust success criteria and graders that resist bypasses.
A local gate cannot provide hidden tests or become tamper-proof, but it can
avoid overstating its evidence. Add:

```json
{
  "coverage": {
    "requiredClaims": ["AC-AUTH-001"],
    "provedClaims": ["AC-AUTH-001"],
    "gaps": []
  },
  "integrity": {
    "configurationId": "sha256:...",
    "runnerVersion": "...",
    "providerVersions": {"laravel": "..."},
    "changedGraderSurfaces": ["tests/Feature/AuthTest.php"]
  }
}
```

Changes to tests, gate configuration, profile providers, or verification
scripts are not automatically malicious; tests legitimately change with
behavior. They should nevertheless be visible as grader-surface changes. The
gate can then avoid presenting a self-modified grader as equivalent to an
unchanged trusted grader. Whether such changes require approval belongs to the
later security-policy decision.

### 6. Keep transport success separate from authorization

The prototype's process-first contract remains correct. A valid decision
envelope may exit `0` while its authorization is `deny`; an invocation,
protocol, or malformed-output failure is a transport/harness problem. This
separation lets Git block on `authorization` while desktop clients display the
same structured result without native blocking.

## Defer to later tickets

### Configuration, evidence, and security contract

Defer the serialized schema for assertions, attempt retention, reason codes,
environment provenance, grader-surface classification, redaction, and evidence
storage to **Define configuration, evidence, and security contract**. That
ticket should also decide how trusted gate/profile configuration is anchored
when the evaluated snapshot changes the same files.

### Compatibility and conformance evaluation of the gate itself

The article's capability-versus-regression distinction belongs primarily to
testing this framework and its adapters, not authorizing each project commit.
Create a gate conformance suite with reference fixtures:

- capability cases initially exercise unsupported or difficult adapter,
  snapshot, timeout, process-tree, and malformed-output behavior;
- stable cases graduate into a near-100% regression suite;
- positive and negative cases cover both correct triggering and intentional
  non-triggering;
- reference implementations prove each task and grader are solvable;
- every supported desktop surface runs the same fixture bank.

The suite and release threshold belong to implementation tickets created after
Wayfinder resolves the specification. It should not add benchmark datasets or
model comparisons to the runtime gate protocol.

### Repeated-trial metrics and flaky checks

Anthropic distinguishes `pass@k` (at least one success in multiple trials)
from `pass^k` (all trials succeed). Neither belongs in the default commit path:
required code checks should be deterministic and regression-oriented, and
`pass@k` would reward retry-until-green behavior.

A later configuration version may allow a repository to declare repeated
trials and an `all` aggregation for inherently stochastic browser or
integration checks. Until then, the gate should record attempts, avoid
automatic retries, and classify unstable required checks as a problem to fix,
not a score to average away.

### Model-based and human graders

The settled v1 policy already makes model-based review advisory. Keep it out of
authoritative authorization until a later design specifies rubrics, versioning,
calibration against humans, unknown/abstain behavior, cost, and variance.
Periodic human review remains useful for validating whether code graders and
acceptance mappings are fair, but it is not part of a local commit hook.

## Reject or keep out of scope

- **Grading required tool-call sequences.** Anthropic reports that rigid path
  checks punish valid solutions. The gate should grade final code and state,
  not whether the agent used a preferred sequence of tools.
- **Requiring a client transcript.** Git has none, desktop formats differ, and
  human commits must receive identical treatment. Optional transcript metrics
  may exist outside the authoritative gate.
- **Using `pass@k` for commit authorization.** One lucky success does not prove
  a reliable regression check.
- **Weighted aggregate scores for required checks.** A high formatter/build
  score must not compensate for a failing security or acceptance test. Keep
  required authorization conjunctive.
- **Reference solutions for ordinary repository changes.** Novel product work
  rarely has a known implementation. Reference solutions are valuable for the
  gate's own conformance fixtures, not as a prerequisite for every commit.
- **Calling this product an agent eval harness.** Its subject is a proposed
  change regardless of author. Broader agent capability evaluation is a
  separate product and lifecycle.

## Proposed prototype delta

The smallest useful revision keeps adapters thin and the core authoritative:

```text
native event
    -> thin adapter
    -> versioned request(repository, snapshot target, task/contract selector,
       enforcement role, trigger, adapter/session identity)
    -> core materializes exact snapshot in isolated environment
    -> core resolves profile checks as code-based graders
    -> core executes assertions and records every attempt
    -> policy produces outcome + authorization + coverage + integrity evidence
    -> versioned decision
    -> thin adapter maps authorization/feedback to native behavior
```

The current `outcome`, `authorization`, `snapshot`, `configurationId`,
`advisories`, `bypass`, and evidence identity remain useful. The important
additions are task scope, assertion-level grader evidence, isolated-environment
identity, attempt/reason history, acceptance coverage, and grader integrity.

## Strongest recommendations

1. Make exact-snapshot materialization and isolated execution a required
   property, not merely an evidence label.
2. Treat each normalized check as a code-based grader with explicit method,
   target, atomic assertions, and evidence claims.
3. Distinguish regression-only evaluation from task-specific acceptance and
   report coverage gaps instead of implying that a green suite proves intent.
4. Preserve attempt history and structured harness-failure reasons; never hide
   flaky or unexecutable evidence behind one summary string.
5. Surface changes to grader inputs and bind runner, provider, configuration,
   environment, and snapshot identities in the decision.

## Uncertainty

The article is about evaluating agents through repeatable tasks and trials,
whereas this gate evaluates a single real repository change. Its guidance on
outcome grading, isolation, grader quality, and anti-gaming transfers directly;
its statistical trial metrics and transcript practices do not. The main open
engineering question is how to materialize a staged snapshot while safely and
portably providing large dependencies, services, caches, browsers, and
credentials across desktop environments. That should become an explicit
implementation risk and conformance target rather than being hidden inside an
adapter.
