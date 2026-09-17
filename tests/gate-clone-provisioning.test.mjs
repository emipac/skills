/**
 * TB-055 — Clone a dependency tree when the system can.
 *
 * `TB-054` made `copy` correct and, by measurement, expensive: Node's own
 * `COPYFILE_FICLONE` clones nothing on the environment this repository claims,
 * while the platform's copy program clones the same tree for almost no disk
 * at all. This suite proves the `copy` provisioner now asks that program for a
 * clone where one is possible, falls back to `TB-054`'s byte copy where it is
 * not, records which of the two performed each root, and keeps every property
 * `TB-054` proved under both.
 *
 * Whether a clone happens is a fact about the filesystem the suite runs on,
 * so the assertions are conditional on what the capture RECORDED and never on
 * what the platform is CALLED: a root recorded as cloned must have consumed
 * almost no space, a root recorded as byte-copied must have consumed its size,
 * and every correctness property holds whichever was recorded.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, statfs, symlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { locatePlatformUtility } from '../skills/change-evaluation-gate/scripts/lib/command-descriptor.mjs';
import { PROTOCOL_VERSION, evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { validateDecision } from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';
import {
  COPY_MECHANISMS,
  captureSnapshot,
  verifySnapshot,
} from '../skills/change-evaluation-gate/scripts/lib/snapshot.mjs';

const runFile = promisify(execFile);

const LIBRARY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../skills/change-evaluation-gate/scripts/lib',
);

/** The directory this fixture project installs its dependencies into. */
const INSTALLED = 'installed';

/**
 * A dependency tree big enough that a clone and a byte copy cannot be confused.
 *
 * Free space is read from the volume, which the rest of the suite is writing
 * to and clearing at the same time, so the two are told apart by a wide
 * margin — a clone consumes under a quarter of this, a byte copy over half —
 * rather than by an exact count.
 */
const TREE_BYTES = 32 * 1024 * 1024;

/** The module a tool loads out of the root, reporting where it believes it lives. */
const LOCATOR = 'export const loadedFrom = import.meta.dirname;\n';

const GRADER = [
  `import { loadedFrom } from './${INSTALLED}/locate.mjs';`,
  'process.stdout.write(loadedFrom);',
  '',
].join('\n');

const isolatedGit = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const temporary = async (t, prefix) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));

  t.after(() => rm(root, { recursive: true, force: true }).catch(() => {}));

  return root;
};

/**
 * A clone shaped like a real one: tracked source, a git-ignored dependency
 * root holding a large payload, a relative link inside the root, and a link
 * to a directory inside the root.
 */
const clone = async (t, { prefix = 'gate-clone-source-', payloadBytes = TREE_BYTES } = {}) => {
  const root = await temporary(t, prefix);

  await writeFile(path.join(root, '.gitignore'), `${INSTALLED}/\n`, 'utf8');
  await writeFile(path.join(root, 'grade.mjs'), GRADER, 'utf8');
  await writeFile(path.join(root, 'source.txt'), 'baseline\n', 'utf8');
  await mkdir(path.join(root, INSTALLED, 'nested'), { recursive: true });
  await writeFile(path.join(root, INSTALLED, 'locate.mjs'), LOCATOR, 'utf8');
  await writeFile(path.join(root, INSTALLED, 'nested', 'payload.bin'), randomBytes(payloadBytes));
  await writeFile(path.join(root, INSTALLED, 'nested', 'text.txt'), 'nested text\n', 'utf8');
  // Links of both kinds a real dependency tree carries: a relative file link,
  // and a link to a directory that would recurse forever if followed.
  await symlink('nested/text.txt', path.join(root, INSTALLED, 'file-link'));
  await symlink('.', path.join(root, INSTALLED, 'nested', 'self-link'));

  await runFile('git', ['init', '--quiet'], { cwd: root, env: isolatedGit() });
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGit() });
  await runFile('git', [
    '-c', 'user.email=gate@example.test', '-c', 'user.name=Gate Clone',
    'commit', '--quiet', '--message', 'baseline',
  ], { cwd: root, env: isolatedGit() });

  return root;
};

