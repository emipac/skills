import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const requiredSections = [
  'Outcome',
  'SRS Traceability',
  'Domain Concepts',
  'Approach and Tradeoffs',
  'Architecture Boundary and Public Seam',
  'Safeguards and Invariants',
  'Prohibited Behavior and Non-goals',
  'Acceptance Criteria',
  'Verification Matrix',
  'Blocked By',
  'Unresolved Assumptions',
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

const traceIds = (value) => [...value.matchAll(
  /\b(?:FR|NFR|AC|SG)-[A-Z0-9]+-\d{3}\b/g,
)].map((match) => match[0]);

const blockerIds = (value) => [...value.matchAll(/\bTB-\d{3}\b/g)]
  .map((match) => match[0]);

const uniqueSorted = (values) => [...new Set(values)].sort();
const addError = (errors, code, message) => errors.push({ code, message });

const graphHasCycle = (graph) => {
  const visiting = new Set();
  const visited = new Set();

  const visit = (id) => {
    if (visiting.has(id)) {
      return true;
    }

    if (visited.has(id)) {
      return false;
    }

    visiting.add(id);

    for (const blocker of graph.get(id) ?? []) {
      if (graph.has(blocker) && visit(blocker)) {
        return true;
      }
    }

    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return [...graph.keys()].some(visit);
};

export const auditTicketSet = (tickets, { specContents = null } = {}) => {
  const errors = [];
  const warnings = [];
  const knownTicketIds = new Set(tickets.map((ticket) => ticket.id));
  const knownSpecIds = specContents === null ? null : new Set(traceIds(specContents));
  const graph = new Map();

  for (const ticket of tickets) {
    if (!/^TB-\d{3}$/.test(ticket.id)) {
      addError(errors, 'invalid-ticket-id', `${ticket.id} must use TB-NNN format`);
    }

    const sections = parseSections(ticket.contents);

    for (const sectionName of requiredSections) {
      const section = sections.get(normalize(sectionName));

      if (!section) {
        addError(errors, 'missing-section', `${ticket.id} is missing ${sectionName}`);
      } else if (!section.lines.some(
        (line) => line.trim() && !/^<!--/.test(line.trim()),
      )) {
        addError(errors, 'empty-section', `${ticket.id} ${sectionName} is empty`);
      }
    }

    const status = ticket.contents.match(/^\*\*Status:\*\*\s*(.+)$/m)?.[1].trim();
    const parent = ticket.contents.match(
      /^\*\*Parent feature spec:\*\*\s*(.+)$/m,
    )?.[1].trim();

    if (status !== 'ready-for-agent') {
      addError(errors, 'not-ready', `${ticket.id} status must be ready-for-agent`);
    }

    if (!parent) {
      addError(errors, 'missing-parent-contract', `${ticket.id} must reference its feature spec`);
    }

    const ticketTraceIds = uniqueSorted(traceIds(
      sections.get(normalize('SRS Traceability'))?.lines.join('\n') ?? '',
    ));

    if (ticketTraceIds.length === 0) {
      addError(errors, 'missing-traceability', `${ticket.id} has no SRS traceability`);
    }

    if (knownSpecIds) {
      for (const reference of ticketTraceIds) {
        if (!knownSpecIds.has(reference)) {
          addError(
            errors,
            'unknown-spec-reference',
            `${ticket.id} references ${reference}, which is outside the feature spec`,
          );
        }
      }
    } else {
      warnings.push({
        code: 'spec-not-loaded',
        message: `${ticket.id} traceability was not checked against a feature spec`,
      });
    }

    const acceptanceLines = sections.get(normalize('Acceptance Criteria'))?.lines ?? [];
    const ticketAcceptanceIds = uniqueSorted(
      traceIds(acceptanceLines.join('\n')).filter((id) => id.startsWith('AC-')),
    );

    if (!acceptanceLines.some((line) => /^\s*- \[[ xX]\].*\bAC-[A-Z0-9]+-\d{3}\b/.test(line))) {
      addError(
        errors,
        'missing-acceptance-criteria',
        `${ticket.id} must contain acceptance criteria linked by ID`,
      );
    }

    const verificationTable = parseFirstTable(sections.get(normalize('Verification Matrix')));
    const verifiedAcceptanceIds = new Set(traceIds(
      sections.get(normalize('Verification Matrix'))?.lines.join('\n') ?? '',
    ).filter((id) => id.startsWith('AC-')));

    for (const acceptanceId of ticketAcceptanceIds) {
      if (!verifiedAcceptanceIds.has(acceptanceId)) {
        addError(
          errors,
          'unverified-acceptance',
          `${ticket.id} verification matrix does not map ${acceptanceId}`,
        );
      }
    }

    if (!verificationTable || verificationTable.rows.length === 0) {
      addError(errors, 'missing-verification', `${ticket.id} has no verification matrix`);
    } else {
      const verificationColumns = [
        'Layer',
        'Scope',
        'Evidence',
        'Command or capability',
        'Required',
      ];
      const missingColumns = verificationColumns.filter(
        (column) => columnIndex(verificationTable, column) === -1,
      );

      if (missingColumns.length > 0) {
        addError(
          errors,
          'invalid-verification-matrix',
          `${ticket.id} verification matrix is missing ${missingColumns.join(', ')}`,
        );
      } else {
        const commandColumn = columnIndex(verificationTable, 'Command or capability');
        const evidenceColumn = columnIndex(verificationTable, 'Evidence');
        const requiredColumn = columnIndex(verificationTable, 'Required');
        const scopeColumn = columnIndex(verificationTable, 'Scope');

        for (const row of verificationTable.rows) {
          if (!row[commandColumn]?.trim() || !row[evidenceColumn]?.trim()) {
            addError(
              errors,
              'incomplete-verification-row',
              `${ticket.id} has a verification row without evidence or command`,
            );
          }

          if (!/^(?:yes|no)(?:\b|\s)/i.test(row[requiredColumn] ?? '')) {
            addError(
              errors,
              'invalid-verification-requirement',
              `${ticket.id} verification rows must state Yes or No with a reason`,
            );
          }

          if (!/^(?:backend|frontend|both)$/i.test(row[scopeColumn] ?? '')) {
            addError(
              errors,
              'invalid-verification-scope',
              `${ticket.id} verification rows must use backend, frontend, or both scope`,
            );
          }
        }
      }
    }

    const blockerText = sections.get(normalize('Blocked By'))?.lines.join('\n') ?? '';
    const blockers = uniqueSorted(blockerIds(blockerText));
    graph.set(ticket.id, blockers);

    for (const blocker of blockers) {
      if (blocker === ticket.id) {
        addError(errors, 'self-blocker', `${ticket.id} blocks itself`);
      } else if (!knownTicketIds.has(blocker)) {
        addError(errors, 'unknown-blocker', `${ticket.id} references unknown blocker ${blocker}`);
      }
    }

    const assumptionTable = parseFirstTable(sections.get(normalize('Unresolved Assumptions')));

    if (assumptionTable) {
      const blocksColumn = columnIndex(assumptionTable, 'Blocks start');
      const resolutionColumn = columnIndex(assumptionTable, 'Resolution');

      if (blocksColumn === -1 || resolutionColumn === -1) {
        addError(
          errors,
          'invalid-assumption-table',
          `${ticket.id} assumptions require Blocks start and Resolution columns`,
        );
      } else {
        for (const row of assumptionTable.rows) {
          const blocks = /^(?:yes|true)$/i.test(row[blocksColumn] ?? '');
          const unresolved = /^(?:|open|unresolved|tbd|—|-)$/i.test(
            row[resolutionColumn] ?? '',
          );

          if (blocks && unresolved) {
            addError(
              errors,
              'blocking-assumption',
              `${ticket.id} cannot start while ${row[0]} remains unresolved`,
            );
          }
        }
      }
    }

    const readinessLines = sections.get(normalize('Readiness'))?.lines ?? [];
    const readinessItems = readinessLines.filter((line) => /^\s*- \[[ xX]\]/.test(line));

    if (readinessItems.length === 0) {
      addError(errors, 'missing-readiness-checklist', `${ticket.id} has no readiness checklist`);
    }

    for (const item of readinessItems) {
      if (!/^\s*- \[[xX]\]/.test(item)) {
        addError(errors, 'incomplete-readiness', `${ticket.id}: ${item.trim()}`);
      }
    }

    if (/<[^>]+>/.test(ticket.contents.replace(/<!--[\s\S]*?-->/g, ''))) {
      addError(errors, 'unresolved-placeholder', `${ticket.id} contains template placeholders`);
    }
  }

  if (graphHasCycle(graph)) {
    addError(errors, 'blocker-cycle', 'Ticket blocker graph contains a cycle');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics: {
      tickets: tickets.length,
      frontier: [...graph]
        .filter(([, blockers]) => blockers.length === 0)
        .map(([id]) => id)
        .sort(),
    },
  };
};

const runCli = async () => {
  const argumentsList = process.argv.slice(2);
  const directory = argumentsList.find((argument) => !argument.startsWith('--'));
  const specFlag = argumentsList.indexOf('--spec');
  const specPath = specFlag === -1 ? null : argumentsList[specFlag + 1];

  if (!directory) {
    console.error('Usage: node audit-ticket-contracts.mjs <ticket-directory> [--spec <path>]');
    process.exitCode = 2;
    return;
  }

  const resolvedDirectory = path.resolve(directory);
  const entries = (await readdir(resolvedDirectory))
    .filter((entry) => entry.endsWith('.md'))
    .sort();
  const tickets = await Promise.all(entries.map(async (entry) => {
    const contents = await readFile(path.join(resolvedDirectory, entry), 'utf8');

    return {
      id: contents.match(/^#\s+(TB-\d{3})\b/m)?.[1] ?? entry,
      contents,
    };
  }));
  const result = auditTicketSet(tickets, {
    specContents: specPath ? await readFile(path.resolve(specPath), 'utf8') : null,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

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
