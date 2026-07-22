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

const changedScopes = (changedFiles) => {
  if (changedFiles.length === 0) {
    return { backend: true, frontend: true };
  }

  return {
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
  };
};

const appliesToScope = (command, scopes) => {
  const scope = commandScope(command);

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
  const verification = { profile: null, capabilities: [], commands: {} };
  let section = null;
  let commandCategory = null;
  let inVerification = false;

  for (const line of contents.split(/\r?\n/)) {
    if (line === 'verification:') {
      inVerification = true;
      continue;
    }

    if (inVerification && line && !line.startsWith(' ')) {
      break;
    }

    if (!inVerification) {
      continue;
    }

    const profile = line.match(/^  profile:\s*(.+)$/);

    if (profile) {
      verification.profile = normalizeScalar(profile[1]);
      continue;
    }

    if (line === '  capabilities:') {
      section = 'capabilities';
      commandCategory = null;
      continue;
    }

    if (line === '  commands:') {
      section = 'commands';
      commandCategory = null;
      continue;
    }

    if (section === 'capabilities') {
      const capability = line.match(/^    -\s+(.+)$/);

      if (capability) {
        verification.capabilities.push(normalizeScalar(capability[1]));
      }
    }

    if (section === 'commands') {
      const category = line.match(/^    ([a-z_]+):(?:\s*\[\])?$/);

      if (category) {
        commandCategory = category[1];
        verification.commands[commandCategory] = [];
        continue;
      }

      const command = line.match(/^      -\s+(.+)$/);

      if (command && commandCategory) {
        verification.commands[commandCategory].push(normalizeScalar(command[1]));
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
  const scopes = changedScopes(changedFiles);

  if (!verification.profile) {
    errors.push({
      code: 'missing-verification-profile',
      message: 'Run framework-setup to generate a schema version 2 verification profile',
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

    steps.push({
      stage,
      command: row.command.trim(),
      required: !/^(?:no|false)(?:\b|\s)/i.test(String(row.required ?? 'yes')),
      source: 'delivery-contract',
      evidence: row.evidence,
      acceptanceIds: unique(acceptanceIds(row.evidence)),
    });
  }

  for (const [category, stage] of Object.entries(configuredStages)) {
    const commands = verification.commands[category] ?? [];
    const stageRelevant = !(
      stage === 'build' && !scopes.frontend
      || stage === 'browser' && !userFacing
      || stage === 'smoke' && !userFacing
    );

    if (!stageRelevant) {
      skipped.push({
        stage,
        reason: stage === 'build'
          ? 'No frontend files changed.'
          : 'The change has no user-facing behavior requiring this layer.',
      });
      continue;
    }

    for (const command of commands) {
      if (
        !appliesToScope(command, scopes)
        && !['smoke', 'browser'].includes(stage)
      ) {
        continue;
      }

      steps.push({
        stage,
        command,
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
    && !deduplicatedSteps.some((step) => step.stage === 'build')
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
