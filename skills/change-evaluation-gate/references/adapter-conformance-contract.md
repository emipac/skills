[mode overridden: auto -> full, reason=instruction file requires complete content]

# Adapter conformance contract

How the authoritative Git integration and the three declared v1 desktop
preflight surfaces consume one decision, what each of them must declare about
itself, and what has to be proved before any of them may be called *supported*.

Implemented by `scripts/lib/adapters.mjs`. Verified by
`tests/gate-adapters.test.mjs` and the `gate-adapter-conformance` capability.

Traces `FR-ADAPT-001` … `FR-ADAPT-008`, `NFR-COMP-001`, `AC-ADAPT-001`,
`AC-ADAPT-002`, `AC-ADAPT-003`, `SG-HOOK-001`, `SG-OWNER-001`,
`SG-SUPPORT-001`, `RISK-004`, `Q-003`, `Q-004`.

Registration surfaces are implemented by `scripts/lib/adapter-registration.mjs`
and verified by `tests/gate-adapter-registration.test.mjs` and the
`gate-hook-conformance-smoke` capability.

## 1. An adapter is thin

An adapter does exactly four things:

1. **normalize** a native client event and identity into the client-independent
   evaluation request;
2. **confirm trust** for the repository it is about to evaluate;
3. **invoke** the shared `evaluate(request) -> decision` seam non-interactively,
   under a declared timeout;
4. **present** the returned decision.

It does not reimplement policy, choose checks, interpret outcomes, or decide
anything. Gate core carries no branch on a client name; the client names exist
only in the adapter layer, which is the only place that knows a native payload
shape at all.

## 2. One decision, role-correct outcomes

Adapters share a decision. What differs is the Enforcement role, and the role
alone decides the authorization, through `authorizationFor` in `policy.mjs`:

| Role | Outcome | Authorization | Native effect |
| --- | --- | --- | --- |
| `authoritative` (Git) | `passed` / `bypassed` | `allow` | the commit proceeds |
| `authoritative` (Git) | `failed` / `unverified` | `deny` | the commit is blocked, non-zero status |
| `preflight` (desktop) | any | `not-authoritative` | nothing is blocked, zero status |

A preflight surface therefore cannot present `allow` or `deny` however the
decision it was handed happened to be authorized. **Only authoritative Git
authorizes a change.**

## 3. Declared capabilities

Every adapter declares all nine capability categories for itself. Nothing is
defaulted and nothing is inherited from another client: a declaration that
omits a category, or invents one, is rejected rather than filled in.

| Category | States |
| --- | --- |
| `event` | `deterministic`, `normalizedTriggers` |
| `blocking` | `native` |
| `trust` | `model`, `failureIsUnverified` |
| `repository` | `localFilesystemRoot`, `worktreeAware` |
| `session` | `identity`, `parallelIsolation` |
| `filesystem` | `sameFilesAsClient` |
| `git` | `metadata`, `index` |
| `invocation` | `nonInteractive`, `mechanism`, `structuredResult`, `timeoutMs` |
| `feedback` | `channel`, `field`, `none` |

The feedback declaration names the channel by which a running adapter returns a
preflight result to its client, the field that carries it, and the form that
returns no result. An adapter that declares no feedback channel returns none.
The packaged preflight program (`gate-preflight.mjs`) answers only through that
declaration: it never learns a client field name of its own.

## 4. Trigger normalization

Each adapter declares its own native event names and maps them to the contract
triggers. A native event this surface does not declare — including another
client's event name — normalizes to nothing, because a guessed trigger is an
assumed contract.

| Adapter | Surface | `work-complete` | `commit-attempt` |
| --- | --- | --- | --- |
| `git` | `git-pre-commit` | — | `pre-commit` |
| `claude-code-desktop` | local Code tab | `Stop` | *(no such client event)* |
| `codex-desktop` | local project | `Stop` | *(no such client event)* |
| `cursor` | local Agent | `stop` | *(unverified — see below)* |

`work-complete` is mandatory for a desktop surface. No desktop surface declares
a `commit-attempt` mapping: none of them emits a deterministic before-commit
event, and deriving one would be a guessed trigger.

