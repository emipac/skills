import { gatePolicyKeys } from '../contracts.mjs';
import { revisionRefusal } from '../refusals.mjs';

/** A top-level key that names the Gate section, quoted or not. */
const GATE_SECTION_HEAD = /^(?:evaluation_gate|"evaluation_gate"|'evaluation_gate')[ \t]*:/gm;

const lineNumberAt = (contents, offset) => contents.slice(0, offset).split('\n').length;

/**
 * The Gate configuration section as `configure-gate` writes it: the
 * `evaluation_gate:` line, then one flow-JSON line per subcontract in
 * `gatePolicyKeys` order. A revision renders through this same function, so a
 * revised file is the file configuring that candidate would have written
 * (`NFR-REL-004`).
 */
export const gateSectionLines = (policy) => [
  'evaluation_gate:',
  ...gatePolicyKeys.map((key) => `  ${key}: ${JSON.stringify(policy[key])}`),
];

/**
 * Locate the Gate configuration section and read it back, or refuse.
 *
 * The section is its head line and every following line up to the next
 * top-level entry; blank and comment lines at its end belong to what follows.
 * It is revisable only when it round-trips: it reads as exactly the five
 * subcontract lines `configure-gate` writes, and rendering what it reads
 * reproduces it byte for byte. A hand-written block section, a comment or a
 * blank line inside it, or flow JSON spelled any other way is refused rather
 * than rewritten — a revision never changes how a section is written
 * (`RISK-012`).
 *
 * @returns {{ start: number, end: number, line: number, lines: string[], policy: object }}
 */
export const readGateSection = (contents) => {
  const heads = [...contents.matchAll(GATE_SECTION_HEAD)];

  if (heads.length === 0) {
    throw revisionRefusal(
      'gate-unconfigured',
      '.agent-framework.yaml has no Gate configuration section to revise; configure the Gate first (--configure-gate). Nothing was written.',
    );
  }

  if (heads.length > 1) {
    throw revisionRefusal(
      'section-ambiguous',
      `.agent-framework.yaml declares the Gate configuration section ${heads.length} times (lines ${heads.map((head) => lineNumberAt(contents, head.index)).join(', ')}), so a revision cannot tell which one the Gate reads. Nothing was written.`,
    );
  }

  const start = heads[0].index;
  const line = lineNumberAt(contents, start);
  const lines = [];
  let cursor = start;

  while (cursor < contents.length) {
    const newline = contents.indexOf('\n', cursor);
    const end = newline === -1 ? contents.length : newline;
    const text = contents.slice(cursor, end);

    if (lines.length > 0 && text.trim() !== '' && !/^[ \t#]/.test(text)) {
      break;
    }

    lines.push({ text, end });
    cursor = end + 1;
  }

  while (lines.length > 1 && /^\s*(#.*)?$/.test(lines.at(-1).text)) {
    lines.pop();
  }

  const written = lines.map((entry) => entry.text);
  const unrevisable = (index, reason) => revisionRefusal(
    'section-unrevisable',
    `.agent-framework.yaml line ${line + index} ${reason}. A revision rewrites the Gate configuration section only when it is exactly what configure-gate writes — \`evaluation_gate:\` and then one flow-JSON line per subcontract, ${gatePolicyKeys.join(', ')}, with nothing between them — and never changes how a section is written. Nothing was written; edit the section by hand.`,
  );
  const policy = {};

  for (const [index, text] of written.entries()) {
    if (index === 0) {
      if (text !== 'evaluation_gate:') {
        throw unrevisable(index, 'does not open the section as `evaluation_gate:` alone');
      }

      continue;
    }

    const entry = text.match(/^ {2}([a-z_]+): (.+)$/);
    const key = gatePolicyKeys[index - 1];

    if (entry === null || entry[1] !== key) {
      throw unrevisable(index, key === undefined
        ? 'is more than the five subcontract lines'
        : `is not the \`  ${key}: <JSON>\` line`);
    }

    try {
      policy[key] = JSON.parse(entry[2]);
    } catch {
      throw unrevisable(index, `holds ${key} in a form that is not flow JSON`);
    }
  }

  if (written.length !== gatePolicyKeys.length + 1) {
    throw unrevisable(written.length, `ends the section before its ${gatePolicyKeys[written.length - 1]} line`);
  }

  const rendered = gateSectionLines(policy);
  const differing = written.findIndex((text, index) => text !== rendered[index]);

  if (differing !== -1) {
    throw unrevisable(differing, 'spells its flow JSON differently from how configure-gate writes the same value');
  }

  return { start, end: lines.at(-1).end, line, lines: written, policy };
};
