# Standards baseline

Apply these Fowler-style smells only when repository rules do not endorse the
pattern. They are judgement calls, not hard violations, and should be skipped
when deterministic tooling already reports them.

- **Mysterious Name** — a name does not reveal its role. Rename it or clarify
  the design until one honest name exists.
- **Duplicated Code** — the same logic shape appears repeatedly. Extract the
  shared behavior at the appropriate seam.
- **Feature Envy** — behavior reaches into another object's data more than its
  own. Move behavior toward the data it uses.
- **Data Clumps** — the same fields or parameters travel together. Introduce a
  cohesive domain type when it deepens the interface.
- **Primitive Obsession** — a primitive substitutes for a domain concept that
  needs validation or behavior. Introduce the smallest useful type.
- **Repeated Switches** — the same conditional dispatch recurs. Centralize the
  decision or use polymorphism when it improves locality.
- **Shotgun Surgery** — one logical change requires scattered edits. Gather
  what changes together behind one interface.
- **Divergent Change** — one module changes for unrelated reasons. Separate the
  responsibilities.
- **Speculative Generality** — abstractions support no contracted need. Remove
  them until a real variation exists.
- **Message Chains** — callers navigate deep object structure. Hide the walk
  behind a meaningful interface.
- **Middle Man** — a layer only delegates without adding depth. Remove it or
  move meaningful policy into it.
- **Refused Bequest** — inheritance exposes behavior an implementation rejects.
  Prefer a smaller interface or composition.
