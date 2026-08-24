/**
 * The operator surface: the one command a maintainer and an agent both run.
 *
 * Until it existed, every lifecycle operation was proved in isolation and
 * reachable by nothing a person or an agent runs: `statusGate`,
 * `inspectCoordination`, and `previewEvidencePrune` appeared repository-wide
 * only in `tests/`, in three smoke scripts, and in `lifecycle.mjs` itself. An
 * agent asked to diagnose a clone had to import the library and reconstruct its
 * argument shapes from the test suite, producing a different throwaway script
 * every time — and `inspectCoordination` already returned
 * `action: 'gate locks --recover'`, naming a command that did not exist.
 *
 * This module is the surface, not a second implementation of anything behind
 * it. It resolves the same inputs the authoritative runner resolves
 * (`resolveRepositoryRoot`, `resolveConfiguration`, `resolveReceipt`,
 * `openStore`), calls the lifecycle seams unchanged, and renders what they
 * returned. It adds no health grading, no lock judgement, and no selection
 * logic of its own; where it would have to invent one, it reports the seam's
 * own answer instead (`TB-040`).
 *
 * OBSERVATION ONLY. Every operation reachable here writes nothing, and there is
 * no flag, environment variable, or confirmation token that makes one write.
 * The confirmed half of the lifecycle — `--recover`, `--confirm`, `repair`,
 * `update`, `deactivate`, `uninstall`, `cleanup`, `fix`, and activation — is a
 * separate contract; this surface refuses every one of them by name and says
 * which operation owns it (`SG-LIFE-001`, `SG-EVID-001`).
 *
 * TWO READERS, ONE ANSWER. Every invocation builds exactly one observation
 * document and then renders it once: as `--json` for an agent, or as a summary
 * for a person. The two renderings cannot disagree, because there is only one
 * thing to disagree about (`NFR-OPER-001`).
 *
 * It is not interactive, has no prompt, no spinner, and no colour: a prompt is
 * exactly what would lock an agent out of a surface both callers must reach.
 */

import { describeAdapter } from './adapters.mjs';
import { openEvidenceStore } from './evidence-store.mjs';
import {
  openStore,
  resolveConfiguration,
  resolveReceipt,
  resolveRepositoryRoot,
} from './hook-runner.mjs';
import { inspectCoordination, previewEvidencePrune, statusGate } from './lifecycle.mjs';
import { TRUST_BOUNDARY } from './security-control.mjs';

/** The document an agent parses. Versioned, so a later field is an addition rather than a surprise. */
export const DOCUMENT_VERSION = 'change-evaluation-gate/observation/1';

/**
 * The three exit statuses, in the `diff`/`grep` shape a shell and an agent
 * already know: `0` nothing wrong, `1` a real answer that is not good news,
 * `2` the command could not run at all.
 *
 * A clone that is `broken` is NOT a failed invocation. Conflating the two would
 * make every agent parse prose to recover the difference, which is the whole
 * reason this surface states it in the exit status.
 */
export const EXIT_OBSERVED = 0;

export const EXIT_UNHEALTHY = 1;

export const EXIT_UNRUNNABLE = 2;

/** Everything this surface performs. All three write nothing. */
export const OBSERVATIONS = Object.freeze(['status', 'locks', 'prune']);

/**
 * Every mutating selector this surface knows of, and the confirmed operation
 * that owns it.
 *
 * Stated as data so the refusal names a real operation rather than a guess, and
 * so a later slice that implements one of them extends this table instead of
 * adding a second parser beside it.
 */
export const CONFIRMED_SELECTORS = Object.freeze({
  '--recover': 'gate locks --recover',
  '--confirm': 'gate prune --confirm',
  '--confirmation': 'gate prune --confirm',
  '--token': 'gate prune --confirm',
  '--repair': 'gate repair',
  '--fix': 'gate fix',
});

/** Every lifecycle operation that mutates, named so a refusal can point at it. */
export const CONFIRMED_COMMANDS = Object.freeze({
  activate: 'gate activate',
  repair: 'gate repair',
  update: 'gate update',
  deactivate: 'gate deactivate',
  uninstall: 'gate uninstall',
  cleanup: 'gate cleanup',
  fix: 'gate fix',
});

