/**
 * The operator surface: the one command a maintainer and an agent both run.
 *
 * Until it existed, every lifecycle operation was proved in isolation and
 * reachable by nothing a person or an agent runs. `TB-040` made the read-only
 * half reachable; `TB-041` added the half that writes — `repair`, `update`,
 * `deactivate`, `uninstall`, `cleanup`, `prune --confirm`, and
 * `locks --recover` — which until then existed only in `tests/` and in three
 * smoke scripts, so the only recovery available to an operator whose managed
 * hook block had been clobbered was to re-activate. `TB-042` added the
 * operation that had no entrypoint at all: `activate`, which until then was
 * reachable only by writing a throwaway script that imported `activation.mjs`
 * and reconstructed its argument shapes from the test suite.
 *
 * This module is the surface, not a second implementation of anything behind
 * it. It resolves the same inputs the authoritative runner resolves
 * (`resolveRepositoryRoot`, `resolveConfiguration`, `resolveReceipt`,
 * `openStore`), calls the lifecycle seams unchanged, and renders what they
 * returned. It adds no health grading, no lock judgement, no removal rule, and
 * no selection logic of its own; where it would have to invent one, it reports
 * the seam's own answer instead.
 *
 * TWO INVOCATIONS, NEVER ONE. Every command previews by default and performs
 * only when a separate later invocation names the token of a preview that still
 * describes this clone. There is no flag that previews and confirms in one run,
 * and `--confirm` without a token is refused by name rather than helpfully
 * resolved: a single call that did both would put the decision inside this
 * process instead of with the operator, which is the property every one of
 * these operations was designed around. It does not stop a determined caller
 * from running both commands back to back, and it is not meant to — it means no
 * single command destroys anything.
 *
 * THE PREVIEW IS RE-DERIVED, NEVER CARRIED. Every invocation — preview and
 * confirmation alike — rebuilds the preview from the filesystem as it is right
 * now, and the operator's token is checked against THAT. Nothing the caller
 * holds decides what happens, which is `TB-036`'s rule applied at the command
 * boundary: a confirmation naming a preview this clone no longer matches writes
 * nothing and says so (`NFR-REL-002`).
 *
 * WHAT REFUSES IS WHAT RECORDS. Where a lifecycle seam takes the confirmation
 * itself (`confirmRepair`, `updateGate`, `confirmConfigurationCleanup`,
 * `confirmEvidencePrune`, `recoverStale`), the token is handed straight to it
 * and the seam does the refusing and appends its own Lifecycle event. Only
 * `deactivateGate` and `uninstallGate` take no confirmation, so the surface
 * compares the token for those two and records the refusal through the one
 * helper below — the same event type their own `record` would have appended, in
 * the same store, through the same seam (`NFR-AUD-001`).
 *
 * TWO READERS, ONE ANSWER. Every invocation builds exactly one document and
 * then renders it once: as `--json` for an agent, or as a summary for a person.
 * The two cannot disagree, because there is only one thing to disagree about
 * (`NFR-OPER-001`).
 *
 * It is not interactive, has no prompt, no spinner, and no colour: a prompt is
 * exactly what would lock an agent out of a surface both callers must reach.
 * And it claims nothing it does not have — exposing these operations to an
 * agent changes nothing about a boundary that was already cooperative, and the
 * surface states that rather than implying enforcement it never had
 * (`SG-TRUST-001`).
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  activate,
  adapterIdentity,
  previewActivation,
  readHookRegistration,
} from './activation.mjs';
import {
  COMMAND_ALIAS_NAME,
  SELF_DECLARED,
  createTrustEstablishment,
  registerCommandAlias,
  selfTestAdapterSurface,
  selfTestEvaluationDenial,
} from './activation-seams.mjs';
import { describeAdapter } from './adapters.mjs';
import { gateChecksFromConfiguration } from './configuration.mjs';
import { openCoordinationLock } from './coordination.mjs';
import { PROTOCOL_VERSION } from './evaluation-contract.mjs';
import {
  contentIdentity,
  openEvidenceStore,
  resolveGitCommonDirectory,
} from './evidence-store.mjs';
import {
  openStore,
  resolveConfiguration,
  resolveReceipt,
  resolveRepositoryRoot,
} from './hook-runner.mjs';
import {
  SHARED_CONFIGURATION_FILE,
  confirmConfigurationCleanup,
  confirmEvidencePrune,
  confirmRepair,
  deactivateGate,
  inspectCoordination,
  inspectRelease,
  previewConfigurationCleanup,
  previewEvidencePrune,
  previewRepair,
  previewUpdate,
  statusGate,
  uninstallGate,
  updateGate,
} from './lifecycle.mjs';
import { TRUST_BOUNDARY } from './security-control.mjs';

/** The document an agent parses. Versioned, so a later field is an addition rather than a surprise. */
export const DOCUMENT_VERSION = 'change-evaluation-gate/observation/1';

/**
 * The three exit statuses, in the `diff`/`grep` shape a shell and an agent
 * already know: `0` nothing wrong, `1` a real answer that is not good news,
 * `2` the command could not run at all.
 *
 * A clone that is `broken`, and a confirmation this clone refused, are NOT
 * failed invocations. Conflating the two would make every agent parse prose to
 * recover the difference, which is the whole reason this surface states it in
 * the exit status.
 */
export const EXIT_OBSERVED = 0;

export const EXIT_UNHEALTHY = 1;

export const EXIT_UNRUNNABLE = 2;

/** Every command this surface performs. All of them preview by default. */
export const COMMANDS = Object.freeze([
  'activate',
  'status',
  'locks',
  'prune',
  'repair',
  'update',
  'deactivate',
  'uninstall',
  'cleanup',
]);

/**
 * The selector each command's confirmation arrives on.
 *
 * `locks` uses `--recover` and `prune` uses `--confirm` because those are the
 * two spellings the seams themselves already publish as their `action`
 * (`inspectCoordination` returns `gate locks --recover`; `previewEvidencePrune`
 * returns `gate prune --confirm`). Naming them anything else here would make the
 * command a clone reports differ from the command it accepts.
 *
 * `status` is absent deliberately: reconciliation has nothing to confirm, and
 * it is the one command that must still record nothing at all.
 */
export const CONFIRMABLE_COMMANDS = Object.freeze({
  activate: '--confirm',
  locks: '--recover',
  prune: '--confirm',
  repair: '--confirm',
  update: '--confirm',
  deactivate: '--confirm',
  uninstall: '--confirm',
  cleanup: '--confirm',
});

/**
 * Every mutating selector this surface still refuses, and the operation that
 * owns it.
 *
 * `TB-040` stated these as data precisely so a later slice could move entries
 * OUT of them as it implemented each one, rather than growing a second parser
 * beside them. `TB-041` moved `--recover`, `--confirm`, `--confirmation`, and
 * `--token` out; what is left belongs to `gate repair` — which is now its own
 * command rather than a selector of somebody else's — and to `gate fix`, whose
 * risk profile is a different contract's.
 */
export const CONFIRMED_SELECTORS = Object.freeze({
  '--repair': 'gate repair',
  '--fix': 'gate fix',
});

/**
 * Every lifecycle operation that mutates and that this surface does NOT
 * perform, named so a refusal can point at it.
 *
 * `TB-042` moved `activate` OUT of this table and into the command registry,
 * once the three behaviors `runActivation` left abstract had real
 * implementations and the trust question was settled by dispatching on the
 * model each adapter already declares. What is left is `gate fix`, which mutates
 * a maintainer's working tree — a different risk profile, and its own contract.
 */
