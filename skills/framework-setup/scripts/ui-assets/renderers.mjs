import { append, button, card, chip, details, element, notice, pairs, table } from './dom.mjs';
import { downloadReport } from './download.mjs';

const valueText = (value) => typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '—');
const consequences = {
  deactivate: 'This withdraws Gate-owned registrations and the activation receipt for this clone.',
  uninstall: 'This removes only selected, unchanged project-installed assets after deactivation.',
  cleanup: 'This removes the listed Gate configuration keys, preserving other configuration bytes.',
  prune: 'This removes the previewed evidence blobs. Decisions and history records are retained.',
  sync: 'This adopts the reviewed configuration while retaining existing registrations.',
  update: 'This advances activation to the installed Gate release.',
  repair: 'This restores the eligible Gate-owned registrations named by the owner.',
  bypass: 'This grants one use of a bypass for the exact staged snapshot, with the supplied reason.',
  activate: 'This pins the reviewed configuration and registers the Gate for this clone.',
};

/** Refused observations must not erase the last successfully displayed data. */
export const activityResult = (result, previous, select) => {
  const refused = result?.exitCode === 2 || result?.document?.failure || result?.document?.status === 'refused';
  return refused ? { value: previous, refused: true } : { value: select(result.document), refused: false };
};
export const heading = (title, description) => {
  const h1 = element('h1', title);
  h1.tabIndex = -1;
  return append(element('div', null, 'page-heading'), h1, element('p', description));
};

export const checkResult = (observation) => {
  const node = card('Evaluation result');
  append(node, chip(observation.outcome), element('p', observation.describes ?? 'The Gate evaluated this snapshot.'), pairs({
    Scope: observation.scope ?? observation.snapshot?.kind,
    'Snapshot identity': observation.snapshot?.id,
    'Base revision': observation.snapshot?.baseRevision,
    'Evaluation identity': observation.evaluationId,
    'Elapsed time': observation.elapsedMs === undefined ? null : `${observation.elapsedMs} ms`,
  }));
  if (observation.checks?.length) append(node, table('Configured checks', ['Check', 'Policy', 'Outcome', 'Description'], observation.checks.map((entry) => [entry.id, entry.policy, entry.outcome, entry.summary])));
  if (observation.diagnostics?.length) append(node, table('Diagnostics', ['Reason', 'Details'], observation.diagnostics.map((entry) => [entry.reasonCode, entry.detail])));
  if (observation.evidence) append(node, element('p', observation.evidence.appended ? `Evidence recorded: ${observation.evidence.evidenceId}` : `Evidence was not recorded: ${observation.evidence.reasonCode ?? observation.evidence.notRecorded ?? 'not reported'}`, 'muted'));
  append(node, element('p', 'This result describes the evaluated snapshot. It does not authorize a commit or prove deployment.', 'muted'));
  return node;
};

