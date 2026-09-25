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
  previewSync,
  readHookRegistration,
  syncActivation,
} from './activation.mjs';
import {
  COMMAND_ALIAS_NAME,
  SELF_DECLARED,
  createTrustEstablishment,
  recordedCommandAlias,
  registerCommandAlias,
  selfTestAdapterSurface,
  selfTestEvaluationDenial,
} from './activation-seams.mjs';
import { describeAdapter } from './adapters.mjs';
import { composeArguments } from './command-descriptor.mjs';
import {
  CONFIGURATION_FILE,
  gateChecksFromConfiguration,
  parseConfigurationDocument,
} from './configuration.mjs';
import { openCoordinationLock } from './coordination.mjs';
import { PROTOCOL_VERSION } from './evaluation-contract.mjs';
import {
  BYPASS_GRANT_VERSION,
  bypassGrantFrom,
  declaredSensitiveInputs,
  resolveBypass,
} from './policy.mjs';
import {
  contentIdentity,
  openEvidenceStore,
  resolveGitCommonDirectory,
} from './evidence-store.mjs';
import {
  createExecutionRoot,
  observeControlSurface,
  openStore,
  pinnedRunners,
  releaseExecutionRoot,
  resolveConfiguration,
  resolveReceipt,
  resolveRepositoryRoot,
} from './hook-runner.mjs';
import { captureSnapshot } from './snapshot.mjs';
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
  'bypass',
  'sync',
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
  bypass: '--confirm',
  sync: '--confirm',
});

/**
 * Every mutating selector this surface still refuses, and the operation that
 * owns it.
 *
 * `TB-040` stated these as data precisely so a later slice could move entries
 * OUT of them as it implemented each one, rather than growing a second parser
 * beside them. `TB-041` moved `--recover`, `--confirm`, `--confirmation`, and
 * `--token` out and made `repair` a first-class command, so `--repair` is no
 * longer a selector anything owns: it is refused like any other selector no
 * command takes (`TB-050`). What is left belongs to `gate fix`, whose risk
 * profile is a different contract's.
 */
export const CONFIRMED_SELECTORS = Object.freeze({
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
  bypass: Object.freeze({
    '--reason': 'value',
    '--reference': 'value',
    '--actor': 'value',
    '--confirm': 'confirmation',
  }),
  // A flag, because what it says is only ever "yes": the weakening it
  // acknowledges is named by the preview and bound by the token (`TB-062`).
  sync: Object.freeze({
    '--acknowledge-weakening': 'flag',
    '--confirm': 'confirmation',
  }),
});

/**
 * The parsed field each value selector is read into — the inverse of the
 * `if (argument === '--…')` ladder in `parseArguments`, stated once so the
 * instruction a preview prints is derived from what the parser READ and never
 * from a second look at the argument vector (`TB-053`).
 */
const SELECTOR_FIELDS = Object.freeze({
  '--client': 'client',
  '--actor': 'actor',
  '--resume': 'resume',
  '--evaluation': 'evaluationIds',
  '--before': 'appendedBefore',
  '--reclaim': 'reclaimBytes',
  '--hook-script': 'hookScript',
  '--asset': 'assets',
  '--reason': 'reason',
  '--reference': 'reference',
  '--acknowledge-weakening': 'acknowledgeWeakening',
});

/**
 * Characters a POSIX shell (`sh`, `bash`, `zsh` — macOS and Linux, the
 * platforms this skill claims) passes through unchanged outside quotes. A value
 * made only of these is printed bare; anything else is single-quoted, with an
 * embedded `'` spelled `'\''`, which is the one quoting every POSIX shell reads
 * identically. This repository's own resolved PHP lives under
 * `Application Support`, so a path with a space is not hypothetical.
 */
const SHELL_BARE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** One argument, as it has to be pasted for a POSIX shell to hand it back unchanged. */
export const quoteForShell = (value) => (
  SHELL_BARE.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
);

/**
 * The selectors one parsed invocation carried, as the argument vector that
 * would reproduce them.
 *
 * Every value selector the command declares and the invocation supplied is
 * echoed, in the order `SELECTORS` declares them, once per value for a
 * `repeatable` selector; the confirmation selector is never among them. This
 * is what a `next:` line is composed from: the instruction a preview prints
 * is a statement about the invocation that produced the preview, so it has to
 * carry whatever that invocation carried — whether or not the value reached
 * the confirmation token (`--client` does; `--actor` and `--resume` shape what
 * the confirmation records and resumes without changing the token, and are
 * carried for the same reason).
 */
export const instructionSelectors = (command, selector) => Object.entries(SELECTORS[command] ?? {})
  .filter(([, reading]) => reading !== 'confirmation')
  .flatMap(([flag, reading]) => {
    const value = selector?.[SELECTOR_FIELDS[flag]] ?? null;

    if (value === null) {
      return [];
    }

    if (reading === 'flag') {
      return value === true ? [flag] : [];
    }

    return (reading === 'repeatable' ? value : [value])
      .flatMap((each) => [flag, String(each)]);
  });

