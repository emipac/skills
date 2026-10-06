import {
  configureGate,
  draftGatePolicy,
  draftMigrationMapping,
  migrateConfiguration,
  previewConfigurationMigration,
  previewGateConfiguration,
} from '../../../configure.mjs';
import { quoteForShell } from '../commands.mjs';
import { ACKNOWLEDGE_WEAKENING, PERFORM, WEAKENING_UNACKNOWLEDGED } from '../contracts.mjs';
import { runGateCommand } from '../../gate-command.mjs';

/**
 * The channel a guided confirmation declares to the Gate, in the Gate's own
 * vocabulary (`gate <command> --consent-channel`), so every Lifecycle event the
 * confirmation appends records that consent came through this prompt
 * (`RISK-011`). The Gate records it as self-declared; this command records
 * nothing of its own.
 */
export const GUIDED_CONSENT_CHANNEL = 'interactive-guided-setup';

/** The one answer that confirms. `y`, an empty line, and end of input do not. */
export const AFFIRMATIVE = 'yes';

const performed = (summary) => ({ done: true, summary });

export const stopped = (reasonCode, detail) => ({ done: false, stop: { reasonCode, detail } });

const DECLINED = stopped('declined', `the answer was not ${AFFIRMATIVE}, so nothing was confirmed; the clone stays at the last completed step.`);

const INPUT_ENDED = stopped('input-ended', 'input ended before the question was answered, so nothing was confirmed; the clone stays at the last completed step.');

/** Text shown inside a preview, indented so it reads as the preview's own. */
const indented = (text) => text.replace(/\n$/, '').split('\n').map((line) => `    ${line}`);

