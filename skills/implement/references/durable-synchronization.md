# Durable synchronization

Synchronize only accepted durable knowledge after verification and review.

| Learned or changed information | Owning artifact | Required gate |
| --- | --- | --- |
| Observable behavior or stable constraint | SRS | Accepted contract amendment |
| Domain terminology or definition | Domain glossary | Explicit terminology decision |
| Durable architecture or boundary rationale | ADR | Accepted architecture decision |
| Delivery status, blockers, and exact evidence | Tracker issue | Successful or explicitly partial handoff |
| Completed project work summary | Configured history path | History policy requires it |
| Private implementation, file layout, helper method, annotation, incidental field | None | Keep as code truth |

Apply accepted contract changes to the owning artifact before continuing with
tests or code. Never synchronize an implementation detail merely because it
exists, and never treat code drift as automatic approval to rewrite intent.
