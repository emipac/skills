import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const exists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const readJson = async (filePath) => {
  if (!(await exists(filePath))) {
    return {};
  }

  return JSON.parse(await readFile(filePath, 'utf8'));
};

/**
 * Emit one draft.
 *
 * Drafting is a read plus a document. It only ever touches the filesystem when
 * an explicit `--out` names a path, and it refuses rather than overwriting a
 * file the maintainer already filled in.
 */
export const emitDraft = async (draft, out) => {
  if (!out) {
    return draft;
  }

  const target = path.resolve(out);

  try {
    await writeFile(target, `${JSON.stringify(draft, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Refusing to overwrite a draft: ${target} already exists`);
    }

    throw error;
  }

  return draft;
};

/** Replace a file in one rename, keeping its mode; a missing file is created. */
export const replaceFile = async (filePath, contents) => {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const mode = await stat(filePath).then((entry) => entry.mode, () => undefined);

  try {
    await writeFile(temporaryPath, contents, {
      encoding: 'utf8',
      flag: 'wx',
      ...(mode === undefined ? {} : { mode }),
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

/** Replace `.agent-framework.yaml` in one rename, keeping its mode. */
export const replaceConfiguration = (resolvedProjectRoot, contents) => replaceFile(
  path.join(resolvedProjectRoot, '.agent-framework.yaml'),
  contents,
);

export const isFile = (candidate) => stat(candidate).then((entry) => entry.isFile(), () => false);

export const isDirectory = (candidate) => stat(candidate).then((entry) => entry.isDirectory(), () => false);

/**
 * Whether Git ignores `file`, as `git check-ignore` answers: a tracked file is
 * never ignored, and anything but Git's own yes — no repository, no Git — is
 * not a yes. Nothing is read from the file and nothing under `.git` is written.
 */
export const isGitIgnored = (projectRoot, file, environment) => new Promise((resolve) => {
  execFile('git', ['check-ignore', '--quiet', '--', file], { cwd: projectRoot, env: environment }, (error) => {
    resolve(error === null);
  });
});

export const hashFiles = async (projectRoot, relativePaths) => Object.fromEntries(
  await Promise.all(relativePaths.map(async (relativePath) => [
    relativePath,
    createHash('sha256')
      .update(await readFile(path.join(projectRoot, relativePath)))
      .digest('hex'),
  ])),
);

export const writeManagedFile = async (filePath, contents) => {
  await mkdir(path.dirname(filePath), { recursive: true });

  if ((await exists(filePath)) && await readFile(filePath, 'utf8') === contents) {
    return;
  }

  await writeFile(filePath, contents);
};
