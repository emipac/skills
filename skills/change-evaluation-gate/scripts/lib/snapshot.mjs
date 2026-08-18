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
 * created, and no commit is made. Git is used only to enumerate tracked paths
 * and staged status.
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
 * Changed paths for applicability resolution. `git status --porcelain` needs no
 * HEAD, so a repository without commits is handled without a special case.
 */
export const listChangedPaths = async (repositoryRoot, kind, runGit = defaultRunGit) => {
  const stdout = await runGit(repositoryRoot, ['status', '--porcelain=v1', '-z']);
  const changed = new Set();
  const entries = splitNul(stdout);

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    const relative = entry.slice(3);

    if (indexStatus === 'R' || indexStatus === 'C') {
      // Rename and copy entries are followed by their source path.
      index += 1;
    }

    if (indexStatus === '?') {
      continue;
    }

    if (kind === 'git-index') {
      if (indexStatus !== ' ') {
        changed.add(relative);
      }

      continue;
    }

    if (indexStatus !== ' ' || worktreeStatus !== ' ') {
      changed.add(relative);
    }
  }

  return [...changed].sort();
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
    const relatives = await listTrackedPaths(repositoryRoot, runGit);

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
