# Adapter conformance contract

How the authoritative Git integration and the three supported v1 desktop
preflight surfaces consume one decision, what each of them must declare about
itself, and what has to be proved before any of them may be called *supported*.

Implemented by `scripts/lib/adapters.mjs`. Verified by
`tests/gate-adapters.test.mjs` and the `gate-adapter-conformance` capability.

Traces `FR-ADAPT-001` … `FR-ADAPT-007`, `NFR-COMP-001`, `AC-ADAPT-001`,
`AC-ADAPT-002`, `SG-SUPPORT-001`, `RISK-004`, `Q-003`, `Q-004`.

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

Every adapter declares all eight capability categories for itself. Nothing is
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

## 4. Trigger normalization

Each adapter declares its own native event names and maps them to the contract
triggers. A native event this surface does not declare — including another
client's event name — normalizes to nothing, because a guessed trigger is an
assumed contract.

| Adapter | Surface | `work-complete` | `commit-attempt` |
| --- | --- | --- | --- |
| `git` | `git-pre-commit` | — | `pre-commit` |
| `claude-code-desktop` | local Code tab | `code-tab.turn-completed` | `code-tab.before-commit` |
| `codex-desktop` | local project | `project.task-finished` | *(surface provides none)* |
| `cursor` | local Agent | `agent.run-finished` | `agent.before-commit` |

`work-complete` is mandatory for a desktop surface. The `before-commit-attempt`
mapping is used where the surface provides one and is otherwise simply absent.

These native event identifiers and the native identity field paths beside them
are the *declared* v1 mapping. They are release-qualified per client version:
an untested client version has no verified support claim until the baseline
passes against it (`Q-004`).

## 5. The native boundary

`normalizeNativeInvocation` reads exactly three values out of a native payload —
the native event, the repository root, and the client's session identity —
through that adapter's own declared dotted field paths. Nothing else is ever
copied, so nothing else has a way past the boundary. A payload whose declared
paths do not resolve belongs to some other client and is reported as a
capability failure rather than guessed at.

The request that reaches gate core is exactly the process contract's shape.
`validateEvaluationRequest` rejects unknown fields, so a leak would be refused
by core even if the adapter layer regressed.

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

Each run records its per-check outcome and the exact Gate, Git, Node.js,
client, and operating-system versions it was observed under. Those versions are
an evidence snapshot, never a permanent runtime allowlist.

## 8. Support tiers

Enforcement role and Support tier are independent axes.

| Tier | Applies to |
| --- | --- |
| `supported` | a v1 client, on its local `desktop` variant, whose baseline was run and passed |
| `experimental` | CLI, SSH, remote, cloud, and background-agent variants, and any surface whose baseline has not been run or did not pass |
| `unsupported` | any context without repository filesystem, process execution, and Git access, and any client outside the v1 set |

Two consequences are deliberate:

- **Lack of native blocking never disqualifies a conforming preflight adapter.**
  All three desktop surfaces declare no native blocking and are supported
  anyway; authorization stays with Git (`FR-ADAPT-007`, `SG-SUPPORT-001`).
- **A declaration alone never earns the label.** Remove the baseline evidence
  and the same surface drops to `experimental` (`SG-SUPPORT-001`).

`Q-003` closed the question of additional clients: no client beyond
authoritative Git and these three local desktop surfaces enters v1, and a later
one requires its own Wayfinder effort and its own compatibility evidence.

## 9. Distribution stays dormant

Installing the plugin ships the adapter library and this contract. It registers
nothing. Adapters are self-tested and registered only by the explicit
clone-local Activation transaction, which pins the receipt that proves it
(`SG-DIST-001`). Losing a registered preflight adapter afterwards makes the
clone `degraded`; losing authoritative Git makes it `broken`.
