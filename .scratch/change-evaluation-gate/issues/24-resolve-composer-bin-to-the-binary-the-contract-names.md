# TB-024 — Resolve every runner to the executable its contract names, once

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: done, defect
Blocked by:
Tracker ID: 24-resolve-composer-bin-to-the-binary-the-contract-names
Draft key: TB-024

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

An activated clone runs the executables its policy names. A `composer-bin`
check resolves to the vendor binary the descriptor declares, the hook honours
the runners its Activation receipt pinned, and one resolution rule serves both
activation and commit time so the two can never name different programs.

## SRS Traceability

- `FR-EVAL-001`, `FR-PROF-010`
- `AC-EVAL-001`
- `SG-CMD-001`, `SG-OWNER-001`, `SG-EVAL-001`
- `NFR-REL-003`
- `RISK-001`

## Defect this contract fixes

Found by activating the Gate on a real Laravel project (`gms`). The maintainer's
agent had to patch the installed skill locally before any commit could pass.
All three findings below are reproduced against the shipped code, not inferred.

### 1. `composer-bin` resolves to the wrong program

The provider descriptor contract
(`references/provider-descriptor-contract.md:101`) is explicit:

> `composer-bin` | The leading argument names the binary under the vendor
> directory and is consumed by resolution; the rest is passed to it.

`composeArguments` implements exactly that, dropping `args[0]`
(`command-descriptor.mjs:231`). But the only shipped resolver,
`defaultResolveExecutable` in `hook-runner.mjs`, ignores `args[0]` entirely and
maps the runner to the `composer` binary on `PATH`
(`hook-runner.mjs:244`). The two halves disagree, and the result is:

```
pint:
  stored args   : ["pint","--dirty","--format","agent"]
  composed args : ["--dirty","--format","agent"]
  SHIPPED runs  : /opt/homebrew/bin/composer --dirty --format agent
  CONTRACT says : vendor/bin/pint --dirty --format agent
phpstan:
  SHIPPED runs  : /opt/homebrew/bin/composer analyse
  CONTRACT says : vendor/bin/phpstan analyse
```

`composer --dirty` exits non-zero, so the check reports `failed`, the required
binding denies, and **every commit is refused** — while the denial message
blames the maintainer's formatting rather than the resolver. That is the loud
case.

The quiet case is worse and is why this is `NFR-REL-003` rather than a
usability bug: `composer` followed by a bare name runs a script defined in
`composer.json`. A
project defining an `analyse` script would have `composer analyse` *succeed*,
reporting a passed `static-analysis` check that ran something other than the
`phpstan analyse` the policy names, with the descriptor's arguments silently
discarded. Evidence would attest to a command that never ran. (Reasoned from
documented Composer behaviour; the failing case above is the one reproduced
here.)

### 2. Resolution structurally cannot find a vendor binary

`defaultResolveExecutable(command, { environment })` receives no repository
root, so it has no way to resolve a repository-relative `vendor/bin/...`. The
`PATH` shortcut is not an oversight so much as the only thing that signature
permits. Fixing finding 1 requires widening the seam.

Two constraints the fix must respect, both verified:

- **The path must be absolute.** Checks execute with
  `cwd: path.join(executionRoot, command.working_directory ?? '.')`
  (`bounded-execution.mjs:128`), and `executionRoot` is the materialised
  snapshot. `vendor/` is git-ignored, so it is absent there; a relative
  `vendor/bin/pint` would resolve inside the snapshot and miss. An absolute
  path runs the live tool against snapshot content, which is the correct
  semantic — the tool is not the thing under test, the code is.
- **`working_directory` participates.** A repository with its PHP application
  in a subdirectory keeps `vendor/` under that subdirectory, so the vendor root
  is the repository root joined with `working_directory` then `vendor/bin`,
  not the repository root's own `vendor/bin`.

### 3. The receipt pins runners that the hook then ignores

Activation records every resolved executable in the receipt
(`activation.mjs:1718`, `runtime.runners[].executable`). `runHook` reads only
`receipt.runtime.runnerVersion` and re-resolves everything from scratch
(`hook-runner.mjs:406`). So activation can prove one program and the hook can
run another — which is precisely what happened on `gms`, where the receipt
pinned `vendor/bin/pint` while the hook kept invoking `composer`.

A pin that no one reads is not a pin. This also means the library ships **no
default resolver for activation at all** — `activateGate` takes
`resolveExecutable` as an injected dependency, so every integrator writes their
own, which guarantees exactly the divergence found here.

## Domain Concepts

Command descriptor, Logical runner, Runner resolution, Activation receipt,
Runtime pin, Evaluation snapshot.

## Approach and Tradeoffs

**One resolution rule, exported once.** Add a single resolver beside
`composeArguments` — the same reasoning `TB-019` applied when it made preview
and execution derive from one composition rule. Activation and the hook both
consume it; neither restates it. A second copy of resolution is how this defect
existed at all.

The resolver takes the repository root and the descriptor, and resolves:

- `composer-bin` resolves to the repository root joined with the descriptor's
  `working_directory`, then `vendor/bin`, then `args[0]` — absolute, verified
  executable, refused as `runner-unresolved` when absent. An `args[0]`
  containing a path separator is refused rather than joined, so a descriptor can
  never reach outside the vendor directory.
- `php-script`, `package-script` → the platform executable on `PATH`, unchanged.
- `repository-script` → `process.execPath` for a Node module, unchanged.

Only `composer-bin` changes. The other three already satisfy their contract
rows, and `locateOnPath` already returns absolute paths for `PATH` lookups.

**The hook honours the pin.** `runHook` uses `receipt.runtime.runners[].executable`
for each check rather than re-resolving. When a pinned executable is now absent
or no longer executable, it denies with a distinct reason naming the drift and
pointing at `gate repair` — it never silently re-resolves to something else,
because a runtime that quietly substitutes a program is the defect this ticket
closes, not a recovery from it.

