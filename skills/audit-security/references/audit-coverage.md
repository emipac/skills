# Audit coverage baseline

Apply each domain that intersects the pinned audit surface. Mark a domain
`not applicable` only with a concrete reason.

## Identity and authorization

- Authentication strength, recovery, MFA, session lifecycle, token validation,
  impersonation, and logout or revocation.
- Object-, action-, field-, tenant-, and administrative-level authorization.
- Default-deny policy, ownership changes, privilege transitions, and confused
  deputy paths.

## Input, output, and execution

- Injection into database, command, template, expression, deserialization,
  file, header, redirect, and client-rendering sinks.
- Upload parsing, path handling, archive extraction, content-type trust, and
  executable content.
- Evaluation runners, plugin systems, CI jobs, sandboxes, generated code, and
  any execution of model or user-controlled artifacts.

For evaluations, prove isolation at the runtime boundary: disposable compute,
least-privilege identity, resource limits, constrained mounts, no host or
orchestrator socket, no inherited secrets, and deny-by-default network egress.

## Data and cryptography

- Sensitive-data collection, minimization, tenant isolation, encryption,
  retention, export, deletion, backups, and logs.
- Approved cryptographic primitives, key storage, randomness, signature and
  certificate validation, downgrade resistance, and failure behavior.
- Database roles, row-level boundaries, unsafe dynamic queries, migration and
  backup privileges, and production access paths.

## Credentials and configuration

- Secret discovery, storage, injection, redaction, rotation, revocation,
  expiration, and emergency access.
- Service identities with the smallest audience, privilege, environment, and
  lifetime required for one workload.
- Debug modes, default accounts, permissive CORS, trusted proxies, host
  validation, cookies, headers, TLS, administrative endpoints, and error detail.

## Network and infrastructure

- User-controlled URLs, webhooks, imports, previews, callbacks, DNS rebinding,
  redirects, alternate IP encodings, and non-HTTP schemes.
- Egress allow-lists and network controls blocking loopback, private, link-local,
  multicast, and cloud metadata services after every DNS resolution and
  redirect.
- Public exposure, firewall and security-group rules, workload identity,
  container privileges, filesystem mounts, control sockets, and environment
  separation.

## Dependencies and integrity

- Direct and transitive dependency provenance, lockfiles, known advisories,
  abandoned packages, install scripts, artifact verification, and update paths.
- CI permissions, protected release inputs, build provenance, generated files,
  plugin trust, and unsafe deserialization or update channels.

## Detection and resilience

- Security-relevant audit events, tamper resistance, redaction, correlation,
  alert ownership, and retention.
- Rate and resource limits, queue amplification, replay, race conditions,
  idempotency, exceptional-condition handling, and fail-open behavior.
- Revocation, containment, recovery, backup restoration, and evidence needed to
  investigate an incident.
