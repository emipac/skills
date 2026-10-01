# Refused to register a surface that cannot answer

Delivered TB-048, a defect slice. Two desktop adapters, `claude-code-desktop` and
`codex-desktop`, declared `feedback.channel: null`. Once TB-046 made them
activatable, activating one registered it successfully, and then every turn
materialized a snapshot, ran every check, appended Evidence, and said nothing.
Authoritative Git also declares no channel, correctly, because it answers by
blocking; one null carried both meanings.

- Made the feedback declaration state why a channel is absent: `absence` is
  `not-needed` (only beside native blocking, as for Git), `not-observed` (the two
  desktop surfaces), or null beside a declared channel (Cursor). The validator
  rejects a null channel that states neither, `not-needed` on a surface that does
  not block, and an absence beside a channel.
- Identified an unreportable preflight surface from the declaration alone, so no
  client name entered Gate core.
- Refused a selection holding such a surface at the preview step, with
  `feedback-channel-unobserved`, before consent, trust, or any self-test, so the
  whole selection registers nothing and no client file changes. `gate doctor`
  predicts the same refusal through the same function, and
  `gate activate --client` refuses before offering a token.
- Made the preflight runner, if reached for such a surface anyway, return before
  any snapshot, check, or Evidence store, and write the reason to stderr.

Git, Cursor, the feedback formatter, and every support tier are unchanged; no
channel was invented and no adapter hidden. `gate-adapter-conformance` gained
`unobserved-surface-refused`, and SRS 0.2.16 amends `FR-ADAPT-004`,
`AC-ADAPT-002`, and `AC-ADAPT-003`.

Limits: the matcher-group registration schema is now proved only at the
registration seam; Codex's post-registration review cannot be reached until its
channel is observed; and a clone activated for one of those surfaces before this
change keeps a registration that now evaluates nothing until it is deactivated.
