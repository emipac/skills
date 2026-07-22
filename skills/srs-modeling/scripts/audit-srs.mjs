import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const sectionDefinitions = [
  ['document-control', 'Document Control'],
  ['purpose-and-scope', 'Purpose and Scope'],
  ['product-context', 'Product Context'],
  ['domain-concepts-and-actors', 'Domain Concepts and Actors'],
  ['architecture-constraints-and-decisions', 'Architecture Constraints and Decisions'],
  ['functional-requirements', 'Functional Requirements'],
  ['non-functional-requirements', 'Non-functional Requirements'],
  ['safeguards', 'Safeguards'],
  ['scenarios-and-use-cases', 'Scenarios and Use Cases'],
  ['risks', 'Risks'],
  ['open-questions', 'Open Questions'],
  ['acceptance-criteria', 'Acceptance Criteria'],
  ['traceability-and-readiness', 'Traceability and Readiness'],
  ['out-of-scope', 'Out of Scope'],
];

const definitionSections = {
  'functional-requirements': {
    type: 'requirement',
    pattern: /^FR-[A-Z0-9]+-\d{3}$/,
  },
  'non-functional-requirements': {
    type: 'requirement',
    pattern: /^NFR-[A-Z0-9]+-\d{3}$/,
  },
  safeguards: {
    type: 'safeguard',
    pattern: /^SG-[A-Z0-9]+-\d{3}$/,
  },
  risks: {
    type: 'risk',
    pattern: /^RISK-\d{3}$/,
  },
  'open-questions': {
    type: 'question',
    pattern: /^Q-\d{3}$/,
  },
  'acceptance-criteria': {
    type: 'acceptance',
    pattern: /^AC-[A-Z0-9]+-\d{3}$/,
  },
};

