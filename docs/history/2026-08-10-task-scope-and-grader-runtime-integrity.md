# Task scope and Grader runtime integrity

Delivered TB-006 as the honesty layer of the Change Evaluation Gate decision:
what an evaluation may claim, what it changed about the things that judge it,
and whether served evidence belongs to the snapshot it names.

- Resolved Evaluation scope from the repository-owned delivery contract read
  inside the materialized snapshot. A missing, unresolvable, or acceptance-free
  contract degrades to `regression-only` and records the limitation; only a
  valid contract may claim task acceptance.
- Made `SG-SCOPE-001` a decision-contract invariant: a `regression-only`
  decision carries no acceptance coverage, no acceptance-linked assertion, and
  at least one stated limitation.
- Gave every Check assertion an `acceptance` or `regression` kind, resolved
  acceptance assertions against the contract's stable acceptance IDs, and made
  unproved requested criteria explicit `acceptanceGaps`.
- Guaranteed that every applicable check reports at least one Check assertion,
  falling back to its stable check identity when it declares no claim.
- Reported changed Grader surfaces — declared tests, `repository-script`
  verification scripts, provider sources, and Gate configuration — each bound to
  the content actually evaluated, with control-surface changes made visible
  without classifying them as malicious.
- Bound runner, provider, configuration, environment, and snapshot identities
  into decision integrity.
- Proved served-source binding for `smoke` and `browser` evidence by comparing
  declared probes served by the project's existing local runtime against the
  materialized snapshot byte for byte. An unproved binding is `unverified` and
  the check never runs; a runtime serving the live worktree, an unreachable
  runtime, a runtime with no declared probe, and a missing runtime all deny.
- Added the `gate-runtime-binding-smoke` capability, which exercises that
  binding against a real loopback HTTP runtime offline and non-interactively.

Scope held: no `gate fix`, evidence persistence, coordination, activation, or
the dual-policy trusted-versus-candidate configuration transition. This slice
reports a changed control surface; enforcing its transition remains TB-014.

Verification: `npm run test:unit` (139 passing), `npm run gate-runtime-binding-smoke`,
`npm run validate`, and `npm run test:install`.
