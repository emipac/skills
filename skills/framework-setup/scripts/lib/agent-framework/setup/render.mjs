import { gateText, nextText, setupDoctorText, unavailableText } from '../presentation.mjs';

export const LIMIT = 'setup wrote nothing, confirmed nothing, and registered nothing; each step is performed only by the command it names, which previews first where it writes.';

/** The plan as text. `limit` is false only where a guided run, which did confirm, ends with its own. */
export const render = (document, { limit = true } = {}) => {
  const lines = [
    'agent-framework setup',
    `project: ${document.project}`,
  ];

  if (document.failure !== null) {
    lines.push(`failed: ${document.failure.reasonCode} — ${document.failure.detail}`, ...(limit ? [LIMIT] : []), '');

    return lines.join('\n');
  }

  lines.push(`state: ${document.state}`);

  if (document.health !== null) {
    lines.push(`health: ${document.health}`);
  }

  lines.push(`gate: ${gateText(document.gate)}`);

  if (document.doctor !== null) {
    lines.push(`doctor: ${setupDoctorText(document.doctor)}`);
  }

  lines.push(`steps: ${document.steps.length}`);

  for (const [index, step] of document.steps.entries()) {
    lines.push(`  ${index + 1}. ${step.id} (${step.owner}) — ${step.summary}`);

    for (const decision of step.decisions) {
      lines.push(`     decide: ${decision}`);
    }

    if (step.refusal !== null) {
      lines.push(`     refused: ${step.refusal}`);
    }

    for (const entry of step.commands) {
      lines.push(`     $ ${entry.run}`);
    }
  }

  if (document.unavailable.length > 0) {
    lines.push(unavailableText(document.unavailable));
  }

  lines.push(
    `next: ${nextText(document.next)}`,
    `run every command from ${document.project}.`,
    ...(limit ? [LIMIT] : []),
    '',
  );

  return lines.join('\n');
};