Re-resolution stays available for activation, which is where resolution
belongs: it is the step that obtains consent for exact commands and then pins
them.

## Architecture Boundary and Public Seam

The boundary is runner resolution, currently split between
`hook-runner.mjs`'s private default and each activation caller's injected
function. The public seam is the new exported resolver and the hook's use of
`receipt.runtime.runners`. First red test: a `composer-bin` descriptor storing
`['pint', '--dirty']` resolves to an absolute path ending
`vendor/bin/pint` and previews `vendor/bin/pint --dirty` — never
`composer --dirty`.

## Safeguards and Invariants

- `SG-CMD-001`: resolution still never consults a shell, never parses or splits
  a stored argument, and refuses rather than adjusts. A `composer-bin` binary
  name containing a separator is refused, not normalised.
- `SG-OWNER-001`: the resolver reads descriptors through the command contract
  and learns nothing about which stack produced them.
- `SG-EVAL-001`: resolving to an absolute path outside the snapshot never
  widens what is graded. The executable is the tool, and the snapshot stays the
  only content evaluated — the working tree is still never the subject.
- `NFR-REL-003`: an executable that cannot be found, or that no longer matches
  its pin, is `runner-unresolved` and denies. Substituting a different program
  is never a recovery.
- The receipt stays the record of what was activated; this ticket makes it
  authoritative at commit time rather than decorative.

## Prohibited Behavior and Non-goals

Do not change `composeArguments`, the composition table, or the provider
descriptor contract — the contract is correct and the resolver is what
disagrees with it. Do not add a runner. Do not introduce shell lookup or a
`PATH` fallback for `composer-bin`. Do not silently re-resolve a drifted pin.
Do not widen scope into `gate repair` itself beyond naming it in the drift
message.

## Risk and Decision Impacts

- `RISK-001` is the disposition this touches: exact command evidence is the
  mitigation, and evidence naming a command that did not run is that mitigation
  failing silently. Correcting the resolver restores it; no disposition changes.
- Honouring the pin makes activation the only place resolution happens, which
  narrows a previously open integration surface. Any caller currently injecting
  its own resolver should be able to drop it; that is an improvement, not a
  break, but it is a behaviour change worth stating in the release notes.

## Acceptance Criteria

- [x] `FR-PROF-010`, `SG-CMD-001`: a `composer-bin` descriptor storing
  `['pint', '--dirty', '--format', 'agent']` in a repository whose
  `vendor/bin/pint` exists resolves to that absolute path and composes to
  `vendor/bin/pint --dirty --format agent`; a descriptor whose vendor binary is
  absent is `runner-unresolved` and denies; a binary name containing a path
  separator is refused rather than joined.
- [x] `FR-PROF-010`: a `composer-bin` descriptor whose `working_directory` names
  a subdirectory resolves under that subdirectory's `vendor/bin`, not the
  repository root's.
- [x] `FR-EVAL-001`, `AC-EVAL-001`: an activated clone with a real
  `vendor/bin` executable runs that executable at commit time — proved by a
  commit whose required `composer-bin` check passes on good content and fails on
  bad content, with evidence naming the vendor binary rather than `composer`.
- [x] `AC-EVAL-001`, `NFR-REL-003`: `runHook` uses the executables
  the receipt pinned; a pin whose executable is now absent denies with a
  distinct drift reason naming `gate repair`, and never re-resolves to a
  different program.
- [x] `SG-OWNER-001`: exactly one resolution rule exists in the codebase.
  Activation and the hook both reach it, and neither restates the
  runner-to-executable mapping — proved by a source scan of the kind
  `TB-022` uses for the check catalogue.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `FR-PROF-010`, `SG-CMD-001`, `SG-OWNER-001`: resolution fixtures for present, absent, separator-bearing, and subdirectory vendor binaries; pin-honouring and pin-drift paths; the single-rule source scan | `npm run test:unit` | Yes — configured unit suite owns the resolution seam |
| smoke | both | `FR-EVAL-001`, `AC-EVAL-001`: an activated fixture with a real executable script under `vendor/bin` allows a good commit and denies a bad one, with the vendor binary named in the evidence, and a pin whose executable was removed denies as drift | `gate-activation-smoke` capability extended by this slice | Yes — the existing scenarios inject resolvers and so cannot observe this |

Frontend build and browser evidence are inapplicable; this slice changes local
process resolution, not a frontend surface.

## Blocked By

None. `TB-018` (the packaged runner) and `TB-019` (composition) are done, and
this ticket corrects the resolver they left disagreeing with the contract.

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

## Why existing coverage missed this

`defaultResolveExecutable` is the only resolver that ships and the only one a
real commit uses, and **no test exercises it**. Every one of the fifteen test
call sites injects a fake — `() => ({ executable: process.execPath })`,
`(runner) => ({ executable: '/usr/bin/' + runner })`, `() => null`.

The composition test is the sharpest example. It asserts:

```js
assert.equal(previewOf(MIGRATED.formatBackend, 'vendor/bin/pint'),
             'vendor/bin/pint --dirty --format agent');
```

with a comment explaining that resolution consumes `args[0]` to find the binary
under the vendor directory. The fixture **hands in the exact executable the
shipped resolver fails to produce**, so the test proves composition is correct
given a correct executable and never asks whether one is ever produced.

Contract, composition rule, and test all agreed with each other. The resolver
was the one participant nobody checked against them — the same shape of gap
`TB-013`, `TB-017` through `TB-021`, and `TB-023` each closed, and the second
time (after `TB-023`) that the failure sat specifically between a component and
the runtime that consumes it.
