# TB-049 — Read the policy the file actually contains

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 49-read-the-policy-the-file-actually-contains
Draft key: TB-049

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

The configuration reader returns the values the file holds, or refuses. It never
returns a value the file does not contain, because everything downstream —
policy, drift detection, the identity the receipt pins — treats what it returns
as what the maintainer wrote.

## SRS Traceability

- `FR-CFG-001`, `FR-CFG-002`
- `AC-CFG-001`, `AC-CFG-004`
- `SG-CFG-001`, `SG-SECRET-001`
- `NFR-SEC-004`, `NFR-REL-001`
- `RISK-005`

## Defect this contract fixes

Raised by an external audit and reproduced. `readScalar` in
`configuration.mjs:54` finds a quoted value's closing quote with `lastIndexOf`,
which searches backwards from the end of the line and therefore walks past the
value into a trailing comment:

```
input   note: "keep this" # do not use "that"
parsed  { note: "keep this\" # do not use \"that" }

input   note: 'keep this' # do not use 'that'
parsed  { note: "keep this' # do not use 'that" }
```

It does not refuse. It returns success with a value the file does not contain.

That is precisely what the module's own header says it exists to prevent — a
reader "that silently accepted a construction it does not model would hand its
caller a configuration the file does not contain, which is the failure this
module exists to end." The intent is right and the implementation contradicts it.

Why it matters beyond a wrong string: this is the file the Gate policy is read
from, and `configurationIdentity` hashes the parsed result. A corrupted reading
hashes consistently, so the pinned identity, the control-surface reconciliation,
and every drift check agree with each other about a policy the maintainer never
wrote. The mechanism designed to notice a changed policy cannot notice a
misread one.

The audit reports a second, related inconsistency in the same function: comment
stripping is applied when detecting a flow collection but not when parsing one,
so `roots: ["vendor"]` parses while `roots: ["vendor"] # deps` is refused as
outside the supported subset. The implementer establishes this themselves before
fixing it, rather than trusting this description.

## Domain decisions this contract settles

**No new runtime dependency.** The audit's headline suggestion is to replace the
hand-written reader with a YAML library. That is rejected: this skill is
installed standalone into arbitrary projects, and a runtime dependency in an
installed skill is a distribution cost paid by every consumer to fix a bounded
parsing bug. The audit's own alternative is the fix — scan a quoted value
forward for its closing quote rather than backward from the end of the line.

The no-dependency stance is not being defended in general here; it is being kept
for this change, because the change does not need it.

## Domain Concepts

Configuration document, Quoted scalar, Trailing comment, Flow collection,
Supported subset, Configuration identity.

## Approach and Tradeoffs

Verified: `readScalar` already refuses several constructions, and already
distinguishes a quoted scalar from an unquoted one on the grounds that only an
unquoted scalar can carry a trailing comment. The intent and the shape are
correct; the search direction is not.

Verified: after finding a closing quote the function already checks that any
trailing text starts with `#` and refuses otherwise. That check is sound and
becomes load-bearing once the closing quote is found correctly.

Proposed — scan forward for the closing quote. Walk the value from its opening
quote to the first unescaped closing quote of the same kind, then let the
existing trailing-text check do its job. The implementer confirms the escape
handling the double-quoted branch already performs still applies, and that a
single-quoted value keeps every character inside its quotes.

Proposed — refuse rather than guess, still. A value whose quote never closes is
already refused and stays refused. Nothing in this slice makes the reader accept
more than it does today except the case it was always meant to accept: a quoted
value followed by a comment.

Proposed — settle the flow-collection inconsistency in the same slice, because
it is the same question asked in two places. The implementer establishes what
detection and parsing each do with a trailing comment and makes them agree, or
reports that the audit's claim does not hold.

Proposed — prove it where it is load-bearing. A test that the reader returns the
right string is necessary but weak. Prove also that two documents differing only
inside a trailing comment produce the *same* configuration identity, and that
two differing in the value itself produce different ones. That is the property
drift detection rests on.