export const renderResult = (result, onOperation = null) => {
  const document = result?.document ?? {};
  const observation = document.observation ?? document;
  const node = element('div');
  if (typeof document.reportHtml === 'string') {
    const exported = card('Static project report', 'Download the existing owner-generated HTML report. It captures the project state when it was generated and can be opened outside this dashboard.');
    append(exported, pairs({ 'Generated at': document.generatedAt }), button('Download HTML report', () => downloadReport(document.reportHtml), 'primary'));
    const { reportHtml, ...metadata } = document;
    append(node, exported, details({ ...result, document: metadata }, 'Advanced: report metadata'));
    return node;
  }
  const failure = document.failure ?? observation.refusal ?? document.refusal;
  if (failure) append(node, notice(typeof failure === 'string' ? failure : `${failure.reasonCode ?? failure.code ?? 'Refused'}: ${failure.detail ?? failure.reason ?? 'The operation cannot proceed.'}`, true));
  if (document.status === 'refused') append(node, notice(`${document.reasonCode ?? 'Refused'}: ${document.detail ?? 'The operation was refused.'}`, true));
  if (observation.checks && observation.snapshot) append(node, checkResult(observation));
  else {
    const summary = card('What the operation reported');
    append(summary, chip(observation.state ?? document.status ?? (document.applied ? 'completed' : result?.exitCode === 2 ? 'refused' : 'ready')));
    if (consequences[document.command]) append(summary, element('p', consequences[document.command]));
    for (const text of [observation.summary, observation.detail, observation.instruction, observation.next?.instruction, document.next?.instruction, observation.limit, document.limit]) {
      if (typeof text === 'string') append(summary, element('p', text));
    }
    if (observation.verdict) append(summary, pairs({ 'Ready for activation': observation.verdict.proceeds ? 'Yes' : 'No', 'Stopped by': observation.verdict.stop?.detail ?? 'Nothing reported' }));
    if (document.backend || document.frontend) append(summary, pairs({ Backend: document.backend, Frontend: document.frontend, 'Recommended tracker': document.recommendedTracker }));
    if (observation.findings?.length) append(summary, table('Findings', ['Finding', 'Details'], observation.findings.map((finding) => [finding.code ?? finding.reasonCode, finding.detail ?? finding.summary])));
    if (observation.steps?.length) append(summary, table('Activation pipeline', ['Step', 'Result'], observation.steps.map((step) => [typeof step === 'string' ? step : step.id ?? step.step, typeof step === 'string' ? 'Planned' : step.outcome ?? step.detail ?? 'Planned'])));
    if (observation.transition?.weakenings?.length) append(summary, notice('This preview reports a weaker policy. Read the transition details and request an acknowledged preview only if you intend that change.', true), details(observation.transition, 'Policy transition details'));
    if (document.selections) append(summary, pairs(document.selections));
    if (document.destinations) append(summary, element('h3', 'Files this operation would write'), append(element('ul'), ...document.destinations.map((file) => element('li', file))));
    if (document.changes?.length) append(summary, table('Configuration changes', ['Setting', 'Before', 'After'], document.changes.map((change) => [change.path ?? change.key ?? change.field ?? change, valueText(change.before), valueText(change.after)])));
    if (document.proposedConfiguration) append(summary, element('h3', 'Proposed configuration file'), element('pre', document.proposedConfiguration));
    if (document.proposedSettings) append(summary, element('h3', 'Proposed client settings'), element('pre', JSON.stringify(document.proposedSettings, null, 2)));
    if (document.ambiguities?.length) append(summary, notice('Some migration decisions remain unresolved. Update the mappings before requesting a new preview.'), table('Decisions to resolve', ['Setting', 'Required information'], document.ambiguities.map((entry) => [entry.path, entry.required?.join(', ')])));
    if (document.repin) append(summary, notice('The configuration changed. Activation still needs a separate re-pin review. Open “Sync configuration” to preview that step.'));
    for (const proposal of document.proposals ?? []) {
      const proposed = card(`${proposal.kind}: ${proposal.value}`);
      append(proposed, element('p', `Suggested for ${proposal.subcontract}.`));
      if (proposal.evidence?.length) append(proposed, table('Repository evidence', ['Path', 'Source'], proposal.evidence.map((entry) => [entry.path, entry.kind ?? entry.source ?? 'Observed repository fact'])));
      if (proposal.revision && onOperation) {
        const { operation, ...fields } = proposal.revision;
        append(proposed, button('Preview this suggestion', () => onOperation(`config:${operation}`, fields)));
      }
      append(summary, proposed);
    }
    if (document.proposals && !document.proposals.length) append(summary, element('p', 'No configuration additions are suggested by the available repository evidence.'));
    for (const key of ['retained', 'removable', 'removed', 'assets', 'hooks', 'registrations', 'adapterRegistrations', 'preserved', 'keys', 'blobs']) {
      const values = observation[key];
      if (Array.isArray(values) && values.length) append(summary, element('h3', key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())), append(element('ul'), ...values.map((entry) => element('li', typeof entry === 'string' ? entry : [entry.path ?? entry.id ?? entry.blobId ?? entry.adapterId, entry.adapter ?? entry.hook, entry.ownership, entry.reason ?? entry.detail ?? entry.outcome, entry.present === undefined ? null : entry.present ? 'present' : 'absent'].filter(Boolean).join(' · ')))));
    }
    if (observation.path || observation.configurationPath) append(summary, pairs({ File: observation.path ?? observation.configurationPath }));
    if (observation.removedText) append(summary, element('h3', 'Configuration text to remove'), element('pre', observation.removedText));
    if (document.mutation) append(summary, pairs({ 'Change performed': document.mutation.performed === true ? 'Yes' : 'No', 'Change outcome': document.mutation.summary ?? document.mutation.outcome ?? 'Reported', 'State after change': document.mutation.state ?? observation.state }));
    append(node, summary);
  }
  append(node, details(result));
  return node;
};