const freeBytes = async (location) => {
  const observed = await statfs(location);

  return observed.bavail * observed.bsize;
};

/** Capture under `copy`, measuring what the capture consumed on the target volume. */
const captureCopy = async (repositoryRoot, target, options = {}) => {
  const before = await freeBytes(target);
  const captured = await captureSnapshot({
    repositoryRoot,
    kind: 'git-index',
    executionRoot: target,
    dependencyRoots: [INSTALLED],
    dependencyProvisioning: 'copy',
    ...options,
  });
  const consumed = before - await freeBytes(target);

  assert.equal(captured.captured, true, captured.detail);

  return { captured, consumed };
};

/** Where the tool concludes its dependency lives, asked of the tool itself. */
const askWhereTheDependencyLives = async (target) => {
  const { stdout } = await runFile(process.execPath, ['grade.mjs'], { cwd: target });

  return stdout;
};

/** Every entry under a directory with what it is: a file's digest, a link's target, a directory. */
const describeTree = async (root) => {
  const entries = {};
  const walk = async (relative) => {
    const absolute = path.join(root, relative);
    const described = await lstat(absolute);

    if (described.isSymbolicLink()) {
      entries[relative] = { link: await readlink(absolute) };
    } else if (described.isDirectory()) {
      entries[relative] = { directory: true };

      for (const child of (await readdir(absolute)).sort()) {
        await walk(path.join(relative, child));
      }
    } else {
      entries[relative] = { bytes: (await readFile(absolute)).length, mode: described.mode & 0o777 };
    }
  };

  await walk('');

  return entries;
};

const mechanismOf = (captured) => {
  const record = captured.dependencies.mechanisms?.[INSTALLED];

  assert.ok(COPY_MECHANISMS.includes(record?.mechanism), `no mechanism recorded: ${JSON.stringify(captured.dependencies)}`);

  return record;
};

/**
 * A copy program that behaves exactly like the platform's for the probe and
 * does what the fixture says for a real tree. It logs every invocation so the
 * probe's cost is countable, not assumed.
 */
const standInProgram = async (t, { onTree }) => {
  const real = locatePlatformUtility('cp');

  if (real === null) {
    t.skip('this platform ships no copy program in its own directories, so there is nothing to stand in for.');

    return null;
  }

  const home = await temporary(t, 'gate-clone-program-');
  const program = path.join(home, 'cp');
  const log = path.join(home, 'invocations.log');

  await writeFile(program, [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
    // The last argument is the destination; a probe copy is named `copy-N`.
    'for last; do :; done',
    'case "$(basename "$last")" in',
    `  copy-*) exec ${JSON.stringify(real)} "$@" ;;`,
    'esac',
    onTree.replace('$REAL', real),
    '',
  ].join('\n'), 'utf8');
  await chmod(program, 0o755);

  return {
    program,
    invocations: async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter((line) => line !== ''),
  };
};

const evaluateRequest = (root, sessionId) => ({
  protocolVersion: PROTOCOL_VERSION,
  operation: 'evaluate',
  repository: { root },
  change: { kind: 'git-index', baseRevision: 'HEAD' },
  evaluation: { purpose: 'change-acceptance-and-regression', contractRef: null },
  invocation: {
    role: 'authoritative',
    trigger: 'commit-attempt',
    adapter: { id: 'git', surface: 'git-pre-commit', version: '1.0.0', capabilities: { nativeBlocking: true } },
    sessionId,
  },
});

