# Packaged the desktop preflight runner a client hook can register

Delivered TB-025, a defect slice: desktop adapter registration had a working
seam and nothing to point it at. The only packaged program was
`gate-precommit.mjs`, which grades the Git index, writes to stderr, claims an
authoritative role, and cannot answer a desktop client's stdout contract.

- Shipped `gate-preflight.mjs` beside the authoritative runner. It reads the
  native payload on stdin, looks up the adapter named by `--adapter`, evaluates
  the working tree as `role: 'preflight'` / `trigger: 'work-complete'`, and
  always exits `0`. Everything the agent is told travels through the declared
  feedback channel, never the exit status.
- Extended `FR-ADAPT-004`'s capability set with `feedback`: channel, field, and
  the form that returns none. Cursor declares `stdout-json` /
  `followup_message` / empty silence. Git, Claude Code Desktop, and Codex
  Desktop declare no channel. `formatFeedback` reads that declaration, so the
  runner never learns a client field name (`SG-OWNER-001`).
- A failing required check produces stdout JSON whose declared field names the
  check and says it is a preflight, not a commit decision. A passing turn
  writes nothing, so a clean stop is never interrupted. Unreadable payloads,
  unmatched events, unresolvable roots, and internal failures present as
  `unverified` through the same channel rather than as silence or a clean pass.
- Reused TB-026's store wiring. The preflight evaluation opens the clone-local
  Evidence store the receipt identifies, captures bounded output, and persists
  the envelope; it does not restate how a store is opened.
- Pointed desktop activation at this program. When the pinned hook program is
  `gate-precommit.mjs`, registration writes the sibling `gate-preflight.mjs`
  with `--adapter <id>`. Fixture programs keep their own script and gain the
  same adapter argument, so an unreadable payload can still be answered through
  that surface's declared channel.
- Extended `gate-adapter-conformance` with
  `packaged-preflight-answers-client`: the first scenario that launches a
  packaged desktop entry point as a child process.

Scope held: no change to `gate-precommit.mjs` or `runHook`; no blocking
preflight; no client name or native field name outside `adapters.mjs`; no
`gate` lifecycle CLI; no second Evidence wiring.

Verification: `npm run test:unit` (passing, including
`tests/gate-preflight-runner.test.mjs`), `npm run validate` (29 skills, 233
Markdown files), `npm run test:install`, `npm run gate-adapter-conformance`
(including `packaged-preflight-answers-client`), and
`npm run gate-activation-smoke`.
