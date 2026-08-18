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

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { registerAdapterSurface, withdrawAdapterRegistration } from './adapter-registration.mjs';
import { createRunnerResolver, resolveExecutables } from './command-descriptor.mjs';
import { contentIdentity, resolveGitCommonDirectory } from './evidence-store.mjs';
import { validateGatePolicy } from './policy.mjs';

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

/** The line by which a gate-owned registration names the activation that wrote it. */
export const HOOK_RECEIPT_PREFIX = '# activation-receipt: ';

/**
 * The stand-in for the receipt id inside a normalized registration.
 *
 * A gate-owned registration names the receipt that authorized it, and the
 * receipt names the registration it authorized — a cycle no hash can close. It
 * is broken by hashing the registration with exactly that one self-referential
 * value replaced by a constant. What remains is a *receipt-independent* content
 * identity: it can be computed before the receipt exists, pinned inside it, and
 * recomputed from the file on disk at any later time.
 *
 * The elided value is not lost. It is the receipt's own `receiptId`, so a
 * reader compares the literal line against the receipt it came from. The two
 * checks together cover every byte of the registration with no circularity.
 */
export const HOOK_RECEIPT_PLACEHOLDER = '<activation-receipt>';

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
  `${HOOK_RECEIPT_PREFIX}${receipt.receiptId}`,
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
  `${HOOK_RECEIPT_PREFIX}${receipt.receiptId}`,
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

/**
 * Rewrite the one self-referential line so a registration can be hashed.
 *
 * Everything else is preserved byte for byte, so any edit anywhere else in the
 * registration changes the resulting identity.
 */
export const normalizeHookRegistration = (contents) => (contents ?? '')
  .split('\n')
  .map((line) => (line.startsWith(HOOK_RECEIPT_PREFIX)
    ? `${HOOK_RECEIPT_PREFIX}${HOOK_RECEIPT_PLACEHOLDER}`
    : line))
  .join('\n');

/**
 * The durable, receipt-independent content identity of a gate-owned
 * registration (FR-LIFE-009, FR-LIFE-019).
 */
export const hookBlockIdentity = (contents) => contentIdentity(
  normalizeHookRegistration(contents),
);

/** The receipt id a gate-owned registration names, if it still names one. */
export const hookRegistrationReceiptId = (contents) => {
  const line = (contents ?? '')
    .split('\n')
    .find((candidate) => candidate.startsWith(HOOK_RECEIPT_PREFIX));

  return line === undefined ? null : line.slice(HOOK_RECEIPT_PREFIX.length).trim();
};

/**
 * The exact bytes a given strategy would register, with the receipt id elided.
 *
 * This is what makes the identity pinnable: the contents depend only on the
 * strategy, the pinned hook program, and the clone root — never on the receipt
 * that is about to name them — so the receipt can carry the identity of the
 * registration it authorizes.
 */
export const plannedHookRegistration = ({ strategy, hook, program, repositoryRoot }) => {
  const receipt = { receiptId: HOOK_RECEIPT_PLACEHOLDER };

  if (strategy === 'marker-delimited-block') {
    return managedBlockContents({ program, receipt, repositoryRoot });
  }

  return shimContents({
    hook,
    program: { ...program, script: path.resolve(repositoryRoot, program.script) },
    receipt,
  });
};

/**
 * Read back a gate-owned registration from disk, without judging it.
 *
 * A composed block is exactly the delimited region; an owned shim is the whole
 * file, because the gate wrote all of it. The caller compares what is returned
 * against what its receipt pinned; nothing here repairs, rewrites, or removes.
 */
