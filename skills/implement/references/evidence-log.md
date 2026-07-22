# Red-green evidence log

Keep one row per acceptance behavior. Commands and outcomes are evidence, not a
replacement for test code.

| Acceptance ID | Public seam | Red command | Red failure | Green command | Green result | Implementation learning |
| --- | --- | --- | --- | --- | --- | --- |
| AC-AREA-001 | <Agreed seam> | <Exact command> | <Expected missing-behavior failure> | <Exact command> | <Pass> | <None or amendment reference> |

A red result is valid only when the assertion fails because the contracted
behavior is absent. Syntax, environment, fixture, dependency, and unrelated
failures do not count as red-before-green evidence.
