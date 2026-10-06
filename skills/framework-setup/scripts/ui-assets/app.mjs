import { append, button, card, chip, details, element, notice, pairs, table } from './dom.mjs';
import { operationForm } from './forms.mjs';
import { activityResult, configuration, heading, history, renderResult } from './renderers.mjs';

const $ = (id) => document.getElementById(id);
const state = { screen: 'overview', overview: null, catalog: [], jobs: [], history: null, worktrees: null, token: '', polling: false };
const screens = {
  overview: ['Your project, at a glance', 'Understand what is configured, what is active, and what to do next.'],
  setup: ['Set up with confidence', 'Follow the project’s own setup plan. Each change is reviewed and confirmed separately.'],
  checks: ['Check the changes you’re making', 'Evaluate a temporary snapshot of your working tree or staged changes with the configured Gate.'],
  configuration: ['Configuration you can understand', 'See effective values and activation pins. Change one setting at a time, with an exact preview.'],
  activity: ['Activity & retained evidence', 'Follow dashboard operations and inspect the evidence the Gate has already recorded.'],
  maintenance: ['Keep your project healthy', 'Preview maintenance operations and understand their effect before confirming.'],
  help: ['A guide to your project controls', 'Plain explanations of the states, commands and snapshots you will encounter.'],
};
const announce = (message) => { $('announcement').textContent = message; };
const labelOf = (id) => state.catalog.find((entry) => entry.id === id)?.label ?? id;

