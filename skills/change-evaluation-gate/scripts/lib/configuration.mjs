/**
 * The supported reader for the repository configuration file.
 *
 * Nothing else in this repository turns `.agent-framework.yaml` into an object:
 * `grader-surface.mjs` only names the path as a control surface, and
 * `lifecycle.mjs` only removes top-level keys line by line. A consumer that
 * needs the configuration therefore had to reconstruct it, and the activation
 * attempt that surfaced TB-018 did exactly that with a regular expression whose
 * quote substitution corrupted any value containing an apostrophe.
 *
 * So this module reads the file properly, for the block-structured subset and
 * strict JSON collection values the framework configuration writers produce,
 * and reports what it cannot read instead of guessing. Anything outside that
 * subset — anchors, aliases, tags, general YAML flow mappings, multi-line
 * scalars, tab indentation — is refused by name. A reader that silently
 * accepted a construction it does not model would hand its caller a
 * configuration the file does not contain, which is the failure this module
 * exists to end.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { orderChecks, validateCheckDescriptor } from './check-descriptor.mjs';

/** The configuration file every clone of this framework is configured by. */
export const CONFIGURATION_FILE = '.agent-framework.yaml';

const INTEGER = /^-?\d+$/;

const FLOAT = /^-?\d+\.\d+$/;

/** A refusal carries the line it was decided on, so it can be acted on. */
const refuse = (line, message) => ({
  ok: false,
  value: null,
  reasonCode: 'configuration-unreadable',
  detail: `${CONFIGURATION_FILE} could not be read at line ${line}: ${message}`,
});

/**
 * Read one scalar exactly as it was written.
 *
 * A quoted scalar keeps every character inside its quotes, including the
 * apostrophes and `#` characters that a naive reader destroys. Only an
 * unquoted scalar can carry a trailing comment, because only there is `#`
 * unambiguously not content.
 */
const readScalar = (text, line) => {
  const value = text.trim();

  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    const closing = value.lastIndexOf(quote);

    if (closing <= 0) {
      return { error: refuse(line, 'a quoted value is never closed.') };
    }

    const trailing = value.slice(closing + 1).trim();

    if (trailing.length > 0 && !trailing.startsWith('#')) {
      return { error: refuse(line, 'a quoted value is followed by unreadable text.') };
    }

    const inner = value.slice(1, closing);

    return {
      value: quote === '"'
        ? inner.replace(/\\(["\\ntr])/g, (_, escaped) => ({
          n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\',
        })[escaped])
        : inner.replace(/''/g, "'"),
    };
  }

  const commented = value.replace(/\s+#.*$/, '').trim();

  if (commented === '' || commented === '~' || commented === 'null') {
    return { value: null };
  }

  if (commented === 'true') {
    return { value: true };
  }

  if (commented === 'false') {
    return { value: false };
  }

  if (commented === '[]') {
    return { value: [] };
  }

  if (commented === '{}') {
    return { value: {} };
  }

  if (commented.startsWith('[') || commented.startsWith('{')) {
    try {
      return { value: JSON.parse(value) };
    } catch {
      return { error: refuse(line, 'flow collections are outside the supported configuration subset.') };
    }
  }

  if (commented.startsWith('&') || commented.startsWith('*') || commented.startsWith('!')) {
    return { error: refuse(line, 'anchors, aliases, and tags are outside the supported configuration subset.') };
  }

  if (commented === '|' || commented === '>' || commented.startsWith('|') || commented.startsWith('>')) {
    return { error: refuse(line, 'block scalars are outside the supported configuration subset.') };
  }

  if (INTEGER.test(commented)) {
    return { value: Number.parseInt(commented, 10) };
  }

  if (FLOAT.test(commented)) {
    return { value: Number.parseFloat(commented) };
  }

  return { value: commented };
};

