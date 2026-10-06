import { discoverProject } from '../../../configure.mjs';
import { DOCUMENT_VERSION, EXIT_DONE, EXIT_STEPS_REMAIN, EXIT_UNRUNNABLE } from '../contracts.mjs';
import { exists } from '../paths.mjs';
import { describeGate, failure, nextOf } from '../presentation.mjs';
import { LIMIT, render } from './render.mjs';
import {
  activationStep,
  baseSetupStep,
  doctorStep,
  gateConfigurationStep,
  migrationStep,
  remedyStep,
} from './steps.mjs';
import { locateGateCommand, runGateCommand } from '../../gate-command.mjs';

/** The steps the Gate module performs, named when it is absent (`FR-GUIDE-009`). */
const GATE_STEPS = Object.freeze(['configure-gate', 'doctor', 'activate']);

/**
 * Ask the Gate where a schema v4 clone stands, and name what its own
 * observations say comes next.
 */
const gatePlan = async ({ projectRoot, gate, environment, status: asked = null }) => {
  const status = asked ?? await runGateCommand(gate, { cwd: projectRoot, args: ['status'], environment });

  if (status.failure) {
    return status;
  }

  const { observation } = status.document;
  const prefix = observation.next.shortcut === null ? gate.display : observation.next.shortcut.split(' ');
  const observed = { state: observation.state, health: observation.health };

  if (observation.state === 'installed') {
    if (!observation.next.informational.includes('gate-policy-missing')) {
      return failure(
        'gate-installed-unguided',
        `gate status reports this clone installed for ${observation.next.informational.join(', ') || 'no stated reason'}, which setup does not guide: ${observation.findings.map((finding) => finding.detail).join(' ')}`,
      );
    }

    return {
      state: 'gate-unconfigured',
      observed,
      doctor: null,
      steps: [
        await gateConfigurationStep(projectRoot, { current: true }),
        doctorStep(gate.display),
        activationStep(gate.display),
      ],
    };
  }

  // A Gate from before remedies carried their subcommands: say so, never guess one.
  const unnamed = observation.next.remedies.find((remedy) => !Array.isArray(remedy.subcommands));

  if (unnamed !== undefined) {
    const release = observation.release ? `${observation.release.id} ${observation.release.version}` : 'a release it does not name';

    return failure(
      'gate-remedy-subcommands-missing',
      `\`${[...gate.display, 'status', '--json'].join(' ')}\` names no subcommands for the ${unnamed.remedy} remedy: the installed Gate (${release}, ${gate.detail}) predates remedy subcommands. Update the Gate module; setup does not guess which command performs a remedy.`,
    );
  }

  let doctor = null;

  if (observation.state === 'configured') {
    const doctored = await runGateCommand(gate, { cwd: projectRoot, args: ['doctor'], environment });

    if (doctored.failure) {
      return doctored;
    }

    doctor = {
      proceeds: doctored.document.observation.verdict.proceeds,
      stop: doctored.document.observation.verdict.stop,
    };
  }

  return {
    state: observation.state,
    observed,
    doctor,
    steps: [
      ...(doctor === null || doctor.proceeds ? [] : [doctorStep(prefix, doctor)]),
      ...observation.next.remedies.map((remedy) => remedyStep(prefix, remedy)),
    ],
  };
};

/**
 * Where this clone stands, and every remaining step in order. `status` is a
 * `gate status` answer the caller already holds, so it is not asked twice.
 */
export const planSetup = async ({ projectRoot, environment, status = null }) => {
  const discovery = await discoverProject(projectRoot);
  const schemaVersion = discovery.existingConfiguration.schemaVersion;
  const gate = await locateGateCommand({ environment });
  const gateSteps = async (current) => (gate.available
    ? [await gateConfigurationStep(projectRoot, { current }), doctorStep(gate.display), activationStep(gate.display)]
    : []);
  const base = { gate, doctor: null, observed: null };

  if (schemaVersion === null || schemaVersion < 3) {
    return {
      ...base,
      state: schemaVersion === null ? 'no-configuration' : `schema-v${schemaVersion}`,
      steps: [
        baseSetupStep(projectRoot, discovery),
        await migrationStep(projectRoot, { current: false }),
        ...await gateSteps(false),
      ],
    };
  }

  if (schemaVersion === 3) {
    return {
      ...base,
      state: 'schema-v3',
      steps: [await migrationStep(projectRoot, { current: true }), ...await gateSteps(false)],
    };
  }

  if (schemaVersion !== 4) {
    return failure(
      'schema-unsupported',
      `.agent-framework.yaml declares schema version ${schemaVersion}; framework-setup reads schema versions 3 and 4 only.`,
    );
  }

  if (!gate.available) {
    return { ...base, state: 'schema-v4', steps: [] };
  }

  const planned = await gatePlan({ projectRoot, gate, environment, status });

  return planned.failure ? { ...planned, gate } : { ...base, ...planned };
};

export const runSetup = async ({ projectRoot, environment }) => {
  const planned = (await exists(projectRoot))
    ? await planSetup({ projectRoot, environment })
    : failure('project-missing', `${projectRoot} does not exist.`);
  const steps = planned.steps ?? [];
  const exitStatus = planned.failure ? EXIT_UNRUNNABLE : (steps.length === 0 ? EXIT_DONE : EXIT_STEPS_REMAIN);

  return {
    document: {
      document: DOCUMENT_VERSION,
      command: 'setup',
      ok: !planned.failure,
      exitStatus,
      project: projectRoot,
      state: planned.state ?? null,
      health: planned.observed?.health ?? null,
      gate: planned.gate === undefined ? null : { ...describeGate(planned.gate), observed: planned.observed ?? null },
      doctor: planned.doctor ?? null,
      steps,
      unavailable: planned.gate?.available === false ? [...GATE_STEPS] : [],
      next: nextOf(steps),
      failure: planned.failure ?? null,
      limit: LIMIT,
    },
    render,
  };
};
