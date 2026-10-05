# Added a dependency root without editing YAML

Delivered TB-069, the first configuration revision of the Guided setup feature.
Once a clone's Gate was configured, nothing revised its section:
`--configure-gate` refuses a configured clone, so every new dependency root,
provisioning change, or budget-skippable check was a hand edit of
`.agent-framework.yaml` keys, followed by `gate sync` looked up separately.

- Created the revision operation in `framework-setup`, which owns the file.
  `previewGateRevision` and `reviseGate` read the Gate section back, apply one
  named revision to its one subcontract, validate the candidate with the same
  Gate policy validator `--configure-gate` already loads, and render it in place
  the way `--configure-gate` renders a section. The preview names each changed
  line before and after; its `previewHash` binds the file as it is now to the
  file the revision would write, so a stale or foreign token writes nothing.
- Named five revisions, all in `execution`: `add-dependency-root` (with optional
  `--provisioning`), `remove-dependency-root`, `set-dependency-provisioning`
  (single strategy, or per root with `--root`), `add-budget-skippable`, and
  `remove-budget-skippable`. A per-root change to a differing single strategy
  becomes a map in which every other root keeps its strategy; removing a root
  removes its map entry. A revision that would change nothing is refused.
- Kept every byte outside the section, comments included, and refused what it
  cannot round-trip. A section is rewritten only when it is exactly what
  `--configure-gate` writes — `evaluation_gate:` and one flow-JSON line per
  subcontract, nothing between them — so re-rendering changes only the revised
  line. A hand-written block section, a comment or blank line inside it,
  differently spelled JSON, or a section declared twice is refused by line with
  nothing written, never reformatted.
- Exposed it two ways. `configure.mjs --revise-gate <revision>` is the direct
  path; `agent-framework config <revision>` drives the same operation (ADR 0004),
  passing back only the token the maintainer gives it. Both write the same file.
- Chained the re-pin on an activated clone. A confirmed revision asks
  `gate status --json` which subcommand re-pins the changed configuration,
  runs it with `--json` (`gate sync`), checks it previews exactly the candidate
  written, and prints its trusted and candidate identities, weakenings, refusal,
  and own confirmation. It never confirms that re-pin. A configured clone that
  is not activated has nothing to re-pin.

Scope held: `execution` only; no `checks`, `budget`, `bypass`, or `evidence`
revision (TB-070), no proposals (TB-071), no interactive prompt (TB-072), no
`allowed_environment`, and no Verification profile command added, removed, or
rescoped. No Gate contract or document changed, and no new import crosses into
the Gate.

Verification: `npm run test:unit` (747 passing, 1 skipped) drives the
subcommands as child processes for the first preview, each revision, invalid
candidates refused with the validator's own path and message, a comments
fixture compared byte for byte outside the section, five unrevisable sections,
stale and foreign tokens, the activated chain compared field by field with a
direct `gate sync --json`, and the Framework command, `--revise-gate`, and
`--configure-gate` writing the same file; direct tests cover the operation
in-process and through its CLI. `gate-activation-smoke` gains
`revised-root-chains-into-sync`: on a really activated clone a good commit is
refused without its root, the root is added and confirmed, the printed
`gate sync` confirmation is pasted and re-pins, and the same commit is graded
with the root copied and allowed. `npm run test:install` passes; `npm run
validate` reports only the pre-existing frontmatter errors in the uncommitted
`skills/implement/SKILL.md`.

Limits. The Framework command confirms when given `--confirm <token>` without
a terminal: it relays the token to the owning operation and never originates
one, but a terminal-only reading of `SG-GUIDE-001` is left for TB-072 to
reconcile. A section rewritten by hand as block YAML stays unrevisable until a
maintainer decides whether the writer may convert it. The chain previews a
re-pin only when `gate status` names a single subcommand for the changed
configuration; otherwise it reports the Gate's instruction instead.