/** Split a `key: value` head, respecting quoted keys and quoted values. */
const splitEntry = (content) => {
  if (content.startsWith('"') || content.startsWith("'")) {
    const quote = content[0];
    const closing = content.indexOf(quote, 1);

    if (closing < 0 || content[closing + 1] !== ':') {
      return null;
    }

    return { key: content.slice(1, closing), rest: content.slice(closing + 2) };
  }

  const separator = content.search(/:(\s|$)/);

  return separator < 0
    ? null
    : { key: content.slice(0, separator).trim(), rest: content.slice(separator + 1) };
};

/** Every content line, with its indentation and its 1-based source line. */
const scan = (document) => {
  const lines = [];

  document.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const withoutIndent = raw.replace(/^[ \t]*/, '');

    if (withoutIndent === '' || withoutIndent.startsWith('#')) {
      return;
    }

    const indent = raw.length - withoutIndent.length;

    if (raw.slice(0, indent).includes('\t')) {
      lines.push({ line, indent, content: withoutIndent, tabbed: true });

      return;
    }

    lines.push({ line, indent, content: withoutIndent, tabbed: false });
  });

  return lines;
};

/**
 * Read one block at `indent` and return it with the cursor that follows it.
 *
 * Mappings and sequences are the only two block shapes the framework
 * configuration uses, and a block is whichever of them its first line declares.
 */
const readBlock = (lines, start, indent) => {
  const first = lines[start];

  if (first.tabbed) {
    return { error: refuse(first.line, 'indentation uses a tab; the configuration is indented with spaces.') };
  }

  return first.content.startsWith('- ') || first.content === '-'
    ? readSequence(lines, start, indent)
    : readMapping(lines, start, indent);
};

const readMapping = (lines, start, indent) => {
  const mapping = {};
  let cursor = start;

  while (cursor < lines.length && lines[cursor].indent >= indent) {
    const entry = lines[cursor];

    if (entry.tabbed) {
      return { error: refuse(entry.line, 'indentation uses a tab; the configuration is indented with spaces.') };
    }

    if (entry.indent > indent) {
      return { error: refuse(entry.line, 'this line is indented further than the mapping it belongs to.') };
    }

    const split = splitEntry(entry.content);

    if (split === null) {
      return { error: refuse(entry.line, 'a mapping entry must be written as `key: value`.') };
    }

    const nested = lines[cursor + 1] ?? null;
    const opensBlock = split.rest.trim() === ''
      && nested !== null
      && (nested.indent > indent
        || (nested.indent === indent && (nested.content.startsWith('- ') || nested.content === '-')));

    if (opensBlock) {
      const block = readBlock(lines, cursor + 1, nested.indent);

      if (block.error) {
        return block;
      }

      mapping[split.key] = block.value;
      cursor = block.cursor;

      continue;
    }

    const scalar = readScalar(split.rest, entry.line);

    if (scalar.error) {
      return scalar;
    }

    mapping[split.key] = scalar.value;
    cursor += 1;
  }

  return { value: mapping, cursor };
};

const readSequence = (lines, start, indent) => {
  const sequence = [];
  let cursor = start;

  while (cursor < lines.length && lines[cursor].indent === indent) {
    const entry = lines[cursor];

    if (!entry.content.startsWith('- ') && entry.content !== '-') {
      break;
    }

    const head = entry.content === '-' ? '' : entry.content.slice(2);
    const headOffset = indent + 2;

    // `- key: value` opens a mapping whose first line shares this one, so the
    // item is read from a rewritten view of the remaining lines.
    if (head.trim() !== '' && splitEntry(head) !== null) {
      const rewritten = [
        { line: entry.line, indent: headOffset, content: head, tabbed: false },
        ...lines.slice(cursor + 1),
      ];
      const item = readMapping(rewritten, 0, headOffset);

      if (item.error) {
        return item;
      }

      sequence.push(item.value);
      cursor += item.cursor;

      continue;
    }

    if (head.trim() === '') {
      const nested = lines[cursor + 1] ?? null;

      if (nested === null || nested.indent <= indent) {
        sequence.push(null);
        cursor += 1;

        continue;
      }

      const block = readBlock(lines, cursor + 1, nested.indent);

      if (block.error) {
        return block;
      }

      sequence.push(block.value);
      cursor = block.cursor;

      continue;
    }

    const scalar = readScalar(head, entry.line);

    if (scalar.error) {
      return scalar;
    }

    sequence.push(scalar.value);
    cursor += 1;
  }

  return { value: sequence, cursor };
};

