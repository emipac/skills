import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';

const run = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const syncScript = path.join(repositoryRoot, 'scripts', 'sync-version.mjs');

const releaseCopy = async (t, version) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sync-version-'));

  t.after(() => rm(root, { recursive: true, force: true }));

  for (const file of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', 'docs/framework-guide.html']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await cp(path.join(repositoryRoot, file), path.join(root, file));
  }

  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));

  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);

  return root;
};

test('sync-version moves the plugin manifests and both release markers in the guide to the package version', async (t) => {
  const root = await releaseCopy(t, '9.8.7');

  await run(process.execPath, [syncScript], { cwd: root });

  const guide = await readFile(path.join(root, 'docs/framework-guide.html'), 'utf8');

  assert.ok(guide.includes('Release 9.8.7 · Gate-capable'));
  assert.ok(guide.includes('AI Skills Framework 9.8.7 · '));
  assert.doesNotMatch(guide, /Release (?!9\.8\.7)\d+\.\d+\.\d+ · Gate-capable/);

  for (const manifest of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json']) {
    assert.equal(JSON.parse(await readFile(path.join(root, manifest), 'utf8')).version, '9.8.7');
  }
});

test('sync-version refuses a guide that lost a release marker instead of leaving it stale', async (t) => {
  const root = await releaseCopy(t, '9.8.7');
  const guidePath = path.join(root, 'docs/framework-guide.html');

  await writeFile(guidePath, (await readFile(guidePath, 'utf8')).replace(/ · Gate-capable/g, ''));

  await assert.rejects(run(process.execPath, [syncScript], { cwd: root }), /no longer carries the release marker/);
});
