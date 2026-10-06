import path from 'node:path';

import {
  environmentFileText,
  markingText,
  renderSection,
  resolvedInputText,
  shownValueText,
  unresolvedInputText,
} from '../config/show.mjs';
import { REPORT_LIMIT } from '../contracts.mjs';
import { gateText, nextText, setupDoctorText, unavailableText } from '../presentation.mjs';

const HTML_ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });

const MARKUP = Symbol('markup');

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);

const interpolate = (value) => {
  if (Array.isArray(value)) {
    return value.map(interpolate).join('');
  }

  if (value === null || value === undefined) {
    return '';
  }

  return value[MARKUP] ?? escapeHtml(value);
};

/**
 * Markup with every interpolated value escaped, unless it is itself markup
 * built here; an array is each item in turn. Nothing reaches the page
 * unescaped by forgetting to escape it.
 */
const html = (strings, ...values) => ({
  [MARKUP]: strings.reduce((built, text, index) => built + text + (index < values.length ? interpolate(values[index]) : ''), ''),
});

const REPORT_STYLE = [
  ':root { color-scheme: light dark; --ink: #1d232a; --muted: #5b6672; --line: #d5dbe1; --panel: #f4f6f8; --page: #ffffff; --warn: #8a4b00; }',
  '@media (prefers-color-scheme: dark) { :root { --ink: #e4e8ec; --muted: #a3adb8; --line: #3a434d; --panel: #1f252b; --page: #14181c; --warn: #f0b35a; } }',
  'body { margin: 0 auto; max-width: 60rem; padding: 1.5rem 1rem 3rem; background: var(--page); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }',
  'h1 { font-size: 1.6rem; margin: 0 0 0.5rem; } h2 { font-size: 1.2rem; margin: 2rem 0 0.5rem; border-bottom: 1px solid var(--line); padding-bottom: 0.25rem; } h3 { font-size: 1rem; margin: 1.25rem 0 0.25rem; }',
  'dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0.5rem 0; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }',
  'code, pre { font: 13px/1.45 ui-monospace, monospace; } pre { background: var(--panel); padding: 0.5rem 0.75rem; margin: 0.25rem 0; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; }',
  'table { border-collapse: collapse; width: 100%; margin: 0.25rem 0; } th, td { text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); padding: 0.3rem 0.5rem; overflow-wrap: anywhere; } th { color: var(--muted); font-weight: 600; }',
  'li { margin: 0.25rem 0; } .muted { color: var(--muted); } .refused { color: var(--warn); } footer { margin-top: 2.5rem; color: var(--muted); font-size: 0.9rem; }',
].join('\n');

const doctorVerdictText = (verdict) => (verdict.proceeds
  ? 'activation would proceed'
  : `activation would stop at ${verdict.stop.step ?? 'configuration'} (${verdict.stop.reasonCode})`);

const dependencyRootText = (entry) => `${entry.root}: ${entry.strategy}, ${entry.status}${entry.mechanism === null ? '' : `, ${entry.mechanism}`}`;

const failureMarkup = (id, failed) => html`<p id="${id}" class="refused">failed: ${failed.reasonCode} — ${failed.detail}</p>`;

const commandMarkup = (run) => html`<pre><code>$ ${run}</code></pre>`;

/** Gate state and health, as `setup --json` names them. */
const stateMarkup = (setup) => html`<section>
<h2>Gate state and health</h2>
<dl>
<dt>state</dt><dd id="state">${setup.state ?? '(none)'}</dd>
<dt>health</dt><dd id="health">${setup.health ?? '(not reported)'}</dd>
<dt>gate</dt><dd id="gate">${setup.gate === null ? 'not located' : gateText(setup.gate)}</dd>
${setup.doctor === null ? '' : html`<dt>doctor</dt><dd id="setup-doctor">${setupDoctorText(setup.doctor)}</dd>`}
</dl>
${setup.failure === null ? '' : failureMarkup('setup-failure', setup.failure)}
</section>`;

/** Every remaining step and the next command, as `setup --json` names them. */
const stepsMarkup = (setup) => html`<section>
<h2>Next steps</h2>
<p>next: <code id="next">${nextText(setup.next)}</code></p>
${setup.steps.length === 0 ? '' : html`<ol>
${setup.steps.map((step, index) => html`<li id="step-${index + 1}"><strong>${step.id}</strong> (${step.owner}) — ${step.summary}
${step.decisions.map((decision) => html`<div>decide: ${decision}</div>`)}
${step.refusal === null ? '' : html`<div class="refused">refused: ${step.refusal}</div>`}
${step.commands.map((entry) => commandMarkup(entry.run))}
</li>
`)}</ol>`}
${setup.unavailable.length === 0 ? '' : html`<p id="unavailable">${unavailableText(setup.unavailable)}</p>`}
<p class="muted">Run every command from <code>${setup.project}</code>. Each step is performed only by the command it names, which previews first where it writes.</p>
</section>`;

