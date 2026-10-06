import { line } from './shared.mjs';

/** Why a section was not asked: the configuration it reads did not resolve. */
const NOT_ASKED = 'not asked — the configuration did not resolve';

const renderDoctorRunners = (runners) => {
  if (runners === null) {
    return [line('runners', NOT_ASKED)];
  }

  return [
    line('runners', `${runners.resolved.length} resolved, ${runners.unresolved.length} unresolved`),
    ...runners.resolved.map((entry) => `  - ${entry.checkId} (${entry.role}): ${entry.runner} -> ${entry.executable}${
      entry.interpreter === null ? '' : ` (interpreter ${entry.interpreter})`}${
      entry.version === null ? '' : ` ${entry.version}`}`),
    ...runners.unresolved.map((entry) => `  - ${entry.checkId} (${entry.role}): ${[entry.runner, ...entry.args].join(' ')} — unresolved (${entry.reason})`),
  ];
};

/** What a `copy` would be performed by here, and whether a `link` could be created, as probed (`TB-055`). */
const renderDoctorDependencies = (dependencies) => {
  const cloneLine = () => {
    if (dependencies.copyProgram === null) {
      return 'none found in the platform\'s own directories; a copy is a byte copy';
    }

    return dependencies.clone === null
      ? `${dependencies.copyProgram}, does not clone into the temporary directory; a copy is a byte copy`
      : `${dependencies.clone.program}, clones into the temporary directory (${dependencies.clone.request.join(' ')})`;
  };
  const rootLine = (entry) => {
    if (entry.status !== 'available') {
      return `  - ${entry.root} (${entry.strategy}): ${entry.status}`;
    }

    const volume = entry.sharesVolume === null
      ? 'volume unknown'
      : `${entry.sharesVolume ? 'same' : 'another'} volume as the temporary directory`;

    return `  - ${entry.root} (${entry.strategy}): available, ${entry.mechanism ?? 'cannot be linked here'}, ${volume}`;
  };

  return [
    line('dependency roots', dependencies.roots.length === 0 ? 'none declared' : dependencies.roots.length),
    `  probe: ${dependencies.probe.directory} (${dependencies.probe.removed ? 'removed' : 'NOT removed'})`,
    `  copy program: ${cloneLine()}`,
    `  directory link: ${dependencies.directoryLink.created
      ? 'can be created in the temporary directory'
      : `cannot be created in the temporary directory (${dependencies.directoryLink.code})`}`,
    `  repository: ${dependencies.repositorySharesVolume === null
      ? 'volume unknown'
      : `${dependencies.repositorySharesVolume ? 'same' : 'another'} volume as the temporary directory`}`,
    ...dependencies.roots.map(rootLine),
  ];
};

const renderDoctorRuntimeInputs = (runtimeInputs) => {
  if (runtimeInputs === null) {
    return [line('sensitive inputs', NOT_ASKED)];
  }

  const inputs = [
    ...runtimeInputs.resolved.map((input) => `${input.name} (${input.source}) resolved`),
    ...runtimeInputs.unresolved.map((input) => `${input.name} (${input.source}) unresolved`),
  ];

  return [
    line('sensitive inputs', inputs.length === 0 ? 'none declared' : inputs.join(', ')),
    ...(runtimeInputs.environmentFiles.length === 0
      ? []
      : [line('environment files', runtimeInputs.environmentFiles.map((file) => `${file.path} (${file.status})`).join(', '))]),
  ];
};

const renderDoctorHooks = (hooks) => {
  if (hooks === null) {
    return [line('hooks', NOT_ASKED)];
  }

  return [
    line('hooks', `${hooks.hook} ${hooks.path} (${hooks.action}, ${hooks.ownership}): ${hooks.valid
      ? 'valid'
      : `refused at hook-chain-validation (${hooks.reasonCode})`}`),
    `  hooks path: ${hooks.hooksPath.directory} (${hooks.hooksPath.configured
      ? `core.hooksPath ${hooks.hooksPath.value}${hooks.hooksPath.shared ? ', shared' : ''}`
      : 'default'})`,
    `  hook manager: ${hooks.manager ?? 'none'}`,
  ];
};

const renderVerdict = (verdict) => {
  if (verdict.proceeds) {
    return `activation would proceed past every step doctor can see (${verdict.reached.join(', ')})`;
  }

  if (verdict.stop.step === null) {
    return `activation would not start (${verdict.stop.reasonCode}): ${verdict.stop.detail}`;
  }

  return `activation would stop at ${verdict.stop.step} (${verdict.stop.reasonCode}): ${verdict.stop.detail}`;
};

export const renderDoctor = (observation) => [
  line('state', observation.state),
  line('configuration', observation.configuration.resolved
    ? `${observation.configuration.path} (schema ${observation.configuration.schemaVersion}, ${observation.configuration.checks.length} configured check${observation.configuration.checks.length === 1 ? '' : 's'})`
    : `${observation.configuration.path}: ${observation.configuration.reasonCode} — ${observation.configuration.detail}`),
  ...(observation.identities === null
    ? []
    : [line('identities', `repository ${observation.identities.repository}, configuration ${observation.identities.configuration} (what a receipt would pin)`)]),
  ...renderDoctorRunners(observation.runners),
  ...renderDoctorDependencies(observation.dependencies),
  ...renderDoctorRuntimeInputs(observation.runtimeInputs),
  ...renderDoctorHooks(observation.hooks),
  line('verdict', renderVerdict(observation.verdict)),
  line('answered by activation', observation.answeredByActivation.length),
  ...observation.answeredByActivation.map((entry) => `  - ${entry.step}: ${entry.question}`),
  line('footprint', `nothing under the clone or its Evidence store was written; one probe directory under the temporary directory was created and ${observation.dependencies.probe.removed ? 'removed' : 'NOT removed'}`),
  line('limit', observation.limit),
];
