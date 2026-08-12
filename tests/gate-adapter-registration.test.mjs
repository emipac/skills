/**
 * TB-016 — declared desktop adapter registration surfaces.
 *
 * `FR-ADAPT-008`, `AC-ADAPT-003`, `SG-HOOK-001`, `SG-LIFE-001`, `SG-OWNER-001`.
 *
 * Every fixture here writes a REAL client configuration file into a throwaway
 * directory under the OS temporary directory. No desktop client is required,
 * installed, or executed: the observed reality this suite encodes came from
 * captured client evidence and is replayed as fixture files.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { describeAdapter } from '../skills/change-evaluation-gate/scripts/lib/adapters.mjs';
import {
  registerAdapterSurface,
  withdrawAdapterRegistration,
} from '../skills/change-evaluation-gate/scripts/lib/adapter-registration.mjs';
import { deactivateGate, statusGate } from '../skills/change-evaluation-gate/scripts/lib/lifecycle.mjs';

/**
 * This suite writes into throwaway workspaces. An escaped fixture would write a
 * client hook registration into the framework clone itself, so every root is
 * proved to be under the OS temporary directory and outside this repository
 * before anything is written.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

const assertThrowawayWorkspace = async (root) => {
  const resolved = await realpath(root).catch(() => path.resolve(root));
  const temporaryRoot = await realpath(tmpdir());
  const frameworkRoot = await realpath(FRAMEWORK_ROOT).catch(() => FRAMEWORK_ROOT);

  assert.equal(
    isInside(temporaryRoot, resolved),
    true,
    `Refusing to run a registration fixture outside the OS temporary directory: ${resolved}.`,
  );
  assert.equal(
    isInside(frameworkRoot, resolved),
    false,
    `Refusing to run a registration fixture inside this repository: ${resolved}.`,
  );

  return resolved;
};

const workspace = async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-adapter-registration-')));

  t.after(() => rm(root, { recursive: true, force: true }));

  return assertThrowawayWorkspace(root);
};

const writeJson = async (root, relative, value) => {
  const target = path.join(root, relative);

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

  return target;
};

const readJson = async (root, relative) => JSON.parse(
  await readFile(path.join(root, relative), 'utf8'),
);

const gateCommand = (root) => `"${process.execPath}" "${path.join(root, 'tools/gate-runner.mjs')}"`;

/**
 * The two client configuration files this suite starts from, in the shapes real
 * captures recorded: a GENERAL settings file that holds `permissions` beside its
 * hooks, and a DEDICATED, independently versioned file with a flat block shape.
 * Both already hold a hook entry the Gate does not own.
 */
const seedClientFiles = async (root) => {
  await writeJson(root, '.claude/settings.local.json', {
    permissions: { allow: ['Bash(ls:*)'], deny: [] },
    hooks: {
      Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'somebody-elses-hook' }] }],
    },
  });
  await writeJson(root, '.cursor/hooks.json', {
    version: 1,
    hooks: { stop: [{ command: 'somebody-elses-hook' }] },
  });
};

test('AC-ADAPT-003: two adapters declaring different registration schemas both register through their own declaration', async (t) => {
  const root = await workspace(t);

  await seedClientFiles(root);

  const command = gateCommand(root);
  const first = await registerAdapterSurface({
    adapterId: 'claude-code-desktop',
    repositoryRoot: root,
    command,
  });
  const second = await registerAdapterSurface({
    adapterId: 'cursor',
    repositoryRoot: root,
    command,
  });

  assert.equal(first?.registered, true, 'The general-settings surface did not register.');
  assert.equal(second?.registered, true, 'The dedicated versioned surface did not register.');

  const general = await readJson(root, '.claude/settings.local.json');
  const dedicated = await readJson(root, '.cursor/hooks.json');

  // Each file carries the Gate entry in ITS OWN block schema: a matcher group
  // wrapping a typed inner array on one surface, a flat command on the other.
  assert.deepEqual(
    general.hooks.Stop.at(-1),
    { matcher: '', hooks: [{ type: 'command', command }] },
  );
  assert.deepEqual(dedicated.hooks.stop.at(-1), { command });

  // And under its own event-key casing — the same casing that client's payload
  // uses, never a shared one.
  assert.deepEqual(Object.keys(general.hooks), ['Stop']);
  assert.deepEqual(Object.keys(dedicated.hooks), ['stop']);

  // Survivors: every unrelated key, and every unrelated hook entry.
  assert.deepEqual(general.permissions, { allow: ['Bash(ls:*)'], deny: [] });
  assert.equal(dedicated.version, 1);
  assert.deepEqual(
    general.hooks.Stop[0],
    { matcher: '', hooks: [{ type: 'command', command: 'somebody-elses-hook' }] },
  );
  assert.deepEqual(dedicated.hooks.stop[0], { command: 'somebody-elses-hook' });

  // These are two declarations, not one shared mapping wearing two names.
  const left = describeAdapter('claude-code-desktop').registration;
  const right = describeAdapter('cursor').registration;

  assert.notEqual(left.file, right.file);
  assert.notEqual(left.blockSchema, right.blockSchema);
});

