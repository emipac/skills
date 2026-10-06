import { line } from './shared.mjs';

/** What a check did with its decision, in the store's own words (`RISK-010`). */
const renderEvidence = (evidence) => {
  if (evidence.appended) {
    return `appended ${evidence.evidenceId} to ${evidence.storeRoot}`;
  }

  if (evidence.notRecorded === 'passing-not-recorded') {
    return 'not appended — a passing check records nothing';
  }

  if (evidence.notRecorded === 'no-change-to-record') {
    return 'not appended — nothing changed, so there is nothing to record';
  }

  return `not appended (${evidence.reasonCode ?? 'unknown'}) — the store at ${evidence.storeRoot ?? 'an unresolved path'} did not record this decision`;
};

/** Which declared dependency roots the evaluated tree was given, and how (`TB-054`, `TB-057`). */
const renderDependencyRecord = (record) => {
  const strategy = (root) => (typeof record?.provisioning === 'string'
    ? record.provisioning
    : record?.provisioning?.[root] ?? 'unstated');
  const roots = [
    ...(record?.provided ?? []).map((root) => `${root} provided (${strategy(root)})`),
    ...(record?.missing ?? []).map((root) => `${root} missing`),
    ...(record?.refused ?? []).map((root) => `${root} refused`),
  ];

  return roots.length === 0 ? 'none declared' : roots.join(', ');
};

/** Which declared Sensitive inputs the redactor was armed for, by name only (`TB-045`). */
const renderRedaction = (redaction) => {
  const inputs = [
    ...(redaction?.armed ?? []).map((input) => `${input.name} (${input.source}) armed`),
    ...(redaction?.unresolved ?? []).map((input) => `${input.name} (${input.source}) unresolved`),
  ];

  return inputs.length === 0 ? 'none declared' : inputs.join(', ');
};

export const renderCheck = (observation) => [
  line('scope', `${observation.scope} (${observation.describes})`),
  line('snapshot', observation.snapshot.id === null
    ? `none (${observation.snapshot.kind}: nothing changed against ${observation.snapshot.baseRevision})`
    : `${observation.snapshot.id} (${observation.snapshot.kind})`),
  line('evaluation', observation.evaluationId),
  line('outcome', observation.outcome),
  line('authorization', observation.authorization),
  line('checks', observation.checks.length),
  ...observation.checks.map((entry) => `  - [${entry.policy}] ${entry.summary}`),
  line('diagnostics', observation.diagnostics.length),
  ...observation.diagnostics.map((diagnostic) => `  - ${diagnostic.reasonCode}: ${diagnostic.detail}`),
  line('grader surfaces', observation.graderSurfaces.length),
  ...observation.graderSurfaces.map(
    (surface) => `  - ${surface.kind} ${surface.path}${surface.checkId === null ? '' : ` (${surface.checkId})`}`,
  ),
  line('dependency roots', renderDependencyRecord(observation.dependencies)),
  line('sensitive inputs', renderRedaction(observation.redaction)),
  ...(observation.redaction?.environmentFiles ?? []).length === 0
    ? []
    : [line('environment files', observation.redaction.environmentFiles
      .map((file) => `${file.path} (${file.status})`).join(', '))],
  line('elapsed', `${observation.elapsedMs} ms`),
  line('evidence', renderEvidence(observation.evidence)),
  line('limit', observation.limit),
];
