# Curated upstream intake

## Outcome

- Added the model-invoked `curate-upstream-skills` workflow for reviewing Matt
  Pocock upstream changes from a fixed checkpoint.
- Added a deterministic analyzer that maps released upstream skills, protects
  intentional local adaptations, proves clean three-way Markdown merges, and
  applies only complete safe skill groups through `--apply-safe`.
- Defined `auto-port`, `manual-review`, and `no-port` dispositions with one
  compatibility-policy source of truth.
- Split the immutable ancestry baseline from the moving review checkpoint and
  added a compact synchronization ledger to `UPSTREAM.md`.

## Verification

- Added unit coverage for checkpoint and change parsing, path mapping,
  protected adaptations, clean three-way merges, and safe candidate analysis.
- All 67 unit and contract tests passed.
- Repository validation passed for 27 released skills and 122 Markdown files.
- Five-client installation smoke passed with `curate-upstream-skills`, its
  analyzer, and its compatibility policy included.
- The dependency audit reported zero vulnerabilities, and `git diff --check`
  passed.
- The standalone official skill validator could not run because its Python
  environment lacks `PyYAML`; repository metadata validation passed instead.
