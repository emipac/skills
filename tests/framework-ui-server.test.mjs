import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { parseArguments } from '../skills/framework-setup/scripts/lib/agent-framework/arguments.mjs';
import { startProjectUi } from '../skills/framework-setup/scripts/lib/ui/server.mjs';

const descriptor = { id: 'gate:repair', previewable: true, fields: {} };
const service = () => ({
  catalog: () => [descriptor],
  observe: async () => ({ projectRoot: '/project', setup: { state: 'configured' }, configuration: {}, status: {} }),
  execute: async ({ operation, fields, confirmation }) => ({ operation, exitCode: 0, document: { previewHash: confirmation ? null : 'owner-token', mutation: confirmation ? { confirmed: true, fields } : null } }),
});

const fixture = async (t, options = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'framework-ui-test-'));
  const ui = await startProjectUi({ projectRoot: root, operations: service(), ...options });
  t.after(async () => { await ui.close(); await rm(root, { recursive: true, force: true }); });
  const token = new URL(ui.url).hash.slice(1);
  const request = async (route, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`${ui.origin}${route}`, { method, headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { Origin: ui.origin, 'Content-Type': 'application/json' } : {}), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    return { status: response.status, headers: response.headers, data: response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : await response.text() };
  };
  return { root, ui, request, token };
};

const finished = async (request, id) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { data: { job } } = await request(`/api/jobs/${id}`);
    if (['completed', 'failed'].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('Job did not finish.');
};

test('UI resolves one project, uses loopback/session fragment, refresh is read-only, and serves a protected CSP', async (t) => {
  const { root, ui, request, token } = await fixture(t);
  assert.equal(ui.projectRoot, await realpath(root));
  assert.equal(new URL(ui.url).hostname, '127.0.0.1');
  assert.equal(token.length, 64);
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.data.includes(token), false);
  assert.equal(page.headers.get('access-control-allow-origin'), null);
  assert.equal((await request('/favicon.svg')).status, 200);
  assert.equal((await request('/api/catalog')).data.operations[0].id, descriptor.id);
  assert.equal((await request('/api/overview')).data.setup.state, 'configured');
  assert.deepEqual((await request('/api/jobs')).data.jobs, []);
  assert.deepEqual(await readdir(root), []);
});

test('UI requires token for reads and token plus exact Origin/Host for actions', async (t) => {
  const { request, ui } = await fixture(t);
  assert.equal((await request('/api/overview', { headers: { Authorization: '' } })).status, 403);
  assert.equal((await request('/api/catalog', { headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id }, headers: { Origin: '' } })).status, 403);
  assert.equal((await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id }, headers: { Origin: 'http://localhost' } })).status, 403);
  const forged = await new Promise((resolve, reject) => {
    const req = httpRequest(ui.origin, { headers: { Host: 'attacker.example' } }, (response) => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(forged, 403);
});

test('UI refuses arbitrary paths, tokens in query, unknown operations and raw confirmation fields', async (t) => {
  const { request } = await fixture(t);
  for (const route of ['/package.json', '/api/catalog?token=x', '/%2e%2e/package.json', '/app.mjs/more']) {
    assert.equal((await request(route)).status, 404, route);
  }
  for (const body of [{ operation: 'shell', fields: { command: 'pwd' } }, { operation: descriptor.id, confirmation: 'owner-token' }, { operation: descriptor.id, projectRoot: '/' }, { operation: descriptor.id, fields: [] }]) {
    assert.equal((await request('/api/jobs', { method: 'POST', body })).status, 400);
  }
  assert.equal((await request('/api/jobs', { method: 'POST', body: {}, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('/api/jobs', { method: 'POST', body: '{' })).status, 400);
});

test('UI bounds JSON request and result sizes', async (t) => {
  const { request } = await fixture(t, { bodyLimit: 80, resultLimit: 50 });
  assert.equal((await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id, fields: { data: 'x'.repeat(200) } } })).status, 413);
  const submitted = await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id } });
  const job = await finished(request, submitted.data.job.id);
  assert.equal(job.state, 'failed');
  assert.equal(job.failure.code, 'result-too-large');
  assert.equal(job.result, null);
});

test('UI serializes operations, binds reviewed fields and token, and consumes confirmations once', async (t) => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const operations = service();
  operations.execute = async (input) => {
    calls.push(input);
    active += 1; maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return { operation: input.operation, exitCode: 0, document: { previewHash: input.confirmation ? null : 'exact-token' } };
  };
  const { request } = await fixture(t, { operations });
  const first = await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id, fields: { selection: 'reviewed' } } });
  const second = await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id } });
  const preview = await finished(request, first.data.job.id);
  await finished(request, second.data.job.id);
  assert.equal(maxActive, 1);
  assert.ok(preview.previewId);
  assert.equal((await request('/api/jobs', { method: 'POST', body: { previewId: preview.previewId, operation: descriptor.id, fields: { selection: 'changed' } } })).status, 400);
  const confirmed = await request('/api/jobs', { method: 'POST', body: { previewId: preview.previewId } });
  await finished(request, confirmed.data.job.id);
  assert.deepEqual(calls[2], { operation: descriptor.id, fields: { selection: 'reviewed' }, confirmation: 'exact-token' });
  assert.equal((await request('/api/jobs', { method: 'POST', body: { previewId: preview.previewId } })).status, 409);
});