/** The preview invocation, as a person pastes it: `gate <command> <selectors…>`. */
const previewInstruction = (command, selectors) => ['gate', command, ...selectors.map(quoteForShell)].join(' ');

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
  '  gate bypass     --reason <text> ...      Preview granting one one-shot bypass of the staged snapshot.',
  '  gate sync       [--acknowledge-weakening] Preview re-pinning a changed configuration, keeping the adapters.',
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
  'Bypass selectors:',
  '  --reason <text>                   Why this one commit may proceed over its failures; required.',
  '  --reference <ref>                 A ticket or reference; required when the policy says so.',
  '  --actor <name>                    A name to carry, recorded as self-declared only.',
  '',
  'A confirmed bypass writes one grant bound to the exact staged snapshot the',
  'preview identified. The next commit attempt reads it once — applied or',
  'refused, it is spent — and a bypassed commit is recorded as bypassed, never',
  'passed, with every failed check preserved. Staging anything after the preview',
  'refuses the confirmation; staging anything after the grant refuses the grant.',
  'The hook prints the configured marker for the commit message; it cannot write',
  'the message itself.',
  '',
  'Sync selectors:',
  '  --acknowledge-weakening           Offer a token for a candidate weaker than the trusted policy.',
  '',
  'A sync pins the configuration this clone declares now under the adapter set',
  'its receipt already pins, keeping every registration byte for byte. Its',
  'preview names every way the candidate is weaker than the trusted policy, and',
  'a weaker candidate is refused with no token unless the invocation',
  'acknowledges the weakening; the token then binds the candidate and that',
  'acknowledgement together. Adding or removing an adapter is still deactivate',
  'and activate.',
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
    reason: null,
    reference: null,
    acknowledgeWeakening: null,
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

    if (accepted[argument] === 'flag') {
      selector[SELECTOR_FIELDS[argument]] = true;

      continue;
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

    if (argument === '--reason') {
      selector.reason = value;
    }

    if (argument === '--reference') {
      selector.reference = value;
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
      // The Sensitive runtime inputs the clone's own policy declares, by name
      // and source. This is the one production path that fills the request:
      // the preview shows the names, consent is granted against them, the
      // receipt pins them, and the runners arm the redactor from them. A
      // value is never read here (`FR-CFG-006`, `TB-045`).
      runtimeInputs: declaredSensitiveInputs(configuration.policy),
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

/**
 * Why a confirmation did not reproduce the preview its token names, in words
 * that assert only what this process established.
 *
 * All the confirmation path holds is two opaque `sha256:` identities — the one
 * the operator carried and the one this invocation recomputed. A token that
 * differs says the preview differs; it cannot say WHY. The preview body is
 * hashed whole, no preview is ever persisted to diff against, and a clone that
 * changed underneath the operator and an invocation that dropped a selector
 * (`gate activate --confirm …` where the preview was `--client cursor`) produce
 * exactly the same evidence: `expected !== actual`. So the refusal names both
 * causes and blames neither, and points at the one thing that decides between
 * them — the `next:` line the preview printed, which carries every selector its
 * preview needed (`NFR-OPER-001`, `TB-053`).
 */
const mismatchExplanation = (command, selectors) => (
  `the confirmation did not reproduce the preview that token names: either this clone changed since that preview, or this invocation's selectors differ from the one that printed it (this one ran as \`${previewInstruction(command, selectors)}\`). Preview again, read it, and confirm the \`next:\` line it prints.`
);

/** What one activation invocation did, in the transaction's own terms. */
const activationSummary = (result, shortcut, selector) => {
  if (result.activated === true) {
    return [
      `This clone is activated: every step ran in the settled order, the receipt ${result.receipt.receiptId} was published and confirmed, and authoritative Git was enabled last.`,
      shortcut.detail,
      ...pendingClientReviews(result),
    ].join(' ');
  }

  if (result.state === 'paused') {
    // The resumption carries every selector this invocation carried, with the
    // transaction identity in place of any `--resume` it was itself given: a
    // resumption that dropped `--client` would preview a different activation.
    const resumption = previewInstruction('activate', instructionSelectors('activate', {
      ...selector,
      resume: result.resumption.transactionId,
    }));

    return `Nothing was activated (${result.reasonCode}): the transaction paused at ${result.step}, no gate integration is active, and it resumes only as \`${resumption} --confirm <token>\` against the same clone, policy, adapters, and preview.`;
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
    dependencyProvisioning: preview.dependencyProvisioning,
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
      reason: 'preview-mismatch: the confirmation did not reproduce the activation preview its token names; nothing was registered and no receipt was written.',
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
        summary: `Nothing was activated (preview-mismatch): ${mismatchExplanation('activate', instructionSelectors('activate', selector))}`,
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
      summary: activationSummary(result, shortcut, selector),
    }),
  };
};

/**
 * What recovers each finding `gate status` can report — or the explicit marker
 * that nothing needs recovering.
 *
 * One entry per finding code, and one per control surface for
 * `control-surface-drift`, whose code is shared by every surface. The lines
 * follow `FR-LIFE-019`: a gate-owned Git registration is restored by
 * `gate repair`, which repairs exactly those three findings and nothing else;
 * what the receipt pinned from `.agent-framework.yaml` — the policy's identity
 * and the commands it resolves to — is re-pinned by `gate sync`, the Activation
 * transaction that keeps the adapter set (`TB-062`); everything else the
 * receipt pinned is re-established by a new Activation transaction. A finding
 * with no entry here is a test failure, never a finding nobody is told how to
 * act on (`NFR-OPER-001`, `TB-060`).
 */
export const STATUS_REMEDIES = Object.freeze({
  // An installed clone holds no Gate policy: nothing is enforced, and adopting
  // the Gate is a choice, not a fault.
  'configuration-missing': 'informational',
  'gate-policy-missing': 'informational',
  'repository-unresolved': 'informational',
  'configuration-unreadable': 'correct-configuration',
  'gate-policy-invalid': 'correct-configuration',
  'activation-absent': 'activate',
  'hook-absent': 'repair',
  'hook-block-tampered': 'repair',
  'hook-receipt-mismatch': 'repair',
  // Adapter loss is a reinstall, not a repair (`RISK-004`): a new Activation
  // transaction pins the adapter set this installed gate declares.
  'authoritative-adapter-lost': 'activation-transaction',
  'adapter-lost': 'activation-transaction',
  'adapter-registration-absent': 'activation-transaction',
  'adapter-registration-unverified': 'activation-transaction',
  // Deactivation refuses a client entry that changed underneath it, and the
  // Gate never overwrites a client's own file.
  'adapter-registration-drifted': 'reconcile-client-registration',
  'adapter-registration-ambiguous': 'reconcile-client-registration',
  'control-surface-drift': Object.freeze({
    runtime: 'activation-transaction',
    adapters: 'activation-transaction',
    'managed-hooks': 'repair',
    receipt: 'activation-transaction',
    // Both are pinned from the configuration file, and a sync re-pins both.
    'trusted-configuration': 'sync',
    'command-descriptors': 'sync',
    providers: 'activation-transaction',
  }),
});