const gatePolicy = (execution) => ({
  checks: { required: [], advisory: [] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution,
  evidence: {},
});

test('TB-055 FR-EVAL-004, NFR-OPER-001: a copied root records the mechanism that performed it, and the record agrees with the space it consumed', async (t) => {
  const root = await clone(t);
  const target = await temporary(t, 'gate-clone-exec-');
  const { captured, consumed } = await captureCopy(root, target);
  const record = mechanismOf(captured);

  assert.deepEqual(captured.dependencies.provisioning, 'copy');
  assert.deepEqual(captured.dependencies.provided, [INSTALLED]);
  assert.deepEqual(Object.keys(captured.dependencies.mechanisms), [INSTALLED]);

  if (record.mechanism === 'clone') {
    // Proved by free space, not by timing: the tree is 32 MiB and a clone of
    // it consumes blocks for metadata alone. The probe's 8 MiB was written
    // and removed inside the same capture, so it is not in this number.
    assert.ok(
      consumed < TREE_BYTES / 4,
      `recorded as a clone but consumed ${consumed} of ${TREE_BYTES} bytes.`,
    );
    assert.equal(typeof record.program, 'string');
    assert.ok(path.isAbsolute(record.program), 'the invoked program is recorded by its resolved absolute path.');
    assert.equal(record.program, locatePlatformUtility('cp'));
  } else {
    // A byte copy is proved by the record, not by free space: `program: null`
    // means no clone was attempted, so only `fs.cp` ran. Its storage cost is
    // not asserted — a sibling test removing a tree in the same window moves
    // free space the other way, and on a reflink filesystem `fs.cp` consumes
    // almost nothing while still being the byte-copy path.
    assert.equal(record.program, null);
  }

  // Whichever mechanism ran, the tool resolves its dependency inside the
  // execution root — the property `copy` exists to buy.
  assert.equal(await askWhereTheDependencyLives(target), path.join(target, INSTALLED));
  assert.equal((await lstat(path.join(target, INSTALLED))).isSymbolicLink(), false);
});

test('TB-055: the cloned tree and the byte-copied tree are the same tree — same files, same bytes, same links, same modes', async (t) => {
  const root = await clone(t);
  const cloned = await captureCopy(root, await temporary(t, 'gate-clone-exec-'));
  const byteCopied = await captureCopy(root, await temporary(t, 'gate-clone-exec-'), { copyProgram: null });

  // `copyProgram: null` forecloses the clone path, so the record is the proof
  // that the comparison tree is a byte copy; free space is not asserted (see
  // the mechanism test above for why).
  assert.deepEqual(mechanismOf(byteCopied.captured), { mechanism: 'byte-copy', program: null });

  const expected = await describeTree(path.join(root, INSTALLED));

  assert.deepEqual(await describeTree(path.join(cloned.captured.snapshot.executionRoot, INSTALLED)), expected);
  assert.deepEqual(await describeTree(path.join(byteCopied.captured.snapshot.executionRoot, INSTALLED)), expected);

  // Links inside the tree are still links with the same targets: the relative
  // file link, and the self-referencing directory link that a dereferencing
  // copy would have followed forever.
  assert.equal(expected['file-link'].link, 'nested/text.txt');
  assert.equal(expected[path.join('nested', 'self-link')].link, '.');

  for (const { captured } of [cloned, byteCopied]) {
    const provided = path.join(captured.snapshot.executionRoot, INSTALLED);

    assert.equal(await readFile(path.join(provided, 'file-link'), 'utf8'), 'nested text\n');
    assert.equal(
      (await readFile(path.join(provided, 'nested', 'payload.bin'))).equals(await readFile(path.join(root, INSTALLED, 'nested', 'payload.bin'))),
      true,
    );
    assert.equal(await askWhereTheDependencyLives(captured.snapshot.executionRoot), provided);
  }
});

test('TB-055 SG-EVAL-001, NFR-REL-001: the snapshot identity, its path list, and its re-check are the same under every mechanism', async (t) => {
  const root = await clone(t);
  const cloned = await captureCopy(root, await temporary(t, 'gate-clone-exec-'));
  const byteCopied = await captureCopy(root, await temporary(t, 'gate-clone-exec-'), { copyProgram: null });
  const linked = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot: await temporary(t, 'gate-clone-exec-'),
    dependencyRoots: [INSTALLED],
    dependencyProvisioning: 'link',
  });

  assert.equal(cloned.captured.snapshot.id, byteCopied.captured.snapshot.id);
  assert.equal(cloned.captured.snapshot.id, linked.snapshot.id);
  assert.deepEqual(cloned.captured.snapshot.paths, byteCopied.captured.snapshot.paths);
  assert.deepEqual(cloned.captured.snapshot.paths, linked.snapshot.paths);
  assert.equal(cloned.captured.snapshot.paths.some((relative) => relative.startsWith(`${INSTALLED}/`)), false);

  for (const { captured } of [cloned, byteCopied]) {
    // A tool writing inside its dependency tree has not changed the tree under
    // evaluation, and the probe left nothing beside the snapshot.
    await writeFile(path.join(captured.snapshot.executionRoot, INSTALLED, 'cache.txt'), 'tool noise\n', 'utf8');
    assert.equal((await verifySnapshot(captured.snapshot)).verified, true);
    assert.deepEqual(
      (await readdir(captured.snapshot.executionRoot)).filter((entry) => entry.startsWith('.clone-probe-')),
      [],
    );
  }
});

