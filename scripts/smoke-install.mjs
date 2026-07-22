import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const sourceRoot = process.cwd();
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'ai-skills-framework-install-'));
const agents = ['codex', 'claude-code', 'cursor'];
const smokeSkill = 'ask-matt';

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
      smokeSkill,
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

  const installedDocumentsByAgent = new Map([
    ['codex', '.agents/skills/ask-matt/SKILL.md'],
    ['claude-code', '.claude/skills/ask-matt/SKILL.md'],
    ['cursor', '.agents/skills/ask-matt/SKILL.md'],
  ]);

  for (const [agent, installedDocument] of installedDocumentsByAgent) {
    const contents = await readFile(path.join(temporaryRoot, installedDocument), 'utf8');

    if (!contents.includes('name: ask-matt')) {
      throw new Error(`${agent}: ${installedDocument} does not contain the expected skill`);
    }
  }

  console.log(`Smoke-installed ${smokeSkill} for ${agents.join(', ')}.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