/** The order remedies are performed in when a clone needs more than one. */
const REMEDY_ORDER = Object.freeze([
  'correct-configuration',
  'reconcile-client-registration',
  'repair',
  'sync',
  'activation-transaction',
  'activate',
]);

/**
 * One remedy, as the `next:` line says it.
 *
 * A new Activation transaction is the deactivate/activate pair; each half
 * previews and prints its own token. `gate sync` is the scoped one that keeps
 * the adapter set (`TB-062`).
 */
const remedyInstruction = (remedy, command) => ({
  'correct-configuration': `correct ${CONFIGURATION_FILE} so its evaluation_gate policy reads and validates`,
  'reconcile-client-registration': `reconcile the changed client registration by hand — the Gate never overwrites a client's own file — and run ${command} status again`,
  repair: `${command} repair`,
  sync: `${command} sync`,
  'activation-transaction': `${command} deactivate, then ${command} activate — a new Activation transaction that pins what this clone declares now; each previews first and prints the token that confirms it`,
  activate: `${command} activate`,
})[remedy] ?? null;

const remedyFor = (finding) => {
  const entry = STATUS_REMEDIES[finding.code] ?? null;

  return typeof entry === 'string' ? entry : (entry?.[finding.surface] ?? null);
};

/**
 * What a maintainer does next about everything status found, in the order it
 * has to be done, through the clone's own shortcut where activation recorded
 * one. A clone with nothing to act on says `nothing`.
 */
const statusNext = (findings, shortcut) => {
  const command = shortcut ?? 'gate';
  const informational = [];
  const byRemedy = new Map();

  for (const finding of findings) {
    const remedy = remedyFor(finding);

    if (remedy === 'informational') {
      informational.push(finding.code);

      continue;
    }

    // Unreachable while the fixture enumerating every code holds; stated
    // rather than silently dropped if it ever does not.
    const key = remedy ?? `unrecorded:${finding.code}`;

    byRemedy.set(key, [...(byRemedy.get(key) ?? []), finding.surface === undefined ? finding.code : `${finding.code}:${finding.surface}`]);
  }

  // A new Activation transaction pins the configuration too, and a sync
  // refuses a clone whose adapter set changed, so where both are needed the
  // pair alone is named and answers for both.
  if (byRemedy.has('sync') && byRemedy.has('activation-transaction')) {
    byRemedy.set('activation-transaction', [...byRemedy.get('activation-transaction'), ...byRemedy.get('sync')]);
    byRemedy.delete('sync');
  }

  const rank = (remedy) => (REMEDY_ORDER.includes(remedy) ? REMEDY_ORDER.indexOf(remedy) : REMEDY_ORDER.length);
  const remedies = [...byRemedy.entries()]
    .sort(([left], [right]) => rank(left) - rank(right))
    .map(([remedy, codes]) => ({
      remedy,
      instruction: remedyInstruction(remedy, command) ?? `no remedy is recorded for ${codes.join(', ')}; read its finding above`,
      findings: codes,
    }));

  return {
    instruction: remedies.length === 0 ? 'nothing' : remedies.map((remedy) => remedy.instruction).join('; then '),
    shortcut,
    remedies,
    informational,
  };
};

/**
 * The Gate control surface of an activated clone, observed exactly as the
 * runners observe it before every evaluation.
 *
 * The same `observeControlSurface`, over the same configuration read and the
 * same runner pinning, so status and the next commit can never disagree about
 * whether this clone drifted: one observation, two readers (`TB-060`). Pinning
 * re-observes each executable with a single `access(2)` and composes each
 * argument vector in-process; no pinned program is started and nothing is
 * written. A pin the runners would refuse resolves nothing here, and the
 * descriptor surface then reports the drift the commit would be denied for.
 */
const observeStatusControlSurface = async ({ repositoryRoot, receipt }) => {
  const configuration = await resolveConfiguration(repositoryRoot);
  const { checks } = configuration.ok
    ? gateChecksFromConfiguration(configuration.configuration)
    : { checks: [] };
  const runners = await pinnedRunners(checks, { receipt, compose: composeArguments });
  const surface = await observeControlSurface({
    activation: { receipt },
    configuration,
    resolved: runners.ok ? runners.resolved : new Map(),
  });

  return { ...surface, configuration };
};

/**
 * Say which file moved when the trusted configuration drifted.
 *
 * The receipt pins an identity, not a document, so no diff is available; what
 * is known is that the file on disk no longer produces the identity activation
 * pinned, and that every evaluation is graded against the pinned policy until
 * `gate sync` pins this one. The finding's code and severity are unchanged.
 */
const namedConfigurationDrift = (finding, { repositoryRoot, configuration }) => {
  if (finding.code !== 'control-surface-drift' || finding.surface !== 'trusted-configuration') {
    return finding;
  }

  return {
    ...finding,
    path: path.join(repositoryRoot, CONFIGURATION_FILE),
    detail: [
      finding.detail,
      `${CONFIGURATION_FILE} changed since this clone was activated, and every evaluation is graded against the policy the receipt pinned, not the file, until \`gate sync\` pins it.`,
      ...(configuration.ok ? [] : [`It no longer resolves to a Gate policy at all: ${configuration.detail}`]),
    ].join(' '),
  };
};

