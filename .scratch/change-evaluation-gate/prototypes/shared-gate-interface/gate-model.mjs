export const adapters = [
  {
    id: 'git',
    surface: 'git-pre-commit',
    role: 'authoritative',
    trigger: 'commit-attempt',
    targetKind: 'git-index',
    nativeBlocking: true,
  },
  {
    id: 'claude',
    surface: 'claude-code-desktop',
    role: 'preflight',
    trigger: 'work-complete',
    targetKind: 'worktree',
    nativeBlocking: false,
  },
  {
    id: 'codex',
    surface: 'codex-desktop',
    role: 'preflight',
    trigger: 'work-complete',
    targetKind: 'worktree',
    nativeBlocking: false,
  },
  {
    id: 'cursor',
    surface: 'cursor-ide',
    role: 'preflight',
    trigger: 'work-complete',
    targetKind: 'worktree',
    nativeBlocking: false,
  },
];

export const scenarios = [
  { id: 'passed', label: 'All required checks pass' },
  { id: 'failed', label: 'Required static analysis fails' },
  { id: 'unverified', label: 'Required broad tests time out' },
  { id: 'advisory', label: 'Advisory browser check fails' },
  { id: 'bypassed', label: 'Required failure has an authorized bypass' },
  { id: 'regression-only', label: 'No delivery contract is available' },
  { id: 'conflicting', label: 'Same-snapshot attempts disagree' },
];

const stageOrder = new Map([
  ['focused', 10],
  ['format', 20],
  ['static-analysis', 30],
  ['affected-tests', 40],
  ['smoke', 50],
  ['build', 60],
  ['browser', 70],
  ['broad-tests', 80],
]);

const baseChecks = [
  {
    id: 'laravel.format.pint',
    stage: 'format',
    policy: 'required',
    grader: {
      type: 'code',
      method: 'format-check',
      target: 'artifact',
    },
    outcome: 'passed',
    summary: 'Formatting is clean.',
    assertions: [
      { id: 'FORMAT-CLEAN', outcome: 'passed', summary: 'Formatting is clean.' },
    ],
  },
  {
    id: 'laravel.analysis.phpstan',
    stage: 'static-analysis',
    policy: 'required',
    grader: {
      type: 'code',
      method: 'static-analysis',
      target: 'artifact',
    },
    outcome: 'passed',
    summary: 'Application and test analysis passed.',
    assertions: [
      {
        id: 'STATIC-ANALYSIS-CLEAN',
        outcome: 'passed',
        summary: 'Application and test analysis passed.',
      },
    ],
  },
  {
    id: 'laravel.tests.focused-auth',
    stage: 'focused',
    policy: 'required',
    grader: {
      type: 'code',
      method: 'binary-test',
      target: 'outcome',
    },
    outcome: 'passed',
    summary: 'Empty passwords are rejected.',
    assertions: [
      {
        id: 'AC-AUTH-001',
        outcome: 'passed',
        summary: 'Empty passwords are rejected.',
      },
    ],
  },
  {
    id: 'laravel.browser.critical-flow',
    stage: 'browser',
    policy: 'advisory',
    grader: {
      type: 'code',
      method: 'state-check',
      target: 'outcome',
    },
    outcome: 'passed',
    summary: 'Critical browser flow passed.',
    assertions: [
      {
        id: 'BROWSER-CRITICAL-FLOW',
        outcome: 'passed',
        summary: 'Critical browser flow passed.',
      },
    ],
  },
  {
    id: 'laravel.tests.broad',
    stage: 'broad-tests',
    policy: 'required',
    grader: {
      type: 'code',
      method: 'binary-test',
      target: 'outcome',
    },
    outcome: 'passed',
    summary: 'Broad Pest suite passed.',
    assertions: [
      {
        id: 'REGRESSION-SUITE-PASSED',
        outcome: 'passed',
        summary: 'Broad Pest suite passed.',
      },
    ],
  },
];

const withResult = (check, outcome, summary, reasonCode) => ({
  ...check,
  outcome,
  summary,
  assertions: check.assertions.map((assertion) => ({
    ...assertion,
    outcome,
    summary,
  })),
  attempts: [
    {
      attempt: 1,
      durationMs: 1200,
      exitCode: outcome === 'passed' ? 0 : outcome === 'failed' ? 1 : null,
      outcome,
      reasonCode,
    },
  ],
});

const withConflictingAttempts = (check) => ({
  ...withResult(
    check,
    'unverified',
    'The same grader failed and passed against one snapshot.',
    'attempt-conflict',
  ),
  attempts: [
    {
      attempt: 1,
      durationMs: 1200,
      exitCode: 1,
      outcome: 'failed',
      reasonCode: 'grader-negative',
    },
    {
      attempt: 2,
      durationMs: 1180,
      exitCode: 0,
      outcome: 'passed',
      reasonCode: 'grader-positive',
    },
  ],
});

