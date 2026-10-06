/* ---------------------------------------------------------------------------
 * Guided setup in an interactive terminal (`FR-GUIDE-003`, `FR-GUIDE-004`,
 * `TB-072`).
 *
 * The plan above, performed one step at a time. Each step is re-derived from
 * the clone as it is after the last one, so the run follows exactly the order
 * `setup` prints, and only that order is this command's own decision
 * (`SG-OWNER-001`). Each step shows the owning operation's complete preview,
 * asks only what that operation cannot derive — the migration's open
 * decisions, the client to activate, a weakening's acknowledgement — offering
 * the owning draft as the default, and confirms only on an explicit `yes`,
 * with that preview's own token, through the operation that owns it. Any other
 * answer, end of input, or a refusal by the owning operation stops the run
 * with nothing further confirmed; a refused step is reported in the owning
 * operation's words and never retried. Consent is asked again for every step
 * and is never remembered (`SG-GUIDE-001`).
 * ------------------------------------------------------------------------- */

import { EXIT_STEPS_REMAIN, GUIDED_DOCUMENT_VERSION, PERFORM } from '../contracts.mjs';
import { exists } from '../paths.mjs';
import {
  AFFIRMATIVE,
  GUIDED_CONSENT_CHANNEL,
  guideGateConfiguration,
  guideGateSubcommand,
  guideMigration,
  guidedIo,
  stopped,
} from './guided-steps.mjs';
import { planSetup, runSetup } from './plan.mjs';
import { render } from './render.mjs';

const GUIDED_INTRO = `each step shows the owning operation's complete preview and asks only what that operation cannot derive; only the answer ${AFFIRMATIVE} confirms exactly that preview, through the operation that owns it, and any other answer stops with nothing further confirmed.`;

const GUIDED_LIMIT = `guided setup confirmed only what was answered ${AFFIRMATIVE} after its complete preview, each through the operation that owns it with that preview's own token; it wrote no draft and asked again for every step.`;

/** Perform one planned step as its kind says; the plan supplies the Gate and doctor's verdict. */
const guideStep = ({ projectRoot, environment, planned, step, io }) => ({
  unpreviewed: async () => stopped(
    'step-unpreviewed',
    `${step.id} writes .agent-framework.yaml with no preview to confirm, so guided setup does not perform it (SG-GUIDE-001). Run it yourself, then run agent-framework setup again: ${step.commands[0].run}`,
  ),
  migration: () => guideMigration({ projectRoot, io }),
  'gate-configuration': () => guideGateConfiguration({ projectRoot, io }),
  // The plan names doctor first only when its verdict is a stop.
  doctor: async () => stopped(
    planned.doctor?.stop?.reasonCode ?? 'doctor-stop',
    `gate doctor predicts activation would stop: ${planned.doctor?.stop?.detail ?? step.summary}`,
  ),
  gate: () => guideGateSubcommand({ projectRoot, environment, gate: planned.gate, step, io }),
}[step[PERFORM].kind])();

/**
 * Walk the clone through every remaining step, then print where it stands
 * exactly as `setup` prints it.
 */
export const runGuidedSetup = async ({ projectRoot, environment, terminal }) => {
  const io = guidedIo(terminal);
  const completed = [];
  let stop = null;
  let last = null;

  io.say('agent-framework setup — guided', `project: ${projectRoot}`, GUIDED_INTRO);

  while (stop === null && await exists(projectRoot)) {
    const planned = await planSetup({ projectRoot, environment });

    if (planned.failure) {
      stop = { step: null, ...planned.failure };
      break;
    }

    const [step] = planned.steps;

    if (step === undefined) {
      break;
    }

    if (step.id === last) {
      stop = { step: step.id, reasonCode: 'step-repeated', detail: `${step.id} completed, and the owning observation names it again; setup does not repeat a step.` };
      io.say(`stopped: ${stop.reasonCode} — ${stop.detail}`);
      break;
    }

    // A Gate step is introduced in the Gate's own words; a framework-setup
    // step's printed summary names draft files this run never writes.
    io.say('', `step ${completed.length + 1}: ${step.id} (${step.owner})${step.owner === 'change-evaluation-gate' ? ` — ${step.summary}` : ''}`);

    const outcome = await guideStep({ projectRoot, environment, planned, step, io });

    if (!outcome.done) {
      stop = { step: step.id, ...outcome.stop };
      io.say(`stopped: ${stop.reasonCode} — ${stop.detail}`);
      break;
    }

    io.say(`done: ${outcome.summary}`);
    completed.push({ step: step.id, owner: step.owner, summary: outcome.summary });
    last = step.id;
  }

  const { document: plan } = await runSetup({ projectRoot, environment });
  const exitStatus = stop === null ? plan.exitStatus : Math.max(EXIT_STEPS_REMAIN, plan.exitStatus);

  io.say('', 'where this clone stands now:');
  terminal.write(render(plan, { limit: false }));
  io.say(GUIDED_LIMIT);

  return {
    exitCode: exitStatus,
    stdout: '',
    stderr: '',
    document: {
      document: GUIDED_DOCUMENT_VERSION,
      command: 'setup',
      exitStatus,
      project: projectRoot,
      consentChannel: GUIDED_CONSENT_CHANNEL,
      completed,
      stopped: stop,
      plan,
      limit: GUIDED_LIMIT,
    },
  };
};
