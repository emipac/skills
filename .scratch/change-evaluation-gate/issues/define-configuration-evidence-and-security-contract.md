# Define configuration, evidence, and security contract

Status: done
Parent: change-evaluation-gate
Assignee: Codex
Labels: wayfinder:grilling
Blocked by: decide-gate-policy-and-bypass-contract, design-shared-gate-interface-and-adapters

## Question

What configuration extension, evidence record, trust boundary, command-validation policy, tamper model, secret-handling rule, concurrency behavior, and audit trail must the gate expose while preserving `.agent-framework.yaml` as the repository verification contract?

## Comments

### Resolution — 2026-08-04

The first gate-capable framework release introduces `.agent-framework.yaml`
schema version 4 with an optional, strictly validated top-level
`evaluation_gate` section. Its absence means the repository is not configured;
its presence means configured, never activated. The existing `verification`
section remains the sole source of profiles, scopes, capabilities, and commands.
The gate section contains only five client-independent policy subcontracts:
required/advisory check identities, total budget, bypass, execution, and evidence.
It contains no client, hook, executable, trust, version, or activation state.

Version 4 migrates raw command strings to OS-independent Command descriptors.
Descriptors identify the logical runner (`composer-bin`, `php-script`,
`package-script`, `repository-script`, or approved tool), argument array,
repository-relative working directory, individual timeout, allowed environment
names, evidence category, and source scope. They do not permit shell parsing,
pipes, redirection, substitutions, inline environment assignments, or operators.
Clone-local activation resolves each logical runner to the platform executable,
records its path and version, and previews the equivalent human-readable command.
Complex behavior belongs in an explicitly invoked repository script, which is a
Grader surface.

The active receipt pins the last Trusted gate configuration: the gate section,
Verification profile, Command descriptors, and provider identities. A candidate
snapshot cannot make its own weaker policy authoritative. Changes to those policy
surfaces are evaluated under the prior trusted policy, separately validated as a
candidate, and require explicit approval bound to the exact candidate hash. The
transition must satisfy both policies where they differ. The candidate becomes
trusted only after the approved transition is committed and activation reconciles
it; until then status reports configuration drift.

Every evaluation produces one immutable, versioned, canonical, content-addressed
Evidence envelope. It records task, snapshot, trusted and candidate configuration,
runtime, provider, environment, resolved checks, all attempts and assertions,
reason codes, coverage, Grader surfaces, integrity, authorization, bypass, and
redaction metadata. Reruns append records rather than replacing failures. Bounded,
redacted excerpts remain in the envelope; larger redacted output may be stored as
content-addressed blobs.

Evidence lives at a fixed runtime-owned path under the resolved Git common
directory, never in the worktree or a repository-configurable arbitrary path.
Writes are atomic and use restrictive permissions where supported. V1 never
deletes evidence automatically. Explicit, previewed pruning preserves bypass and
pruning audit records and leaves a tombstone when a referenced output blob is no
longer retained. This is useful local audit evidence, not tamper-proof or remote
attestation.

V1 serializes project-command execution per Git common directory, including
linked worktrees. Exactly matching in-flight snapshot, trusted-configuration,
plan, and environment identities may share check execution while returning
role-appropriate decisions to each caller. Different evaluations queue;
authoritative Git may advance ahead of queued, but not running, preflights.
Cancellation is subscriber-specific. Locks include process, host, start, and
heartbeat evidence; explicit stale-lock recovery is audited. Coordination failure
or timeout is `unverified`, and completed results are not a persistent pass cache.

Execution isolation is deliberately limited to source state. Checks run from an
exact materialized directory or worktree while reusing the developer's existing
host environment, including Laravel Herd, local databases and services, PHP,
Composer and Node dependencies. V1 does not create Docker, VM, database, or
parallel application environments and does not claim to contain hostile repository
code. HTTP/browser checks must route the existing local runtime to the materialized
source and prove that the served application matches the Evaluation snapshot;
inability to prove that binding produces `unverified`. They still use the same
host stack.

Activation confirms clone-local runtime inputs such as `.env.testing`, `.env`, or
named variables. Approved environment files are copied temporarily rather than
symlinked; receipts record only names and sources, never values. Values are excluded
from repository configuration and Evidence envelopes, redacted from captured
output, and removed with the materialization. The gate relies on the project's
normal local test-database safeguards rather than provisioning its own database.

The v1 tamper model detects ordinary drift without claiming adversarial security.
Unexpected changes to the runtime, adapters, managed hooks, receipt, Trusted gate
configuration, Command descriptors, or providers make health `broken` and an
authoritative result `unverified`. Test and verification-script changes remain
visible Grader surfaces but do not automatically block. Signing, encryption,
privileged daemons, hidden tests, hardened OS/container sandboxes, and protection
against the machine owner remain outside v1.

Configuration approval, activation, update, repair, removal, trust, evaluations,
bypasses, pruning, stale-lock recovery, and detected drift produce immutable local
Lifecycle events. Each records UTC time, best-effort explicitly unauthenticated
actor, client and gate identity, repository identity, relevant before/after hashes,
outcome, reason, and redaction metadata. Bypasses also retain the previously
accepted commit-visible marker. Direct `--no-verify`, hook/evidence deletion, and
Git reconfiguration remain detectable only opportunistically and are not presented
as prevented.

### Accepted profile-presence amendment — 2026-08-10

**Status:** accepted
**Decision owner:** Repository owner
**Affected IDs:** `FR-CFG-008`, `FR-CFG-009`, `AC-CFG-005`, `SG-CFG-002`, `RISK-005`, `Q-005`

Schema version 4 represents backend and frontend presence symmetrically. `none`
means the profile is proved absent; `unknown` means a relevant profile may exist
but cannot yet be classified and therefore remains conservative. Backend-only,
frontend-only, full-stack, and tooling-only repositories are valid. The
tooling-only combination uses `backend: none`, `frontend: none`, and the
Verification profile `tooling`.

Shared, tied, and unmatched files affect every configured active profile, never
a profile declared `none`. Cross-cutting Verification commands remain applicable
to tooling-only repositories. A schema v4 contract rejects source scopes or
profile-specific commands assigned to an inactive profile.

Migration never reinterprets schema v3 `unknown` as schema v4 `none`. That change
requires an explicit repository-maintainer mapping in the previewed transaction;
unresolved profile presence preserves schema v3 without modification. This
amendment adds no Gate configuration, activation, hook, trust, or runtime state.
