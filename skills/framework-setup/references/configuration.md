# Framework configuration

`.agent-framework.yaml` is the repository-local contract shared by lifecycle
skills. It records discovered paths and exact commands; it does not replace the
documents it points to.

- `schema_version` versions the configuration contract.
- `backend` and `frontend` select lifecycle profiles.
- `tracker` selects one tracker adapter.
- `artifacts` points to durable requirements and architecture documents.
- `guidelines` lists applicable instruction and convention files.
- `verification` contains commands proved to exist during discovery.
- `history` records the project completion-log convention.
- `protected_files` lists instruction files setup must preserve byte-for-byte.

An empty list or `null` is an explicit unresolved value. A lifecycle skill must
surface it when required instead of inventing a path or command.