export const readHookRegistration = async (hookPath, ownership = 'gate-owned-shim') => {
  const contents = await readFile(hookPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (contents === null) {
    return { present: false, region: null, blockIdentity: null, receiptId: null, wellFormed: true };
  }

  if (ownership !== 'marker-delimited-block') {
    return {
      present: true,
      region: contents,
      blockIdentity: hookBlockIdentity(contents),
      receiptId: hookRegistrationReceiptId(contents),
      wellFormed: true,
    };
  }

  const found = managedBlockIn(contents);

  if (!found.present || !found.wellFormed) {
    return {
      present: found.present,
      region: null,
      blockIdentity: null,
      receiptId: null,
      wellFormed: found.wellFormed,
    };
  }

  return {
    present: true,
    region: found.block,
    blockIdentity: hookBlockIdentity(found.block),
    receiptId: hookRegistrationReceiptId(found.block),
    wellFormed: true,
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
 * The environment variable that names the self-test subject.
 *
 * A hook program that finds it set is being proved, not run against somebody's
 * work: it must evaluate the named subject rather than the working tree it was
 * started in, and exit non-zero when the subject must be denied.
 */
export const HOOK_PROGRAM_SELF_TEST_ENV = 'CHANGE_EVALUATION_GATE_SELF_TEST';

/** The versioned on-disk shape of a hook-program self-test subject. */
export const HOOK_PROGRAM_SELF_TEST_SUBJECT_VERSION = 'change-evaluation-gate/self-test-subject/v1';

/** How long the registered hook program is given to reach its decision. */
const HOOK_PROGRAM_SELF_TEST_TIMEOUT_MS = 30_000;

/** Run one program to completion, reporting whether it started at all. */
const runProgram = ({ interpreter, argv, cwd, env, timeoutMs }) => new Promise((resolve) => {
  const child = spawn(interpreter, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  let settled = false;

  const settle = (outcome) => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timer);
    resolve(outcome);
  };

  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    settle({ started: true, exitCode: null, signal: 'SIGKILL', stdout, stderr, error: 'timed out' });
  }, timeoutMs);

  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', (error) => settle({
    started: false, exitCode: null, signal: null, stdout, stderr, error: error.message,
  }));
  child.on('close', (exitCode, signal) => settle({
    started: true, exitCode, signal, stdout, stderr, error: null,
  }));
});

/**
 * Prove that the program about to be registered actually denies.
 *
 * The one artifact activation never used to execute is the program it writes
 * into `pre-commit`. Presence of an interpreter and a script proves nothing: a
 * program pointed at a pure library prints nothing and exits `0`, so the
 * installed hook would allow every commit while activation reported a healthy
 * activated clone (FR-LIFE-004, NFR-REL-003).
 *
 * So the program is run against a throwaway subject that must be denied — never
 * the maintainer's own work, and nothing is left behind — and it must exit
 * non-zero. A program that cannot start, that is killed before it decides, or
 * that allows the subject is unproved and refused. Repairing it is not this
 * transaction's business.
 */
