import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { isDirectory, isGitIgnored, replaceFile } from '../filesystem.mjs';
import { BARE_PATH, GUARDRAIL_CLIENTS, guardrailOperations } from './clients.mjs';
import {
  changedLines,
  readClientSettings,
  renderSettings,
  withGuardrail,
  withoutGuardrail,
} from './settings.mjs';
import { GUARDRAIL_SCRIPT } from '../paths.mjs';
import { revisionRefusal } from '../refusals.mjs';

/**
 * The guardrail script's path relative to the repository, in the form every
 * teammate's clone holds it. The script that registers is the script
 * registered, so a skill installed outside the repository — or one Git
 * ignores — is refused: a clone would not have it. A linked client directory
 * resolves to the path the repository actually holds.
 */
const guardrailScript = async (resolvedProjectRoot, environment) => {
  const [script, project] = await Promise.all([realpath(GUARDRAIL_SCRIPT), realpath(resolvedProjectRoot)]);
  const relative = path.relative(project, script);

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw revisionRefusal(
      'guardrail-outside-project',
      `The framework-setup skill running this command is installed at ${path.dirname(path.dirname(script))}, not inside the repository ${project}, so a teammate who clones the repository would not have the guardrail it registers. Install the skill inside the repository and run its agent-framework from there. Nothing was written.`,
    );
  }

  const posix = relative.split(path.sep).join('/');

  if (await isGitIgnored(project, posix, environment)) {
    throw revisionRefusal(
      'guardrail-ignored',
      `Git ignores ${posix}, so a teammate who clones the repository would not have the guardrail it registers. Commit the framework-setup skill, then register again. Nothing was written.`,
    );
  }

  return posix;
};

/**
 * Preview registering (`add`) or unregistering (`remove`) the destructive-command
 * guardrail with one client.
 *
 * For Claude Code it merges one `PreToolUse` matcher group, matcher `Bash`,
 * whose one hook runs the guardrail script by its path inside the repository
 * under `${CLAUDE_PROJECT_DIR}`, into the shared `.claude/settings.json`. For
 * Cursor it merges one `beforeShellExecution` entry whose command runs the
 * script by that same path, relative to the project root Cursor runs hooks in,
 * into `.cursor/hooks.json` beside any Gate entry. Either file is created only
 * when missing; `remove` takes away exactly that entry. Every other key and
 * hook is kept. `previewHash` binds the file as it is now (empty when missing)
 * to the file the operation would write. Nothing is written.
 */
export const previewGuardrail = async ({ projectRoot, operation, client, environment = process.env }) => {
  if (!guardrailOperations.includes(operation)) {
    throw revisionRefusal('operation-unknown', `The guardrail operation is add or remove, not ${operation}. Nothing was written.`);
  }

  const target = Object.hasOwn(GUARDRAIL_CLIENTS, client ?? '') ? GUARDRAIL_CLIENTS[client] : null;

  if (target === null) {
    throw revisionRefusal(
      'client-unsupported',
      `The guardrail registers with ${Object.keys(GUARDRAIL_CLIENTS).join(', ')} only, not ${client}; Codex follows once its hook is observed. Nothing was written.`,
    );
  }

  const resolvedProjectRoot = path.resolve(projectRoot);

  if (!(await isDirectory(resolvedProjectRoot))) {
    throw revisionRefusal('project-missing', `${resolvedProjectRoot} is not a directory. Nothing was written.`);
  }

  const script = await guardrailScript(resolvedProjectRoot, environment);

  if (target.barePathOnly && !BARE_PATH.test(script)) {
    throw revisionRefusal(
      'guardrail-path-unsafe',
      `The guardrail is at ${script} in the repository, and ${client} runs a hook from one command string, which names a path without quoting only when it holds letters, digits, . _ - and / alone and does not start with -; its quoting was not observed, so none is relied on. Install the framework-setup skill at a path without spaces or other characters, then register again. Nothing was written.`,
    );
  }

  const { contents, settings, finalNewline, indent } = await readClientSettings(path.join(resolvedProjectRoot, target.file), target);
  const entry = target.entry(script);
  const candidate = operation === 'add'
    ? withGuardrail(settings, target, entry)
    : withoutGuardrail(settings, target, entry);
  const proposedSettings = renderSettings(candidate, finalNewline, indent);
  const previewHash = createHash('sha256')
    .update(contents ?? '')
    .update('\0')
    .update(proposedSettings)
    .digest('hex');

  return {
    status: 'ready',
    operation,
    client,
    file: target.file,
    created: contents === null,
    script,
    event: target.event,
    entry,
    changes: changedLines(contents ?? '', proposedSettings),
    previewHash,
    proposedSettings,
  };
};

/**
 * Write exactly the previewed guardrail change, or nothing. The preview is
 * taken again from the file as it is now, so a token from any other preview,
 * or from before the file changed, matches nothing and writes nothing.
 */
export const applyGuardrail = async ({ projectRoot, operation, client, confirmation, environment = process.env }) => {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const { proposedSettings, ...preview } = await previewGuardrail({ projectRoot: resolvedProjectRoot, operation, client, environment });

  if (confirmation !== preview.previewHash) {
    throw revisionRefusal(
      'preview-mismatch',
      `Guardrail confirmation does not match the current preview: ${preview.file} or the operation changed since that preview. Nothing was written; preview again.`,
    );
  }

  const settingsPath = path.join(resolvedProjectRoot, preview.file);

  await mkdir(path.dirname(settingsPath), { recursive: true });
  await replaceFile(settingsPath, proposedSettings);

  return { ...preview, status: operation === 'add' ? 'registered' : 'removed' };
};
