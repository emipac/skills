# TB-021 — Read the flow-JSON the framework's own writers produce

Status: ready-for-agent
Parent: change-evaluation-gate-feature-spec
Assignee:
Labels: ready-for-agent, defect
Blocked by:
Tracker ID: 21-read-the-flow-json-the-framework-writes
Draft key: TB-021

**Status:** ready-for-agent

**Parent feature contract:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`
**Parent feature spec:** `.scratch/change-evaluation-gate/issues/change-evaluation-gate-feature-spec.md`

## Outcome

Activation can read a schema v4 configuration produced by this framework's own
migration and Gate policy writers, so a repository that followed the documented
path — migrate, then configure — can be previewed and activated rather than
refused at the first command descriptor.

## SRS Traceability

- `FR-CFG-003`, `FR-CFG-004`, `FR-EVAL-001`
- `AC-CFG-002`, `AC-LIFE-002`
- `SG-CMD-001`

## Defect this contract fixes

Found driving a real activation against a real migrated project through the
`change-evaluation-gate` skill. Verify both facts below yourself; they are
reproduced, not inferred.

`TB-018`'s configuration reader
(`skills/change-evaluation-gate/scripts/lib/configuration.mjs`) refuses "flow
collections" — anything whose value starts with `{` or `[` on one line — by
design, so it never silently misreads a construction it does not model.

But **both of this framework's own v4 writers produce exactly that shape**:

- Migration (`TB-001`, `skills/framework-setup/scripts/configure.mjs:439`)
  writes every Command descriptor as `JSON.stringify(...)` on one line:
  `- {"runner":"composer-bin","args":["pint","--dirty","--format","agent"],…}`.
- Gate policy configuration (`TB-002`, `configure.mjs:723`) writes every
  `evaluation_gate` subcontract the same way:
  `checks: {"required":[],"advisory":[]}`.

Reproduced against a file assembled from real migration and policy output:

```
{
  "ok": false,
  "reasonCode": "configuration-unreadable",
  "detail": ".agent-framework.yaml could not be read at line 22: flow collections are outside the supported configuration subset."
}
```

Line 22 is the first Command descriptor — the one migration itself wrote.

**This is not one project's problem.** Every repository that runs the
documented `--migrate-v4` then `--configure-gate` flow — the exact path
`docs/framework-guide.html` walks a reader through — produces a configuration
the Gate's own reader cannot parse. Activation is blocked before preview on
every one of them.

The reader's module doc states it is built for *"the block-structured subset
the framework configuration is written in."* That premise is false: the
framework's own writers do not write that subset. `TB-018` and `TB-001`/`TB-002`
were each internally consistent and mutually incompatible, which is exactly the
failure mode every ticket in this chain (`TB-017` through `TB-020`) has found —
a fixture, or in this case a hand-assembled real-shape file, supplying the one
thing nothing else in the suite provided.

**The fix direction is verified, not assumed.** The same semantic content,
hand-converted to genuine block-mapping YAML (`runner:` / `args:` as nested
keys rather than one inline object), parses successfully through the existing
reader with no other change:

```
{ "ok": true, "value": { … "commands": { "format": { "backend": [ { "runner": "composer-bin", "args": ["pint", "--dirty", "--format", "agent"], … } ] } } … } }
```

So the reader's block-mapping model is already capable of representing this
data. What is missing is acceptance of the *equivalent* flow-JSON spelling the
writers actually emit.

## Domain Concepts

Gate configuration section, Command descriptor, Verification profile, Trusted
gate configuration.

## Approach and Tradeoffs

Do not widen the reader into general flow-YAML support. Anchors, aliases,
tags, unquoted flow scalars, and YAML's own flow-mapping shorthand remain
refused exactly as `TB-018` designed — that refusal is deliberate and stays.

Instead, narrow the fix to the one thing the writers actually produce: a
**strict JSON literal** occupying a scalar position. Where the reader would
currently refuse a value because it starts with `{` or `[`, attempt
`JSON.parse` on the exact trimmed remainder of the line first. A value that
parses as valid JSON is accepted and normalized into the same shape a block
mapping or sequence would have produced; a value that does not parse is
refused exactly as today, with the same message.

This is safe to scope tightly because JSON is a formally unambiguous grammar —
unlike general YAML flow syntax, there is no guessing involved in accepting
it. The refusal boundary does not move for anything else.

Fixing the READER rather than the WRITERS is deliberate. Migration and Gate
policy configuration both already produce their output atomically, from
validated data, through `JSON.stringify` — asking them to hand-roll nested
block YAML instead reintroduces exactly the transcription-drift risk this
framework's writers exist to avoid. The reader is the newer, narrower
component; it should learn the one shape its two siblings already commit to
rather than the other way around.

## Architecture Boundary and Public Seam

The boundary is the configuration reader's scalar/value parsing inside
`configuration.mjs`. The public seam is `readRepositoryConfiguration` and
`parseConfigurationDocument`'s `{ ok, value, reasonCode, detail }` result.
First red test: a file containing one Command descriptor written exactly as
migration writes it — `JSON.stringify` on one line — is read successfully and
produces the same structured value a hand-written block-mapping equivalent
would.

## Safeguards and Invariants

- `SG-CMD-001`: acceptance of a flow-JSON value never becomes acceptance of
  shell text, an unresolved executable, or hidden complex behavior. The
  accepted grammar is strict JSON only; nothing about command execution
  safety changes.
- The reader's refusal of anchors, aliases, tags, block scalars, tab
  indentation, and general (non-JSON) flow syntax is preserved unchanged, with
  the same reason messages, so this contract closes a real gap without
  reopening the ambiguity `TB-018` was built to avoid.

## Prohibited Behavior and Non-goals

Do not implement a general YAML flow-mapping or flow-sequence grammar. Do not
accept single-quoted-string flow syntax, unquoted flow scalars, or trailing
commas — none of which is valid JSON and none of which either writer produces.
Do not change what migration or Gate policy configuration write. Do not widen
scope into activation, the packaged runner, or the lifecycle command surface.

## Risk and Decision Impacts

- No parent risk disposition changes. This restores compatibility `AC-CFG-002`
  and `AC-LIFE-002` already require between two already-approved writers and
  an already-approved reader; it does not widen the command surface or weaken
  a safeguard.

## Acceptance Criteria

- [ ] `AC-CFG-002`, `AC-LIFE-002`: a configuration file containing Command
  descriptors written exactly as `TB-001` migration produces them, and an
  `evaluation_gate` section written exactly as `TB-002` Gate policy
  configuration produces them, is read successfully by
  `readRepositoryConfiguration`, and the resulting value is identical to what
  the same semantic content written as block-mapping YAML produces.
- [ ] `SG-CMD-001`: a value that is neither valid JSON nor a supported block
  construct is still refused with the existing reason message; general
  YAML flow syntax (anchors, aliases, tags, unquoted flow scalars) remains
  refused by name, unchanged.

## Verification Matrix

| Layer | Scope | Evidence | Command or capability | Required |
| --- | --- | --- | --- | --- |
| focused | both | `AC-CFG-002`, `AC-LIFE-002`, `SG-CMD-001`: fixtures built from real migration and Gate policy writer output, proving they now read successfully, plus negative fixtures proving general flow-YAML stays refused | `npm run test:unit` | Yes — configured unit suite owns the configuration reader seam |
| smoke | both | `AC-CFG-002`: an activation preview against a genuinely migrated-and-configured fixture succeeds rather than refusing at `configuration-unreadable` | `gate-activation-smoke` capability extended by this slice | Yes — the existing activation selector should exercise a real migration-shaped file, not only a hand-written block-YAML fixture |

Frontend build and browser evidence are inapplicable; this slice changes
configuration parsing, not a frontend surface.

## Blocked By

None. `TB-001` (migration), `TB-002` (Gate policy configuration), and `TB-018`
(the configuration reader) are all done.

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

`TB-018`'s own tests write configuration fixtures by hand, in block-mapping
YAML, because that is what its module doc assumed the framework produces. Its
existing capability (`gate-activation-smoke`) likewise builds its fixture
configuration directly rather than through migration or Gate policy
configuration. Neither test path ever fed the reader a file either sibling
writer actually produces, so the two modules were never checked against each
other — the same shape of gap `TB-017` through `TB-020` each closed, this time
between the reader and the writers rather than inside the activation
transaction.
