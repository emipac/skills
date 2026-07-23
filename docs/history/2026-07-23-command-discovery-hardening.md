# Command discovery hardening

## Outcome

- Added Express `database/` to backend source-scope discovery.
- Recognized safe qualified package scripts such as `test:unit`,
  `test:integration`, `format:check`, and named smoke checks.
- Preferred `format:check` over `format` when both exist.
- Inferred command scope from confirmed source-root references after explicit
  script-name markers.
- Added explicit package-script exclusions while retaining conservative
  defaults for watch, fix, development, coverage, and write variants.

## Verification

- Added a realistic Express/React fixture reproducing the reported script
  layout.
- Covered safe command selection, backend/frontend/both scope assignment,
  source-root discovery, and explicit exclusions at the public setup seam.
- All 62 unit and contract tests passed.
- Repository validation passed for 24 released skills and 109 Markdown files.
- Five-client installation smoke passed and the dependency audit reported no
  vulnerabilities.
