# TB-073 — Write one page a maintainer can read

Status: ready-for-agent
Parent: guided-setup-feature-spec
Assignee:
Labels: ready-for-agent, enhancement
Blocked by: 68-show-the-gate-configuration-a-clone-runs
Tracker ID: 73-write-one-page-a-maintainer-can-read
Draft key: TB-073

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/guided-setup/issues/guided-setup-feature-spec.md`

## Outcome

`agent-framework report --html` writes one self-contained HTML page showing the
clone's Gate state and health, doctor findings, the effective configuration
from `config show`, and the next steps from `setup`. By default it goes to the
operating system's temporary directory, or to `--out`, and the command prints
where it went. The page makes no external request, is never written inside the
clone, and never contains a secret value.

## SRS Traceability

- `FR-GUIDE-008`
- `AC-GUIDE-004`
- `SG-GUIDE-002`, `SG-SECRET-001`, `SG-GUIDE-001`
- `RISK-006`

## Domain Concepts

Gate health, Gate lifecycle state, Gate configuration section, Sensitive
runtime input.

## Approach and Tradeoffs

- Proposed: the page is rendered from the same documents `setup --json` and
  `config show` produce, so the report can never disagree with the commands.
- Proposed: inline styles only; no script, font, image, or stylesheet from
  anywhere.
- Tradeoff: a static page goes stale the moment the clone changes; it carries
  its generation time and the command that regenerates it.

## Architecture Boundary and Public Seam

The Framework command's `report`. Public seam: the command run as a child
process on fixtures. First red test: on an activated fixture, `report --html`
prints a path under the temporary directory and the file contains the health
and the next step.

## Safeguards and Invariants

- `SG-GUIDE-002`: an `--out` inside the clone is refused with nothing written;
  a secret canary never appears in the page.
- `SG-SECRET-001`: Sensitive runtime inputs appear by name and source only.
- `SG-GUIDE-001`: nothing under the clone or `.git` changes.

## Prohibited Behavior and Non-goals

- No server, no browser launch, no interactive controls.
- No history or trend across runs.

## Risk and Decision Impacts

- `RISK-006`: the canary assertion covers the page.

## Acceptance Criteria

- [ ] `AC-GUIDE-004`: one file at the temporary or explicit path; no `http`,
  `https`, or protocol-relative reference in it; an `--out` inside the clone is
  refused; the canary is absent; the clone is unchanged.
- [ ] The page's health and next step equal `setup --json` for the same clone.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-GUIDE-004`, `SG-GUIDE-002`: default-path, explicit-path, inside-clone-refused, no-external-reference, canary, and matches-setup-json fixtures | `npm run test:unit` | Yes — the file is fully inspectable |

Smoke evidence is inapplicable: read-only output over state already smoked.
Browser evidence is inapplicable: the page is static and asserted as a file;
there is no frontend profile or build.

## Blocked By

- `TB-068` — the configuration display the page reuses.

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