**Event-name casing is per client.** Claude Code and Codex send `Stop`; Cursor
sends `stop`. Trigger matching is exact-string, deliberately: a
case-insensitive compare would erase a real distinction between two clients and
let one adapter accept another's event.

### Unverified triggers

A trigger that is *unobserved* is not the same as one that is *known absent*,
so each adapter records which it has in `unverifiedTriggers`:

| Adapter | `unverifiedTriggers` | Why |
| --- | --- | --- |
| `git` | *(none)* | the hook contract is specified |
| `claude-code-desktop` | *(none)* | the client's event set is enumerated and holds no before-commit event |
| `codex-desktop` | *(none)* | the surface exposes no deterministic pre-commit event |
| `cursor` | `commit-attempt` | never observed, never disproven |

An unverified trigger is recorded and never claimed. It is absent from
`nativeEvents` and from `capabilities.event.normalizedTriggers`, so nothing can
normalize to it, while the open question stays visible to release
qualification instead of being silently deleted (`Q-004`).

These native event identifiers and the native identity fields beside them are
the *declared* v1 mapping. They are release-qualified per client version: an
untested client version has no verified support claim until the baseline passes
against it (`Q-004`).

## 5. The native boundary

`normalizeNativeInvocation` reads at most four values out of a native payload —
the native event, the repository-root candidate, the client's session identity,
and, where the client self-reports it, its exact version — through that
adapter's own declared fields. Nothing else is ever copied, so nothing else has
a way past the boundary. A payload whose declared fields do not resolve belongs
to some other client and is reported as a capability failure rather than guessed
at.

| Adapter | event | session | repository root | client version |
| --- | --- | --- | --- | --- |
| `git` | `hook` | `commitProcessId` | `repositoryRoot` (`path`, `declared-root`) | — |
| `claude-code-desktop` | `hook_event_name` | `session_id` | `cwd` (`path`, `resolve-upward`) | — |
| `codex-desktop` | `hook_event_name` | `session_id` | `cwd` (`path`, `resolve-upward`) | — |
| `cursor` | `hook_event_name` | `session_id` | `workspace_roots` (`path-array`, `resolve-upward`) | `cursor_version` |

Three declarations, not one shared mapping. Today's convergence on
`hook_event_name` and `session_id` is an observation, not a guarantee, and
`FR-ADAPT-004` requires each adapter to own its contract so one client's change
cannot silently redefine another's. Cursor already diverges on event casing,
field name, and field shape.

Client-native payloads carry conversation content and personal data —
`last_assistant_message`, `transcript_path`, `user_email`. That is exactly why
this boundary copies a fixed, tiny set of values and nothing else
(`SG-SECRET-001`). Any fixture derived from a real capture must use synthetic
values with the real shape; real captured values never enter this repository.

### The repository root is resolved, never assumed

The path a client sends is a *candidate*, not a repository root. The same field
has been observed carrying a repository root under one client and a directory
that is not one under another, so each adapter declares its own rule:

- `shape: 'path'` — one path value.
- `shape: 'path-array'` — an array of workspace roots. Exactly one element
  yields a candidate; zero or several yield none, because a multi-root
  workspace has no single repository root and selecting an element would be a
  guess.
- `resolution: 'resolve-upward'` — walk up from the candidate to the first real
  repository root. When no repository contains it, the answer is `unverified`;
  it never falls back to the candidate.
- `resolution: 'declared-root'` — the value already is a repository root. Only
  authoritative Git declares this, because Git's own contract guarantees it.

Resolution only walks *upward*. A client whose path sits above the repository —
observed in the wild — therefore resolves to nothing and reports `unverified`,
which is correct: choosing among the subdirectories below it would be a guess,
and the surface genuinely does not know which repository the user meant.

The request that reaches gate core is exactly the process contract's shape.
`validateEvaluationRequest` rejects unknown fields, so a leak would be refused
by core even if the adapter layer regressed.

## 5a. Declared registration surfaces

