import { gateRevisions } from '../../configure.mjs';

const field = (type, description, required = false, options = undefined) => ({
  type, description, required, ...(options === undefined ? {} : { options }),
});
const text = (description, required = false, options) => field('string', description, required, options);
const flag = (description) => field('boolean', description);
const entry = (id, label, description, fields = {}, readOnly = false, previewable = false) => ({
  id, label, description, fields, readOnly, previewable,
});

export const GATE_FIELDS = Object.freeze({
  activate: { client: text('Adapter to activate; defaults to git.'), actor: text('Best-effort local actor name.'), resume: text('Paused transaction identity.') },
  status: {}, check: { staged: flag('Evaluate staged changes instead of the working tree.') }, doctor: {}, locks: {},
  prune: { evaluationIds: field('strings', 'Evaluation identities to prune.'), before: text('ISO-8601 cutoff time.'), reclaim: field('integer', 'Target bytes to reclaim.') },
  repair: { hookScript: text('Advanced: replacement hook program path.') }, update: {}, deactivate: {},
  uninstall: { assets: field('strings', 'Unchanged project-installed asset paths.') }, cleanup: {},
  bypass: { reason: text('Reason for a one-use staged-snapshot bypass.', true), reference: text('Ticket or review reference.'), actor: text('Best-effort local actor name.') },
  sync: { acknowledgeWeakening: flag('Explicitly acknowledge policy weakenings named by the preview.') },
  history: { limit: field('integer', 'Maximum history entries, 1–100; defaults to 30.'), evidence: text('Evidence identity to inspect.'), blob: text('Log blob identity within the selected evidence.') },
});

export const GATE_FLAGS = Object.freeze({
  client: '--client', actor: '--actor', resume: '--resume', staged: '--staged',
  evaluationIds: '--evaluation', before: '--before', reclaim: '--reclaim',
  hookScript: '--hook-script', assets: '--asset', reason: '--reason', reference: '--reference',
  acknowledgeWeakening: '--acknowledge-weakening',
  limit: '--limit', evidence: '--evidence', blob: '--blob',
});

export const operationCatalog = () => [
  entry('setup', 'Setup plan', 'Discover the remaining adoption steps without changing the project.', {}, true),
  entry('config-show', 'Configuration', 'Read effective configuration and activation pins.', {}, true),
  entry('config-suggest', 'Suggestions', 'Find configuration additions supported by repository evidence.', {}, true),
  entry('report', 'Export HTML report', 'Generate the existing static health and configuration report for download; no project files change.', {}, true),
  entry('discovery', 'Project discovery', 'Discover stack, source scopes and documentation paths.', {}, true),
  entry('worktrees', 'Repository worktrees', 'List Git worktrees; these are separate from Gate evaluation snapshots.', {}, true),
  entry('base-setup', 'Initialize Framework', 'Write four Framework files in an unconfigured project after reviewing the destinations.', {
    tracker: text('Issue tracker.', true, ['local-markdown', 'github', 'jira', 'linear']),
    backend: text('Backend; defaults to discovery.', false, ['laravel', 'express-typescript', 'unknown']),
    frontend: text('Frontend; defaults to discovery.', false, ['livewire', 'react-typescript', 'svelte-typescript', 'none', 'unknown']),
  }, false, true),
  entry('migration-draft', 'Draft migration', 'Read unresolved schema migration decisions.', {}, true),
  entry('migration', 'Migrate configuration', 'Preview schema version 4 migration and confirm its exact hash.', { mappings: field('object', 'Migration mappings keyed by the owning draft.', true) }, false, true),
  entry('policy-draft', 'Draft Gate policy', 'Read the configured verification provider’s policy defaults.', {}, true),
  entry('policy', 'Configure Gate', 'Preview the initial dormant Gate policy and confirm its exact hash.', { policy: field('object', 'Gate policy returned by the owning draft.', true) }, false, true),
  ...Object.entries(gateRevisions).map(([name, revision]) => entry(`config:${name}`, name.replaceAll('-', ' '), `Revise the ${revision.subcontract} configuration; activation re-pinning remains a separate confirmation.`, {
    [revision.argument]: text(`Value for ${revision.argument}.`, true),
    ...Object.fromEntries(revision.options.map((option) => [option, text(`Optional ${option}.`)])),
    acknowledgeWeakening: flag('Request the Gate’s acknowledged weakening preview after writing.'),
  }, false, true)),
  entry('guardrail', 'Destructive-command guardrail', 'Preview adding or removing one client guardrail entry.', {
    action: text('Registration operation.', true, ['add', 'remove']),
    client: text('Client integration.', true, ['claude-code', 'cursor']),
  }, false, true),
  ...Object.entries(GATE_FIELDS).map(([name, fields]) => entry(`gate:${name}`, `Gate ${name}`, {
    activate: 'Register the Gate for this clone after explicit preview and consent.',
    status: 'Read health, drift and the Gate’s next recommended action.',
    doctor: 'Probe runtime readiness; may take time and use temporary files.',
    check: 'Evaluate a temporary tree snapshot; this authorizes no commit.',
    locks: 'Inspect coordination and preview stale-lock recovery.',
    prune: 'Preview removal of stored evidence blobs.',
    repair: 'Restore eligible Gate-owned registrations.', update: 'Advance to the installed Gate release.',
    deactivate: 'Withdraw registrations and the activation receipt.',
    uninstall: 'Remove selected unchanged project-installed assets.', cleanup: 'Remove Gate configuration keys.',
    bypass: 'Preview a one-use bypass bound to the exact staged snapshot.',
    sync: 'Adopt changed configuration while retaining registrations.',
    history: 'Read clone-local evaluation history and retained, redacted logs.',
  }[name], fields, ['status', 'doctor', 'history'].includes(name), !['status', 'doctor', 'check', 'history'].includes(name))),
];
