adapter: github

# GitHub Issues adapter

Use `gh` for authenticated issue operations. Prefer native sub-issues and
blocking relationships when available; retain `Parent` and `Blocked by` body
fields as readable fallbacks.

Resolve repository identity before writes. Create issues before wiring their
relationships. Treat an open, unassigned issue with no open blockers as
frontier work; claim by assignment and close only after its acceptance evidence
is recorded.
