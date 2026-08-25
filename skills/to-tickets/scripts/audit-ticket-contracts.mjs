import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { isCliEntryPoint } from './lib/cli-entry-point.mjs';

const requiredSections = [
  'Outcome',
  'SRS Traceability',
  'Domain Concepts',
  'Approach and Tradeoffs',
  'Architecture Boundary and Public Seam',
  'Safeguards and Invariants',
  'Prohibited Behavior and Non-goals',
  'Risk and Decision Impacts',
  'Acceptance Criteria',
  'Verification Matrix',
  'Blocked By',
  'Unresolved Assumptions',
  'Readiness',
];

export const verificationLayers = [
  'targeted',
  'focused',
  'format',
  'static',
  'static-analysis',
  'affected',
  'affected-tests',
  'smoke',
  'build',
  'browser',
  'e2e',
  'broad',
  'full',
  'broad-tests',
];

const requiredReadinessItems = [
  'The outcome is a complete vertical behavior.',
  'Acceptance criteria trace to the SRS and feature contract.',
  'The public seam and first red test are identified.',
  'Safeguards and non-goals are explicit.',
  'Risks and resolved decisions are traced to the parent contract.',
  'Blocking edges exist and are acyclic.',
  'No unresolved assumption blocks the start.',
  'The ticket fits one fresh implementation context.',
  'User-facing and frontend evidence requirements are covered or explicitly inapplicable.',
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
  /\b(?:(?:FR|NFR|AC|SG)-[A-Z0-9]+-\d{3}|RISK-\d{3}|Q-\d{3})\b/g,
)].map((match) => match[0]);

const blockerIds = (value) => [...value.matchAll(/\bTB-\d{3}\b/g)]
  .map((match) => match[0]);

const uniqueSorted = (values) => [...new Set(values)].sort();
const addError = (errors, code, message) => errors.push({ code, message });

const idsWithPrefix = (values, prefixes) => values.filter(
  (id) => prefixes.some((prefix) => id.startsWith(prefix)),
);

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