Deliberately not a YAML library, and deliberately not a widening of the
supported subset. Nothing that the reader refuses today starts being accepted,
except a correctly-closed quoted value followed by a comment.

## Architecture Boundary and Public Seam

The boundary is between what a maintainer wrote in `.agent-framework.yaml` and
what every consumer of the parsed configuration believes they wrote. The public
seam is `readScalar` and the parse result it returns.

First red test: a quoted value followed by a comment containing a quote character
parses to exactly the quoted value, where today it parses to the value plus the
comment.

## Safeguards and Invariants

- `SG-CFG-001`: the policy used to authorize a change is the policy the file
  holds. A misread policy is a weakened policy nobody approved.
- `NFR-SEC-004`: the configuration identity keeps its meaning — two documents
  with the same policy hash the same, two with different policies do not.
- `AC-CFG-001`: an absent `evaluation_gate` still means not configured, and the
  five-subcontract shape is unchanged.
- `SG-SECRET-001`: nothing in this slice puts a value anywhere new; the reader
  still returns names and structure only.
- `NFR-REL-001`: a document that parses today parses to the same result
  tomorrow, unless it is one of the constructions this slice corrects.
- The supported subset is unchanged apart from the corrected cases.

## Prohibited Behavior and Non-goals

Do not add a YAML library or any other runtime dependency. Do not widen the
supported configuration subset. Do not make the reader accept a construction it
refuses today, other than a correctly-closed quoted value followed by a comment.
Do not change the schema, the policy shape, or what a valid `evaluation_gate`
section contains. Do not change how the configuration identity is derived. Do
not rewrite the module.

## Risk and Decision Impacts

- `RISK-005`: migration and descriptor changes must not silently change
  established verification behavior. A reader that returns something other than
  the file is that risk realized in the quietest possible way.
- No disposition changes. Every policy rule, budget, and binding keeps its
  meaning; what changes is that the reader reports it correctly.

## Acceptance Criteria

- [ ] `AC-CFG-001`: a double-quoted value followed by a comment containing a
  double quote parses to exactly the quoted value, and an absent
  `evaluation_gate` section still means not configured.
- [ ] A single-quoted value followed by a comment containing an apostrophe
  parses to exactly the quoted value.
- [ ] A quoted value whose quote never closes is still refused, and a quoted
  value followed by text that is not a comment is still refused.
- [ ] `NFR-SEC-004`: two documents differing only inside a trailing comment
  produce the same configuration identity; two differing in a value produce
  different ones.
- [ ] The flow-collection inconsistency is settled — detection and parsing agree
  about a trailing comment — or the report states that the claim did not hold
  and why.
- [ ] `AC-CFG-004`: an activated clone whose configuration carries a commented
  quoted value pins the identity of what the file holds, and no Sensitive value
  reaches configuration or Evidence through this path.
- [ ] Every document the reader accepts today still parses to the same result,
  proved against the existing configuration fixtures.
- [ ] No runtime dependency is added.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-001`, `NFR-SEC-004`: quoted-then-comment, unclosed-quote, unreadable-trailing-text, flow-collection, and identity-stability fixtures against the real reader | `npm run test:unit` | Yes — the unit suite owns configuration parsing |
| smoke | both | `AC-CFG-004`: a real activated clone whose configuration carries a commented quoted value pins the identity of what the file holds, and commits exactly as it does without the comment | `gate-activation-smoke`, extended by this slice | Yes — that capability already pins a real receipt against a real configuration |

Frontend build and browser evidence are inapplicable; this slice changes local
configuration parsing.

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

Every configuration fixture is written to exercise a policy, so its values are
the plain ones a generator emits — no fixture carries a comment beside a quoted
value, because nothing that writes these files produces one. The corrupted
reading only appears in a document a human edited by hand, which is exactly the
document the reader exists to read and the one the suite has never had.