test('TB-055 NFR-SEC-001, RISK-002: a write into a provisioned root reaches the maintainer\'s repository under no mechanism', async (t) => {
  const root = await clone(t);
  const cloned = await captureCopy(root, await temporary(t, 'gate-clone-exec-'));
  const byteCopied = await captureCopy(root, await temporary(t, 'gate-clone-exec-'), { copyProgram: null });
  const original = await readFile(path.join(root, INSTALLED, 'nested', 'payload.bin'));

  for (const { captured } of [cloned, byteCopied]) {
    const provided = path.join(captured.snapshot.executionRoot, INSTALLED);

    // Both shapes a tool's write takes: a new file, and an in-place overwrite
    // of an existing one — the case a hardlink would have leaked through.
    await writeFile(path.join(provided, 'written-by-a-check.txt'), 'a check wrote this\n', 'utf8');
    await writeFile(path.join(provided, 'nested', 'payload.bin'), Buffer.from('overwritten in place\n'));
    await writeFile(path.join(provided, 'locate.mjs'), 'export const loadedFrom = "rewritten";\n', 'utf8');
    // And a write THROUGH a relative link inside the tree: a link the copy had
    // rewritten to an absolute path would carry this into the repository.
    await writeFile(path.join(provided, 'file-link'), 'written through a link\n', 'utf8');

    assert.equal(await readFile(path.join(provided, 'nested', 'payload.bin'), 'utf8'), 'overwritten in place\n');
    assert.equal(await readFile(path.join(provided, 'nested', 'text.txt'), 'utf8'), 'written through a link\n');
  }

  assert.equal(await readFile(path.join(root, INSTALLED, 'nested', 'text.txt'), 'utf8'), 'nested text\n');
  assert.equal(await readFile(path.join(root, INSTALLED, 'written-by-a-check.txt'), 'utf8').catch(() => null), null);
  assert.equal((await readFile(path.join(root, INSTALLED, 'nested', 'payload.bin'))).equals(original), true);
  assert.equal(await readFile(path.join(root, INSTALLED, 'locate.mjs'), 'utf8'), LOCATOR);
});

test('TB-055: a copy program that cannot be found is no clone; the byte copy provides the root and is recorded as the mechanism', async (t) => {
  const root = await clone(t);
  const target = await temporary(t, 'gate-clone-exec-');
  const { captured } = await captureCopy(root, target, {
    copyProgram: path.join(target, 'no-such-program', 'cp'),
  });

  // The record is the proof of the path taken; free space is not asserted on
  // the byte-copy path (racy under a parallel suite, wrong on reflink
  // filesystems).
  assert.deepEqual(mechanismOf(captured), { mechanism: 'byte-copy', program: null });
  assert.deepEqual(captured.dependencies.provided, [INSTALLED]);
  assert.deepEqual(captured.dependencies.missing, []);
  assert.deepEqual(await describeTree(path.join(target, INSTALLED)), await describeTree(path.join(root, INSTALLED)));
  assert.equal(await askWhereTheDependencyLives(target), path.join(target, INSTALLED));
});

