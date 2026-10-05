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

`agent-framework config add-dependency-root`, `remove-dependency-root`,
`set-dependency-provisioning`, `add-budget-skippable`, and
`remove-budget-skippable` revise the Gate configuration section's `execution`
entries by name, so nobody hand-edits those YAML keys. Without `--confirm` a
revision writes nothing and shows each changed line of the section, before and
after, with its token; `--confirm <token>` writes exactly that change, and only
while the file is still the one previewed. The candidate is judged by the Gate
policy validator `--configure-gate` already uses, and refused with its reason.
Every byte outside the section is kept, comments included, and a section that
is not exactly what `--configure-gate` writes — a hand-written block section,
say — is refused by line rather than reformatted. On an activated clone the
confirmation continues into the Gate's own `gate sync` preview for exactly the
written candidate and prints its confirmation; it never confirms the re-pin.
The same operation runs directly as `configure.mjs --revise-gate <revision>`,
and both write the same file.