/** The doctor's findings, in the Gate's own words. */
const doctorMarkup = (doctor) => {
  if (!doctor.asked) {
    return html`<section>
<h2>Doctor findings</h2>
<p id="doctor-unasked">not asked — ${doctor.reason}</p>
</section>`;
  }

  if (doctor.failure !== null) {
    return html`<section>
<h2>Doctor findings</h2>
<p class="muted">From <code>${doctor.command}</code>.</p>
${failureMarkup('doctor-failure', doctor.failure)}
</section>`;
  }

  const { verdict, runners, hooks, configuration } = doctor;

  return html`<section>
<h2>Doctor findings</h2>
<p class="muted">From <code>${doctor.command}</code>: what a new activation would find on this machine.</p>
<dl>
<dt>observed state</dt><dd>${doctor.state}</dd>
<dt>verdict</dt><dd id="doctor-verdict">${doctorVerdictText(verdict)}</dd>
${verdict.stop === null ? '' : html`<dt>stopped by</dt><dd class="refused">${verdict.stop.detail}</dd>`}
<dt>steps reached</dt><dd>${verdict.reached.join(', ') || 'none'}</dd>
<dt>configuration</dt><dd>${configuration.resolved ? `resolves; checks ${configuration.checks.join(', ') || 'none'}` : `does not resolve — ${configuration.reasonCode}: ${configuration.detail}`}</dd>
<dt>dependency roots</dt><dd id="doctor-roots">${doctor.dependencyRoots.map(dependencyRootText).join('; ') || 'none declared'}</dd>
<dt>hook</dt><dd>${hooks === null ? 'not inspected' : `${hooks.hook}: ${hooks.ownership}, ${hooks.action}${hooks.valid ? '' : ` (${hooks.reasonCode})`}`}</dd>
<dt>answered only by activation</dt><dd>${doctor.answeredByActivation.join(', ')}</dd>
</dl>
${runners === null ? '' : html`<table>
<tr><th>check</th><th>role</th><th>runner</th><th>resolves to</th></tr>
${runners.resolved.map((entry) => html`<tr><td>${entry.checkId}</td><td>${entry.role}</td><td>${entry.runner}</td><td><code>${entry.executable}</code>${entry.version === null ? '' : ` (${entry.version})`}</td></tr>
`)}${runners.unresolved.map((entry) => html`<tr class="refused"><td>${entry.checkId}</td><td>${entry.role}</td><td>${entry.runner}</td><td>unresolved — ${entry.reason}</td></tr>
`)}</table>`}
<p class="muted">${doctor.limit}</p>
</section>`;
};

/** The effective Gate configuration section, as `config show --json` shows it. */
const configurationMarkup = (shown) => {
  if (shown.failure !== null) {
    return html`<section>
<h2>Effective configuration</h2>
${failureMarkup('configuration-failure', shown.failure)}
</section>`;
  }

  return html`<section>
<h2>Effective configuration</h2>
${shown.section === null
    ? html`<p id="configuration-none">section: none — .agent-framework.yaml has no Gate configuration section.</p>`
    : renderSection(shown.section).map((line) => html`<p>${line}</p>`)}
${shown.subcontracts.map((subcontract) => html`<h3>${subcontract.name}</h3>
${subcontract.values.length === 0 ? html`<p class="muted">no keys set</p>` : html`<table>
<tr><th>key</th><th>value</th><th>against the pinned section</th></tr>
${subcontract.values.map((value) => {
    const id = `configuration.${subcontract.name}.${value.key}`;

    return html`<tr><td>${value.key}</td><td><code id="${id}">${shownValueText(value)}</code></td><td id="${id}.marking">${markingText(value) ?? 'not compared — nothing is pinned'}</td></tr>
`;
  })}</table>`}
`)}
${shown.runtimeInputs === null ? '' : html`<h3>Sensitive runtime inputs</h3>
<p class="muted">By name and the source each resolves from; never a value.</p>
<ul>
${shown.runtimeInputs.resolved.map((input) => html`<li id="runtime-input.${input.name}">${resolvedInputText(input)}</li>
`)}${shown.runtimeInputs.unresolved.map((input) => html`<li id="runtime-input.${input.name}">${unresolvedInputText(input)}</li>
`)}${shown.runtimeInputs.environmentFiles.map((file) => html`<li>${environmentFileText(file)}</li>
`)}</ul>`}
</section>`;
};

/** The whole page. Everything but `generatedAt` is a function of the documents. */
export const reportPage = ({ setup, shown, doctor, generatedAt, regenerate }) => html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gate report — ${path.basename(setup.project)}</title>
<style>
${{ [MARKUP]: REPORT_STYLE }}
</style>
</head>
<body>
<header>
<h1>Gate report</h1>
<dl>
<dt>project</dt><dd><code id="project">${setup.project}</code></dd>
<dt>generated</dt><dd><time id="generated" datetime="${generatedAt}">${generatedAt}</time></dd>
<dt>regenerate</dt><dd><code id="regenerate">${regenerate}</code></dd>
</dl>
<p class="muted">A static snapshot: it does not change when the clone does. Run the command above for a current page; it writes a new file in the temporary directory.</p>
</header>
<main>
${stateMarkup(setup)}
${stepsMarkup(setup)}
${doctorMarkup(doctor)}
${configurationMarkup(shown)}
</main>
<footer>
<p>Rendered by agent-framework report from the documents <code>agent-framework setup --json</code> and <code>agent-framework config show --json</code> print, with the findings of <code>gate doctor --json</code>. ${REPORT_LIMIT}</p>
</footer>
</body>
</html>
`[MARKUP];
