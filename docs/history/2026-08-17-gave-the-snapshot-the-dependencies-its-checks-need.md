# Gave the evaluation snapshot the dependencies its checks need

Delivered TB-030, a defect slice found by committing in a real Laravel project.
The one required check that successfully launched its program died on this:

```
require(/…/gate-hook-runner-exec-H33i9A/vendor/autoload.php):
  Failed to open stream: No such file or directory in …/artisan on line 10
```

- Named the mechanism. `captureSnapshot` materializes from `git ls-files`, and
  `vendor/` and `node_modules/` are git-ignored in every project that has them,
  so they were absent from every execution root the gate has ever built. A PHP
  project's autoloader, a Node project's module tree, and everything either
  resolves through them were simply not there.
- Settled the category question the way `TB-024` already settled its half. A
  `composer-bin` runner resolves to a live binary outside the snapshot because
  the tool is not the thing under test. A project's installed dependencies are
  the same category: not the change being graded, but what a tool needs in
  order to grade it.
- Provided declared roots beside the snapshot, and graded none of them. The
  identity is computed over the enumerated tracked paths before anything else
  is placed in the execution root, so providing a dependency root leaves the
  snapshot identity and `verifySnapshot` byte-identical — proved by a fixture
  that captures the same clone twice and compares. A tool writing into its own
  cache inside a provided root therefore never becomes `snapshot-mismatch`.
- Refused a declaration that could climb out. An absolute path, a `..`
  segment, or an empty string is refused by both the policy contract and the
  materializer, so a declaration can never reach content the repository does
  not contain.
- Reported what could not be provided. A declared root the clone has not
  installed — or that a platform could not link — is
  `dependency-root-unavailable`, a new member of the existing unverified
  family, so the evaluation denies with a stated reason instead of proceeding
  into a fatal error from inside somebody's tool.
- Put the declaration in the Gate policy rather than a provider plan, which is
  a correction to the ticket. Providers are not reachable at commit time: an
  activated clone derives its checks from the configuration, no provider is
  loaded, and the recorded decisions in `real-project-evidence/` carry
  `profile: null`. `evaluation_gate.execution.dependency_roots` sits beside
  `budget_skippable`, is validated by the policy contract, and is already in
  both runners' hands. Gate core still names no stack directory, proved by a
  source scan over `snapshot.mjs`, `gate-core.mjs`, `evaluation-contract.mjs`,
  and `policy.mjs`.
- Required two proved facts before drafting a root, which the first
  implementation did not. Deriving `vendor` from `composer.json` and
  `node_modules` from `package.json` immediately denied every commit in
  `derived-configuration-round-trip` — a fixture carrying a `package.json`
  whose only check is a Node repository script that reaches into no module
  tree. `--draft-policy` now declares a root only when some configured check
  runs through a runner that reaches into it *and* the governing manifest
  exists. Declaring a root nothing was going to read would deny commits for a
  directory no check needs, which is the same false accusation this ticket
  exists to end.
- Stated it in the preview. The activation preview a maintainer consents to now
  lists the dependency roots their checks will be given.
- Proved it through real commits, and proved the proof. `vendor-binary-commit`
  now has its vendor binary load a git-ignored `vendor/autoload.sh` before it
  grades anything, exactly as `artisan` does. Setting the fixture's declared
  roots back to empty makes that scenario fail, so the assertion is
  load-bearing rather than incidentally green.

Scope held: nothing is installed — the gate never runs `composer install` or
`npm ci`; no dependency root enters the snapshot identity or `changedPaths`; no
framework name entered gate core; no container, virtual machine, or sandbox was
introduced.

A residual worth stating: a provided root is linked, not copied, so a tool that
writes into its dependency root writes into the maintainer's own installation.
Copying a module tree per evaluation would make the budget meaningless, and
this is already true of the live binaries `TB-024` runs — it is what running
the tool by hand would have done.

Verification: `npm run test:unit` (360 passing), `npm run validate` (29 skills,
245 Markdown files), `npm run test:install`, and regression runs of all nine
capabilities — `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance`, `gate-security-control-smoke`, and
`gate-runtime-portability`.

For an already-activated clone: dependency roots are policy, so a clone
configured before this change declares none and behaves exactly as it did.
Re-drafting the policy with `--draft-policy` and reconfiguring is what adds
them.
