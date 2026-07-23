# Framework configuration

`.agent-framework.yaml` is the repository-local contract shared by lifecycle
skills. It records discovered paths and exact commands; it does not replace the
documents it points to.

- `schema_version` versions the configuration contract.
- `backend` selects `laravel`, `express-typescript`, or conservative `unknown`.
- `frontend` selects Livewire, React/TypeScript, Svelte/TypeScript, `none`, or
  conservative `unknown`.
- `tracker` selects one tracker adapter.
- `artifacts` points to durable requirements and architecture documents.
- `guidelines` lists applicable instruction and convention files.
- `source_scopes` records confirmed backend, frontend, and shared roots.
  Longest-root matching classifies a changed path; shared, tied, or unmatched
  paths conservatively affect both scopes.
- `verification.profile` selects the backend/frontend verification profile.
- `verification.capabilities` records proved tool and evidence capabilities.
- `verification.commands` contains exact commands proved to exist during
  discovery, grouped by evidence category and backend, frontend, or both scope.
  Package scripts use the lockfile-selected package manager.
- `history` records the project completion-log convention.
- `protected_files` lists instruction files setup must preserve byte-for-byte.

An empty list or `null` is an explicit unresolved value. A lifecycle skill must
surface it when required instead of inventing a path or command.

Schema version 1 configurations do not contain profiles or capabilities.
Schema version 2 configurations do not contain source scopes or scoped
commands. The verification parser can read version 2 for compatibility, but
rerun `framework-setup`, confirm every proposed scope, and generate schema
version 3 before new work.
