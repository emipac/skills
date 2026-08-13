---
"ai-skills-framework": minor
---

Ship the packaged Change Evaluation Gate pre-commit runner an activated
repository actually invokes: it reads the clone's configuration through a
supported `.agent-framework.yaml` reader and its Activation receipt, builds the
versioned `commit-attempt` request, calls the existing `evaluate` seam without
adding policy of its own, prints the decision, denies the activation self-test
subject deliberately, and exits `0` only on an `allow` authorization — an
unreadable configuration, an absent receipt, an unresolved runner, a malformed
decision, or an internal failure all deny with a stated reason.
