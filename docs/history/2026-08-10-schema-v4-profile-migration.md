# Schema v4 verification profile migration

Expanded the shared framework configuration without introducing a frontend or
activating the Change Evaluation Gate.

- Fixed verification planning so configured profile presence controls shared,
  tied, and unmatched file impact, and `frontend: none` never creates frontend
  build work.
- Added a separate schema v4 contract with symmetric backend/frontend `none`,
  tooling-only support, and OS-independent Command descriptors.
- Added a read-only migration preview, explicit ambiguity mappings, exact-hash
  confirmation, inactive-profile rejection, and atomic installation.
- Kept schema v3 readable and left ordinary setup generation on schema v3.
- Added regression coverage for backend-only, frontend-only, full-stack,
  tooling-only, ambiguous, inactive-profile, stale-confirmation, and CLI flows.

Verification: focused Node test suites, full unit and install tests, repository
validation, delivery-contract audits, and diff checks.
