import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

// Clients install a skill wherever they like, and some of them link: a project
// that installs for both Claude and the shared agent layout ends up with
// `.claude/skills/<skill>` pointing at `.agents/skills/<skill>`. An installed
// command has to do its work through whichever path the caller used, so this
// smoke installation runs one through a link and compares it against the same
// command run through the path it was installed at.
const installedCommands = [
  { skill: 'framework-setup', script: 'configure.mjs', argv: ['--discover'] },
  // The Framework command (TB-067) lives in framework-setup and finds the Gate
  // beside it, so it is compared through the link like every other command.
  { skill: 'framework-setup', script: 'agent-framework.mjs', argv: ['setup', '--json'] },
  { skill: 'srs-modeling', script: 'audit-srs.mjs', argv: [] },
  { skill: 'to-spec', script: 'audit-feature-spec.mjs', argv: [] },
  { skill: 'to-tickets', script: 'audit-ticket-contracts.mjs', argv: [] },
  { skill: 'verify-change', script: 'verification-plan.mjs', argv: [] },
];

// A `change-evaluation-gate` a developer linked globally would be found on the
// path before the installed skill, so the installed commands run without one.
const pathWithoutGlobalGate = (process.env.PATH ?? '').split(path.delimiter)
  .filter((directory) => {
    try {
      accessSync(path.join(directory, 'change-evaluation-gate'), constants.X_OK);

      return false;
    } catch {
      return true;
    }
  })
  .join(path.delimiter);

