# Refused to rewrite a schema v4 configuration as v3

Delivered FS-005. `configureProject` built a fresh `schema_version: 3` document
from discovery and wrote it over `.agent-framework.yaml` without reading the
existing schema version, so base setup on a schema v4 clone exited 0 and
silently dropped the Command descriptors, the mapped profiles, and the Gate
section. The skill already forbade it; the code still allowed it.

- Made base setup read the existing schema version before anything else and
  refuse schema v4 with the reason code `schema-v4-configured`. The detail
  names the version, says nothing was written, and points to
  `agent-framework config <revision>` for the Gate section and the
  maintainer's own edit for anything else.
- Stated the refusal on the command line the way `--revise-gate` does:
  `{status: 'refused', reasonCode, detail}` on standard output and exit 2.
  In-process, `configureProject` rejects with an error carrying `reasonCode`,
  as `reviseGate` does. Migration and Gate configuration, which throw, were left
  unchanged.
- Left a missing file and schema versions 2 and 3 exactly as before. The
  schema v2 confirmation stays the skill's rule; the code still rewrites v2 as
  v3. Checked every caller of `configureProject`: the unit suites, which call it
  on missing or schema v3 files, and the Framework command, which names base
  setup only for `no-configuration` and schema versions below 3 and never
  performs it.
- Shortened the skill's base-setup rule to say the command refuses a schema v4
  file, and added the refusal to `references/configuration.md`.

Verification: the first red test ran base setup on a schema v4 clone with a
configured Gate section and saw exit 0 and a rewritten file. It and three
fixtures (no Gate section, a configured section, an activated clone) now prove
exit 2, the stated refusal, the clone and `.git` unchanged byte for byte, the
four managed files and both discovered `AGENTS.md` files unchanged, and the plan
state unchanged. `setup --json` on schema v4 clones, with and without the Gate
module, names no base setup step. A missing file, its repeat run, and a schema
v2 file still write byte-identical schema v3 output. `npm run test:install`
runs the installed `configure.mjs` on its configured schema v4 clone through the
installed and linked paths and requires the refusal, and fails without the fix.
`npm run test:unit` (801 passing, 1 skipped, three runs) and `npm run validate`
pass.

Limits. Only schema version 4 is refused; a file declaring a version above 4 is
still rewritten as v3 by base setup, as before. No schema v4-preserving rewrite
exists: deciding which discovered values may override confirmed v4 ones is a
product decision this ticket did not make.
