# Aligned Gate policy validation

Closed the configuration-to-activation compatibility gap where framework setup
accepted a Gate policy that the authoritative runtime rejected.

- Made Gate configuration previews apply the runtime policy validator after
  setup-owned structural and command-ownership checks.
- Required an explicit `bypass.enabled` value in the documented starter policy.
- Clarified that empty check bindings are configuration-valid but do not make
  any Verification check blocking.
- Refused invalid repository policy before Activation can issue a `previewId`
  that a maintainer could confirm.
- Added cross-module regression coverage for the documented policy, setup
  output, runtime validation, and Activation preview boundary.

Verification: focused configuration and Activation tests, Activation smoke,
the full unit suite, isolated install smoke, and repository validation.
