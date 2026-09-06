/**
 * Evaluation snapshot materialization.
 *
 * The gate never grades the live worktree. It materializes the exact proposed
 * snapshot into a separate execution root and derives the snapshot identity
 * from the materialized root itself, so the returned identity can never name a
 * tree different from the one the checks executed against (SG-EVAL-001,
 * FR-EVAL-004, NFR-SEC-001).
 *
 * Nothing here writes to the repository: no index is written, no object is
 * created, and no commit is made. Git is used only to enumerate what the change
 * consists of — tracked paths, and the worktree status that says which of them
 * the tree still holds and which paths it holds that Git does not yet track.
 *
 * Known limitations, stated rather than half-modelled: a snapshot carries file
 * content only. File modes, symlink targets, and submodule commits are not part
 * of the identity, so a change to one of them alone is not something this gate
 * can see. They are recorded in the evaluation process contract.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { cp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

export const SNAPSHOT_KINDS = Object.freeze(['git-index', 'worktree']);

export const ISOLATION = 'materialized-snapshot';

/**
 * How a project's declared dependency roots are provided beside the snapshot.
 *
 * `link` places a symbolic link to the clone's own installation, which is
 * cheap and is what the maintainer would have run the tool against by hand.
 * `copy` places a real directory, which is what a tool that resolves a path to
 * its realpath needs in order to conclude that the code it is grading lives
 * inside the execution root rather than inside the original repository.
 *
 * The strategy is DECLARED by the project, never detected. Nothing here reads
 * the operating system or the filesystem and chooses on the project's behalf
 * (`NFR-PORT-002`): a maintainer on a filesystem that clones and a maintainer
 * on one that copies byte by byte write the same word and get the same
 * behaviour at different speeds.
 */
export const DEPENDENCY_PROVISIONING_STRATEGIES = Object.freeze(['link', 'copy']);

/**
 * What a project that says nothing gets.
 *
 * `link` is today's behaviour, so an existing clone that never heard of this
 * declaration is provisioned exactly as it always was and no configuration
 * identity churns on upgrade.
 */
export const DEFAULT_DEPENDENCY_PROVISIONING = 'link';

/**
 * The one place each strategy is performed.
 *
 * `link` passes `'junction'` rather than `'dir'`. The argument is a Node fs
 * parameter, not a branch: every platform but Windows ignores it outright, and
 * on Windows it selects a junction, which an ordinary user may create, over a
 * directory symbolic link, which needs elevated privilege or Developer Mode.
 * The old spelling gave `link` an independent reason to fail there, silently,
 * through the catch below. A junction needs an absolute target, which is what
 * the caller resolves and passes.
 *
 * `copy` asks for a copy-on-write clone through `COPYFILE_FICLONE`. The flag is
 * a request, never a requirement: where the clone cannot be performed the call
 * still succeeds as a full byte copy. That is one code path that is correct
 * everywhere, with only speed and disk varying, and it is why nothing here has
 * to know which filesystem it is on.
 *
 * What the request is worth was measured rather than assumed, and the answer on
 * the environment this repository claims is: nothing. Copying a 256 MiB file
 * with the flag consumed 256 MiB of free space, exactly as copying it without
 * the flag did, on an APFS volume where the system `cp -c` clones the same file
 * for free. `COPYFILE_FICLONE_FORCE`, which fails rather than falling back,
 * returns `ENOSYS` there. So a forced attempt would report "this filesystem
 * cannot clone" about one that plainly can, and catching it to learn which
 * happened would record a falsehood. The applied strategy is recorded instead,
 * because that is the part a maintainer can act on; whether the filesystem
 * cloned underneath is not.
 *
 * The consequence is stated rather than hidden: under `copy`, a dependency tree
 * costs its real bytes and its real seconds on this environment, which is
 * exactly why `copy` is declared by a project and never chosen for one.
 *
 * `copy` never degrades into `link`. A copy that cannot be performed leaves the
 * root unprovided and named, which is a stated failure the evaluation reports.
 */
