# TB-063 — Tell a maintainer what this machine can do

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by:
Tracker ID: 63-tell-a-maintainer-what-this-machine-can-do
Draft key: TB-063

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer — or the colleague who just cloned the repository on a different
operating system — runs one read-only command and learns, before activating
anything, whether this machine can run the Gate this project configured: which
executables resolve, whether the dependency trees can be cloned or must be
copied, whether the declared runtime inputs can be found, whether hooks can be
registered, and what would fail if they activated now.

## SRS Traceability

- `FR-LIFE-004`, `FR-LIFE-009`, `FR-CFG-004`, `FR-CFG-006`
- `AC-PORT-001`, `AC-LIFE-008`
- `SG-TRUST-001`, `SG-LIFE-001`, `SG-OWNER-001`
- `NFR-PORT-001`, `NFR-PORT-002`, `NFR-OPER-001`
- `RISK-004`

## Defect this contract fixes

A gap, not a defect in what runs: every environment check the Gate performs
exists only inside an operation that also does something.

### What a month of real use found, and when

| Finding | Where it exists as a check | When the maintainer learned it |
| --- | --- | --- |
| PHP lives at `…/Application Support/Herd/bin/php` | activation resolves and pins every runner (`resolveExecutables`, `FR-CFG-004`) | at activation, after configuring |
| the system can clone; Node cannot | `TB-055`'s probe, inside the first `copy` root of a capture | measured by hand, then at the first preflight |
| the repository, tmp, and execution root share a volume | a precondition of that probe | measured by hand |
| `APP_KEY` is in `.env`, not the shell | `TB-059`'s resolution, inside `openStore` | 38 test failures on the first suite that booted |
| `.env` is declared but git-ignored and present | `TB-059`'s `environmentFiles[].status` | in an evidence envelope |
| a Windows directory symlink needs privilege; a junction does not | `TB-054`'s `link` provisioner | never — documented, unverified |
| the hook chain is valid and the shim can be created | activation's hook validation and self-test (`FR-LIFE-004`) | at activation |

Every one of those is answered by code that already runs. None can be asked
without also configuring, activating, or evaluating. A maintainer's first
signal that their machine differs from the author's is a denied commit or a
paused activation, and the maintainer is then reading a failure to infer an
environment.

`AC-PORT-001` names twelve portability fixtures that `gate-runtime-portability`
executes — against throwaway repositories, for release qualification. That
capability answers "does the Gate work on this OS" for the framework; nothing
answers "does the Gate work on this machine, for this project" for a
maintainer.

`RISK-004`: client behaviour changes independently. A colleague on a different
OS is the same risk from a different direction, and the framework claims one
verified environment.

## Domain decisions this contract settles

**`gate doctor` observes and reports. It never writes.** It is in the family
of `status` and `locks`: no preview, no token, nothing under the clone or the
repository changes. It may create and remove a probe under the OS temporary
directory, as `TB-055`'s probe does — that is the one footprint, and it is
stated.

**It asks the questions activation would ask, without activating.** The same
resolver, the same probe, the same runtime-input resolution, the same hook
validation. One implementation per question; `doctor` reaches it read-only.
A question that can only be answered by doing the thing — self-testing a
registered hook — is reported as "answered by activation", not simulated.

**It reports facts, not verdicts, and one verdict.** Each line is what was
observed: resolved or not, clone or byte-copy, found or unresolved, valid or
not. At the end, one line: whether `gate activate` would proceed past every
step `doctor` can see, and if not, the first thing that stops it.

**No operating-system-labelled logic.** `NFR-PORT-002`. `doctor` does not say
"you are on Windows"; it says a directory link could or could not be created
in the temporary directory, which is what matters and is true everywhere.

## Domain Concepts

Environment observation, Runner resolution, Clone capability, Runtime input
resolution, Hook chain, Read-only command, Activation precondition.

## Approach and Tradeoffs

Verified: the questions map to existing seams:

- Runners → `resolveExecutables` / `createRunnerResolver`
  (`command-descriptor.mjs`), already used by activation and by
  `unlaunchable` in bounded execution.
- Clone capability → `probeCloneCapability` (`snapshot.mjs:230`), memoised
  per capture; `doctor` runs it once against the OS temporary directory.
- Same volume → the `stat().dev` comparison inside that probe.
- Directory link → `PROVISIONERS.link` on a probe path under the temporary
  directory; the platform decides whether it succeeds.
- Runtime inputs → `resolveRuntimeInputs` (`runtime-inputs.mjs:182`) for the
  declared names and files; report `resolved`/`unresolved` and each file's
  status — **never a value**, exactly as `TB-059`'s evidence does.
- Hook chain → the validation activation performs before registering; the
  implementer establishes which function and whether it can run without a
  receipt.
- Configuration → `readRepositoryConfiguration` and `validateGatePolicy`,
  the reader `TB-049` fixed and the validator every command uses.

Verified: the operator surface (`operator-surface.mjs`, post-`TB-053`) gives a
read-only command registry entry, selector parsing, `--json`, and rendering
for free; `status` is the template.

Proposed — one section per question, in the order activation asks them.
Configuration → runners → dependency roots → runtime inputs → hooks. Each
section names the seam it reused. A maintainer reading `doctor` after a
failed activation should find the failing line in the same words.

