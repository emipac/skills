---
"ai-skills-framework": minor
---

Let a configured verification command carry an optional `label` that names the
tool it runs. The Change Evaluation Gate keeps its generic check identities
(`configuration.static-analysis.static-analysis.1`), which policy binds, and now
renders a labelled check's summary as `phpstan (configuration.static-analysis.static-analysis.1): failed …`
so feedback and Evidence say which tool failed. A label is display text of 1 to
40 printable characters on one line. It changes no check identity, configuration
identity, or evaluation identity, so an existing policy and recorded Evidence
stay valid.
