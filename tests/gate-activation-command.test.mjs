import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  COMMAND_ALIAS_NAME,
  EVALUATION_SELF_TEST_PROBE,
  SELF_DECLARED,
  TRUST_MECHANISMS,
  createTrustEstablishment,
  registerCommandAlias,
  selfTestAdapterSurface,
  selfTestEvaluationDenial,
  withdrawCommandAlias,
} from '../skills/change-evaluation-gate/scripts/lib/activation-seams.mjs';
import { ACTIVATION_STEPS } from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { ADAPTER_IDS, describeAdapter } from '../skills/change-evaluation-gate/scripts/lib/adapters.mjs';
import {
  COMMANDS,
  CONFIRMABLE_COMMANDS,
  CONFIRMED_COMMANDS,
  EXIT_OBSERVED,
  EXIT_UNHEALTHY,
  EXIT_UNRUNNABLE,
  runOperatorCommand,
} from '../skills/change-evaluation-gate/scripts/lib/operator-surface.mjs';

const runFile = promisify(execFile);

/**
 * This suite ACTIVATES real clones through the packaged command: it registers
 * real `pre-commit` hooks, writes real receipts, and writes into a clone's own
 * `.git/config`. Every fixture is therefore a throwaway repository under the OS
 * temporary directory and never this repository — an escaped fixture would
 * activate authoritative enforcement on the framework clone and block every
 * later commit.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

const assertThrowawayRepository = async (root) => {
  const resolved = await realpath(root).catch(() => path.resolve(root));
  const temporaryRoot = await realpath(tmpdir());
  const frameworkRoot = await realpath(FRAMEWORK_ROOT).catch(() => FRAMEWORK_ROOT);

  assert.equal(
    isInside(temporaryRoot, resolved),
    true,
    `Refusing to activate a fixture outside the OS temporary directory: ${resolved}.`,
  );
  assert.equal(
    isInside(frameworkRoot, resolved),
    false,
    `Refusing to activate a fixture inside this repository: ${resolved}.`,
  );

  return resolved;
};

const isolatedGitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const git = (root, args) => runFile('git', args, { cwd: root, env: isolatedGitEnvironment() });

const CHECK_SCRIPT = [
  "import { readFile } from 'node:fs/promises';",
  '',
  "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
  '',
  'process.stdout.write(`graded ${graded.length} bytes\\n`);',
  "process.exitCode = graded.includes('BROKEN') ? 1 : 0;",
  '',
].join('\n');

const configuration = ({ required = 'configuration.broad-tests.test', script = 'tools/check.mjs' } = {}) => [
  'schema_version: 4',
  'backend: laravel',
  'frontend: none',
  'verification:',
  '  commands:',
  '    test:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  '        - runner: repository-script',
  '          args:',
  `            - ${script}`,
  '            - app/Order.php',
  '          working_directory: .',
  '          timeout_seconds: 60',
  '          allowed_environment:',
  '            - PATH',
  '          evidence_category: test',
  '          source_scope: both',
  'evaluation_gate:',
  '  checks:',
  '    required:',
  `      - ${required}`,
  '    advisory: []',
  '  budget:',
  '    total_seconds: 600',
  '  bypass:',
  '    enabled: false',
  '    marker: null',
  '  execution:',
  '    budget_skippable: []',
  '  evidence: {}',
  '',
].join('\n');

/** A throwaway clone that is configured and deliberately NOT activated. */
const configuredClone = async (t, { document = configuration(), files = {} } = {}) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-activate-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await assertThrowawayRepository(root);
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'tools/check.mjs'), CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  await writeFile(path.join(root, '.agent-framework.yaml'), document, 'utf8');

  for (const [relative, file] of Object.entries(files)) {
    const target = path.join(root, relative);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.contents, { encoding: 'utf8', mode: file.mode ?? 0o644 });
  }

  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await git(root, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate',
    'commit', '--quiet', '--message', 'baseline',
  ]);

  return root;
};

const gate = (root, argv) => runOperatorCommand({
  cwd: root,
  argv,
  environment: isolatedGitEnvironment(),
});

