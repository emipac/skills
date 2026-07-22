import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const requiredSections = [
  'Feature Contract',
  'Problem and Outcome',
  'SRS Traceability',
  'User Stories and Scenarios',
  'Approach and Decisions',
  'Public Interfaces and Test Seams',
  'Safeguards and Prohibited Behavior',
  'Risks, Gaps, and Assumptions',
  'Acceptance Criteria',
  'Verification Strategy',
  'Out of Scope',
  'Readiness',
];

const normalize = (value) => value
  .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-');

const cleanCell = (cell) => cell.replace(/\*\*|`/g, '').trim();

const splitRow = (line) => line
  .trim()
  .replace(/^\|/, '')
  .replace(/\|$/, '')
  .split('|')
  .map(cleanCell);

const parseSections = (contents) => {
  const sections = new Map();
  let current = null;

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^##\s+(.+?)\s*$/);

    if (match) {
      current = { heading: match[1], lines: [] };
      sections.set(normalize(match[1]), current);
      continue;
    }

    current?.lines.push(line);
  }

  return sections;
};

const parseFirstTable = (section) => {
  const lines = section?.lines.filter((line) => /^\s*\|.*\|\s*$/.test(line)) ?? [];

  if (lines.length < 2) {
    return null;
  }

  const header = splitRow(lines[0]);
  const separator = splitRow(lines[1]);

  if (!separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return null;
  }

  return { header, rows: lines.slice(2).map(splitRow) };
};

const columnIndex = (table, name) => table.header.findIndex(
  (column) => normalize(column) === normalize(name),
);

const ids = (value, pattern) => [...value.matchAll(pattern)].map((match) => match[0]);

const requirementIds = (value) => ids(value, /\b(?:FR|NFR)-[A-Z0-9]+-\d{3}\b/g);
const acceptanceIds = (value) => ids(value, /\bAC-[A-Z0-9]+-\d{3}\b/g);
const safeguardIds = (value) => ids(value, /\bSG-[A-Z0-9]+-\d{3}\b/g);
const uniqueSorted = (values) => [...new Set(values)].sort();

const addError = (errors, code, message) => errors.push({ code, message });

export const auditFeatureSpec = (contents, { srsContents = null } = {}) => {
  const sections = parseSections(contents);
  const errors = [];
  const warnings = [];

  for (const sectionName of requiredSections) {
    const section = sections.get(normalize(sectionName));

    if (!section) {
      addError(errors, 'missing-section', `Missing required section: ${sectionName}`);
    } else if (!section.lines.some((line) => line.trim() && !/^<!--/.test(line.trim()))) {
      addError(errors, 'empty-section', `${sectionName} must contain substantive content`);
    }
  }

  const contractTable = parseFirstTable(sections.get(normalize('Feature Contract')));
  const statusRow = contractTable?.rows.find(
    (row) => normalize(row[0] ?? '') === 'status',
  );

  if (!contractTable) {
    addError(errors, 'missing-contract-table', 'Feature Contract must contain a field table');
  } else if (statusRow?.[1] !== 'ready-for-tickets') {
    addError(errors, 'not-ready', 'Feature Contract status must be ready-for-tickets');
  }

  const traceabilitySection = sections.get(normalize('SRS Traceability'));
  const traceabilityTable = parseFirstTable(traceabilitySection);
  const traceabilityText = traceabilitySection?.lines.join('\n') ?? '';
  const tracedRequirements = uniqueSorted(requirementIds(traceabilityText));
  const tracedAcceptance = uniqueSorted(acceptanceIds(traceabilityText));
  const tracedSafeguards = uniqueSorted(safeguardIds(traceabilityText));

  if (!traceabilityTable) {
    addError(errors, 'missing-traceability-table', 'SRS Traceability must contain a mapping table');
  }

  if (tracedRequirements.length === 0) {
    addError(errors, 'missing-traceability', 'Feature spec must reference at least one SRS requirement');
  }

  if (tracedAcceptance.length === 0) {
    addError(errors, 'missing-acceptance-trace', 'Feature spec must reference SRS acceptance criteria');
  }

  if (srsContents !== null) {
    const knownIds = new Set([
      ...requirementIds(srsContents),
      ...acceptanceIds(srsContents),
      ...safeguardIds(srsContents),
    ]);

    for (const reference of [
      ...tracedRequirements,
      ...tracedAcceptance,
      ...tracedSafeguards,
    ]) {
      if (!knownIds.has(reference)) {
        addError(errors, 'unknown-srs-reference', `${reference} is not defined by the SRS baseline`);
      }
    }
  } else {
    warnings.push({
      code: 'srs-not-loaded',
      message: 'SRS references were not checked against a baseline',
    });
  }

  const acceptanceSection = sections.get(normalize('Acceptance Criteria'));
  const acceptanceTable = parseFirstTable(acceptanceSection);
  const specifiedAcceptance = uniqueSorted(acceptanceIds(
    acceptanceSection?.lines.join('\n') ?? '',
  ));

  if (!acceptanceTable || acceptanceTable.rows.length === 0) {
    addError(errors, 'missing-acceptance-criteria', 'Acceptance Criteria must contain at least one row');
  }

  for (const reference of tracedAcceptance) {
    if (!specifiedAcceptance.includes(reference)) {
      addError(
        errors,
        'missing-acceptance-detail',
        `${reference} is traced but absent from Acceptance Criteria`,
      );
    }
  }

  const gapTable = parseFirstTable(sections.get(normalize('Risks, Gaps, and Assumptions')));

  if (gapTable) {
    const blocksColumn = columnIndex(gapTable, 'Blocks readiness');
    const resolutionColumn = columnIndex(gapTable, 'Resolution');

    if (blocksColumn === -1 || resolutionColumn === -1) {
      addError(
        errors,
        'invalid-gap-table',
        'Risks, Gaps, and Assumptions requires Blocks readiness and Resolution columns',
      );
    } else {
      for (const row of gapTable.rows) {
        const blocks = /^(?:yes|true)$/i.test(row[blocksColumn] ?? '');
        const unresolved = /^(?:|open|unresolved|tbd|—|-)$/i.test(
          row[resolutionColumn] ?? '',
        );

        if (blocks && unresolved) {
          addError(errors, 'blocking-gap', `${row[0]} blocks readiness and remains unresolved`);
        }
      }
    }
  }

  const readinessLines = sections.get(normalize('Readiness'))?.lines ?? [];
  const readinessItems = readinessLines.filter((line) => /^\s*- \[[ xX]\]/.test(line));

  if (readinessItems.length === 0) {
    addError(errors, 'missing-readiness-checklist', 'Readiness must contain a checklist');
  }

  for (const item of readinessItems) {
    if (!/^\s*- \[[xX]\]/.test(item)) {
      addError(errors, 'incomplete-readiness', `Unchecked readiness item: ${item.trim()}`);
    }
  }

  if (/<[^>]+>/.test(contents.replace(/<!--[\s\S]*?-->/g, ''))) {
    addError(errors, 'unresolved-placeholder', 'Feature spec still contains template placeholders');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics: {
      requirementIds: tracedRequirements,
      acceptanceIds: tracedAcceptance,
      safeguardIds: tracedSafeguards,
      readinessItems: readinessItems.length,
    },
  };
};

const runCli = async () => {
  const argumentsList = process.argv.slice(2);
  const specPath = argumentsList.find((argument) => !argument.startsWith('--'));
  const srsFlag = argumentsList.indexOf('--srs');
  const srsPath = srsFlag === -1 ? null : argumentsList[srsFlag + 1];
  const json = argumentsList.includes('--json');

  if (!specPath) {
    console.error('Usage: node audit-feature-spec.mjs <spec-path> [--srs <path>] [--json]');
    process.exitCode = 2;
    return;
  }

  const result = auditFeatureSpec(await readFile(path.resolve(specPath), 'utf8'), {
    srsContents: srsPath ? await readFile(path.resolve(srsPath), 'utf8') : null,
  });

  process.stdout.write(`${JSON.stringify(result, null, json ? 2 : 0)}\n`);

  if (!result.valid) {
    process.exitCode = 1;
  }
};

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await runCli();
}
