# The Framework command

Every `agent-framework` subcommand, in full: what it reads, what it writes, its
refusals, and its exit status. The workflow that uses them is in
[SKILL.md](../SKILL.md). Run any of them as
`node <skill-directory>/scripts/agent-framework.mjs <subcommand>`, or as
`agent-framework <subcommand>` where the package bin is on the path.

## Adopting the Gate: `agent-framework setup`

The recommended adoption path is the Framework command, which ships in this
skill and as the `agent-framework` package bin:

```bash
node <skill-directory>/scripts/agent-framework.mjs setup [--json] [--project <directory>]
```

**In an interactive terminal** (standard input and output both terminals, no
`--json`) it walks the maintainer from the clone's adoption state to a healthy
activated clone, one step at a time, re-deriving each step from the clone as
the last one left it. For each step it shows the owning operation's complete
preview — the migrated `.agent-framework.yaml`, the drafted Gate policy and the
file it would write, or the Gate's own `--json` preview — and asks only what
that operation cannot derive: the migration report's open decisions (a profile
left `unknown`, a command's runner, arguments, or timeout), offering the owning
draft's value as the default; the client to activate (`git` by default); and,
for a candidate weaker than the trusted policy, the weakening the Gate names,
typed back exactly. Only the answer `yes` confirms, and it confirms exactly that
preview with its own token through the operation that owns it — this skill's
migration and Gate configuration in-process, the Gate as its own command. Gate
confirmations declare `--consent-channel interactive-guided-setup`, so the
Lifecycle event the Gate appends records, as self-declared, that consent came
through a guided prompt. Any other answer, end of input, or a refusal by the
owning operation (a preview that changed before the answer, doctor predicting
activation would stop) stops the run in the owning operation's words, with the
clone at the last completed step; nothing is retried and no answer is carried
to the next step or run. It repeats until Gate status names nothing further,
then prints where the clone stands. It writes no draft file and prints no token
to copy. Base setup has no preview, so a clone with no configuration is told the
command to run and nothing is performed.

The prompts are the maintainer's consent. An agent must not answer them; an
agent runs `setup --json`, or without a terminal, and hands the confirmation to
the maintainer.

**Without a terminal, or with `--json`,** it confirms nothing and prints the
plan: the adoption state — `no-configuration`, `schema-v3`,
`gate-unconfigured`, `configured`, or `activated` with the Gate's health — every
remaining step in order with the command that owns it, and the exact next
command, including the draft path to use. It writes, confirms, and registers
nothing, and it never prompts. Each boundary is the owning command's own
answer: this skill's schema reading, migration preview, and policy preview;
`gate status --json` for the Gate state, its named remedies, and the Gate
subcommands that perform each one; `gate doctor --json` for whether activation
would stop. A step the owning command would refuse carries that refusal
verbatim. A Gate whose document names a remedy without its subcommands predates
them: setup stops with `gate-remedy-subcommands-missing`, naming the installed
Gate, rather than guess a command — update the Gate module.

It reaches the Gate only by running `change-evaluation-gate` on the path, else
the installed `change-evaluation-gate` skill beside this one. When neither
exists it performs or names only this skill's steps and says the Gate steps are
unavailable. Exit status is `0` with nothing further to do, `1` when steps
remain (or a guided run stopped), and `2` when it could not run.

The direct commands each step names are documented in
[schema-and-gate-transactions.md](schema-and-gate-transactions.md) and in the Gate's
lifecycle contract; a guided step and the same command typed directly write the
same configuration, receipt, and Lifecycle events, apart from the recorded
consent channel.

Completion criterion: Gate status names nothing further, or the next step and
its owning command are known.

## What the Gate runs: `agent-framework config show`

To read the Gate configuration section without reading flow-JSON lines, run:

```bash
node <skill-directory>/scripts/agent-framework.mjs config show [--json] [--project <directory>]
```

It lists the five subcontracts — `checks`, `budget`, `bypass`, `execution`,
`evidence` — by name, one line per key. On an activated clone each value is
marked `matches` or `differs` against the section the Activation receipt
pinned, and a differing list of names says which were added and removed. The
receipt pins the section's identity, not its values, so the pinned values are
those `gate status --json` recovers (`observation.configuration`) by the rule
`gate sync` judges against: the receipt when a sync wrote it, else the file
when its identity never moved, else the committed file at `HEAD`. When no
document reproduces the pinned identity each value is `unrecoverable` and only
the section as a whole is compared. A clone never activated compares nothing.
Sensitive runtime inputs appear by name and the source `gate doctor --json`
resolves each from — never a value. A clone with no Gate section says so and
names setup's next step.

