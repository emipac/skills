#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { isCliEntryPoint } from './lib/cli-entry-point.mjs';

const protectedMappings = new Map([
  ['ask-matt', 'framework-router'],
  ['setup-matt-pocock-skills', 'framework-setup'],
  ['code-review', 'code-review'],
  ['grill-with-docs', 'grill-with-docs'],
  ['implement', 'implement'],
  ['to-spec', 'to-spec'],
  ['to-tickets', 'to-tickets'],
  ['triage', 'triage'],
  ['wayfinder', 'wayfinder'],
  ['writing-great-skills', 'writing-great-skills'],
]);

const git = (root, args, options = {}) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  ...options,
});

export const parseReviewCheckpoint = (contents) => {
  const match = contents.match(/^- Last reviewed upstream SHA: `([0-9a-f]{40})`$/m);

  if (!match) {
    throw new Error('UPSTREAM.md must contain a full last-reviewed upstream SHA');
  }

  return match[1];
};

export const parseNameStatus = (contents) => contents
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [status, sourcePath, destinationPath] = line.split('\t');

    return {
      status,
      upstreamPath: destinationPath ?? sourcePath,
      previousPath: destinationPath ? sourcePath : null,
    };
  });

export const mapUpstreamPath = (upstreamPath) => {
  const match = upstreamPath.match(/^skills\/(engineering|productivity)\/([^/]+)\/(.+)$/);

  if (!match) {
    return null;
  }

  const [, category, upstreamSkill, relativePath] = match;
  const localSkill = protectedMappings.get(upstreamSkill) ?? upstreamSkill;

  return {
    category,
    upstreamSkill,
    localSkill,
    relativePath,
    localPath: path.posix.join('skills', localSkill, relativePath),
    protected: protectedMappings.has(upstreamSkill),
  };
};

const frontmatter = (contents) => contents.match(/^---\n[\s\S]*?\n---\n/)?.[0] ?? null;

