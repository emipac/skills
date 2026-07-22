# Ship one cross-client skill framework from a flat released-skill directory

Status: accepted; supersedes ADR-0002

## Context

ADR-0002 deferred a Codex plugin because the upstream repository mixed released,
experimental, personal, and deprecated skills below one recursively discovered
`skills/` directory. The AI Skills Framework must be installable through the
universal skills CLI and through native Claude Code and Codex plugin systems.

## Decision

- Keep only released skills directly under `skills/<skill-name>/`.
- Move draft work to `experimental/` and retired work to `deprecated/`.
- Treat each released skill directory as the single source consumed by every
  installer; do not generate or duplicate skill copies per client.
- Keep `package.json` as the authoritative version and synchronize native plugin
  manifests from it.
- Validate released-skill parity and isolated universal installs in CI.

## Consequences

The repository can expose `./skills/` safely to Codex while Claude Code retains
an explicit allowlist. Adding, removing, or renaming a released skill requires
coherent updates to its docs, README entry, router references, and Claude
manifest. Experimental and deprecated skills remain available to maintainers
without leaking into releases.