/**
 * `gate status` — reconcile desired against actual state and report it.
 *
 * A clone with no receipt has nothing to open and nothing to reconcile, so no
 * store is opened for it. `statusGate` already answers that case from a null
 * store, and it is the one that answers it here. This is the only command with
 * no confirmed form, and it must go on recording nothing at all.
 *
 * An activated clone is reconciled against the whole control surface the
 * receipt pinned — the configuration included — and not only its adapter
 * registrations, which is what let a status report `healthy` over a policy the
 * next commit was denied for (`NFR-SEC-004`, `AC-SEC-001`, `TB-060`).
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

  const surface = clone.receipt === null
    ? null
    : await observeStatusControlSurface({ repositoryRoot, receipt: clone.receipt });
  const status = await statusGate({
    evidenceStore: clone.store,
    repositoryRoot,
    adapters: clone.receipt === null ? null : observedAdapters(clone.receipt),
    controlSurface: surface?.observed ?? null,
  });
  const findings = surface === null
    ? status.findings
    : status.findings.map((finding) => namedConfigurationDrift(finding, {
      repositoryRoot,
      configuration: surface.configuration,
    }));
  const shortcut = await recordedCommandAlias({
    repositoryRoot,
    command: PACKAGED_COMMAND,
    runGit: (args) => runGit(repositoryRoot, args),
  }) ? `git ${COMMAND_ALIAS_NAME}` : null;

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
      findings,
      // What was observed, and which pinned surfaces it no longer matches.
      controlSurface: surface === null ? null : {
        observed: surface.observed,
        drifted: findings
          .filter((finding) => finding.code === 'control-surface-drift')
          .map((finding) => finding.surface),
      },
      next: statusNext(findings, shortcut),
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
      reason: 'preview-mismatch: the confirmation did not reproduce the deactivation preview its token names; nothing was removed and nothing was repaired.',
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
        summary: `Nothing was removed (preview-mismatch): ${mismatchExplanation('deactivate', [])}`,
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
      reason: 'preview-mismatch: the confirmation did not reproduce the uninstall preview its token names; nothing was removed.',
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
        summary: `Nothing was removed (preview-mismatch): ${mismatchExplanation('uninstall', instructionSelectors('uninstall', selector))}`,
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

/**
 * The identity of the staged snapshot as a commit would create it.
 *
 * Learned the way the authoritative runner learns it and by nothing else: the
 * index is materialized through `captureSnapshot` into a fresh execution root
 * under the runners' own lifecycle, its identity is read back from that root,
 * and the root is released. No declared dependency root is provided — a
 * provided root is outside the identity by construction (`SG-EVAL-001`), so
 * the identity this reads is the identity the hook will compute for the same
 * index, and a grant bound to it binds to exactly the tree the commit grades
 * (`FR-POL-006`, `NFR-REL-001`).
 */
const stagedSnapshotIdentity = async (repositoryRoot) => {
  const executionRoot = await createExecutionRoot('gate-bypass-exec-');

  try {
    const captured = await captureSnapshot({
      repositoryRoot,
      kind: 'git-index',
      executionRoot,
      runGit,
    });

    return captured.captured === true
      ? { ok: true, snapshotId: captured.snapshot.id, changedPaths: captured.changedPaths }
      : { ok: false, reasonCode: captured.reasonCode, detail: captured.detail };
  } finally {
    await releaseExecutionRoot(executionRoot);
  }
};

/**
 * `gate bypass` — grant one one-shot bypass of the staged snapshot, in two
 * invocations.
 *
 * Until `TB-052` the bypass subcontract was inert: `resolveBypass` refused
 * without a grant, and nothing a maintainer could run ever produced one. A
 * policy that read `enabled: true` changed nothing and said nothing. This is
 * where a grant comes from, and the only place: an explicit operator act, in
 * its own process, before the commit, bound to the exact snapshot that commit
 * would create. The authoritative runner reads the grant once and spends it.
 *
 * The preview applies the policy's OWN bypass rule to the grant it would write
 * — `resolveBypass`, with no ledger to consume and no decision to bypass — so
 * a disabled policy, an unconfigured marker, a missing reason, or a missing
 * policy-required reference is refused here by the code the hook would refuse
 * it with, rather than by a second copy of the rule kept on this surface
 * (`SG-BYP-001`). What cannot be known before the commit is not claimed: which
 * checks fail is decided when the commit is graded, and a commit that passes
 * on its own is `nothing-to-bypass` then.
 *
 * The confirmation token binds the snapshot identity, so staging anything
 * between the preview and the confirmation refuses the confirmation. The grant
 * binds the same identity, so staging anything between the grant and the
 * commit refuses the grant as `snapshot-mismatch` (`FR-POL-006`).
 */