/** A decision as typed: read as JSON when it parses as JSON, else as text; empty takes the default. */
const readDecision = (answer, fallback) => {
  const text = answer.trim();

  if (text === '') {
    return fallback;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** What one guided run says and asks, on the terminal it was given. */
export const guidedIo = (terminal) => ({
  say: (...lines) => terminal.write(`${lines.join('\n')}\n`),
  ask: (question) => terminal.ask(question),
  decide: async (label, fallback) => {
    const shown = fallback === null || fallback === undefined ? '' : ` [${typeof fallback === 'string' ? fallback : JSON.stringify(fallback)}]`;
    const answer = await terminal.ask(`decide ${label}${shown}: `);

    return answer === null ? null : { typed: answer.trim(), value: readDecision(answer, fallback ?? null) };
  },
  /** `null` when the answer is consent to exactly this preview; otherwise why nothing is confirmed. */
  withheld: async (label, token) => {
    const answer = await terminal.ask(`confirm ${label} exactly as previewed (${token})? type ${AFFIRMATIVE} to confirm; anything else stops: `);

    if (answer === null) {
      return INPUT_ENDED;
    }

    return answer.trim().toLowerCase() === AFFIRMATIVE ? null : DECLINED;
  },
});

/**
 * The schema v4 migration: its own report's open decisions asked, each
 * defaulting to the owning draft's value, then its preview, then its
 * confirmation with that preview's hash.
 */
export const guideMigration = async ({ projectRoot, io }) => {
  let report;
  let draft;

  try {
    report = await previewConfigurationMigration({ projectRoot, mappings: {} });
    draft = await draftMigrationMapping({ projectRoot });
  } catch (error) {
    return stopped('migration-refused', error.message);
  }

  const mappings = {
    profiles: { ...draft.profiles },
    commands: Object.fromEntries(Object.entries(draft.commands).map(([commandPath, fields]) => [commandPath, { ...fields }])),
  };

  if (report.ambiguities.length > 0) {
    io.say(`decisions: the migration report leaves ${report.ambiguities.length} open; each default is the owning draft's, and an answer is read as JSON when it parses as JSON.`);
  }

  for (const ambiguity of report.ambiguities) {
    for (const field of ambiguity.required) {
      const isProfile = Object.hasOwn(mappings.profiles, ambiguity.path);
      const answer = await io.decide(
        `${ambiguity.path} ${field} (${JSON.stringify(ambiguity.value)})`,
        isProfile ? mappings.profiles[ambiguity.path] : mappings.commands[ambiguity.path]?.[field],
      );

      if (answer === null) {
        return INPUT_ENDED;
      }

      if (isProfile) {
        mappings.profiles[ambiguity.path] = answer.value;
      } else {
        mappings.commands[ambiguity.path] = { ...mappings.commands[ambiguity.path], [field]: answer.value };
      }
    }
  }

  let preview;

  try {
    preview = await previewConfigurationMigration({ projectRoot, mappings });
  } catch (error) {
    return stopped('migration-refused', error.message);
  }

  if (preview.status !== 'ready') {
    return stopped('migration-requires-mapping', `the migration preview still requires ${preview.ambiguities.map((ambiguity) => `${ambiguity.path}: ${ambiguity.required.join(', ')}`).join('; ')}.`);
  }

  io.say(
    'preview (framework-setup, migrate-schema-v4):',
    `  mapping: ${JSON.stringify(mappings)}`,
    `  .agent-framework.yaml, from schema version ${preview.fromVersion} to ${preview.toVersion}, would read:`,
    ...indented(preview.proposedConfiguration),
    `  previewHash: ${preview.previewHash}`,
  );

  const withheld = await io.withheld('migrate-schema-v4', preview.previewHash);

  if (withheld !== null) {
    return withheld;
  }

  try {
    await migrateConfiguration({ projectRoot, mappings, confirmation: preview.previewHash });
  } catch (error) {
    return stopped('migration-refused', error.message);
  }

  return performed(`.agent-framework.yaml is at schema version 4, written exactly as previewed (${preview.previewHash}).`);
};

/**
 * Gate configuration: the owning drafter's policy — its checks are the
 * provider's defaults, not a decision — previewed, then confirmed with that
 * preview's hash.
 */
export const guideGateConfiguration = async ({ projectRoot, io }) => {
  let policy;
  let preview;

  try {
    policy = await draftGatePolicy({ projectRoot });
    preview = await previewGateConfiguration({ projectRoot, policy });
  } catch (error) {
    return stopped('gate-configuration-refused', error.message);
  }

  io.say(
    'preview (framework-setup, configure-gate):',
    "  policy: the owning draft; its required and advisory checks are the provider's defaults, not a decision:",
    ...indented(JSON.stringify(policy, null, 2)),
    '  .agent-framework.yaml would read:',
    ...indented(preview.proposedConfiguration),
    `  previewHash: ${preview.previewHash}`,
  );

  const withheld = await io.withheld('configure-gate', preview.previewHash);

  if (withheld !== null) {
    return withheld;
  }

  try {
    await configureGate({ projectRoot, policy, confirmation: preview.previewHash });
  } catch (error) {
    return stopped('gate-configuration-refused', error.message);
  }

  return performed(`the dormant Gate is configured, written exactly as previewed (${preview.previewHash}).`);
};

/**
 * The first Gate subcommand a step names: its `--json` preview shown whole, as
 * the Gate states it; for a weaker candidate the Gate refuses, the weakening it
 * names typed back before its acknowledged preview is asked for
 * (`SG-CFG-001`); then its own token, confirmed on `yes` with the consent
 * channel declared. A step naming several subcommands is performed one at a
 * time, the next step re-derived from Gate status after each.
 */
export const guideGateSubcommand = async ({ projectRoot, environment, gate, step, io }) => {
  const [subcommand] = step[PERFORM].subcommands;

  if (subcommand === undefined) {
    return stopped('maintainer-step', `gate status names a step the maintainer performs, with no command: ${step.summary}`);
  }

  const selectors = [];

  if (subcommand === 'activate') {
    const client = await io.decide('client (the adapter to activate)', 'git');

    if (client === null) {
      return INPUT_ENDED;
    }

    // An empty answer is the Gate's own default, so nothing is passed for it.
    if (client.typed !== '') {
      selectors.push('--client', client.typed);
    }
  }

  const preview = async () => {
    const previewed = await runGateCommand(gate, { cwd: projectRoot, args: [subcommand, ...selectors], environment });

    if (!previewed.failure) {
      io.say(
        `preview (change-evaluation-gate, ${[...gate.display, subcommand, ...selectors, '--json'].map(quoteForShell).join(' ')}), as the Gate states it:`,
        ...indented(JSON.stringify(previewed.document.observation, null, 2)),
      );
    }

    return previewed;
  };
  let previewed = await preview();

  if (previewed.failure) {
    return stopped(previewed.failure.reasonCode, previewed.failure.detail);
  }

  if (previewed.document.observation.refusal?.reasonCode === WEAKENING_UNACKNOWLEDGED) {
    const { refusal, transition } = previewed.document.observation;
    const named = (transition?.weakenings ?? []).map((weakening) => `${weakening.code} ${weakening.checkId}`).join(', ');

    if (named === '') {
      return stopped(refusal.reasonCode, refusal.detail ?? 'the Gate refuses a weaker candidate and names no weakening to acknowledge.');
    }

    io.say(`the Gate offers no token for a candidate weaker than the trusted policy until the weakening is acknowledged; it names: ${named}`);

    const typed = await io.ask(`acknowledge the weakening by typing it exactly as named (${named}); anything else stops: `);

    if (typed === null || typed.trim() !== named) {
      return stopped(refusal.reasonCode, `the weakening was not typed back, so nothing was acknowledged or confirmed. ${refusal.detail ?? ''}`.trim());
    }

    selectors.push(ACKNOWLEDGE_WEAKENING);
    previewed = await preview();

    if (previewed.failure) {
      return stopped(previewed.failure.reasonCode, previewed.failure.detail);
    }
  }

  const { observation } = previewed.document;

  if (typeof observation.confirmationToken !== 'string') {
    return stopped(
      observation.refusal?.reasonCode ?? 'no-token',
      observation.refusal?.detail ?? `the Gate offers no token for this ${subcommand} preview.`,
    );
  }

  const withheld = await io.withheld(`gate ${subcommand}`, observation.confirmationToken);

  if (withheld !== null) {
    return withheld;
  }

  const confirmed = await runGateCommand(gate, {
    cwd: projectRoot,
    args: [subcommand, ...selectors, '--confirm', observation.confirmationToken, '--consent-channel', GUIDED_CONSENT_CHANNEL],
    environment,
  });

  if (confirmed.failure) {
    return stopped(confirmed.failure.reasonCode, confirmed.failure.detail);
  }

  const { mutation } = confirmed.document;

  if (mutation?.performed !== true) {
    return stopped(mutation?.reasonCode ?? 'not-performed', mutation?.summary ?? `the Gate did not perform the ${subcommand}.`);
  }

  return performed(`${mutation.summary} consent channel: ${GUIDED_CONSENT_CHANNEL}, declared to the Gate, which records it as self-declared.`);
};