const PROVISIONERS = Object.freeze({
  link: (source, destination) => symlink(source, destination, 'junction'),
  copy: (source, destination) => cp(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: true,
    // Links inside a dependency tree are kept as links. Resolving them would
    // follow a cycle forever and multiply what is on disk; a relative link
    // still resolves inside the copy, which is the whole point.
    dereference: false,
    mode: fileConstants.COPYFILE_FICLONE,
  }),
});

const NUL_SEPARATED = /\0/;

const defaultRunGit = async (repositoryRoot, args) => {
  const { stdout } = await runFile('git', args, {
    cwd: repositoryRoot,
    maxBuffer: 64 * 1024 * 1024,
  });

  return stdout;
};

const splitNul = (value) => value.split(NUL_SEPARATED).filter((entry) => entry.length > 0);

const digest = (value) => createHash('sha256').update(value).digest('hex');

/**
 * One content identity function for every snapshot kind. The identity is a
 * digest over sorted `path\0sha256(content)` pairs, so it is independent of
 * filesystem order, host paths, and timestamps.
 */
export const contentIdentity = (entries) => {
  const canonical = [...entries]
    .map(({ path: relative, contentDigest }) => `${relative}\x00${contentDigest}`)
    .sort()
    .join('\x01');

  return `sha256:${digest(canonical)}`;
};

const toPosix = (relative) => relative.split(path.sep).join('/');

/** Tracked paths, listed by Git so ignore rules are never re-implemented. */
export const listTrackedPaths = async (repositoryRoot, runGit = defaultRunGit) => splitNul(
  await runGit(repositoryRoot, ['ls-files', '-z']),
).sort();

/**
 * One parse of `git status --porcelain=v1 -z`, serving both questions the
 * snapshot asks of it: which paths changed, and which paths the worktree
 * actually holds. `git status` needs no HEAD, so a repository without commits
 * is handled without a special case.
 *
 * `-uall` is not optional here. Default untracked reporting collapses a wholly
 * new directory into a single `dir/` entry, and a snapshot materializes files:
 * a collapsed entry would be enumerated as a path that is not a file, and the
 * files the agent just wrote inside it would be graded by nothing
 * (`FR-EVAL-001`).
 *
 * Ignored paths are absent because `--ignored` is not asked for. That keeps the
 * ignore rules where Git owns them instead of re-implementing them here, and it
 * is why nothing git-ignored can reach a snapshot through this path
 * (`SG-EVAL-001`).
 */
const readStatus = async (repositoryRoot, runGit) => {
  const entries = splitNul(
    await runGit(repositoryRoot, ['status', '--porcelain=v1', '-z', '-uall']),
  );
  const records = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    const relative = entry.slice(3);
    let source = null;

    if ('RC'.includes(indexStatus) || 'RC'.includes(worktreeStatus)) {
      // A rename or copy record names its destination in the entry itself and
      // its source in a separate NUL-terminated field that follows.
      index += 1;
      source = entries[index] ?? null;
    }

    records.push({ indexStatus, worktreeStatus, relative, source });
  }

  return records;
};

/** Changed paths for applicability resolution. */
export const listChangedPaths = async (repositoryRoot, kind, runGit = defaultRunGit) => {
  const changed = new Set();

  for (const { indexStatus, worktreeStatus, relative, source } of await readStatus(
    repositoryRoot,
    runGit,
  )) {
    if (indexStatus === '?') {
      // An untracked path is nothing to the index, so it is not part of a
      // `git-index` change. For a worktree change it is the most common shape
      // the change takes — a file the agent just created — and reporting it as
      // no change at all is what kept applicability rules from ever seeing new
      // work (`FR-EVAL-001`).
      if (kind !== 'git-index') {
        changed.add(relative);
      }

      continue;
    }

    const staged = indexStatus !== ' ';

    if (kind === 'git-index' ? !staged : !staged && worktreeStatus === ' ') {
      continue;
    }

    changed.add(relative);

    // Both sides of a rename are the change: the source is gone and the
    // destination is new, so a rule matching either one sees the whole move. A
    // copy leaves its source exactly as it was and never names it.
    if (source !== null && (indexStatus === 'R' || worktreeStatus === 'R')) {
      changed.add(source);
    }
  }

  return [...changed].sort();
};

