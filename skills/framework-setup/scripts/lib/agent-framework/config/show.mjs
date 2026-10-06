import { observeSection } from './observation.mjs';
import { shownSubcontracts } from './values.mjs';
import {
  CONFIG_DOCUMENT_VERSION,
  EXIT_DONE,
  EXIT_STEPS_REMAIN,
  EXIT_UNRUNNABLE,
} from '../contracts.mjs';
import { exists } from '../paths.mjs';
import { describeGate, failure, gateText, nextOf, nextText } from '../presentation.mjs';
import { planSetup } from '../setup/plan.mjs';
import { runGateCommand } from '../../gate-command.mjs';

const CONFIG_LIMIT = 'config show wrote nothing and changed nothing; a Sensitive runtime input is shown by name and the source it resolves from, never by value.';

/**
 * The Sensitive runtime inputs by name and the source each resolves from, as
 * `gate doctor --json` resolves them for a check. Only names, sources, and
 * file statuses are copied out of its document, field by field, so no value
 * can pass through here (`SG-GUIDE-002`, `SG-SECRET-001`).
 */
const observeRuntimeInputs = async ({ projectRoot, gate, environment }) => {
  const doctored = await runGateCommand(gate, { cwd: projectRoot, args: ['doctor'], environment });

  if (doctored.failure) {
    return doctored;
  }

  const inputs = doctored.document.observation.runtimeInputs;

  return {
    runtimeInputs: {
      resolved: inputs.resolved.map(({ name, source }) => ({ name, source })),
      unresolved: inputs.unresolved.map(({ name }) => ({ name })),
      environmentFiles: inputs.environmentFiles.map(({ path: file, status }) => ({ path: file, status })),
    },
  };
};

/** The Gate configuration section this clone runs, and what its receipt pinned. */
const showConfiguration = async ({ projectRoot, environment }) => {
  const observed = await observeSection({ projectRoot, environment, reader: 'config show' });

  if (observed.observation === undefined) {
    return observed;
  }

  const { gate, status, observation } = observed;
  const { working, pinned } = observation.configuration;

  const declaresInputs = (working.policy?.evidence?.sensitive_inputs ?? []).length > 0;
  const inputs = declaresInputs ? await observeRuntimeInputs({ projectRoot, gate, environment }) : { runtimeInputs: null };

  if (inputs.failure) {
    return { ...inputs, gate };
  }

  const plan = await planSetup({ projectRoot, environment, status });

  return {
    state: observation.state,
    gate,
    section: {
      resolved: working.resolved,
      reasonCode: working.reasonCode,
      detail: working.detail,
      identity: working.identity,
      pinned: pinned === null ? null : {
        identity: pinned.identity,
        source: pinned.source,
        recovered: pinned.policy !== null,
        matches: working.identity === pinned.identity,
      },
    },
    subcontracts: working.policy === null
      ? []
      : shownSubcontracts(working.policy, pinned === null ? undefined : pinned.policy),
    runtimeInputs: inputs.runtimeInputs,
    next: plan.failure ? null : nextOf(plan.steps),
  };
};

/** One shown value as text: its JSON, or `(not set)`. */
export const shownValueText = (value) => (value.declared ? JSON.stringify(value.value) : '(not set)');

/** How one value compares with the pinned one, in words; `null` when nothing is pinned. */
export const markingText = (value) => {
  const pinned = value.pinned?.declared ? JSON.stringify(value.pinned.value) : '(not set)';
  const changes = [
    ...(value.added?.length ? [`added ${value.added.join(', ')}`] : []),
    ...(value.removed?.length ? [`removed ${value.removed.join(', ')}`] : []),
  ];

  return {
    matches: 'matches the pinned value',
    differs: `differs from the pinned value ${pinned}${changes.map((change) => `; ${change}`).join('')}`,
    unrecoverable: 'unrecoverable: the pinned value is known only by the section identity',
  }[value.marking] ?? null;
};

