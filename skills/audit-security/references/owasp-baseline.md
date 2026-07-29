# OWASP baseline

Use current official OWASP material when network access is available. Record
the versions and access date in the audit; if live verification is unavailable,
state that this bundled baseline may be stale.

## Primary standards

- [OWASP Top 10:2025](https://owasp.org/Top10/2025/0x00_2025-Introduction/)
  supplies the application-risk taxonomy.
- [OWASP ASVS 5.0.0](https://owasp.org/www-project-application-security-verification-standard/)
  supplies testable application-security requirements. Prefix exact mappings
  with the version, for example `v5.0.0-1.2.5`.
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) supplies
  control-specific implementation guidance.

## Top 10:2025 coverage

Examine each applicable category:

1. A01 Broken Access Control
2. A02 Security Misconfiguration
3. A03 Software Supply Chain Failures
4. A04 Cryptographic Failures
5. A05 Injection
6. A06 Insecure Design
7. A07 Authentication Failures
8. A08 Software or Data Integrity Failures
9. A09 Security Logging and Alerting Failures
10. A10 Mishandling of Exceptional Conditions

Top 10 coverage does not prove safety. Use ASVS requirements, project
invariants, and source-to-sink evidence to verify controls.

## Mandatory defensive priorities

- **Evaluation isolation:** map to architecture, malicious-input, file,
  communication, configuration, and business-logic controls. Inspect runtime
  isolation directly; application validation alone is insufficient.
- **Narrow trust boundaries:** emphasize access control, authentication,
  validation, tenant separation, and independent authorization at privileged
  sinks.
- **Short-lived credentials:** use the
  [Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
  for least privilege, dynamic secrets, expiration, rotation, revocation, and
  redaction.
- **Blocked metadata access:** use the
  [SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
  for allow-listing, address validation, redirect handling, private and
  link-local blocking, and cloud-provider defense in depth.

Map a finding only when the cited standard actually governs the failed control.
Keep project-specific safeguards alongside, not underneath, the OWASP mapping.