/**
 * The content set of a worktree snapshot: what a maintainer looking at the
 * clone would see, which is the tracked paths plus the untracked-and-not-
 * ignored ones, minus the ones the worktree no longer has.
 *
 * `git ls-files` alone answers a different question — what the index already
 * tracks — and grading that meant grading everything except the file the agent
 * had just written, while an ordinary deletion left an index entry pointing at
 * a file that was gone and failed the capture outright (`FR-EVAL-001`,
 * `NFR-REL-003`).
 *
 * A deletion is materialized by absence: the path is neither listed nor
 * written, so the identity still names exactly the tree the checks ran against
 * (`SG-EVAL-001`, `FR-EVAL-004`). Only that expected absence is excluded — a
 * path Git still reports and the filesystem cannot read remains a stated
 * failure.
 */
export const listWorktreePaths = async (repositoryRoot, runGit = defaultRunGit) => {
  const paths = new Set(await listTrackedPaths(repositoryRoot, runGit));

  for (const { indexStatus, worktreeStatus, relative } of await readStatus(
    repositoryRoot,
    runGit,
  )) {
    if (indexStatus === '?') {
      paths.add(relative);

      continue;
    }

    if (worktreeStatus === 'D' || indexStatus === 'D') {
      paths.delete(relative);
    }
  }

  return [...paths].sort();
};

const readBlobs = async (repositoryRoot, relatives) => {
  const blobs = [];

  for (const relative of relatives) {
    blobs.push({
      path: toPosix(relative),
      contents: await readFile(path.join(repositoryRoot, relative)),
    });
  }

  return blobs;
};

const materializeBlobs = async (executionRoot, blobs) => {
  for (const blob of blobs) {
    const absolute = path.join(executionRoot, blob.path);

    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, blob.contents);
  }
};

/**
 * Whether one declared dependency root is a repository-relative directory that
 * stays inside the repository.
 *
 * A declaration is a name a project wrote in its own policy, so it is checked
 * rather than trusted: an absolute path or one that climbs out would let a
 * declaration reach content the repository does not contain, which is a wider
 * thing than "let a check load what the project installed" (`SG-CMD-001`).
 */
const isContainedRoot = (declared) => {
  if (typeof declared !== 'string' || declared === '' || path.isAbsolute(declared)) {
    return false;
  }

  const normalized = path.normalize(declared);

  return normalized !== '..'
    && !normalized.startsWith(`..${path.sep}`)
    && !path.isAbsolute(normalized);
};

/**
 * Which declared dependency roots this clone cannot offer an evaluation, asked
 * of the clone alone.
 *
 * A root is refused when what was declared is not a contained repository-
 * relative directory, and missing when the clone simply never installed it.
 * Neither question is about a snapshot, so neither needs one — which is what
 * lets an evaluation that materializes nothing still report, by name, a
 * dependency root a check would have needed (`FR-EVAL-001`, `TB-039`).
 *
 * @param {object} input repository root and the declared roots
 * @returns {Promise<{missing: string[], refused: string[], available: string[]}>}
 */
export const unavailableDependencyRoots = async ({
  repositoryRoot,
  dependencyRoots = [],
}) => {
  const available = [];
  const missing = [];
  const refused = [];

  for (const declared of dependencyRoots) {
    if (!isContainedRoot(declared)) {
      refused.push(declared);

      continue;
    }

    const source = path.join(repositoryRoot, declared);
    // eslint-disable-next-line no-await-in-loop
    const installed = await stat(source).then((entry) => entry.isDirectory(), () => false);

    if (installed) {
      available.push(declared);
    } else {
      missing.push(declared);
    }
  }

  return { available, missing, refused };
};

