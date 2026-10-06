import {
  discoverGateConfigurationFacts,
  gateRevisions,
  previewGateRevision,
} from '../../../configure.mjs';
import { revisionCommand } from '../commands.mjs';
import { observeSection } from './observation.mjs';
import {
  EXIT_DONE,
  EXIT_STEPS_REMAIN,
  EXIT_UNRUNNABLE,
  SUGGEST_DOCUMENT_VERSION,
} from '../contracts.mjs';
import { exists } from '../paths.mjs';
import { describeGate, failure, gateText, nextText } from '../presentation.mjs';

const SUGGEST_LIMIT = 'config suggest wrote nothing and applied nothing; a proposal is applied only by running its command, reading the preview it prints, and confirming that preview with its own token. An example environment file is read for key names only, and an environment file not at all.';

/**
 * The one revision each kind of proposal names. None binds a check or touches
 * a Verification profile command (`SG-OWNER-001`).
 */
const PROPOSAL_REVISIONS = Object.freeze({
  'dependency-root': Object.freeze({ operation: 'add-dependency-root', fact: 'dependencyRoots', value: 'root' }),
  'sensitive-input': Object.freeze({ operation: 'add-sensitive-input', fact: 'sensitiveInputs', value: 'name' }),
  'environment-file': Object.freeze({ operation: 'add-environment-file', fact: 'environmentFiles', value: 'file' }),
});

/**
 * Every proposal the repository's facts imply, each proved against
 * `framework-setup`'s own revision preview (`FR-GUIDE-007`, `TB-071`).
 *
 * A fact becomes a proposal only when the named revision previews: one that
 * would change nothing is already declared and is left out, and a key the Gate
 * policy validator refuses as a name is counted, never shown, because such a
 * line may hold a value (`SG-GUIDE-002`). Any other refusal is the section's
 * own, so no proposal could apply, and it is reported as the operation gives
 * it. Each preview's token is discarded: nothing is applied by suggesting
 * (`SG-GUIDE-001`).
 */
const provenProposals = async ({ projectRoot, facts }) => {
  const proposals = [];
  const refusedNames = [];

  for (const [kind, { operation, fact, value }] of Object.entries(PROPOSAL_REVISIONS)) {
    for (const entry of facts[fact]) {
      const revision = { operation, [gateRevisions[operation].argument]: entry[value] };

      try {
        await previewGateRevision({ projectRoot, revision });
      } catch (error) {
        if (error.reasonCode === 'nothing-to-revise') {
          continue;
        }

        if (error.reasonCode === 'candidate-invalid' && kind === 'sensitive-input') {
          refusedNames.push(entry.evidence[0].path);
          continue;
        }

        return failure(error.reasonCode ?? 'revision-refused', error.message);
      }

      proposals.push({
        kind,
        subcontract: gateRevisions[operation].subcontract,
        value: entry[value],
        evidence: entry.evidence,
        revision,
        command: revisionCommand(projectRoot, revision),
      });
    }
  }

  return { proposals, refusedNames };
};

/**
 * What this repository implies the Gate configuration section should declare
 * and does not, with evidence and the command that previews each. A clone with
 * no section names setup's next step and proposes nothing.
 */
const suggestConfiguration = async ({ projectRoot, environment }) => {
  const observed = await observeSection({ projectRoot, environment, reader: 'config suggest' });

  if (observed.observation === undefined) {
    return observed;
  }

  const { gate, observation } = observed;
  const facts = await discoverGateConfigurationFacts({ projectRoot, environment });
  const proven = await provenProposals({ projectRoot, facts });

  if (proven.failure) {
    return { ...proven, gate, state: observation.state };
  }

  const skipped = [
    ...facts.unassigned.map(({ path: file, count }) => ({ path: file, reason: 'not-an-assignment', count })),
    ...[...new Set(proven.refusedNames)].map((file) => ({
      path: file,
      reason: 'name-refused',
      count: proven.refusedNames.filter((refused) => refused === file).length,
    })),
  ];

  return {
    state: observation.state,
    gate,
    section: { resolved: observation.configuration.working.resolved, identity: observation.configuration.working.identity },
    proposals: proven.proposals,
    skipped,
    next: proven.proposals.length === 0 ? null : {
      step: 'choose-proposal',
      command: null,
      instruction: 'choose a proposal and run its command: it previews that one change and prints the token that applies it; nothing is applied by suggesting.',
    },
  };
};

