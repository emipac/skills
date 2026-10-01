# Kept orphaned roots bounded when they are real

Delivered TB-058. TB-038's sweep checked its 250 ms deadline between execution
roots, which was harmless while a root held tracked content and a few links. A
copied dependency tree is 42,491 entries and takes 1.7 s to remove, so the sweep
reclaimed one orphan per run at seven times its own deadline and fell behind as
soon as interruptions outpaced commits.

- Held the deadline inside an entry. An orphan is removed bottom-up in batches of
  64 leaf unlinks, with a clock check between batches and before each descent; a
  directory is removed only once empty, and what remains at the deadline is a
  smaller orphan the next run finishes. An orphan is garbage by definition, so a
  partial removal is progress, not damage.
- Restored a half-removed orphan's original times, since removing a child bumps
  the root's modification time and would otherwise hide it for a retention
  window.
- Unlinked a linked root inside an orphan, such as a linked `node_modules`, as a
  leaf, never entering it.
- Recorded what a run reclaimed on the evidence log entry, only when something
  was reclaimed, so envelope and evidence identities are untouched.

Three orphans planted from the real tree now clear in 29 runs with no run over
264 ms; the stated bound is the deadline plus one batch plus one directory read.
Retention stayed 24 hours and the deadline 250 ms. After TB-055, the ticket's
"bound in bytes" was the wrong axis: a cloned orphan costs almost no storage, and
entry count is what a sweep pays.
