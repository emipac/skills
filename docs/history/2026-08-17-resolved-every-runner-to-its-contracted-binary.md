# Resolved every runner to the executable its contract names, once

Delivered TB-024, a defect slice found by activating the Gate on a real Laravel
project: the descriptor contract said a `composer-bin` check runs the binary
under the vendor directory, composition dropped the leading argument on exactly
that understanding, and the only shipped resolver ran `composer` instead — so
every commit was refused, and a project with a matching `composer.json` script
would instead have passed a check that ran a program its policy never named.

- Gave resolution one owner. `createRunnerResolver` in `command-descriptor.mjs`
  is now the single place a logical runner becomes an executable, exported
  beside the composition rule `TB-019` gave the same treatment. The hook's
  private copy is gone, and a source scan over the gate library asserts exactly
  one module maps a runner to a program — a second copy is how activation came
  to prove one binary while the hook ran another.
- Resolved `composer-bin` to the binary its descriptor names. The leading
  argument is looked up under the vendor directory of the descriptor's own
  working directory, so a repository whose PHP application lives in a
  subdirectory resolves under that subdirectory. The result is absolute:
  checks run inside the materialised snapshot, where `vendor/` is absent
  because it is git-ignored, and the tool is not the thing under test — the
  snapshot content is (`SG-EVAL-001`).
- Refused rather than reached out. A binary name carrying a path separator, or
  naming a directory, is refused instead of joined, so no descriptor can walk
  out of the vendor directory. A binary that is absent or not executable is
  `runner-unresolved` and denies; there is still no shell lookup and no `PATH`
  fallback for this runner (`SG-CMD-001`).
- Left the other three runners exactly as their contract rows read.
  `php-script` and `package-script` still resolve on `PATH`, `repository-script`
  still resolves to this Node runtime for a Node module and to nothing
  otherwise, and fixtures now prove correcting one runner left the others alone.
- Made the receipt authoritative instead of decorative. `runHook` runs the
  executables `runtime.runners[]` pinned and resolves nothing itself, so the
  programs activation obtained consent for are the programs a commit is graded
  by. A check the receipt pins nothing for is `runner-unpinned`; a pin whose
  executable is gone, or that no longer matches its runner, is
  `runner-pin-drift`. Both deny and both name `gate repair`, because a runtime
  that quietly substitutes a program is the defect, not a recovery from it
  (`NFR-REL-003`).
- Shipped a default resolver for activation. `activateGate` no longer requires
  an injected `resolveExecutable`; resolution stays where it belongs, at the
  step that previews exact commands and pins them. An integrator injecting its
  own can drop it, which narrows an integration surface that guaranteed the
  divergence found here.
- Drove the resolver itself, which no test had ever exercised. All fifteen
  existing call sites injected a fake — including the composition fixture that
  handed in the very executable the shipped resolver could not produce, so
  contract, composition, and test all agreed while the resolver disagreed with
  every one of them. `tests/gate-runner-resolution.test.mjs` resolves against
  real files on disk for present, absent, separator-bearing, and subdirectory
  vendor binaries.
- Extended `gate-activation-smoke` with `vendor-binary-commit`, the scenario the
  existing ones structurally could not observe: every other scenario runs
  `repository-script`, which resolves to this Node runtime. A clone whose
  required check is a `composer-bin` descriptor now activates against a real
  executable under `vendor/bin`, denies a commit that binary fails, allows one
  it passes, records from inside the binary itself that it graded both, and
  denies as drift once the pinned executable is removed. That capability no
  longer injects a resolver at all, so it observes the executables a real clone
  would run.

Scope held: no change to `composeArguments`, the composition table, or the
descriptor contract's composition rows — the contract was right and the resolver
was what disagreed. No new runner, no shell lookup, no `PATH` fallback for
`composer-bin`, no silent re-resolution of a drifted pin, and no work inside
`gate repair` beyond naming it in the drift message.

Verification: `npm run test:unit` (324 passing), `npm run validate`
(29 skills, 229 Markdown files), `npm run test:install`, and regression runs of
all nine capabilities — `gate-runtime-binding-smoke`, `gate-fix-smoke`,
`gate-evidence-prune-smoke`, `gate-activation-smoke`,
`gate-hook-conformance-smoke`, `gate-lifecycle-smoke`,
`gate-adapter-conformance`, `gate-security-control-smoke`, and
`gate-runtime-portability`.

One unrelated repair travelled with this slice. `the documented starter policy
is accepted by setup and the Gate runtime` scraped a hand-written
`cat > policy.json` heredoc out of `docs/framework-guide.html`, and the guide no
longer tells maintainers to hand-write that file — the policy it documents is
the one `--draft-policy` produces. The test now reads that block instead, so it
still asserts what it always asserted: a policy the guide shows a maintainer
must configure and must validate.