test('UI expires preview records, bounds history, and never confirms a refusal', async (t) => {
  let time = 100;
  const operations = service();
  const { request } = await fixture(t, { operations, limit: 2, previewTtlMs: 50, now: () => time });
  const first = await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id } });
  const preview = await finished(request, first.data.job.id);
  time = 151;
  assert.equal((await request('/api/jobs', { method: 'POST', body: { previewId: preview.previewId } })).status, 409);
  operations.execute = async () => ({ exitCode: 1, document: { previewHash: 'refused-token', observation: { refusal: { reasonCode: 'drift' } } } });
  for (let index = 0; index < 3; index += 1) {
    const submitted = await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id } });
    assert.equal((await finished(request, submitted.data.job.id)).previewId, null);
  }
  assert.equal((await request('/api/jobs')).data.jobs.length, 2);
  assert.equal((await request(`/api/jobs/${first.data.job.id}`)).status, 404);
});

test('UI never converts a read result or a completed configuration mutation into another confirmation', async (t) => {
  const operations = service();
  operations.catalog = () => [descriptor, { id: 'config-show', readOnly: true, previewable: false, fields: {} }];
  operations.execute = async ({ operation }) => ({ operation, exitCode: 1, document: operation === 'config-show'
    ? { previewHash: 'not-a-preview' }
    : { applied: true, previewHash: 'original-config-token', repin: { confirmationToken: 'gate-repin-token' } } });
  const { request } = await fixture(t, { operations });
  for (const operation of [descriptor.id, 'config-show']) {
    const submitted = await request('/api/jobs', { method: 'POST', body: { operation } });
    assert.equal((await finished(request, submitted.data.job.id)).previewId, null);
  }
});

test('UI refuses more jobs when the bounded queue contains only active operations', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const operations = service();
  operations.execute = async () => { await gate; return { document: {}, exitCode: 0 }; };
  const { request } = await fixture(t, { operations, limit: 1 });
  const submitted = await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id } });
  assert.equal((await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id } })).status, 429);
  release();
  await finished(request, submitted.data.job.id);
});

test('UI confirmation survives retention eviction and public jobs do not echo unvalidated fields', async (t) => {
  const calls = [];
  const operations = service();
  const execute = operations.execute;
  operations.execute = async (input) => {
    if (input.fields.unknown) throw Object.assign(new Error('Unknown field.'), { status: 400, code: 'invalid-input' });
    calls.push(input); return execute(input);
  };
  const { request } = await fixture(t, { operations, limit: 1 });
  const submitted = await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id, fields: { unknown: 'SECRET_INPUT_CANARY' } } });
  assert.equal(JSON.stringify(submitted.data).includes('SECRET_INPUT_CANARY'), false);
  await finished(request, submitted.data.job.id);
  assert.equal(JSON.stringify((await request('/api/jobs')).data).includes('SECRET_INPUT_CANARY'), false);
  const valid = await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id } });
  const preview = await finished(request, valid.data.job.id);
  const confirmed = await request('/api/jobs', { method: 'POST', body: { previewId: preview.previewId } });
  assert.equal(confirmed.status, 202);
  await finished(request, confirmed.data.job.id);
  assert.equal(calls[1].confirmation, 'owner-token');
  assert.ok((await request('/api/jobs')).data.jobs.every((job) => !Object.hasOwn(job, 'fields')));
});

test('UI hides unexpected owner exception details and cancels queued jobs on shutdown', async (t) => {
  const operations = service();
  let release;
  let started;
  const running = new Promise((resolve) => { started = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  operations.execute = async () => { calls += 1; started(); await blocked; throw new Error('SECRET_ENV_CANARY'); };
  const { request, ui } = await fixture(t, { operations });
  await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id } });
  await running;
  await request('/api/jobs', { method: 'POST', body: { operation: descriptor.id } });
  const before = (await request('/api/jobs')).data.jobs;
  assert.equal(before[0].state, 'running');
  assert.equal(before[1].state, 'queued');
  const closing = ui.close();
  release();
  await closing;
  assert.equal(calls, 1);
});

test('UI CLI parser accepts only its project and bounded port selectors', () => {
  assert.equal(parseArguments(['ui']).port, 0);
  assert.equal(parseArguments(['ui', '--project', 'somewhere', '--port', '65535']).port, 65535);
  for (const args of [['ui', '--port', '-1'], ['ui', '--port', '65536'], ['ui', '--port', '3.5'], ['ui', '--port'], ['ui', '--json'], ['ui', '--confirm', 'token'], ['ui', '--host', '0.0.0.0']]) assert.equal(parseArguments(args), null);
});

test('UI entrypoint stays alive with its local URL and shuts down on SIGTERM', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'framework-ui-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entry = path.resolve('skills/framework-setup/scripts/agent-framework.mjs');
  const child = spawn(process.execPath, [entry, 'ui', '--port', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  let output = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('UI launch timeout')), 5000);
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`UI exited before launch: ${code}`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#\w+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  assert.equal((await fetch(url)).status, 200);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
  assert.deepEqual(await readdir(root), []);
});
