# Claimed only what the Gate does today

Delivered TB-051. An external audit found six subsystems implemented,
unit-tested, documented, and reachable from no entry point, and recommended
deleting them. That recommendation was rejected and the reason recorded beside
the code: four earlier slices had connected complete subsystems nothing could
invoke, and deletion forecloses that. The defect was never that the code exists;
it was that the skill described three of those subsystems as working.

- Corrected each claim where it was made:
  - **Coordination.** Neither runner passes the coordination seam, so every
    evaluation is a single-client Gate that serializes nothing, and `gate locks`
    inspects a lock no evaluation acquires.
  - **Delivery contracts.** Neither runner passes a contract reference, so every
    decision is regression-only with empty acceptance coverage.
  - **Runtime binding.** No runner binds a resolver, so a served-source check is
    `unverified` on every run.
- Recorded the decision in the SRS revision history as 0.2.8, whose header had
  drifted behind its own 0.2.7 row, and in notes on the two reference contracts
  that describe the subsystems.

Scope held: no requirement text changed, no file under `scripts/lib/` changed,
and bypass was left to TB-052.
