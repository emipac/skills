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
import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

export const SNAPSHOT_KINDS = Object.freeze(['git-index', 'worktree']);

export const ISOLATION = 'materialized-snapshot';

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
 * Provide the dependency roots a project declared, beside the snapshot.
 *
 * A materialized snapshot holds tracked content, and installed dependencies are
 * never tracked — so without this a tool starts and immediately cannot find the
 * autoloader, module tree, or binaries it needs to read the code at all. They
 * are environment, not subject: the same category as the executable `TB-024`
 * resolves outside the snapshot, and for the same reason.
 *
 * Each root is linked rather than copied. A dependency tree is large enough
 * that copying it per evaluation would make the budget meaningless, and the
 * link is to the clone's own installation, which is what the maintainer would
 * have run the tool against by hand.
 *
 * Nothing here is graded: a provided root is absent from the snapshot's path
 * list, so it is outside the identity, outside the immutability re-check, and
 * outside every path-based rule that reads it (`SG-EVAL-001`, `NFR-REL-001`).
 */
const provideDependencyRoots = async ({ repositoryRoot, executionRoot, dependencyRoots }) => {
  const provided = [];
  const missing = [];
  const refused = [];

  for (const declared of dependencyRoots) {
    if (!isContainedRoot(declared)) {
      refused.push(declared);

      continue;
    }

    const source = path.join(repositoryRoot, declared);
    const installed = await stat(source).then((entry) => entry.isDirectory(), () => false);

    if (!installed) {
      missing.push(declared);

      continue;
    }

    const destination = path.join(executionRoot, declared);

    try {
      await mkdir(path.dirname(destination), { recursive: true });
      await symlink(source, destination, 'dir');
      provided.push(declared);
    } catch (error) {
      // A platform or filesystem that cannot link is a stated condition, not a
      // silent degradation: the check would fail inside its own tool otherwise.
      missing.push(declared);
    }
  }

  return { provided, missing, refused };
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
}) => {
  if (!SNAPSHOT_KINDS.includes(kind)) {
    return {
      captured: false,
      reasonCode: 'configuration-invalid',
      detail: `Snapshot target kind ${JSON.stringify(kind)} is not a supported evaluation target.`,
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
