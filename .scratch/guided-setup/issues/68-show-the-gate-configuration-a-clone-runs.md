# TB-068 — Show the Gate configuration a clone runs

Status: ready-for-agent
Parent: guided-setup-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by: 67-name-the-next-step-without-a-terminal
Tracker ID: 68-show-the-gate-configuration-a-clone-runs
Draft key: TB-068

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/guided-setup/issues/guided-setup-feature-spec.md`

## Outcome

`agent-framework config show` prints the Gate configuration section a
maintainer would otherwise read as raw flow-JSON lines — checks, budget,
bypass, execution, and evidence — in named, readable form, and on an activated
clone marks each pinned value as matching or differing from what the
Activation receipt pinned. Sensitive runtime inputs appear by name and source
only.

## SRS Traceability

- `FR-GUIDE-005`
- `AC-GUIDE-003`
- `SG-GUIDE-002`, `SG-SECRET-001`, `SG-GUIDE-001`
- `RISK-006`

## Domain Concepts

Gate configuration section, Trusted gate configuration, Activation receipt,
Sensitive runtime input.

## Approach and Tradeoffs

- Verified: the Gate policy section has exactly five subcontracts — `checks`,
  `budget`, `bypass`, `execution`, `evidence` — and `configure-gate` renders
  each as one flow-JSON line.
- Verified: `gate status --json` reports `observation.controlSurface`, the same
  observation status uses to detect configuration drift.
- Proposed: pinned-versus-working comparison is read from the Gate's `--json`
  status document; where that document lacks the pinned value a field needs,
  the field is added to the Gate's observation document as part of this slice
  (feature contract `GAP-005`), never read from Gate internals.

## Architecture Boundary and Public Seam

The Framework command in `framework-setup`. Public seam: `config show` run as a
child process on configured and activated fixtures. First red test: on an
activated fixture whose working configuration adds a dependency root after
activation, `config show` lists that root as differing from the pinned value.

## Safeguards and Invariants

- `SG-GUIDE-002`, `SG-SECRET-001`: a secret canary set in the environment and
  in a declared environment file never appears in the output.
- `SG-GUIDE-001`: read-only; clone and `.git` bytes unchanged.

## Prohibited Behavior and Non-goals

- No editing (`TB-069`, `TB-070`).
- No display of Verification profile commands beyond the check identities the
  Gate policy names.

## Risk and Decision Impacts

- `RISK-006`: covered by the canary assertion.

## Acceptance Criteria

- [ ] `AC-GUIDE-003` (display half): configured and activated fixtures show every
  subcontract by name; an activated fixture marks matching and differing
  pinned values; an unconfigured clone says there is no Gate section and names
  the next step from `TB-067`.
- [ ] No secret canary value appears; nothing is written.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-GUIDE-003`, `SG-GUIDE-002`: configured, activated-matching, activated-differing, unconfigured, and canary fixtures | `npm run test:unit` | Yes — the display is fully observable in the command's output |

Smoke, frontend build, and browser evidence are inapplicable: a read-only
display over state `TB-067`'s install smoke already reaches.

## Blocked By

- `TB-067` — the Framework command and its Gate locator.

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