const operateBypass = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const configuration = await resolveConfiguration(repositoryRoot);

  if (!configuration.ok) {
    return failure({
      command: 'bypass',
      reasonCode: configuration.reasonCode,
      detail: `${configuration.detail} A bypass is granted against this clone's own Gate policy, and there is none to grant it against.`,
    });
  }

  const clone = await resolveClone({ repositoryRoot, environment, command: 'bypass' });

  if (clone.failed) {
    return clone.failed;
  }

  const staged = await stagedSnapshotIdentity(repositoryRoot);

  if (!staged.ok) {
    return failure({
      command: 'bypass',
      reasonCode: staged.reasonCode,
      detail: `the staged snapshot could not be identified, so no grant can bind to it: ${staged.detail}`,
    });
  }

  const policy = configuration.policy;
  const requested = {
    snapshotId: staged.snapshotId,
    actor: selector.actor,
    reason: selector.reason,
    reference: selector.reference,
  };
  // The policy's own rule, applied to the grant this invocation would write.
  // `outcome: null` is "not yet graded": the only rejection it cannot produce
  // is `nothing-to-bypass`, which belongs to the commit.
  const resolved = resolveBypass({
    grant: { ...requested, requestedAt: null },
    policy,
    snapshotId: staged.snapshotId,
    outcome: null,
    checks: [],
    ledger: null,
  });
  const grantable = resolved?.applied === true;
  const pending = bypassGrantFrom(await clone.store.bypassGrant().read().catch(() => null));
  const observation = {
    state: 'activated',
    policy: {
      enabled: policy?.bypass?.enabled === true,
      requireReference: policy?.bypass?.require_reference === true,
      marker: policy?.bypass?.marker ?? null,
    },
    snapshotId: staged.snapshotId,
    changedPaths: staged.changedPaths,
    grant: {
      reason: resolved?.reason ?? null,
      reference: resolved?.reference ?? null,
      // Carried, never asserted. See `SELF_DECLARED`.
      actor: selector.actor === null ? null : { name: selector.actor, source: SELF_DECLARED },
    },
    grantable,
    rejectionCode: grantable ? null : (resolved?.rejectionCode ?? null),
    // A grant already waiting for the next commit, if any. A confirmation here
    // replaces it: there is one pending grant per clone, never a queue.
    pending: pending === null
      ? null
      : { snapshotId: pending.snapshotId, reason: pending.reason, requestedAt: pending.requestedAt },
    confirmationToken: grantable
      ? contentIdentity({
        operation: 'bypass',
        snapshotId: staged.snapshotId,
        reason: resolved.reason,
        reference: resolved.reference,
        actor: selector.actor,
        marker: resolved.marker,
        requireReference: policy?.bypass?.require_reference === true,
        configurationIdentity: clone.receipt?.configuration?.identity ?? null,
      })
      : null,
  };

  if (confirmation === null) {
    return { command: 'bypass', healthy: grantable, observation, mutation: null };
  }

  const refuse = async (reasonCode, summary) => {
    await recordSurfaceRefusal({
      evidenceStore: clone.store,
      type: 'bypass',
      before: staged.snapshotId,
      reason: `${reasonCode}: ${summary}`,
    });

    return {
      command: 'bypass',
      healthy: false,
      observation,
      mutation: mutation({ confirmation, performed: false, reasonCode, summary }),
    };
  };

  if (!grantable) {
    return refuse(
      observation.rejectionCode,
      `Nothing was granted (${observation.rejectionCode}): this clone's Gate policy refuses the bypass this invocation asked for, and a confirmation cannot change that.`,
    );
  }

  if (confirmation !== observation.confirmationToken) {
    return refuse(
      'preview-mismatch',
      `Nothing was granted (preview-mismatch): ${mismatchExplanation('bypass', instructionSelectors('bypass', selector))}`,
    );
  }

  const requestedAt = new Date().toISOString();
  const identified = resolveBypass({
    grant: { ...requested, requestedAt },
    policy,
    snapshotId: staged.snapshotId,
    outcome: null,
    checks: [],
    ledger: null,
  });
  // The five identity fields are stored exactly as the identity was computed
  // over them, so the id the hook derives from this file is `grantId`.
  const grant = {
    grantVersion: BYPASS_GRANT_VERSION,
    grantId: identified.id,
    snapshotId: staged.snapshotId,
    actor: selector.actor,
    reason: selector.reason,
    reference: selector.reference,
    requestedAt,
    marker: identified.marker,
  };

  await clone.store.bypassGrant().write(grant);
  await clone.store.appendLifecycleEvent({
    type: 'bypass',
    before: staged.snapshotId,
    after: grant.grantId,
    outcome: 'succeeded',
    reason: `A one-shot bypass grant was written for snapshot ${staged.snapshotId}; it is spent by the next commit attempt, and applies only if that commit grades exactly this snapshot.`,
  });

  return {
    command: 'bypass',
    healthy: true,
    observation: { ...observation, pending: { snapshotId: grant.snapshotId, reason: grant.reason, requestedAt } },
    mutation: mutation({
      confirmation,
      performed: true,
      grantId: grant.grantId,
      snapshotId: grant.snapshotId,
      marker: grant.marker,
      summary: `One one-shot bypass grant ${grant.grantId} was written for snapshot ${grant.snapshotId}${pending === null ? '' : ', replacing the grant that was pending'}. The next commit attempt spends it: if it grades exactly this snapshot and would otherwise be denied, the commit proceeds as bypassed — never passed — with every failed check preserved, and the marker ${JSON.stringify(grant.marker)} is printed for the commit message. Stage anything else and it is refused as snapshot-mismatch.`,
    }),
  };
};

/**
 * The Trusted configuration as this clone's history holds it.
 *
 * An Activation receipt pins the configuration's identity and not the policy,
 * so a sync that must judge a transition against the Trusted policy has to
 * recover the document. The committed `.agent-framework.yaml` at `HEAD` is the
 * one place it ordinarily still is — a drifted clone denies every commit, so
 * the edit being synced is normally not committed yet. What is read here is
 * only a candidate: `previewSync` accepts it only if it reproduces the
 * identity the receipt pinned (`FR-CFG-005`, `TB-062`).
 */
const committedConfiguration = async (repositoryRoot) => {
  const contents = await runGit(repositoryRoot, ['show', `HEAD:${CONFIGURATION_FILE}`]).catch(() => null);
  const parsed = contents === null ? null : parseConfigurationDocument(contents);

  if (parsed?.ok !== true) {
    return null;
  }

  return {
    schemaVersion: parsed.value?.schema_version ?? null,
    policy: parsed.value?.evaluation_gate ?? null,
    source: 'committed-configuration',
  };
};

/** Why a sync preview offers no token, and what to do instead. */
const SYNC_REFUSALS = Object.freeze({
  'nothing-to-sync': Object.freeze({
    detail: 'the configuration and the commands it resolves to are exactly what the receipt pins',
    next: 'nothing to sync',
  }),
  'weakening-unacknowledged': Object.freeze({
    detail: 'the candidate is weaker than the trusted policy that authorized this clone, and a weaker candidate is pinned only when the invocation acknowledges the weakening by name',
    next: 'gate sync --acknowledge-weakening',
  }),
  'receipt-drifted': Object.freeze({
    detail: 'the Activation receipt no longer reproduces its own identity, and a sync never re-pins on top of a receipt that changed',
    next: 'gate deactivate, then gate activate',
  }),
  'adapter-set-changed': Object.freeze({
    detail: 'the installed gate no longer declares the adapter set the receipt pins; a sync keeps that set and never changes it',
    next: 'gate deactivate, then gate activate',
  }),
  'hook-registration-drifted': Object.freeze({
    detail: 'the gate-owned Git registration is not the one the receipt pins, and a sync keeps registrations rather than rewriting them',
    next: 'gate repair',
  }),
  'hook-registration-not-reproducible': Object.freeze({
    detail: 'the registered hook program is not the one this installed gate would register, so keeping the registration would pin a program this sync did not preview',
    next: 'gate deactivate, then gate activate',
  }),
  'adapter-registration-changed': Object.freeze({
    detail: 'a client registration the receipt pins is not the entry this sync would keep, and a sync never rewrites one',
    next: 'gate status',
  }),
  'trusted-configuration-unrecoverable': Object.freeze({
    detail: `no document reproduces the configuration identity the receipt pins — not the receipt, not ${CONFIGURATION_FILE} at HEAD — so the transition cannot be judged against the trusted policy`,
    next: 'gate deactivate, then gate activate',
  }),
  'candidate-policy-invalid': Object.freeze({
    detail: 'the candidate policy does not validate on its own terms',
    next: `correct ${CONFIGURATION_FILE} so its evaluation_gate policy reads and validates`,
  }),
});

