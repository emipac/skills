import { HOOK_BLOCK_BEGIN, HOOK_BLOCK_END, HOOK_RECEIPT_PLACEHOLDER, HOOK_RECEIPT_PREFIX } from './constants.mjs';
import { contentIdentity } from '../../evidence-store.mjs';
import path from 'node:path';

/** The pinned runtime invocation, quoted for `/bin/sh`. */
export const quotedProgram = ({ program, repositoryRoot }) => {
  const argv = [
    program.interpreter,
    repositoryRoot === undefined ? program.script : path.resolve(repositoryRoot, program.script),
    ...(program.args ?? []),
  ];

  for (const value of argv) {
    if (typeof value !== 'string' || /["\\\n\r]/.test(value)) {
      throw new Error(`A hook program argument is not safely quotable: ${JSON.stringify(value)}.`);
    }
  }

  return argv.map((value) => `"${value}"`).join(' ');
};

/**
 * The gate-owned `pre-commit` shim.
 *
 * It is deliberately trivial and clearly marked: it hands control to the pinned
 * runtime and does nothing else, so a maintainer reading their hook directory
 * can see at a glance what owns the file and what it runs.
 */
export const shimContents = ({ hook, program, receipt }) => [
  '#!/bin/sh',
  `# change-evaluation-gate: owned ${hook} shim. Managed by the Gate; do not edit.`,
  `${HOOK_RECEIPT_PREFIX}${receipt.receiptId}`,
  `exec ${quotedProgram({ program })} "$@"`,
  '',
].join('\n');

/**
 * The gate-owned block placed inside a hook the repository already had.
 *
 * It runs the pinned runtime and stops the commit when the gate refuses it;
 * otherwise control falls straight through to the hook's original body, which
 * is why the block is placed at the top rather than appended. A hook that ends
 * in `exit 0` — most of them do — would never reach an appended block.
 */
export const managedBlockContents = ({ program, receipt, repositoryRoot }) => [
  HOOK_BLOCK_BEGIN,
  '# Managed by the Gate; do not edit inside these markers.',
  `${HOOK_RECEIPT_PREFIX}${receipt.receiptId}`,
  `${quotedProgram({ program, repositoryRoot })} "$@" || exit $?`,
  HOOK_BLOCK_END,
].join('\n');

/**
 * Locate the gate-owned block in a hook, and say whether it is intact.
 *
 * Anything other than exactly one well-formed block is drift: the gate cannot
 * tell what a half-removed or duplicated block was meant to be, and guessing is
 * precisely what SG-HOOK-001 forbids.
 */
export const managedBlockIn = (contents) => {
  const begin = contents.indexOf(HOOK_BLOCK_BEGIN);
  const end = contents.indexOf(HOOK_BLOCK_END);

  if (begin === -1 && end === -1) {
    return { present: false, wellFormed: true, block: null, begin: -1, end: -1 };
  }

  const duplicated = begin !== -1 && contents.indexOf(HOOK_BLOCK_BEGIN, begin + 1) !== -1;
  const repeated = end !== -1 && contents.indexOf(HOOK_BLOCK_END, end + 1) !== -1;

  if (begin === -1 || end === -1 || end < begin || duplicated || repeated) {
    return { present: true, wellFormed: false, block: null, begin, end };
  }

  return {
    present: true,
    wellFormed: true,
    block: contents.slice(begin, end + HOOK_BLOCK_END.length),
    begin,
    end,
  };
};

/**
 * Rewrite the one self-referential line so a registration can be hashed.
 *
 * Everything else is preserved byte for byte, so any edit anywhere else in the
 * registration changes the resulting identity.
 */
export const normalizeHookRegistration = (contents) => (contents ?? '')
  .split('\n')
  .map((line) => (line.startsWith(HOOK_RECEIPT_PREFIX)
    ? `${HOOK_RECEIPT_PREFIX}${HOOK_RECEIPT_PLACEHOLDER}`
    : line))
  .join('\n');

/**
 * The durable, receipt-independent content identity of a gate-owned
 * registration (FR-LIFE-009, FR-LIFE-019).
 */
export const hookBlockIdentity = (contents) => contentIdentity(
  normalizeHookRegistration(contents),
);

/** The receipt id a gate-owned registration names, if it still names one. */
export const hookRegistrationReceiptId = (contents) => {
  const line = (contents ?? '')
    .split('\n')
    .find((candidate) => candidate.startsWith(HOOK_RECEIPT_PREFIX));

  return line === undefined ? null : line.slice(HOOK_RECEIPT_PREFIX.length).trim();
};

/**
 * The exact bytes a given strategy would register, with the receipt id elided.
 *
 * This is what makes the identity pinnable: the contents depend only on the
 * strategy, the pinned hook program, and the clone root — never on the receipt
 * that is about to name them — so the receipt can carry the identity of the
 * registration it authorizes.
 */
export const plannedHookRegistration = ({ strategy, hook, program, repositoryRoot }) => {
  const receipt = { receiptId: HOOK_RECEIPT_PLACEHOLDER };

  if (strategy === 'marker-delimited-block') {
    return managedBlockContents({ program, receipt, repositoryRoot });
  }

  return shimContents({
    hook,
    program: { ...program, script: path.resolve(repositoryRoot, program.script) },
    receipt,
  });
};

/** Place the block where control actually reaches it: directly after the shebang. */
export const composeManagedBlock = (contents, block) => {
  const newline = contents.indexOf('\n');

  if (contents.startsWith('#!') && newline !== -1) {
    return `${contents.slice(0, newline + 1)}${block}\n${contents.slice(newline + 1)}`;
  }

  return `${block}\n${contents}`;
};
