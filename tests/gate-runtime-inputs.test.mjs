import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { environmentFor } from '../skills/change-evaluation-gate/scripts/lib/bounded-execution.mjs';
import { createRedactor } from '../skills/change-evaluation-gate/scripts/lib/redaction.mjs';
import {
  ENVIRONMENT_FILE_STATUSES,
  readEnvironmentValues,
  resolveRuntimeInputs,
} from '../skills/change-evaluation-gate/scripts/lib/runtime-inputs.mjs';
import { materializeRuntimeInputs } from '../skills/change-evaluation-gate/scripts/lib/security-control.mjs';

const runFile = promisify(execFile);

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `TB-059`, `FR-CFG-006`, `AC-CFG-004`, `SG-SECRET-001`. The resolution that
 * turns an approved name into a value: environment first, declared files in
 * declaration order, first value wins, only approved names ever read.
 *
 * Every value here is a synthetic literal invented for the fixture.
 */
const APPROVED = 'canary-from-file-7c1e9a3b';
const DECOY = 'decoy-never-read-4d8f2b61';

const gitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const git = (cwd, args) => runFile('git', args, { cwd, env: gitEnvironment() });

const throwawayRepository = async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gate-runtime-inputs-'));

  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ['init', '--quiet']);
  await writeFile(path.join(root, '.gitignore'), '.env\n', 'utf8');
  await writeFile(path.join(root, 'tracked.env'), `APP_TOKEN=${DECOY}\n`, 'utf8');
  await git(root, ['add', '--all']);
  await git(root, ['-c', 'user.email=g@example.test', '-c', 'user.name=Gate', 'commit', '--quiet', '-m', 'baseline']);

  return root;
};

test('TB-059: the environment-file grammar reads NAME=value in every supported spelling, and only for approved names', () => {
  const contents = [
    '# A comment line',
    '',
    '   ',
    `APP_TOKEN=${APPROVED}`,
    `OTHER_SECRET=${DECOY}`,
    'QUOTED_DOUBLE="with space and \\"escaped\\" quote"',
    "QUOTED_SINGLE='literal \\\"kept\\\" $notexpanded'",
    'export EXPORTED=exported-value',
    '  INDENTED = spaced-value   ',
    'WITH_COMMENT=value-here # trailing comment',
    'HASH_INSIDE=a#b',
    'UNTERMINATED="no closing quote',
    'EMPTY=',
    'EMPTY_QUOTED=""',
    'not an assignment at all',
    '1BAD=starts-with-digit',
    'REPEATED=first',
    'REPEATED=second',
  ].join('\n');

  const values = readEnvironmentValues(contents, [
    'APP_TOKEN', 'QUOTED_DOUBLE', 'QUOTED_SINGLE', 'EXPORTED', 'INDENTED', 'WITH_COMMENT',
    'HASH_INSIDE', 'UNTERMINATED', 'EMPTY', 'EMPTY_QUOTED', 'REPEATED', 'MISSING', '1BAD',
  ]);

  assert.equal(values.get('APP_TOKEN'), APPROVED);
  assert.equal(values.get('QUOTED_DOUBLE'), 'with space and "escaped" quote');
  assert.equal(values.get('QUOTED_SINGLE'), 'literal \\"kept\\" $notexpanded');
  assert.equal(values.get('EXPORTED'), 'exported-value');
  assert.equal(values.get('INDENTED'), 'spaced-value');
  assert.equal(values.get('WITH_COMMENT'), 'value-here');
  assert.equal(values.get('HASH_INSIDE'), 'a#b');
  // Unparseable or empty: no value, which is the unresolved case, not an error.
  assert.equal(values.has('UNTERMINATED'), false);
  assert.equal(values.has('EMPTY'), false);
  assert.equal(values.has('EMPTY_QUOTED'), false);
  assert.equal(values.has('MISSING'), false);
  assert.equal(values.has('1BAD'), false);
  // A later assignment in one file replaces an earlier one, as loaders do.
  assert.equal(values.get('REPEATED'), 'second');
  // A name nobody asked for is never in the result.
  assert.equal(values.has('OTHER_SECRET'), false);
  assert.equal([...values.values()].includes(DECOY), false);
  assert.deepEqual([...readEnvironmentValues(contents, [])], []);
  assert.deepEqual([...readEnvironmentValues('', ['APP_TOKEN'])], []);
  assert.deepEqual([...readEnvironmentValues('APP_TOKEN=x\r\nOTHER=y\r\n', ['APP_TOKEN'])], [['APP_TOKEN', 'x']]);
});

