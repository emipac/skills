---
"ai-skills-framework": minor
---

Add the `agent-framework` command, shipped in `framework-setup` and as a new
package bin. `agent-framework setup` (with `--json` for a versioned document)
reports where a clone stands in Gate adoption — `no-configuration`,
`schema-v3`, `gate-unconfigured`, `configured`, or `activated` with the Gate's
health — every remaining step in order with the command that owns it, and the
exact next command, including a draft path in the temporary directory so nobody
has to invent one. Each boundary is the owning command's own answer:
`framework-setup`'s schema reading and previews, `gate status --json`, and
`gate doctor --json`. A healthy clone reports nothing to do.

It writes, confirms, and registers nothing and never prompts. It reaches the
Gate only by running `change-evaluation-gate` on the path or the installed Gate
skill beside `framework-setup`; without either it names only `framework-setup`
steps and states that the Gate steps are unavailable. Exit status is `0` with
nothing further to do, `1` when steps remain, and `2` when it could not run.

`agent-framework config show` (with `--json`) shows the Gate configuration
section by its five subcontracts — `checks`, `budget`, `bypass`, `execution`,
`evidence` — one line per key, and on an activated clone marks each value as
matching or differing from what the Activation receipt pinned, naming added and
removed names. Sensitive runtime inputs appear by name and resolved source,
never by value; a clone with no Gate section names setup's next step; nothing is
written. To support it, `gate status --json` gains `observation.configuration`:
the working section and, on an activated clone, the pinned section recovered by
the rule `gate sync` already uses, or its identity alone when no document
reproduces it.