const PROPOSAL_NOUNS = Object.freeze({
  'dependency-root': 'dependency root',
  'sensitive-input': 'Sensitive runtime input',
  'environment-file': 'environment file',
});

/** One piece of evidence as a maintainer reads it. */
const describeEvidence = (evidence) => ({
  manifest: `${evidence.path} (manifest)`,
  'lock-file': `${evidence.path} (lock file)`,
  'install-directory': `${evidence.path}/ (installed directory)`,
  'example-name': `${evidence.path} line ${evidence.line} names it`,
  'git-ignored': `${evidence.path} is present and Git ignores it`,
}[evidence.fact]);

const SKIPPED_REASONS = Object.freeze({
  'not-an-assignment': 'assigns no NAME=',
  'name-refused': 'names a key the Gate policy validator refuses as a Sensitive runtime input name',
});

const renderSuggestion = (document) => {
  const lines = [
    'agent-framework config suggest',
    `project: ${document.project}`,
  ];

  if (document.failure !== null) {
    lines.push(`failed: ${document.failure.reasonCode} — ${document.failure.detail}`, SUGGEST_LIMIT, '');

    return lines.join('\n');
  }

  lines.push(`state: ${document.state}`);

  if (document.gate !== null) {
    lines.push(`gate: ${gateText(document.gate)}`);
  }

  if (document.section === null) {
    lines.push('section: none — .agent-framework.yaml has no Gate configuration section, so nothing is proposed.');
  }

  lines.push(`proposals: ${document.proposals.length}`);

  for (const [index, proposal] of document.proposals.entries()) {
    lines.push(
      `  ${index + 1}. ${PROPOSAL_NOUNS[proposal.kind]} ${proposal.value} (${proposal.subcontract})`,
      `     evidence: ${proposal.evidence.map(describeEvidence).join('; ')}`,
      `     $ ${proposal.command.run}`,
    );
  }

  for (const skipped of document.skipped) {
    lines.push(`skipped: ${skipped.count} ${skipped.count === 1 ? 'line' : 'lines'} of ${skipped.path} that ${SKIPPED_REASONS[skipped.reason]} (${skipped.reason}) — not shown, since such a line may hold a value.`);
  }

  lines.push(
    `next: ${nextText(document.next)}`,
    `run every command from ${document.project}.`,
    SUGGEST_LIMIT,
    '',
  );

  return lines.join('\n');
};

export const runConfigSuggest = async ({ projectRoot, environment }) => {
  const suggested = (await exists(projectRoot))
    ? await suggestConfiguration({ projectRoot, environment })
    : failure('project-missing', `${projectRoot} does not exist.`);
  const proposals = suggested.proposals ?? [];
  const exitStatus = suggested.failure
    ? EXIT_UNRUNNABLE
    : (suggested.section === null || proposals.length > 0 ? EXIT_STEPS_REMAIN : EXIT_DONE);

  return {
    document: {
      document: SUGGEST_DOCUMENT_VERSION,
      command: 'config suggest',
      ok: !suggested.failure,
      exitStatus,
      project: projectRoot,
      state: suggested.state ?? null,
      gate: suggested.gate === undefined ? null : describeGate(suggested.gate),
      section: suggested.section ?? null,
      proposals,
      skipped: suggested.skipped ?? [],
      next: suggested.next ?? null,
      failure: suggested.failure ?? null,
      limit: SUGGEST_LIMIT,
    },
    render: renderSuggestion,
  };
};