/** This clone's OWN Git configuration, byte for byte. */
const cloneConfiguration = (root) => readFile(path.join(root, '.git', 'config'), 'utf8');

const hookDirectory = async (root) => (
  await readdir(path.join(root, '.git', 'hooks')).catch(() => [])
).filter((entry) => !entry.endsWith('.sample'));

const tokenOf = (result) => {
  assert.match(
    result.document.observation.confirmationToken,
    /^sha256:[0-9a-f]{64}$/,
    '`gate activate` previewed without a confirmation token.',
  );

  return result.document.observation.confirmationToken;
};

/**
 * THE FIRST RED TEST.
 *
 * A configured clone is activated by running a command twice — where before
 * this slice `activate()` was reachable from nothing a person or an agent runs,
 * and the one activated clone this project had was produced by a throwaway
 * script (`AC-LIFE-002`, `FR-LIFE-004`).
 */
test('a configured clone is activated by two invocations of the command, and Git is enabled last', async (t) => {
  const root = await configuredClone(t);
  const beforeConfiguration = await cloneConfiguration(root);

  const preview = await gate(root, ['activate']);

  assert.equal(preview.exitCode, EXIT_OBSERVED);
  assert.equal(preview.document.command, 'activate');
  assert.equal(preview.document.observation.state, 'configured');
  assert.equal(preview.document.mutation, null);

  // A preview writes nothing: no hook, no receipt, and not one byte of this
  // clone's own Git configuration.
  assert.deepEqual(await hookDirectory(root), []);
  assert.equal(await cloneConfiguration(root), beforeConfiguration);

  const confirmed = await gate(root, ['activate', '--confirm', tokenOf(preview)]);

  assert.equal(confirmed.exitCode, EXIT_OBSERVED);
  assert.equal(confirmed.document.mutation.performed, true);
  assert.equal(confirmed.document.mutation.state, 'activated');
  assert.match(confirmed.document.mutation.receiptId, /^sha256:[0-9a-f]{64}$/);

  // Every step, in the settled order, with authoritative Git last.
  assert.deepEqual(confirmed.document.mutation.order, [...ACTIVATION_STEPS]);
  assert.equal(confirmed.document.mutation.order.at(-1), 'git-enablement');

  // The clone really carries an authoritative registration now, and the
  // observation surface agrees without being told.
  assert.deepEqual(await hookDirectory(root), ['pre-commit']);

  const status = await gate(root, ['status']);

  assert.equal(status.exitCode, EXIT_OBSERVED);
  assert.equal(status.document.observation.state, 'activated');
  assert.equal(status.document.observation.health, 'healthy');
  assert.equal(status.document.observation.receiptId, confirmed.document.mutation.receiptId);

  // The self-tests recorded in the receipt are the ones the command supplied,
  // and each names the per-run subject it answered.
  const receipt = JSON.parse(await readFile(
    path.join(root, '.git', 'change-evaluation-gate', 'evidence', 'activation', 'receipt.json'),
    'utf8',
  ).catch(async () => {
    const common = (await git(root, ['rev-parse', '--git-common-dir'])).stdout.trim();

    return readFile(path.resolve(root, common, 'change-evaluation-gate/evidence/activation/receipt.json'), 'utf8');
  }));
  const named = Object.fromEntries(receipt.selfTests.map((entry) => [entry.name, entry]));

  assert.deepEqual(
    receipt.selfTests.map((entry) => entry.name),
    ['evaluation-process', 'hook-program', 'adapter:git'],
  );
  assert.match(named['evaluation-process'].detail, /read the self-test subject [0-9a-f-]{36}/);
  assert.match(named['adapter:git'].detail, /activation-self-test-[0-9a-f-]{36}/);
});

/**
 * `AC-LIFE-008`. A confirmation is checked against a preview REBUILT from the
 * clone as it is now, never against a value the caller carried.
 */