test('TB-059 FR-CFG-006: an approved name is resolved from a declared, git-ignored file; an undeclared name in that file is never read', async (t) => {
  const root = await throwawayRepository(t);

  await writeFile(path.join(root, '.env'), `APP_TOKEN=${APPROVED}\nOTHER_SECRET=${DECOY}\n`, 'utf8');

  const environment = { PATH: process.env.PATH };
  const resolved = await resolveRuntimeInputs({
    approved: ['APP_TOKEN'],
    environment,
    environmentFiles: ['.env'],
    repositoryRoot: root,
  });

  assert.deepEqual(resolved.inputs, [{ name: 'APP_TOKEN', source: '.env', value: APPROVED }]);
  assert.deepEqual(resolved.files, [{ path: '.env', status: 'read' }]);
  assert.equal(JSON.stringify(resolved).includes(DECOY), false, 'the undeclared value must never be read into the result.');
  assert.equal(JSON.stringify(resolved).includes('OTHER_SECRET'), false, 'the undeclared name is not reported either.');
  // The runner's own environment is untouched by resolution.
  assert.deepEqual(Object.keys(environment), ['PATH']);
});

test('TB-059: the runner environment beats the file, so a name set there never has the file consulted', async (t) => {
  const root = await throwawayRepository(t);
  const fromEnvironment = 'canary-from-environment-2e5c';

  await writeFile(path.join(root, '.env'), `APP_TOKEN=${APPROVED}\n`, 'utf8');

  const resolved = await resolveRuntimeInputs({
    approved: ['APP_TOKEN'],
    environment: { APP_TOKEN: fromEnvironment },
    environmentFiles: ['.env'],
    repositoryRoot: root,
  });

  assert.deepEqual(resolved.inputs, [{ name: 'APP_TOKEN', source: 'environment', value: fromEnvironment }]);
  assert.deepEqual(resolved.files, [{ path: '.env', status: 'not-consulted' }]);
  assert.equal(JSON.stringify(resolved).includes(APPROVED), false, 'the file value was read although the environment set the name.');
});

test('TB-059: declared files are consulted in declaration order and the first value found wins', async (t) => {
  const root = await throwawayRepository(t);

  await mkdir(path.join(root, 'config'), { recursive: true });
  await writeFile(path.join(root, '.env'), `APP_TOKEN=${APPROVED}\nMAIL_PASSWORD=from-second\n`, 'utf8');
  await writeFile(path.join(root, 'config/local.env'), 'MAIL_PASSWORD=from-first\n', 'utf8');

  const resolved = await resolveRuntimeInputs({
    approved: ['APP_TOKEN', 'MAIL_PASSWORD', 'NOWHERE'],
    environment: {},
    environmentFiles: ['config/local.env', '.env'],
    repositoryRoot: root,
  });

  assert.deepEqual(resolved.inputs, [
    { name: 'APP_TOKEN', source: '.env', value: APPROVED },
    { name: 'MAIL_PASSWORD', source: 'config/local.env', value: 'from-first' },
    // Found nowhere: unresolved, with where it was looked for, in order.
    {
      name: 'NOWHERE', source: 'environment', value: null, searched: ['environment', 'config/local.env', '.env'],
    },
  ]);
  assert.deepEqual(resolved.files, [
    { path: 'config/local.env', status: 'read' },
    { path: '.env', status: 'read' },
  ]);
});

test('TB-059: a declared file that is tracked is refused, not read; a missing one is missing; both leave the name unresolved', async (t) => {
  const root = await throwawayRepository(t);

  const resolved = await resolveRuntimeInputs({
    approved: ['APP_TOKEN'],
    environment: {},
    environmentFiles: ['tracked.env', '.env'],
    repositoryRoot: root,
  });

  assert.deepEqual(resolved.files, [
    { path: 'tracked.env', status: 'tracked' },
    { path: '.env', status: 'missing' },
  ]);
  assert.deepEqual(resolved.inputs, [{
    name: 'APP_TOKEN', source: 'environment', value: null, searched: ['environment'],
  }]);
  assert.equal(JSON.stringify(resolved).includes(DECOY), false, 'a tracked file was read.');

  for (const status of resolved.files.map((file) => file.status)) {
    assert.equal(ENVIRONMENT_FILE_STATUSES.includes(status), true);
  }
});