/**
 * Flags that no operation on this surface owns, because nothing here can be
 * forced or confirmed. They are refused rather than ignored: a `--force` that
 * is silently accepted teaches a caller that forcing is available.
 */
const UNOWNED_MUTATION_FLAGS = Object.freeze(['--force', '-f', '--yes', '-y', '--no-confirm']);

/** The confirmed operation a bare confirmation token would belong to, per command. */
const TOKEN_OWNER = Object.freeze({
  status: 'gate repair',
  locks: 'gate locks --recover',
  prune: 'gate prune --confirm',
});

/** A confirmation token, in the one shape every preview in this skill produces. */
const CONFIRMATION_TOKEN = /^sha256:[0-9a-f]{64}$/;

/** The selectors each observation accepts, and how many values each takes. */
const SELECTORS = Object.freeze({
  status: Object.freeze({}),
  locks: Object.freeze({}),
  prune: Object.freeze({
    '--evaluation': 'repeatable',
    '--before': 'value',
    '--reclaim': 'value',
  }),
});

export const USAGE = [
  'gate — observe an activated Change Evaluation Gate clone.',
  '',
  'Usage:',
  '  gate status [--json]              Report this clone\'s health.',
  '  gate locks  [--json]              Inspect the coordination lock.',
  '  gate prune  [selector] [--json]   Preview what a prune would remove.',
  '',
  'Prune selectors:',
  '  --evaluation <evaluation-id>      Restrict to one evaluation; repeatable.',
  '  --before <iso-8601-instant>       Restrict to evidence appended before an instant.',
  '  --reclaim <bytes>                 Stop once this many bytes are selected.',
  '',
  'Exit status:',
  '  0  the command ran and found nothing wrong',
  '  1  the command ran and the clone needs attention (degraded, broken, or a stale lock)',
  '  2  the command could not run',
  '',
  'This surface observes only. It never repairs, removes, activates, or writes,',
  'and it accepts no confirmation token. The confirmed lifecycle operations',
  `(${Object.values(CONFIRMED_COMMANDS).join(', ')}, gate locks --recover,`,
  'gate prune --confirm) are a separate contract and are refused here by name.',
  '',
  TRUST_BOUNDARY.statement,
  '',
].join('\n');

const failure = ({ command = null, reasonCode, detail, ownedBy = null }) => ({
  command,
  failure: { reasonCode, detail, ownedBy },
});

/**
 * Read one invocation's argument vector.
 *
 * `--json` is recognized the way every other capability in this skill already
 * recognizes it — a plain membership test on the argument vector — so the
 * surface applies the repository's own convention rather than importing or
 * inventing a different one, and adds no dependency to parse three flags.
 */
