# Security audit report

## Audit contract

- Target and fixed revision
- Included and excluded paths
- Attacker capabilities
- Normative sources and OWASP versions
- Checks run and unavailable evidence

## Attack surface

Summarize exposed entry points, sensitive assets, identities, trust boundaries,
privileged sinks, outbound paths, and evaluation or execution surfaces.

## Mandatory invariants

| Priority | Outcome | Evidence or gap |
| --- | --- | --- |
| Strict evaluation isolation | Pass / Finding / Gap / N/A | Location and rationale |
| Narrow trust boundaries | Pass / Finding / Gap / N/A | Location and rationale |
| Short-lived credentials | Pass / Finding / Gap / N/A | Location and rationale |
| Blocked metadata access | Pass / Finding / Gap / N/A | Location and rationale |

## Findings

Use severity consistently:

- `P0` — active or trivially reachable compromise with catastrophic impact.
- `P1` — credible high-impact compromise across a security boundary.
- `P2` — exploitable weakness with constrained impact or meaningful
  prerequisites.
- `P3` — low-impact weakness with a concrete exploit path.

For every finding include:

1. title and severity;
2. exact code or configuration location;
3. attacker-controlled source, path, privileged sink, and prerequisites;
4. violated trust boundary and impact;
5. evidence and existing controls considered;
6. OWASP, ASVS, and project-safeguard mapping where applicable;
7. minimal remediation and residual risk;
8. focused verification test.

## Hardening opportunities

List defense-in-depth improvements without presenting them as vulnerabilities.

## Coverage gaps

List missing source, configuration, runtime access, documentation, or safe test
evidence that prevents a conclusion. Name the owner or evidence needed to close
each gap.

## Clean coverage

Name the audited domains with no validated findings. Never imply that untested
or out-of-scope surfaces are secure.
