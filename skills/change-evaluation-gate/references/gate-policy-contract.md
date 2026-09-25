# Gate policy contract

Repository Gate policy decides *which* configured checks block, *how long* one
evaluation may take, and *whether* a supported bypass exists. It names check
identities and limits only: Verification stays the sole owner of command
definitions, profiles, scopes, and applicability (`SG-OWNER-001`).

## Subcontracts

The `evaluation_gate` section of schema v4 has exactly five subcontracts, and
nothing else is expressible. A baseline exemption or a persistent pass cache
therefore cannot be configured into existence (`FR-POL-004`).

| Subcontract | Contents |
| --- | --- |
| `checks` | `required` and `advisory` check identities |
| `budget` | `total_seconds`, the confirmed total evaluation budget |
| `bypass` | `enabled`, optional `require_reference`, and the commit-visible `marker` |
| `execution` | execution policy, including `budget_skippable` advisory identities, the `dependency_roots` a check needs provided, and the `dependency_provisioning` strategy that provides them |
| `evidence` | evidence policy: lower retention ceilings, the `sensitive_inputs` whose values Evidence must never keep, and the `environment_files` those inputs may be resolved from |

No subcontract may carry a command, runner, argument list, working directory,
allowed environment, evidence category, profile, capability, activation, trust,
or receipt property. Plan validation rejects those names outright.

Plan validation also rejects a missing subcontract, a non-positive total budget,
an identity bound as both required and advisory, a duplicate identity, a
required identity listed as budget-skippable, and an enabled bypass with no
configured marker. There is no universal timeout or budget default to fall back
on (`Q-007`, `NFR-PERF-001`).

## Severity

A provider *proposes* a binding; only repository policy decides. When a policy
is configured, a check it does not name as required is recorded as advisory and
cannot block. An advisory outcome never compensates for a required one, and an
advisory failure is never silently promoted to blocking (`SG-POL-001`).

A policy that cannot bound the evaluation is one `configuration-invalid`
diagnostic and the decision is `unverified`: an unusable policy fails closed
rather than evaluating with invented limits.

## Authorization binding

Final authorization is recomputed conjunctively over the required checks of a
decision that still describes the exact current snapshot, configuration,
environment, and runner and provider tool environment. A completed pass from an
earlier evaluation never authorizes a changed snapshot; it is `unverified` with
a `snapshot-mismatch` or `integrity-drift` diagnostic (`FR-POL-003`,
`SG-EVAL-001`). Reauthorization can only be as strict as the recorded decision:
it never upgrades a recorded `unverified` because the checks read positively.

There is no baseline exemption and no persistent pass cache in v1.

## Budget

Both limits apply to every check: the project-confirmed per-check timeout and
the remaining total budget, whichever runs out first. A timed-out check
terminates its whole process group, not only its direct child, so background
completion can never authorize the current commit (`FR-POL-005`).

Only advisory checks the project listed in `execution.budget_skippable` may be
dropped when the remaining budget cannot cover them; they are recorded as
`budget-exhausted` and stay visible as advisories. Required work is never
skipped: it is attempted with whatever budget remains, and a required check the
budget cannot cover at all becomes blocking `unverified`.

`execution.dependency_roots` names the repository-relative directories a
project installs its dependencies into — the ones its own tools load before
they can read any code. A materialized snapshot holds tracked content only, so
without this a tool starts inside the snapshot and cannot find its autoloader
or module tree. Each declared root is provided beside the snapshot and is never
graded: it is outside the snapshot identity, outside `changedPaths`, and
outside the immutability re-check, so a tool writing into its own cache never
becomes `snapshot-mismatch`. A root that is absolute, or that would climb out
of the repository, is refused by this contract. A declared root the clone has
not installed is `dependency-root-unavailable` and denies, rather than becoming
a fatal error from inside somebody's tool. Nothing is ever installed by the
gate.

`execution.dependency_provisioning` says *how* those roots are provided. It is
`link` or `copy`, and it defaults to `link` when absent, so a clone that
declares nothing behaves exactly as it always did.

