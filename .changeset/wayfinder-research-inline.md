---
"mattpocock-skills": minor
---

Reframe how **`wayfinder`** handles research: it's no longer a ticket type — it runs **inline as a subagent**. Research is fully AFK (no human gates it) and produces a *fact*, not a decision, so it never earns a ticket's session boundary. Instead, any session — charting or resolving — spins up a `/research` subagent the moment it hits a knowledge gap, keeps working while it reads, and folds the findings straight into the decision it's making. The findings are captured as a primary source on a throwaway `research/<name>` branch (mirroring how `/prototype` captures prototypes), with a context pointer left on the ticket the research informs, or in the map's Notes if it informs the whole effort. Drops `research` from the `wayfinder:<type>` label set (`prototype`/`grilling`/`task`) across the GitHub, GitLab, and local trackers, and re-syncs the docs page.
