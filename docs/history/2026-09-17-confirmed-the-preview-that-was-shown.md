# Confirmed the preview that was shown

Delivered TB-053, a defect slice found on a real project. The `next:` line every
preview printed was composed from the command name and the token alone, so for
the four commands whose selectors shape the preview it named an instruction that
could not perform what was just shown. `gate activate --client cursor` printed a
Git confirmation; following it recomputed a Git preview, refused the Cursor token
as a mismatch, blamed the unchanged clone, and printed a fresh token for the
Git-only operation. One more paste would have activated Git, reported healthy,
and recorded nowhere that Cursor was asked for.

- Made the preview own its instruction. The parsed selectors travel with the
  document into the renderer, and the line reads
  `gate <command> <selectors> --confirm <token>`. A value is bare when it is safe
  to paste and single-quoted otherwise, round-tripped through a real shell for
  spaces, quotes, and metacharacters.
- Left the five commands with no preview-shaping selector printing exactly what
  they printed before.
- Stopped the refusal asserting a cause it cannot know. A changed clone and a
  dropped selector cannot be told apart, since every check compares two content
  identities and no preview is persisted, so the refusal states the invocation
  that ran and prints the preview invocation with the operator's selectors and no
  token.

Token binding was not weakened: a clone altered between preview and confirmation
still refuses every command, proved in unit tests and against a real clone. One
limit was documented rather than changed: `repair`'s token does not cover
`--hook-script`, so omitting it is refused one step later as not reproducible.
