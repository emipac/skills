adapter: local-markdown

# Local Markdown tracker

Store one issue per file under `.scratch/<feature>/issues/`. Use a stable slug
as the identifier. Record `Status`, `Parent`, and `Blocked by` near the top;
append discussion under `## Comments`.

Create parent and child files first, then add blocking identifiers in a second
pass. The frontier is every open issue whose blockers are closed. Claim an
issue by setting `Assignee`; close it by setting `Status: done`.
