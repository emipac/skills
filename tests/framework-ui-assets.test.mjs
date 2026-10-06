import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { activityResult, configuration, checkResult, history, renderResult } from '../skills/framework-setup/scripts/ui-assets/renderers.mjs';
import { operationForm } from '../skills/framework-setup/scripts/ui-assets/forms.mjs';
import { downloadReport } from '../skills/framework-setup/scripts/ui-assets/download.mjs';

const ROOT = path.resolve('skills/framework-setup/scripts/ui-assets');

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.value = ''; this.text = ''; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(' '); }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(event, listener) { this.events[event] = listener; }
  focus() { this.focused = true; }
}
const nodesOf = (node, tag) => [node, ...node.children.flatMap((child) => nodesOf(child, tag))].filter((entry) => entry.tag === tag);
const withDom = (t) => {
  const prior = globalThis.document;
  globalThis.document = { createElement: (tag) => new Node(tag) };
  t.after(() => { globalThis.document = prior; });
};

test('UI static page uses semantic navigation, skip link, external assets, labelled dialog and live status', async () => {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /href="#content"/);
  assert.match(html, /<nav aria-label="Project dashboard"/);
  assert.match(html, /<main id="content"/);
  assert.match(html, /<dialog[^>]*aria-labelledby="review-title"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<script type="module" src="\/app.mjs"><\/script>/);
  assert.match(html, /rel="icon" href="\/favicon\.svg"/);
  assert.doesNotMatch(html, /https?:|on(?:click|load|error)=|<style>|<script(?![^>]*src=)/);
});

