import { line, renderConfirmation, renderDependencyRoots } from './shared.mjs';

export const renderActivate = (observation, document) => [
  line('state', observation.state),
  line('client', `${observation.client} (trust model ${observation.trustModel ?? 'undeclared'})`),
  line(
    'release',
    `${observation.release.id} ${observation.release.version ?? 'unknown'} (protocol ${observation.release.protocolVersion})`,
  ),
  line('repository identity', observation.repositoryIdentity),
  line('configuration identity', observation.configurationIdentity),
  line('hooks', observation.hooks.length),
  ...observation.hooks.map(
    (hook) => `  - ${hook.hook} ${hook.path} (${hook.action}, ${hook.ownership ?? 'unowned'})`,
  ),
  line('hook manager', observation.hookManager?.id ?? 'none'),
  line('hook program', `${observation.hookProgram.interpreter} ${observation.hookProgram.script}`),
  line('commands', observation.commands.length),
  ...observation.commands.map(
    (command) => `  - ${command.check_id} ${command.runner} ${command.executable} ${command.version ?? 'unversioned'}`,
  ),
  line('unresolved', observation.unresolved.length),
  ...observation.unresolved.map((entry) => `  - ${JSON.stringify(entry)}`),
  line('adapters', observation.adapters.map((adapter) => adapter.id).join(', ') || 'none'),
  line('dependency roots', renderDependencyRoots(observation)),
  line('runtime inputs', observation.runtimeInputs.join(', ') || 'none'),
  line('shortcut', `${observation.shortcut.name} (${observation.shortcut.kind})`),
  renderConfirmation('activate', observation, document),
];
