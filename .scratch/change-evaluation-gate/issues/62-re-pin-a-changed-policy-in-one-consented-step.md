# TB-062 — Re-pin a changed policy in one consented step

Status: done
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: done, enhancement
Blocked by:
Tracker ID: 62-re-pin-a-changed-policy-in-one-consented-step
Draft key: TB-062

**Status:** done

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer who changed the Gate policy brings the clone into line with one
previewed, confirmed command that keeps the adapters they already have. The
preview shows what the policy was, what it is now, and whether the new one is
weaker than the one that authorized it — and the confirmation is the
hash-bound approval the SRS already requires and nothing has ever asked for.

## SRS Traceability

- `FR-CFG-005`, `FR-LIFE-004`, `FR-LIFE-006`, `FR-LIFE-019`
- `AC-CFG-003`, `AC-LIFE-009`, `AC-LIFE-010`
- `SG-CFG-001`, `SG-LIFE-001`, `SG-TRUST-001`
- `NFR-OPER-001`, `NFR-SEC-004`
- `RISK-005`

## Defect this contract fixes

Two things, one of which is a convenience and one of which is a safeguard
that has never run.

### The convenience

Every policy change on a real project this month — five of them — took the
same four commands:

```
gate deactivate                                  → token
gate deactivate --confirm sha256:…
gate activate --client cursor                    → token
gate activate --client cursor --confirm sha256:…
```

Because the receipt pins the configuration identity, any edit to
`.agent-framework.yaml` makes the next evaluation deny with `integrity-drift`
(`trusted-configuration`), and the only way to pin the new policy is to
withdraw the activation and perform a new one. `TB-053` made the printed
lines complete, so the four commands can at least be pasted. They are still
four commands, two of them withdrawing registrations that the next two put
back byte-for-byte.

### The safeguard

`FR-CFG-005`: *"A candidate policy-surface change shall be evaluated against
the prior Trusted gate configuration, validated as a candidate, explicitly
approved by candidate hash, and satisfy both policies where they differ before
becoming trusted."* `SG-CFG-001`: *"A candidate snapshot must never weaken the
policy used to authorize its own transition."*

Verified: `evaluatePolicyTransition({ trusted, candidate, checks, role,
approval })` in `security-control.mjs:376` implements this — validates the
candidate on its own terms, computes the outcome under each policy, and
reports every way the candidate is weaker than the trusted one (`:326-331`).

Verified: **no runner calls it.** The only caller outside its own module is
`gate-security-control-smoke`. So on every real project the transition is:
policy edited → evaluation denies as drift → maintainer runs the four commands
→ the new policy is pinned. Nothing between the edit and the pin ever asks
whether the new policy is weaker. A maintainer can turn a required check
advisory, raise the budget to a year, or disable every check, and the
deactivate/activate pair pins it with the same preview it would show for
tightening.

The approval half of `FR-CFG-005` is not missing either — the activation
confirmation token is already a content identity over the preview, which
includes the configuration identity. The token *is* the hash-bound approval.
It is just bound to a preview that never says the word "weaker".

Same shape as `TB-044`, `TB-045`, `TB-052`, `TB-059`, `TB-060`: built,
proved in isolation, reached by nothing.

## Domain decisions this contract settles

**`gate sync` is an Activation transaction.** `FR-LIFE-019` says recovery from
drift requires an explicit `gate repair` or Activation transaction. This is
the latter, scoped: it takes the adapter set from the existing receipt
(`observedAdapters`), previews and pins the current configuration, and
re-registers nothing that is already registered byte-for-byte. It goes through
the same ordered steps, the same self-tests, and enables authoritative Git
last. Nothing new is invented about how a clone becomes activated.

**The preview says what changed and whether it is weaker.** Trusted identity,
candidate identity, and the findings `evaluatePolicyTransition` produces for
the pair. The adapters it will keep. The token binds all of it. A maintainer
who confirms has approved a named weakening by its hash, which is exactly what
`FR-CFG-005` asks for and exactly what the four-command pair never made them
do.

**A weakening is refused by default and confirmable by name.** The preview
of a weaker candidate offers no token unless the invocation acknowledges the
weakening — the implementer chooses the selector and states it. This is the
same shape as every other refusal on the surface: nothing forces past a check,
but an operator can say, in the invocation, that they mean it. A candidate
that is not weaker needs nothing extra.

