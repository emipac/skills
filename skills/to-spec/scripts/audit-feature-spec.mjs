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

const requiredReadinessItems = [
  'Every in-scope requirement maps to acceptance evidence.',
  'Public test seams are agreed.',
  'Safeguards and prohibited behavior are explicit.',
  'Risks and resolved decisions have explicit dispositions.',
  'Blocking gaps and assumptions are resolved.',
  'Out-of-scope behavior is explicit.',
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
const riskIds = (value) => ids(value, /\bRISK-\d{3}\b/g);
const questionIds = (value) => ids(value, /\bQ-\d{3}\b/g);
const uniqueSorted = (values) => [...new Set(values)].sort();

const addError = (errors, code, message) => errors.push({ code, message });

const requiredColumns = (table, columns) => columns.filter(
  (column) => columnIndex(table, column) === -1,
);

const tableField = (table, field) => table?.rows.find(
  (row) => normalize(row[0] ?? '') === normalize(field),
)?.[1]?.trim();

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

  if (!contractTable) {
    addError(errors, 'missing-contract-table', 'Feature Contract must contain a field table');
  } else if (tableField(contractTable, 'Status') !== 'ready-for-tickets') {
    addError(errors, 'not-ready', 'Feature Contract status must be ready-for-tickets');
  }

  for (const field of ['SRS baseline', 'Decision sources']) {
    if (!tableField(contractTable, field)) {
      addError(errors, 'missing-contract-field', `Feature Contract must define ${field}`);
    }
  }

  const traceabilitySection = sections.get(normalize('SRS Traceability'));
  const traceabilityTable = parseFirstTable(traceabilitySection);
  const traceabilityText = traceabilitySection?.lines.join('\n') ?? '';
  const tracedRequirements = uniqueSorted(requirementIds(traceabilityText));
  const tracedAcceptance = uniqueSorted(acceptanceIds(traceabilityText));
  const tracedSafeguards = uniqueSorted(safeguardIds(traceabilityText));
  const tracedRisks = uniqueSorted(riskIds(traceabilityText));
  const tracedQuestions = uniqueSorted(questionIds(traceabilityText));

  if (!traceabilityTable) {
    addError(errors, 'missing-traceability-table', 'SRS Traceability must contain a mapping table');
  } else {
    const missingColumns = requiredColumns(traceabilityTable, [
      'Requirement IDs',
      'Acceptance IDs',
      'Safeguard IDs',
      'Risk IDs',
      'Question IDs',
      'Scope',
    ]);

    if (missingColumns.length > 0) {
      addError(
        errors,
        'invalid-traceability-table',
        `SRS Traceability is missing ${missingColumns.join(', ')}`,
      );
    }
  }

  if (tracedRequirements.length === 0) {
    addError(errors, 'missing-traceability', 'Feature contract must reference at least one SRS requirement');
  }

  if (tracedAcceptance.length === 0) {
    addError(errors, 'missing-acceptance-trace', 'Feature contract must reference SRS acceptance criteria');
  }

  if (srsContents !== null) {
    const knownIds = new Set([
      ...requirementIds(srsContents),
      ...acceptanceIds(srsContents),
      ...safeguardIds(srsContents),
      ...riskIds(srsContents),
      ...questionIds(srsContents),
    ]);

    for (const reference of [
      ...tracedRequirements,
      ...tracedAcceptance,
      ...tracedSafeguards,
      ...tracedRisks,
      ...tracedQuestions,
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
  } else {
    const missingColumns = requiredColumns(acceptanceTable, ['ID', 'Criterion', 'Evidence seam']);

    if (missingColumns.length > 0) {
      addError(
        errors,
        'invalid-acceptance-table',
        `Acceptance Criteria is missing ${missingColumns.join(', ')}`,
      );
    }
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

  for (const reference of specifiedAcceptance) {
    if (!tracedAcceptance.includes(reference)) {
      addError(
        errors,
        'untraced-acceptance-detail',
        `${reference} is defined without parent SRS traceability`,
      );
    }
  }

  if (acceptanceTable && requiredColumns(
    acceptanceTable,
    ['ID', 'Criterion', 'Evidence seam'],
  ).length === 0) {
    const idColumn = columnIndex(acceptanceTable, 'ID');
    const criterionColumn = columnIndex(acceptanceTable, 'Criterion');
    const evidenceColumn = columnIndex(acceptanceTable, 'Evidence seam');

    for (const row of acceptanceTable.rows) {
      if (![idColumn, criterionColumn, evidenceColumn].every((index) => row[index]?.trim())) {
        addError(
          errors,
          'incomplete-acceptance-row',
          'Every acceptance row requires an ID, observable criterion, and evidence seam',
        );
      }
    }
  }

  const seamSection = sections.get(normalize('Public Interfaces and Test Seams'));
  const seamTable = parseFirstTable(seamSection);
  const seamAcceptance = new Set(acceptanceIds(seamSection?.lines.join('\n') ?? ''));

  if (!seamTable || seamTable.rows.length === 0) {
    addError(errors, 'missing-public-seams', 'Public Interfaces and Test Seams must contain a mapping table');
  } else {
    const missingColumns = requiredColumns(seamTable, [
      'Seam',
      'Behavior observed',
      'Acceptance IDs',
      'Prior art',
    ]);

    if (missingColumns.length > 0) {
      addError(
        errors,
        'invalid-public-seam-table',
        `Public Interfaces and Test Seams is missing ${missingColumns.join(', ')}`,
      );
    } else {
      const seamColumn = columnIndex(seamTable, 'Seam');
      const behaviorColumn = columnIndex(seamTable, 'Behavior observed');
      const acceptanceColumn = columnIndex(seamTable, 'Acceptance IDs');

      for (const row of seamTable.rows) {
        if (![seamColumn, behaviorColumn, acceptanceColumn].every((index) => row[index]?.trim())) {
          addError(
            errors,
            'incomplete-public-seam-row',
            'Every public seam row requires a seam, observable behavior, and acceptance IDs',
          );
        }
      }
    }
  }

  for (const reference of tracedAcceptance) {
    if (!seamAcceptance.has(reference)) {
      addError(
        errors,
        'missing-public-seam-coverage',
        `${reference} has no agreed public evidence seam`,
      );
    }
  }

  for (const reference of seamAcceptance) {
    if (!tracedAcceptance.includes(reference)) {
      addError(
        errors,
        'untraced-public-seam-acceptance',
        `${reference} is mapped to a public seam without SRS traceability`,
      );
    }
  }

  const gapTable = parseFirstTable(sections.get(normalize('Risks, Gaps, and Assumptions')));
  const dispositionIds = new Set(gapTable?.rows.flatMap((row) => [
    ...riskIds(row[0] ?? ''),
    ...questionIds(row[0] ?? ''),
  ]) ?? []);

  if (!gapTable) {
    addError(
      errors,
      'missing-gap-table',
      'Risks, Gaps, and Assumptions must contain a disposition table',
    );
  } else {
    const blocksColumn = columnIndex(gapTable, 'Blocks readiness');
    const resolutionColumn = columnIndex(gapTable, 'Resolution');
    const typeColumn = columnIndex(gapTable, 'Type');
    const impactColumn = columnIndex(gapTable, 'Impact');

    if ([blocksColumn, resolutionColumn, typeColumn, impactColumn].includes(-1)) {
      addError(
        errors,
        'invalid-gap-table',
        'Risks, Gaps, and Assumptions requires Type, Impact, Blocks readiness, and Resolution columns',
      );
    } else {
      for (const row of gapTable.rows) {
        const blocks = /^(?:yes|true)$/i.test(row[blocksColumn] ?? '');
        const unresolved = /^(?:|open|unresolved|tbd|—|-)$/i.test(
          row[resolutionColumn] ?? '',
        );
        const isHighImpactRisk = /^risk$/i.test(row[typeColumn] ?? '')
          && /^high$/i.test(row[impactColumn] ?? '');
        const hasAcceptedDisposition = /^(?:accepted|mitigated|avoided|transferred|resolved)\b/i.test(
          row[resolutionColumn] ?? '',
        );

        if (blocks && unresolved) {
          addError(errors, 'blocking-gap', `${row[0]} blocks readiness and remains unresolved`);
        }

        if (isHighImpactRisk && !hasAcceptedDisposition) {
          addError(
            errors,
            'unresolved-high-impact-risk',
            `${row[0]} requires an accepted risk disposition before readiness`,
          );
        }
      }
    }
  }

  for (const reference of [...tracedRisks, ...tracedQuestions]) {
    if (!dispositionIds.has(reference)) {
      addError(
        errors,
        'missing-risk-decision-disposition',
        `${reference} is traced without an explicit disposition`,
      );
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

  const readinessText = new Set(readinessItems.map(
    (line) => line.replace(/^\s*- \[[ xX]\]\s*/, '').trim(),
  ));

  for (const requiredItem of requiredReadinessItems) {
    if (!readinessText.has(requiredItem)) {
      addError(errors, 'missing-readiness-item', `Readiness is missing: ${requiredItem}`);
    }
  }

  if (/<[^>]+>/.test(contents.replace(/<!--[\s\S]*?-->/g, ''))) {
    addError(errors, 'unresolved-placeholder', 'Feature contract still contains template placeholders');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics: {
      requirementIds: tracedRequirements,
      acceptanceIds: tracedAcceptance,
      safeguardIds: tracedSafeguards,
      riskIds: tracedRisks,
      questionIds: tracedQuestions,
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
