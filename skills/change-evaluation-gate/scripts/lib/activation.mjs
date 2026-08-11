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

const refusal = (step, reasonCode, errors = []) => ({
  activated: false,
  state: 'configured',
  step,
  reasonCode,
  errors,
  receipt: null,
  order: [],
  rollback: { performed: false, actions: [], failures: [] },
});

/** Describe one already-registered hook without interpreting or changing it. */
const existingHook = async (hookPath) => {
  const stats = await stat(hookPath).catch(() => null);

  if (stats === null) {
    return null;
  }

  const contents = await readFile(hookPath).catch(() => Buffer.alloc(0));

  return { path: hookPath, bytes: stats.size, identity: contentIdentity(contents.toString('utf8')) };
};

/**
 * The gate-owned `pre-commit` shim.
 *
 * It is deliberately trivial and clearly marked: it hands control to the pinned
 * runtime and does nothing else, so a maintainer reading their hook directory
 * can see at a glance what owns the file and what it runs.
 */
const shimContents = ({ hook, program, receipt }) => {
  const argv = [program.interpreter, program.script, ...(program.args ?? [])];

  for (const value of argv) {
    if (typeof value !== 'string' || /["\\\n\r]/.test(value)) {
      throw new Error(`A hook program argument is not safely quotable: ${JSON.stringify(value)}.`);
    }
  }

  return [
    '#!/bin/sh',
    `# change-evaluation-gate: owned ${hook} shim. Managed by the Gate; do not edit.`,
    `# activation-receipt: ${receipt.receiptId}`,
    `exec ${argv.map((value) => `"${value}"`).join(' ')} "$@"`,
    '',
  ].join('\n');
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
  const staged = path.join(directory, `.${hook}.${randomUUID()}.part`);

  await mkdir(directory, { recursive: true });
  await writeFile(staged, contents, { mode: 0o755 });

  try {
    await rename(staged, hookPath);
  } catch (error) {
    await rm(staged, { force: true });

    throw error;
  }

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

/** Resolve the identities, locations, and commands one activation would use. */
const describeActivation = async (request, dependencies) => {
  const { runGit, resolveExecutable } = dependencies;
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
  const hookPath = path.join(hooksDirectory, AUTHORITATIVE_HOOK);
  const existing = hooksPath.shared ? null : await existingHook(hookPath);
  const action = hooksPath.shared
    ? 'refuse-shared-hooks-path'
    : (existing === null ? 'create-owned-shim' : 'refuse-existing-hook');

  return {
    gitCommonDirectory,
    hooksPath,
    hooksDirectory,
    hookPath,
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
      ownership: 'gate-owned-shim',
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
    evidenceStore = null,
    clock = () => new Date(),
  } = dependencies;

  // Compensating actions, unwound last-in-first-out.
  const journal = [];
  const order = [];

  const record = async (result) => {
    if (evidenceStore) {
      await evidenceStore.appendLifecycleEvent({
        type: 'activation',
        before: result.receipt?.previewId ?? null,
        after: result.receipt?.receiptId ?? null,
        outcome: result.activated ? 'succeeded' : 'failed',
        reason: result.activated
          ? `Activation completed through ${result.step}; authoritative Git was enabled last.`
          : `Activation failed at ${result.step} (${result.reasonCode}); every gate-owned change was rolled back and the clone remains configured.`,
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

  // 2. Preview: the transaction restates exactly what it is about to do.
  order.push('preview');

  const preview = await previewActivation(request, dependencies);

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

  if (described.hooksPath.shared) {
    return fail('hook-chain-validation', 'hooks-path-shared', [described.hooksPath]);
  }

  if (described.hooks[0].existing !== null) {
    return fail('hook-chain-validation', 'hook-exists', [described.hooks[0].existing]);
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

  try {
    registration = await registerHook({
      hook: AUTHORITATIVE_HOOK,
      path: described.hookPath,
      directory: described.hooksDirectory,
      repositoryRoot: request.repository.root,
      program: request.runtime?.hookProgram ?? null,
      receipt,
    });
  } catch (error) {
    return fail('git-enablement', 'hook-registration-failed', [{ message: error.message }]);
  }

  journal.push({
    name: 'git-enablement',
    undo: () => unregisterHook({ path: described.hookPath, ...(registration ?? {}) }),
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
