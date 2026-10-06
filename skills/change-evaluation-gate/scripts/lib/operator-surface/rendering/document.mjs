import { CONFIRMABLE_COMMANDS } from '../constants.mjs';
import { renderActivate } from './activate.mjs';
import { renderBypass } from './bypass.mjs';
import { renderCheck } from './check.mjs';
import { renderDoctor } from './doctor.mjs';
import { renderCleanup, renderDeactivate, renderLocks, renderPrune, renderRepair, renderUninstall, renderUpdate } from './maintenance.mjs';
import { line } from './shared.mjs';
import { renderStatus } from './status.mjs';
import { renderSync } from './sync.mjs';

const RENDERERS = Object.freeze({
  activate: renderActivate,
  status: renderStatus,
  history: ({ history, coordination }) => [
    `evidence: ${history.entries.length} recorded evaluations (clone-wide)`,
    `activity: ${coordination?.held ? coordination.liveness : 'idle'}`,
    ...history.entries.map((entry) => `  ${entry.appendedAt} ${entry.outcome} ${entry.evidenceId}`),
    ...history.warnings.map((warning) => `warning: ${warning}`),
    ...(history.selected?.log?.text ? [history.selected.log.text] : []),
  ],
  check: renderCheck,
  doctor: renderDoctor,
  locks: renderLocks,
  prune: renderPrune,
  repair: renderRepair,
  update: renderUpdate,
  deactivate: renderDeactivate,
  uninstall: renderUninstall,
  cleanup: renderCleanup,
  bypass: renderBypass,
  sync: renderSync,
});

/**
 * What this invocation did, in the one shape every command reports it.
 *
 * There is deliberately no per-command mutation renderer: each operation states
 * its own outcome in one sentence its seam gave it, so the difference between a
 * repair and a prune is in the words rather than in a second rendering table
 * that could drift from the first.
 */
const renderMutation = (mutated) => [
  line('confirmed', mutated.confirmation),
  line('performed', mutated.performed),
  ...(mutated.reasonCode === null ? [] : [line('refused', mutated.reasonCode)]),
  ...(mutated.errors ?? []).map((error) => `  - ${JSON.stringify(error)}`),
  mutated.summary,
];

/**
 * Render the one document a person reads.
 *
 * This is the SAME document `--json` prints, rendered rather than recomputed,
 * so an agent and a maintainer can never observe different things from the same
 * invocation (`NFR-OPER-001`).
 */
export const renderDocument = (document) => [
  `gate ${document.command}${document.mutation === null ? '' : ` ${CONFIRMABLE_COMMANDS[document.command]}`}`,
  line('repository', document.repository.root ?? 'unresolved'),
  ...RENDERERS[document.command](document.observation, document),
  // A check is not a preview of a write: it may append a decision that did
  // not pass, and its own `evidence:` and `limit:` lines say what it did and
  // what it is, so the preview sentence would be false there (`TB-061`).
  // Nor is a doctor: it writes nothing under the clone, and its own
  // `footprint:` line states the one probe it made (`TB-063`).
  ...(['check', 'doctor', 'history'].includes(document.command)
    ? []
    : (document.mutation === null
      ? ['preview: nothing was written, nothing was repaired, and nothing was removed.']
      : renderMutation(document.mutation))),
  document.trustBoundary.statement,
  '',
].join('\n');
