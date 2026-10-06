import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { startProjectUi } from '../skills/framework-setup/scripts/lib/ui/server.mjs';

const run = promisify(execFile);
const environment = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (root, args) => run('git', args, { cwd: root, env: environment });

const project = async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'framework-ui-flow-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.ok((await realpath(root)).startsWith(await realpath(tmpdir())));
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'tools'));
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const answer = 42;\n');
  await writeFile(path.join(root, 'tools', 'check.mjs'), "import { readFile } from 'node:fs/promises'; const source = await readFile('src/index.ts', 'utf8'); console.log('grading source'); process.exitCode = source.includes('BROKEN') ? 1 : 0;\n");
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { express: '^5', typescript: '^5' }, scripts: { test: 'node tools/check.mjs' } }));
  await writeFile(path.join(root, 'tsconfig.json'), '{}');
  await writeFile(path.join(root, '.gitignore'), 'node_modules\n.env\n');
  await writeFile(path.join(root, '.env'), 'CANARY=UI_SECRET_CANARY_98214\n');
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'fixture@example.invalid']);
  await git(root, ['config', 'user.name', 'UI Fixture']);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'fixture']);
  return root;
};

const connect = async (t, root, options = {}, start = startProjectUi) => {
  const ui = await start({ projectRoot: root, environment, ...options });
  t.after(() => ui.close());
  const token = new URL(ui.url).hash.slice(1);
  const request = async (route, body) => {
    const response = await fetch(`${ui.origin}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { Origin: ui.origin, 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const finished = async (id) => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const { data: { job } } = await request(`/api/jobs/${id}`);
      if (['completed', 'failed'].includes(job.state)) return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`Job ${id} did not complete.`);
  };
  const operation = async (name, fields = {}) => {
    const submitted = await request('/api/jobs', { operation: name, fields });
    assert.equal(submitted.status, 202);
    const job = await finished(submitted.data.job.id);
    assert.equal(job.state, 'completed', JSON.stringify(job));
    return job;
  };
  const confirm = async (preview) => {
    assert.equal(typeof preview.previewId, 'string', JSON.stringify(preview));
    const submitted = await request('/api/jobs', { previewId: preview.previewId });
    assert.equal(submitted.status, 202);
    const job = await finished(submitted.data.job.id);
    assert.equal(job.state, 'completed', JSON.stringify(job));
    return job;
  };
  return { ui, request, operation, confirm };
};

test('real HTTP adoption, checks, revision re-pin and deactivation retain owner behavior', async (t) => {
  const root = await project(t);
  const { request, operation, confirm } = await connect(t, root);
  const overview = await request('/api/overview');
  assert.equal(overview.status, 200);
  assert.ok(!JSON.stringify(overview.data).includes('UI_SECRET_CANARY_98214'));
  const report = await operation('report');
  assert.equal(report.result.document.ok, true);
  assert.match(report.result.document.reportHtml, /<!doctype html>/i);
  assert.equal(report.previewId, null);
  assert.equal(Object.hasOwn(report.result.document, 'report'), false);
  const base = await operation('base-setup', { tracker: 'local-markdown' });
  await assert.rejects(readFile(path.join(root, '.agent-framework.yaml')));
  assert.equal((await confirm(base)).result.document.status, 'configured');
  const mappings = (await operation('migration-draft')).result.document;
  for (const fields of Object.values(mappings.commands)) fields.timeout_seconds = 30;
  const migration = await operation('migration', { mappings });
  assert.match(await readFile(path.join(root, '.agent-framework.yaml'), 'utf8'), /schema_version: 3/);
  assert.equal((await confirm(migration)).result.document.status, 'migrated');
  const policy = (await operation('policy-draft')).result.document;
  const policyPreview = await operation('policy', { policy });
  assert.doesNotMatch(await readFile(path.join(root, '.agent-framework.yaml'), 'utf8'), /^evaluation_gate:/m);
  assert.equal((await confirm(policyPreview)).result.document.status, 'configured');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'Framework configuration']);
  const doctor = await operation('gate:doctor');
  assert.equal(doctor.result.document.failure, null, JSON.stringify(doctor));
  const activate = await operation('gate:activate', { client: 'git' });
  assert.equal(activate.result.document.observation.refusal ?? null, null, JSON.stringify(activate));
  assert.equal((await confirm(activate)).result.document.mutation.performed, true);
  const status = await operation('gate:status');
  assert.equal(status.result.document.observation.state, 'activated');
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const answer = 43;\n');
  const check = await operation('gate:check');
  assert.equal(check.result.document.observation.scope, 'worktree');
  assert.equal(check.result.document.observation.outcome, 'passed', JSON.stringify(check));
  await git(root, ['add', 'src/index.ts']);
  const staged = await operation('gate:check', { staged: true });
  assert.equal(staged.result.document.observation.scope, 'staged');
  assert.equal(staged.result.document.observation.outcome, 'passed', JSON.stringify(staged));
  await writeFile(path.join(root, 'src', 'index.ts'), 'BROKEN\n');
  const failedCheck = await operation('gate:check');
  assert.equal(failedCheck.result.exitCode, 1);
  assert.equal(failedCheck.result.document.observation.outcome, 'failed');
  const recorded = await operation('gate:history');
  const evidence = recorded.result.document.observation.history.entries.find((entry) => entry.evaluationId === failedCheck.result.document.observation.evaluationId);
  assert.ok(evidence, JSON.stringify(recorded));
  assert.ok(evidence.logs.length > 0, 'The failed check must retain its emitted log.');
  const log = await operation('gate:history', { evidence: evidence.evidenceId, blob: evidence.logs[0].blobId });
  assert.equal(log.result.document.observation.history.selected.log.availability, 'retained');
  assert.match(log.result.document.observation.history.selected.log.text, /grading source/);
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const answer = 43;\n');
  const revision = await operation('config:set-budget', { seconds: String(policy.budget.total_seconds + 5) });
  const revised = await confirm(revision);
  assert.equal(revised.result.document.applied, true, JSON.stringify(revised));
  const sync = await operation('gate:sync');
  assert.equal((await confirm(sync)).result.document.mutation.performed, true);
  const history = await operation('gate:history');
  assert.ok(Array.isArray(history.result.document.observation.history.entries));
  const worktrees = await operation('worktrees');
  assert.equal(worktrees.result.document.kind, 'git-worktrees');
  const deactivate = await operation('gate:deactivate');
  assert.equal((await confirm(deactivate)).result.document.mutation.performed, true);
  assert.ok(!JSON.stringify((await request('/api/jobs')).data).includes('UI_SECRET_CANARY_98214'));
});

test('real filesystem drift and preview expiry cannot confirm a previously reviewed setup', async (t) => {
  const root = await project(t);
  const { request, operation, confirm } = await connect(t, root, { previewTtlMs: 30 });
  const preview = await operation('base-setup', { tracker: 'local-markdown' });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal((await request('/api/jobs', { previewId: preview.previewId })).status, 409);
  await assert.rejects(readFile(path.join(root, '.agent-framework.yaml')));
  const fresh = await operation('base-setup', { tracker: 'local-markdown' });
  await writeFile(path.join(root, 'package.json'), '{}');
  const refused = await confirm(fresh);
  assert.equal(refused.result.document.status, 'refused');
  await assert.rejects(readFile(path.join(root, '.agent-framework.yaml')));
});

test('HTTP jobs never echo a supplied sensitive value, including refusals and invalid fields', async (t) => {
  const root = await project(t);
  const { request, operation } = await connect(t, root);
  const canary = 'UI_SUPPLIED_SECRET_CANARY_64389';
  const refused = await operation('config:add-sensitive-input', { name: `API_KEY=${canary}` });
  assert.ok(!JSON.stringify(refused).includes(canary));
  const invalid = await request('/api/jobs', { operation: 'gate:status', fields: { injected: canary } });
  assert.equal(invalid.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(!JSON.stringify((await request('/api/jobs')).data).includes(canary));
  assert.ok(!JSON.stringify((await request('/api/overview')).data).includes(canary));
});

test('standalone and linked installed Framework dashboards launch without Gate or adoption writes', async (t) => {
  const root = await project(t);
  const installs = await mkdtemp(path.join(tmpdir(), 'framework-ui-installed-'));
  t.after(() => rm(installs, { recursive: true, force: true }));
  const skill = path.join(installs, 'framework-setup');
  await cp(new URL('../skills/framework-setup/', import.meta.url), skill, { recursive: true });
  const linked = path.join(installs, 'linked-setup');
  await symlink(skill, linked, 'dir');
  for (const location of [skill, linked]) {
    const { startProjectUi: start } = await import(pathToFileURL(path.join(location, 'scripts/lib/ui/server.mjs')));
    const { ui, request } = await connect(t, root, { environment: { ...environment, PATH: '' } }, start);
    const overview = await request('/api/overview');
    assert.equal(overview.status, 200);
    assert.equal(overview.data.status.failure.reasonCode, 'gate-unavailable');
    assert.equal(ui.projectRoot, await realpath(root));
    const page = await fetch(ui.origin);
    assert.equal(page.status, 200);
    await assert.rejects(readFile(path.join(root, '.agent-framework.yaml')));
  }
});