const normalizeHeading = (heading) => heading
  .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const cleanCell = (cell) => cell
  .replace(/\*\*/g, '')
  .replace(/`/g, '')
  .trim();

const splitTableRow = (line) => line
  .trim()
  .replace(/^\|/, '')
  .replace(/\|$/, '')
  .split('|')
  .map(cleanCell);

const isSeparatorRow = (cells) => cells.every((cell) => /^:?-{3,}:?$/.test(cell));

const parseSections = (contents) => {
  const sections = new Map();
  let currentSection = null;

  for (const line of contents.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);

    if (heading) {
      currentSection = {
        heading: heading[1],
        lines: [],
      };
      sections.set(normalizeHeading(heading[1]), currentSection);
      continue;
    }

    currentSection?.lines.push(line);
  }

  return sections;
};

const parseFirstTable = (section) => {
  if (!section) {
    return null;
  }

  const tableLines = section.lines.filter((line) => /^\s*\|.*\|\s*$/.test(line));

  if (tableLines.length < 2) {
    return null;
  }

  const header = splitTableRow(tableLines[0]);
  const separator = splitTableRow(tableLines[1]);

  if (!isSeparatorRow(separator)) {
    return null;
  }

  return {
    header,
    rows: tableLines.slice(2).map(splitTableRow),
  };
};

const columnIndex = (table, name) => table.header.findIndex(
  (column) => normalizeHeading(column) === normalizeHeading(name),
);

const referencesIn = (value) => [
  ...(value ?? '').matchAll(/\b(?:FR|NFR)-[A-Z0-9]+-\d{3}\b/g),
].map((match) => match[0]);

const addError = (errors, code, message) => errors.push({ code, message });

export const auditSrs = (contents) => {
  const sections = parseSections(contents);
  const errors = [];
  const warnings = [];
  const definitions = [];
  const tables = new Map();

  for (const [sectionKey, sectionName] of sectionDefinitions) {
    if (!sections.has(sectionKey)) {
      addError(errors, 'missing-section', `Missing required section: ${sectionName}`);
    }
  }

  for (const [sectionKey, definition] of Object.entries(definitionSections)) {
    const table = parseFirstTable(sections.get(sectionKey));
    tables.set(sectionKey, table);

    if (!table) {
      addError(
        errors,
        'missing-table',
        `${sectionDefinitions.find(([key]) => key === sectionKey)?.[1]} must contain a Markdown table`,
      );
      continue;
    }

    const statusColumn = definition.type === 'requirement'
      ? columnIndex(table, 'Status')
      : -1;
    const requiresRows = [
      'functional-requirements',
      'non-functional-requirements',
      'acceptance-criteria',
    ].includes(sectionKey);

    if (requiresRows && table.rows.length === 0) {
      addError(
        errors,
        'empty-required-table',
        `${sectionDefinitions.find(([key]) => key === sectionKey)?.[1]} must contain at least one row`,
      );
    }

    if (definition.type === 'requirement' && statusColumn === -1) {
      addError(
        errors,
        'missing-status-column',
        `${sectionDefinitions.find(([key]) => key === sectionKey)?.[1]} must contain a Status column`,
      );
    }

    for (const row of table.rows) {
      const id = row[0];

      if (!definition.pattern.test(id)) {
        addError(
          errors,
          'invalid-id',
          `${id || '(empty)'} is not a valid stable ID for ${sectionKey}`,
        );
        continue;
      }

      definitions.push({
        id,
        sectionKey,
        type: definition.type,
        row,
        status: statusColumn === -1 ? null : row[statusColumn],
      });
    }
  }

  const definitionCounts = new Map();

  for (const definition of definitions) {
    definitionCounts.set(definition.id, (definitionCounts.get(definition.id) ?? 0) + 1);
  }

  for (const [id, count] of definitionCounts) {
    if (count > 1) {
      addError(errors, 'duplicate-id', `${id} is defined ${count} times`);
    }
  }

  const requirementIds = new Set(
    definitions
      .filter((definition) => definition.type === 'requirement')
      .map((definition) => definition.id),
  );
  const activeRequirementIds = new Set(
    definitions
      .filter((definition) => (
        definition.type === 'requirement'
        && !/^(?:retired|superseded|withdrawn)$/i.test(definition.status ?? '')
      ))
      .map((definition) => definition.id),
  );
  const acceptanceReferences = new Set();
  const acceptanceTable = tables.get('acceptance-criteria');

  if (acceptanceTable) {
    const requirementColumn = columnIndex(acceptanceTable, 'Requirement IDs');

    if (requirementColumn === -1) {
      addError(
        errors,
        'missing-traceability-column',
        'Acceptance Criteria must contain a Requirement IDs column',
      );
    } else {
      for (const row of acceptanceTable.rows) {
        const references = referencesIn(row[requirementColumn]);

        if (references.length === 0) {
          addError(
            errors,
            'missing-requirement-reference',
            `${row[0]} does not reference a requirement`,
          );
        }

        for (const reference of references) {
          acceptanceReferences.add(reference);

          if (!requirementIds.has(reference)) {
            addError(
              errors,
              'unknown-requirement-reference',
              `${row[0]} references unknown requirement ${reference}`,
            );
          }
        }
      }
    }
  }

  const uncoveredRequirements = [...activeRequirementIds]
    .filter((id) => !acceptanceReferences.has(id))
    .sort();

  for (const requirementId of uncoveredRequirements) {
    addError(
      errors,
      'missing-acceptance-coverage',
      `${requirementId} has no acceptance-criteria coverage`,
    );
  }

  const safeguardTable = tables.get('safeguards');

  if (safeguardTable) {
    const protectsColumn = columnIndex(safeguardTable, 'Protects');

    if (protectsColumn === -1) {
      addError(errors, 'missing-protects-column', 'Safeguards must contain a Protects column');
    } else {
      for (const row of safeguardTable.rows) {
        const references = referencesIn(row[protectsColumn]);

        if (references.length === 0) {
          addError(
            errors,
            'missing-requirement-reference',
            `${row[0]} does not protect a requirement`,
          );
        }

        for (const reference of references) {
          if (!requirementIds.has(reference)) {
            addError(
              errors,
              'unknown-requirement-reference',
              `${row[0]} protects unknown requirement ${reference}`,
            );
          }
        }
      }
    }
  }

  const unresolvedOpenQuestions = [];
  const questionTable = tables.get('open-questions');

  if (questionTable) {
    const statusColumn = columnIndex(questionTable, 'Status');

    if (statusColumn === -1) {
      addError(errors, 'missing-status-column', 'Open Questions must contain a Status column');
    } else {
      for (const row of questionTable.rows) {
        if (!/^(?:resolved|closed|answered)$/i.test(row[statusColumn])) {
          unresolvedOpenQuestions.push(row[0]);
        }
      }
    }
  }

  for (const questionId of unresolvedOpenQuestions) {
    warnings.push({
      code: 'open-question',
      message: `${questionId} remains unresolved`,
    });
  }

  if (/<[^>]+>/.test(contents.replace(/<!--[\s\S]*?-->/g, ''))) {
    addError(errors, 'unresolved-placeholder', 'The SRS still contains template placeholders');
  }

  const countDefinitions = (type) => definitions.filter(
    (definition) => definition.type === type,
  ).length;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics: {
      requirements: countDefinitions('requirement'),
      acceptanceCriteria: countDefinitions('acceptance'),
      safeguards: countDefinitions('safeguard'),
      risks: countDefinitions('risk'),
      openQuestions: countDefinitions('question'),
      uncoveredRequirements,
      unresolvedOpenQuestions: unresolvedOpenQuestions.sort(),
    },
  };
};

const renderTextReport = (result) => {
  const lines = [
    result.valid ? 'SRS audit passed.' : 'SRS audit failed.',
    `Requirements: ${result.metrics.requirements}`,
    `Acceptance criteria: ${result.metrics.acceptanceCriteria}`,
    `Safeguards: ${result.metrics.safeguards}`,
    `Risks: ${result.metrics.risks}`,
    `Open questions: ${result.metrics.openQuestions}`,
  ];

  for (const error of result.errors) {
    lines.push(`ERROR [${error.code}] ${error.message}`);
  }

  for (const warning of result.warnings) {
    lines.push(`WARN [${warning.code}] ${warning.message}`);
  }

  return `${lines.join('\n')}\n`;
};

const runCli = async () => {
  const argumentsList = process.argv.slice(2);
  const json = argumentsList.includes('--json');
  const srsArgument = argumentsList.find((argument) => argument !== '--json');

  if (!srsArgument) {
    console.error('Usage: node audit-srs.mjs <srs-path> [--json]');
    process.exitCode = 2;
    return;
  }

  const srsPath = path.resolve(srsArgument);
  const result = auditSrs(await readFile(srsPath, 'utf8'));
  process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : renderTextReport(result));

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
