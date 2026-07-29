# Four-axis review report

```markdown
## Standards

**Sources:** <guidelines and baseline availability>
**Worst severity:** <P0-P3 or None>

- [P2] `<file:line>` — <finding, cited rule, and actionable correction>

## Contract

**Sources:** <SRS/spec/ticket/amendment availability>
**Worst severity:** <P0-P3 or None>

- [P1] `<file:line>` — <affected ID, safeguard/non-goal, drift, and correction>

## Security

**Sources:** <audit-security coverage, policy, OWASP/ASVS versions, and runtime evidence>
**Worst severity:** <P0-P3 or None>

- [P1] `<file:line>` — <attacker source-to-sink path, impact, control mapping, and correction>
- **Hardening:** <defense-in-depth opportunity or None>
- **Coverage gap:** <missing context or evidence or None>

## Evidence

**Sources:** <red-green log and verification report availability>
**Worst severity:** <P0-P3 or None>

- [P1] `<file:line>` — <missing or insufficient evidence and required command>

## Disposition

- <Finding → fix, amendment decision, owner/deferment, or blocker>
```

Do not merge or rerank findings across headings. A clean heading says `No
findings` and still reports which sources were available.
