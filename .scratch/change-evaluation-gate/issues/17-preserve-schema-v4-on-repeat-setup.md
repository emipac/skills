# TB-017 — Preserve schema v4 on a repeated setup run

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 17-preserve-schema-v4-on-repeat-setup
Draft key: TB-017

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

A maintainer who runs project setup again on a schema v4 repository keeps their
schema version, their Command descriptors, and their Gate policy, or is told
plainly why the run cannot proceed — and never silently loses them.

## SRS Traceability

- `FR-CFG-008`
- `AC-CFG-005`
- `SG-CFG-002`
- `RISK-005`, `Q-005`

## Defect this contract fixes

Reported from a real project that had migrated to schema v4 and configured Gate
policy. Running the default `framework-setup` configuration again rewrote
`.agent-framework.yaml` with **no preview and no confirmation**, and the
repository silently lost all three of:

| | Before the repeat run | After |
| --- | --- | --- |
| `schema_version` | 4 | 3 |
| `evaluation_gate` policy | present | removed |
| Command descriptors | `{"runner":"composer-bin","args":[…],"timeout_seconds":30,…}` | discarded |

`FR-CFG-008` requires `0.9.0` to **read** existing schema v3 and schema v4
configurations. The discovery path predates schema v4 and instead re-derives a
v3 contract from scratch, so a v4 repository is not read but replaced.

`SG-CFG-002` forbids modifying a repository's configuration without
confirmation and forbids changing Gate configuration as a side effect. The
repeat run does both. It is also a sharper failure than the ambiguity cases
that safeguard was written for, because those at least abort without writing.

The framework's stated idempotency guarantee — repeat runs are byte-identical —
holds only for schema v3. `tests/framework-setup.test.mjs` covers that case and
has no schema v4 equivalent, which is why this reached a user.

## Domain Concepts

Gate configuration section, Command descriptor, Verification profile, Source
scope, and Trusted gate configuration.

## Approach and Tradeoffs

Teach the default configuration path to recognise an existing schema v4
contract before it writes anything. A v4 repository is either preserved through
the same previewed, hash-confirmed transaction its migration and Gate
configuration already use, or refused with an exact reason — never rewritten
in place at a lower schema version.

Preferring refusal over silent conversion is deliberate: re-deriving a v4
contract from discovery would have to reconstruct timeouts and runner
resolutions the maintainer chose by hand, which is the guessing `SG-CFG-002`
exists to prevent.

## Architecture Boundary and Public Seam

The boundary is `framework-setup` configuration ownership. The public seam is
the default configuration command's result on a repository that is already at
schema v4. First red test: a repository at schema v4 with an `evaluation_gate`
policy and Command descriptors is put through a repeat default configuration
run, and the file is byte-identical afterwards.

## Safeguards and Invariants

- `SG-CFG-002`: setup never modifies an existing configuration without
  confirmation, never lowers a schema version, and never adds, alters, or
  removes Gate configuration as a side effect of discovery.

## Prohibited Behavior and Non-goals

Do not re-derive a schema v4 contract from discovery, reconstruct maintainer-chosen
timeouts or runner resolutions, convert v4 back to v3 under any flag, remove
`evaluation_gate` from a configuration the maintainer approved, or extend this
contract into activation or Gate policy semantics. Schema v3 repositories keep
their current behaviour unchanged.

## Risk and Decision Impacts

- `RISK-005`: this is that risk occurring. Schema v4 migration changed
  established verification behaviour — by discarding it — and the release
  evidence that was supposed to hold the risk closed did not cover a repeat
  setup run. Backward compatibility must be proved for repeated runs, not only
  for the migration itself.
- `Q-005`: unchanged. Schema v3 stays readable throughout `0.x`; this contract
  makes schema v4 equally readable rather than replaceable.

## Acceptance Criteria

- [ ] `AC-CFG-005`: a repeat default configuration run against a schema v4
  repository leaves `.agent-framework.yaml` byte-identical, including its
  `schema_version`, its Command descriptors, and any `evaluation_gate` policy;
  where the run cannot preserve the contract it refuses with an exact reason and
  writes nothing.
- [ ] `AC-CFG-005`: a schema v3 repository keeps its existing repeat-run
  behaviour, and the migration and Gate configuration paths continue to require
  their previewed hash confirmation.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-005`, `SG-CFG-002`: a schema v4 fixture carrying Command descriptors and an `evaluation_gate` policy survives a repeat configuration run byte-for-byte, and a refusal writes nothing | `npm run test:unit` | Yes — configured unit suite owns the setup configuration seam |
| broad-tests | both | `AC-CFG-005`: existing schema v3 discovery, idempotency, and protected-file behaviour remain unchanged | `npm run test:unit` | Yes — configured regression suite protects established setup behaviour |

Frontend build and browser evidence are inapplicable because the configured
frontend profile is `none` and this slice changes no frontend surface.

## Blocked By

None. `TB-001` delivered schema v4 and `TB-002` delivered the Gate
configuration section; both are done.

## Unresolved Assumptions

1. **Whether a v4 repeat run should refuse outright or offer a previewed
   no-op.** Refusing with an exact reason is the safer default and satisfies the
   acceptance criteria as written. A previewed confirmation would be friendlier
   for a maintainer who genuinely wants to re-run discovery, and either is
   acceptable provided nothing is written without confirmation. Not
   start-blocking; decide during implementation and record the choice.

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] Acceptance criteria trace to the SRS and feature contract.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Risks and resolved decisions are traced to the parent contract.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start.
- [x] The ticket fits one fresh implementation context.
- [x] User-facing and frontend evidence requirements are covered or explicitly inapplicable.

## Reproduction

Against a repository already migrated to schema v4 with Gate policy configured:

```bash
node .agents/skills/framework-setup/scripts/configure.mjs --tracker local-markdown
```

The command prints a schema v3 contract and writes it. Confirmed on a fixture
carrying six migrated Command descriptors and an `evaluation_gate` block; both
were gone afterwards and `schema_version` had dropped to 3.