/** Everything one sync of THIS clone would be, resolved from the clone itself. */
const syncRequestFor = async ({ repositoryRoot, receipt, selector }) => {
  const configuration = await resolveConfiguration(repositoryRoot);

  if (!configuration.ok) {
    return {
      failed: failure({
        command: 'sync',
        reasonCode: configuration.reasonCode,
        detail: `${configuration.detail} Sync pins the configuration this clone declares, and there is none it could pin; correct ${CONFIGURATION_FILE} first.`,
      }),
    };
  }

  const { checks, errors } = gateChecksFromConfiguration(configuration.configuration);

  if (errors.length > 0) {
    return {
      failed: failure({
        command: 'sync',
        reasonCode: 'check-descriptors-invalid',
        detail: `this clone's configured verification commands cannot be resolved into checks: ${errors.map((error) => `${error.path}: ${error.message}`).join(' ')}`,
      }),
    };
  }

  return {
    request: {
      scope: 'repository',
      trigger: 'explicit',
      repository: { root: repositoryRoot },
      configuration: {
        schemaVersion: configuration.configuration?.schema_version ?? null,
        policy: configuration.policy,
      },
      runtime: {
        // The program activation registers, and so the one whose registration
        // a sync can prove it is keeping.
        hookProgram: {
          interpreter: process.execPath,
          script: PACKAGED_HOOK_PROGRAM,
          args: [],
        },
      },
      checks,
      runtimeInputs: declaredSensitiveInputs(configuration.policy),
      prior: receipt,
      trusted: await committedConfiguration(repositoryRoot),
      acknowledgeWeakening: selector.acknowledgeWeakening === true,
    },
  };
};

/**
 * `gate sync` — re-pin a changed configuration in one consented step, keeping
 * the adapters this clone already has (`TB-062`).
 *
 * It is `gate activate` with the adapter set read from the receipt instead of a
 * `--client` selector, one more section in the preview, and no registration
 * written. The preview names the Trusted and candidate identities and every
 * weakening `evaluatePolicyTransition` finds between them; a weaker candidate
 * offers no token unless the invocation acknowledges the weakening, and the
 * token then binds the candidate and the acknowledgement together — the
 * candidate-hash approval `FR-CFG-005` requires. Confirming it runs
 * `syncActivation`, which re-derives all of it and refuses anything that moved.
 *
 * Adding or removing an adapter is still `activate` and `deactivate`, and the
 * preview says so rather than guessing a set (`FR-LIFE-019`, `SG-LIFE-001`).
 */
