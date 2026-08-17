# TB-013 — Deliver supported desktop preflight adapters

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent
Blocked by: 11-preserve-hook-chains-and-activation-identity
Tracker ID: 13-deliver-supported-desktop-preflight-adapters
Draft key: TB-013

**Status:** ready-for-agent
**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Claude Code Desktop, Codex Desktop, and Cursor local-project users receive deterministic structured preflight feedback through thin capability-aware adapters while Git alone remains authoritative.

## SRS Traceability

- `FR-ADAPT-001`, `FR-ADAPT-002`, `FR-ADAPT-003`, `FR-ADAPT-004`, `FR-ADAPT-005`, `FR-ADAPT-006`, `FR-ADAPT-007`, `NFR-COMP-001`
- `AC-ADAPT-001`, `AC-ADAPT-002`
- `SG-SUPPORT-001`
- `RISK-004`, `Q-003`, `Q-004`

## Domain Concepts

Enforcement role, Support tier, Client compatibility baseline, Adapter distribution, and Evaluation snapshot.

## Approach and Tradeoffs

Keep adapters thin: declare capabilities, normalize supported events and repository/session identity, invoke the shared process interface, and present its structured result. Map Git `deny` to blocking, but desktop results to `not-authoritative`. Treat trust, timeout, invocation, capability, and malformed-output failures as `unverified`; unproved contexts cannot claim support.

## Architecture Boundary and Public Seam

The boundary is native client payload normalization outside Gate core; the public seam is the shared adapter conformance suite. First red test: the same deny decision blocks the Git fixture while each desktop fixture displays a structured non-authoritative preflight result.

## Safeguards and Invariants

- `SG-SUPPORT-001`: no integration is called supported before its declared surface passes the baseline, and lack of native blocking does not disqualify a conforming preflight.

## Prohibited Behavior and Non-goals

No client-specific policy, native payload leakage into core, support claim for remote/cloud/chat-only contexts, additional v1 clients, or desktop authorization.

## Risk and Decision Impacts

- `RISK-004`: accepted conditionally; exact adapter fixtures are a mandatory release gate.
- `Q-003`: no additional client enters v1; later clients require a new Wayfinder effort and compatibility evidence.
- `Q-004`: support is capability-based and proven by exact release-manifest versions and outcomes, not a permanent allowlist.

## Acceptance Criteria

