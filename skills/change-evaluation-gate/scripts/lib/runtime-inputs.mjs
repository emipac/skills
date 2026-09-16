/**
 * Resolution of approved Sensitive runtime inputs: from a name the Activation
 * receipt pinned to the value a check receives.
 *
 * The receipt carries names, never values (`FR-CFG-006`). Somebody has to turn
 * each approved name into a value at evaluation time, and this module is that
 * somebody — the one place that reads a value from anywhere. Its output feeds
 * two consumers from one resolution: the materializer that hands the value to
 * the check, and the redactor that scrubs it from everything the store writes.
 * One resolution, two consumers, so a value can never reach a check without
 * also reaching the redactor (`SG-SECRET-001`, `AC-EVID-001`, `TB-059`).
 *
 * Resolution order, per approved name: the runner's own process environment
 * first; then each declared environment file in declaration order; the first
 * value found wins; a name found nowhere is `unresolved`. A name present in
 * the environment never has a file consulted for it, and a file is opened
 * only while some approved name is still unresolved.
 *
 * What is read from a declared file is the approved names and nothing else. A
 * line is parsed far enough to learn which name it assigns; a name that is not
 * approved is skipped without its value being decoded, kept, or reported. The
 * file is never copied anywhere (`AC-CFG-004`).
 *
 * The grammar is the common environment-file shape and no more — `NAME=value`,
 * an optional `export ` prefix, unquoted, single-quoted, and double-quoted
 * values, `#` comments, and blank lines — parsed here rather than through a
 * dotenv or YAML dependency (`TB-049`). A line this grammar cannot parse for an
 * approved name yields no value for it, which is the `unresolved` case, never
 * an error.
 *
 * No variable name, file name, framework, or tool is known here; every one of
 * them is the project's declaration (`SG-OWNER-001`).
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { SENSITIVE_INPUT_SOURCE } from './policy.mjs';

const runFile = promisify(execFile);

/** An environment variable name, as every supported platform spells one. */
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `NAME=` at the start of a line, with an optional `export ` prefix. */
const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** What a declared environment file turned out to be when it was consulted. */
export const ENVIRONMENT_FILE_STATUSES = Object.freeze([
  // Opened and parsed for the approved names still unresolved.
  'read',
  // Every approved name was already resolved before this file's turn.
  'not-consulted',
  // Not present in the repository; a fresh clone commonly has none.
  'missing',
  // Tracked by Git: already in the snapshot, so reading it would be a second
  // source for the same content. Refused, never read (`FR-CFG-006`).
  'tracked',
  // Present but not readable by this process.
  'unreadable',
]);

/**
 * Unescape the two sequences a double-quoted value may carry: an embedded
 * quote and an embedded backslash. Nothing else is interpreted.
 */
const unescapeDoubleQuoted = (value) => value.replace(/\\(["\\])/g, '$1');

/**
 * The value a single line assigns, or `null` when the line cannot be parsed
 * as one assignment. The caller has already decided the name is approved;
 * this never runs for any other line.
 */
const parseValue = (raw) => {
  const trimmed = raw.replace(/^\s+/, '');

  if (trimmed.startsWith('"')) {
    // Up to the next quote that is not escaped. No closing quote on the line:
    // unparseable, so no value.
    const match = /^"((?:[^"\\]|\\.)*)"/.exec(trimmed);

    return match === null ? null : unescapeDoubleQuoted(match[1]);
  }

  if (trimmed.startsWith("'")) {
    const match = /^'([^']*)'/.exec(trimmed);

    return match === null ? null : match[1];
  }

  // Unquoted: up to an inline comment introduced by whitespace and `#`, or the
  // end of the line, with surrounding whitespace removed.
  const withoutComment = trimmed.replace(/\s+#.*$/, '');

  return withoutComment.trim();
};

/**
 * Read the values of exactly `names` from environment-file contents.
 *
 * Every line is inspected only far enough to learn whether it assigns one of
 * the requested names; any other line is skipped without its value being
 * parsed. Within one file a later assignment of the same name replaces an
 * earlier one, as environment-file loaders conventionally resolve it. An
 * assignment that parses to an empty value counts as no value.
 *
 * @param {string} contents the file's text
 * @param {Iterable<string>} names the approved names still wanted
 * @returns {Map<string, string>} the values found, by name
 */
