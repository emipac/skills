import { line, renderConfirmation, renderFindings, renderRelease } from './shared.mjs';

export const renderLocks = (observation, document) => [
  line('lock', observation.lockPath),
  line('held', observation.held),
  line('liveness', observation.liveness),
  line('stale', `${observation.stale}${observation.staleReasons.length === 0 ? '' : ` (${observation.staleReasons.join(', ')})`}`),
  line(
    'holder',
    observation.holder === null
      ? 'none'
      : `pid ${observation.holder.pid ?? 'unknown'} on ${observation.holder.host ?? 'unknown'}, heartbeat ${observation.holder.heartbeatAt ?? 'unknown'}`,
  ),
  line('recovery token', observation.recoveryToken ?? 'none'),
  line('acquired', observation.acquired),
  line('recovered', observation.recovered),
  renderConfirmation('locks', observation, document),
];

export const renderPrune = (observation, document) => [
  line('previewed', observation.previewedAt),
  line(
    'selector',
    `evaluations=${observation.selector.evaluationIds === null ? 'all' : observation.selector.evaluationIds.join(',')}`
    + ` before=${observation.selector.appendedBefore ?? 'any'}`
    + ` reclaim=${observation.selector.reclaimBytes ?? 'all'}`,
  ),
  line('blobs', observation.blobs.length),
  ...observation.blobs.map(
    (blob) => `  - ${blob.blobId} ${blob.bytes} bytes appended ${blob.appendedAt}`,
  ),
  line('bytes', observation.totalBytes),
  line('confirmation token', observation.confirmationToken),
  line('removed', observation.removed),
  observation.blobs.length === 0
    ? line('next', 'nothing to remove')
    : renderConfirmation('prune', observation, document),
];

export const renderRepair = (observation, document) => [
  line('health', observation.health),
  line('receipt', observation.receiptId ?? 'none'),
  line('hook program', `${observation.hookProgram.interpreter} ${observation.hookProgram.script}`),
  line('actions', observation.actions.length),
  ...observation.actions.map(
    (action) => `  - ${action.code} restore ${action.kind} ${action.path}`,
  ),
  line('unrepairable', observation.unrepairable.length),
  ...renderFindings(observation.unrepairable),
  observation.actions.length === 0
    ? line('next', observation.next.instruction === 'nothing' ? 'nothing to repair' : observation.next.instruction)
    : renderConfirmation('repair', observation, document),
];

export const renderUpdate = (observation, document) => [
  line('active', renderRelease(observation.active)),
  line('candidate', renderRelease(observation.candidate)),
  line('distribution', observation.distribution.manifest ?? 'unresolved'),
  line('candidate available', observation.candidateAvailable),
  line('advances active release', observation.advancesActiveRelease),
  line('migrations', observation.migrations.length),
  ...observation.migrations.map(
    (migration) => `  - ${migration.id} ${migration.description ?? ''} (reversible ${migration.reversible})`,
  ),
  line('self-tests rerun', observation.selfTestsRerun),
  observation.candidateAvailable
    ? renderConfirmation('update', observation, document)
    : line('next', 'the installed distribution offers no new release'),
];

export const renderDeactivate = (observation, document) => [
  line('receipt', observation.receiptId ?? 'none'),
  line('registrations', observation.registrations.length),
  ...observation.registrations.map(
    (registration) => `  - ${registration.kind} ${registration.hook ?? ''} ${registration.path} (present ${registration.present})`,
  ),
  line('adapter registrations', observation.adapterRegistrations.length),
  ...observation.adapterRegistrations.map(
    (registration) => `  - ${registration.kind} ${registration.adapter} ${registration.path}`,
  ),
  line('preserved', observation.preserved.join(', ')),
  renderConfirmation('deactivate', observation, document),
];

export const renderUninstall = (observation, document) => [
  line('assets', observation.assets.length),
  ...observation.assets.map(
    (asset) => `  - ${asset.path} (present ${asset.present}) ${asset.identity ?? 'no identity'}`,
  ),
  line('preserved', observation.preserved.join(', ')),
  observation.assets.length === 0
    ? line('next', 'name the project-installed assets with --asset <path>')
    : renderConfirmation('uninstall', observation, document),
];

export const renderCleanup = (observation, document) => [
  line('configuration', observation.path),
  line('keys', observation.keys.length),
  ...observation.keys.map((key) => `  - ${key.key} lines ${key.startLine}-${key.endLine}`),
  line('file deleted', observation.fileDeleted),
  observation.keys.length === 0
    ? line('next', 'nothing to remove')
    : renderConfirmation('cleanup', observation, document),
];
