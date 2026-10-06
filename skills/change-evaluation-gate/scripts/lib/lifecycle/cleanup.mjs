import { contentIdentity } from '../evidence-store.mjs';
import { GATE_CONFIGURATION_KEYS } from './constants.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A top-level mapping key: the only granularity cleanup ever operates at. */
const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):/;

/**
 * Locate the Gate's own top-level blocks in a shared configuration file.
 *
 * Cleanup is deliberately line-oriented rather than a parse-and-reserialize.
 * Reserializing somebody's configuration would rewrite comments, quoting,
 * ordering, and anchors that have nothing to do with the Gate — a silent change
 * to shared state. Removing exactly the located line ranges leaves every other
 * byte of the file precisely as its owner wrote it.
 */
const locateGateKeys = (contents, keys) => {
  const lines = contents.split('\n');
  const blocks = [];
  let current = null;

  /**
   * Where the Gate's own block really ends.
   *
   * Blank lines and comments immediately above the next top-level key introduce
   * that key, not this one. Ending the block at the last line that is actually
   * part of the Gate's value leaves somebody else's comment exactly where they
   * wrote it.
   */
  const lastOwnedLine = (startLine, beforeLine) => {
    let end = startLine;

    for (let index = startLine + 1; index < beforeLine; index += 1) {
      const line = lines[index];

      if (line.trim() === '' || line.trimStart().startsWith('#')) {
        continue;
      }

      end = index;
    }

    return end;
  };

  lines.forEach((line, index) => {
    const match = TOP_LEVEL_KEY.exec(line);

    if (match === null) {
      return;
    }

    if (current !== null) {
      current.endLine = lastOwnedLine(current.startLine, index);
      blocks.push(current);
      current = null;
    }

    if (keys.includes(match[1])) {
      current = { key: match[1], startLine: index, endLine: lines.length - 1 };
    }
  });

  if (current !== null) {
    current.endLine = lastOwnedLine(current.startLine, lines.length);
    blocks.push(current);
  }

  return blocks.map((block) => ({
    ...block,
    text: `${lines.slice(block.startLine, block.endLine + 1).join('\n')}\n`,
  }));
};

/**
 * The load-bearing identity of one located set of Gate blocks.
 *
 * The key, the exact line range, and the exact text — everything a removal acts
 * on. A preview and a fresh relocation that share this identity describe the
 * same removal from the same bytes; two that differ do not.
 */
const cleanupBlockIdentity = (blocks) => contentIdentity(
  (blocks ?? []).map((block) => ({
    key: block?.key ?? null,
    startLine: block?.startLine ?? null,
    endLine: block?.endLine ?? null,
    text: block?.text ?? null,
  })),
);

/**
 * Preview one configuration cleanup.
 *
 * The preview writes nothing. It names every Gate key it would remove, quotes
 * the exact text it would remove, and carries the confirmation token a later
 * cleanup must reproduce (FR-LIFE-018, AC-LIFE-010).
 */
export const previewConfigurationCleanup = async ({
  configurationPath = null,
  keys = GATE_CONFIGURATION_KEYS,
} = {}) => {
  const contents = await readFile(configurationPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });
  const located = contents === null ? [] : locateGateKeys(contents, [...keys]);
  const body = {
    path: configurationPath,
    keys: located.map(({ key, startLine, endLine }) => ({ key, startLine, endLine })),
    removedText: located.map((block) => block.text).join(''),
  };

  return {
    ...body,
    blocks: located,
    fileIdentity: contents === null ? null : contentIdentity(contents),
    // The token identifies the exact removal, against the exact file that was
    // read. A file edited since the preview cannot reproduce it.
    confirmationToken: contentIdentity({
      ...body,
      fileIdentity: contents === null ? null : contentIdentity(contents),
    }),
  };
};

/**
 * Remove exactly the previewed Gate keys, and only after confirmation.
 *
 * The shared configuration file is never deleted, never reordered, and never
 * reserialized: the previewed line ranges are dropped and every other byte is
 * written back unchanged. A confirmation that does not reproduce the preview —
 * including because the file changed underneath it — removes nothing
 * (FR-LIFE-018, SG-LIFE-001, AC-LIFE-010).
 */
