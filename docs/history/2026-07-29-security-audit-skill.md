# Security audit skill

## Outcome

- Added the model-invoked `audit-security` skill for repository-wide and scoped
  code security audits.
- Added OWASP Top 10:2025 and ASVS 5.0.0 coverage with versioned evidence
  expectations.
- Made evaluation isolation, narrow trust boundaries, short-lived credentials,
  and blocked metadata access mandatory audit outcomes.
- Added explicit coverage for authentication, authorization, application and
  server configuration, databases, secrets, outbound requests, supply chain,
  detection, and recovery.
- Extended `code-review` to four independent Standards, Contract, Security,
  and Evidence axes. Security delegates a diff-scoped audit to
  `audit-security`, and `implement` now requires that axis to be clean.

## Verification

- Added evaluation cases for a repository audit, an outbound-request component,
  and an untrusted evaluation runner.
- Added a unit contract covering OWASP versions and all four defensive
  priorities.
- All 63 unit and contract tests passed.
- Repository validation passed for 26 released skills and 118 Markdown files.
- Five-client installation smoke passed with `audit-security` included in the
  nine-skill lifecycle sample.
- The dependency audit reported zero vulnerabilities.
- The standalone official skill validator could not run because its Python
  environment lacks `PyYAML`; repository metadata validation passed instead.
- Claude plugin validation could not run because the required CLI is blocked by
  the configured lean-shell allowlist.