const parseArguments = (argv) => {
  const json = argv.includes('--json');
  const rest = argv.filter((argument) => argument !== '--json');

  if (rest.includes('--help') || rest.includes('-h')) {
    return { json, help: true };
  }

  const [command, ...selectors] = rest;

  if (command === undefined) {
    return {
      json,
      ...failure({
        reasonCode: 'no-command',
        detail: `no command was given; this surface performs ${OBSERVATIONS.join(', ')}.`,
      }),
    };
  }

  if (command in CONFIRMED_COMMANDS) {
    return {
      json,
      ...failure({
        command,
        reasonCode: 'mutation-refused',
        ownedBy: CONFIRMED_COMMANDS[command],
        detail: `${JSON.stringify(command)} belongs to \`${CONFIRMED_COMMANDS[command]}\`, a confirmed lifecycle operation; this surface observes and never mutates.`,
      }),
    };
  }

  if (!OBSERVATIONS.includes(command)) {
    return {
      json,
      ...failure({
        command,
        reasonCode: 'unknown-command',
        detail: `${JSON.stringify(command)} is not a command; this surface performs ${OBSERVATIONS.join(', ')}.`,
      }),
    };
  }

  const accepted = SELECTORS[command];
  const selector = { evaluationIds: null, appendedBefore: null, reclaimBytes: null };

  for (let index = 0; index < selectors.length; index += 1) {
    const argument = selectors[index];

    if (argument in CONFIRMED_SELECTORS) {
      return {
        json,
        ...failure({
          command,
          reasonCode: 'mutation-refused',
          ownedBy: CONFIRMED_SELECTORS[argument],
          detail: `${argument} belongs to \`${CONFIRMED_SELECTORS[argument]}\`, a confirmed lifecycle operation; this surface observes and never mutates.`,
        }),
      };
    }

    if (UNOWNED_MUTATION_FLAGS.includes(argument)) {
      return {
        json,
        ...failure({
          command,
          reasonCode: 'mutation-refused',
          detail: `${argument} belongs to no operation here: nothing this surface does can be forced or confirmed, because nothing it does changes anything.`,
        }),
      };
    }

    if (!argument.startsWith('-')) {
      const owner = TOKEN_OWNER[command];

      return {
        json,
        ...failure({
          command,
          reasonCode: 'mutation-refused',
          ownedBy: owner,
          detail: CONFIRMATION_TOKEN.test(argument)
            ? `a confirmation token belongs to \`${owner}\`, a confirmed lifecycle operation; \`gate ${command}\` returns a token and never accepts one.`
            : `\`gate ${command}\` takes no positional argument, and ${JSON.stringify(argument)} is not one it could act on; a confirmation token belongs to \`${owner}\`.`,
        }),
      };
    }

    if (!(argument in accepted)) {
      return {
        json,
        ...failure({
          command,
          reasonCode: 'unknown-selector',
          detail: `\`gate ${command}\` does not take ${argument}.`,
        }),
      };
    }

    const value = selectors[index + 1];

    index += 1;

    if (typeof value !== 'string' || value.startsWith('-')) {
      return {
        json,
        ...failure({
          command,
          reasonCode: 'selector-incomplete',
          detail: `${argument} needs a value.`,
        }),
      };
    }

    if (argument === '--evaluation') {
      selector.evaluationIds = [...(selector.evaluationIds ?? []), value];
    }

    if (argument === '--before') {
      if (!Number.isFinite(Date.parse(value))) {
        return {
          json,
          ...failure({
            command,
            reasonCode: 'selector-invalid',
            detail: `--before needs an ISO-8601 instant; ${JSON.stringify(value)} is not one.`,
          }),
        };
      }

      selector.appendedBefore = value;
    }

    if (argument === '--reclaim') {
      const bytes = Number(value);

      if (!Number.isInteger(bytes) || bytes < 0) {
        return {
          json,
          ...failure({
            command,
            reasonCode: 'selector-invalid',
            detail: `--reclaim needs a whole number of bytes; ${JSON.stringify(value)} is not one.`,
          }),
        };
      }

      selector.reclaimBytes = bytes;
    }
  }

  return { json, command, selector };
};

/**
 * The adapters this INSTALLED gate still declares, under the ids the Activation
 * receipt pinned.
 *
 * An adapter the receipt names and the gate no longer declares is not observed
 * at all, which is exactly the loss `statusGate` already grades by the
 * authority the receipt recorded. Nothing here decides what that loss means —
 * `RISK-004` is graded in one place, and this is not it.
 */
const observedAdapters = (receipt) => (receipt?.adapters ?? [])
  .map((adapter) => ({ adapter, declared: describeAdapter(adapter?.id ?? null) }))
  .filter(({ declared }) => declared !== null)
  .map(({ adapter, declared }) => ({
    id: adapter.id,
    version: declared.version,
    authoritative: declared.role === 'authoritative',
  }));

/**
 * Open the clone-local Evidence store, through the same helper the
 * authoritative and preflight runners open it with.
 *
 * The evidence policy bounds what an APPEND may cost, and nothing here appends,
 * so a configuration this clone cannot read is not a reason to refuse to
 * observe it: the store opens with no ceilings and the observation continues.
 */
const openClonedStore = async ({ repositoryRoot, activation, environment }) => {
  const configuration = await resolveConfiguration(repositoryRoot);

  return openStore({
    repository: { root: repositoryRoot },
    activation,
    configuration: configuration.ok ? configuration : { policy: null },
    environment,
    openStoreSeam: openEvidenceStore,
  });
};

/**
 * `gate status` — reconcile desired against actual state and report it.
 *
 * A clone with no receipt has nothing to open and nothing to reconcile, so no
 * store is opened for it: observing a clone that has no Evidence store must not
 * be the thing that gives it one. `statusGate` already answers that case from a
 * null store, and it is the one that answers it here.
 */
