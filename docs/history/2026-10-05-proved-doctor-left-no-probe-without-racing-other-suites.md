# Proved doctor left no probe without racing other suites

Delivered TB-075, a test-only defect in `tests/gate-doctor-command.test.mjs`.
The test proving `gate doctor` leaves nothing behind listed every
`gate-doctor-probe-*` directory in the shared system temporary directory before
its runs and required the same listing afterwards. `node --test` runs test files
in parallel and other files run real doctor probes there, so the listing could
change under it; the full suite failed on it intermittently.

- Gave the test's doctor runs a temporary directory of their own. A new helper,
  `probesLeftInPrivateTemporary`, points `TMPDIR` at a fresh directory for the
  duration of the runs, restores the shared value afterwards, and lists the
  `gate-doctor-probe-*` entries left in the private directory; the footprint
  assertion now requires that list to be empty. A probe doctor leaves
  unreported still lands there, so the guard is no weaker. Assertions confined
  to the reported probe directories were rejected: in a shared directory a
  leaked, unreported probe cannot be told apart from another suite's live one.
- Checked both premises by running them: `os.tmpdir()` re-reads `TMPDIR` on
  every call (and unsetting it yields `/tmp`, not the original, so the saved
  value is restored), and `node --test` runs each file in its own process and
  the tests within a file one at a time. The in-process change to `TMPDIR` is
  therefore seen only by this test.
- Added the induced-race fixture as a test: a separate process creates a
  `gate-doctor-probe-*` directory in the shared temporary directory and holds
  it while doctor runs. Written first against the old assertion, it failed; it
  now asserts the shared listing did change and the private one is clean.
- Added the leak fixture as a test: a second, unreported probe made where
  doctor makes its own passes the reported probe's assertions and fails the
  footprint assertion. Injecting the same leak into the footprint test itself,
  once and reverted, failed it.

Scope held: no change to `gate doctor`, the probe, its prefix, or the sweep; no
serialised suite and no retry. The clone, `.git`, and store byte-identity
assertions are unchanged.

Verification: `npm run test:unit` passed 20 consecutive runs (749 passing, 0
failing, 1 skipped each; 747 before the two new tests). `npm run test:install`
passes; `npm run validate` reports only the pre-existing frontmatter errors in
the uncommitted `skills/implement/SKILL.md`.

Limits. The private directory relies on the tests within this file running one
at a time; a `concurrency` option added to this file would need the helper
revisited. `gate-activation-smoke`'s `selfTestSubjects` compares a shared
temporary-directory listing of `gate-hook-program-self-test-*` the same way; it
is a smoke capability outside the unit suite and was left unchanged.
