/**
 * Where a pinned executable is invoked from (`TB-056`).
 *
 * Activation resolves a `composer-bin` executable against the repository root
 * and pins that absolute path (`TB-024`). Evaluation materializes the snapshot
 * elsewhere and provides the project's declared dependency roots beside it
 * (`TB-054`). Under `link` the provided root and the original are one tree, so
 * the pinned path and the provided one name one file. Under `copy` they are
 * two trees, and a program launched from the original tree that also loads the
 * project's tree from its working directory loads the same code twice — the
 * Composer shim sets its autoloader from `__DIR__`, PHPStan then loads the
 * project's autoloader from the tree it grades, and PHP reports a redeclared
 * class.
 *
 * The rule this module states: a provided root is where its binaries run from.
 * A pinned executable that lies under a root the snapshot was given is invoked
 * at the same relative location inside the execution root — after the two are
 * proved to be the same bytes. Nothing is re-resolved: the program that runs
 * is the program activation proved, read from beside the code it grades.
 *
 * Deliberately outside every rule here: the interpreter, which is found
 * wherever the platform put it and is under no dependency root; an executable
 * outside every provided root, which has only ever had one location; and a
 * root that was declared but `missing` or `refused`, for which the original is
 * all there is and `TB-054` already states the failure.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * The roots an evaluation actually received, each with the strategy it was
 * provided by.
 *
 * This is the ONE place the decision's dependency record is read for
 * re-basing, and it is per root on purpose. The record's `provisioning` is
 * either one scalar every provided root shares, or — since `TB-057` — a
 * complete map from each declared root to the strategy it received, so
 * `vendor` may be copied while `node_modules` is linked in the same
 * evaluation. This projection reads whichever shape the record carries, and
 * nothing that consumes the result has to know which: nothing else ever reads
 * the record for re-basing.
 *
 * Re-basing itself does not branch on the strategy: a root the snapshot was
 * given is where its binaries run from, and under `link` that is the same file
 * by another name. The strategy travels so evidence can say which one a root
 * received.
 */
export const providedRoots = (dependencies) => {
  const provisioning = dependencies?.provisioning ?? null;
  const strategyOf = (root) => {
    if (typeof provisioning === 'string') {
      return provisioning;
    }

    return typeof provisioning === 'object' && provisioning !== null
      && Object.hasOwn(provisioning, root) && typeof provisioning[root] === 'string'
      ? provisioning[root]
      : null;
  };

  return (Array.isArray(dependencies?.provided) ? dependencies.provided : [])
    .filter((root) => typeof root === 'string' && root !== '')
    .map((root) => ({ root, strategy: strategyOf(root) }));
};

/** The path below `parent` at which `candidate` lies, or `null` if it does not. */
const remainderUnder = (parent, candidate) => {
  const relative = path.relative(parent, candidate);

  if (relative === '' || path.isAbsolute(relative) || relative.split(path.sep)[0] === '..') {
    return null;
  }

  return relative;
};

/**
 * Every spelling of the repository root a pin may have been resolved against.
 *
 * Activation resolved the executable by joining the repository root it was
 * handed; the runner grading a commit may hold the same directory under
 * another spelling (a macOS temporary directory is both `/var/...` and
 * `/private/var/...`). The pinned path is matched as pinned, against each.
 */
const rootSpellings = async (repositoryRoot) => {
  const spellings = new Set([path.resolve(repositoryRoot)]);

  try {
    spellings.add(await realpath(repositoryRoot));
  } catch {
    // An unresolvable repository root has only the spelling it was given.
  }

  return [...spellings];
};

/**
 * Where one pinned executable is invoked from.
 *
 * Returns the pinned path, the invoked path, and the provided root that made
 * them differ — `null` when nothing re-based, in which case the invoked path
 * IS the pinned path. Pure with respect to the executable: nothing here reads
 * or checks it; equivalence is a separate proof.
 */
