# Reported a clone that is installed but not configured

Delivered TB-047, a defect slice. `gate status` reported `configured` for a
clone whose `.agent-framework.yaml` declared no `evaluation_gate` section, while
`gate activate` refused the same clone as unconfigured. Two commands, one clone,
opposite answers.

- Status now distinguishes installed from configured by asking whether the clone
  holds a Gate policy at all.
- A policy that exists but fails the contract still reads as configured, with
  its invalidity reported as its own finding — reporting such a clone
  `installed` would have replaced one wrong answer with another.
- The rule reuses the shared configuration resolver from the hook runner rather
  than growing a second reader; it is exposed as a dependency seam only so tests
  can inject one.

Evidence added: operator-surface unit tests for the installed, configured, and
invalid-policy cases.