/** One value's line: the working value, then how it compares with the pinned one. */
const renderValue = (value) => {
  const marking = markingText(value);

  return `  ${value.key}: ${shownValueText(value)}${marking === null ? '' : ` — ${marking}`}`;
};

/** How the section as a whole stands against what the Activation receipt pinned. */
export const renderSection = (section) => {
  const lines = [];

  if (!section.resolved) {
    lines.push(`section: does not resolve — ${section.reasonCode}: ${section.detail}`);
  } else if (section.pinned === null) {
    lines.push('section: not pinned — this clone has no Activation receipt, so no value is compared.');
  } else if (section.pinned.matches) {
    lines.push(`section: matches what the Activation receipt pinned (${section.pinned.identity})`);
  } else {
    lines.push(`section: differs from what the Activation receipt pinned (pinned ${section.pinned.identity}, working ${section.identity})`);
  }

  if (section.pinned !== null) {
    lines.push(section.pinned.recovered
      ? `pinned values: read from ${section.pinned.source}, which reproduces the pinned identity`
      : 'pinned values: unrecoverable — no document reproduces the pinned identity, so only the section as a whole is compared.');
  }

  return lines;
};

/** A Sensitive runtime input by name and source, or as unresolved; never a value (`SG-GUIDE-002`). */
export const resolvedInputText = (input) => `${input.name}: from ${input.source}`;

export const unresolvedInputText = (input) => `${input.name}: unresolved — no source sets it`;

export const environmentFileText = (file) => `environment file ${file.path}: ${file.status}`;

const renderConfiguration = (document) => {
  const lines = [
    'agent-framework config show',
    `project: ${document.project}`,
  ];

  if (document.failure !== null) {
    lines.push(`failed: ${document.failure.reasonCode} — ${document.failure.detail}`, CONFIG_LIMIT, '');

    return lines.join('\n');
  }

  lines.push(`state: ${document.state}`);

  if (document.gate !== null) {
    lines.push(`gate: ${gateText(document.gate)}`);
  }

  if (document.section === null) {
    lines.push('section: none — .agent-framework.yaml has no Gate configuration section.');
  } else {
    lines.push(...renderSection(document.section));
  }

  for (const subcontract of document.subcontracts) {
    lines.push(`${subcontract.name}:`, ...subcontract.values.map(renderValue));
  }

  if (document.runtimeInputs !== null) {
    lines.push(
      'runtime inputs:',
      ...document.runtimeInputs.resolved.map((input) => `  - ${resolvedInputText(input)}`),
      ...document.runtimeInputs.unresolved.map((input) => `  - ${unresolvedInputText(input)}`),
      ...document.runtimeInputs.environmentFiles.map((file) => `  ${environmentFileText(file)}`),
    );
  }

  lines.push(
    `next: ${nextText(document.next)}`,
    CONFIG_LIMIT,
    '',
  );

  return lines.join('\n');
};

const hasDifference = (shown) => shown.section === null
  || !shown.section.resolved
  || shown.section.pinned?.matches === false;

export const runConfigShow = async ({ projectRoot, environment }) => {
  const shown = (await exists(projectRoot))
    ? await showConfiguration({ projectRoot, environment })
    : failure('project-missing', `${projectRoot} does not exist.`);
  const exitStatus = shown.failure ? EXIT_UNRUNNABLE : (hasDifference(shown) ? EXIT_STEPS_REMAIN : EXIT_DONE);

  return {
    document: {
      document: CONFIG_DOCUMENT_VERSION,
      command: 'config show',
      ok: !shown.failure,
      exitStatus,
      project: projectRoot,
      state: shown.state ?? null,
      gate: shown.gate === undefined ? null : describeGate(shown.gate),
      section: shown.section ?? null,
      subcontracts: shown.subcontracts ?? [],
      runtimeInputs: shown.runtimeInputs ?? null,
      next: shown.next ?? null,
      failure: shown.failure ?? null,
      limit: CONFIG_LIMIT,
    },
    render: renderConfiguration,
  };
};
