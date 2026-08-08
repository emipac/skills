# 12 — Manage the active release and removal lifecycle

**What to build:** Give maintainers explicit, observable control over Gate updates, health, repair, deactivation, uninstall, and configuration cleanup without silent repair or destructive removal.

**Blocked by:** 11 — Preserve hook chains and activation identity

**Status:** ready-for-agent

- [ ] Ordinary skill or plugin update exposes a candidate release without changing the receipt's Active Gate release. (`FR-LIFE-014`, `AC-LIFE-007`)
- [ ] Explicit Gate update previews migrations, validates compatibility, reruns self-tests, switches atomically, and retains the previous Active release on failure. (`FR-LIFE-008`, `NFR-REL-002`, `AC-LIFE-004`)
- [ ] Status reports healthy, degraded, or broken from reconciled state and never repairs anything. (`FR-LIFE-009`, `SG-LIFE-001`, `AC-LIFE-004`)
- [ ] Lifecycle or hook drift changes only through explicit repair or Activation, never through status or ordinary update. (`FR-LIFE-019`, `SG-LIFE-001`, `AC-LIFE-010`)
- [ ] Deactivation removes only unchanged Gate-owned registrations and the receipt while preserving configuration and Evidence. (`FR-LIFE-010`, `AC-LIFE-005`)
- [ ] Uninstall requires deactivation and removes only project-installed assets, preserving global assets, shared configuration, and historical Evidence. (`FR-LIFE-011`, `AC-LIFE-005`)
- [ ] Separate previewed cleanup removes only Gate-specific configuration keys and never deletes the shared framework configuration. (`FR-LIFE-018`, `SG-LIFE-001`, `AC-LIFE-010`)

