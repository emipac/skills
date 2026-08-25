import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_ROOT = path.join(FRAMEWORK_ROOT, 'skills');

// Every released script that decides whether it was run as a command, with an
// invocation whose output is deterministic and free of side effects. A script
// that grows an entry guard must be registered here: `every entry-guarded
// script is covered` fails until it is, so this table cannot silently shrink.
const commandScripts = [
  { skill: 'curate-upstream-skills', script: 'analyze-upstream.mjs', argv: [] },
  { skill: 'framework-setup', script: 'configure.mjs', argv: ['--discover'] },
  { skill: 'srs-modeling', script: 'audit-srs.mjs', argv: [] },
  { skill: 'to-spec', script: 'audit-feature-spec.mjs', argv: [] },
  { skill: 'to-tickets', script: 'audit-ticket-contracts.mjs', argv: [] },
  { skill: 'verify-change', script: 'verification-plan.mjs', argv: [] },
];

const scriptPath = ({ skill, script }) => path.join(SKILLS_ROOT, skill, 'scripts', script);

const runNode = (nodeArguments) => {
  try {
    const stdout = execFileSync(process.execPath, nodeArguments, {
      cwd: FRAMEWORK_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return { status: 0, stdout, stderr: '' };
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

const entryGuardedScripts = () => {
  const found = [];

  for (const skill of readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
    if (!skill.isDirectory()) {
      continue;
    }

    const scriptsDirectory = path.join(SKILLS_ROOT, skill.name, 'scripts');
    let entries = [];

    try {
      entries = readdirSync(scriptsDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.mjs')) {
        continue;
      }

      const source = readFileSync(path.join(scriptsDirectory, entry.name), 'utf8');

      // Both spellings of the rule count: the one this repository ships and
      // the raw `process.argv[1]` comparison it replaced. A script reverted to
      // the old comparison therefore stays in this set and keeps its coverage,
      // which is what makes fixing five of six impossible to pass.
      if (source.includes('isCliEntryPoint') || source.includes('process.argv[1]')) {
        found.push(`${skill.name}/${entry.name}`);
      }
    }
  }

  return found.sort();
};

test('every entry-guarded released script is covered by this fixture', () => {
  assert.deepEqual(
    entryGuardedScripts(),
    commandScripts.map(({ skill, script }) => `${skill}/${script}`).sort(),
  );
});

for (const command of commandScripts) {
  const label = `${command.skill}/${command.script}`;

  test(`${label} run through a symbolic link does what it does through its real path`, () => {
    const real = scriptPath(command);
    const linkRoot = mkdtempSync(path.join(tmpdir(), 'entry-point-link-'));
    const link = path.join(linkRoot, command.script);

    try {
      symlinkSync(real, link);

      const throughRealPath = runNode([real, ...command.argv]);
      const throughLink = runNode([link, ...command.argv]);

      // A guard that never fires makes both invocations silent, so identity
      // alone would pass on the defect. The real path must produce output.
      assert.ok(
        `${throughRealPath.stdout}${throughRealPath.stderr}`.trim().length > 0,
        `${label}: produced no output through its real path`,
      );

      assert.equal(throughLink.stdout, throughRealPath.stdout, `${label}: stdout differs`);
      assert.equal(throughLink.stderr, throughRealPath.stderr, `${label}: stderr differs`);
      assert.equal(throughLink.status, throughRealPath.status, `${label}: exit status differs`);
    } finally {
      rmSync(linkRoot, { recursive: true, force: true });
    }
  });

  test(`${label} imported as a module runs no CLI`, () => {
    const moduleUrl = pathToFileURL(scriptPath(command)).href;
    const result = runNode([
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(moduleUrl)});`,
      path.join(FRAMEWORK_ROOT, 'package.json'),
      ...command.argv,
    ]);

    assert.equal(result.status, 0, `${label}: importing exited ${result.status}: ${result.stderr}`);
    assert.equal(result.stdout, '', `${label}: importing wrote to stdout`);
    assert.equal(result.stderr, '', `${label}: importing wrote to stderr`);
  });

  test(`${label} tolerates a process.argv[1] that names a path that does not exist`, () => {
    const moduleUrl = pathToFileURL(scriptPath(command)).href;
    const result = runNode([
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(moduleUrl)});`,
      path.join(FRAMEWORK_ROOT, 'no', 'such', 'entry-point.mjs'),
      ...command.argv,
    ]);

    assert.equal(result.status, 0, `${label}: importing exited ${result.status}: ${result.stderr}`);
    assert.equal(result.stdout, '', `${label}: importing wrote to stdout`);
    assert.equal(result.stderr, '', `${label}: importing wrote to stderr`);
  });
}

test('the entry-point rule is one definition, vendored identically into each skill', () => {
  const copies = commandScripts.map(({ skill }) => ({
    skill,
    source: readFileSync(
      path.join(SKILLS_ROOT, skill, 'scripts', 'lib', 'cli-entry-point.mjs'),
      'utf8',
    ),
  }));

  const [canonical] = copies;

  for (const copy of copies) {
    assert.equal(
      copy.source,
      canonical.source,
      `${copy.skill}: cli-entry-point.mjs diverged from the canonical rule`,
    );
  }
});