**Deactivate and activate stay.** `sync` is for a policy change under an
adapter set that stays. Adding or removing an adapter is still `activate` and
`deactivate`, and the preview of `sync` says so if the file and the receipt
disagree about anything other than the policy.

## Domain Concepts

Trusted configuration, Candidate configuration, Policy transition, Weakening,
Hash-bound approval, Activation transaction, Adapter set, Re-pin.

## Approach and Tradeoffs

Verified: `operateActivate` already resolves the clone, reads the
configuration, computes the preview with its identity, and drives the
transaction. `sync` is that with the adapter set read from the receipt
instead of a `--client` selector, and one more section in the preview.

Verified: the receipt carries `configuration.identity`; the file's identity is
what `describeActivation` computes. Those are the two sides of the
transition. The trusted *policy* for `evaluatePolicyTransition` needs the
receipt's pinned policy, not only its identity — the implementer establishes
whether the receipt carries enough to reconstruct it or whether the trusted
policy has to be read from the evidence store's last envelope, and states
what they found. If the receipt pins only the identity, that is a finding to
report: the SRS's "evaluated against the prior Trusted gate configuration"
needs the configuration, not its hash.

Proposed — make `evaluatePolicyTransition` reachable through `sync`'s
preview. `trusted` = the pinned policy, `candidate` = the file's, `checks` =
the configured checks, `role: 'operator'` or whatever the function accepts
for a non-evaluation caller. Its findings render in the preview under a
heading a maintainer cannot miss.

