// Find the Change Evaluation Gate's own command, and ask it one question.
//
// The Framework command never imports a Gate module (ADR 0004). Skills install
// one directory at a time and a client may place `framework-setup` without the
// Gate, so the Gate is reached only as a program: the `change-evaluation-gate`
// executable on the path, else the installed Gate skill directory beside this
// installed `framework-setup` directory. Anything else means the Gate module is
// absent, which is an answer rather than a failure (`FR-GUIDE-009`).
//
// "Beside" is decided from this module's resolved location. Node resolves
// symbolic links when it loads a module, so a skill reached through a linked
// client directory (`.claude/skills` linked at `.agents/skills`) finds the same
// sibling the installed path finds, and reports the same command.

import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** The Gate's packaged executable name, as `package.json` declares its bin. */
export const GATE_EXECUTABLE = 'change-evaluation-gate';

/** The only Gate observation document this reader understands. */
export const GATE_DOCUMENT_VERSION = 'change-evaluation-gate/observation/1';

const siblingGateScript = () => path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'change-evaluation-gate',
  'scripts',
  'gate.mjs',
);

const isFile = async (candidate) => {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
};

const isExecutableFile = async (candidate) => {
  if (!(await isFile(candidate))) {
    return false;
  }

  try {
    await access(candidate, constants.X_OK);

    return true;
  } catch {
    return false;
  }
};

const executableOnPath = async (environment) => {
  const directories = (environment.PATH ?? '').split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    const candidate = path.join(directory, GATE_EXECUTABLE);

    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return null;
};

/**
 * Where the Gate's command is, as `{ available, located, program, prefix, display, detail }`.
 *
 * `program` and `prefix` are what is spawned; `display` is the same command as
 * a maintainer types it.
 */
export const locateGateCommand = async ({ environment = process.env } = {}) => {
  const onPath = await executableOnPath(environment);

  if (onPath !== null) {
    return {
      available: true,
      located: 'path',
      program: onPath,
      prefix: [],
      display: [GATE_EXECUTABLE],
      detail: `${GATE_EXECUTABLE} on PATH (${onPath})`,
    };
  }

  const sibling = siblingGateScript();

  if (await isFile(sibling)) {
    return {
      available: true,
      located: 'sibling',
      program: process.execPath,
      prefix: [sibling],
      display: ['node', sibling],
      detail: `the installed change-evaluation-gate skill beside framework-setup (${sibling})`,
    };
  }

  return {
    available: false,
    located: null,
    program: null,
    prefix: [],
    display: null,
    detail: `${GATE_EXECUTABLE} is not on PATH and no installed change-evaluation-gate skill sits beside framework-setup (${sibling})`,
  };
};

/**
 * Run one Gate command with `--json` in `cwd` and return its observation
 * document, or `{ failure }` when the Gate could not answer.
 *
 * Exit `0` and `1` are both answers (the Gate's own convention: `1` means the
 * clone needs attention, and its `ok` is then false); only an unreadable
 * document or a document that reports a `failure` is not.
 */
export const runGateCommand = (gate, { cwd, args, environment = process.env }) => new Promise((resolve) => {
  execFile(
    gate.program,
    [...gate.prefix, ...args, '--json'],
    { cwd, env: environment, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    (error, stdout, stderr) => {
      let document = null;

      try {
        document = JSON.parse(stdout);
      } catch {
        document = null;
      }

      if (document?.document !== GATE_DOCUMENT_VERSION) {
        resolve({
          failure: {
            reasonCode: 'gate-unreadable',
            detail: `\`${[...gate.display, ...args, '--json'].join(' ')}\` returned no ${GATE_DOCUMENT_VERSION} document (exit ${error?.code ?? 0}${stderr.trim() ? `: ${stderr.trim()}` : ''}).`,
          },
        });

        return;
      }

      // `ok` is false for an unhealthy answer too; only a failure is no answer.
      if (document.failure !== null || document.observation === null) {
        resolve({
          failure: {
            reasonCode: document.failure?.reasonCode ?? 'gate-failed',
            detail: document.failure?.detail ?? `\`${GATE_EXECUTABLE} ${args.join(' ')}\` could not observe this clone.`,
          },
        });

        return;
      }

      resolve({ document });
    },
  );
});
