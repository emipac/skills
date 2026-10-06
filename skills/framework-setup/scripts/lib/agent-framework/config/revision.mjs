import {
  gateRevisions,
  previewGateRevision,
  reviseGate,
  withheldRevision,
} from '../../../configure.mjs';
import { gateCommand, revisionCommand } from '../commands.mjs';
import { canonical } from './values.mjs';
import {
  ACKNOWLEDGE_WEAKENING,
  EXIT_DONE,
  EXIT_STEPS_REMAIN,
  EXIT_UNRUNNABLE,
  REVISION_DOCUMENT_VERSION,
  WEAKENING_UNACKNOWLEDGED,
} from '../contracts.mjs';
import { exists } from '../paths.mjs';
import { describeGate, failure, nextText } from '../presentation.mjs';
import { locateGateCommand, runGateCommand } from '../../gate-command.mjs';

const REVISION_LIMIT = 'a config revision writes only the Gate configuration section of .agent-framework.yaml, only with the token of the preview that showed the change, and keeps every other byte; it confirms no re-pin — the Gate confirms its own preview with its own token.';

/**
 * The finding a revised configuration raises on an activated clone: the
 * section no longer reproduces what the Activation receipt pinned. The remedy
 * `gate status` names for it is the re-pin a confirmed revision continues
 * into; which subcommand performs it is the Gate's to say (`TB-074`).
 */
const CONFIGURATION_DRIFT = 'control-surface-drift:trusted-configuration';

/**
 * On an activated clone, the Gate's own preview of the re-pin it names for the
 * configuration a confirmed revision just wrote.
 *
 * `gate status` is asked which remedy answers the changed configuration and
 * which subcommand performs it, so this holds no remedy mapping (`TB-074`).
 * The Gate must read the section as exactly the candidate written, and its
 * preview must name that candidate's identity; otherwise no re-pin is offered.
 * The preview is the Gate's own `--json` document, its weakenings, refusal,
 * and token reported as it states them (`SG-CFG-001`); it is acknowledged
 * exactly when the maintainer passed `--acknowledge-weakening`. A weaker
 * candidate the Gate refuses unacknowledged is offered the Gate's own
 * acknowledged preview as the next command, never a token. Nothing is
 * confirmed.
 */
const repinPreview = async ({ projectRoot, gate, environment, observation, policy, acknowledgeWeakening }) => {
  const working = observation.configuration?.working;

  if (working === undefined) {
    const release = observation.release ? `${observation.release.id} ${observation.release.version}` : 'a release it does not name';

    return failure(
      'gate-configuration-unobserved',
      `the revision was written, but \`${[...gate.display, 'status', '--json'].join(' ')}\` reports no configuration section: the installed Gate (${release}, ${gate.detail}) predates it, so the candidate the Gate reads cannot be compared with the one written. Update the Gate module.`,
    );
  }

  if (canonical(working.policy) !== canonical(policy)) {
    return failure(
      'repin-candidate-mismatch',
      `the revision was written, but the Gate reads a different Gate configuration section than the candidate it wrote (${working.reasonCode ?? 'another value'}), so no re-pin preview is offered for it. Run \`agent-framework config show\`.`,
    );
  }

  const remedy = observation.next.remedies.find((entry) => (entry.findings ?? []).includes(CONFIGURATION_DRIFT)) ?? null;

  if (remedy === null || !Array.isArray(remedy.subcommands) || remedy.subcommands.length !== 1) {
    return failure(
      'repin-unnamed',
      `the revision was written, but gate status names no single subcommand that re-pins the changed configuration; it says: ${observation.next.instruction}.`,
    );
  }

  const [subcommand] = remedy.subcommands;
  const previewed = await runGateCommand(gate, {
    cwd: projectRoot,
    args: [subcommand, ...(acknowledgeWeakening ? [ACKNOWLEDGE_WEAKENING] : [])],
    environment,
  });

  if (previewed.failure) {
    return previewed;
  }

  const repin = previewed.document.observation;

  if (repin.candidate?.identity !== working.identity) {
    return failure(
      'repin-candidate-mismatch',
      `the revision was written, but \`${[...gate.display, subcommand, '--json'].join(' ')}\` previews ${repin.candidate?.identity ?? 'no candidate'}, not the written candidate ${working.identity}; nothing was re-pinned.`,
    );
  }

  const prefix = observation.next.shortcut === null ? gate.display : observation.next.shortcut.split(' ');

  return {
    repin: {
      subcommand,
      owner: 'change-evaluation-gate',
      trusted: repin.trusted,
      candidate: repin.candidate,
      transition: repin.transition,
      acknowledgedWeakening: repin.acknowledgedWeakening,
      dependencyRoots: repin.dependencyRoots,
      dependencyProvisioning: repin.dependencyProvisioning,
      refusal: repin.refusal,
      confirmationToken: repin.confirmationToken,
      commands: repinCommands(prefix, subcommand, repin),
    },
  };
};

