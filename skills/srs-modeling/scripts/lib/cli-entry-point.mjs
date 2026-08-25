// Decide whether this module is the command the process was asked to run.
//
// `import.meta.url` is the module's *resolved* URL: Node follows symbolic links
// when it loads a module. `process.argv[1]` is the path the caller typed, and it
// follows nothing. A client that installs a skill by linking — `.claude/skills`
// linked at `.agents/skills`, for instance — therefore presents two different
// paths for one file, and comparing them raw decides the script is merely being
// imported: no command runs, nothing is printed, and the process exits 0.
//
// Resolving both sides to their real path asks the only question that matters —
// is this file the entry point? — whatever path the caller used to reach it.
//
// This file is the single definition of that rule. Skills install independently
// and must never depend on another skill's files, so it cannot be imported
// across skill boundaries; it is vendored byte-for-byte into every skill that
// ships a command, and `npm run validate` fails if any copy diverges.

import { realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// A path that does not exist, or that cannot be read, is not a reason to fail:
// resolution falls back to the normalized path, and the comparison then simply
// reports that this module is not the entry point. This runs on every import,
// so throwing here would be a worse defect than the silent no-op it replaces.
const realPathOf = (candidate) => {
  const absolute = path.resolve(candidate);

  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
};

export const isCliEntryPoint = (moduleUrl) => {
  const entryPoint = process.argv[1];

  if (!entryPoint) {
    return false;
  }

  let modulePath;

  try {
    modulePath = fileURLToPath(moduleUrl);
  } catch {
    // A module loaded from something other than a file — a data: URL, say — is
    // never the path the caller invoked.
    return false;
  }

  return realPathOf(modulePath) === realPathOf(entryPoint);
};
