# Define client support tiers and compatibility baseline

Status: done
Parent: change-evaluation-gate
Assignee: Codex
Labels: wayfinder:grilling
Blocked by: research-cross-client-hook-and-install-capabilities

## Question

Which Cursor, Codex, and Claude Code surfaces are required, advisory, experimental, or unsupported in the first release, and what minimum event, blocking, trust, filesystem, shell, and Git capabilities must a surface prove before its adapter may claim support?

## Comments

### Resolution — 2026-08-04

Support is defined on two independent axes. The **Enforcement role** is `authoritative` or `preflight`; the **Support tier** is `supported`, `experimental`, or `unsupported`. A supported surface is a release-blocking compatibility target, while experimental support is opt-in and non-release-blocking. Native client blocking is not required for a supported preflight adapter because Git remains the authoritative commit seam.

The v1 supported matrix is local Git `pre-commit` as the authoritative integration, plus Claude Code Desktop's local Code tab, Codex Desktop with a local project, and Cursor IDE's local Agent as preflight integrations. All three desktop adapters must pass their baseline before v1 may claim support. CLI, SSH, remote, cloud, and background-agent variants are experimental. Chat-only or hosted surfaces without the required repository filesystem, process execution, and Git access are unsupported.

Support is capability-based rather than operating-system-labelled. Every supported desktop adapter must prove a deterministic event mapped to normalized `work-complete`; non-interactive gate invocation; correct repository/worktree and session identity; access to the same files and Git metadata; visible structured results; explicit `unverified` handling for trust, invocation, timeout, and malformed-output failures; isolation across parallel sessions/worktrees; and declaration of its native blocking capability. A `before-commit-attempt` mapping is used when available but is optional.

The separate runtime portability baseline must prove non-interactive executable launch; explicit repository/worktree roots; reliable arguments, standard streams, exit status, and structured JSON; access to the matching Git repository, index, worktree, and staged-tree identity; timeout and process-tree termination; evaluated-source immutability; detection of writes inside the materialized snapshot outside declared cache, temporary, report, screenshot, or evidence locations; `unverified` results for missing or inaccessible runtime dependencies; version evidence; and no dependency on a particular interactive shell. V1 reuses approved host processes and does not claim general host-filesystem containment beyond evaluation-managed locations.
