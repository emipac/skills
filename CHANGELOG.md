# ai-skills-framework

## 0.11.3

### Patch Changes

- [#36](https://github.com/emipac/skills/pull/36) [`4f68923`](https://github.com/emipac/skills/commit/4f689232bb20c4b80314798b30bb07603456ed68) Thanks [@emipac](https://github.com/emipac)! - Stop reporting a check that could not run as a verdict about the code. Both
  production runners passed `resolvePrerequisite: () => true`, so every
  requirement a check declared was asserted proved without anything being
  established — and a real run reported three environment faults as
  `failed` / `grader-negative`, the outcome that means the graded code did not
  satisfy the check. The maintainer's agent read them as defects and began
  degrading a working project to satisfy them.

  Both runners now bind a real resolver, and the `prerequisite-missing` path that
  already existed and already failed closed does the rest: an unproved
  requirement makes the check `unverified` before its command is started, and the
  decision, the `git commit` output, and the desktop preflight channel all name
  what was not proved instead of leaving it to be inferred from a tool's error
  text. An `executable` is proved on the search path the checks themselves run
  with; a `configuration` path against the tree the evaluation materialized and
  the dependency roots it provided; an `environment` name against the facts the
  evaluation can state about itself or the variables the check will actually be
  given; a `service` is never proved, because nothing here probes one. Nothing is
  inferred from an exit code or an error string, and Gate core learns no tool
  name, flag, or stack: the clone declares what its check needs, beside the
  command, in its own configuration — which the configuration reader previously
  dropped on the floor.

  Authorization is unchanged. A required check that is `unverified` denies
  exactly as it denied before; only the reason a maintainer is given changes. A
  check that declares no prerequisites behaves exactly as it did.

## 0.11.2

### Patch Changes

- [#33](https://github.com/emipac/skills/pull/33) [`5b2625c`](https://github.com/emipac/skills/commit/5b2625c4a612ea070f2437998a59d1bca8ced792) Thanks [@emipac](https://github.com/emipac)! - Judge a preflight decision by the same contract the authoritative runner judges
  by. The wrapper around `validateDecision` is now shared by both runners, so
  neither carries its own definition of a complete decision, and a decision the
  contract rejects is presented as `unverified` through the declared feedback
  channel — naming that it could not be read and how many contract findings there
  were, rather than reproducing them in a message an agent is prompted with.
  Preflight remains not-authoritative and non-blocking, and still always exits 0.

- [#33](https://github.com/emipac/skills/pull/33) [`8f14c95`](https://github.com/emipac/skills/commit/8f14c95962f9a58a47b28a3de406023a65b9c076) Thanks [@emipac](https://github.com/emipac)! - Reconcile the pinned Gate control surface where the Change Evaluation Gate
  authorizes: both the authoritative pre-commit runner and the packaged desktop
  preflight runner now observe this machine through one shared observer and pass
  it to every evaluation, so an activated clone whose policy, command arguments,
  adapters, registered hook, receipt, or descriptors changed after activation is
  `unverified` with `integrity-drift` and denied instead of being graded by the
  edit. The Activation receipt additionally pins the exact previewed invocation
  for each resolved runner, because the executable alone never said what it would
  be asked to do. Drift is reported and never repaired, a preflight surface stays
  non-blocking, and a commit that edits a declared Grader surface remains
  visibility rather than drift.

- [#33](https://github.com/emipac/skills/pull/33) [`bcf90d6`](https://github.com/emipac/skills/commit/bcf90d6fcc4ede8e531f15027bdac0a2871bb699) Thanks [@emipac](https://github.com/emipac)! - Fail closed in the authoritative Git hook on any decision the runner cannot
  verify. Completeness is now judged by `validateDecision`, the evaluation
  contract's own rule, so a decision missing its checks, evidence, evaluation
  identity, or snapshot denies with the contract findings stated rather than
  exiting `0`. An `allow` is authorized only by evidence that was positively
  persisted and carries its reference, so absent, `false`, and malformed evidence
  take one path. `validateDecision` is total: every malformed input returns
  findings and none of them throws. At attempt level, a check whose program could
  not be launched is `unverified` with a new `launch-failed` reason reported by
  bounded execution, never `failed` / `grader-negative`, and a tool that really
  runs is still classified by its own exit status.

- [#33](https://github.com/emipac/skills/pull/33) [`e0f0983`](https://github.com/emipac/skills/commit/e0f09835ad1606b5316b7089fe37a0027977fd16) Thanks [@emipac](https://github.com/emipac)! - Grade the whole worktree change in a Change Evaluation Gate preflight,
  including the files that are new. A `worktree` snapshot was materialized from
  `git ls-files`, which lists index entries: a file the agent had just created was
  in no execution root the gate ever built and no check read it, while an ordinary
  deletion left an index entry pointing at a file that was gone, failed the
  capture, and made the whole preflight `unverified` before a single check ran. A
  rename was both at once.

  The worktree content set is now the tracked paths, plus the
  untracked-and-not-ignored ones, minus the ones the worktree no longer holds,
  derived from the `git status --porcelain` parse that was already there. A
  created file is graded and reported as a changed path so applicability rules can
  match it; a deletion is materialized by absence and is no longer an error; both
  sides of a rename are reported, while a copy names only its destination. Ignored
  content still never enters a snapshot, and a declared dependency root remains the
  one way git-ignored content reaches an execution root and stays outside the
  identity. A path Git still reports that cannot be read is `snapshot-mismatch` as
  before.

  The `git-index` path is untouched: a commit is graded on the same tree, under the
  same snapshot identity, as it was before, proved by a fixture pinned to the
  identity the previous implementation produced.

  File modes, symlink targets, and submodules are stated as known limitations in
  the evaluation process contract: a snapshot carries file content only, so a
  change consisting solely of one of those is not something this gate can grade.

- [#33](https://github.com/emipac/skills/pull/33) [`b527fa4`](https://github.com/emipac/skills/commit/b527fa41272cb578307fd67a34b64709912d72d0) Thanks [@emipac](https://github.com/emipac)! - Address a stored Evidence envelope by what was evaluated, and let it state that
  it was stored. The store addressed envelopes by hashing the whole decision,
  which embeds the per-run `mkdtemp` execution root — so the exclusion
  `buildDecision` already applied to `decision.evidence.id` was undone one layer
  down, and five byte-identical evaluations in recorded real-world evidence
  produced five envelopes differing only in run-local values. Every stored
  envelope also recorded `"evidence": { "persisted": false, "reference": null }`,
  because the store fills those fields on the copy it returns, after the bytes
  are written.

  Values that describe one run on one machine are now replaced by the stated
  constant `<run-local>` before anything is hashed or written: the execution root
  wherever it appears — including inside a check's captured output and its inline
  excerpt — each attempt's wall-clock duration, and the store root and append
  instant inside the envelope's own reference. Two evaluations of identical
  content therefore append one envelope and two log entries. The elided values are
  recorded on the per-append log entry under `execution`, which is not
  content-addressed, and the decision a runner reports is unchanged, so
  diagnostics and stderr still name the real path and the real durations.

  A stored envelope now states `persisted: true` and names its own evidence
  identity. That self-reference is hashed with the placeholder
  `<evidence-identity>` and substituted afterwards, the same technique
  `HOOK_RECEIPT_PLACEHOLDER` already uses for the Activation receipt;
  `envelopeIdentity` recomputes an envelope's identity from its own bytes.

  `storeVersion` is now `change-evaluation-gate/evidence/v2`. The store layout is
  unchanged and envelopes written before this change stay readable, prunable, and
  auditable exactly as written; nothing is rewritten or removed.

## 0.11.1

### Patch Changes

- [#31](https://github.com/emipac/skills/pull/31) [`9b76e41`](https://github.com/emipac/skills/commit/9b76e41684fa8b40cf66e86a77f6bc976f8632bf) Thanks [@emipac](https://github.com/emipac)! - Provide the installed dependencies a project's checks need inside the
  materialized Evaluation snapshot. The snapshot is built from `git ls-files`, so
  git-ignored `vendor/` and `node_modules/` were absent from every execution root
  the gate ever built and a tool started inside it could not find the autoloader
  or module tree it needs to read any code at all.

  A project now declares those directories in
  `evaluation_gate.execution.dependency_roots`, and `--draft-policy` derives them
  from two proved facts: some configured check runs through a runner that reaches
  into that directory, and the manifest governing it exists. Declared roots are
  linked beside the snapshot and graded by nothing — they stay outside the
  snapshot identity, outside `changedPaths`, and outside the immutability
  re-check, so a tool writing into its own cache never produces
  `snapshot-mismatch`. A root that is absolute or that would climb out of the
  repository is refused, and a declared root the clone has not installed is
  `dependency-root-unavailable` and denies rather than becoming a fatal error
  from inside somebody's tool. Nothing is ever installed by the gate.

  A clone configured before this change declares no dependency roots and behaves
  exactly as it did; re-drafting the policy adds them.

## 0.11.0

### Minor Changes

- [#28](https://github.com/emipac/skills/pull/28) [`964918e`](https://github.com/emipac/skills/commit/964918e594e1be76f2d2365800e146cd35ca253c) Thanks [@emipac](https://github.com/emipac)! - Ship the packaged Change Evaluation Gate preflight runner a desktop client hook
  can register: it reads the native payload on stdin, evaluates the working tree
  as `not-authoritative` preflight, answers through the adapter's declared
  feedback channel, and exits `0` regardless of outcome — a failing required
  check names the check on that channel, a passing turn writes nothing, and
  unreadable payloads, unmatched events, missing roots, and internal failures
  present as `unverified` rather than as silence or a clean pass.

### Patch Changes

- [#30](https://github.com/emipac/skills/pull/30) [`9569362`](https://github.com/emipac/skills/commit/9569362bf07cff7c39e64803f3e7604326adfb30) Thanks [@emipac](https://github.com/emipac)! - Stop the desktop preflight runner from answering a turn the operator
  interrupted. A client `stop` event fires whether the turn finished or was
  stopped, and the runner read neither the status nor the iteration counter, so
  an aborted turn produced a follow-up message the client submitted as the next
  user message — restarting the work that had just been stopped, and looping
  until the hook was disabled.

  Adapters now declare the field carrying the turn status, the values that mean
  completed and interrupted, the field carrying the client's iteration counter,
  and the maximum number of times one unchanged preflight result may be returned.
  An interrupted turn is answered with nothing at all, an undeclared status is
  `unverified` rather than assumed complete, and repetition is bounded by the
  gate's own append-only record so a client counter that never advances cannot
  produce an unbounded loop. Every deliberate silence — including a hook
  registered without `--adapter`, which previously looked exactly like a clean
  turn — writes its reason to stderr, where the client surfaces it to the
  maintainer.

- [#28](https://github.com/emipac/skills/pull/28) [`964918e`](https://github.com/emipac/skills/commit/964918e594e1be76f2d2365800e146cd35ca253c) Thanks [@emipac](https://github.com/emipac)! - Bind the authoritative Git hook to the clone-local Evidence store its
  Activation receipt already identifies, so every commit-time evaluation now
  appends its Evidence envelope and Lifecycle event instead of persisting
  nothing. Check output is captured and bounded into the envelope, declared
  runtime input values are redacted from it, and the clone's own configured
  Evidence ceilings apply. A store that cannot be opened or written to denies
  the commit with a distinct stated reason rather than ever authorizing a
  commit whose evidence could not be recorded.

- [#30](https://github.com/emipac/skills/pull/30) [`9569362`](https://github.com/emipac/skills/commit/9569362bf07cff7c39e64803f3e7604326adfb30) Thanks [@emipac](https://github.com/emipac)! - Give every check the environment its own pinned program needs in order to
  start. Checks ran with only the environment names their descriptor declared,
  built from nothing, and migration defaults that declaration to empty — so a
  check ran with no PATH at all and any executable that is a script exited `127`
  before reading a line of the code it was asked to grade. Most real tool
  binaries are scripts: `vendor/bin/pint` and `vendor/bin/phpstan` begin
  `#!/usr/bin/env php`, `npm` begins `#!/usr/bin/env node`.

  Resolution now reads the first line of a resolved executable and pins the
  interpreter it names beside it, so an interpreter that cannot be found leaves
  the runner `runner-unresolved` and refuses activation instead of failing as a
  mystery check at commit time. Execution supplies a runtime-owned search path
  built from the pinned executables, their interpreters, and the platform's own
  utility directories — never the invoking shell, so no version manager or
  package-manager prefix can change which program a pinned command reaches. A
  descriptor declaring `PATH` has its ambient value appended after those entries.

  The Activation receipt now pins each runner's interpreter. A clone activated
  before this change still runs, but a shebang binary whose interpreter lives
  outside the pinned directories needs `gate repair` to be re-pinned.

## 0.10.1

### Patch Changes

- [#25](https://github.com/emipac/skills/pull/25) [`b69e91b`](https://github.com/emipac/skills/commit/b69e91b2e30165486bf08afb117173db71926685) Thanks [@emipac](https://github.com/emipac)! - Resolve every logical runner through one exported rule, and run the executables
  the Activation receipt pinned. A `composer-bin` check now resolves to the
  absolute vendor binary its descriptor names, under the descriptor's own working
  directory, instead of the `composer` front end on `PATH` — which ran with the
  descriptor's arguments discarded and could report a passed check for a program
  the policy never named. A binary name carrying a path separator is refused
  rather than joined, and a missing vendor binary is `runner-unresolved`.

  The Git hook no longer re-resolves runners: it runs what the receipt pinned, and
  a pin whose executable is absent, or that no longer matches its runner, denies
  with a drift reason pointing at `gate repair` rather than substituting another
  program. Activation now ships a default resolver, so an integrator injecting its
  own `resolveExecutable` can drop it.

## 0.10.0

### Minor Changes

- [#21](https://github.com/emipac/skills/pull/21) [`2aeced6`](https://github.com/emipac/skills/commit/2aeced6987b4bd14ecd5ab62f33493ff6e1212c2) Thanks [@emipac](https://github.com/emipac)! - Ship the packaged Change Evaluation Gate pre-commit runner an activated
  repository actually invokes: it reads the clone's configuration through a
  supported `.agent-framework.yaml` reader and its Activation receipt, builds the
  versioned `commit-attempt` request, calls the existing `evaluate` seam without
  adding policy of its own, prints the decision, denies the activation self-test
  subject deliberately, and exits `0` only on an `allow` authorization — an
  unreadable configuration, an absent receipt, an unresolved runner, a malformed
  decision, or an internal failure all deny with a stated reason.

### Patch Changes

- [#21](https://github.com/emipac/skills/pull/21) [`7eaf25b`](https://github.com/emipac/skills/commit/7eaf25bc9bc5b67fdc0102d934273f87ea80e363) Thanks [@emipac](https://github.com/emipac)! - Bind each logical runner's stored arguments to its resolved executable through
  one composition rule owned by the runner, so a previewed invocation is
  byte-identical to the one execution runs. A `composer-bin` descriptor no longer
  repeats its binary name and a `package-script` descriptor reaches its script
  through `run`. Stored schema v4 descriptors are unchanged and a descriptor its
  runner cannot compose is reported rather than silently adjusted.

- [#21](https://github.com/emipac/skills/pull/21) [`ed87d8f`](https://github.com/emipac/skills/commit/ed87d8f2afdc495490ee754c35ca3542084185ba) Thanks [@emipac](https://github.com/emipac)! - Make Activation execute the hook program it is about to register against a
  change that must be denied, and refuse it unless it denies, so a program that
  enforces nothing can no longer pass its own self-test and be installed.

## 0.9.0

### Minor Changes

- [#19](https://github.com/emipac/skills/pull/19) [`eb01d11`](https://github.com/emipac/skills/commit/eb01d1150b9a20dd4dbdd8e2989f6d1887b97b53) Thanks [@emipac](https://github.com/emipac)! - Activate authoritative local Git enforcement as a previewed, consented,
  clone-local transaction that enables Git last, pins an Activation receipt, and
  rolls back every gate-owned change on any failure without overwriting an
  existing hook or touching a shared hooks path.

- [#19](https://github.com/emipac/skills/pull/19) [`07574ef`](https://github.com/emipac/skills/commit/07574ef1e2dc13047459200b70fc6ac884063eaf) Thanks [@emipac](https://github.com/emipac)! - Align feature, delivery, implementation, and verification handoffs with
  parent-wide acceptance, safeguard, risk, decision, seam, and evidence gates.

- [#19](https://github.com/emipac/skills/pull/19) [`07574ef`](https://github.com/emipac/skills/commit/07574ef1e2dc13047459200b70fc6ac884063eaf) Thanks [@emipac](https://github.com/emipac)! - Persist and prune bounded immutable Change Evaluation Gate Evidence: every
  evaluation appends one canonical, content-addressed, redacted envelope atomically
  to a clone-local store under the resolved Git common directory, enforcing the
  fixed v1 ceilings of 32 KiB inline per Check attempt, 4 MiB per output blob, and
  32 MiB of blobs per evaluation, which a project may lower but never raise.
  Truncation preserves the beginning and the end of the output and reports its
  redacted and omitted byte counts. Sensitive values are redacted before anything
  is written and a capture that cannot be proved safe persists nothing and returns
  `unverified`. Nothing is ever deleted automatically: pruning is manual,
  preview-first, and blob-only, a mismatched confirmation removes nothing and
  records no successful deletion, and a matching one preserves envelopes,
  decisions, bypass records, Lifecycle events, pruning records, and a tombstone for
  every removed blob. Adds the immutable Lifecycle event record for all eleven
  governed actions, a durable one-shot bypass ledger, opt-in bounded output capture
  in the executor, and the `gate-evidence-prune-smoke` capability.

- [#19](https://github.com/emipac/skills/pull/19) [`07574ef`](https://github.com/emipac/skills/commit/07574ef1e2dc13047459200b70fc6ac884063eaf) Thanks [@emipac](https://github.com/emipac)! - Add the independently installable Change Evaluation Gate module and explicit
  schema v4 dormant policy configuration without activating enforcement.

- [#19](https://github.com/emipac/skills/pull/19) [`371609b`](https://github.com/emipac/skills/commit/371609b6f93abe64d7c248b3b3069ba5311e79e7) Thanks [@emipac](https://github.com/emipac)! - Coordinate concurrent Change Evaluation Gate evaluations safely. Execution now
  serializes per resolved, canonical Git common directory, so every client and
  every linked worktree of one clone answers to exactly one lock while unrelated
  repositories never block each other. The lock records the holding process, host,
  start instant, and heartbeat. Only an exactly matching in-flight evaluation
  binding — snapshot, configuration, plan, environment, and task identities — may
  share one execution, there is still no persistent pass cache, and each subscriber
  of a shared execution receives the authorization of its own Enforcement role, so
  sharing never changes who may enforce. Different evaluations queue, an
  authoritative `commit-attempt` advances ahead of queued-but-not-running
  preflights without ever preempting a running one, and a client refused the lock
  waits a bounded turn instead of running unserialized. Cancellation is
  subscriber-local and never cancels work another subscriber still requires.
  Stale-lock recovery is explicit, confirmation-matched, and audited through a
  `stale-lock-recovery` Lifecycle event, preserving the recovered record rather
  than deleting it; acquisition never clears a stale lock. Coordination that cannot
  be trusted fills in the existing `coordination-failure` reason code in place and
  returns `unverified` — never an authorization.

- [#19](https://github.com/emipac/skills/pull/19) [`a25bf37`](https://github.com/emipac/skills/commit/a25bf379a6f72770f41a6e280088df76604fa790) Thanks [@emipac](https://github.com/emipac)! - Correct the Change Evaluation Gate desktop preflight adapter declarations
  against real captured client payloads: each surface declares the field names,
  event value, and field shape its client actually sends, a repository root is
  resolved upward from the path a client sends rather than assumed and is
  `unverified` when none resolves, Cursor's array of workspace roots has an
  explicit rule that reports `unverified` for a multi-root workspace instead of
  selecting one, no desktop surface declares a `commit-attempt` event any longer
  while Cursor records its unobserved one as unverified rather than claimed, and a
  compatibility baseline records whether real client invocations or injected
  payloads drove it so no surface can be called supported on fixture evidence
  alone.

- [#16](https://github.com/emipac/skills/pull/16) [`f22b30d`](https://github.com/emipac/skills/commit/f22b30de21c2a528c4866a846d861fa8a935a4cd) Thanks [@emipac](https://github.com/emipac)! - Add a curated upstream intake skill that automatically ports only structurally
  compatible Matt Pocock skill changes and records every review disposition.

- [#19](https://github.com/emipac/skills/pull/19) [`d87d8fa`](https://github.com/emipac/skills/commit/d87d8fa171374723e95ac72df5050860c0ed118c) Thanks [@emipac](https://github.com/emipac)! - Deliver supported Change Evaluation Gate desktop preflight adapters: one
  decision blocks authoritative Git on `deny` while Claude Code Desktop, Codex
  Desktop, and Cursor present the same decision as structured `not-authoritative`
  preflight feedback, each adapter declares its own event, blocking, trust,
  repository, session, filesystem, Git, and invocation capabilities, every trust,
  invocation, timeout, capability, and malformed-output failure is `unverified`,
  and a surface is called supported only after the shared compatibility baseline
  passes against it with its exact tested versions recorded.

- [#19](https://github.com/emipac/skills/pull/19) [`07574ef`](https://github.com/emipac/skills/commit/07574ef1e2dc13047459200b70fc6ac884063eaf) Thanks [@emipac](https://github.com/emipac)! - Add the versioned Change Evaluation Gate `evaluate` process contract, isolated
  Git snapshot materialization, and ordered check delegation through the existing
  `verify-change` Verification seam.

- [#19](https://github.com/emipac/skills/pull/19) [`247247d`](https://github.com/emipac/skills/commit/247247d304bee5519479e5a21de792fa0c0161b5) Thanks [@emipac](https://github.com/emipac)! - Add previewed schema v4 verification migration with explicit backend and
  frontend profile presence while retaining schema v3 compatibility.

- [#19](https://github.com/emipac/skills/pull/19) [`07574ef`](https://github.com/emipac/skills/commit/07574ef1e2dc13047459200b70fc6ac884063eaf) Thanks [@emipac](https://github.com/emipac)! - Separate check-only Change Evaluation Gate evaluation from explicit mutation:
  commit evaluation rejects any check that offers a declared fix command as its
  evaluation command, the new explicit fix operation applies declared mutations in
  their provider-declared order through a separate mutating seam, and only a
  complete non-mutating evaluation of the resulting new snapshot can authorize the
  result. Laravel proposes proved style, rewrite-check, static-analysis, and
  broad-test checks as required while focused, affected-test, smoke, build, and
  browser checks are earned through explicit confirmation, and declares a
  structural rewrite before formatting without gate core learning either tool.

- [#19](https://github.com/emipac/skills/pull/19) [`07574ef`](https://github.com/emipac/skills/commit/07574ef1e2dc13047459200b70fc6ac884063eaf) Thanks [@emipac](https://github.com/emipac)! - Apply Change Evaluation Gate policy over the completed decision: repository-owned
  required and advisory severity, snapshot-bound authorization with no baseline
  exemption or pass cache, per-check and total budgets that terminate process
  trees and skip only eligible advisory work, and an optional one-shot audited
  bypass that returns `bypassed` without ever rewriting a failure into a pass.

- [#17](https://github.com/emipac/skills/pull/17) [`1b3014e`](https://github.com/emipac/skills/commit/1b3014e18e5bb0716dd39b4d247e6296c9a52b34) Thanks [@emipac](https://github.com/emipac)! - Add a Laravel development setup skill for a deterministic Pest 5, Pint, PAO,
  Larastan, Rector, Ray, browser-testing, and Laravel Boost toolchain.

- [#19](https://github.com/emipac/skills/pull/19) [`e0bbe45`](https://github.com/emipac/skills/commit/e0bbe45e03a161e095daccbf4f9016cfe4258924) Thanks [@emipac](https://github.com/emipac)! - Manage the Gate's active release and removal lifecycle: ordinary distribution
  exposes a candidate only, `gate update` switches the Active gate release
  atomically and preserves the prior release on any failure, `gate status`
  reconciles health without repairing or writing anything, and deactivation,
  uninstall, and configuration cleanup remove only unchanged Gate-owned state
  while preserving shared configuration, global assets, and historical Evidence.
  Pins a durable, receipt-independent content identity for the gate-written hook
  block so tampering is detectable from a published receipt alone, and adds the
  operator-facing `gate prune` and coordination-lock inspection commands.

- [#19](https://github.com/emipac/skills/pull/19) [`cfe36c3`](https://github.com/emipac/skills/commit/cfe36c346bdb0697353422a47e2134572e42703d) Thanks [@emipac](https://github.com/emipac)! - Compose Gate activation with an existing hook chain in the declared order —
  native hook manager, confirmed marker-delimited block, then owned shim — so the
  prior chain is preserved and still executes, and bind paused-and-resumed and
  non-interactive activation to exact repository, configuration, selected-adapter,
  and preview identities.

- [#19](https://github.com/emipac/skills/pull/19) [`2ce63ed`](https://github.com/emipac/skills/commit/2ce63ed5c90c7adc4be5f2ca681e0bf15e3be489) Thanks [@emipac](https://github.com/emipac)! - Protect Change Evaluation Gate policy transitions, Sensitive runtime inputs, and
  control-surface drift: a policy-surface change is graded under both the prior
  Trusted configuration and its candidate and advances trust only on a hash-bound
  approval once both pass, approved Sensitive runtime inputs are copied only into
  the isolated materialization and removed with it while retained state keeps name
  and source alone, and independent drift of the pinned Gate control surface makes
  `gate status` broken and an authoritative decision unverified — reported, never
  repaired, and never presented as resistance to the machine owner.

- [#19](https://github.com/emipac/skills/pull/19) [`8a0fac6`](https://github.com/emipac/skills/commit/8a0fac64ceea754f1990aee946cfc9dc522be55d) Thanks [@emipac](https://github.com/emipac)! - Qualify the Change Evaluation Gate release candidate against observed evidence:
  a compatibility manifest records the release version read from `package.json`,
  the one environment its eleven runtime portability fixtures were actually
  executed on, every surface's shared baseline outcomes with the exact versions
  they ran under, and the delivery risks that stayed open — and qualification
  refuses any claim the evidence beside it does not produce. Support tiers are
  re-derived rather than declared, so all four surfaces stay `experimental` until
  a real client invocation drives a baseline; untested environments stay
  `unverified` rather than refused and tested versions never become a standing
  allowlist; and the manifest claims local Git authority only, closes neither
  open delivery risk, and carries the stated trust boundary rather than restating
  it.

- [#19](https://github.com/emipac/skills/pull/19) [`769ce09`](https://github.com/emipac/skills/commit/769ce091b827407952ef7818f083acdac0989b4a) Thanks [@emipac](https://github.com/emipac)! - Declare each desktop adapter's registration surface — its client configuration
  file, that file's block schema, and whether the schema is independently
  versioned — so activation, health reconciliation, and removal act on a desktop
  registration only through that declaration, preserve every part of a client
  configuration file the adapter does not own, and report `unverified` rather than
  assume a surface they cannot confirm.

- [#19](https://github.com/emipac/skills/pull/19) [`07574ef`](https://github.com/emipac/skills/commit/07574ef1e2dc13047459200b70fc6ac884063eaf) Thanks [@emipac](https://github.com/emipac)! - Add the versioned stack-neutral provider check descriptor contract with a
  Laravel provider, a reference non-Laravel provider, shell-free command
  validation, and visible capability gaps.

- [#19](https://github.com/emipac/skills/pull/19) [`07574ef`](https://github.com/emipac/skills/commit/07574ef1e2dc13047459200b70fc6ac884063eaf) Thanks [@emipac](https://github.com/emipac)! - Report honest Change Evaluation Gate task scope, changed Grader surfaces, and
  served-runtime binding: evaluation without a valid delivery contract is
  regression-only, changed tests, verification scripts, providers, and Gate
  configuration are reported with every integrity identity bound, and HTTP or
  browser evidence is unverified unless the serving runtime is proved to serve the
  materialized Evaluation snapshot.

## 0.8.0

### Minor Changes

- [#14](https://github.com/emipac/skills/pull/14) [`168307d`](https://github.com/emipac/skills/commit/168307d5f2b9ecc468a779081f28f657cebb57bd) Thanks [@emipac](https://github.com/emipac)! - Add an OWASP-aware security audit skill with mandatory evaluation isolation,
  narrow trust boundaries, short-lived credentials, and blocked metadata access.
  Integrate it into code review as an independent Security axis.

## 0.7.0

### Minor Changes

- [#12](https://github.com/emipac/skills/pull/12) [`0d75cce`](https://github.com/emipac/skills/commit/0d75ccef747d66299e156628d68431a532e61deb) Thanks [@emipac](https://github.com/emipac)! - Add a customer-facing project estimation skill with AI-assisted phase sizing,
  explicit project-management and manual-testing effort, traceable third-party and
  client-input dependencies, milestones, and roadmaps.

### Patch Changes

- [#11](https://github.com/emipac/skills/pull/11) [`32101b3`](https://github.com/emipac/skills/commit/32101b3ecd151498bc9b533a7eb648fed29fca9f) Thanks [@emipac](https://github.com/emipac)! - Harden Express package-script discovery with safe qualified checks, source-root
  scope inference, explicit exclusions, and `database/` backend discovery.

## 0.6.0

### Minor Changes

- [#8](https://github.com/emipac/skills/pull/8) [`19506d4`](https://github.com/emipac/skills/commit/19506d42a2b6f25062697699e88bbcd83db58fa1) Thanks [@emipac](https://github.com/emipac)! - Add first-class Express with TypeScript backend discovery, schema version 3
  source and command scopes, API-aware verification and review guidance,
  compatibility fixtures, and install coverage for GitHub Copilot and OpenCode
  while preserving Laravel behavior.

## 0.5.0

### Minor Changes

- [#6](https://github.com/emipac/skills/pull/6) [`583206d`](https://github.com/emipac/skills/commit/583206d4ebfcffd9ef9ed14bc163476e265ad7f5) Thanks [@emipac](https://github.com/emipac)! - Add deterministic Laravel and TypeScript verification profiles, the
  `verify-change` evidence ladder, independent Standards/Contract/Evidence code
  review, and selective durable synchronization. Existing schema version 1
  projects must rerun `framework-setup` to generate schema version 2.

## 0.4.0

### Minor Changes

- [#4](https://github.com/emipac/skills/pull/4) [`64109cb`](https://github.com/emipac/skills/commit/64109cb5ae816cbd4b767e27212f0a6f4c5f0c9e) Thanks [@emipac](https://github.com/emipac)! - Add the Phase 4 planning and delivery-contract lifecycle: traceable feature
  contracts with risk and gap analysis, ready tracer-bullet delivery contracts
  with deterministic blocker-graph auditing, and a single implementation
  orchestrator that records red-before-green evidence and requires explicit
  contract-amendment decisions for intent changes.

## 0.3.0

### Minor Changes

- [#2](https://github.com/emipac/skills/pull/2) [`0e42a80`](https://github.com/emipac/skills/commit/0e42a806262d62c010782ffde7394162122e9ae4) Thanks [@emipac](https://github.com/emipac)! - Add the Phase 3 SRS lifecycle: `srs-modeling`, a reusable durable-requirements
  template and contract, stable requirement and acceptance identifiers,
  OpenSPDD-inspired safeguards, deterministic traceability auditing, and creation,
  refinement, and audit evaluations. Integrate SRS maintenance with
  `grill-with-docs`, `wayfinder`, and `framework-router`.

## 0.2.0

### Minor Changes

- [`84019d7`](https://github.com/emipac/skills/commit/84019d754c38478c0334d3b579ffc1302fcf7962) Thanks [@tzsoltt](https://github.com/tzsoltt)! - Add the Phase 2 framework backbone: deterministic `framework-setup`, the
  `.agent-framework.yaml` contract, Laravel and TypeScript frontend discovery,
  idempotent protected-file handling, local/GitHub/Jira/Linear tracker adapters,
  and the renamed `framework-router`. Preserve Matt Pocock's language-agnostic
  vocabulary and tracer-bullet lifecycle while moving project configuration onto
  a portable cross-client seam.

## 0.1.0

### Foundation

- Fork Matt Pocock's composable skill set under the Minic-maintained AI Skills Framework identity.
- Flatten released skills under `skills/` while separating experimental and deprecated work from installable releases.
- Add universal `npx skills`, Claude Code plugin, and Codex plugin distribution metadata.
- Make `package.json` the authoritative version and add deterministic repository and installation validation.
- Record upstream provenance, third-party licensing, lifecycle phases, release cadence, and 1.0 acceptance criteria.

## Upstream history

## 1.1.0

### Minor Changes

- [#406](https://github.com/mattpocock/skills/pull/406) [`930a450`](https://github.com/mattpocock/skills/commit/930a450089f77a49af09001d955db8452a4b867d) Thanks [@mattpocock](https://github.com/mattpocock)! - Bring the **`ask-matt`** router up to date with the full skill set. It now maps five skills it was missing: **`tdd`** (woven into the main flow as the red-green engine `implement` drives), **`diagnosing-bugs`** (a new "Something's broken" on-ramp — there was previously no route for a bug), **`domain-modeling`** and **`codebase-design`** (a new "Vocabulary underneath" section), and **`grilling`** (the shared interview primitive). `prototype` is fleshed out as a standalone and the description broadens from "user-invoked skills" to "the skills". A maintenance rule is added to `CLAUDE.md` so any future skill add/rename/remove or flow change triggers an `ask-matt` re-check, beside the existing docs-page re-sync rule.

- [#464](https://github.com/mattpocock/skills/pull/464) [`639df6e`](https://github.com/mattpocock/skills/commit/639df6e7386dfddc739b2aecdeff37a876f2483b) Thanks [@mattpocock](https://github.com/mattpocock)! - Promote and harden **`code-review`**. The in-progress **`review`** skill is renamed to **`code-review`** and moved from `in-progress/` into `engineering/`: it now ships in the plugin, is listed in the top-level and Engineering READMEs (Model-invoked), and has a docs page at `docs/engineering/code-review.md`. The `/implement` skill and docs point at `/code-review`.

  It also gains an always-on **Fowler smell baseline** on its Standards axis — a curated ~12 high-signal "Bad Smells in Code" (Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest) inlined into `SKILL.md` as a fixed baseline alongside whatever the repo documents, not a new third axis. Two binding rules keep it safe: a documented repo standard overrides the baseline, and every smell is reported as a judgement call, never a hard violation.

- [#464](https://github.com/mattpocock/skills/pull/464) [`639df6e`](https://github.com/mattpocock/skills/commit/639df6e7386dfddc739b2aecdeff37a876f2483b) Thanks [@mattpocock](https://github.com/mattpocock)! - Sharpen **`grilling`** on two fronts.

  **A confirmation gate.** The agent won't enact the plan until you confirm the shared understanding has been reached — turning the skill's existing "shared understanding" completion criterion into an explicit stop-gate. The `description` also recruits the pretrained **`grill`** leading word ("Grill the user relentlessly") to sharpen invocation, and the docs page is re-synced.

  **Facts vs. decisions.** Grilling now splits _facts_ (look them up — explore the codebase) from _decisions_ (put each one to the human and wait for their answer). The old blanket line — "if a question can be answered by exploring the codebase, explore the codebase instead" — was written for the live-human case, but once another skill runs grilling inside a resolve-the-ticket frame it read as license to answer _decisions_ autonomously too. Separating the two keeps a grilling agent from racing ahead and answering its own questions.

- [#463](https://github.com/mattpocock/skills/pull/463) [`af6d692`](https://github.com/mattpocock/skills/commit/af6d6922c3e2b5288eef155346cbe319e4ed3bd0) Thanks [@mattpocock](https://github.com/mattpocock)! - Add two adjacent Steering failure modes to **`writing-great-skills`**, both about how language you think of as "off" still steers the agent. **Negation** — the _elephant_ — is steering by prohibition: naming what _not_ to do drags the forbidden behaviour into context and makes it _more_ available, not less (_don't think of an elephant_), so the cure is to prompt the **positive**. **Negative Space** — the void — is blindness to the steering done by what you leave _out_: every decision a skill declines is delegated to the agent's priors rather than left neutral, so the cure is to read a draft for its silences and decide each omission deliberately (fill it, or leave it open as a real **branch**). Kept as two entries, not one — they carry different diagnostics and different cures — each a full `GLOSSARY.md` entry plus a `SKILL.md` failure-mode bullet, matching how every other failure mode is carried.

- [`850873c`](https://github.com/mattpocock/skills/commit/850873cd73d5f81826ebf512ad35d2b1e113001f) Thanks [@mattpocock](https://github.com/mattpocock)! - Make the **`prototype`** skill model-invoked, so the agent can reach for it autonomously (and other skills can too). Its description is rewritten around the leading word _prototype_ — throwaway code that answers a design question — with one trigger per branch (state/logic sanity-check, or UI exploration).

- [#409](https://github.com/mattpocock/skills/pull/409) [`0d74d01`](https://github.com/mattpocock/skills/commit/0d74d01cbc64ca27778a49b38599f70c534e76a0) Thanks [@mattpocock](https://github.com/mattpocock)! - Add the **`research`** skill — a small, model-invoked skill that spins up a **background agent** to investigate a question against **primary sources** (official docs, source code, specs, first-party APIs), then leaves a single cited Markdown file wherever the repo keeps such notes. It's delegable reading legwork: you keep working while it reads, and get back a document to grill, plan, or design against. Listed in the top-level and Engineering READMEs (Model-invoked), added to `.claude-plugin/plugin.json`, given a docs page at `docs/engineering/research.md`, and routed as a Standalone in `ask-matt`.

- [#469](https://github.com/mattpocock/skills/pull/469) [`a0329ba`](https://github.com/mattpocock/skills/commit/a0329ba95751f58566ed7ab484475917a68f1629) Thanks [@mattpocock](https://github.com/mattpocock)! - Split the **`to-issues`** skill into a lean **Process** and a **Reference** section, and teach it to handle a **wide refactor** — a single mechanical change (like renaming a column) whose **blast radius** fans across the whole codebase, breaking thousands of call sites at once so no vertical slice can land green. The drafting step now points at two co-located reference blocks: the **Vertical slice rules** for ordinary tracer bullets, and **Wide refactors**, which slices the change by **expand–contract** (expand the new form beside the old, migrate call sites in batches sized by blast radius, then contract the old form away) so CI stays green batch to batch — or, when it can't, only at a final integrate-and-verify issue. The issue body template moves into Reference too.

- [#464](https://github.com/mattpocock/skills/pull/464) [`386d4ff`](https://github.com/mattpocock/skills/commit/386d4ff719a7c420ad1454232d0436b01f1b8c17) Thanks [@mattpocock](https://github.com/mattpocock)! - Unify the planning skills. **`to-prd` is renamed to `to-spec`** — "spec" is now the single through-line term (it still opens with "you may know this document as a PRD" for discoverability). **`to-plan` and `to-issues` are merged into one `to-tickets` skill, and `to-issues` is deleted.**

  `to-tickets` breaks a plan, spec, or conversation into a set of **tickets** — tracer-bullet vertical slices, each declaring its **blocking edges**. That one artifact reads two ways depending on the tracker `/setup-matt-pocock-skills` configured: a **local file** (`tickets.md`) writes the edges as text and you work it top-to-bottom by hand; a **real tracker** writes them as native blocking links, so any ticket whose blockers are done is on the frontier and several agents can run at once. The edges live in the ticket either way — the medium only decides whether anything acts on them in parallel.

  Publishing prefers the tracker's **native sub-issues** for parent → slice and **native blocking edges** for `Blocked by` where the tracker supports them, keeping the `## Parent` / `## Blocked by` body sections as the fallback. The "What to build" template points at where a `/prototype`'s code lives rather than inlining a snippet from it.

  `ask-matt`'s main flow now routes `idea → /to-spec → /to-tickets → /implement`, and there are human-facing docs pages at `docs/engineering/to-spec.md` and `docs/engineering/to-tickets.md`.

- [#464](https://github.com/mattpocock/skills/pull/464) [`0557d57`](https://github.com/mattpocock/skills/commit/0557d57579d9b3d39839fdaf8d4a6542b17539ce) Thanks [@mattpocock](https://github.com/mattpocock)! - Settle wayfinder's place in the docs as a **situational on-ramp**, not the new main entry flow — the grill-led _idea → ship_ chain stays the front door (crowning wayfinder as the default spine is a v2-sized move, not a 1.1). The **`ask-matt`** router now names wayfinder's concrete triggers — a greenfield project or a huge feature build, too big for one session — and the two grill front doors (**`grill-me`**, **`grill-with-docs`**) signpost _up_ to wayfinder for the effort that's too big to hold in one session, so the on-ramp is discoverable from where a reader actually starts.

- [#464](https://github.com/mattpocock/skills/pull/464) [`639df6e`](https://github.com/mattpocock/skills/commit/639df6e7386dfddc739b2aecdeff37a876f2483b) Thanks [@mattpocock](https://github.com/mattpocock)! - Graduate and reframe **`wayfinder`** — the skill for planning a huge chunk of work, more than one agent session can hold. It moves out of `in-progress/` into `engineering/` (plugin entry, top-level + Engineering READMEs under **User-invoked**, a docs page at `docs/engineering/wayfinder.md`, and a route in `ask-matt`), landing as a mature skill. The rename and reframe that got it there:

  - **`decision-mapping` is renamed to `wayfinder`**, invoked as `/wayfinder`. "Decision map" was jargony and inaccurate — only one ticket type is actually a decision. The reframe charts a route through a foggy problem instead, giving one coherent leading-word frame — **fog of war**, **frontier**, **the map** — rather than an invented term layered on top.
  - **Destination as the leading word.** Wayfinding finds the _way_ to a destination; it doesn't charge at building it. Naming the destination is the first act of charting — it fixes the scope and shapes every ticket — so the map gains a `## Destination` field every session orients to, and triage pins it before any ticket exists.
  - **Plan, don't do.** The map produces **decisions, not deliverables**; it's done when nothing is left to decide before someone builds the thing. An effort can override this in its Notes.
  - **The map is an index, not a store.** A decision lives in exactly one place — its ticket — so the map only gists and links, never restates; graduating fog into a ticket clears the graduated patch so nothing lingers in two places.
  - **Collaborative by default.** The map moves off a local Markdown file onto the repo's issue tracker: a single `wayfinder:map` issue whose tickets are its child issues — one shared URL the team can watch. Sessions load the map at low resolution and zoom into tickets on demand. Wayfinder stays tracker-agnostic (GitHub, GitLab, local-markdown) behind a pointer in `docs/agents/issue-tracker.md`, and `setup-matt-pocock-skills` seeds the "Wayfinding operations" section.
  - **Claim by assignment, not a label.** A session claims a ticket by assigning it to the driving dev — the assignee _is_ the claim — freeing the label vocabulary to `wayfinder:<type>` alone.
  - **Native blocking.** Blocking prefers the tracker's native dependency relationship, which renders the frontier visually in the tracker's own UI so the human sees what's takeable without opening the map. GitHub and GitLab templates spell out the native recipe, with a body-convention fallback.
  - **Fog vs. out of scope, split.** Two plainly-named map sections — `## Not yet specified` (in-scope fog that graduates as the frontier advances) and `## Out of scope` (work ruled beyond the destination, closed, never graduating) — so beyond-destination work no longer reads as takeable frontier.
  - **A fourth `task` ticket type.** For literal manual work that blocks a decision (provisioning access, moving data, signing up for a service) — the one type that _does_ rather than decides, earning its place by unblocking a decision.
  - **HITL / AFK ticket classification.** Every ticket type is **HITL** (human in the loop — grilling, prototype) or **AFK** (agent alone — research; task is either). A HITL ticket only resolves through the live exchange, so "wait for the human" falls out of the label — a grilling agent that answers its own questions has, by definition, broken HITL. (This fixes students' reports of `/wayfinder` grilling _itself_ instead of the human.)
  - **No-fog early exit restored.** If the opening breadth-first grilling surfaces no fog, the journey is small enough for one session — so it stops and asks how you'd like to proceed rather than building a map nobody needs.

### Patch Changes

- [#464](https://github.com/mattpocock/skills/pull/464) [`639df6e`](https://github.com/mattpocock/skills/commit/639df6e7386dfddc739b2aecdeff37a876f2483b) Thanks [@mattpocock](https://github.com/mattpocock)! - Reshape **`tdd`** into a reference-only skill and add a missing anti-pattern.

  **Reference-only.** The red → green → refactor loop is anchored by leading words the model already holds, so the step-by-step Workflow was largely restating the loop. Dropped the Workflow and per-cycle checklist; folded their one durable idea — vertical slices / tracer bullets — into the Anti-patterns section and a short Rules-of-the-loop list. Introduced **seam** as the leading word for where tests go: test only at pre-agreed seams, confirmed with the user before any test is written. Also dropped the refactor stage — TDD is now red → green; refactoring belongs to the review stage, so the refactor rule and `refactoring.md` moved out (its home is `code-review`).

  **Tautological tests.** Added the tautological-test anti-pattern: a test whose assertion is recomputed the way the code computes it passes by construction and gives zero confidence — distinct from the implementation-coupling anti-pattern already covered. Added as a peer at the same sites: a Philosophy principle (expected values must come from an independent source of truth), a checklist gate, and a BAD/GOOD example pair in `tests.md`.

- [`e00eadb`](https://github.com/mattpocock/skills/commit/e00eadb4bb32c3d5a631ead1a5ed5d6a7c5f74e2) Thanks [@mattpocock](https://github.com/mattpocock)! - Extend the **`triage`** skill to triage external pull requests, treating a PR as an issue with attached code that runs through the same roles and state machine. PRs flow inline alongside issues (gated by a per-repo setup toggle), discovery surfaces only external PRs, the bug-only "reproduce" step is generalized into a single "verify the claim" step, and a redundancy check resolves already-implemented requests to `wontfix` without polluting the out-of-scope knowledge base. `setup-matt-pocock-skills` gains the PRs-as-a-request-surface toggle for GitHub/GitLab.

- [#472](https://github.com/mattpocock/skills/pull/472) [`d869d45`](https://github.com/mattpocock/skills/commit/d869d45afc32beab1c2d1350f8de5e81589512cd) Thanks [@mattpocock](https://github.com/mattpocock)! - Fix **`wayfinder`** hardcoding the issue-tracker doc path, which broke the indirection the rest of the suite relies on.

  `to-issues`, `to-prd`, and `triage` never name a path — they resolve the tracker through the `### Issue tracker` block that `setup-matt-pocock-skills` writes into `CLAUDE.md` / `AGENTS.md`, which points at the tracker doc wherever it lives. Wayfinder instead pinned the literal `docs/agents/issue-tracker.md`, so in a repo that keeps its agent docs elsewhere it silently fell back to the local-markdown tracker — even one whose `CLAUDE.md` clearly declares GitHub issues. It now resolves the doc via that same pointer and reads its "Wayfinding operations" section by name, keeping the indirection consistent across the suite.

## 1.0.1

### Patch Changes

- [`d20ee26`](https://github.com/mattpocock/skills/commit/d20ee2684e2a9442698ac3c1e0f2c5b68c4cf296) Thanks [@mattpocock](https://github.com/mattpocock)! - Make the **`teach`** skill reuse-first. Lessons are now built from reusable **components** in `./assets/` — stylesheets, quiz widgets, simulators, diagram helpers. Reuse is the default: the agent reads `./assets/` before authoring a lesson, builds from what's there, and extracts anything new and reusable into a component rather than inlining it.

## 1.0.0

### Major Changes

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) Thanks [@mattpocock](https://github.com/mattpocock)! - Add the **`ask-matt`** skill — a user-invoked router that points you at the right skill or flow for your situation.

  **Breaking:** `ask-matt` routes over the other user-invoked skills in this repo, so it expects them to be installed.

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) Thanks [@mattpocock](https://github.com/mattpocock)! - Add the shared design skills and rewire existing skills onto them.

  - New **`codebase-design`** skill — the deep-module vocabulary (module, interface, depth, seam, adapter) and the principles for putting a lot of behaviour behind a small interface. The language that previously lived in `improve-codebase-architecture/LANGUAGE.md` now lives here, generalized for reuse across skills.
  - New **`domain-modeling`** skill — actively build and sharpen a project's domain model, stress-testing terms against the glossary and keeping `CONTEXT.md` and ADRs current.
  - `improve-codebase-architecture` now draws its architecture vocabulary from `/codebase-design` and its domain model from `/domain-modeling`.
  - `tdd` now leans on `/codebase-design` for interface-design guidance — its inline `deep-modules.md` / `interface-design.md` notes were removed in favour of the shared skill.
  - `grill-with-docs` now builds the domain model inline via `/domain-modeling`.

  **Breaking:** these skills now depend on the new `codebase-design` / `domain-modeling` skills, so you must install them too.

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) Thanks [@mattpocock](https://github.com/mattpocock)! - Remove the **`caveman`** and **`zoom-out`** skills.

  - `caveman` was a duplicate of another skill I was testing and was never meant to be public.
  - `zoom-out` went unused in practice, so it's been removed from the repo.

  **Breaking:** both skills have been removed.

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) Thanks [@mattpocock](https://github.com/mattpocock)! - Rename the **`diagnose`** skill to **`diagnosing-bugs`**.

  **Breaking:** invoke it as `/diagnosing-bugs` — the old `/diagnose` name no longer exists.

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) Thanks [@mattpocock](https://github.com/mattpocock)! - Replace **`write-a-skill`** with **`writing-great-skills`**.

  - Removed `write-a-skill`.
  - Added `writing-great-skills` (plus its `GLOSSARY.md`) — a reference for writing and editing skills well: the vocabulary and principles that make a skill predictable, hunting no-ops down to the sentence level.
  - Exposed `grilling` as a model-invoked skill — the reusable interview loop behind `grill-me` and `grill-with-docs`.

  **Breaking:** `write-a-skill` has been removed; use `writing-great-skills` instead.

### Minor Changes

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) Thanks [@mattpocock](https://github.com/mattpocock)! - Add the **`resolving-merge-conflicts`** skill — a loop for resolving an in-progress git merge or rebase conflict. Standalone, with no dependencies on other skills.

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) Thanks [@mattpocock](https://github.com/mattpocock)! - Rename the skill taxonomy from **Commands / Skills** to **User-invoked / Model-invoked** across the docs, and add `docs/invocation.md` defining the split: user-invoked skills are reachable only when you type them and exist to orchestrate; model-invoked skills can also be reached automatically when the task fits. A user-invoked skill may invoke model-invoked skills, but never another user-invoked one.

### Patch Changes

- [`47bde84`](https://github.com/mattpocock/skills/commit/47bde84da032afb2e5058f997f3bbca47d321dbd) Thanks [@mattpocock](https://github.com/mattpocock)! - Tighten the **`review`** skill: fail-fast ref check, single-sourced rules, and no-op cuts.