const api = async (route, body) => {
  const response = await fetch(route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${state.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.failure?.detail ?? 'The local dashboard could not answer.');
  return value;
};

const healthError = (error) => {
  $('connection').textContent = 'Connection needs attention';
  announce(error.message);
  $('result-panel').hidden = false;
  $('result-panel').replaceChildren(notice(`${error.message} If the server restarted, open its new session URL from the terminal.`, true));
};

const refreshOverview = async () => {
  $('refresh').disabled = true;
  try {
    state.overview = await api('/api/overview');
    const root = state.overview.projectRoot;
    $('project-label').textContent = root.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Local project';
    $('connection').textContent = `Health refreshed ${new Date().toLocaleTimeString()}`;
    if (['overview', 'setup', 'configuration'].includes(state.screen)) renderScreen(false);
  } finally { $('refresh').disabled = false; }
};

const activeJobs = () => state.jobs.some((job) => ['queued', 'running'].includes(job.state));
const updateJobs = async () => {
  state.jobs = (await api('/api/jobs')).jobs;
  if (state.screen === 'activity') renderScreen(false);
};
const pollJobs = async () => {
  if (state.polling) return;
  state.polling = true;
  try {
    do { await new Promise((resolve) => setTimeout(resolve, 1000)); await updateJobs(); } while (activeJobs());
  } catch (error) { healthError(error); }
  finally { state.polling = false; }
};

const runJob = async (operation, fields = {}, previewId = null) => {
  const { job: submitted } = await api('/api/jobs', previewId ? { previewId } : { operation, fields });
  state.jobs.unshift(submitted);
  announce(`${labelOf(submitted.operation)} queued. Follow it in Activity.`);
  pollJobs();
  for (;;) {
    const { job } = await api(`/api/jobs/${submitted.id}`);
    if (['completed', 'failed'].includes(job.state)) {
      const index = state.jobs.findIndex((entry) => entry.id === job.id);
      if (index >= 0) state.jobs[index] = job;
      if (job.failure) throw new Error(job.failure.detail);
      announce(`${labelOf(job.operation)} finished. Review the result.`);
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

const showResult = (job) => {
  $('result-panel').hidden = false;
  $('result-panel').replaceChildren(element('h2', `${labelOf(job.operation)} · result`, 'result-heading'), renderResult(job.result, openOperation));
  if (job.previewId) append($('result-panel'), button('Review & confirm', () => review(job), 'primary'));
  if (job.result?.document?.repin) append($('result-panel'), button('Preview Sync configuration', () => openOperation('gate:sync')));
};

let reviewTrigger;
let reviewedJob;
const review = (job) => {
  reviewedJob = job;
  reviewTrigger = document.activeElement;
  $('review-title').textContent = `Review: ${labelOf(job.operation)}`;
  $('review-content').replaceChildren(notice('Confirm only if you intend the changes shown below. The owner will recheck that this preview still matches the project.'), renderResult(job.result));
  $('review-content').querySelector('details')?.setAttribute('open', '');
  $('review-dialog').showModal();
};
$('dismiss-review').addEventListener('click', () => $('review-dialog').close());
$('review-dialog').addEventListener('close', () => reviewTrigger?.focus());
$('confirm-review').addEventListener('click', async () => {
  const job = reviewedJob;
  $('review-dialog').close();
  $('confirm-review').disabled = true;
  try {
    const confirmed = await runJob(null, {}, job.previewId);
    showResult(confirmed);
    await refreshOverview();
  } catch (error) { healthError(error); }
  finally { $('confirm-review').disabled = false; }
});

const openOperation = (id, initial = {}) => {
  const descriptor = state.catalog.find((entry) => entry.id === id);
  if (!descriptor) return;
  const panel = $('operation-panel');
  panel.hidden = false;
  const form = operationForm({ descriptor, initial,
    submit: async (fields) => { const job = await runJob(id, fields); showResult(job); },
    draft: ['migration', 'policy'].includes(id) ? async (name, control) => {
      try {
        const job = await runJob(id === 'migration' ? 'migration-draft' : 'policy-draft');
        if (job.result.exitCode === 2) { showResult(job); return; }
        control.value = JSON.stringify(job.result.document, null, 2);
        announce('Owner draft loaded. Review unresolved decisions before previewing.');
        control.focus();
      } catch (error) { healthError(error); }
    } : null,
  });
  const section = card(descriptor.label, descriptor.description);
  append(section, form);
  panel.replaceChildren(section);
  panel.scrollIntoView({ block: 'start', behavior: 'auto' });
  const focus = form.querySelector('input,select,textarea,button');
  focus?.focus();
};

const actionButtons = (...actions) => append(element('div', null, 'buttons'), ...actions.map(([label, id, initial]) => button(label, () => openOperation(id, initial), 'secondary')));
const setupActions = { 'configure-project': 'base-setup', 'migrate-schema-v4': 'migration', 'configure-gate': 'policy', doctor: 'gate:doctor', activate: 'gate:activate' };
const stepsPanel = () => {
  const panel = card('Your next steps', 'The Framework derives this sequence from the installed commands and your current project.');
  const steps = state.overview?.setup?.steps ?? [];
  if (!steps.length) append(panel, element('p', state.overview?.setup?.failure ? 'The setup plan could not be read. Review the finding below.' : 'No further setup steps are reported.', 'empty'));
  const list = element('ol', null, 'steps');
  for (const step of steps) {
    const node = element('li');
    append(node, element('h3', step.id.replaceAll('-', ' ')), element('p', step.summary, 'muted'));
    if (step.decisions?.length) append(node, append(element('ul'), ...step.decisions.map((decision) => element('li', decision))));
    if (step.refusal) append(node, notice(step.refusal, true));
    const operation = setupActions[step.id] ?? (step.commands ?? []).flatMap((entry) => entry.argv ?? []).map((part) => `gate:${part}`).find((id) => state.catalog.some((entry) => entry.id === id));
    if (operation) append(node, button('Open this step', () => openOperation(operation)));
    append(node, details(step.commands ?? [], 'Advanced: exact owning commands'));
    list.append(node);
  }
  append(panel, list);
  const unavailable = state.overview?.setup?.unavailable;
  if (unavailable?.length) append(panel, notice(`Gate steps are unavailable because its skill is not installed: ${unavailable.join(', ')}.`));
  return panel;
};

const renderOverview = (screen) => {
  const overview = state.overview;
  if (!overview) return append(screen, notice('Loading the project’s current health…'));
  const setup = overview.setup ?? {};
  const observation = overview.status?.observation ?? {};
  const grid = element('div', null, 'grid');
  for (const [label, value, detail] of [['Framework state', setup.state, 'Configuration and activation stage'], ['Gate health', observation.health ?? setup.health, 'Observed health and drift'], ['Activation', observation.receiptId ? 'activated' : 'Not activated', 'Registrations apply to this clone']]) {
    const panel = card(label);
    append(panel, chip(value), element('p', detail, 'muted'));
    grid.append(panel);
  }
  append(screen, grid, append(card('Project'), pairs({ Directory: overview.projectRoot, 'Gate release': observation.release?.version ?? 'Not reported' })), stepsPanel());
  for (const failure of [setup.failure, overview.status?.failure]) if (failure) append(screen, notice(failure.detail ?? 'An owner could not observe the project.', true));
  if (observation.findings?.length) append(screen, append(card('Health findings'), table('What needs attention', ['Finding', 'Details'], observation.findings.map((entry) => [entry.code, entry.detail]))));
  append(screen, actionButtons(['Run working-tree check', 'gate:check'], ['Check machine readiness', 'gate:doctor'], ['View setup plan', 'setup'], ['Export static report', 'report']));
};

const operationPicker = (screen, entries) => {
  const section = card('Choose an operation', 'The available controls come from the installed operation catalog.');
  const label = element('label', 'Operation');
  label.htmlFor = 'operation-choice';
  const select = element('select');
  select.id = 'operation-choice';
  const empty = element('option', 'Choose an operation'); empty.value = ''; select.append(empty);
  for (const entry of entries) { const option = element('option', entry.label); option.value = entry.id; select.append(option); }
  select.addEventListener('change', () => { if (select.value) openOperation(select.value); });
  append(section, append(element('div', null, 'field'), label, select));
  screen.append(section);
};

const renderActivity = (screen) => {
  const panel = card('Dashboard operations', 'Queued and running states describe whole operations. Individual check progress is shown when the final result arrives.');
  if (!state.jobs.length) append(panel, element('p', 'No dashboard operations have run in this session.', 'empty'));
  for (const job of [...state.jobs].reverse()) {
    const row = card(labelOf(job.operation));
    append(row, chip(job.state), pairs({ Started: job.startedAt ?? 'Waiting in queue', Finished: job.completedAt ?? 'Not finished', 'Change confirmed': job.confirmation ? 'Yes' : 'No' }));
    if (job.failure) append(row, notice(job.failure.detail, true));
    if (job.result) append(row, button('View result', () => showResult(job)));
    if (job.previewId) append(row, button('Review preview', () => review(job)));
    panel.append(row);
  }
  append(screen, panel, actionButtons(['Inspect coordination', 'gate:locks']));
  const refreshHistory = async (fields = {}) => {
    try {
      const job = await runJob('gate:history', fields);
      const observed = activityResult(job.result, state.history, (document) => document.observation);
      if (observed.refused) { showResult(job); return; }
      state.history = observed.value;
      renderScreen(false);
    }
    catch (error) { healthError(error); }
  };
  const controls = element('div', null, 'buttons');
  append(controls, button('Load / refresh evidence history', () => refreshHistory()), button('Load Git worktrees', async () => {
    try {
      const job = await runJob('worktrees');
      const observed = activityResult(job.result, state.worktrees, (document) => document);
      if (observed.refused) { showResult(job); return; }
      state.worktrees = observed.value;
      renderScreen(false);
    }
    catch (error) { healthError(error); }
  }));
  append(screen, controls, element('div', null, 'section-gap'), history(state.history, (evidence) => refreshHistory({ evidence }), (evidence, blob) => refreshHistory({ evidence, blob })));
  if (state.worktrees) append(screen, append(card('Git repository worktrees', 'Git worktrees are separate working directories. Gate evaluation snapshots are temporary copies used to run checks.'), table('Registered worktrees', ['Path', 'Branch', 'HEAD', 'Lock'], (state.worktrees.worktrees ?? []).map((entry) => [entry.path, entry.branch ?? 'Detached HEAD', entry.head, entry.locked || 'None']))));
};

const help = [
  ['Configuration versus activation', 'Configuration describes checks and policy. Activation pins the reviewed configuration and installs clone-local registrations. A configured project is not necessarily activated.'],
  ['Understanding health', 'Healthy means the observed registrations and control surface match their pins. Drift means something changed. Read the finding and follow the next action named by the Gate. A health check does not prove deployment or application correctness.'],
  ['Working tree versus staged changes', 'A working-tree check evaluates your current changes against HEAD. A staged check evaluates what is in the Git index, as the pre-commit Gate would. Both create temporary evaluation snapshots.'],
  ['Snapshots and evidence', 'Snapshot identities describe exactly what was evaluated. Temporary evaluation directories are removed after the check. Retained evidence includes outcomes, metadata and authorized redacted logs; it is not a permanent file browser. Git worktrees are separate repositories, not evaluation snapshots.'],
  ['Preview, then confirm', 'Maintenance and configuration changes first show a preview. Confirmation uses that exact reviewed operation and selection. If project state changes or the preview expires, request a fresh preview. Canceling the review changes nothing.'],
  ['Sync, update and repair', 'Sync adopts changed configuration while retaining registrations. Update advances activation to the installed Gate release. Repair restores eligible Gate-owned registrations; it does not rewrite arbitrary changes. The owner decides what is safe.'],
  ['Deactivation, uninstall and cleanup', 'Deactivate withdraws registrations and the receipt. Uninstall removes selected unchanged project-installed assets. Cleanup removes Gate configuration keys while preserving other configuration. Review each action separately.'],
  ['Budgets and bypasses', 'The evaluation budget bounds checking work. Budget-skippable checks and bypasses change policy behavior. A bypass is a one-use exception for the exact staged snapshot and requires a reason. Read weakening findings before acknowledging them.'],
  ['Local session and shutdown', 'This dashboard binds only to this project on your machine. Its session URL is printed in the terminal. Keep that terminal running. Ctrl+C stops new work; an active owner operation is allowed to finish its atomic changes before shutdown.'],
];

const renderScreen = (focus = true) => {
  const screen = $('screen');
  screen.replaceChildren(heading(...screens[state.screen]));
  if (state.screen === 'overview') renderOverview(screen);
  if (state.screen === 'setup') { append(screen, stepsPanel(), notice('Migration and Gate policy forms load the owner’s draft. Resolve any unanswered mapping decisions, then preview. Every setup step is confirmed separately.')); operationPicker(screen, state.catalog.filter((entry) => ['discovery', 'base-setup', 'migration', 'policy', 'gate:doctor', 'gate:activate'].includes(entry.id))); }
  if (state.screen === 'checks') append(screen, append(card('Choose what to evaluate', 'Checks run configured programs in a temporary snapshot and record evidence. Changes after the run require another check.'), actionButtons(['Run working-tree check', 'gate:check'], ['Run staged check', 'gate:check', { staged: true }]), notice('Inspect the result’s snapshot identity, base revision, check outcomes and diagnostics. This interface does not stream individual checks or browse temporary snapshot files.')));
  if (state.screen === 'configuration') { append(screen, configuration(state.overview?.configuration), actionButtons(['Discover suggestions', 'config-suggest'], ['Sync configuration', 'gate:sync'], ['Export static report', 'report'])); operationPicker(screen, state.catalog.filter((entry) => entry.id.startsWith('config:'))); }
  if (state.screen === 'activity') renderActivity(screen);
  if (state.screen === 'maintenance') { append(screen, notice('These operations affect activation, registrations, configuration or stored evidence. Always read the preview. Use Help for the differences between them.'), actionButtons(['Sync configuration', 'gate:sync'], ['Repair registrations', 'gate:repair'], ['Deactivate Gate', 'gate:deactivate'])); operationPicker(screen, state.catalog); }
  if (state.screen === 'help') for (const [title, description] of help) append(screen, card(title, description));
  if (focus) screen.querySelector('h1')?.focus();
};

for (const nav of $('navigation').querySelectorAll('button')) nav.addEventListener('click', () => {
  state.screen = nav.dataset.screen;
  for (const entry of $('navigation').querySelectorAll('button')) entry.removeAttribute('aria-current');
  nav.setAttribute('aria-current', 'page');
  $('operation-panel').hidden = true;
  $('result-panel').hidden = true;
  document.title = `${screens[state.screen][0]} · Framework`;
  renderScreen();
});
$('refresh').addEventListener('click', () => refreshOverview().catch(healthError));

const initialize = async () => {
  try {
    const fragment = location.hash.slice(1);
    if (fragment) {
      state.token = fragment;
      try { sessionStorage.setItem('framework-ui-session', fragment); } catch { /* This session still works without storage. */ }
      window.history.replaceState(null, '', location.pathname);
    } else {
      try { state.token = sessionStorage.getItem('framework-ui-session') ?? ''; } catch { state.token = ''; }
    }
    if (!state.token) throw new Error('This page has no local session. Open the complete dashboard URL printed in your terminal.');
    state.catalog = (await api('/api/catalog')).operations;
    await refreshOverview();
    await updateJobs();
    renderScreen(false);
    if (activeJobs()) pollJobs();
  } catch (error) { renderScreen(false); healthError(error); }
};
initialize();