It is read-only: nothing under the clone or `.git` changes. Without the Gate
module a schema v4 clone is refused with `gate-unavailable`, and a Gate whose
status lacks the section is refused with `gate-configuration-unobserved` — update
the Gate module. Exit status is `0` when nothing differs, `1` when there is no
Gate section, it does not resolve, or a value differs, and `2` when it could not
run.

## Revising the Gate section by name: `agent-framework config <revision>`

To add or remove a dependency root, set how roots are provided, change the
budget-skippable checks, declare a Sensitive runtime input or an environment
file, move a check between required and advisory, set the budget, or turn bypass
on or off, never edit the YAML keys: name the revision.

```bash
node <skill-directory>/scripts/agent-framework.mjs config add-dependency-root <root> [--provisioning link|copy] [--confirm <token>] [--acknowledge-weakening] [--json] [--project <directory>]
node <skill-directory>/scripts/agent-framework.mjs config remove-dependency-root <root> [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config set-dependency-provisioning <link|copy> [--root <root>] [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config add-budget-skippable <check> [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config remove-budget-skippable <check> [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config add-sensitive-input <NAME> [--environment-file <file>] [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config remove-sensitive-input <NAME> [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config add-environment-file <file> [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config remove-environment-file <file> [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config promote-check <check> [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config demote-check <check> [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config remove-check <check> [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config set-budget <seconds> [--confirm <token>] ...
node <skill-directory>/scripts/agent-framework.mjs config set-bypass <true|false> [--marker <marker>] [--require-reference true|false] [--confirm <token>] ...
```

A Sensitive runtime input is declared by name only (`evidence.sensitive_inputs`);
`--environment-file .env` also declares the git-ignored file it may be resolved
from besides the environment (`evidence.environment_files`), when that file is
not declared yet. Nothing reads, asks for, or prints the value: any argument
typed as `NAME=value` is refused as `value-supplied`, naming only `NAME`, and
the value is repeated nowhere — not in the refusal, the document, or an echoed
command. A check moves
between required and advisory, or is removed, only when the policy already binds
it; an identity bound as neither is refused (`check-unbound`), because binding a
check or editing a Verification profile command is not a revision.
`set-bypass true` keeps a marker already declared or takes `--marker`; an
enabled bypass without one is refused with the Gate policy validator's own
reason. Disabling keeps the marker and the reference rule as they are.

Without `--confirm` it writes nothing: it shows each line of the Gate section
the revision changes, before and after, its `previewHash`, and the exact
confirming command. `--confirm <previewHash>` writes exactly that change, and
only while the file is still the one previewed. The candidate is judged by the
same Gate policy validator `--configure-gate` loads and refused with its own
reason. Provisioning is set as a single strategy or, with `--root`, per root:
a single strategy that differs becomes a map in which every other root keeps
the strategy it had, and removing a root removes its map entry. A revision
that would change nothing is refused (`nothing-to-revise`).

Every byte outside the section — comments and formatting included — is kept.
The section itself is rewritten only when it round-trips: it is exactly what
`--configure-gate` writes (`evaluation_gate:` and then one flow-JSON line per
subcontract, `checks`, `budget`, `bypass`, `execution`, `evidence`, nothing
between them), so re-rendering the candidate the same way changes only the
revised line. A hand-written block section, a comment or blank line inside the
section, differently spelled JSON, or a section declared twice is refused by
line with nothing written (`section-unrevisable`, `section-ambiguous`); edit
that one by hand.

On an activated clone a confirmed revision continues into the Gate's own
preview of the re-pin `gate status` names for the changed configuration
(`gate sync --json`), checks it is for exactly the candidate written, and
prints its trusted and candidate identities, any weakening, any refusal, and
its own `--confirm` line. It never confirms that re-pin. A configured clone
that is not activated has nothing to re-pin. `allowed_environment` and
Verification profile commands are never revisable here.

