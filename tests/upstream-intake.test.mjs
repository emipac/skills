import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  analyzeChanges,
  mapUpstreamPath,
  mergeText,
  parseNameStatus,
  parseReviewCheckpoint,
} from '../skills/curate-upstream-skills/scripts/analyze-upstream.mjs';

const git = (root, args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8',
});

test('parses the recorded review checkpoint and upstream changes', () => {
  const checkpoint = 'a'.repeat(40);

  assert.equal(
    parseReviewCheckpoint(`- Last reviewed upstream SHA: \`${checkpoint}\`\n`),
    checkpoint,
  );
  assert.deepEqual(parseNameStatus([
    'M\tskills/engineering/tdd/SKILL.md',
    'R100\told.md\tnew.md',
  ].join('\n')), [
    {
      status: 'M',
      upstreamPath: 'skills/engineering/tdd/SKILL.md',
      previousPath: null,
    },
    {
      status: 'R100',
      upstreamPath: 'new.md',
      previousPath: 'old.md',
    },
  ]);
});

test('maps released upstream skills and protects intentional adaptations', () => {
  assert.deepEqual(
    mapUpstreamPath('skills/engineering/tdd/tests.md'),
    {
      category: 'engineering',
      upstreamSkill: 'tdd',
      localSkill: 'tdd',
      relativePath: 'tests.md',
      localPath: 'skills/tdd/tests.md',
      protected: false,
    },
  );
  assert.equal(
    mapUpstreamPath('skills/engineering/code-review/SKILL.md').protected,
    true,
  );
  assert.equal(mapUpstreamPath('README.md'), null);
});

test('three-way merge preserves compatible local and upstream changes', () => {
  const result = mergeText(
    'alpha\nshared\nlocal addition\n',
    'alpha\nshared\n',
    'alpha updated\nshared\n',
  );

  assert.equal(result.clean, true);
  assert.equal(result.contents, 'alpha updated\nshared\nlocal addition\n');
});

test('analyzer admits only a clean Markdown port', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'upstream-intake-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));

  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);

  const upstreamSkillPath = path.join(root, 'skills/engineering/tdd');
  await mkdir(upstreamSkillPath, { recursive: true });
  await writeFile(
    path.join(upstreamSkillPath, 'SKILL.md'),
    '---\nname: tdd\ndescription: Test first.\n---\n\nBase guidance.\n\nStable section.\n',
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'baseline']);
  const checkpoint = git(root, ['rev-parse', 'HEAD']).trim();

  await writeFile(
    path.join(upstreamSkillPath, 'SKILL.md'),
    '---\nname: tdd\ndescription: Test first.\n---\n\nImproved guidance.\n\nStable section.\n',
  );
  git(root, ['commit', '-am', 'upstream improvement']);
  const head = git(root, ['rev-parse', 'HEAD']).trim();

  const localSkillPath = path.join(root, 'skills/tdd');
  await mkdir(localSkillPath, { recursive: true });
  await writeFile(
    path.join(localSkillPath, 'SKILL.md'),
    '---\nname: tdd\ndescription: Test first.\n---\n\nBase guidance.\n\nStable section.\n\nLocal appendix.\n',
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'local adaptation']);

  const [candidate] = analyzeChanges({
    root,
    checkpoint,
    head,
    changes: [{
      status: 'M',
      upstreamPath: 'skills/engineering/tdd/SKILL.md',
      previousPath: null,
    }],
  });

  assert.equal(candidate.disposition, 'auto-port');
  assert.match(candidate.mergedContents, /Improved guidance\./);
  assert.match(candidate.mergedContents, /Local appendix\./);
});
