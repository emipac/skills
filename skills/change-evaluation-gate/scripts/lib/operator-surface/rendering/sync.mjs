import { line, renderConfirmation, renderDependencyRoots, renderRelease } from './shared.mjs';

export const renderSync = (observation, document) => {
  const { transition } = observation;
  const weakenings = transition?.weakenings ?? [];
  const next = () => {
    if (observation.refusal === null) {
      return renderConfirmation('sync', observation, document);
    }

    return line('next', observation.refusal.next);
  };

  return [
    line('state', observation.state),
    line('receipt', observation.receiptId ?? 'none'),
    line('release', renderRelease(observation.release)),
    line(
      'trusted configuration',
      `${observation.trusted.identity ?? 'none'} (${observation.trusted.source === null ? 'unrecoverable' : `read from ${observation.trusted.source}`})`,
    ),
    line('candidate configuration', observation.candidate.identity),
    // The heading nobody can miss: the transition is judged, and a weaker
    // candidate says so in capitals before anything else is read.
    line('policy transition', transition === null
      ? 'cannot be judged: the trusted policy could not be recovered'
      : (transition.weakened
        ? `WEAKER than the trusted policy (${weakenings.length})`
        : 'not weaker than the trusted policy')),
    ...weakenings.map((weakening) => `  - ${weakening.code} ${weakening.checkId}: ${weakening.detail}`),
    ...(transition?.weakened ? [line('weakening acknowledged', observation.acknowledgedWeakening)] : []),
    line('adapters kept', observation.adapters.map((adapter) => adapter.id).join(', ') || 'none'),
    line('registrations kept', 1 + observation.adapterRegistrations.length),
    `  - ${observation.hook.hook} ${observation.hook.path ?? 'unregistered'} (${observation.hook.ownership}, ${observation.hook.action})`,
    ...observation.adapterRegistrations.map(
      (registration) => `  - ${registration.adapter} ${registration.path ?? 'unregistered'} (${registration.state}, ${registration.action})`,
    ),
    line('commands', observation.commands.length),
    ...observation.commands.map(
      (command) => `  - ${command.check_id} ${command.runner} ${command.executable} ${command.version ?? 'unversioned'}`,
    ),
    line('unresolved', observation.unresolved.length),
    ...observation.unresolved.map((entry) => `  - ${JSON.stringify(entry)}`),
    line('dependency roots', renderDependencyRoots(observation)),
    line('runtime inputs', observation.runtimeInputs.join(', ') || 'none'),
    line('refusal', observation.refusal === null
      ? 'none'
      : `${observation.refusal.reasonCode}: ${observation.refusal.detail ?? 'see its errors'}`),
    next(),
  ];
};
