# FS-004 — Read a blocker as a blocker, and not as a mention

Status: done
Labels: done, defect
Blocked by:
Tracker ID: 04-read-a-blocker-as-a-blocker-and-not-as-a-mention
Draft key: FS-004

**Status:** done

**Parent feature contract:** none. `to-tickets` owns the delivery-contract
audit every ticket set in this repository is validated by, and this is a
defect in that audit rather than in any feature it audits.

## Outcome

The ticket audit reports a ticket as blocked only when the ticket says it is
blocked. A ticket that writes "None — `TB-004` delivered this and is done" is
read as unblocked, and a cycle the audit does report names the tickets in it.

## Defect this contract fixes

Raised when `TB-055` was written: the audit reported `blocker-cycle` for the
Change Evaluation Gate ticket set. Verified pre-existing by removing `TB-055`
and re-running — the error was already there. Verified false by reading the
tickets it implicates.

### How the audit finds blockers

Verified at `skills/to-tickets/scripts/audit-ticket-contracts.mjs`:

- `:445` reads the `## Blocked By` section's lines.
- `:110` extracts blockers as **every** `TB-nnn` token in that text:

  ```js
  const blockerIds = (value) => [...value.matchAll(/\bTB-\d{3}\b/g)]
  ```

- `:447` stores them as the ticket's blocker edges.
- `:548` computes the frontier as every ticket with zero edges.
- `:519-521` reports a cycle as the bare string
  `Ticket blocker graph contains a cycle`, naming nothing.

### What the tickets actually say

The reported cycle, reconstructed with the audit's own extraction rule, is
`TB-018 → TB-020 → TB-018`. Both sections begin with the word **None**:

> **TB-018:** None. `TB-004` delivered the evaluation seam and `TB-010`
> delivered hook registration; both are done. `TB-020` is also done and
> defines the self-test protocol …

> **TB-020:** None. `TB-010` delivered the activation transaction and its
> self-test step, and is done. `TB-018` supplies a conforming runner but is
> not required …

Neither is blocked by anything. Each explains, in prose, which finished work
it builds on. The audit reads every mention as an edge, so two tickets that
each acknowledge the other become a cycle.

### How far it reaches

Verified by applying the same extraction to the whole set: **about thirty
tickets** from `TB-002` onward write their `## Blocked By` section in this
form — "None. `TB-x` delivered … and is done." Every one of them has false
edges, which means:

- the **frontier** metric (`:548`) has excluded most of the ticket set for its
  entire history, because a ticket mentioning a finished ticket is never
  "zero edges";
- the `valid: false` result the audit returns has been partly caused by a
  cycle that does not exist;
- the cycle message cannot be acted on, because it does not say which tickets
  form it.

This is the house style, not a lapse. A `## Blocked By` section that explains
what a ticket builds on is *more* useful than one that says "None" alone. The
parser is wrong to punish it.

## Approach and Tradeoffs

Verified: the section already has a recognisable grammar in practice. It is
either the word `None` optionally followed by prose, or a list of blockers each
on a bulleted line or as the leading token of the section, optionally followed
by an explanatory dash. Verified examples of the blocked form:

> `TB-004` — policy is applied to the complete versioned evaluation decision.

> - `TB-002` — evaluation consumes the configured Gate policy.
> - `TB-003` — evaluation consumes normalized Verification descriptors.

Verified examples of the unblocked form are the two quoted above.

Proposed — parse the grammar, not the tokens. A section whose first
non-empty line begins with `None` declares no blockers, whatever it goes on to
mention. Otherwise, a blocker is a `TB-nnn` that begins a line (after an
optional bullet and backticks), and prose after a dash on that line is
explanation, not a further blocker. The implementer establishes the exact rule
against every existing ticket and states which, if any, it changes the reading
of — a ticket whose meaning the new rule alters is a finding to report, not to
silently reinterpret.

Proposed — name the cycle. `graphHasCycle` returns a boolean. It has the path
on its stack when it finds one; return it, and put it in the message. A
maintainer told "TB-018 → TB-020 → TB-018" can open two files. A maintainer
told "contains a cycle" opens sixty-six.

Proposed — keep the front-matter `Blocked by:` line as a cross-check, not a
second source. Every ticket carries `Blocked by:` in its header, and the audit
currently ignores it. The implementer decides whether a header that disagrees
with the section is a warning, and states what they chose; what is not
acceptable is two sources of truth that the audit silently reconciles.

Proposed — prove it against the real set. The verification is that the
Change Evaluation Gate ticket set audits with no cycle, that its frontier
contains every unblocked ticket, and that every ticket the old rule read as
blocked by a finished ticket is now read as unblocked — with the count stated.

Deliberately not rewriting any ticket to satisfy the old parser. Deliberately
not changing what a blocker means, how the frontier is defined, or any other
audit rule.

## Architecture Boundary and Public Seam

The boundary is between what a ticket's `## Blocked By` section says and what
the audit concludes from it. The public seam is `blockerIds`, `graphHasCycle`,
and the `blocker-cycle` error they produce.

First red test: a ticket whose `## Blocked By` reads "None. `TB-001` is done."
audits as unblocked, where today it audits as blocked by `TB-001`.

## Safeguards and Invariants

- A ticket that declares a blocker is still read as blocked by it; no real
  edge is lost. Proved by the tickets that use the bulleted form.
- A genuine cycle is still detected, and is now named.
- A self-blocker and an unknown blocker (`:449-455`) are still reported.
- No ticket file is modified by this contract.
- The audit's other rules — sections, traceability, readiness, placeholders —
  are untouched.

## Prohibited Behavior and Non-goals

Do not rewrite, reformat, or "fix" any ticket's `## Blocked By` section. Do
not change the definition of the frontier. Do not drop a real blocker edge to
make a cycle disappear. Do not add a new ticket-format requirement that
existing tickets fail. Do not change any audit rule other than blocker
extraction and cycle reporting.

## Acceptance Criteria

- [ ] A `## Blocked By` section beginning with `None` yields no blockers,
  regardless of what tickets it mentions afterward.
- [ ] A section listing blockers — bare, backticked, bulleted, or followed by
  an explanatory dash — yields exactly those blockers and nothing from the
  explanation.
- [ ] The Change Evaluation Gate ticket set audits with no `blocker-cycle`, and
  the report states how many tickets changed from blocked to unblocked and
  names any whose reading changed in any other way.
- [ ] A genuine cycle, proved by a fixture with two tickets that each list the
  other, is reported with its path in the message.
- [ ] `self-blocker` and `unknown-blocker` still fire, proved by the existing
  fixtures unchanged.
- [ ] No ticket file is modified.
- [ ] `npm run test:unit` and `npm run validate` pass.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | none-with-mentions-is-unblocked, listed-blockers-extracted, explanation-not-extracted, genuine-cycle-named, self-and-unknown-still-reported fixtures against the real audit module | `npm run test:unit` | Yes — the unit suite owns the audit |
| smoke | both | the real ticket set audits without a false cycle, with the frontier containing every unblocked ticket and the count of changed readings stated | `node skills/to-tickets/scripts/audit-ticket-contracts.mjs .scratch/change-evaluation-gate/issues --contract .scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md` | Yes — the defect is only observable against the tickets that triggered it |

Frontend build and browser evidence are inapplicable; this slice changes a
repository audit script.

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

The audit's own fixtures write `## Blocked By` sections the way the audit
expects — a list of ids, or nothing — and never in the explanatory form every
real ticket in this repository uses. And the cycle it reported was accepted for
months as a fact about the tickets rather than a fact about the parser,
because its message named no ticket that anyone could go and read.