export const mergeText = (localContents, baseContents, upstreamContents) => {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'curated-upstream-'));
  const localPath = path.join(temporaryDirectory, 'local');
  const basePath = path.join(temporaryDirectory, 'base');
  const upstreamPath = path.join(temporaryDirectory, 'upstream');

  try {
    writeFileSync(localPath, localContents);
    writeFileSync(basePath, baseContents);
    writeFileSync(upstreamPath, upstreamContents);

    const result = execFileSync(
      'git',
      ['merge-file', '-p', localPath, basePath, upstreamPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    return { clean: true, contents: result };
  } catch (error) {
    if (error.status === 1) {
      return { clean: false, contents: error.stdout };
    }

    throw error;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

const readRevisionFile = (root, revision, filePath) => git(root, [
  'show',
  `${revision}:${filePath}`,
]);

const hasLocalChange = (root, localPath) => git(root, [
  'status',
  '--short',
  '--',
  localPath,
]).trim() !== '';

const initialCandidate = (root, checkpoint, head, change) => {
  const mapping = mapUpstreamPath(change.upstreamPath);

  if (!mapping) {
    return {
      ...change,
      disposition: 'no-port',
      reason: 'outside released engineering and productivity skills',
    };
  }

  const candidate = { ...change, ...mapping };
  const localSkillPath = path.join(root, 'skills', mapping.localSkill, 'SKILL.md');

  if (!existsSync(localSkillPath)) {
    return {
      ...candidate,
      disposition: 'no-port',
      reason: 'local released skill does not exist',
    };
  }

  if (mapping.protected) {
    return {
      ...candidate,
      disposition: 'manual-review',
      reason: 'skill has an intentional local adaptation',
    };
  }

  if (!['A', 'M'].includes(change.status)) {
    return {
      ...candidate,
      disposition: 'manual-review',
      reason: 'deletion, rename, or unsupported Git status',
    };
  }

  if (path.extname(mapping.relativePath).toLowerCase() !== '.md') {
    return {
      ...candidate,
      disposition: 'manual-review',
      reason: 'automatic intake is limited to Markdown',
    };
  }

  const absoluteLocalPath = path.join(root, mapping.localPath);

  if (hasLocalChange(root, mapping.localPath)) {
    return {
      ...candidate,
      disposition: 'manual-review',
      reason: 'local target has an uncommitted change',
    };
  }

  const upstreamContents = readRevisionFile(root, head, change.upstreamPath);

  if (change.status === 'A') {
    if (existsSync(absoluteLocalPath)) {
      return {
        ...candidate,
        disposition: 'manual-review',
        reason: 'added upstream file collides with a local path',
      };
    }

    return {
      ...candidate,
      disposition: 'auto-port',
      reason: 'new Markdown file in an existing compatible skill',
      mergedContents: upstreamContents,
    };
  }

  if (!existsSync(absoluteLocalPath)) {
    return {
      ...candidate,
      disposition: 'manual-review',
      reason: 'mapped local file is missing',
    };
  }

  const baseContents = readRevisionFile(root, checkpoint, change.upstreamPath);
  const localContents = readFileSync(absoluteLocalPath, 'utf8');

  if (
    mapping.relativePath === 'SKILL.md'
    && frontmatter(baseContents) !== frontmatter(upstreamContents)
  ) {
    return {
      ...candidate,
      disposition: 'manual-review',
      reason: 'upstream SKILL.md frontmatter changed',
    };
  }

  const merged = mergeText(localContents, baseContents, upstreamContents);

  if (!merged.clean) {
    return {
      ...candidate,
      disposition: 'manual-review',
      reason: 'three-way merge conflicts with the local adaptation',
    };
  }

  return {
    ...candidate,
    disposition: 'auto-port',
    reason: 'Markdown change has a clean three-way merge',
    mergedContents: merged.contents,
  };
};

const enforceAtomicSkills = (candidates) => {
  const manualSkills = new Set(candidates
    .filter((candidate) => candidate.localSkill && candidate.disposition === 'manual-review')
    .map((candidate) => candidate.localSkill));

  return candidates.map((candidate) => {
    if (
      candidate.disposition !== 'auto-port'
      || !manualSkills.has(candidate.localSkill)
    ) {
      return candidate;
    }

    return {
      ...candidate,
      disposition: 'manual-review',
      reason: 'another path in the same skill requires manual review',
      mergedContents: undefined,
    };
  });
};

export const analyzeChanges = ({ root, checkpoint, head, changes }) => enforceAtomicSkills(
  changes.map((change) => initialCandidate(root, checkpoint, head, change)),
);

const applyCandidates = async (root, candidates) => {
  for (const candidate of candidates.filter(({ disposition }) => disposition === 'auto-port')) {
    const localPath = path.join(root, candidate.localPath);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, candidate.mergedContents);
  }
};

const reportCandidate = ({ disposition, upstreamPath, localPath, reason }) => ({
  disposition,
  upstreamPath,
  localPath: localPath ?? null,
  reason,
});

export const run = async ({ root = process.cwd(), applySafe = false } = {}) => {
  const upstreamDocument = readFileSync(path.join(root, 'UPSTREAM.md'), 'utf8');
  const checkpoint = parseReviewCheckpoint(upstreamDocument);
  const remoteUrl = git(root, ['remote', 'get-url', 'upstream']).trim();
  const expectedRemote = 'git@github.com:mattpocock/skills.git';

  if (remoteUrl !== expectedRemote) {
    throw new Error(`upstream remote must be ${expectedRemote}; found ${remoteUrl}`);
  }

  const head = git(root, ['rev-parse', 'upstream/main']).trim();
  git(root, ['merge-base', '--is-ancestor', checkpoint, head]);

  const changes = parseNameStatus(git(root, [
    'diff',
    '--name-status',
    '--find-renames',
    `${checkpoint}..${head}`,
  ]));
  const candidates = analyzeChanges({ root, checkpoint, head, changes });

  if (applySafe) {
    await applyCandidates(root, candidates);
  }

  const report = {
    checkpoint,
    head,
    applied: applySafe,
    counts: Object.fromEntries(['auto-port', 'manual-review', 'no-port'].map((disposition) => [
      disposition,
      candidates.filter((candidate) => candidate.disposition === disposition).length,
    ])),
    candidates: candidates.map(reportCandidate),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  return report;
};

const isCli = isCliEntryPoint(import.meta.url);

if (isCli) {
  run({ applySafe: process.argv.includes('--apply-safe') }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
