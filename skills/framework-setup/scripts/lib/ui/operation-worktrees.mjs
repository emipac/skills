import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Git worktrees are repositories, distinct from temporary Gate evaluation snapshots. */
export const listWorktrees = async ({ projectRoot, environment }) => {
  const { stdout } = await run('git', ['worktree', 'list', '--porcelain', '-z'], {
    cwd: projectRoot, env: environment, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  });
  const worktrees = [];
  let current = null;
  for (const record of stdout.split('\0')) {
    if (record.startsWith('worktree ')) {
      current = { path: record.slice(9), head: null, branch: null, locked: null, prunable: null };
      worktrees.push(current);
    } else if (current !== null && record.startsWith('HEAD ')) current.head = record.slice(5);
    else if (current !== null && record.startsWith('branch ')) current.branch = record.slice(7);
    else if (current !== null && (record === 'locked' || record.startsWith('locked '))) current.locked = record.slice(7) || true;
    else if (current !== null && (record === 'prunable' || record.startsWith('prunable '))) current.prunable = record.slice(9) || true;
  }
  return { kind: 'git-worktrees', description: 'Repository worktrees, separate from temporary Gate evaluation snapshots.', worktrees };
};