The declaration has two shapes. A scalar applies one strategy to every declared
root. A map names a strategy per root — `{"vendor": "copy"}` — and a root the
map does not name is provided by `link`. A map may only name roots listed in
`dependency_roots`: a key naming anything else is refused by name, never
ignored. The gate never infers a strategy from a root's contents, name, or
size; a project pays to copy exactly the roots it said need a real directory.
Under a map the preview, the receipt, and the evidence record every declared
root with the strategy it received; under a scalar they record the scalar.

| Strategy | What a check is given | When a project declares it |
| --- | --- | --- |
| `link` | a symbolic link to the clone's own installation | the default; nothing is copied and the root costs nothing to provide |
| `copy` | a real directory beside the snapshot | the project's tooling resolves a path to its realpath |

The difference is only visible to a tool that asks where a file *is*. Under
`link` such a tool follows the link out of the execution root and concludes that
the project it is grading is the original repository — so PHP's `__DIR__` inside
an autoloader reports the wrong project root, a TypeScript import resolver
classifies the project's own aliased imports as external, and this runtime's
module resolver reports a module's realpath outside the tree being graded. Each
one then reports an environment fault as a fault in the code, which is the
failure this declaration exists to end.

The strategy is **declared, never detected**. The gate does not read the
operating system or the filesystem and choose (`NFR-PORT-002`): a project on a
filesystem that supports copy-on-write clones and one that does not write the
same word and get the same behaviour at different speeds.

`copy` costs real time and real disk against the budget, so it is declared
rather than assumed. A dependency tree of about thirty-four thousand files was
measured at roughly ten seconds to provide, about two to reclaim, and 373 MiB of
free space per evaluation. The copy asks for a copy-on-write clone, but that is
a request the runtime may decline: on the environment this release claims it is
declined silently, and the bytes are really written. Nothing depends on the
answer — the copy succeeds either way — which is why the strategy that was
applied is recorded and the clone mechanism underneath it is not.

A `copy` that cannot be performed is never quietly served as a link. The root is
reported `dependency-root-unavailable` exactly as an uninstalled one is, and the
partial tree the attempt created is removed. A strategy this gate cannot perform
at all is one `configuration-invalid` diagnostic, not a fallback.

What was provided, what was not, what was refused, and which strategy provided
them all reach the decision at `environment.dependencies`, so a check that
failed because a root was unavailable is diagnosable without rerunning anything
(`NFR-OPER-001`).

## Sensitive inputs

`evidence.sensitive_inputs` names the Sensitive runtime inputs a project's
checks receive — a list of environment variable **names**, and nothing else.
It lives in `evidence` because that is the only thing it governs: what the Gate
keeps. At evaluation time each approved name is resolved to a value — from the
environment the runner itself runs in, else from a declared environment file
(below) — and that value is removed — raw and in every encoded form the store
recognizes — from every envelope, blob, decision, and Lifecycle event before
anything is written. Only the built-in patterns protect a project that
declares nothing, and they catch a secret only in a shape they recognize
(`NAME=value`, an authorization header, a URL with user info, a PEM block); a
bare value in a stack trace is caught only by a declared rule (`FR-CFG-006`,
`NFR-SEC-003`, `SG-SECRET-001`).

```yaml
evaluation_gate:
  evidence: {"sensitive_inputs": ["APP_KEY", "MAIL_PASSWORD"]}
```

- A **value** can never be declared here. Anything that is not a list of
  environment variable names — an assignment, an object, a duplicate — is
  refused by plan validation before activation, as
  `evaluation_gate.evidence.sensitive_inputs`.
- The declaration reaches the Activation receipt as names only, through the
  preview (`runtime inputs: APP_KEY, MAIL_PASSWORD`), so consent is granted
  against it. It is part of the configuration identity the receipt pins:
  **adding, removing, or renaming a declaration after activation is
  trusted-configuration drift**, and the clone must be re-pinned — `gate sync`
  — before it authorizes again.