const observeStatus = async ({ repositoryRoot, environment }) => {
  const activation = await resolveReceipt(repositoryRoot);

  if (!activation.ok && activation.reasonCode !== 'activation-receipt-missing') {
    return failure({
      command: 'status',
      reasonCode: activation.reasonCode,
      detail: activation.detail,
    });
  }

  let evidenceStore = null;

  if (activation.ok) {
    const store = await openClonedStore({ repositoryRoot, activation, environment });

    if (!store.ok) {
      return failure({ command: 'status', reasonCode: store.reasonCode, detail: store.detail });
    }

    evidenceStore = store.store;
  }

  const status = await statusGate({
    evidenceStore,
    repositoryRoot,
    adapters: activation.ok ? observedAdapters(activation.receipt) : null,
  });

  return {
    command: 'status',
    healthy: status.status === 'healthy',
    observation: {
      state: status.state,
      health: status.status,
      release: status.release,
      receiptId: status.receipt?.receiptId ?? null,
      repaired: status.repaired,
      mutations: status.mutations,
      findings: status.findings,
    },
  };
};

/** `gate locks` — inspect the coordination lock, acquiring and recovering nothing. */
const observeLocks = async ({ repositoryRoot }) => {
  const inspection = await inspectCoordination({ repositoryRoot });

  return {
    command: 'locks',
    // A lock nobody is holding and a lock somebody is really holding are both
    // fine. Only a stale one is a clone that needs an operator.
    healthy: !(inspection.held && inspection.stale),
    observation: { ...inspection },
  };
};

/** `gate prune` — preview exactly what a prune would remove, and remove nothing. */
const observePrune = async ({ repositoryRoot, environment, selector }) => {
  const activation = await resolveReceipt(repositoryRoot);

  if (!activation.ok) {
    return failure({
      command: 'prune',
      reasonCode: activation.reasonCode,
      detail: activation.detail,
    });
  }

  const store = await openClonedStore({ repositoryRoot, activation, environment });

  if (!store.ok) {
    return failure({ command: 'prune', reasonCode: store.reasonCode, detail: store.detail });
  }

  const preview = await previewEvidencePrune({ evidenceStore: store.store, selector });

  return {
    command: 'prune',
    // A preview is never bad news. What it names may be a lot of evidence, and
    // that is information, not a fault.
    healthy: true,
    observation: { ...preview },
  };
};

const OPERATIONS = Object.freeze({
  status: observeStatus,
  locks: observeLocks,
  prune: observePrune,
});

/** The envelope every rendering is made from, whether the command ran or not. */
const documentOf = ({ command, repositoryRoot, result }) => {
  const failed = result.failure !== undefined;
  const exitStatus = failed
    ? EXIT_UNRUNNABLE
    : (result.healthy ? EXIT_OBSERVED : EXIT_UNHEALTHY);

  return {
    document: DOCUMENT_VERSION,
    gate: 'change-evaluation-gate',
    command: result.command ?? command ?? null,
    ok: !failed && result.healthy === true,
    exitStatus,
    repository: { root: repositoryRoot },
    observation: failed ? null : result.observation,
    failure: failed ? result.failure : null,
    // Stated on every document, in the words the skill states it in once
    // (`SG-TRUST-001`): this reports what a cooperative local process can see
    // about itself, and it resists nobody.
    trustBoundary: TRUST_BOUNDARY,
  };
};

const line = (label, value) => `${label}: ${value}`;

const renderFindings = (findings) => (findings ?? []).map((finding) => [
  `  - ${finding.code} [${finding.severity}] ${finding.area}`,
  ...(finding.adapter === undefined ? [] : [`    adapter: ${finding.adapter}`]),
  ...(finding.path === undefined ? [] : [`    path: ${finding.path}`]),
  ...(finding.surface === undefined ? [] : [`    surface: ${finding.surface}`]),
  `    ${finding.detail}`,
].join('\n'));

const renderStatus = (observation) => [
  line('state', observation.state),
  line('health', observation.health),
  line(
    'release',
    observation.release === null
      ? 'none'
      : `${observation.release.id} ${observation.release.version} (protocol ${observation.release.protocolVersion})`,
  ),
  line('receipt', observation.receiptId ?? 'none'),
  line('findings', observation.findings.length),
  ...renderFindings(observation.findings),
  line('repaired', observation.repaired),
  line('mutations', observation.mutations.length),
];

