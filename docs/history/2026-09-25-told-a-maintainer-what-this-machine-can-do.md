# Told a maintainer what this machine can do

Delivered TB-063. Every environment question the Gate asks lived inside an
operation that also did something: runner resolution inside activation, the clone
probe inside a capture, Sensitive input resolution inside the Evidence store, and
hook-chain validation inside activation. A maintainer on a machine that differed
from the author's learned it from a paused activation or a denied commit.

- Added `gate doctor`, which asks those questions read-only, each through the
  seam that already answers it. The activation refusals it predicts became three
  small functions that activation itself calls, so the two share one
  implementation.
- Reported runners, dependency-root provisioning (clone, byte copy, or link),
  Sensitive input names and sources, environment-file statuses, and hook-chain
  validity — never a value.
- Ended with one verdict: activation would proceed past every step doctor can
  see, or the first step and reason code that stops it. A confirmed activation
  then stops at that same step for the same reason.
- Listed consent, trust, self-test, receipt, and Git enablement as answered by
  activation rather than simulating them, and withheld the preview identity
  because it is the confirmation token.
- Opened no Evidence store and wrote nothing under the clone; its only footprint
  is a probe directory under the temporary directory, which it removes. Exit
  status is 0 proceeds, 1 would stop, 2 could not run.

Evidence added: unit tests for an unresolved runner, a matching receipt pin, the
copy prediction, link capability, a foreign hook, secret absence, and a
byte-identical clone afterwards; a `doctor-then-activate` smoke scenario; and an
agreement check in `gate-runtime-portability`. A follow-up removed an intermittent
test failure: two separate free-space probes cannot be compared under concurrent
disk activity, so tests now compare predictions given the same probe input.

Limits: doctor inspects the default Git activation only, cannot see a copy that
fails part way through a real tree, and may under-report cloning under concurrent
disk activity, falling back to the correct but slower byte copy. SRS 0.2.15
records it.