export const CONFIRMED_COMMANDS = Object.freeze({
  fix: 'gate fix',
});

/**
 * Flags that no operation on this surface owns, because nothing here can be
 * forced. They are refused rather than ignored: a `--force` that is silently
 * accepted teaches a caller that forcing is available, and no token on this
 * surface may be bypassed by any of them.
 */
const UNOWNED_MUTATION_FLAGS = Object.freeze(['--force', '-f', '--yes', '-y', '--no-confirm']);

/** A confirmation token, in the one shape every preview in this skill produces. */
const CONFIRMATION_TOKEN = /^sha256:[0-9a-f]{64}$/;

/** The selectors each command accepts, and how each one is read. */
const SELECTORS = Object.freeze({
  activate: Object.freeze({
    '--client': 'value',
    '--actor': 'value',
    '--resume': 'value',
    '--confirm': 'confirmation',
  }),
  status: Object.freeze({}),
  locks: Object.freeze({ '--recover': 'confirmation' }),
  prune: Object.freeze({
    '--evaluation': 'repeatable',
    '--before': 'value',
    '--reclaim': 'value',
    '--confirm': 'confirmation',
  }),
  repair: Object.freeze({ '--hook-script': 'value', '--confirm': 'confirmation' }),
  update: Object.freeze({ '--confirm': 'confirmation' }),
  deactivate: Object.freeze({ '--confirm': 'confirmation' }),
  uninstall: Object.freeze({ '--asset': 'repeatable', '--confirm': 'confirmation' }),
  cleanup: Object.freeze({ '--confirm': 'confirmation' }),
});

/** What every removal path on this surface preserves, in the seams' own words. */
const DEACTIVATION_PRESERVES = Object.freeze([
  'shared-configuration',
  'project-installed-assets',
  'global-assets',
  'historical-evidence',
]);

const UNINSTALL_PRESERVES = Object.freeze([
  'shared-configuration',
  'global-assets',
  'historical-evidence',
]);

/** This module's own directory — the installed gate is what runs it. */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The hook program an activation performed by THIS installed gate would have
 * registered.
 *
 * The Activation receipt pins the registration's durable identity but not the
 * program that produced it, so a repair has to state one. This is the honest
 * default: the packaged pre-commit runner sitting beside this module. A clone
 * activated against some other program is not repaired by guessing — the
 * planned bytes will not reproduce the pinned identity and
 * `restoreHookRegistration` refuses with `registration-not-reproducible`, which
 * is why `--hook-script` exists to name the real one rather than to override a
 * refusal.
 */
export const PACKAGED_HOOK_PROGRAM = path.resolve(HERE, '..', 'gate-precommit.mjs');

/**
 * This command itself, as an activated clone's shortcut has to name it.
 *
 * The alias points at the installed distribution that performed the activation,
 * which is the same distribution that registered the hook program beside it.
 */
export const PACKAGED_COMMAND = path.resolve(HERE, '..', 'gate.mjs');

/** The gate this surface speaks for; one name, stated once. */
const GATE_ID = 'change-evaluation-gate';

