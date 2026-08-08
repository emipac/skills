# 02 — Configure the Gate as a dormant opt-in module

**What to build:** Let maintainers install and configure the optional Gate deliberately while ensuring distribution and setup never imply activation or commit blocking.

**Blocked by:** 01 — Expand verification configuration to schema v4

**Status:** ready-for-agent

- [ ] Installation, repository configuration, and clone-local activation are represented as distinct states. (`FR-LIFE-001`, `AC-LIFE-001`)
- [ ] Gate assets are independently selectable; whole-plugin installation leaves bundled assets dormant. (`FR-LIFE-012`, `SG-DIST-001`, `AC-LIFE-006`)
- [ ] Project-local installation is the default, global installation is explicit, and neither form activates a repository. (`FR-LIFE-002`, `FR-LIFE-003`, `SG-DIST-001`, `AC-LIFE-001`)
- [ ] Setup presents Gate configuration as initially unselected and never infers consent from installed assets. (`FR-LIFE-013`, `SG-DIST-001`, `AC-LIFE-006`)
- [ ] Absent Gate configuration means not configured; present configuration means configured but not activated. (`FR-CFG-001`, `AC-CFG-001`)
- [ ] Gate configuration accepts exactly the required/advisory identities, total budget, bypass, execution, and evidence policy subcontracts while Verification retains command ownership. (`FR-CFG-002`, `SG-OWNER-001`, `AC-CFG-001`)