export const auditTicketSet = (
  tickets,
  { contractContents = null, specContents = null } = {},
) => {
  const parentContents = contractContents ?? specContents;
  const errors = [];
  const warnings = [];
  const knownTicketIds = new Set(tickets.map((ticket) => ticket.id));
  const contractSections = parentContents === null ? null : parseSections(parentContents);
  const contractTable = parseFirstTable(contractSections?.get(normalize('Feature Contract')));
  const parentStatus = contractTable?.rows.find(
    (row) => normalize(row[0] ?? '') === 'status',
  )?.[1]?.trim();
  const parentTraceIds = contractSections === null ? null : uniqueSorted(traceIds(
    contractSections.get(normalize('SRS Traceability'))?.lines.join('\n') ?? '',
  ));
  const knownContractIds = parentTraceIds === null ? null : new Set(parentTraceIds);
  const parentAcceptanceIds = idsWithPrefix(parentTraceIds ?? [], ['AC-']);
  const parentSafeguardIds = idsWithPrefix(parentTraceIds ?? [], ['SG-']);
  const parentRiskDecisionIds = idsWithPrefix(parentTraceIds ?? [], ['RISK-', 'Q-']);
  const coveredAcceptanceIds = new Set();
  const coveredSafeguardIds = new Set();
  const coveredRiskDecisionIds = new Set();
  const graph = new Map();

  if (parentContents === null) {
    addError(
      errors,
      'parent-not-loaded',
      'Load the parent feature contract before auditing ready tickets',
    );
  } else if (parentStatus !== 'ready-for-tickets') {
    addError(
      errors,
      'parent-not-ready',
      'Parent feature contract status must be ready-for-tickets',
    );
  }

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

    // A contract carries claims about how the code behaves today and proposals
    // about how to build the slice. Unmarked, the two read alike, and an
    // implementer who complies rather than pushes back ships the author's
    // guess. `Approach and Tradeoffs` is where proposals live, so it is where
    // the distinction has to be visible.
    const approach = sections.get(normalize('Approach and Tradeoffs'));

    if (approach && !approach.lines.some((line) => /\b(Verified|Proposed):/.test(line))) {
      addError(
        errors,
        'unmarked-approach',
        `${ticket.id} Approach and Tradeoffs marks nothing Verified: or Proposed:`,
      );
    }

    const status = ticket.contents.match(/^\*\*Status:\*\*\s*(.+)$/m)?.[1].trim();
    const parent = ticket.contents.match(
      /^\*\*Parent feature contract:\*\*\s*(.+)$/m,
    )?.[1].trim();
    const legacyParent = ticket.contents.match(
      /^\*\*Parent feature spec:\*\*\s*(.+)$/m,
    )?.[1].trim();

    if (status !== 'ready-for-agent') {
      addError(errors, 'not-ready', `${ticket.id} status must be ready-for-agent`);
    }

    if (!parent && !legacyParent) {
      addError(errors, 'missing-parent-contract', `${ticket.id} must reference its feature contract`);
    } else if (!parent && legacyParent) {
      warnings.push({
        code: 'deprecated-parent-field',
        message: `${ticket.id} should rename Parent feature spec to Parent feature contract`,
      });
    }

    const ticketTraceIds = uniqueSorted(traceIds(
      sections.get(normalize('SRS Traceability'))?.lines.join('\n') ?? '',
    ));

    if (ticketTraceIds.length === 0) {
      addError(errors, 'missing-traceability', `${ticket.id} has no SRS traceability`);
    }

    if (idsWithPrefix(ticketTraceIds, ['FR-', 'NFR-']).length === 0) {
      addError(errors, 'missing-requirement-trace', `${ticket.id} must trace an SRS requirement`);
    }

    if (idsWithPrefix(ticketTraceIds, ['AC-']).length === 0) {
      addError(errors, 'missing-acceptance-trace', `${ticket.id} must trace a parent acceptance criterion`);
    }

    if (knownContractIds) {
      for (const reference of ticketTraceIds) {
        if (!knownContractIds.has(reference)) {
          addError(
            errors,
            'unknown-spec-reference',
            `${ticket.id} references ${reference}, which is outside the feature contract`,
          );
        }
      }
    }

    const acceptanceLines = sections.get(normalize('Acceptance Criteria'))?.lines ?? [];
    const ticketAcceptanceIds = uniqueSorted(
      traceIds(acceptanceLines.join('\n')).filter((id) => id.startsWith('AC-')),
    );

    for (const acceptanceId of ticketAcceptanceIds) {
      coveredAcceptanceIds.add(acceptanceId);

      if (!ticketTraceIds.includes(acceptanceId)) {
        addError(
          errors,
          'acceptance-not-traced',
          `${ticket.id} acceptance ${acceptanceId} is absent from SRS Traceability`,
        );
      }

      if (knownContractIds && !knownContractIds.has(acceptanceId)) {
        addError(
          errors,
          'unknown-parent-acceptance',
          `${ticket.id} acceptance ${acceptanceId} is outside the parent feature contract`,
        );
      }
    }

    for (const acceptanceId of idsWithPrefix(ticketTraceIds, ['AC-'])) {
      if (!ticketAcceptanceIds.includes(acceptanceId)) {
        addError(
          errors,
          'missing-ticket-acceptance-detail',
          `${ticket.id} traces ${acceptanceId} without an observable acceptance criterion`,
        );
      }
    }

    if (!acceptanceLines.some((line) => /^\s*- \[[ xX]\].*\bAC-[A-Z0-9]+-\d{3}\b/.test(line))) {
      addError(
        errors,
        'missing-acceptance-criteria',
        `${ticket.id} must contain acceptance criteria linked by ID`,
      );
    }

    const safeguardSectionIds = uniqueSorted(idsWithPrefix(traceIds(
      sections.get(normalize('Safeguards and Invariants'))?.lines.join('\n') ?? '',
    ), ['SG-']));

    for (const safeguardId of idsWithPrefix(ticketTraceIds, ['SG-'])) {
      if (!safeguardSectionIds.includes(safeguardId)) {
        addError(
          errors,
          'missing-safeguard-detail',
          `${ticket.id} traces ${safeguardId} without a safeguard definition`,
        );
      } else {
        coveredSafeguardIds.add(safeguardId);
      }
    }

    const impactIds = uniqueSorted(idsWithPrefix(traceIds(
      sections.get(normalize('Risk and Decision Impacts'))?.lines.join('\n') ?? '',
    ), ['RISK-', 'Q-']));
    const tracedRiskDecisionIds = idsWithPrefix(ticketTraceIds, ['RISK-', 'Q-']);

    for (const impactId of impactIds) {
      if (!ticketTraceIds.includes(impactId)) {
        addError(
          errors,
          'risk-decision-not-traced',
          `${ticket.id} impact ${impactId} is absent from SRS Traceability`,
        );
      }

      if (knownContractIds && !knownContractIds.has(impactId)) {
        addError(
          errors,
          'unknown-parent-risk-decision',
          `${ticket.id} impact ${impactId} is outside the parent feature contract`,
        );
      }
    }

    for (const impactId of tracedRiskDecisionIds) {
      if (!impactIds.includes(impactId)) {
        addError(
          errors,
          'missing-risk-decision-impact',
          `${ticket.id} traces ${impactId} without recording its delivery impact`,
        );
      } else {
        coveredRiskDecisionIds.add(impactId);
      }
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
        const layerColumn = columnIndex(verificationTable, 'Layer');

        for (const row of verificationTable.rows) {
          if (!row[commandColumn]?.trim() || !row[evidenceColumn]?.trim()) {
            addError(
              errors,
              'incomplete-verification-row',
              `${ticket.id} has a verification row without evidence or command`,
            );
          }

          const requirement = row[requiredColumn] ?? '';

          if (!/^(?:yes|no)\b(?:\s*[-—:]\s*|\s+).+/i.test(requirement)) {
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

          if (!verificationLayers.includes((row[layerColumn] ?? '').toLowerCase())) {
            addError(
              errors,
              'invalid-verification-layer',
              `${ticket.id} uses unsupported verification layer ${row[layerColumn] ?? ''}`,
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

    const readinessText = new Set(readinessItems.map(
      (line) => line.replace(/^\s*- \[[ xX]\]\s*/, '').trim(),
    ));

    for (const requiredItem of requiredReadinessItems) {
      if (!readinessText.has(requiredItem)) {
        addError(
          errors,
          'missing-readiness-item',
          `${ticket.id} readiness is missing: ${requiredItem}`,
        );
      }
    }

    if (/<[^>]+>/.test(ticket.contents.replace(/<!--[\s\S]*?-->/g, ''))) {
      addError(errors, 'unresolved-placeholder', `${ticket.id} contains template placeholders`);
    }
  }

  if (graphHasCycle(graph)) {
    addError(errors, 'blocker-cycle', 'Ticket blocker graph contains a cycle');
  }

  const coverageChecks = [
    ['acceptance', parentAcceptanceIds, coveredAcceptanceIds],
    ['safeguard', parentSafeguardIds, coveredSafeguardIds],
    ['risk or decision', parentRiskDecisionIds, coveredRiskDecisionIds],
  ];

  for (const [kind, parentIds, coveredIds] of coverageChecks) {
    for (const parentId of parentIds) {
      if (!coveredIds.has(parentId)) {
        addError(
          errors,
          `missing-parent-${kind.replaceAll(' ', '-')}-coverage`,
          `Parent ${kind} ${parentId} is not covered by a ready ticket`,
        );
      }
    }
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
  const contractFlag = argumentsList.indexOf('--contract');
  const legacySpecFlag = argumentsList.indexOf('--spec');
  const contractPath = contractFlag !== -1
    ? argumentsList[contractFlag + 1]
    : legacySpecFlag === -1 ? null : argumentsList[legacySpecFlag + 1];

  if (!directory || !contractPath) {
    console.error('Usage: node audit-ticket-contracts.mjs <ticket-directory> --contract <path>');
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
    contractContents: contractPath ? await readFile(path.resolve(contractPath), 'utf8') : null,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (!result.valid) {
    process.exitCode = 1;
  }
};

if (isCliEntryPoint(import.meta.url)) {
  await runCli();
}
