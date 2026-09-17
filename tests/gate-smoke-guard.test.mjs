import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/**
 * TB-050 — `SG-LIFE-001`, `RISK-002`.
 *
 * Three smoke capabilities created temporary directories, spawned real
 * processes, and removed fixture roots without ever proving the root they were
 * about to touch was a throwaway one. Each now carries the same guard the other
 * capabilities already carried, and a guard nothing has ever seen refuse is not
 * yet a guard: this suite points each of the three at a directory that is not
 * a throwaway clone — one inside this repository — and proves that it refuses
 * before it creates, writes, or removes anything there.
 *
 * The capabilities locate their fixtures through `os.tmpdir()`, which honours
 * `TMPDIR`, so the refusal is reached exactly the way an operator's environment
 * would reach it. Node's own compile cache honours `TMPDIR` too and is not the
 * capability's doing, so it is disabled for the spawned process; what remains
 * in the directory afterwards is then the capability's responsibility alone.
 */

const runFile = promisify(execFile);

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCRIPTS_ROOT = path.join(FRAMEWORK_ROOT, 'skills', 'change-evaluation-gate', 'scripts');

const GUARDED_CAPABILITIES = [
  'gate-evidence-prune-smoke.mjs',
  'gate-fix-smoke.mjs',
  'runtime-binding-smoke.mjs',
];

const SENTINEL = 'sentinel.txt';

/** A directory inside this repository, which no capability may ever treat as throwaway. */
const nonThrowawayDirectory = async (t) => {
  const scratch = path.join(FRAMEWORK_ROOT, '.scratch');
  const directory = await mkdtemp(path.join(scratch, 'tb050-guard-'));

  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, SENTINEL), 'must survive\n', 'utf8');

  return directory;
};

const listing = async (directory) => (await readdir(directory, { recursive: true })).sort();

const runCapability = async (script, tmpdir) => {
  try {
    const { stdout, stderr } = await runFile(process.execPath, [path.join(SCRIPTS_ROOT, script)], {
      cwd: FRAMEWORK_ROOT,
      env: { ...process.env, TMPDIR: tmpdir, NODE_DISABLE_COMPILE_CACHE: '1' },
    });

    return { code: 0, stdout, stderr };
  } catch (error) {
    if (typeof error.code !== 'number') {
      throw error;
    }

    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
};

for (const script of GUARDED_CAPABILITIES) {
  test(`SG-LIFE-001: ${script} refuses a directory that is not a throwaway clone and leaves it untouched`, async (t) => {
    const directory = await nonThrowawayDirectory(t);
    const before = await listing(directory);

    assert.deepEqual(before, [SENTINEL]);

    const refused = await runCapability(script, directory);
    const capability = script.replace(/\.mjs$/, '').replace(/^runtime-/, 'gate-runtime-');

    assert.notEqual(refused.code, 0, `${script} did not refuse: exit ${refused.code}.`);
    assert.match(
      refused.stderr,
      new RegExp(`${capability} refuses to operate inside this repository: `),
      `${script} refused without saying why.`,
    );
    // No scenario ran, so no scenario line was printed: the refusal came
    // before the capability did any of its work.
    assert.equal(refused.stdout, '');
    assert.deepEqual(await listing(directory), before, `${script} touched the directory it refused.`);
  });
}
