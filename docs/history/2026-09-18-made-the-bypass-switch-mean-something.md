# Made the bypass switch mean something

Delivered TB-052. Setting `bypass: { enabled: true, marker: "…" }` did nothing at
all. The resolver, the one-shot ledger, and both evaluation call sites already
implemented every rule `FR-POL-006` asks for, and no runner ever supplied a grant
or a ledger, so a maintainer who switched it on got no error, no warning, and a
blocked commit that said nothing about the bypass they had configured.

- Added `gate bypass --reason <text> [--reference <ref>] [--actor <name>]`, which
  previews and confirms like every other mutating command. The preview
  materializes the staged index through the runners' own snapshot capture and
  runs the policy's resolver dry, so a disabled switch, a missing marker, or a
  missing reason is refused with the hook's own rejection code before any token
  exists.
- Wrote a versioned one-shot grant on confirmation, bound to that snapshot
  identity under the Evidence store, and appended one Lifecycle event.
- Made the hook read the grant after the store opens and before any check starts,
  so a check cannot place a grant in front of its own evaluation, and remove it
  whether applied, refused, or crashed — an attempt that reads a grant spends it.
  Staging anything between the grant and the commit is a snapshot mismatch:
  denied, grant spent, ledger untouched.
- Made a denial under an enabled policy with no grant name the bypass command; a
  disabled policy produces byte-identical output to before.

One limit was recorded against `FR-POL-007` in SRS 0.2.9: the commit-visible
marker appears in the decision, ledger, event, and hook report with an
instruction to include it in the message, but `pre-commit` runs before a message
exists and cannot write one. The preflight is untouched, because its worktree
identity can never equal an index-bound grant.

Evidence added: hook-runner and operator-surface tests, and a bypass scenario in
`gate-security-control-smoke`, which had none.
