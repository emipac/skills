---
name: audit-security
description: Audit a repository or specified code for exploitable security weaknesses. Use when the user requests a security audit, OWASP assessment, attack-surface review, or focused review of authentication, authorization, infrastructure, database, secrets, outbound-request, or evaluation-execution security.
---

# Audit Security

Perform a read-only, evidence-backed security audit. Separate validated
vulnerabilities from hardening opportunities and coverage gaps.

## 1. Pin the audit surface

Resolve the target as exactly one of:

- the whole repository;
- one or more explicit paths or components;
- code supplied in the conversation.

Read repository instructions, architecture and deployment documentation,
dependency manifests, security policy, relevant configuration, tests, and the
target code. For supplied code, state which surrounding controls remain
unseen. Record the fixed commit when Git is available. Do not broaden a scoped
audit silently.

Inventory exposed entry points, identities, authorization decisions, sensitive
assets, data stores, background work, outbound integrations, administrative
surfaces, and any mechanism that evaluates or executes untrusted input.

Completion criterion: the report names the exact target, revision, exclusions,
available normative sources, and every exposed or privileged surface in scope.

## 2. Draw the trust map

Trace attacker-controlled sources through validation and authorization
boundaries to privileged sinks. Include anonymous, authenticated, tenant,
operator, dependency, build-system, and compromised-service attacker
capabilities where applicable.

Apply these mandatory invariants at every relevant boundary:

1. **Strict evaluation isolation** — execute untrusted code, model output,
   plugins, tests, or evaluation artifacts only in a disposable sandbox with
   least privilege, explicit CPU/memory/time limits, a constrained filesystem,
   no host control socket, no ambient credentials, and deny-by-default egress.
2. **Narrow trust boundaries** — authenticate and authorize each transition,
   validate at the boundary, minimize transitive trust, and default to deny.
3. **Short-lived credentials** — use scoped, revocable credentials with an
   explicit expiry and rotation path; eliminate embedded or broadly shared
   long-lived secrets.
4. **Blocked metadata access** — block link-local, loopback, private-network,
   and cloud metadata destinations for workloads that do not require them;
   validate resolved addresses and redirects, enforce egress policy, and use
   provider metadata protections only as defense in depth.

Completion criterion: every applicable invariant has supporting evidence, a
validated finding, or an explicit coverage gap.

## 3. Apply the security baseline

Read [the audit coverage baseline](references/audit-coverage.md) for every
audit. Read [the OWASP baseline](references/owasp-baseline.md) whenever the
target is an application, API, web surface, or supporting infrastructure.
Verify current official framework and package documentation before treating a
configuration as safe or unsafe.

Use OWASP Top 10 as a risk taxonomy and ASVS as the control-verification
baseline. Do not force a finding into an unrelated OWASP category. Record the
standard version used and map exact ASVS identifiers with their version prefix.

Completion criterion: every applicable coverage domain and OWASP category was
examined, with omissions and unavailable evidence visible.

## 4. Validate candidates

For each candidate, trace a concrete source-to-sink or boundary-bypass path.
Confirm the preconditions, reachable code, existing controls, plausible impact,
and whether tests or configuration contradict the hypothesis. Prefer static
inspection and existing non-mutating tests. Treat scanner output and dependency
advisories as leads until reachability and impact are established.

Run only read-only checks unless the user explicitly authorizes a broader
action. Request authorization before sending crafted payloads, accessing an
external system, consuming credentials, changing data, or degrading service.
Never print full secrets, tokens, personal data, or weaponized production
payloads in evidence.

Reject false positives explicitly. Classify unproven but important missing
controls as coverage gaps; classify defense-in-depth improvements without a
credible exploit path as hardening opportunities.

Completion criterion: every candidate is a validated finding, rejected with a
reason, or retained as a named coverage gap.

## 5. Report actionable findings

Use [the security audit report](references/security-audit-report.md). Order
findings by `P0` through `P3`, then hardening opportunities and coverage gaps.
For each finding, cite the exact location, attacker path, violated boundary,
impact, evidence, OWASP or project control mapping, minimal remediation, and a
verification test. State explicitly when no validated findings remain.

Do not implement fixes or rewrite security policy unless the user asks.

Completion criterion: the four mandatory invariants have explicit outcomes and
every reported item has an owner-ready next action or a stated blocker.
