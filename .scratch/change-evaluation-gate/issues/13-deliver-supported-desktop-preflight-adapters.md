# 13 — Deliver supported desktop preflight adapters

**What to build:** Provide capability-aware early feedback for the three supported local desktop surfaces while keeping all authorization with the authoritative Git adapter.

**Blocked by:** 10 — Activate authoritative Git enforcement transactionally

**Status:** ready-for-agent

- [ ] Claude Code Desktop local Code tab, Codex Desktop local project, and Cursor IDE local Agent adapters satisfy the same conformance Interface. (`FR-ADAPT-002`, `AC-ADAPT-002`)
- [ ] Each adapter declares event, blocking, trust, repository, session, filesystem, Git, and invocation capabilities rather than inheriting another client's assumptions. (`FR-ADAPT-004`, `AC-ADAPT-002`)
- [ ] Supported adapters normalize work-complete and, where available, before-commit-attempt triggers into the versioned evaluation request. (`FR-ADAPT-001`, `FR-ADAPT-003`, `AC-ADAPT-001`)
- [ ] Desktop results remain `not-authoritative`; the same decision makes only Git block on deny. (`FR-ADAPT-003`, `FR-ADAPT-007`, `SG-SUPPORT-001`, `AC-ADAPT-001`)
- [ ] Trust failure, invocation failure, timeout, capability mismatch, and malformed output appear as structured `unverified` feedback. (`FR-ADAPT-005`, `NFR-REL-003`, `AC-ADAPT-002`)
- [ ] Unproved CLI, SSH, remote, cloud, and background variants are experimental, while chat-only or hosted contexts without repository, process, and Git access are unsupported. (`FR-ADAPT-006`, `SG-SUPPORT-001`, `AC-ADAPT-002`)