Proposed — refuse a weakening without acknowledgement. The refused preview
prints no token (`TB-053`'s rule for every refusal) and names the selector
that acknowledges. With it, the preview offers a token bound to the candidate
identity and the acknowledgement together.

Proposed — keep registrations that are already right. The transaction's
registration step observes each adapter surface; one that matches what it
would write is left as it is, one that has drifted is refused as `activate`
would refuse it today. The implementer confirms the hook block and the
adapter files are byte-identical before and after a `sync` that changed only
the policy.

Proposed — `gate status` names it. `TB-060` gives status a `next:` line and
says to name the deactivate/activate pair until this lands. This slice
updates that to `gate sync`.

Deliberately not changing `activate` or `deactivate`. Deliberately not
inferring an adapter set from anything but the receipt. Deliberately not
adding a way to skip the transition check, only a way to acknowledge its
result by name. Deliberately not the commit-time half of `FR-CFG-005` —
evaluating a commit that changes the policy under the *old* policy — which
is a separate seam in the runners and its own contract.

## Architecture Boundary and Public Seam

The boundary is between a policy a maintainer wrote and the policy the clone
enforces. The public seam is the `sync` command, its preview, and the
policy-transition findings that preview carries.

First red test: a clone whose policy was weakened since activation, asked to
`sync`, refuses with the weakening named and no token — where today the
deactivate/activate pair pins it without comment.

## Safeguards and Invariants

- `SG-CFG-001`, `AC-CFG-003`: a weaker candidate cannot become trusted
  without an explicit, hash-bound acknowledgement of the weakening.
- `FR-LIFE-004`: the preview shows exact changes and obtains repository-bound
  consent; the token binds trusted identity, candidate identity, adapter set,
  and any acknowledgement.
- `FR-LIFE-019`, `SG-LIFE-001`: this is an Activation transaction; nothing is
  repaired or re-pinned by observation.
- `AC-LIFE-009`: a failed `sync` leaves the clone exactly as it was — the
  prior receipt and registrations intact — never partially re-pinned.
- `SG-TRUST-001`: `sync` is a cooperative operator act; it resists no one and the limit statement stays on its output.
- `NFR-SEC-004`: the receipt after `sync` pins the candidate identity, and
  the next evaluation agrees.
- `NFR-OPER-001`: the preview says what changed and why a refusal happened.
- `activate` and `deactivate` are byte-identical to today.

## Prohibited Behavior and Non-goals

Do not weaken, skip, or add an override to the transition check beyond a
named acknowledgement. Do not infer the adapter set from anything but the
receipt. Do not re-register a surface that already matches. Do not leave a
clone with the old receipt withdrawn and the new one unpublished. Do not
change `activate`, `deactivate`, or their tokens. Do not touch the runners'
commit-time handling of a policy-changing commit.

## Risk and Decision Impacts

- `RISK-005`: migration and descriptor changes silently changing established
  behaviour. A re-pin that never asks "is this weaker" is that risk with a
  friendly command in front of it — and the four-command pair today is the
  same risk with an unfriendly one.
- No safeguard is withdrawn; one is enforced for the first time on a real
  path.

## Acceptance Criteria

- [x] `FR-LIFE-004`, `AC-LIFE-010`: on an activated clone whose policy changed,
  `gate sync` previews trusted and candidate identities and the adapter set it
  keeps, and one confirmation pins the candidate — proved by a following
  commit being evaluated under it with no drift.
- [x] `SG-CFG-001`, `AC-CFG-003`: a candidate that weakens the trusted policy
  is refused with the weakening named and no token; with the acknowledgement
  selector the token binds candidate identity and acknowledgement together.
  (The selector is `--acknowledge-weakening`, a flag: the weakening it
  acknowledges is named by the preview and bound by the token. The same token
  without the flag, or after another edit, pins nothing.)
- [x] A candidate that is not weaker previews and confirms with no extra
  selector.
- [x] The hook block and every adapter registration file are byte-identical
  before and after a `sync` that changed only the policy.
- [x] `AC-LIFE-009`: a `sync` that fails at any step leaves the prior receipt
  and registrations intact, proved by a fixture that fails a self-test.
- [x] `activate` and `deactivate` produce byte-identical output and tokens to
  today, proved by the existing fixtures unchanged.
- [x] If the file and the receipt disagree about adapters, `sync` refuses and
  names `activate`/`deactivate`. (The configuration file declares no adapters;
  what can disagree with the receipt is the adapter set the installed gate
  declares under the receipt's ids — `observedAdapters` — and that is what
  refuses as `adapter-set-changed`.)
- [x] `gate status` (`TB-060`) names `gate sync` as the remedy for
  configuration drift. (`trusted-configuration` and `command-descriptors`
  drift both map to `gate sync`: both are pinned from `.agent-framework.yaml`
  and a sync re-pins both. Where a clone also needs a new Activation
  transaction, `next:` names only the deactivate/activate pair.)
- [x] The report states whether the receipt carries enough to reconstruct the
  trusted policy, or where it was read from instead. (It does not: an
  activation receipt pins `configuration.identity` and the schema version
  only, and no Evidence envelope carries the policy either. `gate sync` reads
  the trusted policy from a document that reproduces the pinned identity — the
  receipt itself when a sync wrote it, since a sync now pins the policy beside
  its identity; the configuration file when its identity never moved; or the
  committed `.agent-framework.yaml` at `HEAD` — and refuses as
  `trusted-configuration-unrecoverable` when none does.)

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `SG-CFG-001`, `AC-CFG-003`, `FR-LIFE-004`, `AC-LIFE-009`: weakening-refused, acknowledged-weakening-bound, not-weaker-confirms, registrations-unchanged, failure-leaves-prior-receipt, adapter-disagreement-refuses, activate-deactivate-unchanged fixtures against the real operator surface and activation | `npm run test:unit` | Yes — the unit suite owns the operator surface and the activation transaction |
| smoke | both | `AC-LIFE-010`, `NFR-SEC-004`, `FR-LIFE-019`: on a real activated clone, edit the policy, `sync`, and the next real commit is evaluated under the new policy with no drift; weaken it, `sync` refuses; acknowledge, it pins; the hook file is byte-identical throughout | `gate-lifecycle-smoke` and `gate-security-control-smoke`, extended by this slice | Yes — the transition is only observable across real activations and real commits |

Frontend build and browser evidence are inapplicable; this slice adds one
operator command over the existing activation transaction.

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

`evaluatePolicyTransition` is exercised thoroughly by its own smoke, with
policies the fixture supplies, and it reports weakening correctly every time.
No fixture has ever changed a policy on an activated clone and then re-pinned
it, because the only way to re-pin was two commands that no fixture chains —
and neither of them was ever supposed to be the place a transition is judged.
The gap was in reachability, and the four-command workaround hid it by
looking like a procedure rather than a defect.
