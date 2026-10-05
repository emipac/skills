# Said why, in the channel that asks for the change

Delivered TB-064, a defect slice. The desktop feedback channel is the one surface
that prompts an agent to change a project, and it was rendered from a decision's
checks alone. Every diagnostic was dropped whenever a check was not `passed`, and
a decision `unverified` for another reason reached the agent as the single word
`unverified`. On a real clone that hid control-surface drift, three unprovided
dependency roots, and an edit to the Gate's own configuration; the agent worked
the failures it was shown and at one point edited the project to answer an
environment fault.

- Carried the decision's diagnostics and changed Grader surfaces to every
  surface.
- Rendered one message in a stated order: the outcome; each failing check's own
  summary; every `integrity-drift` diagnostic; the other diagnostics by reason
  code; and every changed Grader surface as `<kind> <path>`, stated as
  observation without any language of intent.
- Bounded it with `FEEDBACK_LIMITS` — 8 failing checks, 8 non-drift diagnostics,
  400 characters per entry — with anything left out counted and named by reason
  code and evaluation id. Drift and Grader surfaces are never capped.
- Kept adapter-failure messages byte for byte, and changed no adapter
  declaration, tier, or authority.

A turn is now silent only when it passed with no diagnostic and no changed Grader
surface, so a passing turn that edits `.agent-framework.yaml` or a declared
verification script gets a follow-up (TB-066 later separated untracked files from
edited ones). Two limits were stated: the Grader-surface bound is structural, and
the drift diagnostic still named `gate repair` for configuration drift, which
TB-065 corrected. SRS 0.2.12 records it.