export const configuration = (document) => {
  const node = element('div');
  const failure = document?.failure ?? document?.refusal;
  if (failure) return notice(typeof failure === 'string' ? failure : `${failure.reasonCode ?? failure.code ?? 'Configuration unavailable'}: ${failure.detail ?? 'The owner could not read configuration.'}`, true);
  if (!document?.section) return notice('This project has no Gate configuration yet. Guided setup explains how to create it.');
  if (document.section.resolved === false) append(node, notice(`${document.section.reasonCode ?? 'Configuration unresolved'}: ${document.section.detail ?? 'The declared Gate configuration could not be resolved.'}`, true));
  append(node, notice(document.section.pinned?.matches === false ? 'Effective configuration differs from the activation pins. Review changes and use Sync configuration to adopt them.' : 'Configuration is shown by its owner. Sensitive inputs appear by name and source only.'));
  for (const subcontract of document.subcontracts ?? []) {
    const group = card(subcontract.name.replaceAll('-', ' '));
    append(group, table('Effective values and activation pins', ['Setting', 'Effective value', 'Pinned value', 'Comparison'], (subcontract.values ?? []).map((entry) => [entry.key, entry.declared ? valueText(entry.value) : 'Not set', entry.pinned?.declared ? valueText(entry.pinned.value) : 'Not set', { matches: 'Matches', differs: 'Differs', unrecoverable: 'Pinned value unavailable' }[entry.marking] ?? 'Not compared'])));
    append(node, group);
  }
  if (document.runtimeInputs) {
    const inputs = card('Sensitive runtime input sources', 'Values are never shown. The Gate resolves each declared name at evaluation time.');
    append(inputs, table('Input names', ['Name', 'Source'], [...(document.runtimeInputs.resolved ?? []).map((entry) => [entry.name, entry.source]), ...(document.runtimeInputs.unresolved ?? []).map((entry) => [entry.name, 'Unresolved'])]));
    append(node, inputs);
  }
  return node;
};

export const history = (observation, chooseEvidence, chooseLog) => {
  const node = element('div');
  const recorded = observation?.history;
  if (!recorded) return notice('Load history to read retained evaluation evidence from this clone.');
  const panel = card('Recorded evaluations', 'Snapshot metadata is retained; temporary evaluation directories are removed after checks finish.');
  if (!recorded.entries.length) append(panel, element('p', 'No recorded evaluations are available for this clone.', 'empty'));
  for (const entry of recorded.entries) {
    const row = card(entry.evaluationId ?? 'Evaluation');
    append(row, chip(entry.outcome), pairs({ Snapshot: entry.snapshot?.id, Kind: entry.snapshot?.kind, Recorded: entry.appendedAt }), button('Inspect evidence', () => chooseEvidence(entry.evidenceId)));
    append(panel, row);
  }
  if (recorded.truncated) append(panel, notice('Only the most recent bounded history entries are shown.'));
  if (recorded.warnings?.length) append(panel, notice(`History notes: ${recorded.warnings.join(', ')}`));
  append(node, panel);
  if (observation.coordination) append(node, append(card('Gate coordination'), notice(observation.coordination.held ? `An operation holds the clone lock (${observation.coordination.holder?.role ?? 'role not reported'}). ${observation.coordination.stale ? 'The lock appears stale; review recovery in Maintenance.' : 'Wait for it to finish before starting another.'}` : 'No Gate operation currently holds the clone coordination lock.')));
  if (recorded.selected) {
    const selected = recorded.selected;
    const panel = checkResult(selected);
    append(panel, element('h3', 'Retained redacted logs'));
    for (const log of selected.logs ?? []) append(panel, button(`Read ${log.checkId ?? 'check'} log · attempt ${log.attempt ?? 1}`, () => chooseLog(selected.evidenceId, log.blobId)));
    if (selected.log) {
      append(panel, element('p', `Log availability: ${selected.log.availability}${selected.log.truncated ? ' (truncated to display limit)' : ''}`));
      if (selected.log.text !== null) append(panel, element('pre', selected.log.text, 'log'));
    }
    append(node, panel);
  }
  return node;
};