test('a confirmation naming a different preview, or a changed clone, performs no mutation', async (t) => {
  const root = await configuredClone(t);
  const preview = await gate(root, ['activate']);
  const token = tokenOf(preview);

  const wrong = await gate(root, ['activate', '--confirm', `sha256:${'f'.repeat(64)}`]);

  assert.equal(wrong.exitCode, EXIT_UNHEALTHY);
  assert.equal(wrong.document.mutation.performed, false);
  assert.equal(wrong.document.mutation.reasonCode, 'preview-mismatch');
  assert.deepEqual(await hookDirectory(root), []);

  // The configuration this activation would have been bound to changes. The
  // token the operator holds still names a preview; it no longer names THIS
  // clone's preview.
  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    configuration({ required: 'configuration.broad-tests.test', script: 'tools/check.mjs' })
      .replace('total_seconds: 600', 'total_seconds: 900'),
    'utf8',
  );

  const stale = await gate(root, ['activate', '--confirm', token]);

  assert.equal(stale.exitCode, EXIT_UNHEALTHY);
  assert.equal(stale.document.mutation.performed, false);
  assert.equal(stale.document.mutation.reasonCode, 'preview-mismatch');
  assert.notEqual(stale.document.observation.configurationIdentity, preview.document.observation.configurationIdentity);
  assert.deepEqual(await hookDirectory(root), []);

  // An exact match against the preview this clone now describes proceeds.
  const current = await gate(root, ['activate']);
  const performed = await gate(root, ['activate', '--confirm', tokenOf(current)]);

  assert.equal(performed.document.mutation.performed, true);
});

test('a single invocation that would preview and activate together is refused, and names the two runs', async (t) => {
  const root = await configuredClone(t);

  for (const argv of [['activate', '--confirm'], ['activate', '--preview', '--confirm', `sha256:${'a'.repeat(64)}`]]) {
    const refused = await gate(root, argv);

    assert.equal(refused.exitCode, EXIT_UNRUNNABLE, `${argv.join(' ')} was not refused.`);
    assert.equal(refused.document.failure.reasonCode, 'preview-and-confirm-refused');
    assert.equal(refused.document.failure.ownedBy, 'gate activate --confirm <token>');
    assert.match(refused.stderr, /gate activate/);
  }

  assert.deepEqual(await hookDirectory(root), []);
});

/**
 * `AC-LIFE-009`, `FR-LIFE-016`. A desktop client's grant is the client's to
 * give. With none, the transaction pauses, leaves the clone untouched, and
 * states the identity a resumption must reproduce.
 */
