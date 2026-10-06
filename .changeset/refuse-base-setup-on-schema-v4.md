---
"ai-skills-framework": patch
---

Base setup no longer rewrites a schema v4 configuration as v3. Run on a clone
whose `.agent-framework.yaml` declares `schema_version: 4`,
`configure.mjs --tracker …` exited 0 and wrote a fresh schema v3 file from
discovery, silently dropping the Command descriptors, the mapped profiles, and
the whole `evaluation_gate` section; on an activated clone the next commit was
then denied as configuration drift. It now refuses before reading or writing
anything else, the way `--revise-gate` states a refusal: it prints
`{"status": "refused", "reasonCode": "schema-v4-configured", "detail": …}` and
exits 2, and none of the four managed files nor any `AGENTS.md` changes.
In-process, `configureProject` rejects with an error carrying that
`reasonCode`. The detail names `agent-framework config <revision>` for the Gate
section; any other change to a schema v4 file stays the maintainer's own edit.
A schema version above 4, which this release cannot read, is refused the same
way as `schema-unsupported` rather than replaced by an older one. A missing
file and schema versions 2 and 3 behave exactly as before, including
byte-identical repeat runs.
