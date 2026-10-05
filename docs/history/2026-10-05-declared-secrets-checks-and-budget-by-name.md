# Declared secrets, checks, and budget by name

Delivered TB-070, the second configuration revision of the Guided setup
feature. TB-069 made `execution` revisable by name; every other change to a
configured Gate section — a Sensitive runtime input, an environment file, a
check's severity, the total budget, bypass — was still a hand edit of
`.agent-framework.yaml` keys, and a weakening reached through the revision chain
surfaced only as the Gate's `weakening-unacknowledged` refusal with no way to
acknowledge it from there.

- Added nine rows to `framework-setup`'s `gateRevisions` table, each over the
  same previewed, hash-bound operation: `add-sensitive-input` (with optional
  `--environment-file`), `remove-sensitive-input`, `add-environment-file`,
  `remove-environment-file`, `promote-check`, `demote-check`, `remove-check`,
  `set-budget`, and `set-bypass` (`true` or `false`, with optional `--marker`
  and `--require-reference`). Usage and argument parsing in both CLIs follow the
  table; `configure.mjs --revise-gate` now reads each value any revision takes
  by its own option name instead of three named ones.
- Declared a Sensitive runtime input by name and source only. The Gate policy
  validator accepts names in `evidence.sensitive_inputs` and repository-relative
  files in `evidence.environment_files`; `--environment-file` declares the file
  a name is read from when it is not declared yet. No value is read, asked for,
  or printed: an argument typed as `NAME=value` anywhere a revision takes a
  value is refused as `value-supplied` before the file or the validator sees
  it, naming only `NAME`, and is withheld from the refusal, the document, and
  every echoed command in both CLIs; `--revise-gate` now prints a refusal as a
  `refused` document and exits 2.
- Moved or removed a check only when the policy already binds it. An identity
  bound as neither is refused as `check-unbound`, so no revision binds a new
  check or touches a Verification profile command (`SG-OWNER-001`).
- Left every judgement to the Gate policy validator. `true`/`false` and digit
  strings become the values they spell and anything else reaches the validator
  as typed, so an enabled bypass without a marker, a non-boolean reference
  rule, an input name the validator rejects (such as `db-password`), or an
  escaping environment file is refused with the validator's own path and
  message. A `NAME=value` argument never reaches the validator: it is refused
  first as `value-supplied`, without repeating the value.
- Passed `--acknowledge-weakening` through. Whether a candidate is weaker stays
  `gate sync`'s judgement (`evaluatePolicyTransition`); the revision preview
  names none. A confirmed demotion or removal of a required check reaches the
  chained `gate sync` preview, which refuses with the weakening named and no
  token, and the Framework command names the Gate's own
  `sync --acknowledge-weakening` preview as next. Given `--acknowledge-weakening`,
  the revision prints it into its confirming command and passes it to the
  chained preview, which then offers its token, and the printed sync
  confirmation carries the acknowledgement that token binds. The revision
  document gains an additive `acknowledgeWeakening` field.

Scope held: weakening detection is unchanged and still counts only a demoted
or removed required check; no `allowed_environment`, check command, or new
check binding is revisable; no proposals (TB-071) and no interactive prompt
(TB-072). No Gate contract or document changed, and no new import crosses into
the Gate.

Verification: `npm run test:unit` (760 passing, 1 skipped) drives the
subcommands as child processes for the first red test (declaring `DB_PASSWORD`
from `.env` previews one evidence line with the name and file and no value),
every new revision previewed, refused with a foreign token, and confirmed,
invalid candidates refused with the validator's own reasons, a value typed as `NAME=value` withheld
by both CLIs, a commented
fixture compared byte for byte outside the section for every revision, a
canary in the environment and `.env` absent from every output and every byte of
an activated clone but `.env`, a demotion on an activated clone reaching the
Gate's refusal and the pasted acknowledged preview offering a token, the
pass-through offering the token directly and re-pinning, and the Framework
command, `--revise-gate`, and `--configure-gate` writing the same file. An
in-process test covers determinism and refusals of the operation itself.
`gate-security-control-smoke` gains `revised-demotion-reaches-sync`: on a really
activated clone the demotion is previewed and confirmed by name, the chained
`gate sync` refuses, a real commit is denied for the drift, the acknowledged
preview named as next offers a token that re-pins, and a failing commit is then
graded under the demoted policy. `npm run test:install` and
`gate-activation-smoke` pass; `npm run validate` reports only the pre-existing
frontmatter errors in the uncommitted `skills/implement/SKILL.md`.

Limits. Removing a check leaves it in `execution.budget_skippable` if it was
there, as the validator allows; `remove-budget-skippable` removes it. Disabling
bypass keeps its marker and reference rule. A looser budget or an enabled bypass
is not reported as a weakening, which is tracked outside this feature. A
weakening is named only after the revision is written, in the chained re-pin
preview; until that re-pin is confirmed the written file is drift and commits
are denied for it.
