# Wrote one page a maintainer can read

Delivered TB-073, the last slice of the Guided setup feature (`FR-GUIDE-008`,
`AC-GUIDE-004`). Seeing where a clone stood took three commands — `setup`,
`config show`, and `gate doctor` — read in a terminal, and nothing could be
handed to someone who would not run them.

- Added `agent-framework report --html [--out <path>] [--project <directory>]`.
  It writes one static HTML page and prints its path on a `report:` line. The
  page shows the Gate state and health, every remaining step with its commands
  and the next command, the doctor's findings, and the effective Gate
  configuration section with each value's marking against the pinned one.
- Rendered the state, health, steps, and configuration from the documents
  `runSetup` and `runConfigShow` build — the ones `setup --json` and
  `config show --json` print — reusing their text rules, so the page cannot
  disagree with them. The doctor's findings are copied field by field from
  `gate doctor --json`, asked only on a configured or activated clone; the
  Gate is still reached only as a program (ADR 0004).
- Made the page self-contained: no script, stylesheet, font, image, link, or
  control, one embedded style element, and a Content Security Policy of
  `default-src 'none'`. Every interpolated string goes through one escaping
  template, so markup built from data cannot reach the page unescaped.
- Wrote it only outside the clone (`SG-GUIDE-002`). The target's directory is
  resolved by the operating system, symbolic links before `..`, and the file
  named there is the one checked and written. A path inside the clone, an
  existing file, and a missing directory are refused before anything runs, and
  the file is created exclusively, so nothing is ever overwritten. The default
  is a fresh `agent-framework-report-<uuid>.html` in the temporary directory,
  checked the same way.
- Gave a schema v3 clone, an unconfigured clone, and a clone without the Gate
  module an honest page rather than a refusal: each section says what its
  owning command says, including `config show`'s own refusal, and the doctor
  section says why it was not asked.
- Exit status: `0` the page is written and neither setup nor config show names
  anything further, `1` it is written and something remains, `2` nothing was
  written.

Verification: the first red test, on an activated clone, expected a path under
the temporary directory and a page holding the health and next step; it failed
with the usage refusal before this slice. `npm run test:unit` (795 passing,
1 skipped, three runs) also covers the page against `setup --json` on a drifted
and a configured clone, the configuration against `config show --json` with
the doctor's dependency-root finding, an explicit `--out`, an existing target
left untouched, a missing directory, seven spellings of a path inside the clone
(relative, absolute, `.git`, `..`, a link to the clone, a link followed by
`..`, the clone itself) and a temporary directory inside it, a scan for any
external reference or control, a clone path holding `<script>` and quotes, a
secret canary in the environment and `.env`, determinism apart from the
generation time, the printed regeneration command, and the usage. Every run
hashes the clone and `.git` before and after. `npm run test:install` passes;
`npm run validate` reports only the pre-existing frontmatter errors in the
uncommitted `skills/implement/SKILL.md`.

Limits. A static page goes stale when the clone changes; it says when it was
generated and how to regenerate it. On an activated clone `gate doctor` answers
what a new activation would find, so it reports the Gate's own hook as
`hook-exists`; the page shows that verdict as the Gate states it, beside the
hook's `gate-owned-shim` ownership. The doctor's `copy` mechanism for a
dependency root may vary between runs under concurrent disk activity, as the
Gate already states, and two pages then differ there too. The guided consent
channel on Lifecycle events is not shown, since no Gate `--json` document the
report reads carries it.
