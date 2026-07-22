import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const sourceRoot = process.cwd();
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'ai-skills-framework-install-'));
const agents = ['codex', 'claude-code', 'cursor'];
const smokeSkills = ['framework-router', 'framework-setup'];

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
  }

  console.log(`Smoke-installed ${smokeSkills.join(', ')} for ${agents.join(', ')}.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
