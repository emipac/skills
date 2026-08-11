/**
 * The clone-local Activation transaction.
 *
 * Activation is the explicit, repository-bound step that turns a *configured*
 * clone into an *activated* one. It is never reached by installing a skill,
 * running setup, or opening a client: those states are deliberately distinct
 * (FR-LIFE-004).
 *
 * The transaction runs a fixed ordered pipeline and enables authoritative Git
 * last, so nothing can block a commit until every earlier step has proved
 * itself. Every gate-owned change is journalled with its compensating action;
 * a failure at any step unwinds that journal in reverse and leaves the clone
 * configured, with no receipt and no registration (FR-LIFE-005, NFR-REL-002,
 * SG-LIFE-001).
 *
 * The transaction never repairs drift it did not cause and never removes
 * anything it did not write.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { contentIdentity, resolveGitCommonDirectory } from './evidence-store.mjs';
import { resolveExecutables } from './command-descriptor.mjs';

/** The ordered steps of one Activation transaction; Git is always enabled last. */
export const ACTIVATION_STEPS = Object.freeze([
  'repository-identity',
  'preview',
  'consent',
  'runner-resolution',
  'trust',
  'hook-chain-validation',
  'self-test',
  'receipt',
  'git-enablement',
]);

/** The versioned on-disk shape of an Activation receipt. */
export const ACTIVATION_RECEIPT_VERSION = 'change-evaluation-gate/activation/v1';

/** The authoritative hook the Gate registers; nothing else is authoritative. */
export const AUTHORITATIVE_HOOK = 'pre-commit';

/**
 * The declared hook composition order (FR-LIFE-017).
 *
 * Registration always prefers the least invasive thing that works: a hook
 * manager's own integration point first, then a confirmed marker-delimited
 * block inside an existing repository-local hook, and only where no hook exists
 * at all a clearly owned shim. Nothing in this list overwrites a hook or moves
 * a hooks path.
 */
export const HOOK_STRATEGIES = Object.freeze([
  'native-hook-manager',
  'marker-delimited-block',
  'gate-owned-shim',
]);

/** The delimiters of the gate-owned block inside an existing hook. */
export const HOOK_BLOCK_BEGIN = '# >>> change-evaluation-gate managed block >>>';
export const HOOK_BLOCK_END = '# <<< change-evaluation-gate managed block <<<';

/** The directory a Husky-managed clone keeps its project hooks in. */
const MANAGED_HOOK_DIRECTORY = '.husky';

/**
 * Hook managers whose integration point is a declaration rather than a file the
 * gate could add. Editing somebody's `lefthook.yml` on their behalf is exactly
 * the silent change SG-HOOK-001 forbids, so these require manual registration.
 */