/**
 * Read one configuration document.
 *
 * @param {string} document the configuration file contents
 * @returns {{ ok: boolean, value: object|null, reasonCode: string|null, detail: string|null }}
 */
export const parseConfigurationDocument = (document) => {
  if (typeof document !== 'string') {
    return refuse(0, 'the configuration is not text.');
  }

  const lines = scan(document);

  if (lines.length === 0) {
    return refuse(1, 'the configuration is empty.');
  }

  const block = readBlock(lines, 0, lines[0].indent);

  if (block.error) {
    return block.error;
  }

  if (block.cursor < lines.length) {
    return refuse(lines[block.cursor].line, 'this line is outdented past the document it belongs to.');
  }

  return { ok: true, value: block.value, reasonCode: null, detail: null };
};

/**
 * How a configured verification stage names itself on the Evidence ladder.
 *
 * The ladder itself is owned by `verify-change` and imported through the check
 * descriptor contract; this table only says which configuration key speaks
 * about which imported stage, and what evidence that stage provides. A key with
 * no entry is reported rather than mapped by resemblance.
 */
const CONFIGURED_STAGES = Object.freeze({
  format: { stage: 'format', capability: 'formatter', claims: ['format:style'] },
  static_analysis: {
    stage: 'static-analysis',
    capability: 'static-analysis',
    claims: ['static-analysis:application'],
  },
  test: { stage: 'broad-tests', capability: 'test', claims: ['test:broad'] },
  smoke: { stage: 'smoke', capability: 'smoke', claims: ['smoke:runtime'] },
  build: { stage: 'build', capability: 'build', claims: ['build:artifact'] },
  e2e: { stage: 'browser', capability: 'browser', claims: ['browser:user-visible'] },
});

/** Scopes are read in one fixed order so identities never depend on key order. */
const CONFIGURED_SCOPES = Object.freeze(['backend', 'frontend', 'both']);

/**
 * Project the clone's configured verification commands onto check descriptors.
 *
 * The configuration is the only place a command is defined (`SG-OWNER-001`), so
 * the runner reads them rather than proposing any of its own. Nothing here
 * decides policy: every descriptor is proposed `advisory` and the Gate policy
 * section binds which identities are required.
 *
 * A command the descriptor contract rejects is reported and no check is
 * produced from it. Dropping it silently would shrink the evaluation to the
 * commands that happened to parse, which is exactly how an evaluation comes to
 * prove less than it claims.
 *
 * @param {object} configuration a configuration read by this module
 * @returns {{ checks: object[], errors: object[] }}
 */