test('a desktop client that has not granted trust pauses, leaves nothing active, and resumes only on its recorded identity', async (t) => {
  const root = await configuredClone(t);
  const beforeConfiguration = await cloneConfiguration(root);
  const preview = await gate(root, ['activate', '--client', 'cursor']);

  assert.equal(preview.document.observation.trustModel, 'explicit-workspace-grant');

  const paused = await gate(root, ['activate', '--client', 'cursor', '--confirm', tokenOf(preview)]);

  assert.equal(paused.exitCode, EXIT_UNHEALTHY);
  assert.equal(paused.document.mutation.performed, false);
  assert.equal(paused.document.mutation.state, 'paused');
  assert.equal(paused.document.mutation.reasonCode, 'trust-pending');

  // Nothing is active anywhere: no hook, no shortcut, no byte of the clone's
  // own Git configuration.
  assert.deepEqual(await hookDirectory(root), []);
  assert.equal(await cloneConfiguration(root), beforeConfiguration);
  assert.equal(paused.document.mutation.shortcut.registered, false);

  const resumption = paused.document.mutation.resumption;

  assert.match(resumption.transactionId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(resumption.previewId, preview.document.observation.confirmationToken);
  assert.equal(resumption.client, 'cursor');
  assert.match(paused.document.mutation.summary, /--resume sha256:[0-9a-f]{64}/);

  // A resumption of a transaction this clone never paused is refused before
  // anything is read, let alone written.
  const foreign = await gate(root, [
    'activate', '--client', 'cursor',
    '--resume', `sha256:${'b'.repeat(64)}`,
    '--confirm', tokenOf(preview),
  ]);

  assert.equal(foreign.document.mutation.performed, false);
  assert.equal(foreign.document.mutation.reasonCode, 'resume-transaction-mismatch');

  // The identity it recorded is accepted, and pauses again — because the client
  // still has not granted, which is the only honest answer available here.
  const resumed = await gate(root, [
    'activate', '--client', 'cursor',
    '--resume', resumption.transactionId,
    '--confirm', tokenOf(preview),
  ]);

  assert.equal(resumed.document.mutation.reasonCode, 'trust-pending');
  assert.equal(resumed.document.mutation.state, 'paused');
  assert.equal(await cloneConfiguration(root), beforeConfiguration);
});

/**
 * `FR-LIFE-006`, `SG-TRUST-001`. The receipt names the mechanism that was
 * verified, and asserts no human the command could not observe.
 */
test('the receipt names the consent mechanism verified, and no field asserts a human', async (t) => {
  const root = await configuredClone(t);
  const preview = await gate(root, ['activate']);
  const confirmed = await gate(root, ['activate', '--confirm', tokenOf(preview), '--actor', 'a-maintainer']);
  const trust = confirmed.document.mutation.trust;

  assert.equal(confirmed.document.mutation.performed, true);
  assert.equal(trust.client, 'git');
  assert.equal(trust.established, true);
  assert.equal(trust.grantedBy.mechanism, TRUST_MECHANISMS['repository-hook-registration']);
  assert.equal(trust.grantedBy.trustModel, 'repository-hook-registration');

  // The one provable fact, and its bindings.
  assert.equal(trust.grantedBy.observed.confirmationInSeparateInvocation, true);
  assert.equal(trust.grantedBy.observed.previewId, preview.document.observation.confirmationToken);
  assert.equal(
    trust.grantedBy.observed.repositoryIdentity,
    preview.document.observation.repositoryIdentity,
  );

  // A supplied actor is carried, and carried as a claim.
  assert.deepEqual(trust.grantedBy.actor, { name: 'a-maintainer', provenance: SELF_DECLARED });

  // Nothing anywhere in the trust record asserts a person. Every place a name
  // can appear carries its provenance beside it, and that provenance is only
  // ever `self-declared`.
  const walk = (value) => {
    if (Array.isArray(value)) {
      value.forEach(walk);

      return;
    }

    if (value === null || typeof value !== 'object') {
      return;
    }

    if ('provenance' in value) {
      assert.equal(value.provenance, SELF_DECLARED);
    }

    for (const [key, nested] of Object.entries(value)) {
      assert.equal(
        /^(operator|human|person|user|verifiedActor|grantedByHuman)$/i.test(key),
        false,
        `The receipt's trust record carries ${key}, which asserts somebody this command never observed.`,
      );

      // A bare string naming a person is exactly what may not appear: any actor
      // is an object carrying its provenance.
      if (key === 'actor' && nested !== null) {
        assert.equal(typeof nested, 'object');
        assert.equal(nested.provenance, SELF_DECLARED);
      }

      walk(nested);
    }
  };

  walk(trust);

  // Without a supplied actor there is simply nothing to carry.
  const second = await configuredClone(t);
  const anonymous = await gate(second, ['activate']);
  const done = await gate(second, ['activate', '--confirm', tokenOf(anonymous)]);

  assert.equal(done.document.mutation.trust.grantedBy.actor, null);
});

/**
 * The acceptance criterion aimed at the three seams: a self-test that reports
 * success without the subject answering has to FAIL here, or the supplied
 * implementations could be hollow.
 */
test('a self-test that reports success without the subject answering fails', async () => {
  // The shape every fixture in this repository used to supply.
  const hollow = async () => ({ ok: true, detail: 'the subject responded' });

  assert.equal((await hollow()).ok, true);

  // The real one, against a subject that really answers.
  const proved = await selfTestEvaluationDenial({});

  assert.equal(proved.ok, true, proved.detail);
  assert.match(proved.detail, /read the self-test subject [0-9a-f-]{36}/);

  // A probe that exits non-zero without ever reading its subject. It looks
  // exactly like a denial from the outside, and it proves nothing: an exit
  // status is not a decision (`TB-035`, `NFR-REL-003`).
  const unread = await selfTestEvaluationDenial({
    probe: 'process.exit(1);\n',
  });

  assert.equal(unread.ok, false);
  assert.equal(unread.reason, 'evaluation-process-unproved');

  // A probe that reads its subject and allows it anyway enforces nothing.
  const permissive = await selfTestEvaluationDenial({
    probe: EVALUATION_SELF_TEST_PROBE.replace('process.exit(1);', 'process.exit(0);'),
  });

  assert.equal(permissive.ok, false);
  assert.equal(permissive.reason, 'evaluation-process-allowed-denied-change');

  // An adapter that is not a declared surface, and a clone that is not one,
  // are both refused rather than reported as responding.
  const undeclared = await selfTestAdapterSurface({ id: 'not-a-surface' }, { repository: { root: FRAMEWORK_ROOT } });

  assert.equal(undeclared.ok, false);
  assert.equal(undeclared.reason, 'adapter-undeclared');

  const rootless = await selfTestAdapterSurface({ id: 'git' }, {});

  assert.equal(rootless.ok, false);
  assert.equal(rootless.reason, 'adapter-self-test-unrunnable');
});

/** Trust dispatches on the model each adapter declares, and refuses one it does not know. */
test('every declared trust model is handled, and an unrecognized one is refused rather than granted', async () => {
  const repository = { root: '/nowhere', identity: `sha256:${'c'.repeat(64)}` };
  const consent = {
    previewId: `sha256:${'d'.repeat(64)}`,
    repositoryIdentity: repository.identity,
    configurationIdentity: `sha256:${'e'.repeat(64)}`,
    grantedAt: '2026-08-25T00:00:00.000Z',
  };
  const establish = createTrustEstablishment({ consent });

  for (const adapterId of ADAPTER_IDS) {
    const declared = describeAdapter(adapterId).capabilities.trust.model;

    assert.ok(
      declared in TRUST_MECHANISMS,
      `${adapterId} declares the trust model ${declared}, which this dispatch does not handle.`,
    );

    const result = await establish({ client: { id: adapterId }, repository });

    if (declared === 'repository-hook-registration') {
      assert.equal(result.established, true);
      assert.equal(result.grantedBy.trustModel, declared);
    } else {
      // Only the client can grant, and it has not.
      assert.equal(result.established, false);
      assert.equal(result.pending, true);
      assert.equal(result.reason, `${declared}-not-granted`);
    }
  }

  // A model this dispatch does not recognize is refused, and refused as a
  // failure rather than as a pause — a pause would invite a retry that could
  // never succeed.
  const invented = await createTrustEstablishment({ consent })({
    client: { id: 'not-a-surface' },
    repository,
  });

  assert.equal(invented.established, false);
  assert.equal(invented.pending, false);
  assert.equal(invented.reason, 'adapter-undeclared');

  // Consent for another clone never satisfies this one.
  const foreign = await createTrustEstablishment({
    consent: { ...consent, repositoryIdentity: `sha256:${'9'.repeat(64)}` },
  })({ client: { id: 'git' }, repository });

  assert.equal(foreign.established, false);
  assert.equal(foreign.pending, false);
  assert.equal(foreign.reason, 'consent-repository-mismatch');

  // A desktop client that HAS granted is established, and its grant is recorded
  // as read rather than as a person.
  const granted = await createTrustEstablishment({
    consent,
    actor: 'a-maintainer',
    readClientGrant: async () => ({ granted: true, at: '2026-08-25T01:00:00.000Z' }),
  })({ client: { id: 'cursor' }, repository });

  assert.equal(granted.established, true);
  assert.equal(granted.grantedBy.mechanism, TRUST_MECHANISMS['explicit-workspace-grant']);
  assert.equal(granted.grantedBy.observed.clientGrantRead, true);
  assert.deepEqual(granted.grantedBy.actor, { name: 'a-maintainer', provenance: SELF_DECLARED });
});

/**
 * `FR-LIFE-003`. The shortcut is clone-local, it is a Git alias, and it is
 * never a tracked project file or a global setting.
 */
test('the shortcut is written only to the clone\'s own Git configuration, and a name in use is left alone', async (t) => {
  const root = await configuredClone(t);
  const trackedBefore = await readFile(path.join(root, '.agent-framework.yaml'), 'utf8');
  const preview = await gate(root, ['activate']);
  const confirmed = await gate(root, ['activate', '--confirm', tokenOf(preview)]);

  assert.equal(confirmed.document.mutation.shortcut.registered, true);

  const local = (await git(root, ['config', '--local', '--get', `alias.${COMMAND_ALIAS_NAME}`])).stdout.trim();

  assert.match(local, /^!".*node.*" ".*gate\.mjs"$/);
  assert.ok((await cloneConfiguration(root)).includes(`[alias]`));

  // Not a tracked project file. There is no package.json here to write to, and
  // nothing this activation touched is tracked at all.
  assert.equal(await readFile(path.join(root, '.agent-framework.yaml'), 'utf8'), trackedBefore);
  assert.equal(
    (await git(root, ['status', '--porcelain'])).stdout.trim(),
    '',
    'Activation changed a tracked file.',
  );
  assert.equal(
    await readFile(path.join(root, 'package.json'), 'utf8').catch(() => null),
    null,
    'Activation wrote a project manifest.',
  );

  // A name already in use is left exactly as it is.
  const second = await configuredClone(t);

  await git(second, ['config', '--local', `alias.${COMMAND_ALIAS_NAME}`, '!echo mine']);

  const taken = await gate(second, ['activate']);
  const activated = await gate(second, ['activate', '--confirm', tokenOf(taken)]);

  assert.equal(activated.document.mutation.performed, true, 'A taken alias name failed an otherwise good activation.');
  assert.equal(activated.document.mutation.shortcut.registered, false);
  assert.equal(activated.document.mutation.shortcut.reason, 'alias-name-in-use');
  assert.equal(
    (await git(second, ['config', '--local', '--get', `alias.${COMMAND_ALIAS_NAME}`])).stdout.trim(),
    '!echo mine',
  );

  // A shortcut that cannot be registered at all does not fail the activation.
  const unregisterable = await registerCommandAlias({
    repositoryRoot: root,
    command: '/tmp/gate.mjs',
    runGit: async () => { throw new Error('git is unavailable here'); },
  });

  assert.equal(unregisterable.registered, false);
  assert.equal(unregisterable.reason, 'alias-registration-failed');

  // What was written can be taken back, and only while it is still what was
  // written.
  const registration = confirmed.document.mutation.shortcut;
  const changed = await withdrawCommandAlias({
    repositoryRoot: root,
    registration: { ...registration, value: '!something else' },
    runGit: (args) => git(root, args).then((result) => result.stdout),
  });

  assert.deepEqual(changed, { removed: false, reason: 'alias-changed' });

  const withdrawn = await withdrawCommandAlias({
    repositoryRoot: root,
    registration,
    runGit: (args) => git(root, args).then((result) => result.stdout),
  });

  assert.deepEqual(withdrawn, { removed: true, reason: null });
});

/**
 * `SG-LIFE-001`. A clone whose activation fails commits exactly as it did while
 * configured, and no shortcut is left behind — proved by comparing the clone's
 * own Git configuration before and after.
 */
test('a failed activation leaves no shortcut, no registration, and a clone that commits as it did while configured', async (t) => {
  // A `pre-commit` hook the gate can neither own nor compose into: the chain
  // decides, and activation refuses rather than taking it over (`SG-HOOK-001`).
  const root = await configuredClone(t);

  await writeFile(
    path.join(root, '.git', 'hooks', 'pre-commit'),
    '#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n',
    { encoding: 'utf8', mode: 0o755 },
  );

  const beforeConfiguration = await cloneConfiguration(root);
  const beforeHook = await readFile(path.join(root, '.git', 'hooks', 'pre-commit'), 'utf8');
  const preview = await gate(root, ['activate']);
  const failed = await gate(root, ['activate', '--confirm', tokenOf(preview)]);

  assert.equal(failed.exitCode, EXIT_UNHEALTHY);
  assert.equal(failed.document.mutation.performed, false);
  assert.equal(failed.document.mutation.step, 'hook-chain-validation');
  assert.equal(failed.document.mutation.state, 'configured');
  assert.equal(failed.document.mutation.receiptId, null);
  assert.equal(failed.document.mutation.shortcut.registered, false);
  assert.equal(failed.document.mutation.shortcut.reason, 'activation-not-completed');

  // The clone's own configuration is byte-for-byte what it was: no alias, and
  // nothing else either.
  assert.equal(await cloneConfiguration(root), beforeConfiguration);
  assert.equal(await readFile(path.join(root, '.git', 'hooks', 'pre-commit'), 'utf8'), beforeHook);

  // And it still commits exactly as it did while configured.
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\nBROKEN\n', 'utf8');
  await git(root, ['add', '--all']);
  await git(root, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate',
    'commit', '--quiet', '--message', 'still configured',
  ]);

  assert.equal((await git(root, ['rev-list', '--count', 'HEAD'])).stdout.trim(), '2');
});

