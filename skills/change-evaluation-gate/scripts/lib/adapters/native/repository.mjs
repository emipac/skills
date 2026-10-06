import { stat } from 'node:fs/promises';
import path from 'node:path';

/** Whether one directory is a repository root, by the only marker Git guarantees. */
const hasRepositoryMarker = async (directory) => {
  try {
    // A worktree or submodule carries `.git` as a file rather than a directory,
    // so the marker's kind is deliberately not inspected.
    await stat(path.join(directory, '.git'));

    return true;
  } catch {
    return false;
  }
};

/**
 * Resolve the repository root that contains one path, or `null`.
 *
 * The path a client sends is not a repository root. Real captures show the same
 * field carrying a repository root under one client and a directory *above* the
 * repository under another, so neither assumption is safe. This walks upward
 * from the given path and returns the first real repository root it finds.
 *
 * When no repository contains the path, the answer is `null` and the caller
 * reports `unverified`. It never falls back to the path it was given: a
 * repository root the Gate guessed is worse than one it admits it lacks
 * (FR-ADAPT-005, SG-EVAL-001).
 */
export const resolveRepositoryRoot = async (candidate, { isRepositoryRoot } = {}) => {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return null;
  }

  const test = typeof isRepositoryRoot === 'function' ? isRepositoryRoot : hasRepositoryMarker;
  let directory = path.resolve(candidate);

  for (;;) {
    if (await test(directory) === true) {
      return directory;
    }

    const parent = path.dirname(directory);

    if (parent === directory) {
      return null;
    }

    directory = parent;
  }
};
