# TB-053 — Confirm the preview that was shown

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 53-confirm-the-preview-that-was-shown
Draft key: TB-053

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

The command a preview tells an operator to run next performs that preview. An
operator who follows the Gate's own printed instruction gets the operation they
previewed, or a refusal that names what they omitted — never a different
operation that succeeds.

## SRS Traceability

- `FR-LIFE-004`, `FR-LIFE-015`, `FR-LIFE-016`
- `AC-LIFE-008`, `AC-LIFE-009`, `AC-LIFE-010`
- `SG-LIFE-001`, `SG-TRUST-001`
- `NFR-OPER-001`
- `RISK-004`

## Defect this contract fixes

Found by a maintainer activating Cursor on a real project, following the
printed instructions exactly.

Verified at `operator-surface.mjs:1678`:

```js
/** The one line every confirmable command ends its preview with. */
const renderConfirmation = (command, observation) => line(
  'next',
  observation.confirmationToken === null || observation.confirmationToken === undefined
    ? 'nothing to confirm'
    : `gate ${command} ${CONFIRMABLE_COMMANDS[command]} ${observation.confirmationToken}`,
);
```

The `next:` line is composed from the command name and the token alone. It
never sees the selectors that produced the preview, so it cannot echo them, and
for every command whose selectors shape the preview it prints an instruction
that cannot perform what was just shown.

Verified against `SELECTORS` — four of the nine commands are affected:

| Command | Selectors the `next:` line drops |
| --- | --- |
| `activate` | `--client`, `--actor` |
| `prune` | `--evaluation`, `--before`, `--reclaim` |
| `repair` | `--hook-script` |
| `uninstall` | `--asset` — required, so the confirmation names nothing to remove |

`status`, `locks`, `update`, `deactivate` and `cleanup` accept no
preview-shaping selector, so their printed line is complete.

### The reproduction, in full

```
$ gate activate --client cursor
client: cursor (trust model repository-hook-registration)
adapters: git, cursor
next: gate activate --confirm sha256:c7523753…

$ gate activate --confirm sha256:c7523753…
client: git (trust model repository-hook-registration)
adapters: git
next: gate activate --confirm sha256:2b3c34c9…
confirmed: sha256:c7523753…
performed: false
refused: preview-mismatch
Nothing was activated (preview-mismatch): this clone no longer matches the
activation that token named. Preview again and confirm the new preview.
```

`--client` defaults to `git`, so the confirmation recomputed a **git** preview,
compared it against a token bound to a **cursor** preview, and refused.

### What is right, and what is wrong

The refusal is correct and is the safeguard working. `FR-LIFE-015` requires a
mismatch to change nothing, and nothing was changed. That is not in question and
must not be weakened.

Three things are wrong.

**The Gate printed a command that cannot succeed.** An operator following the
tool's own instruction reaches a refusal through no error of their own.

**The refusal names the wrong cause.** *"This clone no longer matches"* points
at the clone. The clone did not change; the invocation did. `NFR-OPER-001`
requires a denial to be diagnosable without reading logs, and this one sends the
reader to look for drift that is not there — the maintainer who hit it spent the
next step checking configuration identities.

**The recovery path silently changes the operation.** The refusal prints a fresh
valid token for the git-only preview it just computed. An operator who follows
the printed instruction a second time activates successfully, gets a healthy
receipt, and does not get Cursor. Nothing in the receipt, the status output, or
the evidence records that Cursor was ever asked for. This is the serious half:
a wrong instruction that fails loudly is a nuisance, and one that succeeds at
something else is a defect that ends with an operator believing a surface is
active when it is not.

### Why nothing caught it

For `activate`, omitting `--client` yields `git`, the default — so in every
fixture and every real activation before this week, the wrong line and the right
line were the same string. `TB-046` made a non-default client activatable for
the first time, which is what made the omission observable. Same root as
`TB-048`: that slice opened a door, and what was behind it had never run.

## Domain decisions this contract settles

**The preview owns its instruction.** A confirmation line is not a template
built from a command name; it is a statement about the operation that was just
previewed, and it must carry whatever that operation needed to be what it is.

**The refusal stays.** Nothing here loosens the binding between a token and its
preview, and no selector may be inferred, remembered, or defaulted at
confirmation time from anything other than the operator's own invocation. The
fix is that the instruction is right, not that the check is softer.

## Domain Concepts

Preview, Confirmation token, Confirmation instruction, Preview-shaping selector,
Operator surface, Refusal diagnostic.

## Approach and Tradeoffs

Verified: `SELECTORS` already declares, per command, every selector and how it
is read — `value`, `repeatable`, or `confirmation`. The information needed to
render a complete instruction is already parsed and already structured; it
simply does not reach `renderConfirmation`.

Verified: `renderConfirmation` is shared by every confirmable command, so one
correction reaches all four affected commands rather than four separate ones.

Proposed — render the instruction from the invocation that produced the
preview. The implementer decides how the parsed selectors reach the renderer and
states it. A selector read as `repeatable` appears once per value.

Proposed — a value that needs quoting is quoted. Verified: this repository's own
resolved PHP path is `/Users/emipac/Library/Application Support/Herd/bin/php`, so
paths containing spaces are not hypothetical, and `--hook-script` and `--asset`
both take paths. An instruction that cannot be pasted is the same defect in a
new place.

Proposed — say what was actually different. A `preview-mismatch` whose cause is
a selector the confirmation did not carry should name that selector rather than
report that the clone changed. The implementer establishes whether the
confirmation path can distinguish the two cases; if it cannot do so reliably,
say so with evidence rather than guessing in the message, and prefer a wording
that does not assert a cause it has not established.

