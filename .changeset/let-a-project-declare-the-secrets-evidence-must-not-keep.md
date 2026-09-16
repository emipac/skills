---
"ai-skills-framework": patch
---

Let a project declare the secrets Evidence must not keep, so a check that
prints one cannot write it into permanent Evidence.

Value-based redaction was built and proved and reachable from no real clone.
`gate activate` pinned `runtimeInputs: []` as a literal, no configuration key
could declare a name, and so every activated clone ran its redactor with no
declared secret at all. The built-in patterns still caught a credential in a
shape they recognize — `NAME=value`, an authorization header, a URL with user
info, a PEM block — and nothing caught a bare token in a stack trace.

A project now declares `evaluation_gate.evidence.sensitive_inputs`, a list of
environment variable names and nothing else; a value in that list is refused
before activation. The names reach the activation preview (`runtime inputs:
APP_KEY`), the receipt pins them, and both packaged runners read each name from
their own process environment and remove the value — raw and in every encoded
form the store recognizes — from every envelope, blob, decision, and Lifecycle
event before anything is written. The declaration is part of the configuration
identity: changing it after activation is trusted-configuration drift until the
clone is re-pinned.

A declared name the environment does not set is neither an error nor a silent
pass: the evaluation proceeds and the envelope records the name under
`redaction.unresolved`. A project that declares nothing writes exactly the
envelope it always did. Nothing here supplies, copies, injects, or approves a
value; the Gate only removes declared values from what it keeps.