export const selfTestHookProgramDenial = async ({
  program,
  repositoryRoot,
  timeoutMs = HOOK_PROGRAM_SELF_TEST_TIMEOUT_MS,
}) => {
  if (!program?.interpreter || !program?.script) {
    return { ok: false, reason: 'hook-program-missing', detail: 'Activation has no hook program to prove.' };
  }

  const subjectRoot = await mkdtemp(path.join(tmpdir(), 'gate-hook-program-self-test-'));
  const subjectPath = path.join(subjectRoot, 'subject.json');
  const selfTestId = randomUUID();

  try {
    await writeFile(subjectPath, `${JSON.stringify({
      subjectVersion: HOOK_PROGRAM_SELF_TEST_SUBJECT_VERSION,
      selfTestId,
      // What the program is being asked to prove, stated in the subject itself
      // so no program has to guess why it was started.
      expect: 'denied',
      change: { kind: 'self-test', root: subjectRoot },
      checks: [{
        id: 'hook-program-self-test',
        required: true,
        outcome: 'failed',
        detail: 'A required check that fails; a program that enforces must deny this change.',
      }],
    }, null, 2)}\n`, 'utf8');

    const outcome = await runProgram({
      interpreter: program.interpreter,
      argv: [path.resolve(repositoryRoot, program.script), ...(program.args ?? [])],
      cwd: subjectRoot,
      env: { ...process.env, [HOOK_PROGRAM_SELF_TEST_ENV]: subjectPath },
      timeoutMs,
    });

    // A program that never ran has proved nothing. Its non-zero result is the
    // shell failing to start it, not the gate denying anything.
    if (!outcome.started) {
      return {
        ok: false,
        reason: 'hook-program-cannot-start',
        detail: `The registered hook program could not be started: ${outcome.error}.`,
      };
    }

    if (outcome.exitCode === null) {
      return {
        ok: false,
        reason: 'hook-program-unproved',
        detail: `The registered hook program never reached a decision (${outcome.error ?? outcome.signal}).`,
      };
    }

    if (outcome.exitCode === 0) {
      return {
        ok: false,
        reason: 'hook-program-allowed-denied-change',
        detail: 'The registered hook program exited 0 for a change it had to deny; it enforces nothing.',
        exitCode: 0,
      };
    }

    return {
      ok: true,
      reason: null,
      detail: `The registered hook program denied the self-test subject with exit ${outcome.exitCode}.`,
      exitCode: outcome.exitCode,
    };
  } finally {
    await rm(subjectRoot, { recursive: true, force: true });
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

/**
 * Withdraw a gate-owned registration using only what a receipt durably pins.
 *
 * Rollback inside a transaction can bind to its in-flight journal. Removal
 * cannot: `gate deactivate` runs in a later process, possibly on a later day,
 * and has nothing but the published receipt. It therefore proves ownership from
 * the durable identities instead — the registration's own content identity and
 * the receipt id it names — and, for a composed block, that removing it really
 * does reproduce the chain the activation promised to preserve.
 *
 * Every mismatch is reported, never repaired and never forced. `dryRun` answers
 * the same question without touching the file, so a caller can prove every
 * registration is safe to remove before it removes the first one (FR-LIFE-010,
 * SG-HOOK-001, SG-LIFE-001).
 */
export const withdrawHookRegistration = async ({
  path: hookPath,
  directory = null,
  ownership = 'gate-owned-shim',
  blockIdentity = null,
  receiptId = null,
  // Every receipt id this clone has issued for this activation, newest first.
  // An update rewrites the receipt but not the registration, so the block goes
  // on naming the receipt that authorized it; all of them are ours.
  acceptedReceiptIds = null,
  priorIdentity = null,
  dryRun = false,
}) => {
  const refuse = (reason) => ({ removable: false, removed: false, reason });
  const accepted = acceptedReceiptIds === null
    ? (receiptId === null ? [] : [receiptId])
    : acceptedReceiptIds.filter((id) => typeof id === 'string' && id.length > 0);

  const contents = await readFile(hookPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (contents === null) {
    return refuse('already-absent');
  }

  const registration = await readHookRegistration(hookPath, ownership);

  if (!registration.present) {
    return refuse('registration-absent');
  }

  if (!registration.wellFormed) {
    return refuse('registration-malformed');
  }

  // Ownership is proved by the pinned block identity when the receipt has one.
  // A receipt written before that field existed pins nothing, so the marker the
  // gate wrote into the block — one of our own receipt ids — is the proof
  // instead. Without either, nothing shows the gate wrote this file.
  const namesOurReceipt = accepted.length > 0 && accepted.includes(registration.receiptId);

  if (blockIdentity === null) {
    if (!namesOurReceipt) {
      return refuse('unknown-registration');
    }
  } else if (registration.blockIdentity !== blockIdentity) {
    return refuse('registration-drifted');
  } else if (accepted.length > 0 && !namesOurReceipt) {
    return refuse('receipt-mismatch');
  }

  const composed = ownership === 'marker-delimited-block';
  let restored = null;

  if (composed) {
    const found = managedBlockIn(contents);

    restored = contents.slice(0, found.begin)
      + contents.slice(found.end + HOOK_BLOCK_END.length + 1);

    if (priorIdentity !== null && contentIdentity(restored) !== priorIdentity) {
      // Removing the block would not give back the hook that was there. The
      // surrounding chain is somebody else's, so it stays exactly as it is.
      return refuse('chain-not-restorable');
    }
  }

  if (dryRun) {
    return { removable: true, removed: false, reason: null };
  }

  if (composed) {
    await publishHook({
      path: hookPath,
      directory: directory ?? path.dirname(hookPath),
      contents: restored,
      mode: (await stat(hookPath)).mode & 0o777,
    });
  } else {
    await rm(hookPath, { force: true });
  }

  return { removable: true, removed: true, reason: null };
};

/**
 * Restore a gate-owned registration to exactly what the receipt authorizes.
 *
 * This is the *only* write that recovers from drift, and it is reached only by
 * an explicit, confirmed `gate repair` — never by status and never by an
 * ordinary update (FR-LIFE-019).
 *
 * It refuses unless the registration it is about to write reproduces the
 * durable identity the receipt pinned, and — for a composed block — unless the
 * surrounding chain is still the chain the activation promised to preserve. A
 * repair that would take over somebody else's hook is not a repair
 * (SG-HOOK-001, SG-LIFE-001).
 */
export const restoreHookRegistration = async ({
  path: hookPath,
  directory = null,
  hook = AUTHORITATIVE_HOOK,
  ownership = 'gate-owned-shim',
  program = null,
  repositoryRoot = null,
  receiptId = null,
  blockIdentity = null,
  priorIdentity = null,
  dryRun = false,
}) => {
  const refuse = (reason) => ({ restorable: false, restored: false, reason });

  if (blockIdentity === null || receiptId === null) {
    return refuse('unknown-registration');
  }

  let planned = null;

  try {
    planned = plannedHookRegistration({ strategy: ownership, hook, program, repositoryRoot });
  } catch (error) {
    return refuse('program-unquotable');
  }

  // The registration this repair would write must be the registration the
  // receipt authorized. Anything else is a new activation, not a repair.
  if (hookBlockIdentity(planned) !== blockIdentity) {
    return refuse('registration-not-reproducible');
  }

  const authorized = planned.split(HOOK_RECEIPT_PLACEHOLDER).join(receiptId);
  const composed = ownership === 'marker-delimited-block';
  const contents = await readFile(hookPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (!composed) {
    if (dryRun) {
      return { restorable: true, restored: false, reason: null };
    }

    await publishHook({
      path: hookPath,
      directory: directory ?? path.dirname(hookPath),
      contents: authorized,
      mode: 0o755,
    });

    return { restorable: true, restored: true, reason: null };
  }

  if (contents === null) {
    // There is no chain left to compose into, and inventing one would create a
    // hook this repair cannot claim to have preserved.
    return refuse('chain-absent');
  }

  const found = managedBlockIn(contents);

  if (found.present && !found.wellFormed) {
    return refuse('registration-malformed');
  }

  const chain = found.present
    ? contents.slice(0, found.begin) + contents.slice(found.end + HOOK_BLOCK_END.length + 1)
    : contents;

  if (priorIdentity !== null && contentIdentity(chain) !== priorIdentity) {
    return refuse('chain-not-restorable');
  }

  if (dryRun) {
    return { restorable: true, restored: false, reason: null };
  }

  await publishHook({
    path: hookPath,
    directory: directory ?? path.dirname(hookPath),
    contents: composeManagedBlock(chain, authorized),
    mode: (await stat(hookPath)).mode & 0o777,
  });

  return { restorable: true, restored: true, reason: null };
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
  const {
    runGit,
    environment = process.env,
    detectHookManager: detect = detectHookManager,
    // Activation is where resolution happens, and the shared rule is the only
    // rule: an integrator that supplied its own resolver is how activation came
    // to pin one program while the hook ran another (`SG-OWNER-001`).
    resolveExecutable = createRunnerResolver({
      repositoryRoot: request.repository.root,
      environment,
    }),
  } = dependencies;
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
  const policyIssues = validateGatePolicy(request.configuration?.policy);

  if (policyIssues.length > 0) {
    throw new Error(policyIssues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join(' '));
  }

  const described = await describeActivation(request, dependencies);
  const body = {
    repository: described.repository,
    configuration: described.configuration,
    hooksPath: described.hooksPath,
    hookManager: described.hookManager,
    hooks: described.hooks,
    commands: described.commands,
    // What the checks will be given besides the snapshot itself. Consent is
    // granted against this preview, so a maintainer sees which installed
    // directories their own tools will reach (TB-030, FR-LIFE-004).
    dependencyRoots: [...(request.configuration?.policy?.execution?.dependency_roots ?? [])],
    unresolved: described.runners.unresolved,
    adapters: described.adapters,
    runtimeInputs: described.runtimeInputs,
    trust: { client: request.client?.id ?? null, required: true },
    scope: request.scope ?? 'repository',
  };

  return { ...body, previewId: contentIdentity(body) };
};

/**
 * Register one selected adapter in the surface that adapter declares.
 *
 * This is the whole of activation's knowledge of desktop registration: which
 * clone it is in and which command it should run. Which file, which container,
 * which block schema, which event-key casing, and whether the format carries
 * its own version all come from the adapter's declaration (FR-ADAPT-008).
 */
const registerDeclaredSurface = async (adapter, { repository, command }) => registerAdapterSurface({
  adapterId: adapter.id,
  repositoryRoot: repository.root,
  command,
});

/**
 * Withdraw one registration this transaction wrote — and only that.
 *
 * The compensating action is the mirror of the registration: it takes back the
 * one entry the transaction added, when that entry is still exactly what was
 * written, and leaves every other byte of the client's file alone.
 */
const withdrawDeclaredSurface = async (adapter, { repository, registration }) => (
  withdrawAdapterRegistration({
    adapterId: adapter.id,
    repositoryRoot: repository.root,
    registration,
  })
);

/**
 * What a receipt pins about one adapter registration.
 *
 * Only a registration in a client-owned configuration file is pinned here. An
 * adapter that registers through this clone's own hook chain is already pinned
 * by the receipt's `hookChain`, and an injected fixture seam that returns
 * something else pins nothing at all rather than a guess at its meaning.
 */
const pinnedRegistration = (result) => (
  result?.kind === 'client-configuration-file'
    ? {
      kind: result.kind,
      path: result.path ?? null,
      eventKey: result.eventKey ?? null,
      blockSchema: result.blockSchema ?? null,
      command: result.command ?? null,
      entryIdentity: result.entryIdentity ?? null,
      // What the registration had to add around its own entry, so a later
      // removal returns the client's file to the shape its owner wrote.
      created: result.created ?? null,
      registered: result.registered === true,
      confirmed: result.confirmed === true,
      // A surface the transaction could not confirm is pinned as `unverified`,
      // so the receipt records what the clone actually has rather than what was
      // selected (FR-ADAPT-008, AC-ADAPT-003).
      state: result.registered === true ? 'registered' : 'unverified',
      reason: result.reason ?? null,
    }
    : null
);

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
    // The registered hook program is runtime, and FR-LIFE-004 requires runtime
    // to be self-tested before Git is enabled. The default really executes it.
    selfTestHookProgram = selfTestHookProgramDenial,
    // Desktop adapter registration goes through the adapter's own declared
    // surface. The seam stays injectable so a fixture can fail it on purpose,
    // but the default is the real declaration-driven write: activation carries
    // no knowledge of any client (FR-ADAPT-008, SG-OWNER-001).
    registerAdapter = registerDeclaredSurface,
    unregisterAdapter = withdrawDeclaredSurface,
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

  // The runtime the authoritative hook will exec, proved against a change it
  // must deny. A program that cannot be proved to deny is refused here, before
  // any receipt exists and long before Git is enabled (NFR-REL-003).
  const hookProgramSelfTest = await selfTestHookProgram({
    program: request.runtime?.hookProgram ?? null,
    repositoryRoot: request.repository.root,
  });

  if (hookProgramSelfTest?.ok !== true) {
    return fail('self-test', 'hook-program-self-test-failed', [{
      name: 'hook-program',
      ok: false,
      reason: hookProgramSelfTest?.reason ?? null,
      detail: hookProgramSelfTest?.detail ?? null,
    }]);
  }

  selfTests.push({
    name: 'hook-program',
    ok: true,
    detail: hookProgramSelfTest.detail ?? null,
  });

  const adapters = [];
  /**
   * The command one desktop surface would run.
   *
   * Desktop registration points at the packaged preflight program when the
   * pinned hook program is `gate-precommit.mjs`, and at the fixture program
   * otherwise. Every command names the adapter it is answering so an
   * unreadable payload can still be returned through that adapter's declared
   * feedback channel. A program the gate cannot safely quote yields no
   * command, and a registration without one refuses rather than inventing one.
   */
  const quotedDesktopCommand = (adapterId) => {
    const hookProgram = request.runtime?.hookProgram ?? null;
    const preflightProgram = request.runtime?.preflightProgram ?? (
      hookProgram !== null && path.basename(hookProgram.script ?? '') === 'gate-precommit.mjs'
        ? {
          ...hookProgram,
          script: path.join(path.dirname(hookProgram.script), 'gate-preflight.mjs'),
        }
        : hookProgram
    );

    return quotedProgram({
      program: {
        ...preflightProgram,
        args: [...(preflightProgram?.args ?? []), '--adapter', adapterId],
      },
      repositoryRoot: request.repository.root,
    });
  };

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

    if (!registerAdapter) {
      adapters.push({ ...adapter, selfTest });

      continue;
    }

    let command = null;

    try {
      command = quotedDesktopCommand(adapter.id);
    } catch {
      command = null;
    }

    const registration = await registerAdapter(adapter, {
      repository: described.repository,
      command,
    });
    const pinned = pinnedRegistration(registration);

    adapters.push({ ...adapter, selfTest, ...(pinned === null ? {} : { registration: pinned }) });

    // An adapter that registers nothing has nothing to compensate. Journalling
    // it anyway would claim a rollback action that never had anything to undo.
    if (registration !== null && (pinned === null || pinned.registered === true)) {
      journal.push({
        name: `adapter:${adapter.id}`,
        undo: async () => {
          if (unregisterAdapter) {
            await unregisterAdapter(adapter, { repository: described.repository, registration: pinned });
          }
        },
      });
    }
  }

  // 8. Receipt: everything the activation is pinned to, published atomically.
  order.push('receipt');

  // The exact registration this transaction is about to write, with its own
  // receipt-id line elided so its identity can be pinned by the receipt that
  // will name it. A program the gate cannot safely quote has no plannable
  // registration; `git-enablement` refuses it a moment later, on its own terms.
  let plannedRegistration = null;

  try {
    plannedRegistration = plannedHookRegistration({
      strategy: described.hook.strategy,
      hook: AUTHORITATIVE_HOOK,
      program: request.runtime?.hookProgram ?? null,
      repositoryRoot: request.repository.root,
    });
  } catch {
    plannedRegistration = null;
  }

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
        // An executable that is a script needs its interpreter found before it
        // can start, so what activation proved includes where that interpreter
        // was, and the hook runs against the same one (TB-028).
        interpreter: entry.interpreter ?? null,
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
    //
    // `blockIdentity` is the durable identity of the gate-owned registration
    // itself, hashed with its own receipt-id line elided so it can be computed
    // here — before the receipt that will name it exists — and recomputed from
    // disk at any later time. It is what lets `gate status` and `gate repair`
    // detect tampering without depending on an in-flight journal.
    hookChain: {
      strategy: described.hook.strategy,
      manager: described.hook.manager?.id ?? null,
      path: described.hook.path,
      priorIdentity: described.hook.priorIdentity,
      blockIdentity: plannedRegistration === null ? null : hookBlockIdentity(plannedRegistration),
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
