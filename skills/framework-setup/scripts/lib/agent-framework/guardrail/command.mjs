import { applyGuardrail, previewGuardrail } from '../../../configure.mjs';
import { guardrailCommandLine } from '../commands.mjs';
import {
  EXIT_DONE,
  EXIT_STEPS_REMAIN,
  EXIT_UNRUNNABLE,
  GUARDRAIL_DOCUMENT_VERSION,
} from '../contracts.mjs';
import { failure, nextText } from '../presentation.mjs';

const GUARDRAIL_LIMIT = 'guardrail writes only the client settings file it names, only with the token of the preview that showed the change, and changes only the guardrail\'s one hook entry; setup never registers it. It guards against accidents and is not a security boundary.';

/**
 * Preview or confirm registering or removing the destructive-command
 * guardrail through `framework-setup`'s own operation (FS-006). The
 * operation's refusal is reported as it gives it.
 */
export const runGuardrail = async ({ projectRoot, environment, guardrail, confirmation }) => {
  let outcome;

  try {
    outcome = {
      changed: confirmation === null
        ? await previewGuardrail({ projectRoot, ...guardrail, environment })
        : await applyGuardrail({ projectRoot, ...guardrail, confirmation, environment }),
    };
  } catch (error) {
    outcome = failure(error.reasonCode ?? 'guardrail-refused', error.message);
  }

  const changed = outcome.changed ?? null;
  const applied = changed !== null && confirmation !== null;
  const exitStatus = outcome.failure ? EXIT_UNRUNNABLE : (applied ? EXIT_DONE : EXIT_STEPS_REMAIN);

  return {
    document: {
      document: GUARDRAIL_DOCUMENT_VERSION,
      command: `guardrail ${guardrail.operation} ${guardrail.client}`,
      ok: !outcome.failure,
      exitStatus,
      project: projectRoot,
      owner: 'framework-setup',
      operation: guardrail.operation,
      client: guardrail.client,
      applied,
      file: changed?.file ?? null,
      created: changed?.created ?? null,
      script: changed?.script ?? null,
      event: changed?.event ?? null,
      entry: changed?.entry ?? null,
      changes: changed?.changes ?? null,
      previewHash: changed?.previewHash ?? null,
      proposedSettings: changed?.proposedSettings ?? null,
      next: changed === null || applied
        ? null
        : {
          step: 'confirm-guardrail',
          command: guardrailCommandLine(projectRoot, guardrail, changed.previewHash).run,
          instruction: 'confirm exactly this preview with its token, once the maintainer approves it.',
        },
      failure: outcome.failure ?? null,
      limit: GUARDRAIL_LIMIT,
    },
    render: renderGuardrail,
  };
};

const renderGuardrail = (document) => {
  const lines = [`agent-framework ${document.command}`, `project: ${document.project}`];

  if (document.failure !== null) {
    lines.push(`failed: ${document.failure.reasonCode} — ${document.failure.detail}`, GUARDRAIL_LIMIT, '');

    return lines.join('\n');
  }

  const adding = document.operation === 'add';
  const { changes } = document;

  lines.push(
    `guardrail: ${document.script} — blocks a shell command that destroys uncommitted or unpushed work before the client runs it (owned by ${document.owner})`,
    `${document.applied ? 'applied' : 'preview'}: ${document.file}${document.created ? ' (created)' : ''} — ${document.applied ? '' : 'would '}${adding ? (document.applied ? 'added' : 'add') : (document.applied ? 'removed' : 'remove')} one ${document.event} ${document.entry.matcher === undefined ? 'entry' : `matcher group (${document.entry.matcher})`}; every other key and hook is kept:`,
    `  line ${changes.line}:`,
    ...(changes.before === null ? [] : [`  ${changes.before}`]),
    ...changes.removed.map((line) => `- ${line}`),
    ...changes.added.map((line) => `+ ${line}`),
    ...(changes.after === null ? [] : [`  ${changes.after}`]),
  );

  if (!document.applied) {
    lines.push(`token: ${document.previewHash}`);
  }

  lines.push(`next: ${nextText(document.next)}`, GUARDRAIL_LIMIT, '');

  return lines.join('\n');
};