export const locateExecutable = async ({
  executable,
  repositoryRoot,
  executionRoot,
  roots = [],
}) => {
  const unmoved = {
    pinned: executable, invoked: executable, root: null, strategy: null,
  };

  if (typeof executable !== 'string' || executable === ''
    || typeof repositoryRoot !== 'string' || repositoryRoot === ''
    || typeof executionRoot !== 'string' || executionRoot === ''
    || roots.length === 0) {
    return unmoved;
  }

  const spellings = await rootSpellings(repositoryRoot);

  for (const { root, strategy } of roots) {
    for (const spelling of spellings) {
      const remainder = remainderUnder(path.resolve(spelling, root), executable);

      if (remainder !== null) {
        return {
          pinned: executable,
          invoked: path.join(executionRoot, root, remainder),
          root,
          strategy,
        };
      }
    }
  }

  return unmoved;
};

/**
 * The runtime search path, with every entry under a provided root relocated.
 *
 * `runtimeSearchPath` is derived from the pins before any snapshot exists, so
 * it names the directory of every pinned executable — for a `composer-bin`
 * pin, the binaries directory of the original dependency tree. A tool that starts a sibling
 * binary by name rather than by `__DIR__` looks it up on this path, and under
 * `copy` would find the original tree while running from the provided one:
 * the same two-trees defect as `locateExecutable` closes, through a different
 * door.
 *
 * Each entry is relocated by the same rule as an executable — the same
 * relative location inside the execution root — and the original is not kept
 * beside it, because under `copy` an original that stays on the path shadows
 * nothing only by luck of ordering. Under `link` the relocated entry is the
 * same directory by another name. Entries outside every provided root, and
 * the platform base entries, pass through unchanged.
 */
export const relocateSearchPath = async ({
  runtimePath,
  repositoryRoot,
  executionRoot,
  roots = [],
}) => {
  if (typeof runtimePath !== 'string' || runtimePath === '' || roots.length === 0) {
    return runtimePath ?? '';
  }

  const relocated = [];

  for (const entry of runtimePath.split(path.delimiter)) {
    if (entry === '') {
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const { invoked } = await locateExecutable({
      executable: entry, repositoryRoot, executionRoot, roots,
    });

    if (!relocated.includes(invoked)) {
      relocated.push(invoked);
    }
  }

  return relocated.join(path.delimiter);
};

/** The content identity of one file, streamed; rejects if it cannot be read. */
export const fileIdentity = (file) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');

  createReadStream(file)
    .on('error', reject)
    .on('data', (chunk) => hash.update(chunk))
    .on('end', () => resolve(`sha256:${hash.digest('hex')}`));
});

/**
 * Prove the invoked copy is the pinned program, byte for byte.
 *
 * The pin carries no content identity — `version` is `null` for a vendor
 * binary and nothing hashed it — so "the same program" has meant "the same
 * path" until here. This is the equivalence at the moment it matters: equal
 * bytes and the copy is invoked; anything else and neither is run, because
 * running a program activation did not prove is the substitution `TB-024`
 * forbids (`NFR-REL-003`).
 *
 * Under `link` the two paths are one file and this reads it twice, which is
 * the whole cost of never having to know which strategy provided the root.
 */
export const proveSameProgram = async (pinned, invoked) => {
  if (pinned === invoked) {
    return { same: true, identity: null };
  }

  let identities;

  try {
    identities = await Promise.all([fileIdentity(pinned), fileIdentity(invoked)]);
  } catch (error) {
    return { same: false, identity: null, detail: `could not be read to compare: ${error.message}` };
  }

  const [pinnedIdentity, invokedIdentity] = identities;

  return pinnedIdentity === invokedIdentity
    ? { same: true, identity: pinnedIdentity }
    : {
      same: false,
      identity: null,
      detail: `${pinnedIdentity} at the pinned path, ${invokedIdentity} at the provided one`,
    };
};
