---
"ai-skills-framework": patch
---

Make Activation execute the hook program it is about to register against a
change that must be denied, and refuse it unless it denies, so a program that
enforces nothing can no longer pass its own self-test and be installed.
