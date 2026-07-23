import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

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

const configuredStages = {
  format: 'format',
  static_analysis: 'static-analysis',
  smoke: 'smoke',
  build: 'build',
  e2e: 'browser',
  test: 'broad-tests',
};

const ticketStages = new Map([
  ['targeted', 'focused'],
  ['focused', 'focused'],
  ['static', 'static-analysis'],
  ['static-analysis', 'static-analysis'],
  ['affected', 'affected-tests'],
  ['affected-tests', 'affected-tests'],
  ['smoke', 'smoke'],
  ['build', 'build'],
  ['browser', 'browser'],
  ['e2e', 'browser'],
  ['broad', 'broad-tests'],
  ['full', 'broad-tests'],
  ['broad-tests', 'broad-tests'],
]);

const acceptanceIds = (value) => [...value.matchAll(/\bAC-[A-Z0-9]+-\d{3}\b/g)]
  .map((match) => match[0]);

const unique = (values) => [...new Set(values)];

const commandScope = (command) => {
  if (/^(?:php\s|vendor\/bin\/|\.\/vendor\/bin\/)/.test(command)) {
    return 'backend';
  }

  if (/^(?:npm|pnpm|yarn|bun)\s/.test(command)) {
    return 'frontend';
  }

  return 'both';
};

const normalizedRoot = (root) => root.replaceAll('\\', '/').replace(/^\.\/|\/$/g, '');

