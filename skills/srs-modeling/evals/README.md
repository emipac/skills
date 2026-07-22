# SRS modeling evaluations

`cases.json` defines the minimum behavioral evaluations for the three skill
branches. Run each case in an isolated fixture repository with
`.agent-framework.yaml`, a protected `AGENTS.md`, and the prompt's source
artifacts. Grade every assertion independently; a case passes only when every
assertion passes and no unrelated file changes.

The audit case should additionally compare the deterministic JSON result with
the skill's semantic findings. Creation and refinement should run the same audit
against their resulting SRS.
