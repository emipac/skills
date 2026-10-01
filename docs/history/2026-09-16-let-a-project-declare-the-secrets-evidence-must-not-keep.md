# Let a project declare the secrets evidence must not keep

Delivered TB-045. Value-based redaction was built, tested, and reachable from no
real clone: the activation command passed an empty runtime-input list as a
literal, schema v4 had no surface to declare one, and every real activation
pinned an empty list — so only the built-in patterns protected anything. It was
the same hard-coded-empty defect as TB-044's prerequisites, one field over.

- Added `evaluation_gate.evidence.sensitive_inputs`, declaring
  environment-variable names, never values. It sits under `evidence` because it
  governs only what the Gate keeps; the five-subcontract shape is unchanged.
- Made the one production source of runtime inputs read the declaration, so the
  names reach the preview, the identity consent is granted against, and the
  receipt — names only, as `FR-CFG-006` requires.
- Armed the redactor with each declared name's value from the runner's
  environment. A declared name absent from the environment is neither an error
  nor a silent pass: the envelope records it as `redaction.unresolved`.
- Corrected the source label `approved-environment-file`, which claimed a copy
  that never happened, to `environment`.

Proved where it persists: a canary value printed bare and inside a stack frame,
matching no built-in pattern, leaves no raw, base64, hex, or URL-encoded form in
any envelope, blob, decision, event, receipt, or configuration. Two runs printing
the same declared value address one envelope, because redaction runs before the
identity is derived.

Recorded for the next contract: copying approved environment files into the
snapshot, which a stock Laravel suite needs to boot, was deliberately not built
here; TB-059 delivered it.