export const gateChecksFromConfiguration = (configuration) => {
  const commands = configuration?.verification?.commands ?? {};
  const errors = [];
  const proposals = [];

  for (const [key, scopes] of Object.entries(commands)) {
    const stage = CONFIGURED_STAGES[key] ?? null;

    if (stage === null) {
      errors.push({
        code: 'verification-stage-unknown',
        path: `verification.commands.${key}`,
        message: `Verification stage ${JSON.stringify(key)} is not an Evidence ladder stage this gate can evaluate.`,
      });

      continue;
    }

    const staged = [];

    for (const scope of CONFIGURED_SCOPES) {
      const configured = scopes?.[scope] ?? [];

      if (!Array.isArray(configured)) {
        errors.push({
          code: 'verification-commands-invalid',
          path: `verification.commands.${key}.${scope}`,
          message: 'Configured commands must be a list of Command descriptors.',
        });

        continue;
      }

      configured.forEach((command, index) => {
        staged.push({ command, path: `verification.commands.${key}.${scope}[${index}]` });
      });
    }

    // Only a stage that configured more than one command needs an ordinal, so a
    // single configured command keeps the plain identity a policy names.
    staged.forEach((entry, index) => {
      const base = `configuration.${stage.stage}.${stage.capability}`;

      proposals.push({
        ...entry,
        stage,
        id: staged.length === 1 ? base : `${base}.${index + 1}`,
        order: (index + 1) * 10,
      });
    });
  }

  const checks = [];

  for (const proposal of proposals) {
    // What a configured entry declares about its command, and what it declares
    // the command NEEDS, are different statements. The Command contract is a
    // closed shape, so the requirements are read off the entry and projected
    // onto the descriptor that carries them; leaving them on the command would
    // be refused as an unknown field, and dropping them is what left every
    // configured check unable to say it needed anything at all (`TB-044`).
    const { prerequisites, ...command } = proposal.command ?? {};
    const scope = command?.source_scope;
    const descriptor = {
      id: proposal.id,
      provider: 'configuration',
      stage: proposal.stage.stage,
      capability: proposal.stage.capability,
      scope: typeof scope === 'string' ? scope : 'both',
      applicability: { changed_path_globs: ['**'], required_facts: [] },
      // Declared by the clone, never proposed here. A malformed declaration is
      // reported by the descriptor contract like any other, so nothing is
      // repaired into a requirement the project did not write.
      prerequisites: prerequisites === undefined ? [] : prerequisites,
      // Policy binds which identities are required; the reader proposes none.
      policy: 'advisory',
      evaluate: command,
      // Evaluation is non-mutating: a configured verification command is an
      // evaluate command and a fix command is unreachable from this seam.
      fix: null,
      timeout_seconds: Number.isInteger(command?.timeout_seconds) ? command.timeout_seconds : 1,
      declared_writes: [],
      evidence: { claims: [...proposal.stage.claims], success_exit_codes: [0], report: null },
      order: proposal.order,
      selection: null,
    };
    const issues = validateCheckDescriptor(descriptor);

    if (issues.length > 0) {
      errors.push(...issues.map((issue) => ({ ...issue, path: `${proposal.path}: ${issue.path}` })));

      continue;
    }

    checks.push(descriptor);
  }

  return { checks: orderChecks(checks), errors };
};

/**
 * Read the configuration of one clone.
 *
 * An absent configuration and an unreadable one are different facts and are
 * reported as different reasons: nothing here defaults, and nothing here
 * returns a partially understood configuration.
 *
 * @param {object} options the repository root to read the configuration from
 * @returns {Promise<{ ok: boolean, configuration: object|null, path: string, reasonCode: string|null, detail: string|null }>}
 */
export const readRepositoryConfiguration = async ({ repositoryRoot } = {}) => {
  const configurationPath = path.join(repositoryRoot ?? '.', CONFIGURATION_FILE);
  let contents;

  try {
    contents = await readFile(configurationPath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      configuration: null,
      path: configurationPath,
      reasonCode: error.code === 'ENOENT' ? 'configuration-missing' : 'configuration-unreadable',
      detail: error.code === 'ENOENT'
        ? `${CONFIGURATION_FILE} is not present at ${configurationPath}; this clone is not configured.`
        : `${CONFIGURATION_FILE} could not be opened at ${configurationPath}: ${error.message}`,
    };
  }

  const parsed = parseConfigurationDocument(contents);

  return parsed.ok
    ? {
      ok: true, configuration: parsed.value, path: configurationPath, reasonCode: null, detail: null,
    }
    : {
      ok: false,
      configuration: null,
      path: configurationPath,
      reasonCode: parsed.reasonCode,
      detail: parsed.detail,
    };
};