A client does not run the Gate because the Gate is installed. It runs it because
an entry naming the Gate's command sits in that client's own configuration
file — and the three v1 surfaces disagree about which file that is, what shape
the entry has, and whether the format is versioned at all. So each adapter
declares its registration surface, and activation, health reconciliation, and
removal act on a desktop registration only through that declaration
(`FR-ADAPT-008`, `AC-ADAPT-003`).

| Adapter | File | File is | Container | Block schema | Event key | Format version |
| --- | --- | --- | --- | --- | --- | --- |
| `git` | — | this clone's own hook chain | — | — | — | — |
| `claude-code-desktop` | `.claude/settings.local.json` | a general settings file, shared with `permissions` | `hooks` | `matcher-group` | `Stop` | none |
| `codex-desktop` | `.codex/hooks.json` | dedicated to hooks | `hooks` | `matcher-group` | `Stop` | none |
| `cursor` | `.cursor/hooks.json` | dedicated to hooks | `hooks` | `flat-command` | `stop` | `version: 1` |

Two block schemas, declared per adapter:

- `matcher-group` — `{ matcher, hooks: [{ type, command }] }`: a matcher group
  wrapping a typed inner array.
- `flat-command` — `{ command }`: no matcher, no type.

The event key is not declared twice. Each registration declares a *trigger*, and
the key is that adapter's own declared native event for it — so registration and
trigger matching can never disagree about a client's event-name casing.

Two surfaces share a block shape today. That is an observation, not a shared
contract: `FR-ADAPT-004`'s intent is that one client's change cannot silently
redefine another's, so the declarations stay separate. Only one surface carries
its own format version, and only that one can signal a breaking change to its
registration format without changing the Gate (`RISK-004`).

### What is owned, and what is never touched

The adapter owns one entry and nothing else in the file. Registration merges
that entry into the declared array; every other key, every other event, and
every other entry is written back exactly as its owner wrote it — including the
`permissions` beside one surface's hooks and the `version` in another's. What a
registration had to create around its own entry is recorded, so a removal that
takes the entry also takes the empty container it created and returns the
document to the shape its owner wrote (`SG-HOOK-001`).

Because these documents are JSON, ownership is proved by content rather than by
a marker comment the format cannot carry: the receipt pins the entry's content
identity and the exact command it names. The Gate's entry is located by that
command — never by position — and removed only when it is still byte-for-byte
what was written.

### Reconciled states

`gate status` reconciles each pinned registration through the declaration and
repairs nothing:

| State | Reported as | Meaning |
| --- | --- | --- |
| `registered` | *(no finding)* | the pinned entry is still exactly what was written |
| `drifted` | `adapter-registration-drifted` | the entry names the Gate command but is no longer the entry the activation wrote |
| `absent` | `adapter-registration-absent` | no entry under the declared event names the Gate command |
| `ambiguous` | `adapter-registration-ambiguous` | several entries do, so which one is the Gate's cannot be told |
| `unverified` | `adapter-registration-unverified` | the declared surface could not be confirmed on disk at all |

**A surface that cannot be confirmed is `unverified`, never registered.** The
Gate does not create a client's configuration file: it cannot know a format it
has never confirmed, including whether that format carries its own version. An
activation whose declared surface is missing completes, pins the surface as
`unverified`, and the clone reports `degraded` — an honest partial integration,
never a claimed one.

Removal is all-or-nothing across every registration and the authoritative hook
together. A drifted or ambiguous entry refuses the whole deactivation and
nothing is removed anywhere; an entry whose command somebody edited is not the
Gate's entry and is left exactly where it is.

None of this is validated by a client-name branch. Activation, the lifecycle
commands, and the registration mechanics name no client at all; every client
name in the module set lives in the adapter declarations
(`SG-OWNER-001`).

### Still unconfirmed

Registration surfaces carry the same evidence caveat as payloads. Only two block
shapes were read from disk, each from one machine and one client version; the
third was reported rather than captured. Whether any of them is stable across
client versions is unknown — which is exactly why the schema-versioning
behaviour is declared rather than assumed. Registration evidence belongs in the
release manifest alongside payload evidence (`RISK-004`, `Q-004`).

