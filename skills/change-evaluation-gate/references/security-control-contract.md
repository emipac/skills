# Security control contract

The Change Evaluation Gate protects three things that a change could otherwise
turn against the evidence judging it: the policy that authorizes a transition,
the Sensitive values a check needs at runtime, and the identity of the Gate
control surface itself.

All three rest on one premise, stated once here and never softened elsewhere.

## Trust boundary (`ASM-001`, `SG-TRUST-001`, `RISK-001`)

The Gate is a **cooperative local process** running with the machine owner's own
permissions. It reads what the machine reports and compares it against what the
Activation receipt pinned.

`TRUST_BOUNDARY` in `scripts/lib/security-control.mjs` states this as data, and
every reconciliation result carries the statement with it:

> The Change Evaluation Gate is a cooperative local process running with the
> machine owner's own permissions. Control-surface reconciliation reports what
> changed; it does not resist the machine owner, and it is neither tamper-proof
> nor a sandbox.

Consequences the implementation is held to:

- Drift **detection** is not drift **resistance**. Detecting that a hook block
  changed says nothing about preventing the change.
- No Evidence is encrypted, no execution is contained, and no hostile code is
  isolated. Snapshot materialization is isolation from accidental interference.
- `tests/gate-security-control.test.mjs` scans every `.mjs`, `.md`, and `.yaml`
  file under `skills/change-evaluation-gate/` and fails on any line that claims
  one of these properties without denying it on the same line. Detection words
  (`tampered`, `tampering`) are deliberately not claims.

## Protected policy transitions (`FR-CFG-005`, `AC-CFG-003`, `SG-CFG-001`)

A change that edits the Gate control surface is graded under **two** policies.

| Policy | Where it comes from | What it decides |
| --- | --- | --- |
| Trusted | the prior approved Gate configuration | whether the change may be authorized at all |
| Candidate | the configuration the change proposes | whether the proposal is itself satisfied |

`evaluatePolicyTransition({ trusted, candidate, checks, role, approval })`
returns one result:

1. The candidate is validated **as a candidate** with `validateGatePolicy`.
   Invalid configuration is `candidate-policy-invalid` and `unverified`.
2. Both policies are bound over the same completed check results. The transition
   outcome is the **stricter** of the two.
3. Trust advances only when the Trusted policy passes, the candidate policy
   passes, and an approval names the exact candidate content hash.

Refusal reasons, in the order they are reported:

`candidate-policy-invalid` → `trusted-policy-unsatisfied` →
`candidate-policy-unsatisfied` → `approval-missing` → `approval-mismatch`.

`policyWeakenings` names what the candidate relaxed
(`required-check-removed`, `required-check-demoted`). That list is
**diagnostic**. It is not what protects the transition — the protection is that
the Trusted policy decides the outcome regardless of what the candidate says
about itself. A candidate that removes the one required check the change fails
therefore passes its own policy and still cannot authorize anything.

## Sensitive runtime inputs (`FR-CFG-006`, `AC-CFG-004`, `SG-SECRET-001`)

`materializeRuntimeInputs({ approved, inputs, executionRoot })`:

- **Approval** is the list of names the Activation receipt pinned. An input the
  operator did not confirm at activation is refused by name
  (`runtime-input-unapproved`), and neither its value nor any derived form of it
  is read, copied, or reported.
- **Copy** is temporary and isolated: each approved value is written to
  `<executionRoot>/.change-evaluation-gate-runtime-inputs/<NAME>` with mode
  `0600` and offered to the check process through the returned `environment`.
- **Record** is name and source only. That is what a receipt, a decision, an
  envelope, or a Lifecycle event may carry.
- **Removal** is `release()`, bounded to the one directory this call created
  inside the execution root.

The module never reads an ambient environment, a credential store, a key file,
or a developer's configuration. Values arrive from the caller that resolved
them. Redaction at the persistence boundary (`redaction.mjs`,
`evidence-store.mjs`) remains the guard that proves absence before anything is
written; a value that survives redaction is `unsafe-capture` and the decision
becomes `sensitive-capture-unsafe` / `unverified`.

## Gate control-surface drift (`NFR-SEC-004`, `AC-SEC-001`)

`CONTROL_SURFACES` is the closed set the Activation receipt pins:

`runtime`, `adapters`, `managed-hooks`, `receipt`, `trusted-configuration`,
`command-descriptors`, `providers`.

`reconcileControlSurface({ receipt, observed, role, graderSurfaces })` compares
the pinned identity of each surface against the observed one. Independent drift
of any of them is `authoritative` severity:

- `gate status` reports `broken` (`lifecycle.mjs`, `controlSurface` input).
- An authoritative evaluation carries the `integrity-drift` diagnostic, which
  normalizes the decision to `unverified` and the authorization to `deny`
  (`evaluate.mjs`, `controlSurface` dependency). The check results themselves
  are never rewritten.
- Nothing is repaired. Reconciliation opens no file for writing, appends no
  event, and returns `repaired: false` with no mutations. Recovery stays a
  confirmed operator action (`FR-LIFE-019`, `SG-LIFE-001`).

### Grader changes are visibility, not accusation

A change that edits a declared Grader surface — tests, a verification script, a
provider, the Gate configuration — is reported in full through
`visibleGraderSurfaces`. Reporting it classifies nothing and nobody:
`classification` is always `none`. A control-surface **edit inside the proposed
change** sets `policyTransitionRequired` and takes the dual-policy path above;
that is a stricter route, not a judgement, and it is a different thing from
independent drift of the machine.

## Prohibited

- Single-policy self-approval of a policy-surface change.
- Persisting a raw Sensitive value in configuration, decisions, envelopes,
  blobs, or Lifecycle events.
- Automatic drift repair.
- Blanket malicious classification of Grader changes.
- Never claiming encryption, never claiming containment, and never claiming
  resistance to the machine owner.

## Capability

`gate-security-control-smoke` proves all three packaged behaviors against
throwaway Git repositories under the OS temporary directory, a real Evidence
store, a real child-process check, and a real isolated materialization. Its
canaries are synthetic literals invented for the fixture.
