import { CONSENT_CHANNELS } from '../lifecycle-event.mjs';
import { COMMANDS, CONFIRMABLE_COMMANDS, CONFIRMATION_TOKEN, CONFIRMED_COMMANDS, CONFIRMED_SELECTORS, SELECTORS, SELECTOR_FIELDS, UNOWNED_MUTATION_FLAGS } from './constants.mjs';
import { failure } from './outcomes.mjs';

/**
 * Read one invocation's argument vector.
 *
 * `--json` is recognized the way every other capability in this skill already
 * recognizes it — a plain membership test on the argument vector — so the
 * surface applies the repository's own convention rather than importing or
 * inventing a different one, and adds no dependency to parse its flags.
 */
export const parseArguments = (argv) => {
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
    staged: null,
    consentChannel: null,
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

    if (argument === '--consent-channel') {
      // A closed vocabulary, so a record never carries text a caller made up.
      if (!CONSENT_CHANNELS.includes(value)) {
        return {
          json,
          ...failure({
            command,
            reasonCode: 'selector-invalid',
            detail: `--consent-channel names the channel a confirmation arrived through: ${CONSENT_CHANNELS.join(', ')}; ${JSON.stringify(value)} is not one.`,
          }),
        };
      }

      selector.consentChannel = value;
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
