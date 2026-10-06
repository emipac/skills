import { describeGate } from '../presentation.mjs';
import { locateGateCommand, runGateCommand } from '../../gate-command.mjs';

/** The lifecycle states `gate doctor` answers for: a configured Gate section. */
const DOCTOR_STATES = Object.freeze(['configured', 'activated']);

/**
 * The doctor's findings for a configured clone, copied field by field out of
 * `gate doctor --json` so no value can pass through (`SG-GUIDE-002`); its
 * Sensitive runtime inputs are the configuration's, shown there. Not asked
 * without the Gate module or a configured Gate section.
 */
export const observeDoctor = async ({ projectRoot, environment, setup }) => {
  if (setup.gate?.available !== true) {
    return { asked: false, reason: `the Gate module is unavailable: ${setup.gate?.detail ?? 'it was not located'}.` };
  }

  if (!DOCTOR_STATES.includes(setup.state)) {
    return { asked: false, reason: `gate doctor answers for a configured Gate section, and this clone is ${setup.state ?? 'not readable'}.` };
  }

  const gate = await locateGateCommand({ environment });
  const doctored = await runGateCommand(gate, { cwd: projectRoot, args: ['doctor'], environment });
  const asked = `${describeGate(gate).command} doctor --json`;

  if (doctored.failure) {
    return { asked: true, command: asked, failure: doctored.failure };
  }

  const { observation } = doctored.document;
  const { verdict, runners, hooks } = observation;

  return {
    asked: true,
    command: asked,
    failure: null,
    state: observation.state,
    configuration: {
      resolved: observation.configuration.resolved,
      checks: [...(observation.configuration.checks ?? [])],
      reasonCode: observation.configuration.reasonCode,
      detail: observation.configuration.detail,
    },
    verdict: {
      proceeds: verdict.proceeds,
      reached: [...verdict.reached],
      stop: verdict.stop === null ? null : { step: verdict.stop.step, reasonCode: verdict.stop.reasonCode, detail: verdict.stop.detail },
    },
    runners: runners === null ? null : {
      resolved: runners.resolved.map(({ checkId, role, runner, executable, version }) => ({ checkId, role, runner, executable, version })),
      unresolved: runners.unresolved.map(({ checkId, role, runner, reason }) => ({ checkId, role, runner, reason })),
    },
    dependencyRoots: (observation.dependencies?.roots ?? []).map(({ root, strategy, status, mechanism }) => ({ root, strategy, status, mechanism })),
    hooks: hooks === null ? null : {
      hook: hooks.hook,
      ownership: hooks.ownership,
      action: hooks.action,
      valid: hooks.valid,
      reasonCode: hooks.reasonCode,
    },
    answeredByActivation: observation.answeredByActivation.map(({ step }) => step),
    limit: observation.limit,
  };
};