- **Approval at activation is the consent to hand the value over.** An
  approved name reaches every check through its environment, whether or not
  the check's descriptor lists it in `allowed_environment` — that list governs
  pass-through of *ambient* variables and keeps exactly that meaning. The value
  is merged after the ambient pass-through; neither can shadow the other,
  because a name the runner's environment sets is resolved from there.
- A declared name **resolved from no source** at evaluation time is not an
  error and not a silent pass. The evaluation proceeds, no rule can be armed for
  that name, and the envelope records it under `redaction.unresolved` beside
  the armed `redaction.secrets` — with `searched`, the sources that were
  consulted, when a file was declared. A project that declares nothing writes
  exactly the envelope it always did.
- Which names are Sensitive is the project's declaration; Gate core knows no
  variable name, tool, or stack (`SG-OWNER-001`).

### Environment files

`evidence.environment_files` names the files a declared Sensitive input may be
resolved from when the runner's own environment does not set it — a list of
repository-relative **paths**, in the order they are consulted. It sits beside
`sensitive_inputs` because it changes only where an already-declared name is
looked up. A stock Laravel application keeps `APP_KEY` in a git-ignored `.env`
the snapshot cannot contain and exports it from no shell; this is how its test
suite boots inside the snapshot (`FR-CFG-006`, `TB-059`).

```yaml
evaluation_gate:
  evidence: {"sensitive_inputs": ["APP_KEY"], "environment_files": [".env"]}
```

- **Resolution order, per approved name:** the runner's environment first;
  then each declared file in declaration order; the first value found wins;
  a name found nowhere is `unresolved`. A name the environment sets never has
  a file consulted for it, and a file is opened only while some approved name
  is still unresolved. The envelope records which source each armed name came
  from (`redaction.secrets[].source`: `environment` or the file's declared
  path) and what each declared file turned out to be
  (`redaction.environmentFiles[].status`: `read`, `not-consulted`, `missing`,
  `tracked`, or `unreadable`).
- **Only approved names are read.** A file is parsed far enough to learn which
  name each line assigns; a line assigning a name the receipt did not approve
  is skipped without its value being decoded, kept, or reported. The file is
  never copied into the snapshot, the store, or anywhere else.
- **Grammar:** `NAME=value`; an optional `export ` prefix; unquoted values
  (trailing ` #` comment stripped), single-quoted values (literal), and
  double-quoted values (`\"` and `\\` unescaped); `#` comment lines; blank
  lines. A later assignment of the same name in one file replaces an earlier
  one. A line this grammar cannot parse for an approved name — an unterminated
  quote, an empty value — yields no value, which is the `unresolved` case, not
  an error. No dotenv or YAML library is involved.
- A path that could leave the repository, an absolute path, a duplicate, or
  anything that is not a list of paths is refused by plan validation as
  `evaluation_gate.evidence.environment_files`. A declared file that is
  **tracked** is refused at resolution time and never read: it is already in
  the snapshot, and reading it again would be a second source.
- The value reaches the check the way `materializeRuntimeInputs` has always
  provided: an owner-only (`0600`) file inside a `0700` directory under the
  execution root, and the check's environment. The directory is a child of the
  execution root under the operating system's temporary directory; it is
  outside the snapshot's path list, identity, and immutability re-check, and
  it is removed with the root — in the runners' `finally`, by the signal
  disposition, and by the orphan sweep. Stated plainly: a secret lives
  transiently under the OS temporary directory, owner-only, while a check runs.
- One resolution feeds both consumers. The values the materializer hands a
  check are the values the redactor was armed with, before the store opened,
  so a value cannot reach a check without also reaching the redactor
  (`SG-SECRET-001`, `AC-EVID-001`).
- `framework-setup` writes `sensitive_inputs: ["APP_KEY"]` and
  `environment_files: [".env"]` into the section it drafts for a Laravel
  profile, and nothing for any other profile. That is the profile's knowledge;
  no variable name or file name lives in Gate core (`SG-OWNER-001`).

## Bypass