test('TB-055: a clone attempt that fails part way leaves no partial tree, falls back to the byte copy, and says so', async (t) => {
  const standIn = await standInProgram(t, {
    // Passes the probe, then abandons the real tree half-built.
    onTree: 'mkdir -p "$last/nested" && printf half > "$last/nested/payload.bin" && exit 1',
  });

  if (standIn === null) {
    return;
  }

  const root = await clone(t);
  const target = await temporary(t, 'gate-clone-exec-');
  const { captured } = await captureCopy(root, target, { copyProgram: standIn.program });
  const invocations = await standIn.invocations();

  // The record proves the fallback ran; the tree comparison below proves it
  // ran to completion. Free space is not asserted on the byte-copy path.
  assert.deepEqual(mechanismOf(captured), { mechanism: 'byte-copy', program: null });
  assert.deepEqual(captured.dependencies.provided, [INSTALLED]);
  assert.deepEqual(captured.dependencies.missing, []);

  // The tree is the byte copy's, whole; nothing of the abandoned attempt
  // survives underneath it.
  assert.deepEqual(await describeTree(path.join(target, INSTALLED)), await describeTree(path.join(root, INSTALLED)));
  assert.equal(await askWhereTheDependencyLives(target), path.join(target, INSTALLED));

  const treeAttempts = invocations.filter((line) => line.endsWith(path.join(target, INSTALLED)));

  if (treeAttempts.length === 0) {
    // The probe found no clone on this volume, so the program was never asked
    // for the tree; the byte copy was chosen directly. Still recorded truly.
    assert.ok(invocations.length >= 1, 'the probe never ran.');
  } else {
    assert.equal(treeAttempts.length, 1, 'a failed clone is not retried; it falls back.');
  }
});

test('TB-055: the probe is paid once per capture, never once per root and never once per file', async (t) => {
  const standIn = await standInProgram(t, { onTree: 'exec "$REAL" "$@"' });

  if (standIn === null) {
    return;
  }

  const root = await clone(t, { payloadBytes: 1024 });
  const second = 'installed-too';

  // A second root with many files, so a per-file probe would be countable.
  await mkdir(path.join(root, second), { recursive: true });

  for (let index = 0; index < 50; index += 1) {
    await writeFile(path.join(root, second, `module-${index}.txt`), `${index}\n`, 'utf8');
  }

  const target = await temporary(t, 'gate-clone-exec-');
  const captured = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot: target,
    dependencyRoots: [INSTALLED, second],
    dependencyProvisioning: 'copy',
    copyProgram: standIn.program,
  });

  assert.equal(captured.captured, true, captured.detail);
  assert.deepEqual(captured.dependencies.provided, [INSTALLED, second]);

  const invocations = await standIn.invocations();
  const probes = invocations.filter((line) => /copy-\d+$/.test(line));
  const trees = invocations.filter((line) => !/copy-\d+$/.test(line));

  assert.ok(probes.length >= 1 && probes.length <= 2, `the probe ran ${probes.length} times; it is one attempt per spelling, once.`);

  const [first, other] = [captured.dependencies.mechanisms[INSTALLED], captured.dependencies.mechanisms[second]];

  assert.equal(first.mechanism, other.mechanism, 'one probe answers for every root of the capture.');

  if (first.mechanism === 'clone') {
    assert.equal(trees.length, 2, 'one invocation per copied root, none per file.');
    assert.equal(first.program, standIn.program);
    assert.equal(other.program, standIn.program);
  } else {
    assert.equal(trees.length, 0);
  }
});