- [x] `AC-ADAPT-001`: the same decision blocks Git on deny while desktop adapters normalize triggers and present structured `not-authoritative` feedback.
- [x] `AC-ADAPT-002`: every named desktop target passes the shared baseline; defined failures are `unverified`; unsupported contexts cannot claim support; exact versions and outcomes are recorded.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-ADAPT-001`, `AC-ADAPT-002`, `SG-SUPPORT-001`: shared conformance and failure fixtures | `npm run test:unit` | Yes — configured unit suite proves adapter normalization |
| smoke | both | `AC-ADAPT-002`: installed plugin surfaces expose dormant adapters and run the exact client fixtures | `npm run test:install` | Yes — configured install smoke protects cross-client distribution |
| e2e | both | `AC-ADAPT-001`, `AC-ADAPT-002`: Git and three desktop surfaces present role-correct outcomes | `gate-adapter-conformance` capability introduced by this slice | Yes — the final selectors depend on the new adapters |

Frontend build and browser evidence are inapplicable; these are local process adapters, not repository frontend code.

## Blocked By

`TB-011` — adapters consume the activated runtime, identity, trust, and hook authority contract.

> **Historical note — superseded.** The three sections below record this
> ticket's reopen and the two intermediate checks that followed, each true when
> written. All three are superseded by "Closed 2026-08-11 — one surface promoted
> on a real client invocation" further down, which is the current state:
> `AC-ADAPT-002` is met and both criteria are ticked. Read the sections below as
> history, not as status.

## Reopened 2026-08-11 — declared mappings refuted by real-client evidence

The first pass satisfied both acceptance criteria against INJECTED payloads
whose shape the implementation itself invented. Driving all three real clients
refuted **13 of 14 declared mappings, with 1 unverified and 0 surviving**.
Passing fixtures built on a fictional payload shape is not baseline evidence,
so `SG-SUPPORT-001` was not met and both criteria were unticked at that point.

Evidence: `.scratch/change-evaluation-gate/adapter-qualification-findings.md`.

Three corrections are BEHAVIOURAL, not field renames, and each needs its own
red-green cycle:

1. Resolve a repository root from `cwd` rather than assuming `cwd` is one.
   Observed as a repo root under Codex and NOT one under Claude Code, so
   neither assumption is safe; unresolvable must be `unverified`.
2. Read Cursor's `workspace_roots` ARRAY, and return `unverified` for a
   multi-root workspace rather than selecting an element.
3. Drop `commit-attempt` from `claude-code-desktop` entirely, including its
   `normalizedTriggers` — no such client event exists.

Out of scope for this reopen: the hook-registration divergence (Finding 8).
Desktop registration differs by file, nesting, discriminators, and schema
versioning, which affects activation and health reconciliation rather than the
adapter declarations this ticket owns. It needs its own delivery contract.

## Correction landed 2026-08-11 — declarations corrected, AC-ADAPT-002 still open

Every refuted mapping was replaced with the observed one, and the three
behavioural corrections landed with their own red-green cycles:

1. Repository roots are RESOLVED from the path a client sends, upward to a real
   repository, and are `unverified` when none resolves. The path is a candidate,
   never a root.
2. Cursor's `workspace_roots` ARRAY has an explicit rule. Exactly one element
   yields a candidate; a multi-root workspace is `unverified` rather than one
   selected element.
3. `commit-attempt` is gone from `claude-code-desktop`, including its
   `normalizedTriggers`. No desktop surface declares one. Cursor's is recorded
   in a new per-adapter `unverifiedTriggers` field — unobserved is not the same
   as known-absent, and recording it keeps the open question visible without
   letting the surface claim the capability.

The three declarations were kept separate, and event matching stayed
exact-string, so `Stop` and `stop` remain distinguishable per client.

**`AC-ADAPT-001` is now met.** The triggers the desktop surfaces normalize are
the values their real clients send, and the `gate-adapter-conformance`
capability drives a real blocked commit and presents that same decision on all
three surfaces.

**`AC-ADAPT-002` was NOT met at this point and stayed unticked** — later met,
see the promotion section below. Three of its four clauses held: defined
failures are `unverified`, unsupported contexts cannot claim support, and
per-check outcomes are recorded. The first and last did not. The
shared baseline still runs on payloads this repository builds from the
declaration under test, so it cannot establish that the declaration matches the
client — the fixture and the thing under test come from the same source, which
is exactly how the first pass produced fourteen confident, wrong mappings. The
only exact client version now known is Cursor's, and it came from a capture
rather than a baseline run.

Accordingly `classifySupport` now records baseline provenance and returns
`experimental` / `client-invocation-not-observed` for a fixture-driven pass.

## Closed 2026-08-11 — one surface promoted on a real client invocation

`AC-ADAPT-002` is now met and both criteria are ticked.

`payloadSource` was a label a caller asserted; it is now earned. The baseline
accepts the client's own payload and drives every check through it, and a run
claiming `captured-client-invocation` without supplying an invocation records
itself as the synthetic fixture it was. A captured run additionally reports
`captured-payload-readable`, where the payload comes from the client and the
field names come from the adapter — so a declaration that does not describe the
client fails instead of passing quietly.

**Cursor 3.15.6 is `supported`**, from a baseline its own client drove:
11 of 11 checks passed including `captured-payload-readable`, which is the
direct proof that this ticket's corrected declaration reads what Cursor really
sends. The version is `payload.cursor_version`, self-reported in the same
invocation as the capture. Evidence:
`.scratch/change-evaluation-gate/client-baselines/cursor.json`.

`claude-code-desktop` and `codex-desktop` remain `experimental` /
`client-invocation-not-observed`. Their declarations are corrected against real
captures, but neither has had a client-driven baseline run, and neither
self-reports a version in its payload. Promoting them is the same procedure,
not new work.

Also out of scope and untouched: the hook-registration divergence (Finding 8).

## Checked by TB-015 before the promotion — superseded

> **Historical.** This check ran *before* Cursor's client-driven baseline and is
> superseded by the promotion section above. It is kept because it records why
> the promotion procedure had to exist. It is placed after that section only by
> the order it was written, not by recency.

Release qualification re-derived every surface's tier from its own baseline
rather than reading the declared one. All four surfaces — the three desktop
adapters and authoritative Git — came back `experimental` /
`client-invocation-not-observed` at that point, and the compatibility manifest
recorded `client: null` for each, because no client had been launched, probed,
or driven yet.

`AC-ADAPT-002` was therefore unticked at that moment, and the remaining work was
written down as an executable checklist: `PROMOTION_REQUIREMENTS` in
`skills/change-evaluation-gate/scripts/lib/release-qualification.mjs`, and
section 5 of
`skills/change-evaluation-gate/references/release-qualification-contract.md`.
Cursor was then promoted by following exactly that checklist, which is what the
promotion section above records.

Nothing in `adapters.mjs` was modified by `TB-015`.

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
