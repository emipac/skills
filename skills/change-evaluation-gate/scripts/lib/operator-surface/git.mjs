import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Git, from this clone, the way every other seam in this skill runs it. */
const runFile = promisify(execFile);

export const runGit = async (repositoryRoot, args) => (
  await runFile('git', args, { cwd: repositoryRoot })
).stdout;