export const confirmConfigurationCleanup = async ({
  evidenceStore = null,
  configurationPath = null,
  preview = null,
  confirmation = null,
} = {}) => {
  const record = async (result) => {
    if (evidenceStore) {
      await evidenceStore.appendLifecycleEvent({
        type: 'removal',
        before: preview?.confirmationToken ?? null,
        after: null,
        outcome: result.cleaned ? 'succeeded' : 'refused',
        reason: result.cleaned
          ? `Configuration cleanup removed the previewed Gate key(s) ${result.removedKeys.join(', ')}; the shared configuration file itself was preserved.`
          : `Configuration cleanup refused (${result.reasonCode}); the shared configuration file was not changed.`,
      }).catch(() => null);
    }

    return result;
  };

  const refuse = (reasonCode, errors = []) => record({
    cleaned: false,
    reasonCode,
    errors,
    removedKeys: [],
    // Whatever happens, the file stays.
    fileDeleted: false,
  });

  const expected = preview?.confirmationToken ?? null;

  if (expected === null || confirmation !== expected) {
    return refuse('preview-mismatch', [{ expected, actual: confirmation }]);
  }

  if ((preview.blocks ?? []).length === 0) {
    return refuse('nothing-previewed', [{
      message: 'The preview identified no Gate keys, so there is nothing to remove.',
    }]);
  }

  // The file this cleanup is about to rewrite has to be the file the preview
  // was taken against. Confirming one file and writing another is the same
  // mistake as obeying an altered preview, reached through the argument list
  // instead (SG-LIFE-001).
  if (typeof preview.path !== 'string'
    || path.resolve(configurationPath) !== path.resolve(preview.path)) {
    return refuse('configuration-path-mismatch', [{
      expected: preview.path ?? null,
      actual: configurationPath,
    }]);
  }

  // Cleanup owns the Gate's own top-level keys and nothing else. A preview
  // naming any other key is naming somebody else's configuration, whoever
  // produced it.
  const unowned = preview.blocks
    .map((block) => block?.key ?? null)
    .filter((key) => !GATE_CONFIGURATION_KEYS.includes(key));

  if (unowned.length > 0) {
    return refuse('key-not-owned', [{
      keys: unowned,
      message: 'Cleanup removes only the Gate\'s own top-level keys.',
    }]);
  }

  const contents = await readFile(configurationPath, 'utf8').catch(() => null);

  if (contents === null) {
    return refuse('configuration-absent');
  }

  if (preview.fileIdentity !== null && contentIdentity(contents) !== preview.fileIdentity) {
    return refuse('configuration-changed', [{
      expected: preview.fileIdentity,
      actual: contentIdentity(contents),
    }]);
  }

  // Where the Gate's blocks actually are, in the bytes about to be rewritten.
  // The preview is a claim about this file; the claim is re-established here
  // and the removal is driven by the answer, so the caller's line ranges never
  // decide which lines go (AC-LIFE-008, SG-LIFE-001).
  const located = locateGateKeys(contents, [...GATE_CONFIGURATION_KEYS]);

  if (cleanupBlockIdentity(located) !== cleanupBlockIdentity(preview.blocks)) {
    return refuse('preview-stale', [{
      expected: cleanupBlockIdentity(preview.blocks),
      actual: cleanupBlockIdentity(located),
      message: 'The Gate keys in this file are not the ones the preview named. Preview again and confirm the new preview.',
    }]);
  }

  const dropped = new Set();

  for (const block of located) {
    for (let line = block.startLine; line <= block.endLine; line += 1) {
      dropped.add(line);
    }
  }

  const kept = contents
    .split('\n')
    .filter((_, index) => !dropped.has(index))
    .join('\n');

  await writeFile(configurationPath, kept, 'utf8');

  return record({
    cleaned: true,
    reasonCode: null,
    errors: [],
    removedKeys: located.map((block) => block.key),
    fileDeleted: false,
  });
};
