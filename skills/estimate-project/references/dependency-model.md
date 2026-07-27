# Dependency model

Create a dependency register whenever delivery relies on a third party or on
information, access, data, files, decisions, or approvals supplied by the client.
Use stable IDs such as `DEP-001` for external systems and `INPUT-001` for client
inputs. Reference these IDs from affected phases, roadmap gates, and risks.

## Third-party service qualification

Verify or request the details that materially affect implementation:

- access method: REST, SOAP, GraphQL, SDK, SFTP, file exchange, webhook, or
  manual portal;
- API version, documentation, contract/specification, sandbox, and support
  contact;
- authentication, authorization scopes, certificates, IP allowlists, VPN, and
  credential-delivery process;
- request/response schemas, sample payloads, error contracts, pagination,
  idempotency, retries, rate limits, and timeouts;
- synchronous, asynchronous, batch, polling, or webhook behavior;
- data volume, frequency, latency, availability, maintenance windows, and SLA;
- privacy, security, residency, retention, audit, and compliance constraints;
- test environment, production onboarding, certification, fees, and lead time.

When these details are absent, use the simplest credible best-case assumption,
for example: a documented JSON REST API over HTTPS, standard OAuth 2.0 client
credentials, a working sandbox, representative payloads, stable identifiers,
ordinary pagination, no unusual rate limits, and deterministic error responses.
Name this as an assumption rather than presenting it as confirmed fact.

## Client-provided input qualification

Identify every required client contribution, including:

- business rules, mappings, formulas, terminology, and acceptance examples;
- representative and edge-case data, exports, spreadsheets, media, documents,
  templates, translations, and historical records;
- data dictionary, field definitions, ownership, quality, volume, encoding,
  duplicates, missing values, and reconciliation totals;
- credentials, accounts, certificates, domains, infrastructure, licenses, and
  vendor introductions;
- branding, legal copy, privacy terms, compliance decisions, sign-offs, UAT
  participants, and response deadlines.

Record the expected format, minimum usable sample, delivery owner, and required
date. Treat conversion, cleansing, deduplication, mapping discovery, or repeated
late replacements as additional scope unless explicitly included.

## Estimation treatment

For every unresolved dependency:

1. Estimate the minimum against the documented best-case assumption.
2. Increase the maximum only for plausible, bounded alternatives.
3. Add a discovery or integration spike when the interface or data cannot be
   bounded credibly.
4. Separate waiting time from person-day effort in the roadmap.
5. Mark downstream figures provisional when the unknown can change architecture,
   security, data mapping, or acceptance behavior.
6. Define the evidence and event that trigger re-estimation.

Do not invent a REST API when only “integration” is stated. Record REST as the
best-case assumption, list SOAP, file exchange, or portal automation as relevant
risks, and explain which estimate rows would change.
