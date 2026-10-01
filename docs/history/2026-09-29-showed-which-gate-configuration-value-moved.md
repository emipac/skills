# Showed which Gate configuration value moved since activation

Delivered TB-068. A maintainer who wanted to know what the Gate enforces had to
read the `evaluation_gate` section as raw flow-JSON lines, and on an activated
clone `gate status` could say only that the section's identity moved, never
which value. The Activation receipt pins that identity, not the values.

- Exposed the pinned section without storing anything new. `gate status --json`
  now carries `observation.configuration`: the working section as the Gate
  resolves it, or the reason it does not, and on an activated clone the pinned
  identity with the pinned section recovered by the rule `gate sync` already
  judges transitions with — the receipt when a sync wrote it, the file when its
  identity never moved, else the committed file at `HEAD`, each accepted only
  when it reproduces the pinned identity. When nothing does, its source and
  policy are null.
- Kept status what it was. The text rendering is unchanged, the document stays
  `change-evaluation-gate/observation/1`, and status still writes nothing.
- Added `agent-framework config show`, with or without `--json`. It renders the
  five subcontracts — `checks`, `budget`, `bypass`, `execution`, `evidence` — by
  name, one line per key, and on an activated clone marks each value
  `matches`, `differs` (naming what was added and removed), or `unrecoverable`
  (`FR-GUIDE-005`). A clone never activated compares nothing.
- Showed secrets by name only. Sensitive runtime inputs appear with the source
  `gate doctor --json` resolves them from, copied field by field so no value can
  pass through (`SG-GUIDE-002`).
- Pointed an unconfigured clone onward. With no Gate section, `config show` says
  so and names the next step from `setup`'s own plan, which now accepts a status
  answer already in hand.
- Refused rather than read the section another way: without the Gate module, or
  against a Gate whose status lacks the field, it exits 2.

Scope held: read-only; no editing (TB-069, TB-070), no Verification profile
commands beyond the check identities the policy names, and nothing new in the
receipt.

Verification: `npm run test:unit` (734 passing) drives `config show` on
activated-differing, activated-matching, unrecoverable, configured,
unconfigured, Gate-absent, older-Gate, and secret-canary fixtures, hashes the
clone and `.git` across text and `--json` runs, and checks the text mirrors the
document; Gate tests cover each pinned source, the unrecoverable case, and
unactivated clones. `npm run validate`, `npm run test:install`,
`gate-lifecycle-smoke`, `gate-activation-smoke`, and
`gate-security-control-smoke` pass. The SRS records it as 0.3.2 with no
requirement changed.

One limit is stated: per-value marking needs a document that reproduces the
pinned identity, so after a commit past the Gate that changed the section, only
the section as a whole is compared.