Proposed — the final verdict is computed, not asserted. `doctor` runs the
activation *preview* through the same code `gate activate` runs, without
consenting, and reports whether it reached a token. That is the honest
"would activate proceed" — it is literally activation's own preview. The
implementer confirms the preview writes nothing, which `FR-LIFE-004` already
requires of it.

Proposed — `SG-OWNER-001` holds. `doctor` learns no client name, tool name,
or framework. It reports what the configured descriptors resolve to.

Proposed — say what `doctor` cannot see. Client hook registration for desktop
adapters happens at activation and cannot be observed before it; the hook
self-test runs a registered program. Both are reported as "answered by
activation" with the step named, so a green `doctor` is not mistaken for a
guaranteed activation.

Deliberately not fixing anything. Not installing anything. Not suggesting
package managers or paths — the report names what did not resolve and stops.
Deliberately not a replacement for `gate-runtime-portability`, which
qualifies the framework rather than a machine.

## Architecture Boundary and Public Seam

The boundary is between what a machine can do and the first operation that
finds out. The public seam is the `doctor` command and the read-only calls it
makes into resolution, provisioning, runtime inputs, and hook validation.

First red test: on a clone whose configured PHP runner does not resolve,
`gate doctor` names the runner and the descriptor before anything is
activated, where today the first signal is a failed activation preview.

## Safeguards and Invariants

- `FR-LIFE-009`, `SG-LIFE-001`: observation only; nothing under the clone or
  repository is written, proved by hashing before and after.
- `FR-LIFE-004`: the verdict is activation's own preview, which writes
  nothing.
- `SG-OWNER-001`: no client, tool, or framework name enters Gate core.
- `NFR-PORT-002`: no operating-system branch; capabilities are probed.
- `FR-CFG-006` / `SG-SECRET-001`: runtime-input resolution reports names and
  statuses only; no value reaches output, `--json`, or a log.
- `NFR-OPER-001`: every line names what was observed and, on failure, the
  descriptor or declaration it came from.
- `SG-TRUST-001`: the limit statement stays; `doctor` describes this machine
  to its owner.

## Prohibited Behavior and Non-goals

Do not write under the clone or the repository. Do not install, fix, repair,
or suggest an install command. Do not print or log any runtime-input value.
Do not branch on `process.platform` or an OS name. Do not add a second
implementation of any question — reuse the seam or report the question as
unanswerable here. Do not simulate a self-test. Do not replace or change
`gate-runtime-portability`.

## Risk and Decision Impacts

- `RISK-004`: a differing environment discovered by a failed operation
  becomes one discovered by a read-only report before any operation.
- No disposition changes; no safeguard is withdrawn.

## Acceptance Criteria

- [ ] `FR-CFG-004`: every configured runner is reported as resolved (with
  the path activation would pin) or not (naming the descriptor), through the
  same resolver activation uses.
- [ ] `AC-PORT-001`, `NFR-PORT-002`: clone capability, same-volume, and
  directory-link capability are reported from probes under the temporary
  directory, with no operating-system branch in the code.
- [ ] `FR-CFG-006`: each declared sensitive input is reported `resolved` or
  `unresolved` with its source, each declared environment file with its
  status, and no value appears in any output form — proved by scanning
  stdout and `--json` for a known value.
- [ ] Hook-chain validity is reported through activation's own validation.
- [ ] `FR-LIFE-004`, `AC-LIFE-008`: the final verdict is activation's preview, computed against the repository and configuration identities the receipt would pin; on a clone
  where the preview would refuse, `doctor` names the same step and reason.
- [ ] `SG-LIFE-001`: the clone and repository are byte-identical before and
  after; only a probe under the temporary directory is created and it is
  removed.
- [ ] Questions `doctor` cannot answer are listed as answered-by-activation
  with the step named.
- [ ] `SG-OWNER-001`: no client, tool, or framework name added to
  `scripts/lib/`, stated in the report.
- [ ] `--json` mirrors the rendered document; `gate --help` and the command
  contract list the command.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `FR-CFG-004`, `FR-CFG-006`, `NFR-PORT-002`, `SG-LIFE-001`: unresolved-runner-named, clone-capability-reported, link-capability-reported, runtime-input-status-no-value, hook-chain-reported, writes-nothing, verdict-matches-activation-preview, json-mirror fixtures against the real operator surface and the seams it reuses | `npm run test:unit` | Yes — the unit suite owns the operator surface and every seam `doctor` reaches |
| smoke | both | `AC-PORT-001`, `AC-LIFE-008`, `FR-LIFE-004`: on a real configured clone `doctor` reports what activation then pins, and on one with an unresolvable runner `doctor` names it and activation's preview refuses for the same reason | `gate-activation-smoke` and `gate-runtime-portability`, extended by this slice | Yes — agreement with activation is only observable across the two on a real clone |

Frontend build and browser evidence are inapplicable; this slice adds one
read-only operator command over existing observations.

## Blocked By

None.

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

Every environment question has a fixture, and every fixture asks it inside
the operation that needs the answer — activation resolves runners, capture
probes cloning, `openStore` resolves inputs. Nothing asks them for their own
sake, because the suite runs on one machine where the answers never change.
The need appeared when a second machine was about to.