/**
 * What follows the Gate's re-pin preview: its own confirmation, carrying the
 * acknowledgement its token binds; for a weaker candidate it refused
 * unacknowledged, its own preview again with the acknowledgement; otherwise
 * nothing.
 */
const repinCommands = (prefix, subcommand, repin) => {
  if (repin.confirmationToken !== null) {
    return [gateCommand(
      'confirm',
      prefix,
      subcommand,
      ...(repin.acknowledgedWeakening === true ? [ACKNOWLEDGE_WEAKENING] : []),
      '--confirm',
      repin.confirmationToken,
    )];
  }

  return repin.refusal?.reasonCode === WEAKENING_UNACKNOWLEDGED
    ? [gateCommand('preview', prefix, subcommand, ACKNOWLEDGE_WEAKENING)]
    : [];
};

/**
 * Preview or confirm one revision through `framework-setup`'s own operation,
 * then say what follows: on an activated clone the re-pin preview, else
 * nothing. The operation's refusal is reported as it gives it.
 */
const reviseConfiguration = async ({ projectRoot, environment, revision, confirmation, acknowledgeWeakening }) => {
  let revised;

  try {
    revised = confirmation === null
      ? await previewGateRevision({ projectRoot, revision })
      : await reviseGate({ projectRoot, revision, confirmation });
  } catch (error) {
    return failure(error.reasonCode ?? 'revision-refused', error.message);
  }

  const gate = await locateGateCommand({ environment });
  const done = { gate, revised, state: null, repin: null };

  if (!gate.available) {
    return done;
  }

  const status = await runGateCommand(gate, { cwd: projectRoot, args: ['status'], environment });

  if (status.failure) {
    return { ...done, ...status };
  }

  const { observation } = status.document;

  if (confirmation === null || observation.state !== 'activated') {
    return { ...done, state: observation.state };
  }

  return {
    ...done,
    state: observation.state,
    ...await repinPreview({ projectRoot, gate, environment, observation, policy: revised.policy, acknowledgeWeakening }),
  };
};

/** What comes after a revision: its confirmation, the re-pin's, or nothing. */
const revisionNext = ({ projectRoot, revised, repin, applied, acknowledgeWeakening }) => {
  if (!applied) {
    const confirm = revisionCommand(projectRoot, revised.revision, revised.previewHash, acknowledgeWeakening);

    return { step: 'confirm-revision', command: confirm.run, instruction: 'confirm exactly this preview with its token.' };
  }

  if (repin === null) {
    return null;
  }

  if (repin.confirmationToken !== null) {
    return { step: repin.subcommand, command: repin.commands[0].run, instruction: `confirm the Gate's ${repin.subcommand} preview with its own token.` };
  }

  return repin.commands.length === 0
    ? { step: repin.subcommand, command: null, instruction: repin.refusal?.next ?? repin.refusal?.detail ?? `the Gate offers no token for this ${repin.subcommand}.` }
    : {
      step: repin.subcommand,
      command: repin.commands[0].run,
      instruction: `the Gate offers no token for a candidate weaker than the trusted policy until the weakening is acknowledged: preview its ${repin.subcommand} acknowledged, read the weakenings it names, and confirm that preview with its own token.`,
    };
};

export const runConfigRevision = async ({ projectRoot, environment, revision, confirmation, acknowledgeWeakening }) => {
  const outcome = (await exists(projectRoot))
    ? await reviseConfiguration({ projectRoot, environment, revision, confirmation, acknowledgeWeakening })
    : failure('project-missing', `${projectRoot} does not exist.`);
  const revised = outcome.revised ?? null;
  const applied = revised !== null && confirmation !== null;
  const repin = outcome.repin ?? null;
  const exitStatus = outcome.failure
    ? EXIT_UNRUNNABLE
    : (!applied || repin !== null ? EXIT_STEPS_REMAIN : EXIT_DONE);

  return {
    document: {
      document: REVISION_DOCUMENT_VERSION,
      command: `config ${revision.operation}`,
      ok: !outcome.failure,
      exitStatus,
      project: projectRoot,
      owner: 'framework-setup',
      // A value typed as `NAME=value` is never echoed back (`SG-GUIDE-002`).
      revision: revised?.revision ?? withheldRevision(revision),
      applied,
      acknowledgeWeakening,
      subcontract: revised?.subcontract ?? null,
      changes: revised?.changes ?? [],
      previewHash: revised?.previewHash ?? null,
      state: outcome.state ?? null,
      gate: outcome.gate === undefined ? null : describeGate(outcome.gate),
      repin,
      next: revised === null || outcome.failure ? null : revisionNext({ projectRoot, revised, repin, applied, acknowledgeWeakening }),
      failure: outcome.failure ?? null,
      limit: REVISION_LIMIT,
    },
    render: renderRevision,
  };
};

