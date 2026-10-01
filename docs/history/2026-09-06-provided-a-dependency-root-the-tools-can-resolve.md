# Provided a dependency root the tools can resolve

Delivered TB-054, a defect slice found on a real project. Dependency roots were
provided by symbolic link, so any tool that resolves a path to its real path
concluded the project lived outside the snapshot. ESLint reported 33
`import/order` errors with the roots linked and none with them copied; Pest
derived the wrong test namespace with `vendor` linked. Three checks were
reported failed against code that passes by hand, and an agent reading those
failures as facts began editing the project's Pest and ESLint configuration to
satisfy them.

- Added `evaluation_gate.execution.dependency_provisioning`, declaring `link` or
  `copy` per root and defaulting to `link`, so a clone that declares nothing is
  unchanged.
- Allowed no fallback between strategies: a `copy` that cannot be performed
  fails, because a copy quietly served as a link would reintroduce the defect.
- Carried the strategy through the preview into the receipt, so consent is
  granted against it, and recorded the applied strategy in Evidence beside the
  provided, missing, and refused roots.
- Made a failed copy remove what it created rather than leave a partial
  dependency tree, and refused a declared root that names an already
  materialized path rather than removing graded content to make room.
- Made `link` write a junction, since Windows directory symbolic links need
  elevated privilege and junctions do not.

Measured: providing 33,972 files cost 9.9 s and 372.9 MiB under `copy`, and
reclaiming them 1.6 s. `COPYFILE_FICLONE` performed no clone on the measuring
platform, so the contract's premise that the flag clones where the filesystem
can was false; TB-055 addressed that.
