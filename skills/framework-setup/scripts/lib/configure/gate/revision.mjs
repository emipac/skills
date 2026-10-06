import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { gatePolicyKeys } from '../contracts.mjs';
import { exists, replaceConfiguration } from '../filesystem.mjs';
import { gateRevisions } from './revision-rules.mjs';
import { gateSectionLines, readGateSection } from './section.mjs';
import { validatedPolicy } from './validation.mjs';
import { revisionRefusal } from '../refusals.mjs';

/**
 * A typed value in `NAME=value` form: a name, file, or check given with a
 * value after `=`. No revision takes a value, and the part after `=` may be a
 * secret, so it is never repeated (`SG-GUIDE-002`, `SG-SECRET-001`).
 */
const suppliesValue = (value) => typeof value === 'string' && value.includes('=');

/** `revision` as it may be echoed: each value after `=` replaced by a marker that repeats nothing. */
export const withheldRevision = (revision) => Object.fromEntries(Object.entries(revision ?? {})
  .map(([key, value]) => [key, suppliesValue(value) ? `${value.slice(0, value.indexOf('='))}=<withheld>` : value]));

/**
 * Refuse a revision any of whose typed values supplies a value, before the
 * file, the operation, or the validator sees it, naming only what precedes
 * `=`.
 */
const refuseSuppliedValues = (revision) => {
  const supplied = Object.entries(revision ?? {}).filter(([, value]) => suppliesValue(value));

  if (supplied.length > 0) {
    throw Object.assign(revisionRefusal(
      'value-supplied',
      `A value was supplied for ${supplied.map(([key, value]) => `${key} ${value.slice(0, value.indexOf('='))}`).join(', ')}: a Gate revision takes a name, file, or check alone and never a value, so the part after \`=\` was not read into the configuration and is not repeated here. Nothing was written; pass the name alone.`,
    ), { revision: withheldRevision(revision) });
  }
};

/** The one revision asked for, with only the values its operation takes. */
const requestedRevision = (revision) => {
  const operation = gateRevisions[revision?.operation] ?? null;

  if (operation === null) {
    throw revisionRefusal(
      'revision-unknown',
      `Unknown Gate revision ${JSON.stringify(revision?.operation ?? null)}; one of ${Object.keys(gateRevisions).join(', ')}.`,
    );
  }

  const accepted = [operation.argument, ...operation.options];
  const unaccepted = Object.keys(revision)
    .filter((key) => key !== 'operation' && revision[key] !== undefined && !accepted.includes(key));

  if (unaccepted.length > 0) {
    throw revisionRefusal(
      'revision-unknown',
      `${revision.operation} does not take ${unaccepted.join(', ')}; it takes ${accepted.join(', ')}.`,
    );
  }

  const given = accepted.filter((key) => revision[key] !== undefined);
  const malformed = given.find((key) => typeof revision[key] !== 'string' || revision[key] === '');

  if (!given.includes(operation.argument) || malformed !== undefined) {
    throw revisionRefusal(
      'revision-incomplete',
      `${revision.operation} needs a non-empty ${malformed ?? operation.argument}.`,
    );
  }

  return {
    operation,
    revision: Object.fromEntries([['operation', revision.operation], ...given.map((key) => [key, revision[key]])]),
  };
};

/**
 * Preview one named revision of the Gate configuration section.
 *
 * It reads the section back (refusing one it cannot locate unambiguously or
 * round-trip), refuses a section the Gate policy validator already rejects,
 * applies the revision to its one subcontract, validates the candidate with
 * that same validator, and renders the candidate as `configure-gate` renders a
 * section, in place. Every byte outside the section is the file's own, and the
 * rendered section reads back as exactly the candidate. The preview names each
 * changed line before and after; `previewHash` binds the file as it is now to
 * the file the revision would write, so it confirms exactly this change to
 * exactly this file. Nothing is written.
 */
export const previewGateRevision = async ({ projectRoot, revision }) => {
  refuseSuppliedValues(revision);

  const configurationPath = path.join(path.resolve(projectRoot), '.agent-framework.yaml');

  if (!(await exists(configurationPath))) {
    throw revisionRefusal('configuration-missing', 'Cannot revise the Gate configuration without .agent-framework.yaml');
  }

  const contents = await readFile(configurationPath, 'utf8');
  const schemaVersion = Number(contents.match(/^schema_version:\s*(\d+)$/m)?.[1] ?? 0);

  if (schemaVersion !== 4) {
    throw revisionRefusal('schema-unsupported', `Gate configuration requires schema version 4, found ${schemaVersion}`);
  }

  const requested = requestedRevision(revision);
  const { operation } = requested;
  const section = readGateSection(contents);

  await validatedPolicy(section.policy, 'section-invalid', 'The Gate configuration section does not validate as it stands, and a revision starts from a valid section');

  const policy = {
    ...section.policy,
    [operation.subcontract]: operation.revise(section.policy[operation.subcontract], requested.revision),
  };

  await validatedPolicy(policy, 'candidate-invalid', `The Gate policy validator refuses this ${requested.revision.operation} revision`);

  const rendered = gateSectionLines(policy);
  const proposedConfiguration = `${contents.slice(0, section.start)}${rendered.join('\n')}${contents.slice(section.end)}`;
  const reread = readGateSection(proposedConfiguration).policy;

  // `RISK-012`: the section reads back as the candidate, and nothing outside it moved.
  if (
    JSON.stringify(reread) !== JSON.stringify(policy)
    || !proposedConfiguration.startsWith(contents.slice(0, section.start))
    || !proposedConfiguration.endsWith(contents.slice(section.end))
  ) {
    throw revisionRefusal('section-unrevisable', 'The revised Gate configuration section does not read back as the candidate. Nothing was written.');
  }

  const previewHash = createHash('sha256')
    .update(contents)
    .update('\0')
    .update(proposedConfiguration)
    .digest('hex');

  return {
    status: 'ready',
    revision: requested.revision,
    subcontract: operation.subcontract,
    changes: rendered
      .map((after, index) => ({
        subcontract: gatePolicyKeys[index - 1] ?? null,
        line: section.line + index,
        before: section.lines[index],
        after,
      }))
      .filter((change) => change.before !== change.after),
    policy,
    previewHash,
    proposedConfiguration,
  };
};

/**
 * Write exactly the previewed revision, or nothing.
 *
 * The preview is taken again from the file as it is now, so a token from a
 * preview of another revision, or of the file before anything in it changed,
 * matches nothing and writes nothing.
 */
export const reviseGate = async ({ projectRoot, revision, confirmation }) => {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const preview = await previewGateRevision({ projectRoot: resolvedProjectRoot, revision });

  if (confirmation !== preview.previewHash) {
    throw revisionRefusal(
      'preview-mismatch',
      'Gate revision confirmation does not match the current preview: the file or the revision changed since that preview. Nothing was written; preview again.',
    );
  }

  await replaceConfiguration(resolvedProjectRoot, preview.proposedConfiguration);

  return {
    status: 'revised',
    revision: preview.revision,
    subcontract: preview.subcontract,
    changes: preview.changes,
    policy: preview.policy,
    previewHash: preview.previewHash,
  };
};
