import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createOperations, UIInputError } from '../skills/framework-setup/scripts/lib/ui/operations.mjs';
import { gateRevisions } from '../skills/framework-setup/scripts/configure.mjs';

const token = `sha256:${'a'.repeat(64)}`;
const harness = () => {
  const calls = [];
  const operations = createOperations({ projectRoot: '/tmp/fixed-project', environment: { PATH: '/safe' }, dependencies: {
    locateGateCommand: async () => ({ available: true, program: '/safe/gate', prefix: [] }),
    runGateCommand: async (gate, request) => { calls.push(request); return { document: { exitStatus: 1, observation: { healthy: false }, failure: null } }; },
    runFrameworkCommand: async (request) => { calls.push(request); return { exitCode: 1, document: { exitStatus: 1 } }; },
  } });
  return { calls, operations };
};

test('catalog includes every Gate operation and existing revision with closed metadata', () => {
  const { operations } = harness();
  const entries = operations.catalog();
  for (const name of ['activate', 'status', 'check', 'doctor', 'locks', 'prune', 'repair', 'update', 'deactivate', 'uninstall', 'cleanup', 'bypass', 'sync']) assert.ok(entries.some(({ id }) => id === `gate:${name}`));
  for (const name of Object.keys(gateRevisions)) assert.ok(entries.some(({ id }) => id === `config:${name}`));
  assert.equal(entries.find(({ id }) => id === 'gate:check').confirmable, false);
  assert.equal(entries.find(({ id }) => id === 'base-setup').confirmable, true);
});

test('Gate allowlist builds only selected argv and preserves unhealthy answers', async () => {
  const { operations, calls } = harness();
  const cases = [
    ['activate', { client: 'git', actor: 'New Developer', resume: token }, ['--client', 'git', '--actor', 'New Developer', '--resume', token]],
    ['status', {}, []], ['doctor', {}, []], ['check', { staged: true }, ['--staged']],
    ['locks', {}, []], ['prune', { evaluationIds: ['one', 'two'], before: '2026-01-01T00:00:00Z', reclaim: 42 }, ['--evaluation', 'one', '--evaluation', 'two', '--before', '2026-01-01T00:00:00Z', '--reclaim', '42']],
    ['repair', { hookScript: '/path with spaces/hook.mjs' }, ['--hook-script', '/path with spaces/hook.mjs']],
    ['update', {}, []], ['deactivate', {}, []], ['uninstall', { assets: ['a', 'b'] }, ['--asset', 'a', '--asset', 'b']],
    ['cleanup', {}, []], ['bypass', { reason: 'Emergency fix', reference: 'ABC-1', actor: 'dev' }, ['--reason', 'Emergency fix', '--reference', 'ABC-1', '--actor', 'dev']],
    ['sync', { acknowledgeWeakening: true }, ['--acknowledge-weakening']],
  ];
  for (const [name, fields, argv] of cases) {
    const result = await operations.execute({ operation: `gate:${name}`, fields });
    assert.equal(result.exitCode, 1);
    assert.deepEqual(calls.at(-1).args, [name, ...argv]);
    assert.equal(calls.at(-1).cwd, '/tmp/fixed-project');
    if (!['status', 'check', 'doctor'].includes(name)) {
      await operations.execute({ operation: `gate:${name}`, fields, confirmation: token });
      assert.deepEqual(calls.at(-1).args, [name, ...argv, name === 'locks' ? '--recover' : '--confirm', token]);
    }
  }
});

test('every revision delegates to Framework and preserves separate confirmation', async () => {
  const { operations, calls } = harness();
  for (const [name, rule] of Object.entries(gateRevisions)) {
    const fields = { [rule.argument]: 'value', ...Object.fromEntries(rule.options.map((option) => [option, 'optional'])), acknowledgeWeakening: true };
    await operations.execute({ operation: `config:${name}`, fields, confirmation: 'a'.repeat(64) });
    assert.deepEqual(calls.at(-1).argv, ['config', name, 'value', ...rule.options.flatMap((option) => [`--${option}`, 'optional']), '--acknowledge-weakening', '--confirm', 'a'.repeat(64), '--json']);
    assert.equal(calls.at(-1).terminal, null);
  }
});

test('Framework observations and guardrails remain fixed-project owner invocations', async () => {
  const { operations, calls } = harness();
  await operations.observe();
  assert.deepEqual(calls.map(({ argv, args }) => argv ?? args), [['setup', '--json'], ['config', 'show', '--json'], ['status']]);
  await operations.execute({ operation: 'config-suggest' });
  assert.deepEqual(calls.at(-1).argv, ['config', 'suggest', '--json']);
  await operations.execute({ operation: 'guardrail', fields: { action: 'add', client: 'cursor' }, confirmation: 'c'.repeat(64) });
  assert.deepEqual(calls.at(-1).argv, ['guardrail', 'add', 'cursor', '--confirm', 'c'.repeat(64), '--json']);
  for (const call of calls) assert.equal(call.cwd, '/tmp/fixed-project');
});