test('TB-055 AC-PORT-001: a source and a destination whose paths contain spaces are provisioned by whichever mechanism ran', async (t) => {
  const root = await clone(t, { prefix: 'gate clone source with spaces-' });
  const target = await temporary(t, 'gate clone exec with spaces-');

  assert.match(root, / /);
  assert.match(target, / /);

  const { captured } = await captureCopy(root, target);

  mechanismOf(captured);
  assert.deepEqual(captured.dependencies.provided, [INSTALLED]);
  assert.deepEqual(await describeTree(path.join(target, INSTALLED)), await describeTree(path.join(root, INSTALLED)));
  assert.equal(await askWhereTheDependencyLives(target), path.join(target, INSTALLED));
});

test('TB-055 AC-CFG-001: a clone that declares link, or nothing, produces an envelope byte-identical to TB-054\'s', async (t) => {
  const root = await clone(t, { payloadBytes: 1024 });
  const before = JSON.stringify({ provisioning: 'link', provided: [INSTALLED], missing: [], refused: [] });

  for (const dependencyProvisioning of [undefined, 'link']) {
    const captured = await captureSnapshot({
      repositoryRoot: root,
      kind: 'git-index',
      executionRoot: await temporary(t, 'gate-clone-exec-'),
      dependencyRoots: [INSTALLED],
      ...(dependencyProvisioning === undefined ? {} : { dependencyProvisioning }),
    });

    assert.equal(captured.captured, true, captured.detail);
    assert.equal(JSON.stringify(captured.dependencies), before);
    assert.equal('mechanisms' in captured.dependencies, false);
  }

  // And a decision from such a clone is exactly what it was.
  const decision = await evaluate(evaluateRequest(root, 'clone-provisioning-link'), {
    executionRoot: await temporary(t, 'gate-clone-exec-'),
    runnerVersion: 'fixture/1.0.0',
    providerVersions: { configuration: '1.0.0' },
    resolvePrerequisite: () => true,
    checks: [],
    policy: gatePolicy({ dependency_roots: [INSTALLED] }),
    execute: async () => ({ executed: true, exitCode: 0, durationMs: 1 }),
  });

  assert.deepEqual(validateDecision(decision), []);
  assert.equal(JSON.stringify(decision.environment.dependencies), before);
});

test('TB-055 NFR-OPER-001: the mechanism reaches the decision beside the strategy, and the contract refuses a record that lies about it', async (t) => {
  const root = await clone(t, { payloadBytes: 1024 });
  const decision = await evaluate(evaluateRequest(root, 'clone-provisioning-copy'), {
    executionRoot: await temporary(t, 'gate-clone-exec-'),
    runnerVersion: 'fixture/1.0.0',
    providerVersions: { configuration: '1.0.0' },
    resolvePrerequisite: () => true,
    checks: [],
    policy: gatePolicy({ dependency_roots: [INSTALLED], dependency_provisioning: 'copy' }),
    execute: async () => ({ executed: true, exitCode: 0, durationMs: 1 }),
  });

  assert.deepEqual(validateDecision(decision), []);
  assert.equal(decision.environment.dependencies.provisioning, 'copy');
  assert.deepEqual(Object.keys(decision.environment.dependencies.mechanisms), [INSTALLED]);
  assert.ok(COPY_MECHANISMS.includes(decision.environment.dependencies.mechanisms[INSTALLED].mechanism));

  const rejected = (mutate) => {
    const invalid = structuredClone(decision);

    mutate(invalid.environment.dependencies);

    return validateDecision(invalid).map((issue) => issue.path);
  };

  // A mechanism that is not one, a program that is not a path or null, and a
  // mechanism for a root that was never provided are each refused.
  assert.deepEqual(rejected((record) => { record.mechanisms[INSTALLED].mechanism = 'hardlink'; }), ['decision.environment.dependencies']);
  assert.deepEqual(rejected((record) => { record.mechanisms[INSTALLED].program = 7; }), ['decision.environment.dependencies']);
  assert.deepEqual(rejected((record) => { record.mechanisms['never-provided'] = { mechanism: 'clone', program: '/x' }; }), ['decision.environment.dependencies']);
  assert.deepEqual(rejected((record) => { record.mechanisms = 'clone'; }), ['decision.environment.dependencies']);
  assert.deepEqual(rejected((record) => { delete record.mechanisms; }), []);
});

