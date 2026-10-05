# Handed a check the secret the receipt approved

Delivered TB-059. The first real Laravel suite to boot inside the snapshot failed
38 of 40 tests on a missing application key: `APP_KEY` lives in git-ignored
`.env`, the snapshot holds tracked content, and the stock `phpunit.xml` leaves
the key out by design. The materializer built for this was reached by nothing,
the redactor read only the process environment, and a check received only the
variables its descriptor allowed — none, on every generated descriptor.

- Added `evaluation_gate.evidence.environment_files`, declaring
  repository-relative files beside `sensitive_inputs`.
- Resolved approved names before the Evidence store opens, so the redactor is
  armed before the first write: each name is read from the runner's environment
  first, then from the declared files in order. A file is opened only while a
  name is still unresolved, and a line for an unapproved name is skipped without
  decoding its value.
- Handed the resolved values to the check through an owner-only file inside the
  execution root. Approved inputs are merged after ambient pass-through, so a
  descriptor allowing nothing still receives what activation approved and
  nothing it did not list. The environment file itself is never copied.
- Reported a declared file that is tracked, missing, or unreadable in status, by
  name only.
- Made `framework-setup` write `sensitive_inputs: ["APP_KEY"]` and
  `environment_files: [".env"]` for the Laravel profile only; repeat drafts stay
  byte-identical, and no variable name, file name, or framework branch entered
  Gate core.

Proved: without the change the fixture's check cannot boot and the commit is
denied; with it, it boots. The value and a decoy in the same file are absent from
every stored byte in raw, base64, base64url, hex, and URL-encoded form, and the
decoy is never resolved. The owner-only file is gone after a normal run and after
an interrupted one.
