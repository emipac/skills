import { quoteForShell } from './commands.mjs';

export const failure = (reasonCode, detail) => ({ failure: { reasonCode, detail } });

/** The located Gate command, or why it is unavailable. */
export const gateText = (gate) => (gate.available ? `${gate.command} — ${gate.detail}` : `unavailable — ${gate.detail}`);

/** What `gate doctor` predicted for activation, as setup's document holds it. */
export const setupDoctorText = (doctor) => (doctor.proceeds ? 'activation would proceed' : `activation would stop (${doctor.stop.reasonCode})`);

/** The one next command, or the instruction when the step has none. */
export const nextText = (next) => (next === null ? 'nothing' : (next.command ?? next.instruction));

export const unavailableText = (unavailable) => `unavailable: ${unavailable.join(', ')} — Gate steps are unavailable because the Gate module is not installed.`;

/** The Gate command as a document names it. */
export const describeGate = (gate) => ({
  available: gate.available,
  located: gate.located,
  command: gate.display === null ? null : gate.display.map(quoteForShell).join(' '),
  detail: gate.detail,
});

/** The first remaining step, as the one next command. */
export const nextOf = (steps) => {
  const first = steps[0] ?? null;

  return first === null ? null : {
    step: first.id,
    command: first.commands[0]?.run ?? null,
    instruction: first.summary,
  };
};