Whether a revision weakens the trusted policy is `gate sync`'s judgement, not
this command's: the revision preview names no weakening, and the re-pin preview
reports the weakenings and refusal exactly as the Gate states them. A demoted or
removed required check is refused there as `weakening-unacknowledged` with no
token, and the next command is the Gate's own acknowledged preview
(`git gate sync --acknowledge-weakening`), which offers the token. Pass
`--acknowledge-weakening` to the revision to have it passed through to the
chained preview instead; the confirming line then carries the acknowledgement
the Gate's token binds. A looser budget or an enabled bypass is not counted as
weaker by the Gate today.

The same operation runs without the Framework command:

```bash
node <skill-directory>/scripts/configure.mjs --project "$PWD" \
  --revise-gate add-dependency-root --root vendor --provisioning copy [--confirm <preview-hash>]
```

Each revision's value is passed as its own option: `--root`, `--provisioning`,
`--check`, `--name`, `--environment-file`, `--file`, `--seconds`, `--enabled`,
`--marker`, `--require-reference`. Both write the same file. A refused revision
prints `{ "status": "refused", "reasonCode", "detail" }` and exits `2`.
Exit status is `0` when the revision is written and nothing follows, `1` when a
confirmation or a re-pin remains, and `2` when it was refused.

## What the repository already implies: `agent-framework config suggest`

To find what the Gate section should declare and does not, ask:

```bash
node <skill-directory>/scripts/agent-framework.mjs config suggest [--json] [--project <directory>]
```

It proposes, each with its evidence and the exact revision command above that
previews it:

- a dependency root (`add-dependency-root`) for each installed directory present
  together with its manifest or a lock file — `vendor/` with `composer.json` or
  `composer.lock`, `node_modules/` with `package.json` or a Node lock file. This
  skill's own table records which directory each one installs into;
- a Sensitive runtime input name (`add-sensitive-input`) for each key
  `.env.example` assigns, with its line. Only the text before `=` is kept; a
  value is never read into any output. A line that assigns nothing, or whose
  key the Gate policy validator refuses as a name, is counted and never shown;
- an environment file (`add-environment-file`) for `.env` when it is present
  and `git check-ignore` says Git ignores it. Its contents are never read.

Anything already declared — the revision would change nothing — is not
proposed, and every proposal is proved by previewing its revision, whose token
is discarded. It applies nothing, offers no "apply all", and never proposes a
check or a Verification profile command: run a proposal's command to see its
preview and token, then confirm that preview. It writes nothing under the clone
or `.git`. A clone with no Gate section proposes nothing and names setup's next
step; without the Gate module a configured clone is refused with
`gate-unavailable`, and a section no revision can rewrite with that revision's
own refusal (`section-unrevisable`). Exit status is `0` with nothing to propose,
`1` when proposals remain or there is no Gate section, and `2` when it could not
run.

## One page to read or share: `agent-framework report --html`

To hand someone the clone's Gate state without asking them to run commands:

```bash
node <skill-directory>/scripts/agent-framework.mjs report --html [--out <path>] [--project <directory>]
```

It writes one self-contained static HTML file and prints its path on a
`report:` line. The page shows the Gate state and health, every remaining step
with its command and the next command, the doctor's findings, and the effective
Gate configuration section. The state, health, steps, and configuration are
rendered from the documents `setup --json` and `config show --json` print, so
the page cannot disagree with them; the doctor's findings are copied from
`gate doctor --json`, which is asked only on a configured or activated clone.
A schema v3 or unconfigured clone, or a clone without the Gate module, gets a
page that says so in those commands' own words.

The page holds no script, stylesheet, font, image, link, or control, escapes
every string it shows, and carries its generation time and the command that
regenerates it: it is a snapshot and goes stale when the clone changes. Two
pages of an unchanged clone differ only in that time. A Sensitive runtime input
appears by name and source only, never a value.

By default it goes to a fresh name in the temporary directory; `--out` names
another file. A path whose real location — after symbolic links and `..` — is
inside the clone, a path that already exists, and a directory that does not
exist are each refused with nothing written; it never overwrites a file. Nothing
under the clone or `.git` changes. Exit status is `0` when the page is written
and neither setup nor config show names anything further, `1` when it is written
and something remains, and `2` when nothing was written.