test('TB-059 TB-045: a clone declaring no file resolves exactly as before — environment only, unresolved carries no searched list', async () => {
  const resolved = await resolveRuntimeInputs({
    approved: ['APP_TOKEN', 'ABSENT'],
    environment: { APP_TOKEN: APPROVED },
    environmentFiles: [],
    repositoryRoot: null,
  });

  assert.deepEqual(resolved.inputs, [
    { name: 'APP_TOKEN', source: 'environment', value: APPROVED },
    { name: 'ABSENT', source: 'environment', value: null },
  ]);
  assert.deepEqual(resolved.files, []);

  // Which is exactly what the redactor and the envelope record.
  const redactor = createRedactor({ secrets: resolved.inputs, environmentFiles: resolved.files });

  assert.deepEqual(redactor.unresolved, [{ name: 'ABSENT', source: 'environment' }]);
  assert.deepEqual(redactor.environmentFiles, []);
});

test('TB-059 SG-SECRET-001: one resolution feeds both consumers — the materializer receives exactly what the redactor was armed with', async (t) => {
  const root = await throwawayRepository(t);
  const executionRoot = await mkdtemp(path.join(tmpdir(), 'gate-runtime-inputs-exec-'));

  t.after(() => rm(executionRoot, { recursive: true, force: true }));
  await writeFile(path.join(root, '.env'), `APP_TOKEN=${APPROVED}\nOTHER_SECRET=${DECOY}\n`, 'utf8');

  const resolved = await resolveRuntimeInputs({
    approved: ['APP_TOKEN'],
    environment: {},
    environmentFiles: ['.env'],
    repositoryRoot: root,
  });
  const redactor = createRedactor({ secrets: resolved.inputs, environmentFiles: resolved.files });
  const materialized = await materializeRuntimeInputs({
    approved: ['APP_TOKEN'],
    inputs: resolved.inputs,
    executionRoot,
  });

  assert.deepEqual(redactor.secrets.map(({ name, source }) => ({ name, source })), [{ name: 'APP_TOKEN', source: '.env' }]);
  assert.deepEqual(redactor.environmentFiles, [{ path: '.env', status: 'read' }]);
  assert.deepEqual(materialized.record, [{ name: 'APP_TOKEN', source: '.env' }]);
  assert.deepEqual(materialized.environment, { APP_TOKEN: APPROVED });
  assert.equal(redactor.redactText(`token ${APPROVED} printed`).text, 'token [redacted] printed');

  // The check environment: a descriptor allowing nothing ambient still
  // receives the approved input, and no ambient variable it did not list.
  const ambient = { PATH: '/usr/bin', HOME: '/home/someone', OTHER_SECRET: DECOY, APP_TOKEN: 'ambient-shadow' };
  const checkEnvironment = environmentFor([], ambient, '/runtime/bin', materialized.environment);

  assert.deepEqual(checkEnvironment, { APP_TOKEN: APPROVED, PATH: '/runtime/bin' });

  // With the name also allowed and the environment setting it, resolution
  // reads the environment first, so both paths carry one value: no shadowing
  // in either direction.
  const fromEnvironment = await resolveRuntimeInputs({
    approved: ['APP_TOKEN'], environment: ambient, environmentFiles: ['.env'], repositoryRoot: root,
  });

  assert.deepEqual(
    environmentFor(['APP_TOKEN'], ambient, '', Object.fromEntries(fromEnvironment.inputs.map((i) => [i.name, i.value]))),
    { APP_TOKEN: 'ambient-shadow' },
  );

  // The value lives in one owner-only file under the execution root, and
  // nowhere the store would read.
  const { mode } = await import('node:fs/promises').then((fs) => fs.stat(materialized.files[0]));

  assert.equal(mode & 0o777, 0o600);
  assert.equal(await readFile(materialized.files[0], 'utf8'), APPROVED);
  await materialized.release();
});

test('TB-059 SG-OWNER-001: the resolution module names no variable, file, framework, or tool', async () => {
  const source = await readFile(
    path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib/runtime-inputs.mjs'),
    'utf8',
  );

  assert.doesNotMatch(source, /\bAPP_KEY\b|\.env\b|\blaravel\b|\bphpunit\b|\bartisan\b|\bcomposer\b|\bvendor\b/i);
});
