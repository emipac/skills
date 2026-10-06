import { AUTHORITATIVE_HOOK } from './constants.mjs';
import { contentIdentity } from '../../evidence-store.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Describe one already-registered hook without interpreting or changing it. */
export const existingHook = async (hookPath) => {
  const stats = await stat(hookPath).catch(() => null);

  if (stats === null) {
    return null;
  }

  const contents = (await readFile(hookPath).catch(() => Buffer.alloc(0))).toString('utf8');

  return {
    contents,
    descriptor: { path: hookPath, bytes: stats.size, identity: contentIdentity(contents) },
  };
};

/** Publish hook contents by one atomic rename, preserving the file's mode. */
export const publishHook = async ({ path: hookPath, directory, contents, mode }) => {
  const staged = path.join(directory, `.${AUTHORITATIVE_HOOK}.${randomUUID()}.part`);

  await mkdir(directory, { recursive: true });
  await writeFile(staged, contents, { mode });

  try {
    await rename(staged, hookPath);
  } catch (error) {
    await rm(staged, { force: true });

    throw error;
  }
};
