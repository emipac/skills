import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const sourceRoot = process.cwd();
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'ai-skills-framework-install-'));
const agents = [
  'codex',
  'claude-code',
  'cursor',
  'github-copilot',
  'opencode',
];
const smokeSkills = [
  'framework-router',
  'framework-setup',
  'srs-modeling',
  'to-spec',
  'to-tickets',
  'implement',
  'verify-change',
  'code-review',
];

try {
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

  const installedRootsByAgent = new Map([
    ['codex', '.agents/skills'],
    ['claude-code', '.claude/skills'],
    ['cursor', '.agents/skills'],
    ['github-copilot', '.agents/skills'],
    ['opencode', '.agents/skills'],
  ]);

  for (const [agent, installedRoot] of installedRootsByAgent) {
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

    if (!(await readFile(routerDocument, 'utf8')).includes('name: framework-router')) {
      throw new Error(`${agent}: framework-router was not installed correctly`);
    }

    if (!(await readFile(setupDocument, 'utf8')).includes('name: framework-setup')) {
      throw new Error(`${agent}: framework-setup was not installed correctly`);
    }

    if (!(await readFile(setupScript, 'utf8')).includes('configureProject')) {
      throw new Error(`${agent}: framework-setup script was not installed`);
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
      throw new Error(`${agent}: three-axis review reference was not installed`);
    }

    if (!(await readFile(expressReviewProfile, 'utf8')).includes('Middleware ordering')) {
      throw new Error(`${agent}: Express review profile was not installed`);
    }
  }

  console.log(`Smoke-installed ${smokeSkills.join(', ')} for ${agents.join(', ')}.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