export const USAGE = [
  'gate — activate, observe, and operate a Change Evaluation Gate clone.',
  '',
  'Usage:',
  '  gate activate   [--client <id>]          Preview activating this configured clone.',
  '  gate status     [--json]                 Report this clone\'s health.',
  '  gate locks      [--json]                 Inspect the coordination lock.',
  '  gate prune      [selector] [--json]      Preview what a prune would remove.',
  '  gate repair     [--hook-script <path>]   Preview restoring drifted gate-owned registrations.',
  '  gate update     [--json]                 Preview taking the installed distribution\'s release.',
  '  gate deactivate [--json]                 Preview withdrawing this activation.',
  '  gate uninstall  --asset <path> ...       Preview removing unchanged project-installed assets.',
  '  gate cleanup    [--json]                 Preview removing the Gate\'s own configuration keys.',
  '',
  'Every command above previews. To perform one, run it again with the token',
  'the preview printed:',
  '',
  '  gate locks --recover <token>             Recover one stale lock.',
  '  gate prune --confirm <token>             Remove exactly the previewed blobs.',
  '  gate <command> --confirm <token>         Perform exactly the previewed operation.',
  '',
  'Activate selectors:',
  '  --client <adapter-id>             The client being activated; default git.',
  '  --actor <name>                    A name to carry, recorded as self-declared only.',
  '  --resume <transaction-id>         Resume the paused transaction of that identity.',
  '',
  'Prune selectors:',
  '  --evaluation <evaluation-id>      Restrict to one evaluation; repeatable.',
  '  --before <iso-8601-instant>       Restrict to evidence appended before an instant.',
  '  --reclaim <bytes>                 Stop once this many bytes are selected.',
  '',
  'Uninstall selectors:',
  '  --asset <path>                    A project-installed asset to remove; repeatable.',
  '',
  'Exit status:',
  '  0  the command ran and found nothing wrong, or performed what was confirmed',
  '  1  the command ran and the clone needs attention (degraded, broken, a stale',
  '     lock, or a confirmation this clone refused)',
  '  2  the command could not run',
  '',
  'A preview writes nothing. A confirmation performs exactly the operation whose',
  'token it names, or nothing at all — never half of one — and is recorded as a',
  'Lifecycle event either way. There is no flag that previews and confirms in one',
  `invocation, and no --yes, --force, or bypass of any token. ${Object.values(CONFIRMED_COMMANDS).join(' and ')} is a`,
  'separate contract and is refused here by name.',
  '',
  'An activation records only what it can prove: that a confirmation reproducing',
  'this exact preview arrived in a separate invocation. Who ran it is not',
  `something this command can observe, so any --actor is recorded as ${SELF_DECLARED}`,
  'and never as proven.',
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
 * inventing a different one, and adds no dependency to parse its flags.
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
        detail: `no command was given; this surface performs ${COMMANDS.join(', ')}.`,
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
        detail: `${JSON.stringify(command)} belongs to \`${CONFIRMED_COMMANDS[command]}\`, a lifecycle operation a separate contract owns; this surface does not perform it.`,
      }),
    };
  }

  if (!COMMANDS.includes(command)) {
    return {
      json,
      ...failure({
        command,
        reasonCode: 'unknown-command',
        detail: `${JSON.stringify(command)} is not a command; this surface performs ${COMMANDS.join(', ')}.`,
      }),
    };
  }

  const accepted = SELECTORS[command];
  const confirmationSelector = CONFIRMABLE_COMMANDS[command] ?? null;
  const selector = {
    evaluationIds: null,
    appendedBefore: null,
    reclaimBytes: null,
    assets: null,
    hookScript: null,
    client: null,
    actor: null,
    resume: null,
  };
  let confirmation = null;
  let previewRequested = false;

  /** The one refusal that keeps preview and confirmation two separate runs. */
  const refusePreviewAndConfirm = (detail) => failure({
    command,
    reasonCode: 'preview-and-confirm-refused',
    ownedBy: `gate ${command} ${confirmationSelector ?? '--confirm'} <token>`,
    detail,
  });

  for (let index = 0; index < selectors.length; index += 1) {
    const argument = selectors[index];

    if (argument === '--preview') {
      // Accepted as an explicit spelling of the default, and stated here so
      // that pairing it with a confirmation is refusable rather than silently
      // resolved one way or the other.
      previewRequested = true;

      continue;
    }

    if (argument in CONFIRMED_SELECTORS) {
      return {
        json,
        ...failure({
          command,
          reasonCode: 'mutation-refused',
          ownedBy: CONFIRMED_SELECTORS[argument],
          detail: `${argument} belongs to \`${CONFIRMED_SELECTORS[argument]}\`, which is its own operation; \`gate ${command}\` never performs another command's work as a side effect.`,
        }),
      };
    }

    if (UNOWNED_MUTATION_FLAGS.includes(argument)) {
      return {
        json,
        ...failure({
          command,
          reasonCode: 'mutation-refused',
          detail: `${argument} belongs to no operation here: every write on this surface happens only against the token of a preview that still describes this clone, and nothing bypasses that token.`,
        }),
      };
    }

    if (!argument.startsWith('-')) {
      return {
        json,
        ...failure({
          command,
          reasonCode: 'unknown-selector',
          ownedBy: confirmationSelector === null
            ? null
            : `gate ${command} ${confirmationSelector} <token>`,
          detail: confirmationSelector === null
            ? `\`gate ${command}\` takes no positional argument, and ${JSON.stringify(argument)} is not one it could act on.`
            : `\`gate ${command}\` takes no positional argument; a confirmation names the selector it confirms, as \`gate ${command} ${confirmationSelector} <token>\`, so a stray argument can never be spent as one.`,
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
      if (accepted[argument] === 'confirmation') {
        // The whole point, stated where a caller meets it: a bare `--confirm`
        // could only mean "preview and then obey your own preview", which is
        // the one thing this surface will not do.
        return {
          json,
          ...refusePreviewAndConfirm(`${argument} must name the token of a preview you have already read, as \`gate ${command} ${argument} <token>\`; \`gate ${command}\` never previews and confirms in one invocation, because that would put the decision inside this process rather than with you.`),
        };
      }

      return {
        json,
        ...failure({
          command,
          reasonCode: 'selector-incomplete',
          detail: `${argument} needs a value.`,
        }),
      };
    }

    if (accepted[argument] === 'confirmation') {
      if (!CONFIRMATION_TOKEN.test(value)) {
        return {
          json,
          ...failure({
            command,
            reasonCode: 'selector-invalid',
            detail: `${argument} needs the confirmation token a preview printed; ${JSON.stringify(value)} is not one.`,
          }),
        };
      }

      confirmation = value;
    }

    if (argument === '--evaluation') {
      selector.evaluationIds = [...(selector.evaluationIds ?? []), value];
    }

    if (argument === '--asset') {
      selector.assets = [...(selector.assets ?? []), value];
    }

    if (argument === '--hook-script') {
      selector.hookScript = value;
    }

    if (argument === '--client') {
      // Named, never guessed: which client is being activated decides which
      // trust model has to be satisfied, and this surface resolves that from
      // the adapter's own declaration rather than from a default that would
      // quietly pick the easiest one.
      selector.client = value;
    }

    if (argument === '--actor') {
      selector.actor = value;
    }

    if (argument === '--resume') {
      if (!CONFIRMATION_TOKEN.test(value)) {
        return {
          json,
          ...failure({
            command,
            reasonCode: 'selector-invalid',
            detail: `--resume needs the transaction identity a paused activation reported; ${JSON.stringify(value)} is not one.`,
          }),
        };
      }

      selector.resume = value;
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

  if (previewRequested && confirmation !== null) {
    return {
      json,
      ...refusePreviewAndConfirm(`--preview and ${confirmationSelector} cannot be given to one invocation: preview and confirmation are two separate runs of this command, so that what you confirm is something you have already read. Run \`gate ${command}\`, read it, then run \`gate ${command} ${confirmationSelector} <token>\`.`),
    };
  }

  return { json, command, selector, confirmation };
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
 * Resolve this clone's Activation receipt and, when the command needs one, its
 * Evidence store — through the same helpers the authoritative and preflight
 * runners resolve them with.
 *
 * A store is opened only when the invocation genuinely needs one, because
 * `openEvidenceStore` creates the store it opens: observing a clone that has no
 * Evidence store must not be the thing that gives it one. A CONFIRMATION does
 * need one — the write it performs has to leave a record — and that is the one
 * case where opening it is the right answer rather than a side effect.
 *
 * The evidence policy bounds what an APPEND may cost, and a configuration this
 * clone cannot read is not a reason to refuse to operate on it: the store opens
 * with no ceilings and the command continues.
 */
const resolveClone = async ({
  repositoryRoot,
  environment,
  command,
  receiptRequired = true,
  wantStore = true,
}) => {
  const activation = await resolveReceipt(repositoryRoot);

  if (!activation.ok
    && (receiptRequired || activation.reasonCode !== 'activation-receipt-missing')) {
    return {
      failed: failure({ command, reasonCode: activation.reasonCode, detail: activation.detail }),
    };
  }

  const receipt = activation.ok ? activation.receipt : null;
  // `'when-activated'` is how `status` asks for a store without being the thing
  // that creates one: a clone that was never activated has nothing to open.
  const needStore = wantStore === true || (wantStore === 'when-activated' && receipt !== null);

  if (!needStore) {
    return { receipt, store: null };
  }

  const gitCommonDirectory = activation.ok
    ? activation.gitCommonDirectory
    : await resolveGitCommonDirectory({ repositoryRoot }).catch(() => null);

  if (gitCommonDirectory === null) {
    return {
      failed: failure({
        command,
        reasonCode: 'repository-unresolved',
        detail: 'the Git common directory could not be resolved, so this clone has nowhere to record what was done.',
      }),
    };
  }

  const configuration = await resolveConfiguration(repositoryRoot);
  const opened = await openStore({
    repository: { root: repositoryRoot },
    activation: { ...activation, receipt, gitCommonDirectory },
    configuration: configuration.ok ? configuration : { policy: null },
    environment,
    openStoreSeam: openEvidenceStore,
  });

  if (!opened.ok) {
    return { failed: failure({ command, reasonCode: opened.reasonCode, detail: opened.detail }) };
  }

  return { receipt, store: opened.store };
};

/**
 * Record a refusal this surface decided, as the same Lifecycle event the
 * operation's own seam would have appended.
 *
 * It exists for exactly two operations. `deactivateGate` and `uninstallGate`
 * take no confirmation — every other seam here takes the operator's token
 * itself, refuses against it, and records that refusal — so for those two the
 * comparison happens here, and a refusal that left no record would be the one
 * governed act on this surface that nothing could later prove happened
 * (`NFR-AUD-001`). No new event type, no new store, no parallel log: the
 * operation's own `removal` type, in the clone's own Evidence store, through
 * the store's own append.
 */
const recordSurfaceRefusal = async ({ evidenceStore, type, before, reason }) => {
  if (!evidenceStore) {
    return null;
  }

  return evidenceStore.appendLifecycleEvent({
    type,
    before,
    after: null,
    outcome: 'refused',
    reason,
  }).catch(() => null);
};

/**
 * The release the INSTALLED distribution offers.
 *
 * The gate's own version is not readable from an activated clone's receipt —
 * the receipt records what the caller that ran activation declared — but it IS
 * readable from the distribution running this command, which is the thing an
 * ordinary `npm install` or plugin update actually bumps. The nearest package
 * manifest above this module is that distribution.
 *
 * Reading it makes a candidate visible and nothing else: `inspectRelease` states
 * that it advances no Active gate release, and only a confirmed `gate update`
 * ever does (`FR-LIFE-014`, `AC-LIFE-007`).
 */
const installedDistribution = async () => {
  let directory = HERE;

  for (let depth = 0; depth < 12; depth += 1) {
    const manifestPath = path.join(directory, 'package.json');
    const manifest = await readFile(manifestPath, 'utf8')
      .then((contents) => JSON.parse(contents))
      .catch(() => null);

    if (manifest !== null && typeof manifest.version === 'string') {
      return { version: manifest.version, manifest: manifestPath };
    }

    const parent = path.dirname(directory);

    if (parent === directory) {
      break;
    }

    directory = parent;
  }

  return { version: null, manifest: null };
};

/** One performed-or-refused half of a document, in the one shape every command reports. */
const mutation = ({ confirmation, performed, reasonCode = null, summary, ...rest }) => ({
  confirmation,
  performed,
  reasonCode: performed ? null : reasonCode,
  summary,
  ...rest,
});

/** Git, from this clone, the way every other seam in this skill runs it. */
const runFile = promisify(execFile);

const runGit = async (repositoryRoot, args) => (
  await runFile('git', args, { cwd: repositoryRoot })
).stdout;

/**
 * Everything one activation of THIS clone would be, resolved from the clone
 * itself and from the installed distribution running this command.
 *
 * Nothing here is a value a caller handed in. The policy and the checks come
 * from the clone's own configuration through the same reader the authoritative
 * runner uses; the hook program and the gate release come from the distribution
 * that would register them; the adapter set comes from the declared registry.
 * An activation whose request was assembled from anything else would pin a
 * clone that does not exist.
 *
 * Runtime inputs are deliberately empty: nothing in schema v4 declares one, so
 * an activation performed from a configuration has none to pin, and inventing a
 * name here would put an unapproved Sensitive value in the receipt.
 */
const activationRequestFor = async ({ repositoryRoot, selector }) => {
  const configuration = await resolveConfiguration(repositoryRoot);

  if (!configuration.ok) {
    return {
      failed: failure({
        command: 'activate',
        reasonCode: configuration.reasonCode,
        // Activation never configures a clone on the way past.
        detail: `${configuration.detail} Activation configures nothing; configure this clone first, then activate it.`,
      }),
    };
  }

  const { checks, errors } = gateChecksFromConfiguration(configuration.configuration);

  if (errors.length > 0) {
    return {
      failed: failure({
        command: 'activate',
        reasonCode: 'check-descriptors-invalid',
        detail: `this clone's configured verification commands cannot be resolved into checks: ${errors.map((error) => `${error.path}: ${error.message}`).join(' ')}`,
      }),
    };
  }

  const clientId = selector.client ?? 'git';
  const client = describeAdapter(clientId);

  if (client === null) {
    return {
      failed: failure({
        command: 'activate',
        reasonCode: 'adapter-undeclared',
        detail: `${JSON.stringify(clientId)} is not an adapter this gate declares, so it declares no trust model to satisfy and nothing to self-test.`,
      }),
    };
  }

  const git = describeAdapter('git');
  // Authoritative Git is always in the set: it is what a `pre-commit`
  // registration makes authoritative, whichever client asked for the
  // activation.
  const adapters = [
    { id: git.id, version: git.version, authoritative: git.role === 'authoritative' },
    ...(client.id === git.id
      ? []
      : [{ id: client.id, version: client.version, authoritative: client.role === 'authoritative' }]),
  ];
  const distribution = await installedDistribution();

  return {
    client,
    distribution,
    request: {
      scope: 'repository',
      // A package or plugin lifecycle can never reach this: the operator ran a
      // command, twice, and the transaction is told exactly that.
      trigger: 'explicit',
      repository: { root: repositoryRoot },
      configuration: {
        schemaVersion: configuration.configuration?.schema_version ?? null,
        policy: configuration.policy,
      },
      client: { id: client.id, surface: client.surface, version: client.version },
      gate: {
        id: GATE_ID,
        version: distribution.version,
        protocolVersion: PROTOCOL_VERSION,
      },
      runtime: {
        runnerVersion: `${GATE_ID}/${distribution.version ?? 'unknown'}`,
        hookProgram: {
          interpreter: process.execPath,
          script: PACKAGED_HOOK_PROGRAM,
          args: [],
        },
      },
      checks,
      adapters,
      runtimeInputs: [],
    },
  };
};

/**
 * What a client will do with a registration this activation only wrote.
 *
 * `activated` must not be read as "this client is already running it". Where a
 * client reviews the registration afterwards, the receipt already carries that
 * fact in the adapter's own declared words; this restates the same sentence
 * where the maintainer meets it, so nobody has to open the receipt to learn
 * that one more step belongs to them (`SG-TRUST-001`, `TB-046`).
 */
const pendingClientReviews = (result) => (result.receipt?.adapters ?? [])
  .filter((adapter) => adapter.clientReview !== null && adapter.clientReview !== undefined)
  .map((adapter) => adapter.clientReview.detail);

/** What one activation invocation did, in the transaction's own terms. */
const activationSummary = (result, shortcut) => {
  if (result.activated === true) {
    return [
      `This clone is activated: every step ran in the settled order, the receipt ${result.receipt.receiptId} was published and confirmed, and authoritative Git was enabled last.`,
      shortcut.detail,
      ...pendingClientReviews(result),
    ].join(' ');
  }

  if (result.state === 'paused') {
    return `Nothing was activated (${result.reasonCode}): the transaction paused at ${result.step}, no gate integration is active, and it resumes only as \`gate activate --resume ${result.resumption.transactionId} --confirm <token>\` against the same clone, policy, adapters, and preview.`;
  }

  if (result.state === 'recovery-required') {
    return `The activation failed at ${result.step} (${result.reasonCode}) and could not be fully rolled back; this clone requires recovery: ${result.rollback.remains.join(' ')}`;
  }

  return `Nothing was activated (${result.reasonCode}): the transaction failed at ${result.step}, every gate-owned change was rolled back, no shortcut was written, and this clone commits exactly as it did while configured.`;
};

/**
 * `gate activate` — activate this configured clone, in two invocations.
 *
 * The first previews and writes nothing. The second names the token the first
 * printed, and this rebuilds the preview from the clone AS IT IS NOW and checks
 * the token against that. A confirmation naming a preview this clone no longer
 * matches — because a command resolved differently, because the policy changed,
 * because it is a different clone — performs no mutation and says so
 * (`AC-LIFE-008`, `TB-036`).
 *
 * The consent handed to the transaction is built from the RECOMPUTED preview,
 * never from anything the caller carried, so the identities the transaction
 * checks are identities this process observed.
 */
const operateActivate = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const resolved = await activationRequestFor({ repositoryRoot, selector });

  if (resolved.failed) {
    return resolved.failed;
  }

  const { client, distribution, request } = resolved;
  const dependencies = { runGit, environment };
  let preview;

  try {
    preview = await previewActivation(request, dependencies);
  } catch (error) {
    return failure({
      command: 'activate',
      reasonCode: 'activation-unpreviewable',
      detail: `this clone cannot be previewed for activation (${error.message}); nothing was written.`,
    });
  }

  // What this clone IS right now, read without opening — and therefore without
  // creating — an Evidence store. A clone that already carries a receipt is
  // `activated`, and the transaction refuses to take over the hook it owns; a
  // preview that called it `configured` regardless would be describing the
  // request rather than the clone.
  const existing = await resolveReceipt(repositoryRoot);
  const observation = {
    state: existing.ok ? 'activated' : 'configured',
    client: client.id,
    // What has to be satisfied before this clone can be activated, in the
    // adapter's own declared words.
    trustModel: client.capabilities?.trust?.model ?? null,
    release: {
      id: GATE_ID,
      version: distribution.version,
      protocolVersion: PROTOCOL_VERSION,
    },
    repositoryIdentity: preview.repository.identity,
    configurationIdentity: preview.configuration.identity,
    hooks: preview.hooks.map((hook) => ({
      hook: hook.hook,
      path: hook.path,
      action: hook.action,
      ownership: hook.ownership,
    })),
    hookManager: preview.hookManager,
    hookProgram: request.runtime.hookProgram,
    commands: preview.commands,
    unresolved: preview.unresolved,
    adapters: preview.adapters,
    dependencyRoots: preview.dependencyRoots,
    runtimeInputs: preview.runtimeInputs,
    shortcut: { kind: 'clone-local-git-alias', name: `alias.${COMMAND_ALIAS_NAME}` },
    confirmationToken: preview.previewId,
  };

  if (confirmation === null) {
    return { command: 'activate', healthy: true, observation, mutation: null };
  }

  const clone = await resolveClone({
    repositoryRoot,
    environment,
    command: 'activate',
    // A clone that is not activated has no receipt, which is the whole point.
    // The store is opened because a confirmation writes: the receipt goes in
    // it, and so does the Lifecycle event that records this either way.
    receiptRequired: false,
  });

  if (clone.failed) {
    return clone.failed;
  }

  if (confirmation !== preview.previewId) {
    await recordSurfaceRefusal({
      evidenceStore: clone.store,
      type: 'activation',
      before: confirmation,
      reason: 'preview-mismatch: the confirmation named an activation this clone no longer matches; nothing was registered and no receipt was written.',
    });

    return {
      command: 'activate',
      healthy: false,
      observation,
      mutation: mutation({
        confirmation,
        performed: false,
        reasonCode: 'preview-mismatch',
        expected: preview.previewId,
        summary: 'Nothing was activated (preview-mismatch): this clone no longer matches the activation that token named. Preview again and confirm the new preview.',
      }),
    };
  }

  const consent = {
    previewId: preview.previewId,
    repositoryIdentity: preview.repository.identity,
    configurationIdentity: preview.configuration.identity,
    // Carried, never asserted. See `SELF_DECLARED`.
    actor: selector.actor === null ? null : { name: selector.actor, source: SELF_DECLARED },
    grantedAt: new Date().toISOString(),
  };
  // A resumption names the transaction it is resuming, and that identity binds
  // all four things a resumption may never change. Every one of them is
  // re-derived here, so a clone, policy, adapter set, or preview that moved
  // since the pause produces a different identity and the transaction refuses.
  const resume = selector.resume === null ? null : {
    transactionId: selector.resume,
    previewId: preview.previewId,
    repositoryIdentity: preview.repository.identity,
    configurationIdentity: preview.configuration.identity,
    adapterIdentity: adapterIdentity(preview.adapters),
  };
  const result = await activate({ ...request, consent, resume }, {
    ...dependencies,
    evidenceStore: clone.store,
    // The three seams `runActivation` leaves abstract. They are supplied here
    // and nowhere else on this surface, and none of them can be replaced from
    // an argument vector: a caller that could inject its own self-test could
    // activate a clone that proves nothing.
    establishTrust: createTrustEstablishment({ consent, actor: selector.actor }),
    selfTestEvaluation: () => selfTestEvaluationDenial({
      runnerVersion: request.runtime.runnerVersion,
    }),
    selfTestAdapter: selfTestAdapterSurface,
  });

  // The shortcut is registered only after the transaction has fully succeeded,
  // and outside its stepped sequence: `ACTIVATION_STEPS` may not grow and the
  // transaction may not change, so there is no journal entry to hang it from. A
  // failed or rolled-back activation therefore never writes one at all, which
  // is the property `SG-LIFE-001` asks for, reached by not writing rather than
  // by taking back. A shortcut that cannot be registered is an inconvenience,
  // never a reason to leave an otherwise activated clone unactivated.
  const shortcut = result.activated === true
    ? await registerCommandAlias({
      repositoryRoot,
      command: PACKAGED_COMMAND,
      runGit: (args) => runGit(repositoryRoot, args),
    })
    : {
      registered: false,
      reason: 'activation-not-completed',
      name: `alias.${COMMAND_ALIAS_NAME}`,
      value: null,
      detail: 'No shortcut was registered, because nothing was activated.',
    };

  return {
    command: 'activate',
    healthy: result.activated === true,
    observation: { ...observation, state: result.state },
    mutation: mutation({
      confirmation,
      performed: result.activated === true,
      reasonCode: result.reasonCode,
      step: result.step,
      order: result.order,
      state: result.state,
      receiptId: result.receipt?.receiptId ?? null,
      // Exactly what the receipt claims about consent, restated where a reader
      // meets it, so nobody has to open the receipt to see that no human was
      // asserted.
      trust: result.receipt?.trust ?? null,
      resumption: result.resumption,
      rollback: result.rollback,
      shortcut,
      errors: result.errors ?? [],
      summary: activationSummary(result, shortcut),
    }),
  };
};

/**
 * `gate status` — reconcile desired against actual state and report it.
 *
 * A clone with no receipt has nothing to open and nothing to reconcile, so no
 * store is opened for it. `statusGate` already answers that case from a null
 * store, and it is the one that answers it here. This is the only command with
 * no confirmed form, and it must go on recording nothing at all.
 */
const operateStatus = async ({ repositoryRoot, environment }) => {
  const clone = await resolveClone({
    repositoryRoot,
    environment,
    command: 'status',
    receiptRequired: false,
    // A clone that was never activated is never given a store by the act of
    // being looked at.
    wantStore: 'when-activated',
  });

  if (clone.failed) {
    return clone.failed;
  }

  const status = await statusGate({
    evidenceStore: clone.store,
    repositoryRoot,
    adapters: clone.receipt === null ? null : observedAdapters(clone.receipt),
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
    mutation: null,
  };
};

/** `gate locks` — inspect the coordination lock, and recover one stale lock on confirmation. */
const operateLocks = async ({ repositoryRoot, environment, confirmation }) => {
  const inspection = await inspectCoordination({ repositoryRoot });
  const observation = {
    ...inspection,
    // The recovery token IS this command's confirmation token; naming it twice
    // would be two tokens for one decision.
    confirmationToken: inspection.recoveryToken,
  };

  if (confirmation === null) {
    return {
      command: 'locks',
      // A lock nobody is holding and a lock somebody is really holding are both
      // fine. Only a stale one is a clone that needs an operator.
      healthy: !(inspection.held && inspection.stale),
      observation,
      mutation: null,
    };
  }

  const clone = await resolveClone({ repositoryRoot, environment, command: 'locks' });

  if (clone.failed) {
    return clone.failed;
  }

  // The lock seam re-inspects and checks the token itself, so a live holder is
  // never taken and a confirmation that was never shown this lock recovers
  // nothing — and it audits both outcomes through the store it is given.
  const lock = await openCoordinationLock({ repositoryRoot, store: clone.store });
  const recovery = await lock.recoverStale({ confirmation });

  return {
    command: 'locks',
    healthy: recovery.recovered === true,
    observation,
    mutation: mutation({
      confirmation,
      performed: recovery.recovered === true,
      reasonCode: recovery.reasonCode,
      recoveredPath: recovery.recoveredPath ?? null,
      summary: recovery.recovered === true
        ? `The stale lock was recovered and its record preserved at ${recovery.recoveredPath}.`
        : `Nothing was recovered (${recovery.reasonCode}): ${recovery.detail}`,
    }),
  };
};

/** `gate prune` — preview exactly what a prune would remove, and remove it on confirmation. */
const operatePrune = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const clone = await resolveClone({ repositoryRoot, environment, command: 'prune' });

  if (clone.failed) {
    return clone.failed;
  }

  const preview = await previewEvidencePrune({ evidenceStore: clone.store, selector });

  if (confirmation === null) {
    return {
      command: 'prune',
      // A preview is never bad news. What it names may be a lot of evidence,
      // and that is information, not a fault.
      healthy: true,
      observation: preview,
      mutation: null,
    };
  }

  const result = await confirmEvidencePrune({
    evidenceStore: clone.store,
    preview,
    confirmation,
  });

  return {
    command: 'prune',
    healthy: result.pruned === true,
    observation: preview,
    mutation: mutation({
      confirmation,
      performed: result.pruned === true,
      reasonCode: result.reasonCode,
      removed: result.removed ?? [],
      reclaimedBytes: result.reclaimedBytes ?? 0,
      preserved: result.preserved ?? [],
      summary: result.pruned === true
        ? `${(result.removed ?? []).length} previewed blob(s) were removed, ${result.reclaimedBytes} byte(s) reclaimed, and a tombstone written for each; ${(result.preserved ?? []).join(', ')} were preserved.`
        : `Nothing was removed (${result.reasonCode}): ${result.reason ?? 'the confirmation did not reproduce a preview of this store.'}`,
    }),
  };
};

/** `gate repair` — restore drifted gate-owned registrations to what the receipt authorizes. */
const operateRepair = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const clone = await resolveClone({ repositoryRoot, environment, command: 'repair' });

  if (clone.failed) {
    return clone.failed;
  }

  const runtime = {
    hookProgram: {
      interpreter: process.execPath,
      script: selector.hookScript ?? PACKAGED_HOOK_PROGRAM,
      args: [],
    },
  };
  const preview = await previewRepair({
    evidenceStore: clone.store,
    repositoryRoot,
    runtime,
    adapters: observedAdapters(clone.receipt),
  });
  const observation = {
    health: preview.status,
    receiptId: preview.receiptId,
    actions: preview.actions,
    // Adapter loss is a reinstall, not a repair. The seam already separates the
    // two and this reports its answer rather than re-deciding it (`RISK-004`).
    unrepairable: preview.unrepairable,
    hookProgram: runtime.hookProgram,
    confirmationToken: preview.confirmationToken,
  };

  if (confirmation === null) {
    return { command: 'repair', healthy: true, observation, mutation: null };
  }

  const result = await confirmRepair({
    evidenceStore: clone.store,
    repositoryRoot,
    runtime,
    preview,
    confirmation,
  });

  return {
    command: 'repair',
    healthy: result.repaired === true,
    observation,
    mutation: mutation({
      confirmation,
      performed: result.repaired === true,
      reasonCode: result.reasonCode,
      actions: result.actions,
      errors: result.errors ?? [],
      summary: result.repaired === true
        ? `${result.actions.length} gate-owned registration(s) were restored to exactly what the Activation receipt authorizes.`
        : `Nothing was repaired (${result.reasonCode}); the observed drift was left exactly as it was found.`,
    }),
  };
};

/** `gate update` — take the installed distribution's release, and only on confirmation. */
const operateUpdate = async ({ repositoryRoot, environment, confirmation }) => {
  const clone = await resolveClone({ repositoryRoot, environment, command: 'update' });

  if (clone.failed) {
    return clone.failed;
  }

  const distribution = await installedDistribution();
  const candidate = {
    id: clone.receipt?.runtime?.gate?.id ?? null,
    version: distribution.version,
    // What the installed gate actually speaks. A candidate that speaks a
    // different protocol than the receipt pinned is refused at `compatibility`
    // rather than absorbed in place, which is the seam's judgement, not this
    // surface's.
    protocolVersion: PROTOCOL_VERSION,
  };
  const release = inspectRelease({ receipt: clone.receipt, distribution: candidate });
  const preview = previewUpdate({ receipt: clone.receipt, candidate, migrations: [] });
  const observation = {
    active: release.active,
    candidate: release.candidate,
    candidateAvailable: release.candidateAvailable,
    // Reading a newer distribution is not taking it, and this states so on
    // every document rather than only in prose (`FR-LIFE-014`).
    advancesActiveRelease: false,
    distribution,
    migrations: preview.migrations,
    // This surface reruns no self-test of its own: `updateGate`'s defaults are
    // the library's, and reporting an injected pass as a proof would be a claim
    // the clone cannot support. `gate status` is what reconciles it afterwards.
    selfTestsRerun: false,
    action: release.action,
    confirmationToken: preview.previewId,
  };

  if (confirmation === null) {
    return { command: 'update', healthy: true, observation, mutation: null };
  }

  const result = await updateGate({
    evidenceStore: clone.store,
    candidate,
    migrations: [],
    confirmation,
  });

  return {
    command: 'update',
    healthy: result.updated === true,
    observation,
    mutation: mutation({
      confirmation,
      performed: result.updated === true,
      reasonCode: result.reasonCode,
      step: result.step,
      order: result.order,
      state: result.state,
      release: result.release,
      receiptId: result.receipt?.receiptId ?? null,
      rollback: result.rollback,
      errors: result.errors ?? [],
      summary: result.updated === true
        ? `The Active gate release advanced from ${result.release.from?.version ?? 'none'} to ${result.release.to?.version ?? 'none'} by one atomic receipt write.`
        : `The update failed at ${result.step} (${result.reasonCode}); the previous Active gate release ${result.release.from?.version ?? 'none'} is preserved unchanged.`,
    }),
  };
};

/**
 * What one deactivation would withdraw, re-derived from this clone right now.
 *
 * `deactivateGate` takes no preview, so this describes what it would act on
 * rather than deciding anything about it: the registrations the receipt pins,
 * as they are ON DISK. A registration edited between the preview and the
 * confirmation changes its own identity here, so the token stops reproducing
 * and the operator is sent back to look again — which is the same reason
 * `TB-036` re-derives a cleanup from the file instead of trusting the caller.
 */
const deactivationPreview = async (receipt) => {
  const registrations = [];

  for (const hook of receipt?.hooks ?? []) {
    const registration = await readHookRegistration(hook.path, hook.ownership);

    registrations.push({
      kind: 'hook-registration',
      hook: hook.hook ?? null,
      path: hook.path,
      ownership: hook.ownership,
      present: registration.present === true,
      blockIdentity: registration.blockIdentity ?? null,
      receiptId: registration.receiptId ?? null,
    });
  }

  const body = {
    receiptId: receipt?.receiptId ?? null,
    registrations,
    adapterRegistrations: (receipt?.adapters ?? [])
      .filter((adapter) => adapter.registration?.kind === 'client-configuration-file')
      .map((adapter) => ({
        kind: 'adapter-registration',
        adapter: adapter.id,
        path: adapter.registration.path ?? null,
        entryIdentity: adapter.registration.entryIdentity ?? null,
      })),
    preserved: [...DEACTIVATION_PRESERVES],
  };

  return { ...body, confirmationToken: contentIdentity(body) };
};

/** `gate deactivate` — withdraw exactly the gate-owned registrations and the receipt. */
const operateDeactivate = async ({ repositoryRoot, environment, confirmation }) => {
  const clone = await resolveClone({ repositoryRoot, environment, command: 'deactivate' });

  if (clone.failed) {
    return clone.failed;
  }

  const observation = await deactivationPreview(clone.receipt);

  if (confirmation === null) {
    return { command: 'deactivate', healthy: true, observation, mutation: null };
  }

  if (confirmation !== observation.confirmationToken) {
    await recordSurfaceRefusal({
      evidenceStore: clone.store,
      type: 'removal',
      before: confirmation,
      reason: `preview-mismatch: the confirmation named a deactivation this clone no longer matches; nothing was removed and nothing was repaired.`,
    });

    return {
      command: 'deactivate',
      healthy: false,
      observation,
      mutation: mutation({
        confirmation,
        performed: false,
        reasonCode: 'preview-mismatch',
        expected: observation.confirmationToken,
        summary: 'Nothing was removed (preview-mismatch): this clone no longer matches the deactivation that token named. Preview again and confirm the new preview.',
      }),
    };
  }

  const result = await deactivateGate({ evidenceStore: clone.store, repositoryRoot });

  return {
    command: 'deactivate',
    healthy: result.deactivated === true,
    observation,
    mutation: mutation({
      confirmation,
      performed: result.deactivated === true,
      reasonCode: result.reasonCode,
      removed: result.removed,
      preserved: result.preserved,
      errors: result.errors ?? [],
      summary: result.deactivated === true
        ? `${result.removed.length} gate-owned item(s) were withdrawn; ${result.preserved.join(', ')} were preserved.`
        : `Nothing was removed (${result.reasonCode}); deactivation refuses as a whole rather than half-performing, and repairs nothing it found.`,
    }),
  };
};

/**
 * What one uninstall would remove, re-derived from the files themselves.
 *
 * The Activation receipt records no asset manifest — nothing in an activated
 * clone knows which project files an installer put there — so the operator
 * names them, and this states exactly what is at those paths right now. A file
 * edited between the preview and the confirmation changes its identity here and
 * the token stops reproducing; a file the Gate must never touch is refused by
 * `uninstallGate` itself, whichever paths were named.
 */
const uninstallPreview = async ({ repositoryRoot, assets, configurationPath }) => {
  const described = [];

  for (const asset of assets ?? []) {
    const resolved = path.resolve(repositoryRoot, asset);
    const contents = await readFile(resolved, 'utf8').catch(() => null);

    described.push({
      path: resolved,
      present: contents !== null,
      identity: contents === null ? null : contentIdentity(contents),
    });
  }

  const body = {
    assets: described,
    configurationPath,
    preserved: [...UNINSTALL_PRESERVES],
  };

  return { ...body, confirmationToken: contentIdentity(body) };
};

/** `gate uninstall` — remove only unchanged project-installed assets, after deactivation. */
const operateUninstall = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const configurationPath = path.join(repositoryRoot, SHARED_CONFIGURATION_FILE);
  const observation = await uninstallPreview({
    repositoryRoot,
    assets: selector.assets,
    configurationPath,
  });

  if (confirmation === null) {
    return { command: 'uninstall', healthy: true, observation, mutation: null };
  }

  const clone = await resolveClone({
    repositoryRoot,
    environment,
    command: 'uninstall',
    // Uninstall is the one command that REQUIRES no receipt: an activated clone
    // is never uninstalled out from under its own authoritative hook, and
    // `uninstallGate` is the seam that says so.
    receiptRequired: false,
  });

  if (clone.failed) {
    return clone.failed;
  }

  if (confirmation !== observation.confirmationToken) {
    await recordSurfaceRefusal({
      evidenceStore: clone.store,
      type: 'removal',
      before: confirmation,
      reason: 'preview-mismatch: the confirmation named an uninstall these files no longer match; nothing was removed.',
    });

    return {
      command: 'uninstall',
      healthy: false,
      observation,
      mutation: mutation({
        confirmation,
        performed: false,
        reasonCode: 'preview-mismatch',
        expected: observation.confirmationToken,
        summary: 'Nothing was removed (preview-mismatch): these assets are no longer the ones that token named. Preview again and confirm the new preview.',
      }),
    };
  }

  const result = await uninstallGate({
    evidenceStore: clone.store,
    repositoryRoot,
    configurationPath,
    assets: observation.assets.map(({ path: assetPath, identity }) => ({
      path: assetPath,
      identity,
    })),
  });

  return {
    command: 'uninstall',
    healthy: result.uninstalled === true,
    observation,
    mutation: mutation({
      confirmation,
      performed: result.uninstalled === true,
      reasonCode: result.reasonCode,
      removed: result.removed,
      refused: result.refused,
      preserved: result.preserved,
      errors: result.errors ?? [],
      summary: result.uninstalled === true
        ? `${result.removed.length} unchanged project-installed asset(s) were removed; ${result.preserved.join(', ')} were preserved.`
        : `Nothing was removed (${result.reasonCode}); one refusal refuses the whole uninstall rather than leaving a maintainer with partial success.`,
    }),
  };
};

/** `gate cleanup` — remove only the Gate's own keys from the shared configuration file. */
const operateCleanup = async ({ repositoryRoot, environment, confirmation }) => {
  const configurationPath = path.join(repositoryRoot, SHARED_CONFIGURATION_FILE);
  // Re-derived on every invocation, so the confirmation is checked against the
  // file as it is now rather than against whatever the caller remembers.
  const preview = await previewConfigurationCleanup({ configurationPath });
  const observation = {
    path: preview.path,
    keys: preview.keys,
    removedText: preview.removedText,
    fileIdentity: preview.fileIdentity,
    fileDeleted: false,
    confirmationToken: preview.confirmationToken,
  };

  if (confirmation === null) {
    return { command: 'cleanup', healthy: true, observation, mutation: null };
  }

  const clone = await resolveClone({
    repositoryRoot,
    environment,
    command: 'cleanup',
    // Configuration cleanup is what a maintainer runs AFTER removal, so the
    // receipt is usually already gone; the store that records it is not.
    receiptRequired: false,
  });

  if (clone.failed) {
    return clone.failed;
  }

  const result = await confirmConfigurationCleanup({
    evidenceStore: clone.store,
    configurationPath,
    preview,
    confirmation,
  });

  return {
    command: 'cleanup',
    healthy: result.cleaned === true,
    observation,
    mutation: mutation({
      confirmation,
      performed: result.cleaned === true,
      reasonCode: result.reasonCode,
      removedKeys: result.removedKeys,
      fileDeleted: result.fileDeleted,
      errors: result.errors ?? [],
      summary: result.cleaned === true
        ? `The Gate key(s) ${result.removedKeys.join(', ')} were removed; every other byte of the shared configuration file was written back unchanged.`
        : `Nothing was removed (${result.reasonCode}); the shared configuration file was not changed.`,
    }),
  };
};

const OPERATIONS = Object.freeze({
  activate: operateActivate,
  status: operateStatus,
  locks: operateLocks,
  prune: operatePrune,
  repair: operateRepair,
  update: operateUpdate,
  deactivate: operateDeactivate,
  uninstall: operateUninstall,
  cleanup: operateCleanup,
});

/** The envelope every rendering is made from, whether the command ran or not. */
const documentOf = ({ command, repositoryRoot, result }) => {
  const failed = result.failure !== undefined;
  const exitStatus = failed
    ? EXIT_UNRUNNABLE
    : (result.healthy ? EXIT_OBSERVED : EXIT_UNHEALTHY);

  return {
    document: DOCUMENT_VERSION,
    gate: GATE_ID,
    command: result.command ?? command ?? null,
    ok: !failed && result.healthy === true,
    exitStatus,
    repository: { root: repositoryRoot },
    // What this invocation would do, re-derived from the clone as it is now.
    observation: failed ? null : result.observation,
    // What it did, or refused to do. `null` on every preview, which is what
    // makes "this run wrote nothing" a field rather than a promise in prose.
    mutation: failed ? null : (result.mutation ?? null),
    failure: failed ? result.failure : null,
    // Stated on every document, in the words the skill states it in once
    // (`SG-TRUST-001`): this reports what a cooperative local process can see
    // and do about itself, and it resists nobody. Reaching these operations
    // from an agent changes nothing about a boundary that was already
    // cooperative — `--no-verify` has always been one flag away — except that
    // what is done here leaves a record.
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

/** The one line every confirmable command ends its preview with. */
const renderConfirmation = (command, observation) => line(
  'next',
  observation.confirmationToken === null || observation.confirmationToken === undefined
    ? 'nothing to confirm'
    : `gate ${command} ${CONFIRMABLE_COMMANDS[command]} ${observation.confirmationToken}`,
);

const renderActivate = (observation) => [
  line('state', observation.state),
  line('client', `${observation.client} (trust model ${observation.trustModel ?? 'undeclared'})`),
  line(
    'release',
    `${observation.release.id} ${observation.release.version ?? 'unknown'} (protocol ${observation.release.protocolVersion})`,
  ),
  line('repository identity', observation.repositoryIdentity),
  line('configuration identity', observation.configurationIdentity),
  line('hooks', observation.hooks.length),
  ...observation.hooks.map(
    (hook) => `  - ${hook.hook} ${hook.path} (${hook.action}, ${hook.ownership ?? 'unowned'})`,
  ),
  line('hook manager', observation.hookManager?.id ?? 'none'),
  line('hook program', `${observation.hookProgram.interpreter} ${observation.hookProgram.script}`),
  line('commands', observation.commands.length),
  ...observation.commands.map(
    (command) => `  - ${command.check_id} ${command.runner} ${command.executable} ${command.version ?? 'unversioned'}`,
  ),
  line('unresolved', observation.unresolved.length),
  ...observation.unresolved.map((entry) => `  - ${JSON.stringify(entry)}`),
  line('adapters', observation.adapters.map((adapter) => adapter.id).join(', ') || 'none'),
  line('dependency roots', observation.dependencyRoots.join(', ') || 'none'),
  line('runtime inputs', observation.runtimeInputs.join(', ') || 'none'),
  line('shortcut', `${observation.shortcut.name} (${observation.shortcut.kind})`),
  renderConfirmation('activate', observation),
];

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
  renderConfirmation('locks', observation),
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
  observation.blobs.length === 0
    ? line('next', 'nothing to remove')
    : renderConfirmation('prune', observation),
];

const renderRepair = (observation) => [
  line('health', observation.health),
  line('receipt', observation.receiptId ?? 'none'),
  line('hook program', `${observation.hookProgram.interpreter} ${observation.hookProgram.script}`),
  line('actions', observation.actions.length),
  ...observation.actions.map(
    (action) => `  - ${action.code} restore ${action.kind} ${action.path}`,
  ),
  line('unrepairable', observation.unrepairable.length),
  ...renderFindings(observation.unrepairable),
  observation.actions.length === 0
    ? line('next', 'nothing to repair')
    : renderConfirmation('repair', observation),
];

const renderRelease = (release) => (release === null
  ? 'none'
  : `${release.id ?? 'unknown'} ${release.version ?? 'unknown'} (protocol ${release.protocolVersion ?? 'unknown'})`);

const renderUpdate = (observation) => [
  line('active', renderRelease(observation.active)),
  line('candidate', renderRelease(observation.candidate)),
  line('distribution', observation.distribution.manifest ?? 'unresolved'),
  line('candidate available', observation.candidateAvailable),
  line('advances active release', observation.advancesActiveRelease),
  line('migrations', observation.migrations.length),
  ...observation.migrations.map(
    (migration) => `  - ${migration.id} ${migration.description ?? ''} (reversible ${migration.reversible})`,
  ),
  line('self-tests rerun', observation.selfTestsRerun),
  observation.candidateAvailable
    ? renderConfirmation('update', observation)
    : line('next', 'the installed distribution offers no new release'),
];

const renderDeactivate = (observation) => [
  line('receipt', observation.receiptId ?? 'none'),
  line('registrations', observation.registrations.length),
  ...observation.registrations.map(
    (registration) => `  - ${registration.kind} ${registration.hook ?? ''} ${registration.path} (present ${registration.present})`,
  ),
  line('adapter registrations', observation.adapterRegistrations.length),
  ...observation.adapterRegistrations.map(
    (registration) => `  - ${registration.kind} ${registration.adapter} ${registration.path}`,
  ),
  line('preserved', observation.preserved.join(', ')),
  renderConfirmation('deactivate', observation),
];

const renderUninstall = (observation) => [
  line('assets', observation.assets.length),
  ...observation.assets.map(
    (asset) => `  - ${asset.path} (present ${asset.present}) ${asset.identity ?? 'no identity'}`,
  ),
  line('preserved', observation.preserved.join(', ')),
  observation.assets.length === 0
    ? line('next', 'name the project-installed assets with --asset <path>')
    : renderConfirmation('uninstall', observation),
];

const renderCleanup = (observation) => [
  line('configuration', observation.path),
  line('keys', observation.keys.length),
  ...observation.keys.map((key) => `  - ${key.key} lines ${key.startLine}-${key.endLine}`),
  line('file deleted', observation.fileDeleted),
  observation.keys.length === 0
    ? line('next', 'nothing to remove')
    : renderConfirmation('cleanup', observation),
];

const RENDERERS = Object.freeze({
  activate: renderActivate,
  status: renderStatus,
  locks: renderLocks,
  prune: renderPrune,
  repair: renderRepair,
  update: renderUpdate,
  deactivate: renderDeactivate,
  uninstall: renderUninstall,
  cleanup: renderCleanup,
});

/**
 * What this invocation did, in the one shape every command reports it.
 *
 * There is deliberately no per-command mutation renderer: each operation states
 * its own outcome in one sentence its seam gave it, so the difference between a
 * repair and a prune is in the words rather than in a second rendering table
 * that could drift from the first.
 */
const renderMutation = (mutated) => [
  line('confirmed', mutated.confirmation),
  line('performed', mutated.performed),
  ...(mutated.reasonCode === null ? [] : [line('refused', mutated.reasonCode)]),
  ...(mutated.errors ?? []).map((error) => `  - ${JSON.stringify(error)}`),
  mutated.summary,
];

/**
 * Render the one document a person reads.
 *
 * This is the SAME document `--json` prints, rendered rather than recomputed,
 * so an agent and a maintainer can never observe different things from the same
 * invocation (`NFR-OPER-001`).
 */
export const renderDocument = (document) => [
  `gate ${document.command}${document.mutation === null ? '' : ` ${CONFIRMABLE_COMMANDS[document.command]}`}`,
  line('repository', document.repository.root ?? 'unresolved'),
  ...RENDERERS[document.command](document.observation),
  ...(document.mutation === null
    ? ['preview: nothing was written, nothing was repaired, and nothing was removed.']
    : renderMutation(document.mutation)),
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
    confirmation: parsed.confirmation,
  });

  return answer(documentOf({
    command: parsed.command,
    repositoryRoot: repository.root,
    result,
  }));
};
