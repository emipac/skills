# Stack-neutral Verification check descriptors

Delivered TB-003 as the provider-to-evaluation seam of the Change Evaluation
Gate module.

- Defined provider check descriptor contract version 1 with stable identity,
  stage, capability, scope, applicability, prerequisites, policy binding,
  non-mutating evaluation command, optional fix command, timeout, declared
  writes, evidence claims, deterministic test selection, and stable order.
- Kept the eight ordered Evidence ladder stages owned by `verify-change` and
  imported them instead of restating them in the Gate.
- Normalized exactly four outcomes and kept `required` and `advisory` as policy
  bindings rather than outcomes.
- Allowed a provider to add a capability name without a gate-core branch while
  a new stage or changed outcome semantics requires a contract-version change.
- Added a Laravel provider mapping confirmed Pint, Rector dry-run,
  PHPStan/Larastan application and test analysis, Pest focused, affected, and
  broad suites, smoke, build, and browser commands to distinct evidence claims,
  and merged application and test claims when one analysis already covers both.
- Added a reference `node-package` provider proving a second stack reaches the
  same contract with no gate-core change.
- Made unproved commands and non-deterministic test selection visible capability
  gaps instead of guessed descriptors; test relevance is never inferred from a
  filename.
- Enforced shell-free command descriptors, settled logical runners, declared
  `repository-script` Grader surfaces, and activation-time executable
  resolution, versioning, pinning, and preview without shell lookup.

Scope held: no snapshot evaluation, policy engine, evidence persistence,
activation transaction, or client adapters.

Verification: `npm run test:unit` (111 passing), `npm run validate`, and
`npm run test:install`.