/** A store that holds one receipt in memory. `gate status` only ever reads. */
const storeHolding = (receipt) => ({
  activationReceipt: () => ({ read: async () => receipt }),
});

/** An activated receipt whose adapters were registered in real client files. */
const activatedReceipt = async (root) => {
  const command = gateCommand(root);
  const registrations = [];

  for (const adapterId of ['claude-code-desktop', 'cursor']) {
    registrations.push(await registerAdapterSurface({ adapterId, repositoryRoot: root, command }));
  }

  return {
    receiptId: `sha256:${'b'.repeat(64)}`,
    repository: { root },
    hooks: [],
    hookChain: {},
    adapters: [
      { id: 'git', version: '1.0.0', authoritative: true },
      ...registrations.map((registration, index) => ({
        id: registration.adapterId,
        version: `${index + 2}.0.0`,
        authoritative: false,
        registration: {
          kind: registration.kind,
          path: registration.path,
          eventKey: registration.eventKey,
          blockSchema: registration.blockSchema,
          command: registration.command,
          entryIdentity: registration.entryIdentity,
          registered: true,
          confirmed: true,
          reason: null,
        },
      })),
    ],
  };
};

const snapshotClientFiles = async (root) => JSON.stringify({
  general: await readFile(path.join(root, '.claude/settings.local.json'), 'utf8'),
  dedicated: await readFile(path.join(root, '.cursor/hooks.json'), 'utf8'),
});

test('AC-ADAPT-003: gate status reconciles a registered surface, reports drift, and repairs nothing', async (t) => {
  const root = await workspace(t);

  await seedClientFiles(root);

  const receipt = await activatedReceipt(root);
  const evidenceStore = storeHolding(receipt);
  const observed = [
    { id: 'git', version: '1.0.0', authoritative: true },
    { id: 'claude-code-desktop', version: '2.0.0', authoritative: false },
    { id: 'cursor', version: '3.0.0', authoritative: false },
  ];

  const healthy = await statusGate({ evidenceStore, repositoryRoot: root, adapters: observed });

  assert.equal(healthy.status, 'healthy', JSON.stringify(healthy.findings));
  assert.deepEqual(healthy.findings, []);
  assert.equal(healthy.repaired, false);
  assert.deepEqual(healthy.mutations, []);

  // Somebody edits the Gate's own entry in the general settings file: the
  // command is still there, but the block around it is no longer the block the
  // activation wrote.
  const drifted = JSON.parse(await readFile(path.join(root, '.claude/settings.local.json'), 'utf8'));

  drifted.hooks.Stop.at(-1).matcher = '*';
  await writeFile(
    path.join(root, '.claude/settings.local.json'),
    `${JSON.stringify(drifted, null, 2)}\n`,
    'utf8',
  );

  const before = await snapshotClientFiles(root);
  const degraded = await statusGate({ evidenceStore, repositoryRoot: root, adapters: observed });

  assert.equal(degraded.status, 'degraded');
  assert.deepEqual(
    degraded.findings.map((finding) => [finding.code, finding.adapter, finding.severity]),
    [['adapter-registration-drifted', 'claude-code-desktop', 'supporting']],
  );
  assert.equal(degraded.findings[0].path, path.join(root, '.claude/settings.local.json'));

  // Observation repaired nothing, wrote nothing, and left the drift exactly
  // where it found it — in both files.
  assert.equal(degraded.repaired, false);
  assert.deepEqual(degraded.mutations, []);
  assert.equal(await snapshotClientFiles(root), before);
});

/** A store that can also drop its receipt, which is all deactivation needs. */
const removableStoreHolding = (receipt) => {
  const state = { receipt };

  return {
    paths: { activationReceipt: '/dev/null/activation-receipt.json' },
    activationReceipt: () => ({
      read: async () => state.receipt,
      remove: async () => {
        state.receipt = null;
      },
    }),
    appendLifecycleEvent: async () => null,
    state,
  };
};

