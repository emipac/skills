---
"ai-skills-framework": minor
---

Declare each desktop adapter's registration surface — its client configuration
file, that file's block schema, and whether the schema is independently
versioned — so activation, health reconciliation, and removal act on a desktop
registration only through that declaration, preserve every part of a client
configuration file the adapter does not own, and report `unverified` rather than
assume a surface they cannot confirm.