/**
 * Provide the dependency roots a project declared, beside the snapshot.
 *
 * A materialized snapshot holds tracked content, and installed dependencies are
 * never tracked — so without this a tool starts and immediately cannot find the
 * autoloader, module tree, or binaries it needs to read the code at all. They
 * are environment, not subject: the same category as the executable `TB-024`
 * resolves outside the snapshot, and for the same reason.
 *
 * How each root is provided is the project's own declaration, not this
 * function's inference. Under `link` a root costs nothing to provide, which is
 * why it is the default: a dependency tree is large enough that copying it per
 * evaluation is a real charge against the budget. Under `copy` the root is a
 * real directory, which is what a tool that resolves a path to its realpath
 * needs — under `link` such a tool follows the link out of the execution root
 * and concludes, correctly for the link and wrongly for the evaluation, that
 * the project it is grading is the original repository. Formatters, static
 * analysis, and test runners have each been observed reporting that as a fault
 * in code that was not faulty.
 *
 * Nothing here is graded: a provided root is absent from the snapshot's path
 * list, so it is outside the identity, outside the immutability re-check, and
 * outside every path-based rule that reads it (`SG-EVAL-001`, `NFR-REL-001`).
 * That holds under both strategies, and is what keeps an evaluation
 * reproducible whichever one a project declares.
 */
