# Packaged the authoritative Git hook runner

Delivered TB-018, a defect slice: an activated repository had nothing to invoke.
`registerOwnedHook` wrote a `/bin/sh` shim around a hook program the CALLER
supplied, and no program was ever shipped. Every top-level script in the Gate
skill is release evidence — smoke, conformance, portability — and each supplied
its own fixture runner, so the packaged path did not exist to be exercised.

- Shipped the entry point. `skills/change-evaluation-gate/scripts/gate-precommit.mjs`
  is the program a registered hook points at, exposed as the
  `change-evaluation-gate-precommit` bin. A real activation attempt had pointed
  its shim at `scripts/lib/evaluate.mjs` — a pure library that prints nothing
  and exits `0` — which would have been a silent no-op passing every commit
  while the maintainer believed the clone was enforced (`FR-EVAL-001`).
- Added no policy. The runner resolves the repository root, reads the clone's
  configuration and Activation receipt, builds the versioned request for the
  `commit-attempt` trigger, and calls the existing `evaluate` seam. It
  reimplements no part of evaluation and duplicates no Evidence ladder.
- Graded the proposed snapshot. The request names `git-index`, so repairing the
  worktree after staging never authorizes the staged change (`SG-EVAL-001`).
- Exited `0` only on `allow`. An unreadable configuration, an absent Gate policy
  section, a policy the contract rejects, a missing or unreadable receipt, an
  unresolved runner, an uncomposable descriptor, an internal crash, and a
  decision this runner cannot read each exit non-zero with a stated reason.
  Absence of evidence is never success (`NFR-REL-003`).
- Answered the activation self-test deliberately. `TB-020` executes the hook
  program against a known-failing subject and accepts any non-zero exit as proof
  of denial — which a merely crashing runner would also satisfy, fail-closed for
  the wrong reason, and it would then block every real commit too. So the
  subject named in `CHANGE_EVALUATION_GATE_SELF_TEST` is read and judged: it is
  denied because it carries a failing required check, and a subject that cannot
  be read, declares an unmodelled version, or carries nothing deniable is
  refused by its own distinct reason.
- Built the supported configuration reader. Nothing parsed `.agent-framework.yaml`
  into an object: `grader-surface.mjs` only names it as a control surface and
  `lifecycle.mjs` only removes top-level keys line by line. The activation
  attempt that surfaced this defect hand-rolled a regular-expression parser
  whose `replace(/'/g, '"')` corrupts any value containing an apostrophe.
  `scripts/lib/configuration.mjs` reads the block-structured subset properly and
  refuses by name anything outside it — anchors, aliases, tags, flow mappings,
  block scalars, tab indentation — rather than handing back a configuration the
  file does not contain.
- Projected configured commands onto check descriptors. Verification owns every
  command definition (`SG-OWNER-001`), so the runner reads them and proposes
  none; each descriptor is proposed `advisory` and the Gate policy section binds
  which identities are required. A command the descriptor contract rejects is
  reported, never dropped into a quietly smaller evaluation.
- Composed arguments through the one shared rule. Resolution goes through
  `composeArguments` in `command-descriptor.mjs`, which `commandPreview` and
  bounded execution both derive from, so a preview and an execution cannot
  drift. A descriptor its own runner cannot compose surfaces
  `command-args-uncomposable` instead of being reshaped into something that
  happens to run, and an unresolved runner never falls back to a shell.
- Claimed nothing more than it has. A denial states that local enforcement is a
  cooperative process on this machine and can be removed or bypassed by whoever
  owns it (`SG-TRUST-001`, `RISK-001`).
- Substituted the packaged runner into `gate-activation-smoke`. It already drove
  real blocked and allowed commits in a throwaway clone, but through a FIXTURE
  hook program — which is precisely why release qualification passed while this
  defect existed. The fixture now writes a real `.agent-framework.yaml`, the
  activation request derives its Gate policy and checks from that same file
  through the new reader, the registered shim runs
  `scripts/gate-precommit.mjs`, and the scenario asserts that it does.

Shape decision: a bare packaged script, not the first subcommand of a `gate`
CLI. The lifecycle command surface is a separate contract and explicitly out of
scope here; a `gate` CLI whose only subcommand was this one would be that
surface, half-built and already committed to a shape its own contract has not
settled. A later `gate` CLI can delegate to this entry point without changing
what an activated clone already registered.

Scope held: no desktop adapter invocation, no `gate` lifecycle command surface,
and no activation change beyond pointing at the packaged runner.

Verification: `npm run test:unit` (297 passing), `npm run validate` (29 skills,
219 Markdown files), `npm run test:install`, and runs of all nine capabilities —
`gate-activation-smoke` (extended by this slice), `gate-runtime-binding-smoke`,
`gate-fix-smoke`, `gate-evidence-prune-smoke`, `gate-hook-conformance-smoke`,
`gate-lifecycle-smoke`, `gate-adapter-conformance`,
`gate-security-control-smoke`, and `gate-runtime-portability`.
