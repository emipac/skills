# TB-018 — Package the authoritative Git hook runner

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 18-package-the-authoritative-git-hook-runner
Draft key: TB-018

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

An activated repository has a real, packaged pre-commit runner that reads the
repository configuration, evaluates the proposed commit, and exits non-zero when
authorization is denied — so activation produces enforcement rather than a hook
that cannot evaluate.

## SRS Traceability

- `FR-EVAL-001`, `NFR-REL-003`
- `AC-EVAL-001`
- `SG-EVAL-001`, `SG-TRUST-001`
- `RISK-001`

## Defect this contract fixes

Found while attempting a real activation. `registerOwnedHook` writes a shim that
executes `runtime.hookProgram`, and that program is supplied by the caller
rather than shipped. Every top-level script in the Gate skill is release
evidence — smoke, conformance, and portability capabilities — and each supplies
its own fixture runner. No packaged entry point exists for a real clone to use.

A real activation attempt therefore pointed its hook program at
`scripts/lib/evaluate.mjs`, which is the closest thing available. That file is a
pure library with no main:

```bash
node skills/change-evaluation-gate/scripts/lib/evaluate.mjs
# no output, exit code 0
```

A pre-commit hook that exits `0` allows the commit. The shim would have been a
**silent no-op that passes every commit** while the maintainer believed the
repository was enforced.

That is the sharpest possible violation of the feature's own rule that absence
of evidence is never success. A hook that cannot evaluate must deny, not pass.

`FR-EVAL-001` requires an activated repository to invoke the authoritative gate
for every local commit through the managed Git pre-commit integration. Today it
cannot, because there is nothing to invoke.

## Domain Concepts

Managed hook registration, Evaluation snapshot, Enforcement role, Gate
configuration section, and Activation receipt.

## Approach and Tradeoffs

Ship one executable runner in the Gate skill that a registered hook can point
at. It reads the clone's configuration and receipt, builds the versioned
evaluation request for the `commit-attempt` trigger, invokes the existing
`evaluate` seam, prints the decision, and exits `0` only on `allow`.

The runner reads configuration through a supported reader rather than parsing
YAML itself. The activation attempt that surfaced this defect had to hand-roll a
regular-expression parser, including a quote substitution that would corrupt any
value containing an apostrophe. A consumer needing the configuration should not
have to reconstruct it.

Prefer failing closed everywhere: unreadable configuration, missing receipt,
unresolvable runner, or an internal error exits non-zero with a stated reason,
because a runner that cannot prove a decision has not produced one.

## Architecture Boundary and Public Seam

The boundary is the packaged runtime entry point between Git and the existing
evaluation seam; the runner adds no policy of its own. The public seam is the
runner's exit status and printed decision. First red test: a registered hook in
a throwaway clone denies a commit that violates a required check, and the same
runner exits non-zero rather than silently succeeding when its configuration
cannot be read.

## Safeguards and Invariants

- `SG-EVAL-001`: the runner evaluates the proposed snapshot and never authorizes
  from the mutable live worktree.
- `NFR-REL-003`: every harness failure — unreadable configuration, absent
  receipt, unresolved runner, crash, malformed output — normalizes to
  `unverified` and denies rather than passing.
- `SG-TRUST-001`: the runner claims no protection beyond a cooperative local
  process and does not present itself as tamper-proof.

## Prohibited Behavior and Non-goals

Do not implement policy in the runner, duplicate the Evidence ladder, or
reimplement any part of `evaluate`. Do not exit `0` on any path that did not
produce an `allow` authorization. Do not add desktop adapter invocation, the
`gate` lifecycle command surface, or activation changes beyond pointing at the
packaged runner. Do not parse `.agent-framework.yaml` with ad-hoc regular
expressions.

## Risk and Decision Impacts

- `RISK-001`: unchanged in scope, but this defect made it concrete in the worst
  direction. The accepted residual risk is that a machine owner may bypass local
  enforcement deliberately; it was never that enforcement would silently not
  exist. A hook that always passes is indistinguishable from no gate at all.

## Acceptance Criteria

- [ ] `AC-EVAL-001`: in an activated throwaway clone, a commit whose required
  check fails is refused by the registered hook with a non-zero exit and a
  stated reason, and a commit whose required checks pass is accepted.
- [ ] `AC-EVAL-001`: the runner exits non-zero when it cannot read the
  configuration, cannot find the receipt, cannot resolve a runner, or fails
  internally; no failure path exits `0`.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-EVAL-001`, `NFR-REL-003`: runner exit-status and failure-path fixtures, including the no-op regression that a library entry point cannot satisfy the hook contract | `npm run test:unit` | Yes — configured unit suite owns the evaluation seam |
| smoke | both | `AC-EVAL-001`, `SG-EVAL-001`: a real blocked and allowed commit driven through the packaged runner in a throwaway clone | `gate-activation-smoke` capability extended by this slice | Yes — the existing activation selector already drives real commits and must exercise the packaged runner rather than a fixture |

Frontend build and browser evidence are inapplicable; this is a local process
entry point, not repository frontend code.

## The runner must answer the activation self-test

`TB-020` closed the hole that let a non-enforcing program be registered:
activation now executes the hook program against a known-failing subject and
refuses it unless it exits non-zero. **A runner that does not answer that
protocol will be refused at activation**, so this is a hard requirement rather
than a nicety.

The protocol is documented in
`skills/change-evaluation-gate/references/activation-transaction-contract.md`:

- the absolute path of a `subject.json` arrives in the environment variable
  `CHANGE_EVALUATION_GATE_SELF_TEST`, and the program starts with the subject
  directory as its working directory;
- a program that finds that variable set is being proved, not run against
  somebody's work. It evaluates the named subject instead of its working tree;
- the subject pins `subjectVersion`, a per-run `selfTestId`, `expect: "denied"`,
  and the failing required check that makes it deniable;
- exiting non-zero proves denial; exiting `0` is
  `hook-program-allowed-denied-change` and activation refuses.

Deny that subject **deliberately**. `TB-020` treats any non-zero exit as proof
of denial, so a runner that merely crashes would also pass — fail-closed, but
for the wrong reason, and it would then block every real commit too.

## Blocked By

None. `TB-004` delivered the evaluation seam and `TB-010` delivered hook
registration; both are done. `TB-020` is also done and defines the self-test
protocol above, which this runner must satisfy.

## Unresolved Assumptions

1. **Whether the runner is a bare script or the first subcommand of a `gate`
   CLI.** A packaged entry point is required either way, and the lifecycle
   operations remain agent-driven for now. Choosing the CLI shape would make
   this the natural home for later `gate status` and `gate activate` commands.
   Not start-blocking; decide during implementation and record the choice.

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

## Why release qualification missed this

`TB-015` qualified the release with every adapter surface `experimental` and one
environment claimed, and `gate-activation-smoke` drives real blocked and allowed
commits. Both passed because the smoke fixture supplies its own hook program.
The packaged path was never exercised, because there was none to exercise. The
extended smoke row above closes that gap deliberately.