const provideDependencyRoots = async ({
  repositoryRoot,
  executionRoot,
  dependencyRoots,
  provisioning,
}) => {
  const classified = await unavailableDependencyRoots({ repositoryRoot, dependencyRoots });
  const missing = new Set(classified.missing);
  const provide = PROVISIONERS[provisioning];
  const provided = [];

  for (const declared of classified.available) {
    const destination = path.join(executionRoot, declared);
    // A root is provided at a path this function creates, or it is not provided
    // at all. A declaration naming a path the snapshot already materialized is
    // reported unavailable rather than served by removing graded content to
    // make room for it (`SG-EVAL-001`), and knowing the path was ours is what
    // makes the cleanup below safe to perform.
    // eslint-disable-next-line no-await-in-loop
    const occupied = await stat(destination).then(() => true, () => false);

    if (occupied) {
      missing.add(declared);

      continue;
    }

    try {
      // eslint-disable-next-line no-await-in-loop
      await mkdir(path.dirname(destination), { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      await provide(path.resolve(repositoryRoot, declared), destination);
      provided.push(declared);
    } catch {
      // A strategy that could not be performed here is a stated condition, not
      // a silent degradation into the other one: the check would fail inside
      // its own tool otherwise, and a `copy` quietly served as a link would
      // reintroduce exactly the defect the declaration exists to close.
      //
      // What the attempt left behind goes with it. A recursive copy is not
      // atomic — it creates the destination before it can discover it cannot
      // finish — so a failure that walked away would leave a partial dependency
      // tree at exactly the path a tool looks for a complete one, and a tool
      // loading half a tree reports something worse than a tool loading none.
      // eslint-disable-next-line no-await-in-loop
      await rm(destination, { recursive: true, force: true }).catch(() => {});
      missing.add(declared);
    }
  }

  return {
    // The strategy that was actually applied, so a maintainer reading the
    // decision can tell which one the roots in front of them were provided by
    // without rerunning anything (`NFR-OPER-001`).
    provisioning,
    provided,
    // Declaration order, so what a maintainer reads back is the order they
    // wrote, whichever way a root turned out to be unavailable.
    missing: dependencyRoots.filter((declared) => missing.has(declared)),
    refused: classified.refused,
  };
};

/** Recompute the identity of what is actually on disk in the execution root. */
export const identifyExecutionRoot = async (executionRoot, relatives) => {
  const entries = [];

  for (const relative of relatives) {
    entries.push({
      path: relative,
      contentDigest: digest(await readFile(path.join(executionRoot, relative))),
    });
  }

  return contentIdentity(entries);
};

/**
 * Materialize the exact proposed snapshot into `executionRoot` and return its
 * identity. The identity is read back from the execution root, never from the
 * mutable live worktree.
 */
export const captureSnapshot = async ({
  repositoryRoot,
  kind,
  baseRevision = 'HEAD',
  executionRoot,
  runGit = defaultRunGit,
  dependencyRoots = [],
  dependencyProvisioning = DEFAULT_DEPENDENCY_PROVISIONING,
}) => {
  if (!SNAPSHOT_KINDS.includes(kind)) {
    return {
      captured: false,
      reasonCode: 'configuration-invalid',
      detail: `Snapshot target kind ${JSON.stringify(kind)} is not a supported evaluation target.`,
    };
  }

  // A strategy this module cannot perform ends the capture rather than being
  // repaired into the one it can. Resolving an unreadable declaration to a
  // working default is how a project ends up provisioned by a strategy it did
  // not ask for and cannot see (`FR-CFG-002`).
  if (!DEPENDENCY_PROVISIONING_STRATEGIES.includes(dependencyProvisioning)) {
    return {
      captured: false,
      reasonCode: 'configuration-invalid',
      detail: `Dependency provisioning strategy ${JSON.stringify(dependencyProvisioning)} is not one this gate can perform; declare ${DEPENDENCY_PROVISIONING_STRATEGIES.join(' or ')}.`,
    };
  }

  try {
    // Each kind is enumerated by the same question its materialization answers:
    // `checkout-index` writes the index, so the index is what `git-index` lists;
    // a worktree snapshot is written from the worktree, so the worktree is what
    // it lists. Enumerating one and materializing the other is what let the two
    // disagree (`SG-EVAL-001`).
    const relatives = kind === 'git-index'
      ? await listTrackedPaths(repositoryRoot, runGit)
      : await listWorktreePaths(repositoryRoot, runGit);

    await mkdir(executionRoot, { recursive: true });

    if (kind === 'git-index') {
      // `checkout-index` reads the index and writes only under the prefix; it
      // creates no Git object and touches no live file.
      await runGit(repositoryRoot, [
        'checkout-index',
        '--all',
        '--force',
        `--prefix=${executionRoot}${path.sep}`,
      ]);
    } else {
      await materializeBlobs(executionRoot, await readBlobs(repositoryRoot, relatives));
    }

    const paths = relatives.map((relative) => toPosix(relative)).sort();
    // The identity is derived before anything untracked is placed beside it and
    // over the tracked paths alone, so what a project installed can never move
    // the identity of what it wrote (NFR-REL-001).
    const id = await identifyExecutionRoot(executionRoot, paths);
    const changedPaths = await listChangedPaths(repositoryRoot, kind, runGit);
    const dependencies = await provideDependencyRoots({
      repositoryRoot,
      executionRoot,
      dependencyRoots,
      provisioning: dependencyProvisioning,
    });

    return {
      captured: true,
      snapshot: {
        kind,
        id,
        baseRevision,
        executionRoot,
        paths,
      },
      changedPaths,
      dependencies,
    };
  } catch (error) {
    return {
      captured: false,
      reasonCode: 'snapshot-mismatch',
      detail: `The exact snapshot could not be materialized: ${error.message}`,
    };
  }
};

/**
 * Re-derive the execution-root identity after evaluation. Any difference means
 * the graded tree is not the tree the decision names, which is exactly the
 * condition SG-EVAL-001 forbids from authorizing anything.
 */
export const verifySnapshot = async (snapshot) => {
  try {
    const observed = await identifyExecutionRoot(snapshot.executionRoot, snapshot.paths);

    return observed === snapshot.id
      ? { verified: true, observedId: observed }
      : {
        verified: false,
        observedId: observed,
        reasonCode: 'snapshot-mismatch',
        detail: 'The execution root changed during evaluation; evaluated source must stay immutable.',
      };
  } catch (error) {
    return {
      verified: false,
      observedId: null,
      reasonCode: 'snapshot-mismatch',
      detail: `The execution root could not be re-identified: ${error.message}`,
    };
  }
};
