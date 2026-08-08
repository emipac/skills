# 10 — Activate authoritative Git enforcement transactionally

**What to build:** Let a maintainer preview and activate clone-local authoritative Git enforcement so every commit is evaluated, while any failed activation restores the prior configured state.

**Blocked by:** 09 — Coordinate concurrent evaluations safely

**Status:** ready-for-agent

- [ ] Activation previews exact identities, commands, hook changes, selected adapters, and self-tests before repository-bound consent. (`FR-LIFE-004`, `AC-LIFE-002`)
- [ ] Activation establishes client-controlled trust, validates the existing hook chain, and self-tests the chosen runtime and adapters. (`FR-LIFE-004`, `AC-LIFE-002`)
- [ ] The Activation receipt pins configuration, runtime, adapter, hook, trust, runtime-input names, and self-test identities. (`FR-LIFE-006`, `AC-LIFE-002`)
- [ ] Authoritative Git is enabled only after every earlier activation step succeeds. (`FR-LIFE-004`, `SG-HOOK-001`, `AC-LIFE-002`)
- [ ] Failure injected at any activation step rolls back every Gate-owned change and leaves no partial receipt or registration. (`FR-LIFE-005`, `NFR-REL-002`, `SG-LIFE-001`, `AC-LIFE-002`)
- [ ] Every commit in an activated repository invokes the Gate; current required passes allow and one required failure or unverified result blocks. (`FR-EVAL-001`, `FR-POL-001`, `AC-EVAL-001`)

