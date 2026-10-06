import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { isDirectory, isFile, isGitIgnored } from '../filesystem.mjs';
import { DEPENDENCY_INSTALLS } from './dependencies.mjs';

/**
 * The dotenv convention: the environment file a project keeps out of Git, and
 * the example file committed beside it that names the keys it holds. Like
 * `DEPENDENCY_INSTALLS`, this is `framework-setup`'s knowledge; Gate core
 * learns no file name from it (`SG-OWNER-001`).
 */
const ENVIRONMENT_FILE_CONVENTIONS = Object.freeze([
  Object.freeze({ file: '.env', example: '.env.example' }),
]);

/**
 * The key each line of an environment file assigns, never its value: only the
 * text before a line's first `=`, without a leading `export`, is kept. A line
 * that assigns nothing yields `name: null`; blank and comment lines yield
 * nothing.
 *
 * @returns {Array<{ line: number, name: string | null }>}
 */
const environmentFileKeys = (contents) => contents.split(/\r?\n/).flatMap((text, index) => {
  const line = text.trim();

  if (line === '' || line.startsWith('#')) {
    return [];
  }

  const assignment = line.indexOf('=');

  return [{ line: index + 1, name: assignment > 0 ? line.slice(0, assignment).trim().replace(/^export\s+/, '') : null }];
});

/** One dependency root, when a manifest or lock file that governs it is present together with the directory. */
const dependencyRootFact = async (resolvedRoot, root, { manifest, lockFiles }) => {
  const governing = [];

  for (const [fact, file] of [['manifest', manifest], ...lockFiles.map((lockFile) => ['lock-file', lockFile])]) {
    if (await isFile(path.join(resolvedRoot, file))) {
      governing.push({ fact, path: file });
    }
  }

  return governing.length > 0 && await isDirectory(path.join(resolvedRoot, root))
    ? [{ root, evidence: [...governing, { fact: 'install-directory', path: root }] }]
    : [];
};

/**
 * The repository facts that imply what a Gate configuration section should
 * declare (`FR-GUIDE-007`, `TB-071`), read from this repository only and from
 * `framework-setup`'s own tables (`SG-OWNER-001`):
 *
 * - `dependencyRoots`: each directory in `DEPENDENCY_INSTALLS` that exists
 *   together with its manifest or a lock file, naming which;
 * - `sensitiveInputs`: each key an example environment file assigns, first
 *   occurrence only, with its line — never a value (`SG-GUIDE-002`);
 *   `unassigned` counts the example lines that assign no key;
 * - `environmentFiles`: each conventional environment file present that Git
 *   ignores. Its contents are never read.
 *
 * Whether a key is a name the Gate accepts, and whether any of this is already
 * declared, is not judged here. Nothing is written.
 */
export const discoverGateConfigurationFacts = async ({ projectRoot, environment = process.env }) => {
  const resolvedRoot = path.resolve(projectRoot);
  const dependencyRoots = [];
  const sensitiveInputs = [];
  const unassigned = [];
  const environmentFiles = [];

  for (const [root, install] of Object.entries(DEPENDENCY_INSTALLS)) {
    dependencyRoots.push(...await dependencyRootFact(resolvedRoot, root, install));
  }

  for (const { file, example } of ENVIRONMENT_FILE_CONVENTIONS) {
    const keys = await isFile(path.join(resolvedRoot, example))
      ? environmentFileKeys(await readFile(path.join(resolvedRoot, example), 'utf8'))
      : [];
    const assigned = keys.filter(({ name }) => name !== null);

    for (const { line, name } of assigned.filter((key, index) => assigned.findIndex(({ name: first }) => first === key.name) === index)) {
      sensitiveInputs.push({ name, evidence: [{ fact: 'example-name', path: example, line }] });
    }

    if (keys.length > assigned.length) {
      unassigned.push({ path: example, count: keys.length - assigned.length });
    }

    if (await isFile(path.join(resolvedRoot, file)) && await isGitIgnored(resolvedRoot, file, environment)) {
      environmentFiles.push({ file, evidence: [{ fact: 'git-ignored', path: file }] });
    }
  }

  return { dependencyRoots, sensitiveInputs, unassigned, environmentFiles };
};
