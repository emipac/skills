# Ran a provided binary from where it was provided

Delivered TB-056, a defect slice. A `composer-bin` executable was pinned to the
original repository at activation, and under `copy` the snapshot held a second,
byte-identical `vendor`. PHPStan's Composer shim loaded its own autoloader from
the original tree and the project's from the snapshot, and PHP reported the same
generated class twice. `link` had hidden it, because both paths collapsed to one
real path.

- Made a provided root the place its binaries run from. A pinned executable under
  a provided root is invoked at the same relative location inside the execution
  root, after both are proved the same bytes by content identity; a mismatch is
  `runner-pin-drift` and neither runs.
- Re-based nothing else: never the interpreter, nothing outside a provided root,
  and no root that was missing or refused.
- Made the search path follow the executable, so a tool that starts a sibling by
  bare name finds the provided copy rather than the original — the same
  two-trees defect through a different door.
- Recorded `program: { pinned, invoked, root }` on every attempt.

Nothing in activation, the pin shape, the receipt, the preview, or control
surface observation changed. Hashing cost 0.05–0.12 ms per real shim. Two deltas
were named: under `link`, `$0` now shows the execution-root spelling of the same
file, and the new attempt field changes evidence identities once on upgrade.

Evidence added: a pinned shim that starts a sibling by bare name, red without
the relocation and green with it. A residual was recorded and closed: a tool run
from the provided copy now writes its caches into the copy, not the
maintainer's repository.
