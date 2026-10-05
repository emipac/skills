# Provided each dependency root the way it needs

Delivered TB-057. TB-054's `copy` applied one strategy to every declared root. On
the project it was found on that was 83,199 files per evaluation, 49,120 of them
`node_modules`, which nothing needed as a real directory: with `node_modules`
linked and only the 107 generated JavaScript files copied, ESLint gave the same
clean result as copying everything. A preflight under the single strategy took
about a minute.

- `dependency_provisioning` now also accepts a map from declared root to
  strategy. A root the map does not name is provided by `link`, so an undeclared
  thing behaves as it always has.
- A key naming a root not in `dependency_roots`, or a value other than `link` or
  `copy`, is a configuration error that names it. Nothing is inferred from a
  root's contents.
- A clone with no declaration or a single-strategy declaration keeps a
  byte-identical envelope and preview identity. A map declaration records the
  complete map over every declared root, changes the preview identity, and so
  requires a re-pin — consent is to the mixed provisioning, not a summary of it.
- The preview names each root's strategy.
- TB-056's re-basing reads the per-root strategy from whichever shape the record
  carries and does not branch on it, so a pin under a copied `vendor` and one
  under a linked `node_modules` both re-base in the same evaluation.