test('UI handles fragment sessions, authenticated requests, one-use preview IDs and focus restoration', async () => {
  const source = await readFile(path.join(ROOT, 'app.mjs'), 'utf8');
  assert.match(source, /location\.hash\.slice\(1\)/);
  assert.match(source, /sessionStorage\.setItem/);
  assert.match(source, /history\.replaceState/);
  assert.match(source, /Authorization: `Bearer/);
  assert.match(source, /previewId \? \{ previewId \}/);
  assert.match(source, /showModal\(\)/);
  assert.match(source, /reviewTrigger\?\.focus\(\)/);
  assert.match(source, /if \(activeJobs\(\)\) pollJobs\(\)/);
  for (const file of ['app.mjs', 'dom.mjs', 'forms.mjs', 'renderers.mjs', 'download.mjs']) {
    assert.doesNotMatch(await readFile(path.join(ROOT, file), 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|\beval\(|new Function|document\.write/);
  }
});

test('configuration renderer uses the real owner value/pinned/marking contract', (t) => {
  withDom(t);
  const node = configuration({ section: { pinned: { matches: false } }, subcontracts: [{ name: 'execution', values: [
    { key: 'budget', declared: true, value: 180, pinned: { declared: true, value: 120 }, marking: 'differs' },
    { key: 'missing', declared: false, value: undefined, pinned: { declared: false }, marking: null },
  ] }] });
  const cells = nodesOf(node, 'td').map((cell) => cell.textContent);
  assert.deepEqual(cells.slice(0, 4), ['budget', '180', '120', 'Differs']);
  assert.deepEqual(cells.slice(4), ['missing', 'Not set', 'Not set', 'Not compared']);
  assert.match(node.textContent, /differs from the activation pins/);
});

test('check renderer shows snapshot, per-check outcomes, diagnostics and evidence without treating result as commit permission', (t) => {
  withDom(t);
  const node = checkResult({ scope: 'staged', evaluationId: 'eval-1', outcome: 'failed', snapshot: { id: 'snapshot-1', kind: 'git-index', baseRevision: 'HEAD' }, checks: [{ id: 'test', policy: 'required', outcome: 'failed', summary: '1 test failed' }], diagnostics: [{ reasonCode: 'test-failure', detail: '<script>alert(1)</script>' }], evidence: { appended: true, evidenceId: 'evidence-1' }, elapsedMs: 123 });
  assert.match(node.textContent, /snapshot-1/);
  assert.match(node.textContent, /git-index|staged/);
  assert.match(node.textContent, /1 test failed/);
  assert.match(node.textContent, /<script>alert\(1\)<\/script>/);
  assert.equal(nodesOf(node, 'script').length, 0);
  assert.match(node.textContent, /does not authorize a commit/);
});

test('preview renders destinations, before/after changes, policy weakening and separate re-pin as readable content', (t) => {
  withDom(t);
  const node = renderResult({ exitCode: 1, document: { status: 'ready', destinations: ['.agent-framework.yaml'], changes: [{ path: 'execution.budget', before: 120, after: 90 }], repin: { confirmationToken: 'separate' }, observation: { transition: { weakenings: ['demoted-check'] } } } });
  assert.match(node.textContent, /Files this operation would write/);
  assert.match(node.textContent, /execution\.budget/);
  assert.match(node.textContent, /120/);
  assert.match(node.textContent, /90/);
  assert.match(node.textContent, /weaker policy/);
  assert.match(node.textContent, /separate re-pin review/);
});

test('history renders retained metadata and authorized logs inertly, with honest snapshot limits', (t) => {
  withDom(t);
  const evidence = [];
  const logs = [];
  const entry = { evaluationId: 'eval-history', evidenceId: 'evidence-history', outcome: 'passed', snapshot: { id: 'snap-history', kind: 'worktree', baseRevision: 'HEAD' }, checks: [], logs: [{ blobId: 'log-1', checkId: 'test', attempt: 1 }] };
  const node = history({ history: { entries: [entry], warnings: [], selected: { ...entry, log: { availability: 'retained', text: '<img src=x onerror=alert(1)>', truncated: false } } }, coordination: { held: true, holder: { role: 'preflight' }, stale: false } }, (id) => evidence.push(id), (id, blob) => logs.push([id, blob]));
  assert.match(node.textContent, /temporary evaluation directories are removed/);
  assert.match(node.textContent, /snap-history/);
  assert.match(node.textContent, /preflight/);
  assert.equal(nodesOf(node, 'img').length, 0);
  const buttons = nodesOf(node, 'button');
  buttons[0].events.click(); buttons[1].events.click();
  assert.deepEqual(evidence, ['evidence-history']);
  assert.deepEqual(logs, [['evidence-history', 'log-1']]);
});

test('metadata forms declare labelled types and parse only typed fields before requesting a preview', async (t) => {
  withDom(t);
  let request;
  const form = operationForm({ descriptor: { previewable: true, fields: {
    tracker: { type: 'string', options: ['local-markdown', 'github'], required: true, description: 'Tracker' },
    staged: { type: 'boolean', description: 'Staged' },
    count: { type: 'integer', description: 'Count' },
    paths: { type: 'strings', description: 'Paths' },
    policy: { type: 'object', required: true, description: 'Policy' },
  } }, initial: { tracker: 'github', staged: true, count: 3, paths: ['a', 'b'], policy: { enabled: true } }, submit: async (fields) => { request = fields; } });
  await form.events.submit({ preventDefault() {} });
  assert.deepEqual(request, { tracker: 'github', staged: true, count: 3, paths: ['a', 'b'], policy: { enabled: true } });
  const controls = [...nodesOf(form, 'input'), ...nodesOf(form, 'select'), ...nodesOf(form, 'textarea')];
  for (const control of controls) {
    assert.ok(nodesOf(form, 'label').some((label) => label.htmlFor === control.id));
    assert.ok(control.attrs['aria-describedby']);
  }
  const policy = nodesOf(form, 'textarea').find((control) => control.name === 'policy');
  policy.value = '{'; request = null;
  await form.events.submit({ preventDefault() {} });
  assert.equal(request, null);
  assert.match(form.textContent, /JSON is not valid/);
});

test('configuration suggestions provide owner revision actions instead of raw JSON alone', (t) => {
  withDom(t);
  let requested;
  const node = renderResult({ document: { proposals: [{ kind: 'dependency-root', value: 'node_modules', subcontract: 'execution', evidence: [{ path: 'package.json', kind: 'manifest' }], revision: { operation: 'add-dependency-root', root: 'node_modules' } }] } }, (...args) => { requested = args; });
  assert.match(node.textContent, /package\.json/);
  nodesOf(node, 'button')[0].events.click();
  assert.deepEqual(requested, ['config:add-dependency-root', { root: 'node_modules' }]);
});

test('static report rendering offers a download and metadata without mounting or duplicating report HTML', (t) => {
  withDom(t);
  const node = renderResult({ operation: 'report', exitCode: 0, document: { generatedAt: '2026-10-06T12:00:00Z', reportHtml: '<html><script>REPORT_CANARY</script></html>' } });
  assert.match(node.textContent, /Download HTML report/);
  assert.match(node.textContent, /2026-10-06T12:00:00Z/);
  assert.doesNotMatch(node.textContent, /REPORT_CANARY|reportHtml/);
  assert.equal(nodesOf(node, 'html').length, 0);
  assert.equal(nodesOf(node, 'script').length, 0);
});

test('report download creates an HTML Blob, names the file and revokes its transient URL', async (t) => {
  withDom(t);
  const anchors = [];
  globalThis.document.body = { append: (anchor) => anchors.push(anchor) };
  globalThis.document.createElement = (tag) => {
    const node = new Node(tag);
    node.click = () => { node.clicked = true; };
    node.remove = () => { node.removed = true; };
    return node;
  };
  let blob;
  let revoked;
  let release;
  downloadReport('<h1>Owner report</h1>', { urls: { createObjectURL: (value) => { blob = value; return 'blob:local-report'; }, revokeObjectURL: (url) => { revoked = url; } }, schedule: (callback) => { release = callback; } });
  assert.equal(blob.type, 'text/html;charset=utf-8');
  assert.equal(await blob.text(), '<h1>Owner report</h1>');
  assert.equal(anchors[0].download, 'framework-report.html');
  assert.equal(anchors[0].href, 'blob:local-report');
  assert.equal(anchors[0].clicked, true);
  assert.equal(anchors[0].removed, true);
  release();
  assert.equal(revoked, 'blob:local-report');
});

test('activity refresh preserves prior data and displays owner refusals instead of inventing empty history or worktrees', (t) => {
  withDom(t);
  const previous = { entries: [{ evaluationId: 'previous' }] };
  const refused = { exitCode: 2, document: { status: 'refused', failure: { reasonCode: 'gate-unavailable', detail: 'The Gate skill is unavailable.' } } };
  assert.deepEqual(activityResult(refused, previous, () => assert.fail('Refused data must not be selected.')), { value: previous, refused: true });
  assert.match(renderResult(refused).textContent, /The Gate skill is unavailable/);
  const history = { history: { entries: [] }, warnings: ['incomplete-tail'] };
  assert.deepEqual(activityResult({ exitCode: 1, document: { observation: history } }, previous, (document) => document.observation), { value: history, refused: false });
  const worktrees = { worktrees: [{ path: '/project' }] };
  assert.deepEqual(activityResult({ exitCode: 0, document: worktrees }, null, (document) => document), { value: worktrees, refused: false });
});

test('configuration distinguishes owner failure, unresolved section and an actually absent section', (t) => {
  withDom(t);
  const failed = configuration({ failure: { reasonCode: 'gate-unavailable', detail: 'Gate skill missing.' }, section: null });
  assert.match(failed.textContent, /Gate skill missing/);
  assert.doesNotMatch(failed.textContent, /no Gate configuration yet/);
  const unresolved = configuration({ section: { resolved: false, reasonCode: 'invalid-policy', detail: 'Budget declaration is invalid.' } });
  assert.match(unresolved.textContent, /Budget declaration is invalid/);
  assert.match(configuration({ section: null }).textContent, /no Gate configuration yet/);
});

test('narrow tables remain readable in a labelled keyboard-scrollable container', async (t) => {
  withDom(t);
  const node = configuration({ section: {}, subcontracts: [{ name: 'checks', values: [] }] });
  const wrappers = nodesOf(node, 'div').filter((entry) => entry.className === 'table-wrap');
  assert.ok(wrappers.every((wrapper) => wrapper.tabIndex === 0 && wrapper.attrs['aria-label']));
  assert.match(await readFile(path.join(ROOT, 'styles.css'), 'utf8'), /min-width: 560px/);
});