Proposed — decide what to print on a refusal, and justify it. The refused
output currently offers a token for the operation it recomputed, which is how a
cursor activation becomes a git activation. Suppressing it, qualifying it, or
keeping it are all defensible; choosing silently is not. Whatever is chosen must
not leave an operator one paste away from confirming an operation they did not
ask for.

Deliberately not weakening the token binding, not inferring a selector from a
previous invocation, not persisting selectors between invocations, and not
adding a flag that forces a confirmation past a mismatch. Deliberately not
changing what any command does once correctly confirmed.

## Architecture Boundary and Public Seam

The boundary is between the operation an operator previewed and the operation
their next command performs. The public seam is `renderConfirmation` and the
confirmation instruction every preview prints, together with the refusal
diagnostic on the confirmation path.

First red test: the `next:` line of `gate activate --client cursor` names
`--client cursor`, and running exactly that line performs the cursor
activation — where today the printed line performs nothing and offers a token
for a different one.

## Safeguards and Invariants

- `FR-LIFE-015`: a confirmation whose recomputed preview differs still performs
  nothing. This slice makes the correct instruction reachable; it does not make
  the check weaker.
- `FR-LIFE-016`: a token stays bound to repository, configuration, selected
  adapter, and preview identities.
- `SG-LIFE-001`: nothing is repaired, deleted, or activated without an explicit
  confirmation of exactly what was previewed.
- `SG-TRUST-001`: the Gate reports what it did. An operator must never end an
  activation believing a surface is registered when it is not.
- `NFR-OPER-001`: a refusal names what the operator can act on.
- No command's behaviour changes once it is correctly confirmed.

## Prohibited Behavior and Non-goals

Do not weaken, bypass, or add an override to the preview/confirmation binding.
Do not infer, default, remember, or persist a selector at confirmation time from
anything but the operator's own invocation. Do not change what `activate`,
`prune`, `repair`, or `uninstall` performs once correctly confirmed. Do not
change the confirmation token's derivation. Do not add a new command, a new
flag, or a stored session. Do not touch the five commands whose instruction is
already complete, beyond whatever the shared renderer requires.

## Risk and Decision Impacts

- `RISK-004`: a claimed supported adapter is only supported if it can actually
  be activated. An operator following the printed instructions activated git
  while asking for cursor, which is the failure this risk describes arriving by
  an unexpected route.
- No safeguard is withdrawn. `FR-LIFE-015` is enforced exactly as it is today.

## Acceptance Criteria

- [ ] `FR-LIFE-004`: for each of `activate`, `prune`, `repair`, and `uninstall`,
  the `next:` line names every selector that shaped the preview, proved by
  running the printed line and having it perform that preview.
- [ ] `AC-LIFE-009`: `gate activate --client cursor` followed by exactly its own
  printed instruction activates cursor, and the result names `client: cursor`
  and both adapters.
- [ ] A selector value containing a space is quoted so the printed line can be
  pasted and run unchanged.
- [ ] `AC-LIFE-008`, `FR-LIFE-015`: a confirmation whose recomputed preview
  differs still performs nothing, proved by a fixture that alters the clone
  between preview and confirmation.
- [ ] `NFR-OPER-001`: a `preview-mismatch` caused by an omitted selector does not
  report that the clone changed, and the report states what the confirmation
  path can and cannot distinguish.
- [ ] The refused output cannot leave an operator one paste away from confirming
  an operation they did not request; the report states what was chosen and why.
- [ ] The five commands with no preview-shaping selector print exactly what they
  print today.
- [ ] `AC-LIFE-010`: `gate repair` and `gate cleanup` behave exactly as they do
  today once correctly confirmed.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `FR-LIFE-004`, `NFR-OPER-001`, `AC-LIFE-008`, `AC-LIFE-010`: instruction-round-trip fixtures for all four affected commands, a quoted-value fixture, an unchanged-instruction fixture for the other five, a mismatch-still-performs-nothing fixture, and `gate repair` and `gate cleanup` unchanged once correctly confirmed | `npm run test:unit` | Yes — the unit suite owns the operator surface, its rendering, and the repair and cleanup paths |
| smoke | both | `AC-LIFE-009`, `AC-LIFE-008`: a real clone previewed for a non-default client and confirmed with that preview's own printed line activates that client, and a clone altered between preview and confirmation still activates nothing | `gate-activation-smoke`, extended by this slice | Yes — that capability owns real activation against a real clone, and the defect is only observable for a non-default client |

Frontend build and browser evidence are inapplicable; this slice changes local
command rendering and one diagnostic.

## Blocked By

None.

## Unresolved Assumptions

None.

## Readiness

- [x] The outcome is a complete vertical behavior.
- [x] Acceptance criteria trace to the SRS and feature contract.
- [x] The public seam and first red test are identified.
- [x] Safeguards and non-goals are explicit.
- [x] Risks and resolved decisions are traced to the parent contract.
- [x] Blocking edges exist and are acyclic.
- [x] No unresolved assumption blocks the start.
- [x] The ticket fits one fresh implementation context.
- [x] User-facing and frontend evidence requirements are covered or explicitly inapplicable.

## Why existing coverage missed this

Every fixture that confirms an activation constructs its own confirmation
invocation rather than reading the one the preview printed, so the printed line
has never been executed by anything. And for the only client any fixture ever
activated — `git`, the default — the incomplete line and the complete line are
the same string, so even a fixture that had executed it would have passed. The
defect needed a non-default client to become visible, and until `TB-046` no
non-default client could be activated at all.