test('rejects unknown fields, overrides, flags, unsafe types and unbounded JSON without execution', async () => {
  const { operations, calls } = harness();
  const invalid = [
    { operation: 'shell' }, { operation: 'gate:status', projectRoot: '/elsewhere' },
    { operation: 'gate:status', fields: { force: true } }, { operation: 'gate:activate', fields: { client: '--confirm' } },
    { operation: 'gate:check', fields: { staged: 'true' } }, { operation: 'gate:status', confirmation: token },
    { operation: 'gate:prune', fields: { reclaim: -1 } }, { operation: 'gate:uninstall', fields: { assets: ['--force'] } },
    { operation: 'policy', fields: { policy: JSON.parse('{"__proto__":{}}') } },
    { operation: 'policy', fields: { policy: { large: 'x'.repeat(65536) } } },
    { operation: 'migration', fields: { mappings: [] } },
  ];
  for (const request of invalid) await assert.rejects(() => operations.execute(request), UIInputError);
  assert.equal(calls.length, 0);
});

test('absent Gate and unreadable subprocess output return safe structured refusal', async () => {
  const absent = createOperations({ projectRoot: '/tmp', dependencies: { locateGateCommand: async () => ({ available: false, detail: 'secret' }) } });
  assert.equal((await absent.execute({ operation: 'gate:status' })).document.failure.reasonCode, 'gate-unavailable');
  const failed = createOperations({ projectRoot: '/tmp', dependencies: {
    locateGateCommand: async () => ({ available: true }), runGateCommand: async () => ({ failure: { detail: 'SECRET_VALUE_FROM_STDERR' } }),
  } });
  assert.ok(!JSON.stringify(await failed.execute({ operation: 'gate:status' })).includes('SECRET_VALUE_FROM_STDERR'));
  const frameworkFailure = createOperations({ projectRoot: '/tmp', dependencies: {
    runFrameworkCommand: async () => ({ exitCode: 2, document: { nested: { failure: { reasonCode: 'gate-unreadable', detail: 'SECRET_FROM_NESTED_GATE' } } } }),
  } });
  assert.ok(!JSON.stringify(await frameworkFailure.execute({ operation: 'setup' })).includes('SECRET_FROM_NESTED_GATE'));
});

test('base setup requires reviewed token, binds changed inputs and refuses existing configuration', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'framework-ui-base-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: {} }));
  const operations = createOperations({ projectRoot: root });
  const request = { operation: 'base-setup', fields: { tracker: 'local-markdown' } };
  const preview = await operations.execute(request);
  assert.equal(preview.document.destinations.length, 4);
  await assert.rejects(readFile(path.join(root, '.agent-framework.yaml')));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: {}, description: 'changed' }));
  assert.equal((await operations.execute({ ...request, confirmation: preview.document.previewHash })).document.status, 'refused');
  const current = await operations.execute(request);
  const written = await operations.execute({ ...request, confirmation: current.document.previewHash });
  assert.equal(written.document.status, 'configured');
  const original = await readFile(path.join(root, '.agent-framework.yaml'), 'utf8');
  assert.match(original, /schema_version: 3/);
  assert.equal((await operations.execute(request)).document.reasonCode, 'configuration-exists');
  assert.equal(await readFile(path.join(root, '.agent-framework.yaml'), 'utf8'), original);
});

test('history selector bounds and identities stay closed', async () => {
  const { operations, calls } = harness();
  await operations.execute({ operation: 'gate:history', fields: { limit: 50, evidence: token, blob: token } });
  assert.deepEqual(calls.at(-1).args, ['history', '--limit', '50', '--evidence', token, '--blob', token]);
  for (const fields of [{ limit: 0 }, { limit: 101 }, { evidence: '../outside' }, { blob: token }]) {
    await assert.rejects(() => operations.execute({ operation: 'gate:history', fields }), UIInputError);
  }
});

test('base setup refuses linked ancestors, linked files and changed destination paths', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'framework-ui-boundary-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'framework-ui-outside-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const operations = createOperations({ projectRoot: root });
  const request = { operation: 'base-setup', fields: { tracker: 'local-markdown' } };
  await symlink(outside, path.join(root, 'docs'), 'dir');
  assert.equal((await operations.execute(request)).document.reasonCode, 'unsafe-destination');
  await assert.rejects(readFile(path.join(outside, 'agents/domain.md')));
  await rm(path.join(root, 'docs'));
  await mkdir(path.join(root, 'docs/agents'), { recursive: true });
  await writeFile(path.join(outside, 'domain.md'), 'outside original');
  await symlink(path.join(outside, 'domain.md'), path.join(root, 'docs/agents/domain.md'));
  assert.equal((await operations.execute(request)).document.reasonCode, 'unsafe-destination');
  assert.equal(await readFile(path.join(outside, 'domain.md'), 'utf8'), 'outside original');
  await rm(path.join(root, 'docs/agents/domain.md'));
  const preview = await operations.execute(request);
  await rename(path.join(root, 'docs'), path.join(root, 'old-docs'));
  await symlink(outside, path.join(root, 'docs'), 'dir');
  assert.equal((await operations.execute({ ...request, confirmation: preview.document.previewHash })).document.reasonCode, 'unsafe-destination');
  await assert.rejects(readFile(path.join(root, '.agent-framework.yaml')));
  await assert.rejects(readFile(path.join(outside, 'agents/domain.md')));
});

