import { readFile } from 'node:fs/promises';

import { revisionRefusal } from '../refusals.mjs';
import { isPlainObject } from '../values.mjs';

/** A value as JSON with every object's keys sorted, so two spellings of one value compare equal. */
const canonicalJson = (value) => JSON.stringify(value, (key, entry) => (
  isPlainObject(entry) ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => (left < right ? -1 : Number(left > right)))) : entry
));

/** A client hooks file as JSON in `indent`, with or without a final newline. */
export const renderSettings = (settings, finalNewline, indent) => `${JSON.stringify(settings, null, indent)}${finalNewline ? '\n' : ''}`;

/**
 * Read a client hooks file the guardrail can be merged into or removed from
 * without changing anything else. A missing file reads as the client's seed.
 * A file that is not JSON, whose hooks are not where the client reads them, or
 * that does not round-trip — re-rendered in the client's indentation it is not
 * the same bytes, as with other or mixed indentation, a key declared twice, or
 * CRLF line ends — is refused: rewriting it would change bytes outside the
 * guardrail entry.
 */
export const readClientSettings = async (settingsPath, client) => {
  const { file, event } = client;

  let contents;

  try {
    contents = await readFile(settingsPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { contents: null, settings: client.seed(), finalNewline: true, indent: 2 };
    }

    throw error;
  }

  let settings;

  try {
    settings = JSON.parse(contents);
  } catch (error) {
    throw revisionRefusal('settings-unparseable', `${file} is not JSON (${error.message}). Nothing was written; fix it by hand, then run this again.`);
  }

  const unrevisable = (reason) => revisionRefusal('settings-unrevisable', `${file} ${reason}, so it cannot be rewritten with only the guardrail entry changed. Nothing was written; edit it by hand.`);

  if (!isPlainObject(settings)) {
    throw unrevisable('is not a JSON object');
  }

  if (settings.hooks !== undefined && !isPlainObject(settings.hooks)) {
    throw unrevisable('declares "hooks" as something other than an object');
  }

  if (settings.hooks?.[event] !== undefined && !Array.isArray(settings.hooks[event])) {
    throw unrevisable(`declares "hooks.${event}" as something other than a list`);
  }

  const finalNewline = contents.endsWith('\n');
  const indent = client.indentation(contents);

  if (renderSettings(settings, finalNewline, indent) !== contents) {
    throw unrevisable(`is not written ${client.writtenAs}`);
  }

  return { contents, settings, finalNewline, indent };
};

/**
 * The lines that differ between two texts: the first changed line, what is
 * removed and added there, and the unchanged line on each side (`null` at
 * either end of the file).
 */
export const changedLines = (before, after) => {
  const old = before === '' ? [] : before.split('\n');
  const proposed = after.split('\n');
  let start = 0;
  let end = 0;

  while (start < old.length && start < proposed.length && old[start] === proposed[start]) {
    start += 1;
  }

  while (
    end < old.length - start
    && end < proposed.length - start
    && old[old.length - 1 - end] === proposed[proposed.length - 1 - end]
  ) {
    end += 1;
  }

  return {
    line: start + 1,
    before: proposed[start - 1] ?? null,
    removed: old.slice(start, old.length - end),
    added: proposed.slice(start, proposed.length - end),
    after: end === 0 ? null : proposed[proposed.length - end],
  };
};

/** The settings with the guardrail's entry appended, or a refusal when its hook is already there. */
export const withGuardrail = (settings, client, entry) => {
  const { event } = client;
  const groups = settings.hooks?.[event] ?? [];
  const [hook] = client.hooksOf(entry);

  if (groups.some((group) => Array.isArray(client.hooksOf(group)) && client.hooksOf(group).some((registered) => canonicalJson(registered) === canonicalJson(hook)))) {
    throw revisionRefusal('guardrail-registered', `The guardrail is already registered under hooks.${event}. Nothing was written.`);
  }

  const candidate = structuredClone(settings);

  candidate.hooks = candidate.hooks ?? {};
  candidate.hooks[event] = [...groups, entry];

  return candidate;
};

/**
 * The settings without the one entry the guardrail's add wrote. A list that
 * only it filled is removed with it, and so is a `hooks` object left empty,
 * unless the client keeps one.
 */
export const withoutGuardrail = (settings, client, entry) => {
  const { event, noun } = client;
  const groups = settings.hooks?.[event] ?? [];
  const matching = groups.flatMap((group, index) => (canonicalJson(group) === canonicalJson(entry) ? [index] : []));

  if (matching.length === 0) {
    throw revisionRefusal(
      'guardrail-not-registered',
      `No hooks.${event} ${noun} is the one guardrail add writes for this script, so there is nothing to remove. A hand-written entry that runs it is left for you to remove by hand. Nothing was written.`,
    );
  }

  if (matching.length > 1) {
    throw revisionRefusal('guardrail-ambiguous', `hooks.${event} holds the guardrail's ${noun} ${matching.length} times; remove the extra copies by hand. Nothing was written.`);
  }

  const candidate = structuredClone(settings);
  const remaining = groups.filter((group, index) => index !== matching[0]);

  if (remaining.length === 0) {
    delete candidate.hooks[event];
  } else {
    candidate.hooks[event] = remaining;
  }

  if (Object.keys(candidate.hooks).length === 0 && !client.keepsEmptyHooks) {
    delete candidate.hooks;
  }

  return candidate;
};
