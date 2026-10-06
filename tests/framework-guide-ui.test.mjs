import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { parseArguments } from '../skills/framework-setup/scripts/lib/agent-framework/arguments.mjs';
import { operationCatalog } from '../skills/framework-setup/scripts/lib/ui/operation-catalog.mjs';

const guide = () => readFile(path.resolve('docs/framework-guide.html'), 'utf8');
const dashboardSection = (html) => html.match(/<section id="project-dashboard">([\s\S]*?)<\/section>/)?.[1];

test('guide appends dashboard section without renumbering existing sections and resolves every contents anchor', async () => {
  const html = await guide();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Guide IDs are unique.');
  const toc = html.match(/<nav class="toc"[\s\S]*?<\/nav>/)[0];
  const links = [...toc.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
  assert.equal(links.length, 16);
  assert.equal(links.at(-1), 'project-dashboard');
  for (const id of links) assert.ok(ids.includes(id), `Missing contents target ${id}`);
  const sections = [...html.matchAll(/<section id="([^"]+)">\s*<div class="sec-head">\s*<span class="sec-num">Section (\d+)<\/span>/g)];
  assert.deepEqual(sections.map((match) => Number(match[2])), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.equal(sections.at(-2)[1], 'glossary');
  assert.equal(sections.at(-1)[1], 'project-dashboard');
  assert.ok((html.match(/href="#project-dashboard"/g) ?? []).length >= 3, 'Installation and quick start link to dashboard.');
});

test('guide launch examples and port boundaries match the actual Framework argument parser', async () => {
  const html = dashboardSection(await guide());
  const commands = [...html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)].map((match) => match[1]);
  assert.deepEqual(commands, [
    'node .agents/skills/framework-setup/scripts/agent-framework.mjs ui',
    'agent-framework ui',
    'agent-framework ui --project /path/to/project --port 4318',
  ]);
  for (const command of commands) {
    const argv = command.split(' ').slice(command.startsWith('node ') ? 2 : 1);
    assert.equal(parseArguments(argv).subcommand, 'ui');
  }
  assert.equal(parseArguments(['ui']).port, 0);
  assert.equal(parseArguments(['ui', '--port', '65535']).port, 65535);
  assert.equal(parseArguments(['ui', '--port', '65536']), null);
  assert.match(html, /127\.0\.0\.1/);
  assert.match(html, /Node\.js 20 or later/);
});

test('guide covers the seven real screens and the existing setup/maintenance owners', async () => {
  const html = dashboardSection(await guide());
  const index = await readFile(path.resolve('skills/framework-setup/scripts/ui-assets/index.html'), 'utf8');
  const realScreens = [...index.matchAll(/data-screen="([^"]+)"/g)].map((match) => match[1]);
  const documentedScreens = [...html.matchAll(/data-screen="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(documentedScreens, realScreens);
  const catalog = operationCatalog();
  for (const id of ['base-setup', 'migration', 'policy', 'gate:doctor', 'gate:activate', 'gate:check', 'gate:sync', 'gate:history', 'worktrees', 'report', 'guardrail']) assert.ok(catalog.some((entry) => entry.id === id));
  for (const phrase of ['Initialize Framework', 'Migrate configuration', 'Configure Gate', 'Gate doctor', 'Gate activate', 'Sync configuration', 'Download HTML report']) assert.ok(html.includes(phrase), phrase);
  for (const destination of ['.agent-framework.yaml', 'docs/agents/issue-tracker.md', 'docs/agents/domain.md', 'docs/agents/triage-labels.md']) assert.ok(html.includes(destination));
  assert.match(html, /Passing\s+operator checks are not durably recorded/);
  assert.match(html, /separate preview and confirmation/);
  assert.match(html, /no snapshot file browser or live per-check progress/);
  assert.match(html, /clone-wide, including linked worktrees/);
});

test('guide reports the current package release and adds no external assets or active dashboard controls', async () => {
  const html = await guide();
  const { version } = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
  assert.ok(html.includes(`Release ${version} · Gate-capable`));
  assert.ok(html.includes(`AI Skills Framework ${version} · 29 released skills`));
  const added = dashboardSection(html);
  assert.doesNotMatch(added, /<(?:script|link|iframe|img|form|input|button)\b|\bsrc\s*=|\bon(?:click|load|error)\s*=/i);
  assert.match(added, /<th scope="col">Screen<\/th>/);
  assert.match(added, /The session URL is a credential/);
  assert.match(added, /newly printed URL/);
  assert.match(added, /Starting the dashboard configures and activates nothing/);
});