test('real schema migration and initial Gate policy require exact owner previews', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'framework-ui-migrate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { express: '^5', typescript: '^5' }, scripts: { test: 'node --test' } }));
  await writeFile(path.join(root, 'tsconfig.json'), '{}');
  const operations = createOperations({ projectRoot: root });
  const base = { operation: 'base-setup', fields: { tracker: 'local-markdown' } };
  const initial = await operations.execute(base);
  assert.equal((await operations.execute({ ...base, confirmation: initial.document.previewHash })).document.status, 'configured');
  const before = await readFile(path.join(root, '.agent-framework.yaml'), 'utf8');
  const draft = await operations.execute({ operation: 'migration-draft' });
  const mappings = draft.document;
  for (const fields of Object.values(mappings.commands)) {
    if (Object.hasOwn(fields, 'timeout_seconds')) fields.timeout_seconds = 30;
  }
  const migration = { operation: 'migration', fields: { mappings } };
  const preview = await operations.execute(migration);
  assert.equal(preview.document.status, 'ready', JSON.stringify(preview));
  assert.equal(await readFile(path.join(root, '.agent-framework.yaml'), 'utf8'), before);
  assert.equal((await operations.execute({ ...migration, confirmation: 'b'.repeat(64) })).document.status, 'refused');
  assert.equal((await operations.execute({ ...migration, confirmation: preview.document.previewHash })).document.status, 'migrated');
  const policy = (await operations.execute({ operation: 'policy-draft' })).document;
  const request = { operation: 'policy', fields: { policy } };
  const policyPreview = await operations.execute(request);
  assert.equal(policyPreview.document.status, 'ready', JSON.stringify(policyPreview));
  assert.doesNotMatch(await readFile(path.join(root, '.agent-framework.yaml'), 'utf8'), /^evaluation_gate:/m);
  assert.equal((await operations.execute({ ...request, confirmation: policyPreview.document.previewHash })).document.status, 'configured');
  assert.match(await readFile(path.join(root, '.agent-framework.yaml'), 'utf8'), /^evaluation_gate:/m);
});

test('real repository worktree observation reports bounded Git metadata', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'framework-ui-worktrees-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await promisify(execFile)('git', ['init', root]);
  const result = await createOperations({ projectRoot: root }).execute({ operation: 'worktrees' });
  assert.equal(result.document.kind, 'git-worktrees');
  assert.equal(result.document.worktrees.length, 1);
  assert.equal(result.document.worktrees[0].path, root.replace(/^\/var\//, '/private/var/'));
});

test('report exports owner HTML without clone writes or server temporary paths', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'framework-ui-report-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, '.env'), 'TOKEN=REPORT_SECRET_CANARY_21491\n');
  const operations = createOperations({ projectRoot: root, environment: { PATH: '' } });
  const before = await readdir(root);
  const result = await operations.execute({ operation: 'report' });
  assert.equal(result.document.ok, true, JSON.stringify(result));
  assert.equal(result.exitCode, result.document.exitStatus);
  assert.equal(Object.hasOwn(result.document, 'report'), false);
  assert.equal(typeof result.document.generatedAt, 'string');
  assert.match(result.document.reportHtml, /<!doctype html>/i);
  assert.doesNotMatch(result.document.reportHtml, /<(?:script|form|link|a|iframe)\b/i);
  assert.ok(!JSON.stringify(result).includes('REPORT_SECRET_CANARY_21491'));
  assert.deepEqual(await readdir(root), before);
});

test('report reads only its fixed target, bounds exports and cleans up refusals', async () => {
  let target;
  const forged = createOperations({ projectRoot: '/tmp', dependencies: {
    runFrameworkCommand: async ({ argv }) => {
      assert.deepEqual(argv.slice(0, 3), ['report', '--html', '--out']);
      target = argv[3];
      return { exitCode: 0, document: { failure: null, report: '/etc/passwd', generatedAt: 'now' } };
    },
  } });
  assert.equal((await forged.execute({ operation: 'report' })).document.failure.reasonCode, 'report-unavailable');
  await assert.rejects(access(path.dirname(target)));
  const oversized = createOperations({ projectRoot: '/tmp', dependencies: {
    runFrameworkCommand: async ({ argv }) => {
      target = argv[3];
      await writeFile(target, 'x'.repeat(1024 * 1024 + 1));
      return { exitCode: 0, document: { failure: null, report: target } };
    },
  } });
  assert.equal((await oversized.execute({ operation: 'report' })).document.failure.reasonCode, 'report-unavailable');
  await assert.rejects(access(path.dirname(target)));
});