/** One revision's value and options as a maintainer typed them. */
const describeRevision = (revision) => {
  const definition = gateRevisions[revision.operation];

  return [
    revision.operation,
    revision[definition.argument],
    ...definition.options.flatMap((option) => (revision[option] === undefined ? [] : [`--${option}`, revision[option]])),
  ].filter((part) => part !== undefined).join(' ');
};

/** The re-pin preview, as the Gate states it. */
const renderRepin = (repin) => {
  const weakenings = repin.transition?.weakenings ?? [];
  const provisioning = repin.dependencyProvisioning;
  const lines = [
    `re-pin: the Gate's ${repin.subcommand} preview for the written candidate (${repin.owner})`,
    `  trusted: ${repin.trusted?.identity ?? 'none'}`,
    `  candidate: ${repin.candidate.identity}`,
    ...(repin.acknowledgedWeakening === true ? ['  weakening acknowledged: yes — the token binds the acknowledgement; confirm with it as printed'] : []),
    `  weakenings: ${repin.transition === null ? 'not judged — no trusted policy was recovered' : (weakenings.length === 0 ? 'none' : weakenings.map((weakening) => `${weakening.code} ${weakening.checkId}`).join(', '))}`,
    `  dependency roots: ${(repin.dependencyRoots ?? []).map((root) => `${root} (${typeof provisioning === 'string' ? provisioning : (provisioning?.[root] ?? 'unrecorded')})`).join(', ') || 'none'}`,
  ];

  if (repin.refusal !== null) {
    lines.push(`  refused: ${repin.refusal.reasonCode}${repin.refusal.detail ? ` — ${repin.refusal.detail}` : ''}`);
  }

  if (repin.confirmationToken !== null) {
    lines.push(`  token: ${repin.confirmationToken}`);
  }

  return lines;
};

const renderRevision = (document) => {
  const lines = [
    `agent-framework ${document.command}`,
    `project: ${document.project}`,
    `revision: ${describeRevision(document.revision)} (${document.subcontract ?? 'refused'}, owned by ${document.owner})`,
  ];

  if (document.changes.length > 0) {
    lines.push(document.applied
      ? `applied: .agent-framework.yaml, Gate configuration section — ${document.changes.length} line${document.changes.length === 1 ? '' : 's'} changed; every other byte kept:`
      : `preview: .agent-framework.yaml, Gate configuration section — ${document.changes.length} line${document.changes.length === 1 ? '' : 's'} would change; every other byte is kept:`);

    for (const change of document.changes) {
      lines.push(`  line ${change.line} (${change.subcontract}):`, `- ${change.before}`, `+ ${change.after}`);
    }
  }

  if (document.failure !== null) {
    lines.push(`failed: ${document.failure.reasonCode} — ${document.failure.detail}`, REVISION_LIMIT, '');

    return lines.join('\n');
  }

  if (!document.applied) {
    lines.push(`token: ${document.previewHash}`);
  }

  if (document.gate !== null && !document.gate.available) {
    lines.push(`gate: unavailable — ${document.gate.detail}; no re-pin step can be named.`);
  } else if (document.state === 'activated' && !document.applied) {
    lines.push(`state: activated — confirming continues into the Gate's preview of the re-pin it names for the changed configuration; that preview has its own token, names any weakening of the trusted policy, and offers no token for one until it is acknowledged (${ACKNOWLEDGE_WEAKENING}${document.acknowledgeWeakening ? ', passed through on confirming' : ''}).`);
  } else if (document.state !== null) {
    lines.push(`state: ${document.state}${document.state === 'activated' ? '' : ' — the clone is not activated, so nothing is re-pinned.'}`);
  }

  if (document.repin !== null) {
    lines.push(...renderRepin(document.repin));
  }

  lines.push(
    `next: ${nextText(document.next)}`,
    `run every command from ${document.project}.`,
    REVISION_LIMIT,
    '',
  );

  return lines.join('\n');
};
