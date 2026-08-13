# Read framework-written flow JSON

Delivered TB-021, the compatibility defect between the schema v4 writers and
the Change Evaluation Gate configuration reader.

- Accepted strict JSON objects and arrays at scalar positions through
  `JSON.parse`, while retaining the existing refusal and message for general
  YAML flow syntax. Anchors, aliases, tags, block scalars, and the rest of the
  reader's deliberately unsupported subset remain unchanged.
- Added a public-seam regression that runs the real schema v4 migration and Gate
  policy writers, reads their resulting `.agent-framework.yaml` through
  `readRepositoryConfiguration`, and proves it is structurally identical to an
  equivalent block-mapping document (`AC-CFG-002`, `AC-LIFE-002`).
- Added negative fixtures for unquoted flow scalars, single-quoted flow syntax,
  trailing commas, anchors, aliases, and tags, preserving `SG-CMD-001` without
  opening general flow-YAML support.
- Replaced `gate-activation-smoke`'s hand-authored block-YAML configuration with
  a schema v3 fixture processed by the actual migration and Gate configuration
  writers. Activation preview, the packaged hook runner, blocked commits, and
  allowed commits now exercise the same writer-to-reader boundary that failed
  in a real activation.

Scope held: no writer changes, no general YAML flow grammar, no activation or
lifecycle surface change, and no new SRS requirement.

Verification: the focused regression failed first with
`configuration-unreadable` at the migrated Command descriptor, then passed after
the reader change. `npm run test:unit` passed all 299 tests,
`npm run gate-activation-smoke -- --json` passed all four activation scenarios,
`npm run validate` validated 29 released skills and 223 Markdown files, and
`npm run test:install` smoke-installed the selected skills for all five agent
targets.
