# Never reported an environment fault as a code fault

Delivered TB-044, a defect slice found in preserved evidence from a real
project. A check that could not run now says so: the maintainer, and the agent
reading over their shoulder, can tell "your code is wrong" from "this check never
got what it needed", and neither is told to change the project because the
evaluation environment was missing something.

- Bound a real prerequisite resolver in both runners, and let a configured check
  declare prerequisites at all — configuration loading had hard-coded an empty
  list, so no clone could declare one.
- A check whose declared prerequisite is not satisfied reports `unverified` with
  `prerequisite-missing` and never runs its command, where it used to run and
  report `grader-negative` (`AC-EVAL-003`).
- The unproved prerequisite is named in the decision, and the same naming
  reaches the desktop preflight feedback channel (`NFR-OPER-001`).
- A required check that is `unverified` still denies authoritatively; nothing
  turns a blocked commit into an allowed one (`AC-EVAL-008`, `FR-POL-003`).
- A check declaring no prerequisites behaves exactly as before.
- No tool name, flag name, or stack branch entered Gate core (`SG-OWNER-001`).

Evidence added: `tests/gate-evaluation.test.mjs`,
`tests/gate-hook-runner.test.mjs`, and `tests/gate-preflight-runner.test.mjs`,
with `gate-activation-smoke` extended. The provider descriptor contract records
prerequisites.
