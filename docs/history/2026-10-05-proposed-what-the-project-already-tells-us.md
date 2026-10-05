# Proposed what the project already tells us

Delivered TB-071, the proposal half of the Guided setup feature's configuration
revisions (`FR-GUIDE-007`). TB-069 and TB-070 made every Gate section entry
revisable by name, but a maintainer still had to know which dependency roots,
Sensitive runtime inputs, and environment files the project needed, although
the checkout already said so: an installed `vendor/` beside `composer.lock`, the
keys `.env.example` names, a `.env` Git ignores.

- Added `agent-framework config suggest`, with `--json` for an
  `agent-framework/config-suggest/1` document. It lists a proposal per fact the
  section does not declare, each with its evidence and the exact
  `config add-dependency-root`, `add-sensitive-input`, or `add-environment-file`
  command that previews it. It applies nothing, offers no "apply all", and never
  proposes a check or a Verification profile command (`SG-OWNER-001`).
- Proved every proposal with `framework-setup`'s own `previewGateRevision`,
  discarding the token: a revision that would change nothing is already declared
  and left out, a key the Gate policy validator refuses as a name is counted by
  file and never shown, and any other refusal — a hand-written section, say — is
  reported as the operation gives it, exit 2.
- Kept the stack knowledge in `framework-setup`. Running `discoverProject` on a
  Laravel-like checkout showed discovery exposes no manifest, lock-file, or
  installed-directory fact (its walk skips `vendor` and `node_modules`), and the
  only manifest-to-directory data was `RUNNER_DEPENDENCY_ROOTS`, keyed by runner
  and used by the Gate drafter. It is now one `DEPENDENCY_INSTALLS` table —
  `vendor` from `composer.json` / `composer.lock`, `node_modules` from
  `package.json` / the Node lock files `detectPackageManager` already listed,
  now shared as `PACKAGE_LOCK_FILES` — read by both the drafter and the new
  `discoverGateConfigurationFacts`. The dotenv convention (`.env` and
  `.env.example`) is a second small table beside it. Gate core is unchanged.
- Read `.env.example` for key names only: the text before each line's first
  `=`, without `export`. `.env` is never opened; whether Git ignores it is
  `git check-ignore`'s answer, so a tracked `.env` is not proposed.
- Reused config show's reading of the section through `gate status --json`
  (extracted as `observeSection`): a clone with no section proposes nothing and
  names setup's next step; without the Gate module a configured clone is refused
  with `gate-unavailable`.

Verification: `npm run test:unit` (769 passing, 1 skipped, three runs) drives the subcommand as a child process for
the first red test (`composer.lock` and `vendor/` propose `vendor`, and the
pasted command previews exactly that revision), a Laravel-like clone's roots,
example names, and ignored `.env` with evidence, already-declared items left
out, a tracked `.env` and unmatched facts proposing nothing, unconfigured and
Gate-absent clones, a hand-written section refused, and a canary value in
`.env`, `.env.example`, and the environment absent from text and `--json` on an
activated clone; every run hashes the clone and `.git` before and after,
repeats byte-identically, and checks the text mirrors the document.
`npm run test:install` passes; `npm run validate` reports only the pre-existing
frontmatter errors in the uncommitted `skills/implement/SKILL.md`.

Limits. Only the repository root is looked at, and only `.env.example` and
`.env`. The Gate policy validator accepts lowercase environment names, so a
lowercase key in `.env.example` is proposed. Every key the example names is
proposed as Sensitive, including non-secret ones such as `APP_NAME`; a
maintainer chooses. A dependency root is proposed from presence alone, so a
committed `vendor/` would still be proposed.