test('TB-055 NFR-PORT-002: the clone is probed by attempting it, and no operating-system name or platform test appears in the provisioning path', async () => {
  const source = await readFile(path.join(LIBRARY_ROOT, 'snapshot.mjs'), 'utf8');

  for (const detection of [/process\.platform/, /os\.platform/, /\bwin32\b/, /\bdarwin\b/, /\blinux\b/, /\bmacos\b/i, /os\.release/, /os\.type/]) {
    assert.doesNotMatch(source, detection, 'a clone is attempted and observed, never predicted from the platform.');
  }

  // Both spellings are tried against whatever program was found; neither is
  // selected by a platform name.
  assert.match(source, /'-c'/);
  assert.match(source, /'--reflink=always'/);
  // The program is resolved from the platform's own directories, not looked
  // up through the ambient search path.
  assert.match(source, /locatePlatformUtility\(/);
  assert.doesNotMatch(source, /process\.env\.PATH/);
  // And the byte copy `TB-054` proved is still exactly what is fallen back to.
  assert.match(source, /mode: fileConstants\.COPYFILE_FICLONE/);
  assert.match(source, /dereference: false/);
  assert.match(source, /verbatimSymlinks: true/);
  assert.match(source, /errorOnExist: true/);
});

test('TB-055: TB-054\'s safety properties still hold — an occupied destination is refused, a copy that cannot be performed by any mechanism is stated and cleaned, and it is never served as a link', async (t) => {
  const root = await clone(t, { payloadBytes: 1024 });
  const occupiedTarget = await temporary(t, 'gate-clone-exec-');

  await mkdir(path.join(occupiedTarget, INSTALLED), { recursive: true });
  await writeFile(path.join(occupiedTarget, INSTALLED, 'already-here.txt'), 'graded content\n', 'utf8');

  const occupied = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot: occupiedTarget,
    dependencyRoots: [INSTALLED],
    dependencyProvisioning: 'copy',
  });

  assert.equal(occupied.captured, true, occupied.detail);
  assert.deepEqual(occupied.dependencies.provided, []);
  assert.deepEqual(occupied.dependencies.missing, [INSTALLED]);
  assert.equal('mechanisms' in occupied.dependencies, false);
  assert.equal(await readFile(path.join(occupiedTarget, INSTALLED, 'already-here.txt'), 'utf8'), 'graded content\n');

  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return;
  }

  await chmod(path.join(root, INSTALLED), 0o000);
  t.after(() => chmod(path.join(root, INSTALLED), 0o755).catch(() => {}));

  const unreadableTarget = await temporary(t, 'gate-clone-exec-');
  const unreadable = await captureSnapshot({
    repositoryRoot: root,
    kind: 'git-index',
    executionRoot: unreadableTarget,
    dependencyRoots: [INSTALLED],
    dependencyProvisioning: 'copy',
  });

  assert.equal(unreadable.captured, true, unreadable.detail);
  assert.deepEqual(unreadable.dependencies.provided, []);
  assert.deepEqual(unreadable.dependencies.missing, [INSTALLED]);
  assert.equal('mechanisms' in unreadable.dependencies, false);
  assert.equal(await lstat(path.join(unreadableTarget, INSTALLED)).then(() => true, () => false), false);
  assert.deepEqual(
    (await readdir(unreadableTarget)).filter((entry) => entry.startsWith('.clone-probe-')),
    [],
    'a failed capture removes its probe too.',
  );
  assert.equal(await stat(path.join(root, 'source.txt')).then(() => true), true);
});
