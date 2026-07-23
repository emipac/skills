# Express with TypeScript verification profile

Use only commands recorded by `framework-setup` or the approved delivery
contract:

1. Focused behavior at the public HTTP, service, or message seam.
2. Formatter and linter for the affected backend scope.
3. TypeScript checking.
4. Affected unit and integration tests.
5. HTTP/API smoke evidence for changed routes, middleware, status codes,
   payloads, authentication, authorization, or error behavior.
6. The configured backend production build when applicable.
7. Browser or E2E evidence only when an actual browser workflow changes.
8. The configured broad backend test suite.

Prefer behavior tests through the public API boundary. Do not prescribe
Supertest, Vitest, Jest, Node's test runner, or another library unless the
repository or delivery contract already selected it.

Treat request validation, authentication, authorization, rate limits, response
compatibility, error mapping, and side effects as safeguards when the contract
names them. Never substitute a frontend build or browser check for API
evidence.