const checksForScenario = (scenarioId) => baseChecks.map((check) => {
  if (scenarioId === 'failed' && check.id === 'laravel.analysis.phpstan') {
    return withResult(check, 'failed', 'PHPStan found two errors.', 'grader-negative');
  }

  if (scenarioId === 'unverified' && check.id === 'laravel.tests.broad') {
    return withResult(check, 'unverified', 'Command timed out.', 'timeout');
  }

  if (scenarioId === 'advisory' && check.id === 'laravel.browser.critical-flow') {
    return withResult(check, 'failed', 'Browser evidence failed.', 'grader-negative');
  }

  if (scenarioId === 'bypassed' && check.id === 'laravel.analysis.phpstan') {
    return withResult(check, 'failed', 'PHPStan found two errors.', 'grader-negative');
  }

  if (scenarioId === 'conflicting' && check.id === 'laravel.analysis.phpstan') {
    return withConflictingAttempts(check);
  }

  return withResult(check, 'passed', check.summary, 'grader-positive');
}).sort((left, right) => stageOrder.get(left.stage) - stageOrder.get(right.stage));

const outcomeFor = (checks) => {
  const requiredChecks = checks.filter((check) => check.policy === 'required');

  if (requiredChecks.some((check) => check.outcome === 'unverified')) {
    return 'unverified';
  }

  if (requiredChecks.some((check) => check.outcome === 'failed')) {
    return 'failed';
  }

  return 'passed';
};

const authorizationFor = (role, outcome) => {
  if (role === 'preflight') {
    return 'not-authoritative';
  }

  return ['passed', 'bypassed'].includes(outcome) ? 'allow' : 'deny';
};

const adapterResponseFor = (adapter, decision) => {
  const summary = `${decision.outcome}: ${decision.checks.length} checks evaluated`;

  if (adapter.role === 'authoritative') {
    return {
      exitCode: decision.authorization === 'allow' ? 0 : 1,
      visibleFeedback: summary,
    };
  }

  return {
    exitCode: 0,
    nativeBlocking: false,
    visibleFeedback: {
      level: decision.outcome === 'passed' ? 'info' : 'warning',
      message: summary,
      evidenceId: decision.evidence.id,
    },
  };
};

export const buildPrototypeState = ({ adapterId, scenarioId }) => {
  const adapter = adapters.find(({ id }) => id === adapterId);
  const scenario = scenarios.find(({ id }) => id === scenarioId);
  const checks = checksForScenario(scenario.id);
  const evaluatedOutcome = outcomeFor(checks);
  const bypassApplies = scenario.id === 'bypassed' && adapter.role === 'authoritative';
  const outcome = bypassApplies ? 'bypassed' : evaluatedOutcome;
  const snapshot = {
    kind: adapter.targetKind,
    id: adapter.targetKind === 'git-index'
      ? 'git-tree:4d3c2b1'
      : 'worktree-snapshot:9a8b7c6',
  };
  const regressionOnly = scenario.id === 'regression-only';
  const requiredClaims = regressionOnly ? [] : ['AC-AUTH-001'];
  const provedClaims = checks.flatMap((check) => check.assertions)
    .filter((assertion) => (
      requiredClaims.includes(assertion.id) && assertion.outcome === 'passed'
    ))
    .map((assertion) => assertion.id);
  const request = {
    protocolVersion: '1.0',
    operation: 'evaluate',
    repository: {
      root: '/workspace/example-project',
    },
    change: {
      kind: adapter.targetKind,
      baseRevision: 'HEAD',
    },
    evaluation: {
      purpose: regressionOnly ? 'regression-only' : 'change-acceptance-and-regression',
      contractRef: regressionOnly ? null : '.agent-framework/delivery-contract.json',
    },
    invocation: {
      role: adapter.role,
      trigger: adapter.trigger,
      adapter: {
        id: adapter.id,
        surface: adapter.surface,
        version: 'prototype',
        capabilities: {
          nativeBlocking: adapter.nativeBlocking,
        },
      },
      sessionId: `${adapter.id}-session`,
    },
  };
  const decision = {
    protocolVersion: request.protocolVersion,
    evaluationId: `eval-${adapter.id}-${scenario.id}`,
    outcome,
    authorization: authorizationFor(adapter.role, outcome),
    task: {
      id: 'sha256:task-demo',
      purpose: request.evaluation.purpose,
      contractId: regressionOnly ? null : 'sha256:delivery-contract-demo',
    },
    snapshot,
    environment: {
      id: `environment-${adapter.id}-${scenario.id}`,
      isolation: 'materialized-snapshot',
      snapshotId: snapshot.id,
      sourceMutable: false,
      historyVisibility: 'policy-defined',
      cachePolicy: 'declared-only',
    },
    configurationId: 'sha256:profile-demo',
    profile: 'laravel',
    checks,
    advisories: checks
      .filter((check) => check.policy === 'advisory' && check.outcome !== 'passed')
      .map((check) => check.id),
    bypass: bypassApplies
      ? { reason: 'Emergency release', reference: 'INC-123' }
      : null,
    coverage: {
      requiredClaims,
      provedClaims,
      gaps: requiredClaims.filter((claim) => !provedClaims.includes(claim)),
    },
    integrity: {
      configurationId: 'sha256:profile-demo',
      runnerVersion: 'prototype',
      providerVersions: { laravel: 'prototype' },
      environmentId: `environment-${adapter.id}-${scenario.id}`,
      changedGraderSurfaces: [],
    },
    evidence: {
      id: `evidence-${adapter.id}-${scenario.id}`,
      format: 'change-evaluation-gate/v1',
    },
  };

  return {
    selection: {
      adapter: `${adapter.surface} (${adapter.role})`,
      scenario: scenario.label,
    },
    processTransport: {
      exitCode: 0,
      meaning: 'A valid decision envelope was returned.',
    },
    request,
    decision,
    adapterResponse: adapterResponseFor(adapter, decision),
  };
};