const runInstalledCommand = (scriptPath, argv, cwd) => {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [scriptPath, ...argv], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, PATH: pathWithoutGlobalGate },
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      stderr: '',
    };
  } catch (error) {
    if (typeof error.status !== 'number') {
      throw error;
    }

    return {
      status: error.status,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
};

const sourceRoot = process.cwd();

/** Run an installed script with `input` on standard input, as a client hook runs it. */
const runWithInput = (program, argv, input) => {
  try {
    return { status: 0, stdout: execFileSync(program, argv, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }), stderr: '' };
  } catch (error) {
    if (typeof error.status !== 'number') {
      throw error;
    }

    return { status: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
};

const bashPayload = (command) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

/**
 * The installed guardrail blocks a destructive payload and allows an ordinary
 * one through the installed and the linked path, and registers with Claude
 * Code through both: previewed, confirmed with the preview's own token, run as
 * Claude Code's exec form runs it, then removed again (FS-006).
 */
const assertInstalledGuardrail = async (agent, installedRoot, linkedClientRoot) => {
  const installedScripts = path.join(temporaryRoot, installedRoot, 'framework-setup', 'scripts');
  const linkedScripts = path.join(linkedClientRoot, 'framework-setup', 'scripts');
  const blockedLine = "BLOCKED: 'git push -f origin main' matches dangerous pattern 'git push --force'. The user has prevented you from doing this.\n";

  for (const scripts of [installedScripts, linkedScripts]) {
    const blocked = runWithInput(process.execPath, [path.join(scripts, 'guardrail.mjs')], bashPayload('git push -f origin main'));
    const allowed = runWithInput(process.execPath, [path.join(scripts, 'guardrail.mjs')], bashPayload('git checkout .env.example'));

    if (blocked.status !== 2 || blocked.stderr !== blockedLine || allowed.status !== 0 || `${allowed.stdout}${allowed.stderr}` !== '') {
      throw new Error(`${agent}: the installed guardrail at ${scripts} did not block a forced push and allow a checkout: exit ${blocked.status} ${blocked.stderr}`);
    }
  }

  const settingsFile = path.join(temporaryRoot, '.claude', 'settings.json');
  const guardrailCommand = (scripts, operation, ...argv) => {
    const result = runInstalledCommand(path.join(scripts, 'agent-framework.mjs'), ['guardrail', operation, 'claude-code', '--json', ...argv], temporaryRoot);

    return { ...result, document: JSON.parse(result.stdout) };
  };
  const throughInstalledPath = guardrailCommand(installedScripts, 'add');
  const throughLink = guardrailCommand(linkedScripts, 'add');
  const expectedArgs = [`\${CLAUDE_PROJECT_DIR}/${installedRoot}/framework-setup/scripts/guardrail.mjs`];

  if (
    throughInstalledPath.status !== 1
    || throughLink.stdout !== throughInstalledPath.stdout
    || JSON.stringify(throughInstalledPath.document.entry.hooks[0].args) !== JSON.stringify(expectedArgs)
    || (await access(settingsFile).then(() => true, () => false))
  ) {
    throw new Error(`${agent}: installed agent-framework guardrail add did not preview the installed script alike through both paths: ${throughInstalledPath.stdout}`);
  }

  const added = guardrailCommand(linkedScripts, 'add', '--confirm', throughInstalledPath.document.previewHash);
  const [registered] = JSON.parse(await readFile(settingsFile, 'utf8')).hooks.PreToolUse;
  const [hook] = registered.hooks;
  const hookRun = runWithInput(hook.command === 'node' ? process.execPath : hook.command, hook.args.map((argument) => argument.replaceAll('${CLAUDE_PROJECT_DIR}', temporaryRoot)), bashPayload('git push -f origin main'));

  if (added.status !== 0 || registered.matcher !== 'Bash' || hookRun.status !== 2 || hookRun.stderr !== blockedLine) {
    throw new Error(`${agent}: the guardrail registered through the linked path did not block a forced push: ${added.stdout} exit ${hookRun.status} ${hookRun.stderr}`);
  }

  const removal = guardrailCommand(installedScripts, 'remove');
  const removed = guardrailCommand(installedScripts, 'remove', '--confirm', removal.document.previewHash);

  if (removed.status !== 0 || (await readFile(settingsFile, 'utf8')) !== '{}\n') {
    throw new Error(`${agent}: installed agent-framework guardrail remove did not reverse the entry: ${removed.stdout}`);
  }

  // The file `add` created holds nothing now; the install root must hold no adoption state.
  await rm(settingsFile);
};

const assertNoAdoptionState = async (actor) => {
  for (const dormantPath of [
    '.agent-framework.yaml',
    '.git/hooks/pre-commit',
    '.git/ai-skills-framework/gate.json',
    // Adapters are self-tested and registered by the Activation transaction,
    // which pins this receipt. Installing the plugin must never create it:
    // an installed adapter is a dormant asset, not a registered integration
    // (SG-DIST-001, FR-ADAPT-002).
    '.git/change-evaluation-gate/evidence/activation/receipt.json',
    // The destructive-command guardrail is registered only by a confirmed
    // `agent-framework guardrail add` (FS-006); installing never does it.
    '.claude/settings.json',
  ]) {
    try {
      await access(path.join(temporaryRoot, dormantPath));
      throw new Error(`${actor} created Gate adoption state: ${dormantPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
};
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'ai-skills-framework-install-'));
// A clone configured for the Gate and not activated, kept apart from the
// install root, which must hold no adoption state. `gate status` names its
// remedies with the subcommands that perform them (TB-074), and the installed
// Framework command renders its steps from those alone.
const configuredRoot = await mkdtemp(path.join(tmpdir(), 'ai-skills-framework-configured-'));
const agents = [
  'codex',
  'claude-code',
  'cursor',
  'github-copilot',
  'opencode',
];
const smokeSkills = [
  'audit-security',
  'change-evaluation-gate',
  'curate-upstream-skills',
  'framework-router',
  'framework-setup',
  'setup-laravel-development',
  'srs-modeling',
  'to-spec',
  'to-tickets',
  'implement',
  'verify-change',
  'code-review',
];

try {
  execFileSync('git', ['init', '--quiet'], { cwd: configuredRoot });
  await mkdir(path.join(configuredRoot, 'tools'));
  await writeFile(path.join(configuredRoot, 'tools/check.mjs'), 'process.exitCode = 0;\n');
  await writeFile(path.join(configuredRoot, '.agent-framework.yaml'), [
    'schema_version: 4',
    'backend: laravel',
    'frontend: none',
    'verification:',
    '  commands:',
    '    test:',
    '      backend: []',
    '      frontend: []',
    '      both:',
    '        - runner: repository-script',
    '          args:',
    '            - tools/check.mjs',
    '          working_directory: .',
    '          timeout_seconds: 60',
    '          allowed_environment:',
    '            - PATH',
    '          evidence_category: test',
    '          source_scope: both',
    'evaluation_gate:',
    '  checks:',
    '    required:',
    '      - configuration.broad-tests.test',
    '    advisory: []',
    '  budget:',
    '    total_seconds: 600',
    '  bypass:',
    '    enabled: false',
    '    marker: null',
    '  execution:',
    '    budget_skippable: []',
    '  evidence: {}',
    '',
  ].join('\n'));

  await writeFile(
    path.join(temporaryRoot, 'package.json'),
    `${JSON.stringify({ name: 'ai-skills-framework-smoke', private: true }, null, 2)}\n`,
  );

  execFileSync(
    'npx',
    [
      '--yes',
      'skills@latest',
      'add',
      sourceRoot,
      '--skill',
      ...smokeSkills,
      '--agent',
      ...agents,
      '--copy',
      '--yes',
    ],
    {
      cwd: temporaryRoot,
      stdio: 'inherit',
    },
  );

  await assertNoAdoptionState('Skill installation');

  const installedRootsByAgent = new Map([
    ['codex', '.agents/skills'],
    ['claude-code', '.claude/skills'],
    ['cursor', '.agents/skills'],
    ['github-copilot', '.agents/skills'],
    ['opencode', '.agents/skills'],
  ]);

  for (const [agent, installedRoot] of installedRootsByAgent) {
    const gateDocument = path.join(
      temporaryRoot,
      installedRoot,
      'change-evaluation-gate',
      'SKILL.md',
    );
    const routerDocument = path.join(
      temporaryRoot,
      installedRoot,
      'framework-router',
      'SKILL.md',
    );
    const setupDocument = path.join(
      temporaryRoot,
      installedRoot,
      'framework-setup',
      'SKILL.md',
    );
    const setupScript = path.join(
      temporaryRoot,
      installedRoot,
      'framework-setup',
      'scripts',
      'configure.mjs',
    );
    const laravelSetupDocument = path.join(
      temporaryRoot,
      installedRoot,
      'setup-laravel-development',
      'SKILL.md',
    );
    const laravelSetupEvaluations = path.join(
      temporaryRoot,
      installedRoot,
      'setup-laravel-development',
      'evals',
      'cases.json',
    );
    const linearAdapter = path.join(
      temporaryRoot,
      installedRoot,
      'framework-setup',
      'references',
      'tracker-linear.md',
    );
    const srsDocument = path.join(
      temporaryRoot,
      installedRoot,
      'srs-modeling',
      'SKILL.md',
    );
    const srsAuditScript = path.join(
      temporaryRoot,
      installedRoot,
      'srs-modeling',
      'scripts',
      'audit-srs.mjs',
    );
    const srsTemplate = path.join(
      temporaryRoot,
      installedRoot,
      'srs-modeling',
      'references',
      'srs-template.md',
    );
    const srsEvaluations = path.join(
      temporaryRoot,
      installedRoot,
      'srs-modeling',
      'evals',
      'cases.json',
    );
    const featureAuditScript = path.join(
      temporaryRoot,
      installedRoot,
      'to-spec',
      'scripts',
      'audit-feature-spec.mjs',
    );
    const featureContract = path.join(
      temporaryRoot,
      installedRoot,
      'to-spec',
      'references',
      'feature-contract.md',
    );
    const ticketAuditScript = path.join(
      temporaryRoot,
      installedRoot,
      'to-tickets',
      'scripts',
      'audit-ticket-contracts.mjs',
    );
    const deliveryContract = path.join(
      temporaryRoot,
      installedRoot,
      'to-tickets',
      'references',
      'delivery-contract.md',
    );
    const implementationEvidence = path.join(
      temporaryRoot,
      installedRoot,
      'implement',
      'references',
      'evidence-log.md',
    );
    const implementationAmendment = path.join(
      temporaryRoot,
      installedRoot,
      'implement',
      'references',
      'contract-amendment.md',
    );
    const durableSynchronization = path.join(
      temporaryRoot,
      installedRoot,
      'implement',
      'references',
      'durable-synchronization.md',
    );
    const verificationPlanner = path.join(
      temporaryRoot,
      installedRoot,
      'verify-change',
      'scripts',
      'verification-plan.mjs',
    );
    const verificationProfile = path.join(
      temporaryRoot,
      installedRoot,
      'verify-change',
      'references',
      'typescript-frontends.md',
    );
    const expressVerificationProfile = path.join(
      temporaryRoot,
      installedRoot,
      'verify-change',
      'references',
      'express-typescript.md',
    );
    const reviewAxes = path.join(
      temporaryRoot,
      installedRoot,
      'code-review',
      'references',
      'review-report.md',
    );
    const expressReviewProfile = path.join(
      temporaryRoot,
      installedRoot,
      'code-review',
      'references',
      'express-typescript.md',
    );
    const securityAudit = path.join(
      temporaryRoot,
      installedRoot,
      'audit-security',
      'SKILL.md',
    );
    const securityOwaspBaseline = path.join(
      temporaryRoot,
      installedRoot,
      'audit-security',
      'references',
      'owasp-baseline.md',
    );
    const upstreamIntake = path.join(
      temporaryRoot,
      installedRoot,
      'curate-upstream-skills',
      'SKILL.md',
    );
    const upstreamAnalyzer = path.join(
      temporaryRoot,
      installedRoot,
      'curate-upstream-skills',
      'scripts',
      'analyze-upstream.mjs',
    );
    const upstreamPolicy = path.join(
      temporaryRoot,
      installedRoot,
      'curate-upstream-skills',
      'references',
      'compatibility-policy.md',
    );

    const installedGate = await readFile(gateDocument, 'utf8');
    // Prose in a Markdown document is wrapped, so a sentence a reader sees on
    // one line is not one line on disk. Collapsing runs of whitespace lets these
    // assertions test what the document says rather than where it happened to
    // break, which is what made an earlier reflow read as a failed install.
    const installedGateProse = installedGate.replace(/\s+/g, ' ');

    if (
      !installedGate.includes('name: change-evaluation-gate')
      || !installedGateProse.includes('configuring does not activate')
    ) {
      throw new Error(`${agent}: dormant Change Evaluation Gate was not installed correctly`);
    }

    // The three supported desktop preflight surfaces ship with the plugin and
    // are documented as dormant until an explicit Activation registers them.
    if (
      !installedGateProse.includes('Supported preflight adapters')
      || !installedGateProse.includes('Installing an adapter never registers it')
    ) {
      throw new Error(`${agent}: installed Gate does not document its dormant preflight adapters`);
    }

    const installedAdapters = await readFile(
      path.join(temporaryRoot, installedRoot, 'change-evaluation-gate', 'scripts', 'lib', 'adapters.mjs'),
      'utf8',
    );

    for (const surface of ['claude-code-desktop', 'codex-desktop', 'cursor']) {
      if (!installedAdapters.includes(surface)) {
        throw new Error(`${agent}: the installed adapter library is missing the ${surface} surface`);
      }
    }

    await readFile(
      path.join(
        temporaryRoot,
        installedRoot,
        'change-evaluation-gate',
        'references',
        'adapter-conformance-contract.md',
      ),
      'utf8',
    );

    if (!(await readFile(routerDocument, 'utf8')).includes('name: framework-router')) {
      throw new Error(`${agent}: framework-router was not installed correctly`);
    }

    if (!(await readFile(setupDocument, 'utf8')).includes('name: framework-setup')) {
      throw new Error(`${agent}: framework-setup was not installed correctly`);
    }

    const installedSetupScript = await readFile(setupScript, 'utf8');

    if (!installedSetupScript.includes('configureProject')) {
      throw new Error(`${agent}: framework-setup script was not installed`);
    }

    // The installed drafter carries the Laravel evidence default (TB-059):
    // tokens, not a sentence, so a reflow of the skill's prose cannot read as
    // a failed install. The generated section itself is proved by the unit
    // suite that owns `draftGatePolicy`.
    if (
      !installedSetupScript.includes('environment_files')
      || !(await readFile(setupDocument, 'utf8')).includes('environment_files')
    ) {
      throw new Error(`${agent}: installed framework-setup does not declare the Laravel evidence default`);
    }

    if (!(await readFile(laravelSetupDocument, 'utf8')).includes(
      'name: setup-laravel-development',
    )) {
      throw new Error(`${agent}: Laravel development setup was not installed correctly`);
    }

    const laravelSetupCases = JSON.parse(await readFile(laravelSetupEvaluations, 'utf8'));

    if (laravelSetupCases.cases.length !== 3) {
      throw new Error(`${agent}: Laravel development setup evaluations were not installed`);
    }

    if (!(await readFile(securityAudit, 'utf8')).includes('name: audit-security')) {
      throw new Error(`${agent}: audit-security was not installed correctly`);
    }

    if (!(await readFile(securityOwaspBaseline, 'utf8')).includes('OWASP Top 10:2025')) {
      throw new Error(`${agent}: audit-security OWASP baseline was not installed`);
    }

    if (!(await readFile(upstreamIntake, 'utf8')).includes('name: curate-upstream-skills')) {
      throw new Error(`${agent}: curate-upstream-skills was not installed correctly`);
    }

    if (!(await readFile(upstreamAnalyzer, 'utf8')).includes('analyzeChanges')) {
      throw new Error(`${agent}: curated upstream analyzer was not installed`);
    }

    if (!(await readFile(upstreamPolicy, 'utf8')).includes('Auto-port gate')) {
      throw new Error(`${agent}: curated upstream policy was not installed`);
    }

    if (!(await readFile(linearAdapter, 'utf8')).includes('adapter: linear')) {
      throw new Error(`${agent}: tracker adapter references were not installed`);
    }

    if (!(await readFile(srsDocument, 'utf8')).includes('name: srs-modeling')) {
      throw new Error(`${agent}: srs-modeling was not installed correctly`);
    }

    if (!(await readFile(srsAuditScript, 'utf8')).includes('auditSrs')) {
      throw new Error(`${agent}: SRS audit script was not installed`);
    }

    if (!(await readFile(srsTemplate, 'utf8')).includes('## 12. Acceptance Criteria')) {
      throw new Error(`${agent}: SRS template was not installed`);
    }

    if (!(await readFile(srsEvaluations, 'utf8')).includes('refine-existing-srs-surgically')) {
      throw new Error(`${agent}: SRS evaluations were not installed`);
    }

    if (!(await readFile(featureAuditScript, 'utf8')).includes('auditFeatureSpec')) {
      throw new Error(`${agent}: feature contract auditor was not installed`);
    }

    if (!(await readFile(featureContract, 'utf8')).includes('Analysis matrix')) {
      throw new Error(`${agent}: feature contract reference was not installed`);
    }

    if (!(await readFile(ticketAuditScript, 'utf8')).includes('auditTicketSet')) {
      throw new Error(`${agent}: delivery contract auditor was not installed`);
    }

    if (!(await readFile(deliveryContract, 'utf8')).includes('Readiness gate')) {
      throw new Error(`${agent}: delivery contract reference was not installed`);
    }

    if (!(await readFile(implementationEvidence, 'utf8')).includes('Red command')) {
      throw new Error(`${agent}: implementation evidence reference was not installed`);
    }

    if (!(await readFile(implementationAmendment, 'utf8')).includes('Proposed contract amendment')) {
      throw new Error(`${agent}: contract amendment reference was not installed`);
    }

    if (!(await readFile(durableSynchronization, 'utf8')).includes('Private implementation')) {
      throw new Error(`${agent}: durable synchronization reference was not installed`);
    }

    if (!(await readFile(verificationPlanner, 'utf8')).includes('planVerification')) {
      throw new Error(`${agent}: verification planner was not installed`);
    }

    if (!(await readFile(verificationProfile, 'utf8')).includes('React and Svelte')) {
      throw new Error(`${agent}: TypeScript verification profile was not installed`);
    }

    if (!(await readFile(expressVerificationProfile, 'utf8')).includes('public HTTP')) {
      throw new Error(`${agent}: Express verification profile was not installed`);
    }

    if (!(await readFile(reviewAxes, 'utf8')).includes('## Evidence')) {
      throw new Error(`${agent}: four-axis review reference was not installed`);
    }

    if (!(await readFile(expressReviewProfile, 'utf8')).includes('Middleware ordering')) {
      throw new Error(`${agent}: Express review profile was not installed`);
    }

    const linkedClientRoot = path.join(temporaryRoot, '.linked-clients', agent);

    await mkdir(path.dirname(linkedClientRoot), { recursive: true });
    await rm(linkedClientRoot, { recursive: true, force: true });
    await symlink(path.join(temporaryRoot, installedRoot), linkedClientRoot, 'dir');

    for (const { skill, script, argv } of installedCommands) {
      const installedScript = path.join(temporaryRoot, installedRoot, skill, 'scripts', script);
      const linkedScript = path.join(linkedClientRoot, skill, 'scripts', script);

      const throughInstalledPath = runInstalledCommand(installedScript, argv, temporaryRoot);
      const throughLink = runInstalledCommand(linkedScript, argv, temporaryRoot);

      // Both invocations being silent would satisfy an equality check while
      // proving nothing, which is exactly the defect this asserts against.
      if (`${throughInstalledPath.stdout}${throughInstalledPath.stderr}`.trim() === '') {
        throw new Error(`${agent}: installed ${skill}/${script} produced no output at all`);
      }

      if (
        throughLink.stdout !== throughInstalledPath.stdout
        || throughLink.stderr !== throughInstalledPath.stderr
        || throughLink.status !== throughInstalledPath.status
      ) {
        throw new Error(
          `${agent}: installed ${skill}/${script} run through a linked client path did not do `
          + `what it does through the path it was installed at`,
        );
      }

      // Base setup refuses a schema v4 file rather than rewriting it as v3
      // (FS-005): through either path it states the refusal, exits 2, and the
      // configured clone keeps every byte and gains no tracker document.
      if (script === 'configure.mjs') {
        const configuration = path.join(configuredRoot, '.agent-framework.yaml');
        const before = await readFile(configuration, 'utf8');
        const baseSetupArgv = ['--project', configuredRoot, '--tracker', 'local-markdown'];

        for (const scriptPath of [installedScript, linkedScript]) {
          const refused = runInstalledCommand(scriptPath, baseSetupArgv, configuredRoot);
          const refusal = refused.status === 2 ? JSON.parse(refused.stdout) : null;
          const trackerDocumentWritten = await access(path.join(configuredRoot, 'docs', 'agents'))
            .then(() => true, () => false);

          if (
            refusal?.status !== 'refused'
            || refusal.reasonCode !== 'schema-v4-configured'
            || (await readFile(configuration, 'utf8')) !== before
            || trackerDocumentWritten
          ) {
            throw new Error(
              `${agent}: installed ${skill}/${script} did not refuse base setup on a schema v4 file: `
              + `exit ${refused.status} ${refused.stdout}${refused.stderr}`,
            );
          }
        }
      }

      // The Framework command names base setup for this unconfigured project
      // and reaches the Gate installed beside it, never the source checkout.
      if (script === 'agent-framework.mjs') {
        const plan = JSON.parse(throughInstalledPath.stdout);
        // Node reports a module's resolved path, and the temporary directory
        // may itself sit behind a link (`/var` on macOS).
        const installedGate = await realpath(path.join(
          temporaryRoot,
          installedRoot,
          'change-evaluation-gate',
          'scripts',
          'gate.mjs',
        ));

        if (
          plan.state !== 'no-configuration'
          || plan.next?.step !== 'configure-project'
          || plan.gate?.located !== 'sibling'
          || !plan.gate.detail.includes(installedGate)
        ) {
          throw new Error(`${agent}: installed agent-framework setup did not plan from the installed skills`);
        }

        // On a configured clone the steps come from the remedies the installed
        // Gate names, with the subcommands it names for them (TB-074).
        const configuredThroughInstalledPath = runInstalledCommand(installedScript, argv, configuredRoot);
        const configuredThroughLink = runInstalledCommand(linkedScript, argv, configuredRoot);
        const configured = JSON.parse(configuredThroughInstalledPath.stdout);

        if (
          configuredThroughLink.stdout !== configuredThroughInstalledPath.stdout
          || configuredThroughLink.status !== configuredThroughInstalledPath.status
          || configured.failure !== null
          || configured.state !== 'configured'
          || !configured.gate.detail.includes(installedGate)
          || !configured.steps.some((step) => step.commands.some((entry) => entry.argv.at(-1) === 'activate'))
        ) {
          throw new Error(
            `${agent}: installed agent-framework setup did not plan a configured clone from the installed Gate's remedies: `
            + (configured.failure?.detail ?? configured.state),
          );
        }
      }
    }

    await assertInstalledGuardrail(agent, installedRoot, linkedClientRoot);
  }

  // Running the installed commands changed nothing either (SG-GUIDE-001).
  await assertNoAdoptionState('Running the installed commands');

  console.log(`Smoke-installed ${smokeSkills.join(', ')} for ${agents.join(', ')}.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
  await rm(configuredRoot, { recursive: true, force: true });
}