## 6. Failure handling

Five failure families, one honest answer. All five reason codes normalize to
`unverified` through the evaluation contract's own table; a broken adapter is
never mistakable for a clean preflight.

| Family | Reason code | Presented as |
| --- | --- | --- |
| `trust` | `prerequisite-missing` | `unverified` |
| `invocation` | `crash` | `unverified` |
| `timeout` | `timeout` | `unverified` |
| `capability` | `configuration-invalid` | `unverified` |
| `output` | `malformed-output` | `unverified` |

On the authoritative surface an `unverified` outcome can only ever become
`deny`.

## 7. The shared compatibility baseline

`runCompatibilityBaseline` executes every check against a real repository and
real Git. None of them is inferred from the declaration.

- `deterministic-event`
- `non-interactive-invocation`
- `repository-identity`
- `session-identity`
- `filesystem-access`
- `git-access`
- `structured-result-visible`
- `trust-failure-unverified`
- `parallel-session-isolation`
- `declared-native-blocking`

Each surface is driven through the field names *and the field shapes* its own
declaration states, so a fixture cannot pass by being written in the Gate's
preferred shape rather than the client's.

Each run records its per-check outcome, the exact Gate, Git, Node.js, client,
and operating-system versions it was observed under, and **how it was driven**.
Those versions are an evidence snapshot, never a permanent runtime allowlist.

| `evidence.payloadSource` | Means |
| --- | --- |
| `captured-client-invocation` | a real client invocation drove this run |
| `synthetic-fixture` | payloads were built from the adapter's own declaration |

An unstated source records as `synthetic-fixture`. A caller that does not say a
real client drove the run has not shown that one did.

## 8. Support tiers

Enforcement role and Support tier are independent axes.

| Tier | Applies to |
| --- | --- |
| `supported` | a v1 client, on its local `desktop` variant, whose baseline was run, passed, and was driven by a real client invocation |
| `experimental` | CLI, SSH, remote, cloud, and background-agent variants; any surface whose baseline has not been run or did not pass; and any surface proved only by injected payloads |
| `unsupported` | any context without repository filesystem, process execution, and Git access, and any client outside the v1 set |

Three consequences are deliberate:

- **Lack of native blocking never disqualifies a conforming preflight adapter.**
  All three desktop surfaces declare no native blocking, and that alone never
  costs them a tier; authorization stays with Git (`FR-ADAPT-007`,
  `SG-SUPPORT-001`).
- **A declaration alone never earns the label.** Remove the baseline evidence
  and the same surface drops to `experimental` (`SG-SUPPORT-001`).
- **A baseline the declaration itself supplied the fixtures for never earns the
  label either.** The fixture and the thing under test come from the same
  source, so a pass proves the declaration is coherent and executable, not that
  it matches the client. Every one of the fourteen mappings declared for v1 on
  fixture evidence was later refuted or left unverified by real captures; that
  is what this rule exists to prevent (`SG-SUPPORT-001`, `Q-004`).

**Current tier: all three desktop surfaces are `experimental`, with reason
`client-invocation-not-observed`.** Their declared fields and event values now
come from real captured payloads, and the offline baseline passes for each —
but no adapter has yet been driven end to end by a real client invocation.
Recording that honestly is the spec-blessed outcome, and producing the missing
evidence is release qualification's job.

`Q-003` closed the question of additional clients: no client beyond
authoritative Git and these three local desktop surfaces enters v1, and a later
one requires its own Wayfinder effort and its own compatibility evidence.

## 9. Distribution stays dormant

Installing the plugin ships the adapter library and this contract. It registers
nothing. Adapters are self-tested and registered only by the explicit
clone-local Activation transaction, which pins the receipt that proves it
(`SG-DIST-001`). Losing a registered preflight adapter afterwards — or losing,
drifting, or being unable to confirm its declared registration surface — makes
the clone `degraded`; losing authoritative Git makes it `broken`.
[… truncated at ~4108 of 4108 tokens — use ctx_read with lines= parameter to see specific sections]
