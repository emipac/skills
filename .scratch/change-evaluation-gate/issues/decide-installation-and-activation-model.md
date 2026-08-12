# Decide installation and activation model

Status: done
Parent: change-evaluation-gate
Assignee: Codex
Labels: wayfinder:grilling
Blocked by: research-cross-client-hook-and-install-capabilities, design-shared-gate-interface-and-adapters

## Question

How should optional selection through `npx skills`, Codex and Claude plugins, project versus global installation, explicit activation, updates, uninstall, hook trust, and configuration ownership work without making skill installation unexpectedly block commits?

## Comments

### Resolution — 2026-08-04

The gate is an independently selectable, opt-in framework module. Project-local
installation is the default; global installation must be explicit and only makes
reusable skills, runtime, and adapter assets available. `npx skills`, Codex and
Claude plugins, and whole-plugin bundles are distribution mechanisms only. They
never configure a repository, register hooks, or block commits. Clients that can
select components expose the gate separately; whole-plugin installs may include
it only as a dormant capability.

Adoption has three explicit states: `installed`, `configured`, and `activated`.
`framework-setup` owns creation and migration of the shared
`.agent-framework.yaml`; the gate provider owns only its namespaced section's
schema, defaults, and validation. Setup offers that section as an initially
unselected option. Activation is always clone-local and repository-specific; v1
has no global activation. An activation receipt under resolved Git metadata binds
the configuration identity, runtime and adapter versions, hook locations, trust,
and successful checks. A fresh clone is configured, not activated.

`gate activate` is an explicit, repository-bound transaction. It previews exact
changes, obtains consent, establishes client-controlled trust, self-tests the
runtime and selected desktop adapters, validates the existing Git hook chain, and
enables the authoritative Git hook last. Any failure rolls back all gate-owned
changes and leaves the clone configured. Non-interactive activation additionally
requires the expected repository and configuration identities; package lifecycle
scripts cannot activate the gate. Trust prompts may be completed before resuming
the same transaction.

Hook registration is non-destructive. The gate creates a clearly owned shim only
when no hook exists, adds a marker-delimited block to a repository-local hook only
after preview and confirmation, and uses a hook manager's native integration when
available. It never overwrites hooks or automatically changes shared/global
`core.hooksPath`. Activation succeeds only after proving both the previous hook
chain and gate execute. Integrity markers and hashes allow removal of only
unchanged gate-owned content; detected drift requires manual resolution.

The activation receipt pins the active runtime and adapter versions. Ordinary
skill or plugin updates only make a candidate release available. Explicit
`gate update` previews migrations, validates compatibility, repeats activation
self-tests, and switches atomically; failure preserves the previous active
release. The authoritative Git gate operates independently of desktop plugins.

`gate deactivate` removes only unchanged gate-owned registrations and the local
receipt while preserving repository configuration and evidence. `gate uninstall`
requires deactivation and removes only project-installed gate assets; it cannot
remove a global installation. A separate previewed cleanup may remove only the
gate-specific `.agent-framework.yaml` keys. It must never delete that shared file
or historical evidence.

`gate status` reconciles desired activation with actual runtime, hooks, trust, and
adapters. It reports `healthy`, `degraded` when a non-authoritative desktop adapter
is unavailable but Git remains valid, or `broken` when authoritative Git/runtime
enforcement is invalid. Status never repairs drift automatically; recovery is an
explicit repair or activation transaction.
