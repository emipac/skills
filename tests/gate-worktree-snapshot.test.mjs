/**
 * TB-034 — Grade the whole worktree change, including the files that are new.
 *
 * A worktree snapshot was materialized from `git ls-files`, which lists index
 * entries. So the preflight graded everything except the file the agent had
 * just written, and an ordinary deletion made `readBlobs` fail on a path that
 * was no longer there — turning a routine `rm` into `snapshot-mismatch` and the
 * whole preflight into `unverified`.
 *
 * Every snapshot fixture in this repository until now modified a file that
 * already existed, which is why a preflight that cannot see new work looked
 * correct throughout.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { captureSnapshot, verifySnapshot } from '../skills/change-evaluation-gate/scripts/lib/snapshot.mjs';

const runFile = promisify(execFile);

const isolatedGit = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const git = (root, args) => runFile('git', args, { cwd: root, env: isolatedGit() });

/** A committed clone: tracked source, one git-ignored directory, nothing dirty. */
const clone = async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gate-worktree-snapshot-'));

  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, '.gitignore'), 'ignored/\n', 'utf8');
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  await writeFile(path.join(root, 'app/Legacy.php'), 'legacy\n', 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await git(root, [
    '-c', 'user.email=gate@example.test', '-c', 'user.name=Gate Worktree',
    'commit', '--quiet', '--message', 'baseline',
  ]);

  return root;
};

const executionRoot = async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gate-worktree-exec-'));

  t.after(() => rm(root, { recursive: true, force: true }));

  return root;
};

const read = (root, relative) => readFile(path.join(root, relative), 'utf8').catch(() => null);

test('TB-034 FR-EVAL-001, AC-EVAL-001: a worktree snapshot contains the new file, omits the deleted one, and captures', async (t) => {
  const root = await clone(t);

  await writeFile(path.join(root, 'app/Order.php'), 'modified\n', 'utf8');
  await writeFile(path.join(root, 'app/Refund.php'), 'brand new\n', 'utf8');
  await rm(path.join(root, 'app/Legacy.php'));

  const target = await executionRoot(t);
  const capture = await captureSnapshot({
    repositoryRoot: root,
    kind: 'worktree',
    executionRoot: target,
  });

  assert.equal(capture.captured, true, `an ordinary deletion is not a failure to capture: ${capture.detail}`);
  assert.deepEqual(
    capture.snapshot.paths,
    ['.gitignore', 'app/Order.php', 'app/Refund.php'],
    'the snapshot enumerates the tree the worktree actually holds.',
  );
  assert.equal(await read(target, 'app/Refund.php'), 'brand new\n', 'the file the agent just wrote is graded.');
  assert.equal(await read(target, 'app/Order.php'), 'modified\n');
  assert.equal(await read(target, 'app/Legacy.php'), null, 'a deletion is materialized by absence.');

  // The enumerated paths and the materialized files must be exactly the same
  // set, or `verifySnapshot` cannot re-derive the identity it was given.
  const verified = await verifySnapshot(capture.snapshot);

  assert.equal(verified.verified, true, JSON.stringify(verified));
  assert.deepEqual(
    capture.changedPaths,
    ['app/Legacy.php', 'app/Order.php', 'app/Refund.php'],
    'a new file is a changed path; reporting it as no change at all is what hid it from applicability.',
  );
});

test('TB-034 FR-EVAL-001: both sides of a rename are the change, staged or not', async (t) => {
  for (const stage of [false, true]) {
    const root = await clone(t);

    await git(root, ['mv', 'app/Legacy.php', 'app/Renamed.php']);

    if (!stage) {
      // Undo the staging `git mv` performs, leaving the move Git has to infer
      // from a deleted path and an untracked one — the shape a plain `mv` or an
      // editor's rename leaves behind.
      await git(root, ['reset', '--quiet']);
    }

    const target = await executionRoot(t);
    const capture = await captureSnapshot({
      repositoryRoot: root,
      kind: 'worktree',
      executionRoot: target,
    });

    assert.equal(capture.captured, true, capture.detail);
    assert.deepEqual(
      capture.snapshot.paths,
      ['.gitignore', 'app/Order.php', 'app/Renamed.php'],
      `staged: ${stage} — the snapshot holds the destination and not the source.`,
    );
    assert.equal(await read(target, 'app/Renamed.php'), 'legacy\n');
    assert.equal(await read(target, 'app/Legacy.php'), null);
    assert.deepEqual(
      capture.changedPaths,
      ['app/Legacy.php', 'app/Renamed.php'],
      `staged: ${stage} — an applicability rule matching either side sees the whole move.`,
    );
  }
});

test('TB-034 FR-EVAL-001: a wholly new directory is enumerated file by file, not as a directory', async (t) => {
  const root = await clone(t);

  await mkdir(path.join(root, 'tests/Feature'), { recursive: true });
  await writeFile(path.join(root, 'tests/Feature/MazeTest.php'), 'new test\n', 'utf8');

  const target = await executionRoot(t);
  const capture = await captureSnapshot({
    repositoryRoot: root,
    kind: 'worktree',
    executionRoot: target,
  });

  assert.equal(capture.captured, true, capture.detail);
  assert.equal(
    capture.snapshot.paths.includes('tests/Feature/MazeTest.php'),
    true,
    `the recorded real-project session had exactly this shape: ${JSON.stringify(capture.snapshot.paths)}`,
  );
  assert.equal(
    capture.snapshot.paths.some((entry) => entry.endsWith('/')),
    false,
    'a snapshot materializes files; a collapsed directory entry is not one.',
  );
  assert.equal(await read(target, 'tests/Feature/MazeTest.php'), 'new test\n');
});