test('AC-ADAPT-003: gate deactivate removes only the unchanged Gate entry and preserves every unrelated entry', async (t) => {
  const root = await workspace(t);

  await seedClientFiles(root);

  const pristine = await snapshotClientFiles(root);
  const evidenceStore = removableStoreHolding(await activatedReceipt(root));

  assert.notEqual(await snapshotClientFiles(root), pristine, 'The fixture registered nothing to remove.');

  const result = await deactivateGate({ evidenceStore, repositoryRoot: root });

  assert.equal(result.deactivated, true, `Deactivation refused: ${result.reasonCode}.`);
  assert.deepEqual(
    result.removed.filter((entry) => entry.kind === 'adapter-registration'),
    [
      { kind: 'adapter-registration', adapter: 'claude-code-desktop', path: path.join(root, '.claude/settings.local.json') },
      { kind: 'adapter-registration', adapter: 'cursor', path: path.join(root, '.cursor/hooks.json') },
    ],
  );

  // Survivors: both client files are byte-for-byte what they were before the
  // Gate ever registered — every unrelated key, every unrelated entry, and the
  // client's own format version included.
  assert.equal(await snapshotClientFiles(root), pristine);
  assert.equal(evidenceStore.state.receipt, null);
});

test('SG-LIFE-001: a drifted registration refuses the whole deactivation and nothing is removed', async (t) => {
  const root = await workspace(t);

  await seedClientFiles(root);

  const evidenceStore = removableStoreHolding(await activatedReceipt(root));

  // One of the two registered entries is edited by somebody else: the Gate's
  // command is still named, but the block around it is no longer the block the
  // activation wrote.
  const drifted = await readJson(root, '.claude/settings.local.json');

  drifted.hooks.Stop.at(-1).matcher = '*';
  await writeJson(root, '.claude/settings.local.json', drifted);

  const before = await snapshotClientFiles(root);
  const result = await deactivateGate({ evidenceStore, repositoryRoot: root });

  assert.equal(result.deactivated, false);
  assert.equal(result.reasonCode, 'registration-drifted');
  assert.deepEqual(result.removed, []);

  // Nothing was removed anywhere: not the drifted entry, and not the intact one
  // in the other client's file either.
  assert.equal(await snapshotClientFiles(root), before);
  assert.notEqual(evidenceStore.state.receipt, null);
});

test('SG-HOOK-001: an entry whose command somebody changed is not the Gate entry, and removal leaves it alone', async (t) => {
  const root = await workspace(t);

  await seedClientFiles(root);

  const evidenceStore = removableStoreHolding(await activatedReceipt(root));

  // The command itself is edited. That entry now runs something the Gate never
  // registered, so it is not the Gate's to take back.
  const edited = await readJson(root, '.cursor/hooks.json');

  edited.hooks.stop.at(-1).command = `${gateCommand(root)} --somebody-elses-flag`;
  await writeJson(root, '.cursor/hooks.json', edited);

  const before = await snapshotClientFiles(root);
  const result = await deactivateGate({ evidenceStore, repositoryRoot: root });

  assert.equal(result.deactivated, true, `Deactivation refused: ${result.reasonCode}.`);
  assert.deepEqual(
    result.removed.filter((entry) => entry.kind === 'adapter-registration').map((entry) => entry.adapter),
    ['claude-code-desktop'],
  );

  // The edited entry survived untouched, alongside every unrelated entry.
  assert.deepEqual(await readJson(root, '.cursor/hooks.json'), JSON.parse(JSON.parse(before).dedicated));
});

test('SG-HOOK-001: a container the Gate had to create is taken back with the entry, leaving no residue', async (t) => {
  const root = await workspace(t);

  // A general settings file whose owner has never registered a hook at all: the
  // declared container is simply not there.
  await writeJson(root, '.claude/settings.local.json', {
    permissions: { allow: ['Bash(ls:*)'], deny: [] },
  });

  const pristine = await readFile(path.join(root, '.claude/settings.local.json'), 'utf8');
  const registration = await registerAdapterSurface({
    adapterId: 'claude-code-desktop',
    repositoryRoot: root,
    command: gateCommand(root),
  });

  assert.equal(registration.registered, true);
  assert.deepEqual(
    (await readJson(root, '.claude/settings.local.json')).hooks.Stop,
    [{ matcher: '', hooks: [{ type: 'command', command: gateCommand(root) }] }],
  );

  const withdrawn = await withdrawAdapterRegistration({
    adapterId: 'claude-code-desktop',
    repositoryRoot: root,
    registration,
  });

  assert.equal(withdrawn.removed, true);

  // Byte for byte the file its owner wrote: no empty event array and no empty
  // hooks container left behind to imply a registration that is not there.
  assert.equal(await readFile(path.join(root, '.claude/settings.local.json'), 'utf8'), pristine);
});