const operateSync = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const existing = await resolveReceipt(repositoryRoot);

  if (!existing.ok) {
    return failure({
      command: 'sync',
      reasonCode: existing.reasonCode,
      detail: existing.reasonCode === 'activation-receipt-missing'
        ? `${existing.detail} A sync re-pins an activated clone; run \`gate activate\` instead.`
        : existing.detail,
    });
  }

  const resolved = await syncRequestFor({ repositoryRoot, receipt: existing.receipt, selector });

  if (resolved.failed) {
    return resolved.failed;
  }

  const { request } = resolved;
  const dependencies = { runGit, environment };
  let preview;

  try {
    preview = await previewSync(request, dependencies);
  } catch (error) {
    return failure({
      command: 'sync',
      reasonCode: 'sync-unpreviewable',
      detail: `this clone cannot be previewed for a sync (${error.message}); nothing was written.`,
    });
  }

  const refusal = preview.refusal === null ? null : {
    reasonCode: preview.refusal.reasonCode,
    detail: SYNC_REFUSALS[preview.refusal.reasonCode]?.detail ?? null,
    errors: preview.refusal.errors,
  };
  const observation = {
    state: 'activated',
    receiptId: preview.receiptId,
    release: preview.release,
    repositoryIdentity: preview.repository.identity,
    trusted: preview.trusted,
    candidate: preview.candidate,
    transition: preview.transition,
    acknowledgedWeakening: preview.acknowledgedWeakening,
    adapters: preview.adapters,
    hook: preview.hook,
    adapterRegistrations: preview.adapterRegistrations,
    commands: preview.commands,
    unresolved: preview.unresolved,
    dependencyRoots: preview.dependencyRoots,
    dependencyProvisioning: preview.dependencyProvisioning,
    runtimeInputs: preview.runtimeInputs,
    refusal,
    confirmationToken: refusal === null ? preview.previewId : null,
  };
  const nothingToDo = refusal?.reasonCode === 'nothing-to-sync';

  if (confirmation === null) {
    return { command: 'sync', healthy: refusal === null || nothingToDo, observation, mutation: null };
  }

  const clone = await resolveClone({ repositoryRoot, environment, command: 'sync' });

  if (clone.failed) {
    return clone.failed;
  }

  const refuse = async (reasonCode, summary) => {
    await recordSurfaceRefusal({
      evidenceStore: clone.store,
      type: 'activation',
      before: confirmation,
      reason: `${reasonCode}: ${summary}`,
    });

    return {
      command: 'sync',
      healthy: false,
      observation,
      mutation: mutation({ confirmation, performed: false, reasonCode, summary }),
    };
  };

  if (refusal !== null) {
    return refuse(
      refusal.reasonCode,
      `Nothing was re-pinned (${refusal.reasonCode}): ${refusal.detail ?? 'this clone refuses the sync this invocation asked for'}, and a confirmation cannot change that.`,
    );
  }

  if (confirmation !== preview.previewId) {
    return refuse(
      'preview-mismatch',
      `Nothing was re-pinned (preview-mismatch): ${mismatchExplanation('sync', instructionSelectors('sync', selector))}`,
    );
  }

  const consent = {
    previewId: preview.previewId,
    repositoryIdentity: preview.repository.identity,
    configurationIdentity: preview.candidate.identity,
    actor: null,
    grantedAt: new Date().toISOString(),
  };
  const result = await syncActivation({ ...request, consent }, {
    ...dependencies,
    evidenceStore: clone.store,
    // The same three seams `gate activate` binds, bound the same way and
    // replaceable from nothing on the argument vector.
    establishTrust: createTrustEstablishment({ consent, actor: null }),
    selfTestEvaluation: () => selfTestEvaluationDenial({
      runnerVersion: existing.receipt.runtime?.runnerVersion ?? null,
    }),
    selfTestAdapter: selfTestAdapterSurface,
  });
  const synced = result.activated === true;

  return {
    command: 'sync',
    healthy: synced,
    observation,
    mutation: mutation({
      confirmation,
      performed: synced,
      reasonCode: result.reasonCode,
      step: result.step,
      order: result.order,
      state: result.state,
      priorReceiptId: preview.receiptId,
      receiptId: result.receipt?.receiptId ?? null,
      transition: result.transition ?? null,
      rollback: result.rollback,
      errors: result.errors ?? [],
      summary: synced
        ? `The configuration ${preview.candidate.identity} is pinned: the receipt ${result.receipt.receiptId} replaced ${preview.receiptId} by one atomic write, every registration was kept byte for byte, and the next evaluation is graded under it.${result.transition?.weakened ? ` It is weaker than the policy it replaced, and that weakening was acknowledged by the token confirmed here: ${result.transition.weakenings.map((weakening) => `${weakening.code} ${weakening.checkId}`).join(', ')}.` : ''}`
        : (result.state === 'recovery-required'
          ? `The sync failed at ${result.step} (${result.reasonCode}) and could not be fully rolled back; this clone requires recovery: ${result.rollback.remains.join(' ')}`
          : `Nothing was re-pinned (${result.reasonCode}): the sync failed at ${result.step}, and the receipt ${preview.receiptId} and every registration are exactly as they were.`),
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
  bypass: operateBypass,
  sync: operateSync,
});

/** The envelope every rendering is made from, whether the command ran or not. */
const documentOf = ({ command, repositoryRoot, result, selector = null }) => {
  const failed = result.failure !== undefined;
  const resolvedCommand = result.command ?? command ?? null;
  const exitStatus = failed
    ? EXIT_UNRUNNABLE
    : (result.healthy ? EXIT_OBSERVED : EXIT_UNHEALTHY);

  return {
    document: DOCUMENT_VERSION,
    gate: GATE_ID,
    command: resolvedCommand,
    ok: !failed && result.healthy === true,
    exitStatus,
    repository: { root: repositoryRoot },
    // The value selectors THIS invocation carried, as the parser read them and
    // as the argument vector that would reproduce them. The `next:` line is
    // composed from these, so the instruction a preview prints is a statement
    // about the invocation that produced the preview rather than a template
    // built from the command's name (`FR-LIFE-004`, `TB-053`).
    invocation: {
      selectors: failed || resolvedCommand === null ? [] : instructionSelectors(resolvedCommand, selector),
    },
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

/**
 * The one line every confirmable command ends its preview with.
 *
 * It is composed from the invocation the document records, so it carries every
 * selector that shaped the preview — once per value for a repeatable one, and
 * quoted wherever a shell would otherwise split or interpret it — followed by
 * the confirmation selector and the token. A command whose invocation carried
 * no selector prints exactly the line it always printed (`TB-053`).
 *
 * After a REFUSED confirmation the line names the preview invocation and no
 * token. The token this invocation recomputed is the token of the operation
 * this invocation described, which is by definition not the one the operator
 * confirmed; offered beside the refusal it is one paste from performing an
 * operation nobody read — which is exactly how a `--client cursor` preview
 * became a git activation. The recomputed preview is still rendered above,
 * so nothing is hidden; what is withheld is the shortcut past reading it.
 */
const renderConfirmation = (command, observation, document = {}) => {
  const token = observation.confirmationToken ?? null;

  if (token === null) {
    return line('next', 'nothing to confirm');
  }

  const preview = previewInstruction(command, document.invocation?.selectors ?? []);

  if (document.mutation?.performed === false) {
    return line('next', preview);
  }

  return line('next', `${preview} ${CONFIRMABLE_COMMANDS[command]} ${token}`);
};

/**
 * The dependency roots line of an activation preview.
 *
 * Under one strategy for every root the line reads exactly as it did before
 * `TB-057`. Under a per-root map each root carries its own strategy, so what
 * a maintainer confirms is the mixed provisioning they declared, not a
 * summary of it (`FR-LIFE-004`, `NFR-OPER-001`).
 */
const renderDependencyRoots = ({ dependencyRoots, dependencyProvisioning }) => {
  if (dependencyRoots.length === 0) {
    return typeof dependencyProvisioning === 'string'
      ? `none (provided by ${dependencyProvisioning})`
      : 'none';
  }

  if (typeof dependencyProvisioning === 'string') {
    return `${dependencyRoots.join(', ')} (provided by ${dependencyProvisioning})`;
  }

  return dependencyRoots
    .map((root) => `${root} (${dependencyProvisioning?.[root] ?? 'unstated'})`)
    .join(', ');
};

const renderActivate = (observation, document) => [
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
  line('dependency roots', renderDependencyRoots(observation)),
  line('runtime inputs', observation.runtimeInputs.join(', ') || 'none'),
  line('shortcut', `${observation.shortcut.name} (${observation.shortcut.kind})`),
  renderConfirmation('activate', observation, document),
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
  line('next', observation.next.instruction),
];

const renderLocks = (observation, document) => [
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
  renderConfirmation('locks', observation, document),
];

const renderPrune = (observation, document) => [
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
    : renderConfirmation('prune', observation, document),
];

const renderRepair = (observation, document) => [
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
    : renderConfirmation('repair', observation, document),
];

const renderRelease = (release) => (release === null
  ? 'none'
  : `${release.id ?? 'unknown'} ${release.version ?? 'unknown'} (protocol ${release.protocolVersion ?? 'unknown'})`);

const renderUpdate = (observation, document) => [
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
    ? renderConfirmation('update', observation, document)
    : line('next', 'the installed distribution offers no new release'),
];

const renderDeactivate = (observation, document) => [
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
  renderConfirmation('deactivate', observation, document),
];

const renderUninstall = (observation, document) => [
  line('assets', observation.assets.length),
  ...observation.assets.map(
    (asset) => `  - ${asset.path} (present ${asset.present}) ${asset.identity ?? 'no identity'}`,
  ),
  line('preserved', observation.preserved.join(', ')),
  observation.assets.length === 0
    ? line('next', 'name the project-installed assets with --asset <path>')
    : renderConfirmation('uninstall', observation, document),
];

const renderCleanup = (observation, document) => [
  line('configuration', observation.path),
  line('keys', observation.keys.length),
  ...observation.keys.map((key) => `  - ${key.key} lines ${key.startLine}-${key.endLine}`),
  line('file deleted', observation.fileDeleted),
  observation.keys.length === 0
    ? line('next', 'nothing to remove')
    : renderConfirmation('cleanup', observation, document),
];

/** Why a preview offers no token, in the policy's own rejection words. */
const BYPASS_REFUSALS = Object.freeze({
  'bypass-disabled': 'this clone\'s Gate policy disables bypass; nothing can be granted',
  'marker-unconfigured': 'this clone\'s Gate policy enables bypass with no commit-visible marker; nothing can be granted',
  'reason-missing': 'name the reason with --reason <text>',
  'reference-missing': 'this clone\'s Gate policy requires a reference; name it with --reference <ref>',
});

const renderBypass = (observation, document) => [
  line('bypass policy', `${observation.policy.enabled ? 'enabled' : 'disabled'} (marker ${observation.policy.marker ?? 'none'}, reference ${observation.policy.requireReference ? 'required' : 'optional'})`),
  line('snapshot', observation.snapshotId),
  line('staged paths', observation.changedPaths.length),
  ...observation.changedPaths.map((changed) => `  - ${changed}`),
  line('reason', observation.grant.reason ?? 'none'),
  line('reference', observation.grant.reference ?? 'none'),
  line('actor', observation.grant.actor === null ? 'none' : `${observation.grant.actor.name} (${observation.grant.actor.source})`),
  line('pending grant', observation.pending === null ? 'none' : `${observation.pending.snapshotId} (${observation.pending.requestedAt})`),
  line('grantable', observation.grantable),
  observation.grantable
    ? renderConfirmation('bypass', observation, document)
    : line('next', BYPASS_REFUSALS[observation.rejectionCode] ?? `nothing to grant (${observation.rejectionCode})`),
];

const renderSync = (observation, document) => {
  const { transition } = observation;
  const weakenings = transition?.weakenings ?? [];
  const next = () => {
    if (observation.refusal === null) {
      return renderConfirmation('sync', observation, document);
    }

    return line('next', SYNC_REFUSALS[observation.refusal.reasonCode]?.next ?? `nothing to confirm (${observation.refusal.reasonCode})`);
  };

  return [
    line('state', observation.state),
    line('receipt', observation.receiptId ?? 'none'),
    line('release', renderRelease(observation.release)),
    line(
      'trusted configuration',
      `${observation.trusted.identity ?? 'none'} (${observation.trusted.source === null ? 'unrecoverable' : `read from ${observation.trusted.source}`})`,
    ),
    line('candidate configuration', observation.candidate.identity),
    // The heading nobody can miss: the transition is judged, and a weaker
    // candidate says so in capitals before anything else is read.
    line('policy transition', transition === null
      ? 'cannot be judged: the trusted policy could not be recovered'
      : (transition.weakened
        ? `WEAKER than the trusted policy (${weakenings.length})`
        : 'not weaker than the trusted policy')),
    ...weakenings.map((weakening) => `  - ${weakening.code} ${weakening.checkId}: ${weakening.detail}`),
    ...(transition?.weakened ? [line('weakening acknowledged', observation.acknowledgedWeakening)] : []),
    line('adapters kept', observation.adapters.map((adapter) => adapter.id).join(', ') || 'none'),
    line('registrations kept', 1 + observation.adapterRegistrations.length),
    `  - ${observation.hook.hook} ${observation.hook.path ?? 'unregistered'} (${observation.hook.ownership}, ${observation.hook.action})`,
    ...observation.adapterRegistrations.map(
      (registration) => `  - ${registration.adapter} ${registration.path ?? 'unregistered'} (${registration.state}, ${registration.action})`,
    ),
    line('commands', observation.commands.length),
    ...observation.commands.map(
      (command) => `  - ${command.check_id} ${command.runner} ${command.executable} ${command.version ?? 'unversioned'}`,
    ),
    line('unresolved', observation.unresolved.length),
    ...observation.unresolved.map((entry) => `  - ${JSON.stringify(entry)}`),
    line('dependency roots', renderDependencyRoots(observation)),
    line('runtime inputs', observation.runtimeInputs.join(', ') || 'none'),
    line('refusal', observation.refusal === null
      ? 'none'
      : `${observation.refusal.reasonCode}: ${observation.refusal.detail ?? 'see its errors'}`),
    next(),
  ];
};

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
  bypass: renderBypass,
  sync: renderSync,
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
  ...RENDERERS[document.command](document.observation, document),
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
      selector: parsed.selector ?? null,
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
    selector: parsed.selector,
  }));
};
