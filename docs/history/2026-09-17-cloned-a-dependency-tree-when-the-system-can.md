# Cloned a dependency tree when the system can

Delivered TB-055. TB-054 assumed Node's copy flag performs a copy-on-write clone
where the filesystem supports one. Measured, it did not: `COPYFILE_FICLONE`
consumed the full size of every file and `COPYFILE_FICLONE_FORCE` returned
`ENOSYS`, so `copy` cost 380 MiB and eleven seconds per evaluation on a tree the
system could have cloned for nothing.

- Resolved the platform's copy program from the base utility directories, never
  the ambient search path, and probed it once per capture, lazily, on the first
  copied root.
- Measured rather than trusted. An exit status is not a clone signal, because a
  program on a filesystem that cannot clone exits zero and byte-copies silently.
  The probe clones an eight-megabyte file and compares free space before and
  after; two request spellings are tried and judged by that measurement, never by
  naming a platform.
- Kept TB-054's byte copy as the fallback when no program is found or no clone is
  measured, and removed a clone that fails part way before the byte copy begins.
- Recorded each copied root's mechanism and the program's resolved path; a
  capture that copies nothing records nothing new.
- Fixed a hazard this exposed in the byte copy: `fs.cp` rewrote a relative
  symbolic link inside the tree to an absolute path into the source, so a write
  through it could reach the maintainer's repository. Links are now kept as
  written, and both mechanisms produce the same tree, link by link.

Measured through this path on the real tree: clone 6.7 s and 7 MiB, byte copy
10.7 s and 381 MiB, identical snapshot identity. Free-space assertions on the
byte-copy path were removed from fixtures because they raced with sibling tests;
the mechanism record is the proof there.