test('TB-034 SG-EVAL-001: git-ignored content never enters a worktree snapshot, and a dependency root that provides it stays outside the identity', async (t) => {
  const root = await clone(t);

  await mkdir(path.join(root, 'ignored'), { recursive: true });
  await writeFile(path.join(root, 'ignored/installed.txt'), 'installed\n', 'utf8');

  const plain = await executionRoot(t);
  const capture = await captureSnapshot({
    repositoryRoot: root,
    kind: 'worktree',
    executionRoot: plain,
  });

  assert.deepEqual(capture.snapshot.paths, ['.gitignore', 'app/Legacy.php', 'app/Order.php']);
  assert.equal(await read(plain, 'ignored/installed.txt'), null, 'untracked means untracked-and-not-ignored.');

  // The one legitimate way git-ignored content reaches an execution root is a
  // declared dependency root (TB-030), and it must still be graded by nothing.
  const provided = await executionRoot(t);
  const withRoot = await captureSnapshot({
    repositoryRoot: root,
    kind: 'worktree',
    executionRoot: provided,
    dependencyRoots: ['ignored'],
  });

  assert.deepEqual(withRoot.dependencies.provided, ['ignored']);
  assert.equal(await read(provided, 'ignored/installed.txt'), 'installed\n');
  assert.equal(withRoot.snapshot.id, capture.snapshot.id, 'a provided root is outside the identity.');
  assert.deepEqual(withRoot.snapshot.paths, capture.snapshot.paths);
});

test('TB-034 NFR-REL-003: a path Git still reports and the filesystem cannot read is still a stated failure', async (t) => {
  const root = await clone(t);
  // Only the *expected* absence of a deleted path stops being an error. A path
  // Git lists with no deletion recorded against it is a tree the gate cannot
  // materialize, and saying so is the whole point of NFR-REL-003.
  const phantomTracked = async (repositoryRoot, args) => {
    const { stdout } = await runFile('git', args, { cwd: repositoryRoot, env: isolatedGit() });

    return args[0] === 'ls-files' ? `${stdout}app/Vanished.php\0` : stdout;
  };
  const capture = await captureSnapshot({
    repositoryRoot: root,
    kind: 'worktree',
    executionRoot: await executionRoot(t),
    runGit: phantomTracked,
  });

  assert.equal(capture.captured, false);
  assert.equal(capture.reasonCode, 'snapshot-mismatch');
  assert.match(capture.detail, /Vanished\.php/);
});

test('TB-034 FR-EVAL-004: the git-index path is byte-identical to what it graded before, in a worktree full of reasons it could drift', async (t) => {
  const root = await clone(t);

  // Everything this slice changed, all at once, and none of it is the index:
  // a staged addition, a staged deletion, an untracked file, a worktree
  // deletion of a tracked path, and git-ignored content.
  await writeFile(path.join(root, 'app/Staged.php'), 'staged addition\n', 'utf8');
  await git(root, ['add', 'app/Staged.php']);
  await git(root, ['rm', '--quiet', 'app/Legacy.php']);
  await writeFile(path.join(root, 'app/Untracked.php'), 'never staged\n', 'utf8');
  await rm(path.join(root, 'app/Order.php'));
  await mkdir(path.join(root, 'ignored'), { recursive: true });
  await writeFile(path.join(root, 'ignored/installed.txt'), 'installed\n', 'utf8');

  const target = await executionRoot(t);
  const capture = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot: target,
  });

  assert.equal(capture.captured, true, capture.detail);
  assert.deepEqual(
    capture.snapshot.paths,
    ['.gitignore', 'app/Order.php', 'app/Staged.php'],
    'a commit is graded on the index: the staged addition is in and the staged deletion is out.',
  );
  assert.equal(
    capture.snapshot.id,
    'sha256:cdeecced9fbeebdcc5b5f88e7f477f35f17f6dd923c999543b008c92047e721e',
    // Recorded by running this fixture against the pre-TB-034 module. A commit
    // is graded on the same tree, under the same identity, as it was before.
    'the identity a commit is graded under is a recorded constant, not whatever this build produces.',
  );
  assert.equal(
    await read(target, 'app/Order.php'),
    'baseline\n',
    'the index still holds the committed content of a path the worktree no longer has.',
  );
  assert.equal(await read(target, 'app/Untracked.php'), null);
  assert.equal(await read(target, 'ignored/installed.txt'), null);
  assert.deepEqual(
    capture.changedPaths,
    ['app/Legacy.php', 'app/Staged.php'],
    'the index change is the staged addition and the staged deletion.',
  );
});

test('TB-034 FR-EVAL-004: creating a file moves the worktree snapshot identity', async (t) => {
  const root = await clone(t);
  const before = await captureSnapshot({
    repositoryRoot: root,
    kind: 'worktree',
    executionRoot: await executionRoot(t),
  });

  await writeFile(path.join(root, 'app/Refund.php'), 'brand new\n', 'utf8');

  const after = await captureSnapshot({
    repositoryRoot: root,
    kind: 'worktree',
    executionRoot: await executionRoot(t),
  });

  // TB-027 bounds preflight repetition by counting prior Evidence entries
  // carrying the same `evaluationId`, and that identity is derived from the
  // snapshot identity. New content must therefore produce a new identity, or an
  // agent that answers feedback by adding a file would be told its unchanged
  // verdict had already been reported and silenced.
  assert.notEqual(after.snapshot.id, before.snapshot.id);
});