export const readEnvironmentValues = (contents, names) => {
  const wanted = new Set([...names].filter((name) => ENVIRONMENT_NAME.test(name)));
  const found = new Map();

  if (wanted.size === 0) {
    return found;
  }

  for (const line of String(contents ?? '').split(/\r?\n/)) {
    const candidate = line.replace(/^\s+/, '');

    if (candidate === '' || candidate.startsWith('#')) {
      continue;
    }

    const assignment = ASSIGNMENT.exec(candidate);

    // Not an assignment, or an assignment of a name nobody approved: the
    // value is not looked at.
    if (assignment === null || !wanted.has(assignment[1])) {
      continue;
    }

    const value = parseValue(assignment[2]);

    if (value === null || value === '') {
      found.delete(assignment[1]);

      continue;
    }

    found.set(assignment[1], value);
  }

  return found;
};

/**
 * Is `relative` tracked by the repository at `repositoryRoot`? Answered by Git
 * itself, so ignore rules are never re-implemented here. A repository Git
 * cannot answer for is treated as tracking nothing.
 */
const defaultIsTracked = async (repositoryRoot, relative) => {
  try {
    const { stdout } = await runFile(
      'git',
      ['ls-files', '--error-unmatch', '--', relative],
      { cwd: repositoryRoot },
    );

    return stdout.trim() !== '';
  } catch {
    return false;
  }
};

const hasValue = (value) => typeof value === 'string' && value !== '';

/**
 * Resolve every approved name to `{ name, source, value }`.
 *
 * @param {object} options
 * @param {string[]} options.approved the names the Activation receipt pinned
 * @param {object} options.environment the runner's own process environment
 * @param {string[]} [options.environmentFiles] declared files, in order
 * @param {string|null} [options.repositoryRoot] where the declared files are relative to
 * @param {(root: string, relative: string) => Promise<boolean>} [options.isTracked] seam for tests
 * @returns {Promise<{ inputs: Array<{ name: string, source: string, value: string|null, searched?: string[] }>, files: Array<{ path: string, status: string }> }>}
 */
export const resolveRuntimeInputs = async ({
  approved = [],
  environment = {},
  environmentFiles = [],
  repositoryRoot = null,
  isTracked = defaultIsTracked,
} = {}) => {
  const names = approved.filter((name) => typeof name === 'string' && name !== '');
  const resolved = new Map();
  // The sources consulted for a name that ended unresolved, in the order they
  // were consulted, so an envelope can say where it looked (`NFR-OPER-001`).
  const searched = [SENSITIVE_INPUT_SOURCE];

  for (const name of names) {
    if (hasValue(environment[name])) {
      resolved.set(name, { name, source: SENSITIVE_INPUT_SOURCE, value: environment[name] });
    }
  }

  const files = [];
  const declared = repositoryRoot === null ? [] : environmentFiles;

  for (const relative of declared) {
    const outstanding = names.filter((name) => !resolved.has(name));

    if (outstanding.length === 0) {
      files.push({ path: relative, status: 'not-consulted' });

      continue;
    }

    const absolute = path.resolve(repositoryRoot, relative);
    const contained = path.relative(path.resolve(repositoryRoot), absolute);

    // Validation already refused a path that could climb out; this is the
    // same answer asked again at the moment of the read.
    if (contained === '' || contained.startsWith('..') || path.isAbsolute(contained)) {
      files.push({ path: relative, status: 'unreadable' });

      continue;
    }

    if (await isTracked(repositoryRoot, relative)) {
      files.push({ path: relative, status: 'tracked' });

      continue;
    }

    let contents;

    try {
      contents = await readFile(absolute, 'utf8');
    } catch (error) {
      files.push({ path: relative, status: error?.code === 'ENOENT' ? 'missing' : 'unreadable' });

      continue;
    }

    files.push({ path: relative, status: 'read' });
    searched.push(relative);

    for (const [name, value] of readEnvironmentValues(contents, outstanding)) {
      resolved.set(name, { name, source: relative, value });
    }
  }

  const inputs = names.map((name) => resolved.get(name) ?? {
    name,
    source: SENSITIVE_INPUT_SOURCE,
    value: null,
    // Only when a file was declared: a clone declaring none records exactly
    // what it did before this resolution existed (`TB-045`). The list holds
    // what was actually opened; a refused or absent file is not in it.
    ...(declared.length > 0 ? { searched: [...searched] } : {}),
  });

  return { inputs, files };
};
