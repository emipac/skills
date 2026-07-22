import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const sourceRoot = process.cwd();
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'ai-skills-framework-install-'));
const agents = ['codex', 'claude-code', 'cursor'];
const smokeSkills = ['framework-router', 'framework-setup', 'srs-modeling'];

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
  }

  console.log(`Smoke-installed ${smokeSkills.join(', ')} for ${agents.join(', ')}.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
