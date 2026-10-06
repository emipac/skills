import { resolveRepositoryRoot } from '../hook-runner.mjs';
import { parseArguments } from './arguments.mjs';
import { operateActivate } from './commands/activate.mjs';
import { operateBypass } from './commands/bypass.mjs';
import { operateCheck } from './commands/check.mjs';
import { operateCleanup } from './commands/cleanup.mjs';
import { operateDeactivate } from './commands/deactivate.mjs';
import { operateDoctor } from './commands/doctor.mjs';
import { operateLocks } from './commands/locks.mjs';
import { operatePrune } from './commands/prune.mjs';
import { operateRepair } from './commands/repair.mjs';
import { operateStatus } from './commands/status.mjs';
import { operateSync } from './commands/sync.mjs';
import { operateUninstall } from './commands/uninstall.mjs';
import { operateUpdate } from './commands/update.mjs';
import { EXIT_OBSERVED } from './constants.mjs';
import { documentOf } from './document.mjs';
import { failure } from './outcomes.mjs';
import { renderDocument } from './rendering/document.mjs';
import { USAGE } from './usage.mjs';

const OPERATIONS = Object.freeze({
  activate: operateActivate,
  status: operateStatus,
  check: operateCheck,
  doctor: operateDoctor,
  locks: operateLocks,
  prune: operatePrune,
  repair: operateRepair,
  update: operateUpdate,
  deactivate: operateDeactivate,
  uninstall: operateUninstall,
  cleanup: operateCleanup,
  bypass: operateBypass,
  sync: operateSync,
});

/**
 * Run one operator invocation and return what the caller should print and exit
 * with.
 *
 * The entry point does the writing; everything decided here is returned, so the
 * whole surface is provable in-process against a real activated clone.
 *
 * `copyProgram` is the copy program `gate doctor`'s clone probe asks, exactly
 * as `captureSnapshot` takes it: left undefined — which is all the packaged
 * command ever does — it is the platform's own; `null` says there is none, so
 * the probe measures nothing. It is a parameter only so a test that is not
 * about clone capability does not write a probe file other suites' free-space
 * measurements would see (`TB-063`). No argument vector reaches it.
 */
export const runOperatorCommand = async ({
  cwd = process.cwd(),
  argv = [],
  environment = process.env,
  copyProgram = undefined,
} = {}) => {
  const parsed = parseArguments(argv);

  if (parsed.help === true) {
    return { exitCode: EXIT_OBSERVED, stdout: USAGE, stderr: '', document: null };
  }

  const answer = (document) => (document.failure === null
    ? {
      exitCode: document.exitStatus,
      stdout: parsed.json ? `${JSON.stringify(document, null, 2)}\n` : renderDocument(document),
      stderr: '',
      document,
    }
    : {
      exitCode: document.exitStatus,
      stdout: parsed.json ? `${JSON.stringify(document, null, 2)}\n` : '',
      // A failed invocation says why where a person expects to read it, and
      // says it in one line beginning with the program's own name, exactly as
      // the packaged commit and preflight runners already do.
      stderr: `change-evaluation-gate: ${document.failure.detail}\n`,
      document,
    });

  if (parsed.failure !== undefined) {
    return answer(documentOf({
      command: parsed.command ?? null,
      repositoryRoot: null,
      result: parsed,
      selector: parsed.selector ?? null,
    }));
  }

  const repository = await resolveRepositoryRoot(cwd);

  if (!repository.ok) {
    return answer(documentOf({
      command: parsed.command,
      repositoryRoot: null,
      result: failure({
        command: parsed.command,
        reasonCode: repository.reasonCode,
        detail: repository.detail,
      }),
    }));
  }

  const result = await OPERATIONS[parsed.command]({
    repositoryRoot: repository.root,
    environment,
    selector: parsed.selector,
    confirmation: parsed.confirmation,
    copyProgram,
  });

  return answer(documentOf({
    command: parsed.command,
    repositoryRoot: repository.root,
    result,
    selector: parsed.selector,
  }));
};
