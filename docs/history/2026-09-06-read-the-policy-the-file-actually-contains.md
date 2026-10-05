# Read the policy the file actually contains

Delivered TB-049, a defect slice in the configuration reader. Two bugs returned
success with a value the file does not hold.

- Fixed quoted scalars swallowing a trailing comment. The closing quote was
  found by searching backwards from the end of the line, so
  `marker: "A" # not "B"` parsed to `A" # not "B`. The scan now runs forward from
  the opening quote and honours each quote kind's own escaping: `"a\\"` closes at
  its final quote, and `'it''s' # don't` parses to `it's`.
- Fixed flow collections refused because of a comment. They were detected on
  comment-stripped text and parsed on the unstripped text, so
  `required: ["pest"] # unit tests` was recognised and then refused. Since the
  configuration writers emit every `evaluation_gate` subcontract in flow form,
  that was the shape of every generated document. The comment is now removed by
  walking the collection and honouring only a `#` outside a JSON string, which
  keeps `["a #b"]` whole.
- Added no runtime dependency: a YAML library would be a distribution cost paid
  by every consumer of a standalone skill to fix a bounded parsing bug.

Two narrowings were named: `"a" "b"` is now refused as unreadable trailing text
instead of returning `a" "b`, and `["pest"] # x` now parses where it was refused.

Evidence added: reader tests for both defects, and a proof of the property drift
detection rests on — a trailing comment does not move the configuration
identity, and a changed value does.
