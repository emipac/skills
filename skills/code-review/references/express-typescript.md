# Express with TypeScript review baseline

Apply only when repository rules do not decide the point:

- Public HTTP behavior preserves contracted status codes, payloads, headers,
  validation, authentication, authorization, and error semantics.
- Middleware ordering does not weaken a safeguard or make behavior
  route-order-dependent.
- Request data is validated before domain behavior or side effects.
- Async failures reach the configured error boundary; handlers do not create
  unhandled promises or send multiple responses.
- Types describe proved runtime behavior and do not replace boundary
  validation.
- Route handlers remain shallow when domain behavior can live behind a focused
  interface.
- Tests observe public HTTP or service behavior rather than private handler
  implementation.
- Backend changes carry TypeScript, focused test, and HTTP smoke evidence when
  the delivery contract requires those layers.

Treat these as review prompts, not universal architectural mandates. Existing
repository conventions remain authoritative.
