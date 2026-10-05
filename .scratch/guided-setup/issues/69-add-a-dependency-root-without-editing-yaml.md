# TB-069 — Add a dependency root without editing YAML

Status: done
Parent: guided-setup-feature-spec
Assignee:
Labels: done, enhancement
Blocked by: 67-name-the-next-step-without-a-terminal
Tracker ID: 69-add-a-dependency-root-without-editing-yaml
Draft key: TB-069

**Status:** done

**Parent feature contract:** `.scratch/guided-setup/issues/guided-setup-feature-spec.md`

## Outcome

A maintainer adds or removes a dependency root, sets its provisioning, or
changes the budget-skippable checks with one named Framework command. They see
the exact file change, confirm it with the preview's token, and — on an
activated clone — land directly in the `gate sync` preview for that change.
Every byte outside the Gate configuration section stays as it was. This slice
creates the revision operation the other configuration edits reuse.

## SRS Traceability

- `FR-GUIDE-006`, `NFR-REL-004`
- `AC-GUIDE-003`
- `SG-GUIDE-001`, `SG-OWNER-001`, `SG-CFG-001`
- `RISK-012`, `RISK-008`

## Domain Concepts

Gate configuration section, Trusted gate configuration, Candidate, Activation
transaction, Gate policy.

## Approach and Tradeoffs

- Verified: `configureGate` refuses a clone whose Gate is already configured
  (`The Gate is already configured`), so no operation revises an existing
  section today.
- Verified: `configure-gate` validates a policy by dynamically loading the Gate
  policy validator, and renders the section as one flow-JSON line per
  subcontract.
- Verified: the Gate policy validator rejects a `dependency_provisioning` key
  for a root `dependency_roots` does not list, and reserves
  `allowed_environment` for Verification profile commands.
- Proposed: a new previewed, hash-bound revision operation in `framework-setup`
  — the configuration file's owner — takes the current section, applies one
  named change, validates the candidate with the same validator, and previews
  the exact before and after. The Framework command's `config` subcommands only
  drive it (ADR 0004).
- Proposed: the writer refuses a section it cannot locate unambiguously or
  round-trip, rather than normalizing a hand-edited section.
- Tradeoff: a revision on an activated clone is two consents — the file change,
  then the `gate sync` re-pin — because they are two owning operations. The
  Framework command chains them so the maintainer never looks up the second.

## Architecture Boundary and Public Seam

The revision operation in `framework-setup` and the Framework command's
`config` subcommands. Public seam: the subcommands run as child processes, plus
the revision operation invoked directly for the `NFR-REL-004` comparison. First
red test: adding `vendor` with `copy` provisioning to a configured fixture
previews exactly one changed line in the Gate section and offers a token —
today there is no command to do it.

## Safeguards and Invariants

- `SG-GUIDE-001`: nothing is written without the preview's token.
- `SG-OWNER-001`: only `execution` entries in this slice; Verification profile
  commands are untouched.
- `SG-CFG-001`: the chained `gate sync` preview reports any weakening exactly as
  a direct `gate sync` would.

## Prohibited Behavior and Non-goals

- No evidence, checks, budget, or bypass edits (`TB-070`).
- No proposals (`TB-071`).
- No re-pin performed by this slice: the chain ends at the `gate sync` preview
  and its own confirmation.

## Risk and Decision Impacts

- `RISK-012`: a byte comparison of everything outside the section on every
  fixture, including one with maintainer comments around the section.
- `RISK-008`: unchanged detection, reached through `gate sync`.

## Acceptance Criteria

- [x] `AC-GUIDE-003` (revision half, execution): add and remove a root, set its
  provisioning, and change budget-skippable checks — each previews the exact
  change, refuses an invalid candidate with the validator's own reason, writes
  only with its token, and leaves every byte outside the section identical.
- [x] On an activated fixture the confirmed revision continues into the
  `gate sync` preview for exactly that candidate.
- [x] `NFR-REL-004`: the file a revision writes equals the file produced by
  applying the same change and `configure-gate`'s rendering directly.
- [x] A hand-edited section the writer cannot round-trip is refused with
  nothing written.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-GUIDE-003`, `NFR-REL-004`, `SG-GUIDE-001`, `RISK-012`: add, remove, provisioning, skippable, invalid, untouched-bytes, comments, unround-trippable, and activated-chains-to-sync fixtures | `npm run test:unit` | Yes — every rule is observable at the command |
| smoke | both | `SG-CFG-001`: on a real activated clone, add a root, confirm, follow the chained `gate sync`, and a commit is then graded with the root provided | `gate-activation-smoke`, extended by this slice | Yes — the chain is user-facing and crosses two real operations |

Frontend build and browser evidence are inapplicable.

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