const configuredFileScope = (file, sourceScopes) => {
  const normalizedFile = file.replaceAll('\\', '/').replace(/^\.\//, '');
  const matches = [];

  for (const [scope, roots] of Object.entries(sourceScopes)) {
    for (const root of roots) {
      const normalized = normalizedRoot(root);

      if (
        normalized
        && (normalizedFile === normalized || normalizedFile.startsWith(`${normalized}/`))
      ) {
        matches.push({ scope, length: normalized.length });
      }
    }
  }

  if (matches.length === 0) {
    return { scope: 'both', reason: 'unmatched' };
  }

  const longest = Math.max(...matches.map((match) => match.length));
  const scopes = new Set(
    matches.filter((match) => match.length === longest).map((match) => match.scope),
  );

  if (scopes.has('shared') || scopes.size > 1) {
    return {
      scope: 'both',
      reason: scopes.has('shared') ? 'shared' : 'ambiguous',
    };
  }

  return {
    scope: scopes.has('backend') ? 'backend' : 'frontend',
    reason: null,
  };
};

const changedScopes = (changedFiles, sourceScopes) => {
  if (changedFiles.length === 0) {
    return {
      scopes: { backend: true, frontend: true },
      notes: [],
    };
  }

  if (sourceScopes) {
    const classifiedFiles = changedFiles.map((file) => ({
      file,
      ...configuredFileScope(file, sourceScopes),
    }));

    return {
      scopes: {
        backend: classifiedFiles.some(
          ({ scope }) => scope === 'backend' || scope === 'both',
        ),
        frontend: classifiedFiles.some(
          ({ scope }) => scope === 'frontend' || scope === 'both',
        ),
      },
      notes: classifiedFiles
        .filter(({ reason }) => reason)
        .map(({ file, reason }) => ({ file, reason })),
    };
  }

  return {
    scopes: {
      backend: changedFiles.some((file) => (
        /\.php$/i.test(file)
        || /^(?:app|bootstrap|config|database|routes|tests)\//.test(file)
        || /^(?:artisan|composer\.(?:json|lock))$/.test(file)
      )),
      frontend: changedFiles.some((file) => (
        /\.(?:js|jsx|ts|tsx|svelte|vue|css|scss)$/i.test(file)
        || /^(?:resources|src|frontend)\//.test(file)
        || /^(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(file)
      )),
    },
    notes: [],
  };
};

const appliesToScope = (command, scopes) => {
  const scope = typeof command === 'string' ? commandScope(command) : command.scope;

  return scope === 'both' || scopes[scope];
};

const normalizeScalar = (value) => {
  const trimmed = value.trim();

  if (trimmed.startsWith('"')) {
    return JSON.parse(trimmed);
  }

  return trimmed;
};

export const parseVerificationConfiguration = (contents) => {
  const verification = {
    profile: null,
    capabilities: [],
    commands: {},
  };
  let topLevel = null;
  let verificationSection = null;
  let commandCategory = null;
  let commandScopeName = null;
  let sourceScopeName = null;

  for (const line of contents.split(/\r?\n/)) {
    if (line === 'source_scopes:') {
      topLevel = 'source_scopes';
      verification.sourceScopes = { backend: [], frontend: [], shared: [] };
      continue;
    }

    if (line === 'verification:') {
      topLevel = 'verification';
      continue;
    }

    if (line && !line.startsWith(' ')) {
      topLevel = null;
      continue;
    }

    if (topLevel === 'source_scopes') {
      const scope = line.match(/^  (backend|frontend|shared):(?:\s*\[\])?$/);

      if (scope) {
        sourceScopeName = scope[1];
        continue;
      }

      const root = line.match(/^    -\s+(.+)$/);

      if (root && sourceScopeName) {
        verification.sourceScopes[sourceScopeName].push(normalizeScalar(root[1]));
      }

      continue;
    }

    if (topLevel !== 'verification') {
      continue;
    }

    const profile = line.match(/^  profile:\s*(.+)$/);

    if (profile) {
      verification.profile = normalizeScalar(profile[1]);
      continue;
    }

    if (line === '  capabilities:') {
      verificationSection = 'capabilities';
      commandCategory = null;
      commandScopeName = null;
      continue;
    }

    if (line === '  commands:') {
      verificationSection = 'commands';
      commandCategory = null;
      commandScopeName = null;
      continue;
    }

    if (verificationSection === 'capabilities') {
      const capability = line.match(/^    -\s+(.+)$/);

      if (capability) {
        verification.capabilities.push(normalizeScalar(capability[1]));
      }
    }

    if (verificationSection === 'commands') {
      const category = line.match(/^    ([a-z_]+):(?:\s*\[\])?$/);

      if (category) {
        commandCategory = category[1];
        verification.commands[commandCategory] = line.trimEnd().endsWith('[]')
          ? []
          : null;
        commandScopeName = null;
        continue;
      }

      const commandScope = line.match(/^      (backend|frontend|both):(?:\s*\[\])?$/);

      if (
        commandScope
        && commandCategory
      ) {
        verification.commands[commandCategory] ??= {
          backend: [],
          frontend: [],
          both: [],
        };
        commandScopeName = commandScope[1];
        continue;
      }

      const legacyCommand = line.match(/^      -\s+(.+)$/);

      if (
        legacyCommand
        && commandCategory
      ) {
        verification.commands[commandCategory] ??= [];
        verification.commands[commandCategory].push(normalizeScalar(legacyCommand[1]));
        continue;
      }

      const scopedCommand = line.match(/^        -\s+(.+)$/);

      if (scopedCommand && commandCategory && commandScopeName) {
        verification.commands[commandCategory][commandScopeName]
          .push(normalizeScalar(scopedCommand[1]));
      }
    }
  }

  return verification;
};

export const planVerification = ({
  verification,
  ticketRows = [],
  changedFiles = [],
  userFacing = false,
}) => {
  const errors = [];
  const skipped = [];
  const steps = [];
  const scopeClassification = changedScopes(
    changedFiles,
    verification.sourceScopes,
  );
  const scopes = scopeClassification.scopes;

  if (!verification.profile) {
    errors.push({
      code: 'missing-verification-profile',
      message: 'Run framework-setup to generate a schema version 3 verification profile',
    });
  }

  if (
    verification.profile?.startsWith('express-typescript')
    && !verification.capabilities?.includes('typescript')
  ) {
    errors.push({
      code: 'missing-typescript-check',
      message: 'Express/TypeScript verification requires a configured TypeScript check',
    });
  }

  for (const row of ticketRows) {
    const stage = ticketStages.get(row.layer.toLowerCase());

    if (!stage) {
      errors.push({
        code: 'unknown-ticket-layer',
        message: `Unknown verification layer: ${row.layer}`,
      });
      continue;
    }

    if (!row.command?.trim()) {
      errors.push({
        code: 'missing-ticket-command',
        message: `${row.evidence} has no exact command`,
      });
      continue;
    }

    const ticketScope = String(row.scope ?? 'both').toLowerCase();

    if (!['backend', 'frontend', 'both'].includes(ticketScope)) {
      errors.push({
        code: 'invalid-ticket-scope',
        message: `${row.evidence} has invalid verification scope: ${row.scope}`,
      });
      continue;
    }

    steps.push({
      stage,
      command: row.command.trim(),
      required: !/^(?:no|false)(?:\b|\s)/i.test(String(row.required ?? 'yes')),
      source: 'delivery-contract',
      scope: ticketScope,
      evidence: row.evidence,
      acceptanceIds: unique(acceptanceIds(row.evidence)),
    });
  }

  for (const [category, stage] of Object.entries(configuredStages)) {
    const configured = verification.commands[category] ?? [];
    const commands = Array.isArray(configured)
      ? configured.map((command) => ({ command, scope: commandScope(command) }))
      : Object.entries(configured ?? {}).flatMap(([scope, scopedCommands]) => (
          scopedCommands.map((command) => ({ command, scope }))
        ));
    const applicableCommands = commands.filter((entry) => (
      appliesToScope(entry, scopes)
      && !(['browser', 'smoke'].includes(stage) && !userFacing)
    ));

    if (commands.length > 0 && applicableCommands.length === 0) {
      skipped.push({
        stage,
        reason: ['browser', 'smoke'].includes(stage) && !userFacing
          ? 'The change has no user-facing behavior requiring this layer.'
          : stage === 'build' && commands.every((entry) => entry.scope === 'frontend')
            ? 'No frontend files changed.'
          : 'No changed files match the configured command scope.',
      });
      continue;
    }

    for (const { command, scope } of applicableCommands) {
      steps.push({
        stage,
        command,
        scope,
        required: true,
        source: 'framework-configuration',
        evidence: `Configured ${category.replace('_', ' ')} check`,
        acceptanceIds: [],
      });
    }
  }

  const deduplicatedSteps = [...new Map(
    steps.map((step) => [`${step.stage}\u0000${step.command}`, step]),
  ).values()].sort((left, right) => (
    stageOrder.get(left.stage) - stageOrder.get(right.stage)
  ));

  if (
    verification.profile?.startsWith('express-typescript')
    && !deduplicatedSteps.some((step) => (
      ['focused', 'affected-tests', 'broad-tests'].includes(step.stage)
    ))
  ) {
    errors.push({
      code: 'missing-express-tests',
      message: 'Express/TypeScript verification requires configured test evidence',
    });
  }

  if (
    userFacing
    && !deduplicatedSteps.some((step) => ['smoke', 'browser'].includes(step.stage))
  ) {
    errors.push({
      code: 'missing-user-facing-evidence',
      message: 'User-facing changes require a configured smoke or browser command',
    });
  }

  if (
    scopes.frontend
    && !deduplicatedSteps.some((step) => (
      step.stage === 'build'
      && ['frontend', 'both'].includes(step.scope)
    ))
  ) {
    errors.push({
      code: 'missing-frontend-build',
      message: 'Frontend changes require a configured production build command',
    });
  }

  return {
    valid: errors.length === 0,
    profile: verification.profile,
    scopes,
    scopeNotes: scopeClassification.notes,
    steps: deduplicatedSteps,
    skipped,
    errors,
  };
};

export const auditVerificationEvidence = (plan, evidenceRows) => {
  const errors = plan.errors.map((error) => ({
    code: 'invalid-plan',
    message: `${error.code}: ${error.message}`,
  }));
  const evidenceByKey = new Map(evidenceRows.map((row) => [
    `${row.stage}\u0000${row.command}`,
    row,
  ]));

  for (const step of plan.steps) {
    const evidence = evidenceByKey.get(`${step.stage}\u0000${step.command}`);

    if (!evidence) {
      errors.push({
        code: 'missing-evidence',
        message: `${step.stage}: ${step.command}`,
      });
      continue;
    }

    if (evidence.outcome === 'skipped' && step.required) {
      errors.push({
        code: 'required-check-skipped',
        message: `${step.stage}: ${step.command}`,
      });
    } else if (evidence.outcome === 'skipped' && !evidence.summary?.trim()) {
      errors.push({
        code: 'unjustified-skip',
        message: `${step.stage}: ${step.command}`,
      });
    } else if (evidence.outcome !== 'passed' && evidence.outcome !== 'skipped') {
      errors.push({
        code: 'check-not-passing',
        message: `${step.stage}: ${step.command}`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
};

const parseArguments = (argumentsList) => {
  const options = { changedFiles: [] };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument === '--user-facing') {
      options.userFacing = true;
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--changed-file') {
      options.changedFiles.push(argumentsList[index + 1]);
      index += 1;
    } else if (argument.startsWith('--')) {
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]
        = argumentsList[index + 1];
      index += 1;
    }
  }

  return options;
};

const runCli = async () => {
  const options = parseArguments(process.argv.slice(2));

  if (!options.config) {
    console.error('Usage: node verification-plan.mjs --config <path> [options]');
    process.exitCode = 2;
    return;
  }

  const verification = parseVerificationConfiguration(
    await readFile(path.resolve(options.config), 'utf8'),
  );
  const ticketRows = options.ticketMatrix
    ? JSON.parse(await readFile(path.resolve(options.ticketMatrix), 'utf8'))
    : [];
  const plan = planVerification({
    verification,
    ticketRows,
    changedFiles: options.changedFiles,
    userFacing: options.userFacing,
  });
  const result = options.evidence
    ? {
        plan,
        audit: auditVerificationEvidence(
          plan,
          JSON.parse(await readFile(path.resolve(options.evidence), 'utf8')),
        ),
      }
    : plan;

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (!plan.valid || ('audit' in result && !result.audit.valid)) {
    process.exitCode = 1;
  }
};

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await runCli();
}