Bypass is optional and may be disabled outright (`FR-POL-008`). A bypass grant
is supplied to evaluation out of band — the process request carries no policy
override — and names its actor, reason, optional reference, request time, and
the exact snapshot identity it applies to.

### Where a grant comes from

A grant enters from outside the evaluation, and from exactly one place: a
confirmed `gate bypass` (`TB-052`). It is the same two invocations every
mutating command on the operator surface takes. `gate bypass --reason <text>
[--reference <ref>] [--actor <name>]` materializes the staged index through the
same capture the authoritative runner uses, prints the snapshot identity a
commit would carry and the paths it stages, applies the policy's own
`resolveBypass` rule to the grant it would write — so a disabled policy, an
unconfigured marker, a missing reason, or a missing policy-required reference
is refused by the same code the hook would refuse it with — and offers a token
only when the grant is grantable. The token binds the snapshot identity: staging
anything between the preview and the confirmation refuses the confirmation.

The confirmation writes one grant file, `bypass/grant.json` under the
clone-local Evidence store, holding the five identity fields and the marker,
and appends one `bypass` Lifecycle event. There is one pending grant per clone,
never a queue; a later confirmation replaces it.

The authoritative runner reads the grant once, before any check process
starts, hands it and the clone's durable one-shot ledger to evaluation, and
removes the file afterwards whether the grant was applied or refused — a grant
is spent by the commit attempt that reads it, and only a fresh `gate bypass`
grants another. Nothing on the evaluation path writes a grant: a check runs
after the grant was read and inside a materialized root, and a file that is not
of the published grant shape yields no grant at all rather than a partial one
(`SG-BYP-001`, `SG-CFG-001`, `SG-EVAL-001`).

The preflight runner honours no grant. It grades the working tree, not the
index, so its snapshot identity is never the one a grant names; and it
authorizes nothing, so there is nothing for a bypass to change and no reason to
let a preview spend a maintainer's one shot.

A denied commit on a clone whose policy enables bypass says so, naming
`gate bypass`; a clone whose policy disables it prints exactly what it always
printed (`FR-POL-008`).

A grant is refused, leaving the graded outcome untouched, when:

| Rejection | Meaning |
| --- | --- |
| `bypass-disabled` | Repository policy disables bypass |
| `marker-unconfigured` | Bypass is enabled with no commit-visible marker |
| `reason-missing` | No reason was supplied |
| `reference-missing` | Policy requires a reference and none was supplied |
| `snapshot-mismatch` | The grant names a different snapshot |
| `bypass-already-consumed` | The grant is one-shot and was already used |
| `nothing-to-bypass` | The decision passed on its own |

An accepted bypass sets the outcome to `bypassed` — never `passed` — preserves
every failed and unverified check exactly as graded, records actor, reason,
reference, snapshot identity, and the preserved failures, carries a
machine-readable evidence identity, and supplies the configured commit-visible
marker for the Git adapter to emit (`FR-POL-006`, `FR-POL-007`, `SG-BYP-001`).

Bypass and local enforcement are cooperative, not tamper-proof: the record
states `tamperEvident: false`, and the Gate never claims to prevent raw Git
`--no-verify`, hook removal, or machine-owner tampering (`SG-TRUST-001`,
`RISK-001`).

### The commit-visible marker

An applied bypass carries the configured marker in the decision, in the
ledger record, and in the `bypass` Lifecycle event, and the hook prints it
beside the `bypassed / allow` line. That is where its commit visibility ends
today, and this contract says so rather than implying more: the authoritative
surface is `pre-commit`, which runs before a commit message exists and answers
by exit status alone, so the hook cannot write the marker into the message.
The maintainer carries the printed marker into the message; a later slice
that registers a message-shaping hook would be where the Gate emits it itself.

## Declared but not yet implemented

- Bypass evidence is identified inside the decision and persisted with it in
  the decision's own envelope; it is not a separate envelope of its own.
- The commit-visible marker is printed for the maintainer and recorded, not
  written into the commit message (see above).
