# Framework configuration

`.agent-framework.yaml` is the repository-local contract shared by lifecycle
skills. It records discovered paths and exact commands; it does not replace the
documents it points to.

- `schema_version` versions the configuration contract.
- `backend` selects `laravel`, `express-typescript`, or conservative `unknown`;
  schema v4 also accepts proved-absent `none`.
- `frontend` selects Livewire, React/TypeScript, Svelte/TypeScript, `none`, or
  conservative `unknown`.
- `tracker` selects one tracker adapter.
- `artifacts` points to durable requirements and architecture documents.
- `guidelines` lists applicable instruction and convention files.
- `source_scopes` records confirmed backend, frontend, and shared roots.
  Longest-root matching classifies a changed path; shared, tied, or unmatched
  paths affect every configured active profile. A `none` profile is inactive;
  an `unknown` profile remains active and conservative.
- `verification.profile` selects the backend/frontend verification profile.
- `verification.capabilities` records proved tool and evidence capabilities.
- `verification.commands` contains exact commands proved to exist during
  discovery, grouped by evidence category and backend, frontend, or both scope.
  Schema v3 stores raw command strings. Schema v4 stores OS-independent Command
  descriptors with a logical runner, arguments, repository-relative working
  directory, timeout, allowed environment names, evidence category, and source
  scope.
  Package scripts use the lockfile-selected package manager. Qualified
  verification scripts are accepted only when their base category is known;
  operational, watch, fix, write, development, and coverage variants remain
  excluded unless explicitly selected. When both `format` and `format:check`
  exist, discovery prefers the non-mutating check. Script-name scope markers
  take precedence, followed by confirmed source-root references in the command,
  then the conservative profile default.
- Optional schema v4 `evaluation_gate` records repository-owned Gate policy.
  Its absence means unconfigured; its presence means configured but inactive.
  It contains exactly five subcontracts: required/advisory check identities,
  total budget, bypass, execution, and evidence. It never owns Verification
  commands, profiles, scopes, or capabilities, and never stores client, hook,
  executable, trust, version, receipt, or activation state.
- `history` records the project completion-log convention.
- `protected_files` lists instruction files setup must preserve byte-for-byte.

An empty list or `null` is an explicit unresolved value. A lifecycle skill must
surface it when required instead of inventing a path or command.

Schema version 1 configurations do not contain profiles or capabilities.
Schema version 2 configurations do not contain source scopes or scoped
commands. The verification parser can read version 2 for compatibility, but
rerun `framework-setup`, confirm every proposed scope, and generate schema
version 3 before new work.

Schema version 3 remains readable throughout the `0.x` line. Schema version 4
supports these explicit combinations:

- backend-only: configured backend and `frontend: none`;
- frontend-only: `backend: none` and a configured frontend;
- full-stack: both profiles configured;
- tooling-only: both profiles `none` and `verification.profile: tooling`.

Do not reinterpret schema v3 `unknown` as v4 `none`. Use the previewed
`--migrate-v4 --mapping <mapping-json>` flow and confirm its exact hash.
Migration does not configure or activate the Change Evaluation Gate.

Use `--exclude-scripts` for discovered commands that are redundant, unsafe, or
inapplicable. Repeat the same exclusions on later setup runs because the
generated contract stores the selected exact commands, not discovery policy.