const renderLocks = (observation) => [
  line('lock', observation.lockPath),
  line('held', observation.held),
  line('liveness', observation.liveness),
  line('stale', `${observation.stale}${observation.staleReasons.length === 0 ? '' : ` (${observation.staleReasons.join(', ')})`}`),
  line(
    'holder',
    observation.holder === null
      ? 'none'
      : `pid ${observation.holder.pid ?? 'unknown'} on ${observation.holder.host ?? 'unknown'}, heartbeat ${observation.holder.heartbeatAt ?? 'unknown'}`,
  ),
  line('recovery token', observation.recoveryToken ?? 'none'),
  line('acquired', observation.acquired),
  line('recovered', observation.recovered),
  line(
    'next',
    observation.action === null
      ? 'nothing to do'
      : `\`${observation.action}\` is a confirmed lifecycle operation; this surface does not perform it`,
  ),
];

const renderPrune = (observation) => [
  line('previewed', observation.previewedAt),
  line(
    'selector',
    `evaluations=${observation.selector.evaluationIds === null ? 'all' : observation.selector.evaluationIds.join(',')}`
    + ` before=${observation.selector.appendedBefore ?? 'any'}`
    + ` reclaim=${observation.selector.reclaimBytes ?? 'all'}`,
  ),
  line('blobs', observation.blobs.length),
  ...observation.blobs.map(
    (blob) => `  - ${blob.blobId} ${blob.bytes} bytes appended ${blob.appendedAt}`,
  ),
  line('bytes', observation.totalBytes),
  line('confirmation token', observation.confirmationToken),
  line('removed', observation.removed),
  line(
    'next',
    observation.action === null
      ? 'nothing to remove'
      : `\`${observation.action}\` is a confirmed lifecycle operation; this surface does not perform it`,
  ),
];

const RENDERERS = Object.freeze({
  status: renderStatus,
  locks: renderLocks,
  prune: renderPrune,
});

/**
 * Render the one document a person reads.
 *
 * This is the SAME document `--json` prints, rendered rather than recomputed,
 * so an agent and a maintainer can never observe different things from the same
 * invocation (`NFR-OPER-001`).
 */
export const renderDocument = (document) => [
  `gate ${document.command}`,
  line('repository', document.repository.root ?? 'unresolved'),
  ...RENDERERS[document.command](document.observation),
  'observation: nothing was written, nothing was repaired, and nothing was removed.',
  document.trustBoundary.statement,
  '',
].join('\n');

/**
 * Run one operator invocation and return what the caller should print and exit
 * with.
 *
 * The entry point does the writing; everything decided here is returned, so the
 * whole surface is provable in-process against a real activated clone.
 */
export const runOperatorCommand = async ({
  cwd = process.cwd(),
  argv = [],
  environment = process.env,
} = {}) => {
  const parsed = parseArguments(argv);

  if (parsed.help === true) {
    return { exitCode: EXIT_OBSERVED, stdout: USAGE, stderr: '', document: null };
  }

  const answer = (document) => (document.failure === null
    ? {
      exitCode: document.exitStatus,
      stdout: parsed.json ? `${JSON.stringify(document, null, 2)}\n` : renderDocument(document),
      stderr: '',
      document,
    }
    : {
      exitCode: document.exitStatus,
      stdout: parsed.json ? `${JSON.stringify(document, null, 2)}\n` : '',
      // A failed invocation says why where a person expects to read it, and
      // says it in one line beginning with the program's own name, exactly as
      // the packaged commit and preflight runners already do.
      stderr: `change-evaluation-gate: ${document.failure.detail}\n`,
      document,
    });

  if (parsed.failure !== undefined) {
    return answer(documentOf({
      command: parsed.command ?? null,
      repositoryRoot: null,
      result: parsed,
    }));
  }

  const repository = await resolveRepositoryRoot(cwd);

  if (!repository.ok) {
    return answer(documentOf({
      command: parsed.command,
      repositoryRoot: null,
      result: failure({
        command: parsed.command,
        reasonCode: repository.reasonCode,
        detail: repository.detail,
      }),
    }));
  }

  const result = await OPERATIONS[parsed.command]({
    repositoryRoot: repository.root,
    environment,
    selector: parsed.selector,
  });

  return answer(documentOf({
    command: parsed.command,
    repositoryRoot: repository.root,
    result,
  }));
};
