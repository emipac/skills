---
"ai-skills-framework": minor
---

Manage the Gate's active release and removal lifecycle: ordinary distribution
exposes a candidate only, `gate update` switches the Active gate release
atomically and preserves the prior release on any failure, `gate status`
reconciles health without repairing or writing anything, and deactivation,
uninstall, and configuration cleanup remove only unchanged Gate-owned state
while preserving shared configuration, global assets, and historical Evidence.
Pins a durable, receipt-independent content identity for the gate-written hook
block so tampering is detectable from a published receipt alone, and adds the
operator-facing `gate prune` and coordination-lock inspection commands.