const DECLARATIVE_HOOK_MANAGERS = Object.freeze([
  { id: 'lefthook', files: ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml'] },
  { id: 'pre-commit', files: ['.pre-commit-config.yaml', '.pre-commit-config.yml'] },
]);

/** Interpreters whose scripts the gate can safely compose a `/bin/sh` block into. */
const COMPOSABLE_INTERPRETERS = /^#!\s*\S*\/(?:env\s+)?(?:sh|bash|dash|ksh|zsh)\b/;

/**
 * A clone identity. It names one clone's resolved Git metadata, which is
 * exactly the scope activation is bound to; it is not a project identity and
 * never travels between machines.
 */
export const repositoryIdentity = (gitCommonDirectory) => contentIdentity({ gitCommonDirectory });

/** The identity of the approved repository policy the receipt pins. */
export const configurationIdentity = (configuration) => contentIdentity({
  schemaVersion: configuration?.schemaVersion ?? null,
  policy: configuration?.policy ?? null,
});

/**
 * The identity of the selected adapter set.
 *
 * A transaction that paused with one adapter set may not resume with another:
 * the operator consented to self-testing and activating exactly these
 * integrations (FR-LIFE-016).
 */
export const adapterIdentity = (adapters = []) => contentIdentity(
  adapters.map((adapter) => ({
    id: adapter?.id ?? null,
    version: adapter?.version ?? null,
    authoritative: adapter?.authoritative === true,
  })),
);

/**
 * The identity of one Activation transaction.
 *
 * It binds the four things a resumption may never change: the clone, the
 * approved policy, the selected adapters, and the exact preview consent was
 * granted against. Trust prompts are the one legitimate reason to pause, and
 * the machine may have changed while the operator was answering one.
 */
export const activationTransactionIdentity = ({
  repositoryIdentity: repository = null,
  configurationIdentity: configuration = null,
  adapterIdentity: adapters = null,
  previewId = null,
}) => contentIdentity({ repository, configuration, adapters, previewId });

const refusal = (step, reasonCode, errors = []) => ({
  activated: false,
  state: 'configured',
  step,
  reasonCode,
  errors,
  receipt: null,
  order: [],
  rollback: { performed: false, actions: [], failures: [] },
  resumption: null,
});

/** Describe one already-registered hook without interpreting or changing it. */
const existingHook = async (hookPath) => {
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

/**
 * Find this clone's hook manager, if it has one.
 *
 * Detection is by layout only: no manager is executed, no network is touched,
 * and an absent manager is an ordinary answer rather than a failure. It is a
 * dependency so a fixture can state exactly which manager it is standing in.
 */
export const detectHookManager = async ({ repositoryRoot, hooksPath }) => {
  if (hooksPath?.configured && !hooksPath.shared) {
    // Husky owns `.husky`. From v9 Git is pointed at the generated `_` runner
    // directory inside it, which is the manager's own file to write; either way
    // the manager's integration point for a project hook is `.husky` itself.
    const directory = hooksPath.directory;
    const candidate = path.basename(directory) === '_' ? path.dirname(directory) : directory;

    if (path.basename(candidate) === MANAGED_HOOK_DIRECTORY) {
      const stats = await stat(candidate).catch(() => null);

      if (stats?.isDirectory()) {
        return { id: 'husky', registration: 'managed-directory', directory: candidate, configuration: null };
      }
    }
  }

  for (const manager of DECLARATIVE_HOOK_MANAGERS) {
    for (const file of manager.files) {
      const stats = await stat(path.join(repositoryRoot, file)).catch(() => null);

      if (stats?.isFile()) {
        return { id: manager.id, registration: 'declarative', directory: null, configuration: file };
      }
    }
  }

  return null;
};

/** The pinned runtime invocation, quoted for `/bin/sh`. */
const quotedProgram = ({ program, repositoryRoot }) => {
  const argv = [
    program.interpreter,
    repositoryRoot === undefined ? program.script : path.resolve(repositoryRoot, program.script),
    ...(program.args ?? []),
  ];

  for (const value of argv) {
    if (typeof value !== 'string' || /["\\\n\r]/.test(value)) {
      throw new Error(`A hook program argument is not safely quotable: ${JSON.stringify(value)}.`);
    }
  }

  return argv.map((value) => `"${value}"`).join(' ');
};

/**
 * The gate-owned `pre-commit` shim.
 *
 * It is deliberately trivial and clearly marked: it hands control to the pinned
 * runtime and does nothing else, so a maintainer reading their hook directory
 * can see at a glance what owns the file and what it runs.
 */
const shimContents = ({ hook, program, receipt }) => [
  '#!/bin/sh',
  `# change-evaluation-gate: owned ${hook} shim. Managed by the Gate; do not edit.`,
  `# activation-receipt: ${receipt.receiptId}`,
  `exec ${quotedProgram({ program })} "$@"`,
  '',
].join('\n');

/**
 * The gate-owned block placed inside a hook the repository already had.
 *
 * It runs the pinned runtime and stops the commit when the gate refuses it;
 * otherwise control falls straight through to the hook's original body, which
 * is why the block is placed at the top rather than appended. A hook that ends
 * in `exit 0` — most of them do — would never reach an appended block.
 */
const managedBlockContents = ({ program, receipt, repositoryRoot }) => [
  HOOK_BLOCK_BEGIN,
  '# Managed by the Gate; do not edit inside these markers.',
  `# activation-receipt: ${receipt.receiptId}`,
  `${quotedProgram({ program, repositoryRoot })} "$@" || exit $?`,
  HOOK_BLOCK_END,
].join('\n');

/**
 * Locate the gate-owned block in a hook, and say whether it is intact.
 *
 * Anything other than exactly one well-formed block is drift: the gate cannot
 * tell what a half-removed or duplicated block was meant to be, and guessing is
 * precisely what SG-HOOK-001 forbids.
 */
const managedBlockIn = (contents) => {
  const begin = contents.indexOf(HOOK_BLOCK_BEGIN);
  const end = contents.indexOf(HOOK_BLOCK_END);

  if (begin === -1 && end === -1) {
    return { present: false, wellFormed: true, block: null, begin: -1, end: -1 };
  }

  const duplicated = begin !== -1 && contents.indexOf(HOOK_BLOCK_BEGIN, begin + 1) !== -1;
  const repeated = end !== -1 && contents.indexOf(HOOK_BLOCK_END, end + 1) !== -1;

  if (begin === -1 || end === -1 || end < begin || duplicated || repeated) {
    return { present: true, wellFormed: false, block: null, begin, end };
  }

  return {
    present: true,
    wellFormed: true,
    block: contents.slice(begin, end + HOOK_BLOCK_END.length),
    begin,
    end,
  };
};

/** Place the block where control actually reaches it: directly after the shebang. */
const composeManagedBlock = (contents, block) => {
  const newline = contents.indexOf('\n');

  if (contents.startsWith('#!') && newline !== -1) {
    return `${contents.slice(0, newline + 1)}${block}\n${contents.slice(newline + 1)}`;
  }

  return `${block}\n${contents}`;
};

/** Publish hook contents by one atomic rename, preserving the file's mode. */
const publishHook = async ({ path: hookPath, directory, contents, mode }) => {
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

/**
 * Register the authoritative hook.
 *
 * The file is published by one atomic rename, so a Git invocation racing this
 * write sees either no hook or the whole hook, never half of one
 * (NFR-REL-002). Nothing else in the hook chain is read, moved, or rewritten.
 */
export const registerOwnedHook = async ({ hook, path: hookPath, directory, repositoryRoot, program, receipt }) => {
  if (!program?.interpreter || !program?.script) {
    throw new Error('Activation requires a hook program to register.');
  }

  const contents = shimContents({
    hook,
    program: { ...program, script: path.resolve(repositoryRoot, program.script) },
    receipt,
  });

  await publishHook({ path: hookPath, directory, contents, mode: 0o755 });

  return { path: hookPath, ownership: 'gate-owned-shim', identity: contentIdentity(contents) };
};

/**
 * Withdraw a hook this transaction registered — and only that.
 *
 * If the file no longer matches what was written, somebody else owns it now.
 * Rollback reports that and leaves it in place; it never repairs drift it did
 * not cause (SG-HOOK-001, SG-LIFE-001).
 */
export const removeOwnedHook = async ({ path: hookPath, identity = null }) => {
  if (identity === null) {
    return { removed: false, reason: 'unknown-registration' };
  }

  const contents = await readFile(hookPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (contents === null) {
    return { removed: false, reason: 'already-absent' };
  }

  if (contentIdentity(contents) !== identity) {
    throw new Error(`The registered hook at ${hookPath} changed on disk; rollback left it in place rather than repairing drift it did not cause.`);
  }

  await rm(hookPath, { force: true });

  return { removed: true, reason: null };
};

/**
 * Compose the gate into a hook the repository already had.
 *
 * The surrounding chain is preserved byte for byte: the only change is one
 * clearly delimited block, and the file is re-confirmed immediately before it is
 * written so a hook edited since the operator looked at it is never composed
 * into (FR-LIFE-007, FR-LIFE-017, NFR-COMP-002).
 */
export const registerManagedBlock = async ({
  path: hookPath,
  directory,
  repositoryRoot,
  program,
  receipt,
  existing,
}) => {
  if (!program?.interpreter || !program?.script) {
    throw new Error('Activation requires a hook program to register.');
  }

  const contents = await readFile(hookPath, 'utf8');

  if (contentIdentity(contents) !== existing?.identity) {
    throw new Error(`The hook at ${hookPath} changed after it was confirmed; nothing was composed into it.`);
  }

  const block = managedBlockContents({ program, receipt, repositoryRoot });
  const composed = composeManagedBlock(contents, block);
  const mode = (await stat(hookPath)).mode & 0o777;

  await publishHook({ path: hookPath, directory, contents: composed, mode });

  return {
    path: hookPath,
    ownership: 'marker-delimited-block',
    identity: contentIdentity(composed),
    block: contentIdentity(block),
    priorIdentity: existing.identity,
  };
};

/**
 * Withdraw a composed block — and restore exactly the hook that was there.
 *
 * Both the whole file and the block itself must still be what this transaction
 * wrote, and removing the block must reproduce the preserved chain exactly.
 * Anything else means somebody owns that file now, and rollback says so rather
 * than editing their hook (SG-HOOK-001, SG-LIFE-001).
 */
export const removeManagedBlock = async ({
  path: hookPath,
  directory,
  identity = null,
  block = null,
  priorIdentity = null,
}) => {
  if (identity === null) {
    return { removed: false, reason: 'unknown-registration' };
  }

  const contents = await readFile(hookPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (contents === null) {
    return { removed: false, reason: 'already-absent' };
  }

  if (contentIdentity(contents) !== identity) {
    throw new Error(`The composed hook at ${hookPath} changed on disk; rollback left it in place rather than repairing drift it did not cause.`);
  }

  const found = managedBlockIn(contents);

  if (!found.wellFormed || contentIdentity(found.block) !== block) {
    throw new Error(`The gate-owned block in ${hookPath} changed on disk; rollback left it in place rather than repairing drift it did not cause.`);
  }

  const restored = contents.slice(0, found.begin)
    + contents.slice(found.end + HOOK_BLOCK_END.length + 1);

  if (contentIdentity(restored) !== priorIdentity) {
    throw new Error(`Removing the gate-owned block from ${hookPath} would not restore the hook chain this activation preserved; it was left in place.`);
  }

  await publishHook({
    path: hookPath,
    directory,
    contents: restored,
    mode: (await stat(hookPath)).mode & 0o777,
  });

  return { removed: true, reason: null };
};

const samePath = async (left, right) => {
  const resolve = async (value) => realpath(value).catch(() => path.resolve(value));

  return (await resolve(left)) === (await resolve(right));
};

/**
 * Where this clone's hooks actually live, and whether that location is this
 * clone's own business.
 *
 * A `core.hooksPath` that comes from anywhere but this clone's own
 * configuration file governs other repositories too. Activation will not
 * register into it and will not rewrite the setting to escape it: the operator
 * resolves that themselves (SG-HOOK-001).
 */
const resolveHooksPath = async ({ repositoryRoot, gitCommonDirectory, runGit }) => {
  const raw = await runGit(repositoryRoot, ['config', '--show-origin', '--get', 'core.hooksPath'])
    .then((stdout) => stdout.trim())
    .catch(() => '');

  if (raw.length === 0) {
    return {
      configured: false,
      value: null,
      origin: null,
      shared: false,
      directory: path.join(gitCommonDirectory, 'hooks'),
    };
  }

  const [origin, value] = raw.split('\t');
  const originPath = origin.startsWith('file:') ? origin.slice('file:'.length) : null;
  const directory = path.resolve(repositoryRoot, value);
  const cloneLocalConfig = path.join(gitCommonDirectory, 'config');
  const fromCloneLocalConfig = originPath !== null
    && await samePath(path.resolve(repositoryRoot, originPath), cloneLocalConfig);
  // Even a clone-local setting is shared when it points outside the clone.
  const insideClone = directory.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`)
    || directory.startsWith(`${gitCommonDirectory}${path.sep}`);

  return {
    configured: true,
    value,
    origin,
    shared: !fromCloneLocalConfig || !insideClone,
    directory,
  };
};

/**
 * Choose the hook composition strategy in the declared order (FR-LIFE-017).
 *
 * The order is not a preference, it is a safety ranking: the manager's own
 * integration point disturbs least, a marker-delimited block inside an existing
 * hook disturbs the surrounding chain not at all but needs the operator to
 * confirm that exact hook, and an owned shim is only ever created where there is
 * no hook to preserve. Every branch that cannot be taken safely carries the
 * reason code the transaction will refuse with; none of them writes anything.
 */
const resolveHookStrategy = async ({ request, repositoryRoot, gitCommonDirectory, hooksPath, detect }) => {
  const fallbackPath = path.join(hooksPath.directory, AUTHORITATIVE_HOOK);
  const refuse = (fields) => ({
    manager: null,
    strategy: null,
    directory: hooksPath.directory,
    path: fallbackPath,
    existing: null,
    contents: null,
    priorIdentity: null,
    ...fields,
  });

  // A hooks path that governs other repositories is never registered into and
  // never rewritten to escape, whatever else is true of this clone.
  if (hooksPath.shared) {
    return refuse({
      action: 'refuse-shared-hooks-path',
      ownership: 'gate-owned-shim',
      reasonCode: 'hooks-path-shared',
      errors: [hooksPath],
    });
  }

  const manager = await detect({ repositoryRoot, gitCommonDirectory, hooksPath });

  if (manager?.registration === 'declarative') {
    return refuse({
      manager,
      action: 'refuse-hook-manager-manual',
      ownership: 'native-hook-manager',
      reasonCode: 'hook-manager-manual-registration',
      errors: [{ manager: manager.id, configuration: manager.configuration }],
    });
  }

  const native = manager?.registration === 'managed-directory';
  const directory = native ? manager.directory : hooksPath.directory;
  const hookPath = path.join(directory, AUTHORITATIVE_HOOK);
  const found = await existingHook(hookPath);
  const ownership = native ? 'native-hook-manager' : 'gate-owned-shim';
  const base = {
    manager: manager ?? null,
    directory,
    path: hookPath,
    existing: found?.descriptor ?? null,
    contents: found?.contents ?? null,
    priorIdentity: found?.descriptor.identity ?? null,
    errors: [],
  };

  if (found === null) {
    return {
      ...base,
      strategy: native ? 'native-hook-manager' : 'gate-owned-shim',
      action: native ? 'create-native-registration' : 'create-owned-shim',
      ownership,
      reasonCode: null,
    };
  }

  // Gate-owned content already inside somebody's hook is never quietly reused,
  // repaired, or replaced. The operator resolves it (AC-LIFE-003).
  const block = managedBlockIn(found.contents);

  if (block.present) {
    return {
      ...base,
      strategy: null,
      action: 'refuse-marker-drift',
      ownership: 'marker-delimited-block',
      reasonCode: 'hook-marker-drift',
      errors: [{
        path: hookPath,
        marker: block.wellFormed ? 'already-registered' : 'unbalanced',
        resolution: 'manual',
      }],
    };
  }

  const confirmation = request.hookConfirmation ?? null;

  if (confirmation === null) {
    return {
      ...base,
      strategy: null,
      action: 'refuse-existing-hook',
      ownership,
      reasonCode: 'hook-exists',
      errors: [found.descriptor],
    };
  }

  // A confirmation is for one exact hook, as the operator read it. A hook edited
  // since then is a different hook and has to be looked at again.
  if (confirmation.strategy !== 'marker-delimited-block'
    || path.resolve(confirmation.path ?? '') !== hookPath
    || confirmation.hookIdentity !== found.descriptor.identity) {
    return {
      ...base,
      strategy: null,
      action: 'refuse-existing-hook',
      ownership,
      reasonCode: 'hook-confirmation-mismatch',
      errors: [{
        expected: {
          strategy: 'marker-delimited-block',
          path: hookPath,
          hookIdentity: found.descriptor.identity,
        },
        actual: {
          strategy: confirmation.strategy ?? null,
          path: confirmation.path ?? null,
          hookIdentity: confirmation.hookIdentity ?? null,
        },
      }],
    };
  }

  // The block is `/bin/sh`. Composing it into a hook written in something else
  // would break the chain rather than preserve it.
  if (!COMPOSABLE_INTERPRETERS.test(found.contents)) {
    return {
      ...base,
      strategy: null,
      action: 'refuse-uncomposable-chain',
      ownership,
      reasonCode: 'hook-chain-uncomposable',
      errors: [{ path: hookPath, resolution: 'manual' }],
    };
  }

  return {
    ...base,
    strategy: 'marker-delimited-block',
    action: 'compose-marker-block',
    ownership: 'marker-delimited-block',
    reasonCode: null,
  };
};

/** Resolve the identities, locations, and commands one activation would use. */
const describeActivation = async (request, dependencies) => {
  const { runGit, resolveExecutable, detectHookManager: detect = detectHookManager } = dependencies;
  const gitCommonDirectory = await resolveGitCommonDirectory({
    repositoryRoot: request.repository.root,
    runGit,
  });
  const runners = resolveExecutables(request.checks ?? [], resolveExecutable);
  const hooksPath = await resolveHooksPath({
    repositoryRoot: request.repository.root,
    gitCommonDirectory,
    runGit,
  });
  const hooksDirectory = hooksPath.directory;
  const hook = await resolveHookStrategy({
    request,
    repositoryRoot: request.repository.root,
    gitCommonDirectory,
    hooksPath,
    detect,
  });
  const hookPath = hook.path;
  const existing = hook.existing;
  const action = hook.action;

  return {
    gitCommonDirectory,
    hooksPath,
    hooksDirectory,
    hookPath,
    hook,
    hookManager: hook.manager
      ? { id: hook.manager.id, registration: hook.manager.registration, configuration: hook.manager.configuration ?? null }
      : null,
    runners,
    repository: {
      root: request.repository.root,
      gitCommonDirectory,
      identity: repositoryIdentity(gitCommonDirectory),
    },
    configuration: {
      schemaVersion: request.configuration?.schemaVersion ?? null,
      identity: configurationIdentity(request.configuration),
    },
    // Exactly what would change, and exactly what would run.
    hooks: [{
      hook: AUTHORITATIVE_HOOK,
      path: hookPath,
      action,
      // The ownership label is the strategy: it says who owns the file the gate
      // would touch, which is exactly what distinguishes the three strategies.
      ownership: hook.ownership,
      existing,
    }],
    commands: runners.resolved.map((entry) => ({
      check_id: entry.check_id,
      role: entry.role,
      runner: entry.runner,
      executable: entry.executable,
      version: entry.version,
      preview: entry.preview,
      working_directory: entry.working_directory,
    })),
    adapters: (request.adapters ?? []).map((adapter) => ({
      id: adapter.id,
      version: adapter.version ?? null,
      authoritative: adapter.authoritative === true,
    })),
    // Names only. Approving and injecting a runtime input value is a separate,
    // later concern; a receipt never carries one.
    runtimeInputs: (request.runtimeInputs ?? []).map((input) => input.name),
  };
};

/**
 * Preview one activation.
 *
 * The preview writes nothing. It states the identities the transaction is bound
 * to, the exact hook locations it would change, the exact resolved commands it
 * would run, the adapters it would self-test, and the runtime input names it
 * would pin. Consent is granted against this exact preview (FR-LIFE-004).
 */
export const previewActivation = async (request, dependencies = {}) => {
  const described = await describeActivation(request, dependencies);
  const body = {
    repository: described.repository,
    configuration: described.configuration,
    hooksPath: described.hooksPath,
    hookManager: described.hookManager,
    hooks: described.hooks,
    commands: described.commands,
    unresolved: described.runners.unresolved,
    adapters: described.adapters,
    runtimeInputs: described.runtimeInputs,
    trust: { client: request.client?.id ?? null, required: true },
    scope: request.scope ?? 'repository',
  };

  return { ...body, previewId: contentIdentity(body) };
};

/**
 * Run one Activation transaction.
 *
 * Every seam that touches the machine is injected, so a fixture can inject a
 * genuine failure at any step and observe the rollback rather than simulate it.
 */
export const activate = async (request, dependencies = {}) => {
  const {
    establishTrust,
    revokeTrust = null,
    selfTestEvaluation,
    selfTestAdapter,
    registerAdapter = null,
    unregisterAdapter = null,
    registerHook = registerOwnedHook,
    unregisterHook = removeOwnedHook,
    composeHook = registerManagedBlock,
    decomposeHook = removeManagedBlock,
    evidenceStore = null,
    clock = () => new Date(),
  } = dependencies;

  // Compensating actions, unwound last-in-first-out.
  const journal = [];
  const order = [];

  const outcomeOf = (result) => {
    if (result.activated) {
      return 'succeeded';
    }

    // A pause is not a failure: the transaction is intact and may be resumed
    // with the identities it recorded.
    return result.state === 'paused' ? 'refused' : 'failed';
  };

  const reasonOf = (result) => {
    if (result.activated) {
      return `Activation completed through ${result.step}; authoritative Git was enabled last.`;
    }

    if (result.state === 'paused') {
      return `Activation paused at ${result.step} (${result.reasonCode}); no gate integration is active and it may be resumed only with the identities it recorded.`;
    }

    return `Activation failed at ${result.step} (${result.reasonCode}); every gate-owned change was rolled back and the clone remains configured.`;
  };

  const record = async (result) => {
    if (evidenceStore) {
      await evidenceStore.appendLifecycleEvent({
        type: 'activation',
        before: result.resumption?.previewId ?? result.receipt?.previewId ?? null,
        after: result.resumption?.transactionId ?? result.receipt?.receiptId ?? null,
        outcome: outcomeOf(result),
        reason: reasonOf(result),
      });
    }

    return result;
  };

  const rollback = async () => {
    const actions = [];
    const failures = [];

    for (const entry of [...journal].reverse()) {
      actions.push(entry.name);

      try {
        await entry.undo();
      } catch (error) {
        failures.push({ action: entry.name, message: error.message });
      }
    }

    return { performed: journal.length > 0, actions, failures };
  };

  const fail = async (step, reasonCode, errors = []) => {
    const result = { ...refusal(step, reasonCode, errors), order, rollback: await rollback() };

    // A store that cannot record the refusal must not mask the refusal itself.
    return record(result).catch(() => result);
  };

  /**
   * Suspend the transaction without activating anything.
   *
   * Everything gate-owned is still unwound, so a paused transaction leaves no
   * integration active anywhere; what survives is the identity it may be
   * resumed against, and nothing else (FR-LIFE-016, SG-HOOK-001).
   */
  const suspend = async (step, reasonCode, errors, resumption) => {
    const result = {
      ...refusal(step, reasonCode, errors),
      state: 'paused',
      order,
      rollback: await rollback(),
      resumption,
    };

    return record(result).catch(() => result);
  };

  // 1. Repository identity, and the entry points that may never reach it.
  order.push('repository-identity');

  const scope = request.scope ?? 'repository';

  if (scope !== 'repository') {
    // v1 activation is always clone-local. There is no global activation to opt
    // into, so there is nothing for a machine-wide install to switch on.
    return fail(
      'repository-identity',
      scope === 'global' ? 'activation-scope-global' : 'activation-scope-unsupported',
      [{ scope }],
    );
  }

  if ((request.trigger ?? 'explicit') !== 'explicit') {
    // Installing assets and running setup are not consent. A package or plugin
    // lifecycle can never activate the gate (FR-LIFE-004).
    return fail('repository-identity', 'activation-trigger-prohibited', [{ trigger: request.trigger }]);
  }

  const described = await describeActivation(request, dependencies);

  // A non-interactive run has nobody to look at the preview, so the caller must
  // say in advance which clone and which approved policy it means. A flag alone
  // is never enough: it says "do not ask", not "this is the right repository"
  // (FR-LIFE-015).
  if (request.interactive === false) {
    const missing = [
      ...(request.repository.expectedIdentity ? [] : ['repository.expectedIdentity']),
      ...(request.configuration?.expectedIdentity ? [] : ['configuration.expectedIdentity']),
    ];

    if (missing.length > 0) {
      return fail('repository-identity', 'non-interactive-identity-missing', [{ missing }]);
    }
  }

  // A non-interactive activation must name the clone and the policy it expects.
  if (request.repository.expectedIdentity
    && request.repository.expectedIdentity !== described.repository.identity) {
    return fail('repository-identity', 'repository-identity-mismatch', [{
      expected: request.repository.expectedIdentity,
      actual: described.repository.identity,
    }]);
  }

  if (request.configuration?.expectedIdentity
    && request.configuration.expectedIdentity !== described.configuration.identity) {
    return fail('repository-identity', 'configuration-identity-mismatch', [{
      expected: request.configuration.expectedIdentity,
      actual: described.configuration.identity,
    }]);
  }

  // A resumed transaction must be the same transaction. Every identity is
  // checked here, before consent is even read and long before anything on the
  // machine changes, so a resumption that no longer applies writes nothing
  // (FR-LIFE-016, SG-HOOK-001).
  const resume = request.resume ?? null;
  const selectedAdapters = adapterIdentity(described.adapters);

  if (resume) {
    if (resume.repositoryIdentity !== described.repository.identity) {
      return fail('repository-identity', 'resume-repository-mismatch', [{
        expected: resume.repositoryIdentity ?? null,
        actual: described.repository.identity,
      }]);
    }

    if (resume.configurationIdentity !== described.configuration.identity) {
      return fail('repository-identity', 'resume-configuration-mismatch', [{
        expected: resume.configurationIdentity ?? null,
        actual: described.configuration.identity,
      }]);
    }

    if (resume.adapterIdentity !== selectedAdapters) {
      return fail('repository-identity', 'resume-adapter-mismatch', [{
        expected: resume.adapterIdentity ?? null,
        actual: selectedAdapters,
      }]);
    }
  }

  // 2. Preview: the transaction restates exactly what it is about to do.
  order.push('preview');

  const preview = await previewActivation(request, dependencies);
  const transactionId = activationTransactionIdentity({
    repositoryIdentity: described.repository.identity,
    configurationIdentity: described.configuration.identity,
    adapterIdentity: selectedAdapters,
    previewId: preview.previewId,
  });

  if (resume) {
    if (resume.previewId !== preview.previewId) {
      return fail('preview', 'resume-preview-mismatch', [{
        expected: resume.previewId ?? null,
        actual: preview.previewId,
      }]);
    }

    if (resume.transactionId !== transactionId) {
      return fail('preview', 'resume-transaction-mismatch', [{
        expected: resume.transactionId ?? null,
        actual: transactionId,
      }]);
    }
  }

  // 3. Consent, bound to this repository and this preview. Consent is never
  //    implied by configuration, never reusable, and never for another clone.
  order.push('consent');

  const { consent = null } = request;

  if (!consent) {
    return fail('consent', 'consent-missing', []);
  }

  if (consent.previewId !== preview.previewId) {
    return fail('consent', 'consent-preview-mismatch', [{
      expected: preview.previewId,
      actual: consent.previewId ?? null,
    }]);
  }

  if (consent.repositoryIdentity !== described.repository.identity
    || consent.configurationIdentity !== described.configuration.identity) {
    return fail('consent', 'consent-identity-mismatch', [{
      repository: described.repository.identity,
      configuration: described.configuration.identity,
    }]);
  }

  // 4. Runner resolution: every logical runner becomes one platform executable
  //    whose identity and version are pinned, or the transaction stops.
  order.push('runner-resolution');

  if (described.runners.unresolved.length > 0) {
    return fail('runner-resolution', 'runner-unresolved', described.runners.unresolved);
  }

  // 5. Trust: client-controlled, never granted on the operator's behalf.
  order.push('trust');

  const trust = await establishTrust({ client: request.client, repository: described.repository });

  // The client may need the operator to answer a trust prompt first. That is a
  // pause, not a refusal: the transaction states the identities it may be
  // resumed against and leaves the clone exactly as it found it.
  if (trust?.established !== true && trust?.pending === true) {
    return suspend('trust', 'trust-pending', [{ reason: trust.reason ?? null }], {
      transactionId,
      previewId: preview.previewId,
      repositoryIdentity: described.repository.identity,
      configurationIdentity: described.configuration.identity,
      adapterIdentity: selectedAdapters,
      client: request.client?.id ?? null,
      pausedAt: clock().toISOString(),
    });
  }

  if (!trust?.established) {
    return fail('trust', 'trust-not-established', [trust ?? null]);
  }

  journal.push({
    name: 'trust',
    undo: async () => {
      if (revokeTrust) {
        await revokeTrust({ client: request.client, repository: described.repository, trust });
      }
    },
  });

  // 6. Hook chain validation: the existing chain decides whether activation may
  //    proceed at all. Nothing here rewrites, relocates, or takes over a hook.
  order.push('hook-chain-validation');

  if (described.hook.reasonCode !== null) {
    return fail('hook-chain-validation', described.hook.reasonCode, described.hook.errors);
  }

  // 7. Self-test: the evaluation process and every selected adapter.
  order.push('self-test');

  const evaluationSelfTest = await selfTestEvaluation({
    repository: described.repository,
    checks: request.checks ?? [],
  });
  const selfTests = [{
    name: 'evaluation-process',
    ok: evaluationSelfTest?.ok === true,
    detail: evaluationSelfTest?.detail ?? null,
  }];
  if (!selfTests[0].ok) {
    return fail('self-test', 'self-test-failed', [selfTests[0]]);
  }

  const adapters = [];

  // An adapter becomes active only after it has proved itself, and the set is
  // all-or-nothing: the first failure unwinds every adapter already registered,
  // so a clone is never left half-integrated (SG-HOOK-001).
  for (const adapter of described.adapters) {
    const result = await selfTestAdapter(adapter, { repository: described.repository });
    const selfTest = { ok: result?.ok === true, detail: result?.detail ?? null };

    selfTests.push({ name: `adapter:${adapter.id}`, ...selfTest });

    if (!selfTest.ok) {
      return fail('self-test', 'adapter-self-test-failed', [{ adapter: adapter.id, ...selfTest }]);
    }

    adapters.push({ ...adapter, selfTest });

    if (registerAdapter) {
      await registerAdapter(adapter, { repository: described.repository });

      journal.push({
        name: `adapter:${adapter.id}`,
        undo: async () => {
          if (unregisterAdapter) {
            await unregisterAdapter(adapter, { repository: described.repository });
          }
        },
      });
    }
  }

  // 8. Receipt: everything the activation is pinned to, published atomically.
  order.push('receipt');

  const body = {
    receiptVersion: ACTIVATION_RECEIPT_VERSION,
    activatedAt: clock().toISOString(),
    previewId: preview.previewId,
    repository: described.repository,
    configuration: described.configuration,
    runtime: {
      gate: {
        id: request.gate?.id ?? null,
        version: request.gate?.version ?? null,
        protocolVersion: request.gate?.protocolVersion ?? null,
      },
      runnerVersion: request.runtime?.runnerVersion ?? null,
      runners: described.runners.resolved.map((entry) => ({
        check_id: entry.check_id,
        role: entry.role,
        runner: entry.runner,
        executable: entry.executable,
        version: entry.version,
      })),
    },
    adapters,
    hooks: described.hooks.map((hook) => ({
      hook: hook.hook,
      path: hook.path,
      ownership: hook.ownership,
    })),
    // Which strategy the declared order selected, and what chain it composed
    // with. `priorIdentity` is the pre-existing hook this activation promised to
    // preserve; rollback and later drift checks compare against it.
    hookChain: {
      strategy: described.hook.strategy,
      manager: described.hook.manager?.id ?? null,
      path: described.hook.path,
      priorIdentity: described.hook.priorIdentity,
    },
    trust: {
      client: request.client?.id ?? null,
      established: true,
      grantedBy: trust.grantedBy ?? null,
      at: trust.at ?? null,
    },
    runtimeInputs: described.runtimeInputs,
    selfTests,
  };
  const receipt = { ...body, receiptId: contentIdentity(body) };

  if (evidenceStore) {
    try {
      await evidenceStore.activationReceipt().write(receipt);
    } catch (error) {
      return fail('receipt', 'receipt-write-failed', [{ message: error.message }]);
    }

    journal.push({
      name: 'receipt',
      undo: () => evidenceStore.activationReceipt().remove(),
    });
  }

  // 9. Authoritative Git, last.
  order.push('git-enablement');

  let registration = null;

  // The strategy the declared order selected decides how Git is enabled: a
  // composed block into a hook that already exists, or a whole owned file where
  // there is none — never both, and never a replacement.
  const composing = described.hook.strategy === 'marker-delimited-block';
  const target = {
    hook: AUTHORITATIVE_HOOK,
    path: described.hook.path,
    directory: described.hook.directory,
    repositoryRoot: request.repository.root,
    program: request.runtime?.hookProgram ?? null,
    receipt,
  };

  try {
    registration = composing
      ? await composeHook({ ...target, existing: described.hook.existing })
      : await registerHook(target);
  } catch (error) {
    return fail('git-enablement', 'hook-registration-failed', [{ message: error.message }]);
  }

  journal.push({
    name: 'git-enablement',
    undo: () => (composing ? decomposeHook : unregisterHook)({
      path: described.hook.path,
      directory: described.hook.directory,
      ...(registration ?? {}),
    }),
  });

  const result = {
    activated: true,
    state: 'activated',
    step: 'git-enablement',
    reasonCode: null,
    errors: [],
    receipt,
    order,
    rollback: { performed: false, actions: [], failures: [] },
    resumption: null,
  };

  // An activation nobody can audit is not an activation. If the transition
  // cannot be recorded, authoritative Git is withdrawn again (NFR-AUD-001).
  try {
    await record(result);
  } catch (error) {
    return fail('git-enablement', 'activation-record-failed', [{ message: error.message }]);
  }

  return result;
};