test('a clone that is not configured is refused rather than configured on the way past', async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-activate-bare-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await assertThrowawayRepository(root);
  await git(root, ['init', '--quiet']);

  const refused = await gate(root, ['activate']);

  assert.equal(refused.exitCode, EXIT_UNRUNNABLE);
  assert.equal(refused.document.failure.reasonCode, 'configuration-missing');
  assert.match(refused.stderr, /Activation configures nothing/);
  assert.equal(
    await readFile(path.join(root, '.agent-framework.yaml'), 'utf8').catch(() => null),
    null,
  );
});

test('activate is a command this surface performs, and it confirms like every other one', async () => {
  assert.ok(COMMANDS.includes('activate'));
  assert.equal(CONFIRMABLE_COMMANDS.activate, '--confirm');

  // `TB-042` moved it OUT of the refusal table rather than adding a parser
  // beside it, exactly as `TB-041` moved the selectors it implemented.
  assert.deepEqual(CONFIRMED_COMMANDS, { fix: 'gate fix' });
  assert.equal(CONFIRMED_COMMANDS.activate, undefined);
});

/**
 * The discovery copy. An agent asked to activate, diagnose, or recover a clone
 * has to match this skill; while all three descriptions said "configure", it
 * did not.
 */
test('the skill\'s discovery copy states what the surface now does', async () => {
  const skill = await readFile(path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/SKILL.md'), 'utf8');
  const openai = await readFile(path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/agents/openai.yaml'), 'utf8');
  const readme = await readFile(path.join(FRAMEWORK_ROOT, 'README.md'), 'utf8');
  const description = /^description:\s*(.+)$/m.exec(skill)?.[1] ?? '';
  const shortDescription = /^\s*short_description:\s*"(.+)"$/m.exec(openai)?.[1] ?? '';
  const defaultPrompt = /^\s*default_prompt:\s*"(.+)"$/m.exec(openai)?.[1] ?? '';
  const entry = readme
    .split('\n')
    .find((candidate) => candidate.includes('[change-evaluation-gate]')) ?? '';

  for (const [where, copy] of [
    ['SKILL.md frontmatter', description],
    ['agents/openai.yaml short_description', shortDescription],
    ['agents/openai.yaml default_prompt', defaultPrompt],
    ['the README entry', entry],
  ]) {
    assert.match(copy, /activat/i, `${where} does not say this skill activates a clone.`);
  }

  for (const [where, copy] of [
    ['SKILL.md frontmatter', description],
    ['agents/openai.yaml default_prompt', defaultPrompt],
    ['the README entry', entry],
  ]) {
    assert.match(copy, /diagnos|recover|operate/i, `${where} does not say this skill diagnoses or recovers a clone.`);
  }

  // The statement that is no longer true.
  assert.equal(
    /`?gate activate`?[^.]*refused here by name/.test(skill),
    false,
    'SKILL.md still says `gate activate` is refused by name.',
  );
  assert.match(skill, /gate activate/, 'SKILL.md does not tell an agent how to activate a clone.');
});
