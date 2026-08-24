#!/usr/bin/env node
/**
 * `gate-lifecycle-smoke` — the packaged update and removal lifecycle.
 *
 * Proves, against throwaway Git repositories, a real composed `pre-commit`
 * hook, a real Evidence store, and real `git commit` invocations:
 *
 * 1. `packaged-update` — an ordinary distribution exposes a CANDIDATE release
 *    only; an injected update failure preserves the prior Active gate release
 *    byte for byte; and only an explicit successful `gate update` advances it,
 *    by one atomic receipt write that never touches the registration
 *    (AC-LIFE-004, AC-LIFE-007, FR-LIFE-008, FR-LIFE-014).
 * 2. `packaged-removal` — deactivation restores the repository's own prior hook
 *    chain byte for byte and really disarms the gate (a commit that was blocked
 *    before now succeeds, and the prior chain still runs); uninstall then
 *    removes only unchanged project-installed assets. An unrelated hook, the
 *    unrelated keys of the shared configuration file, every byte of historical
 *    Evidence, and a global asset outside the project all survive both
 *    (AC-LIFE-005, FR-LIFE-010, FR-LIFE-011, SG-LIFE-001).
 * 3. `observation-mutates-nothing` — `gate status` reconciles a healthy and
 *    then a broken clone and changes not one byte of it, and the drift it
 *    reports is still there afterwards (FR-LIFE-009, FR-LIFE-019, AC-LIFE-010).
 * 4. `packaged-observation` — the same clone observed through the PACKAGED
 *    `gate` command a maintainer and an agent both run: it reports health,
 *    inspects the lock, previews a prune, renders one document identically to
 *    a person and to a parser, refuses every confirmed operation by name,
 *    distinguishes a broken clone from a failed invocation by exit status
 *    alone, and leaves the clone and its Evidence store unchanged
 *    (AC-LIFE-004, AC-EVID-002, NFR-OPER-001, SG-LIFE-001).
 *
 * It is non-interactive and offline, requires no external toolchain beyond Git
 * and this Node runtime, and is safe to run repeatedly on a clean machine.
 *
 * SAFETY: every fixture is a throwaway repository created under the OS
 * temporary directory and removed afterwards. `assertThrowawayRepository`
 * refuses any root that is not under that directory or that lies inside this
 * repository. This capability *removes* files, so that guard is checked again
 * immediately before every removal, not only at fixture creation.
 *
 * Usage:
 *   node skills/change-evaluation-gate/scripts/gate-lifecycle-smoke.mjs [--json]
 *
 * Exit status is 0 only when every scenario holds.
 */

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { activate, previewActivation } from './lib/activation.mjs';
import { contentIdentity, openEvidenceStore } from './lib/evidence-store.mjs';
import {
  activeRelease,
  deactivateGate,
  inspectRelease,
  statusGate,
  uninstallGate,
  updateGate,
} from './lib/lifecycle.mjs';

const CAPABILITY = 'gate-lifecycle-smoke';

/** This repository. No fixture may ever touch its Git state or its hooks. */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The packaged operator command, driven here exactly as a maintainer would. */
const PACKAGED_COMMAND = fileURLToPath(new URL('gate.mjs', import.meta.url));

const ACTIVE_RELEASE = { id: 'change-evaluation-gate', version: '0.9.0', protocolVersion: '1.0' };

const CANDIDATE_RELEASE = { id: 'change-evaluation-gate', version: '0.9.1', protocolVersion: '1.0' };

/** The repository's own pre-commit hook, which activation must preserve. */
const PRIOR_HOOK = [
  '#!/bin/sh',
  '# the repository had this long before the gate existed',
  'echo "prior chain ran" > prior-ran',
  'exit 0',
  '',
].join('\n');

/** A hook the gate never previews, never registers, and never owns. */
const UNRELATED_HOOK = '#!/bin/sh\necho "unrelated" > unrelated-ran\nexit 0\n';

/** A shared configuration file that is mostly not about the Gate at all. */
const SHARED_CONFIGURATION = [
  'schema_version: 4',
  'backend: laravel',
  'frontend: none',
  'tracker: local-markdown',
  'evaluation_gate:',
  '  enabled: true',
  'history:',
  '  path: docs/history',
  '  required: true',
  '',
].join('\n');

const runFile = promisify(execFile);

const temporaryRoots = [];

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

/** The guard. Nothing in this capability reads, writes, or removes outside a throwaway root. */
const assertThrowawayRepository = async (root) => {
  const resolved = await realpath(root).catch(() => path.resolve(root));
  const temporaryRoot = await realpath(tmpdir());
  const frameworkRoot = await realpath(FRAMEWORK_ROOT).catch(() => FRAMEWORK_ROOT);

  if (!isInside(temporaryRoot, resolved)) {
    throw new Error(`${CAPABILITY} refuses to operate outside the OS temporary directory: ${resolved}.`);
  }

  if (isInside(frameworkRoot, resolved)) {
    throw new Error(`${CAPABILITY} refuses to operate inside this repository: ${resolved}.`);
  }

  return resolved;
};

const temporaryDirectory = async (prefix) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));

  temporaryRoots.push(directory);
  await assertThrowawayRepository(directory);

  return directory;
};

/** Git with its own configuration, so no developer setting can reach a fixture. */
const gitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const git = async (cwd, args) => runFile('git', args, { cwd, env: gitEnvironment() });

const runGit = async (repositoryRoot, args) => (await git(repositoryRoot, args)).stdout;

const commit = (cwd, message) => git(cwd, [
  '-c', 'user.email=gate@example.test',
  '-c', 'user.name=Gate Lifecycle Smoke',
  'commit', '--quiet', '--message', message,
]);

const gatePolicy = () => ({
  checks: { required: ['broad_test'], advisory: [] },
  budget: { total_seconds: 600 },
  bypass: { enabled: false, marker: null },
  execution: { budget_skippable: [] },
  evidence: {},
});

const activationRequest = (root, overrides = {}) => ({
  scope: 'repository',
  trigger: 'explicit',
  repository: { root },
  configuration: { schemaVersion: 4, policy: gatePolicy() },
  client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
  gate: { ...ACTIVE_RELEASE },
  actor: { name: CAPABILITY, source: 'fixture' },
  runtime: {
    runnerVersion: 'change-evaluation-gate/0.9.0',
    hookProgram: { interpreter: process.execPath, script: 'tools/gate-runner.mjs', args: [] },
  },
  checks: [{
    id: 'broad_test',
    evaluate: {
      runner: 'repository-script',
      args: ['tools/check.mjs'],
      working_directory: '.',
      timeout_seconds: 60,
      allowed_environment: ['PATH'],
      evidence_category: 'test',
      source_scope: 'backend',
    },
  }],
  adapters: [
    { id: 'git', version: '1.0.0', authoritative: true },
    { id: 'claude-code', version: '1.2.3', authoritative: false },
  ],
  runtimeInputs: [{ name: 'APP_TOKEN', source: 'approved-environment-file' }],
  ...overrides,
});

const storeFor = async (root) => openEvidenceStore({
  repositoryRoot: root,
  runGit,
  identity: {
    actor: { name: CAPABILITY, source: 'fixture' },
    client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
    gate: { ...ACTIVE_RELEASE },
    repository: { identity: `sha256:${'0'.repeat(64)}` },
  },
});

const dependencies = (overrides = {}) => ({
  runGit,
  resolveExecutable: (runner) => (
    runner === 'repository-script'
      ? { executable: process.execPath, version: process.versions.node }
      : { executable: `/usr/bin/${runner}`, version: '1.0.0' }
  ),
  establishTrust: async () => ({
    established: true,
    grantedBy: CAPABILITY,
    at: new Date().toISOString(),
  }),
  selfTestEvaluation: async () => ({ ok: true, detail: 'the evaluation process reached a decision' }),
  selfTestAdapter: async (adapter) => ({ ok: true, detail: `${adapter.id} responded` }),
  probeAdapter: async (adapter) => ({ ok: true, detail: `${adapter.id} responded` }),
  ...overrides,
});

/**
 * The fixture hook program, which answers the activation self-test.
 *
 * An unconditional `process.exitCode = 1` used to pass the self-test without
 * reading anything — fail-closed, but for the wrong reason. Activation now
 * requires the program to name the subject it judged, so this fixture reads it
 * and repeats its per-run id back (TB-035, NFR-REL-003).
 */
const FIXTURE_HOOK_PROGRAM = [
  "import { readFileSync } from 'node:fs';",
  '',
  'const subjectPath = process.env.CHANGE_EVALUATION_GATE_SELF_TEST ?? null;',
  '',
  'if (subjectPath === null) {',
  '  process.exitCode = 1;',
  '} else {',
  "  const subject = JSON.parse(readFileSync(subjectPath, 'utf8'));",
  "  const denied = subject.checks.some((check) => check.required && check.outcome === 'failed');",
  '',
  '  process.stdout.write(`change-evaluation-gate: ${denied ? "denied" : "allowed"} / self-test ${subject.selfTestId}\\n`);',
  '  process.exitCode = denied ? 1 : 0;',
  '}',
  '',
].join('\n');

/**
 * A throwaway clone that already has everything removal must not touch: its own
 * pre-commit chain, an unrelated hook, a shared configuration file, a
 * project-installed asset, historical Evidence, and a global asset outside it.
 */
const fixtureClone = async () => {
  const root = await temporaryDirectory(`${CAPABILITY}-repo-`);
  const globalAssets = await temporaryDirectory(`${CAPABILITY}-global-`);

  await mkdir(path.join(root, 'tools'), { recursive: true });
  await mkdir(path.join(root, '.claude', 'skills'), { recursive: true });
  await writeFile(path.join(root, 'tools/gate-runner.mjs'), FIXTURE_HOOK_PROGRAM, 'utf8');
  await writeFile(path.join(root, 'tools/check.mjs'), 'process.exitCode = 0;\n', 'utf8');
  await writeFile(path.join(root, '.agent-framework.yaml'), SHARED_CONFIGURATION, 'utf8');
  await writeFile(path.join(root, '.claude/skills/gate.md'), '# project asset\n', 'utf8');
  await writeFile(path.join(globalAssets, 'gate.md'), '# global asset\n', 'utf8');
  await writeFile(path.join(root, 'source.txt'), 'baseline\n', 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await commit(root, 'baseline');

  const store = await storeFor(root);
  const hooksDirectory = path.join(store.gitCommonDirectory, 'hooks');

  await mkdir(hooksDirectory, { recursive: true });
  await writeFile(path.join(hooksDirectory, 'pre-commit'), PRIOR_HOOK, { mode: 0o755 });
  await writeFile(path.join(hooksDirectory, 'pre-push'), UNRELATED_HOOK, { mode: 0o755 });

  // Historical Evidence that predates the activation and must outlive it.
  await store.appendEvidence({
    decision: { evaluationId: `sha256:${'c'.repeat(64)}`, outcome: 'pass' },
    outputs: [{ checkId: 'broad_test', attempt: 1, text: 'historical output\n' }],
  });

  return { root, store, globalAssets, hooksDirectory };
};

/** Activate a fixture clone for real, composing into the hook it already had. */
const activateFixture = async (root, store, overrides = {}) => {
  await assertThrowawayRepository(root);

  const request = activationRequest(root, overrides);
  const unconfirmed = await previewActivation(request, dependencies());
  const confirmed = {
    ...request,
    hookConfirmation: {
      strategy: 'marker-delimited-block',
      path: unconfirmed.hooks[0].path,
      hookIdentity: unconfirmed.hooks[0].existing.identity,
    },
  };
  const preview = await previewActivation(confirmed, dependencies());

  return activate({
    ...confirmed,
    consent: {
      previewId: preview.previewId,
      repositoryIdentity: preview.repository.identity,
      configurationIdentity: preview.configuration.identity,
      actor: { name: CAPABILITY, source: 'fixture' },
      grantedAt: new Date().toISOString(),
    },
  }, dependencies({ evidenceStore: store }));
};

const check = (findings, condition, detail) => {
  if (!condition) {
    findings.push(detail);
  }
};

/** Every file in the clone, by relative path and bytes. */
const snapshotOf = async (root) => {
  const entries = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        entries.push([
          path.relative(root, absolute),
          await readFile(absolute, 'base64').catch(() => null),
        ]);
      }
    }
  };

  await walk(root);

  return JSON.stringify(entries.sort(([left], [right]) => left.localeCompare(right)));
};

/** An ordinary distribution offers a candidate; only an explicit update takes it. */
const packagedUpdate = async () => {
  const findings = [];
  const { root, store, hooksDirectory } = await fixtureClone();
  const activated = await activateFixture(root, store);

  check(findings, activated.activated === true, `The fixture failed to activate: ${activated.reasonCode}.`);

  if (!activated.activated) {
    return { name: 'packaged-update', ok: false, findings };
  }

  const hookPath = path.join(hooksDirectory, 'pre-commit');
  const registration = await readFile(hookPath, 'utf8');
  const pinned = await readFile(store.paths.activationReceipt, 'utf8');

  // 1. Distribution alone exposes a candidate and advances nothing.
  const offered = inspectRelease({
    receipt: await store.activationReceipt().read(),
    distribution: { ...CANDIDATE_RELEASE },
  });

  check(findings, offered.candidateAvailable === true, 'A newer distribution did not surface as a candidate.');
  check(findings, offered.advancesActiveRelease === false, 'A distribution claimed to advance the Active gate release.');
  check(
    findings,
    (await readFile(store.paths.activationReceipt, 'utf8')) === pinned,
    'Merely inspecting the available releases changed the published receipt.',
  );

  // 2. A failed update preserves the prior release, byte for byte.
  const failed = await updateGate({
    evidenceStore: store,
    repositoryRoot: root,
    candidate: { ...CANDIDATE_RELEASE },
  }, dependencies({
    selfTestEvaluation: async () => ({ ok: false, detail: 'injected update self-test failure' }),
  }));

  check(findings, failed.updated === false, 'An injected update failure still advanced the release.');
  check(findings, failed.state === 'preserved', `Expected the preserved state, got ${failed.state}.`);
  check(
    findings,
    (await readFile(store.paths.activationReceipt, 'utf8')) === pinned,
    'A failed update rewrote the published receipt.',
  );
  check(
    findings,
    activeRelease(await store.activationReceipt().read())?.version === '0.9.0',
    'A failed update did not preserve the previous Active gate release.',
  );

  // 3. Only the explicit, successful update advances it — atomically.
  const updated = await updateGate({
    evidenceStore: store,
    repositoryRoot: root,
    candidate: { ...CANDIDATE_RELEASE },
    runtime: { runnerVersion: 'change-evaluation-gate/0.9.1' },
  }, dependencies());

  check(findings, updated.updated === true, `The explicit update failed: ${updated.reasonCode}.`);
  check(
    findings,
    activeRelease(await store.activationReceipt().read())?.version === '0.9.1',
    'The explicit update did not advance the Active gate release.',
  );
  check(
    findings,
    (await store.activationReceipt().read())?.supersedes?.release?.version === '0.9.0',
    'The switched receipt does not record the release it superseded.',
  );

  // The release switch is a receipt write and nothing else.
  check(
    findings,
    (await readFile(hookPath, 'utf8')) === registration,
    'A release switch modified the registered hook.',
  );
  check(
    findings,
    (await readFile(path.join(hooksDirectory, 'pre-push'), 'utf8')) === UNRELATED_HOOK,
    'A release switch modified an unrelated hook.',
  );
  check(
    findings,
    (await readFile(path.join(root, '.agent-framework.yaml'), 'utf8')) === SHARED_CONFIGURATION,
    'A release switch modified the shared configuration file.',
  );
  check(
    findings,
    (await store.listBlobs()).length >= 1,
    'A release switch removed historical Evidence.',
  );

  const events = await store.readEvents();
  const updates = events.filter((event) => event.type === 'update');

  check(
    findings,
    updates.length === 2 && updates[0].outcome === 'failed' && updates[1].outcome === 'succeeded',
    `Both update transitions were not recorded: ${JSON.stringify(updates.map((event) => event.outcome))}.`,
  );

  return { name: 'packaged-update', ok: findings.length === 0, findings };
};

/** Removal disarms the gate and touches nothing that is not the gate's. */
const packagedRemoval = async () => {
  const findings = [];
  const { root, store, globalAssets, hooksDirectory } = await fixtureClone();
  const activated = await activateFixture(root, store);

  check(findings, activated.activated === true, `The fixture failed to activate: ${activated.reasonCode}.`);

  if (!activated.activated) {
    return { name: 'packaged-removal', ok: false, findings };
  }

  const hookPath = path.join(hooksDirectory, 'pre-commit');
  const projectAsset = path.join(root, '.claude/skills/gate.md');
  const globalAsset = path.join(globalAssets, 'gate.md');
  const configuration = path.join(root, '.agent-framework.yaml');
  const blobsBefore = (await store.listBlobs()).length;
  const eventsBefore = (await store.readEvents()).length;

  // The gate is really authoritative: this commit is blocked by the hook.
  await writeFile(path.join(root, 'source.txt'), 'changed while activated\n', 'utf8');
  await git(root, ['add', '--all']);

  const blocked = await commit(root, 'an activated clone refuses').then(() => false, () => true);

  check(findings, blocked === true, 'The activated clone did not block a refused commit.');

  // Deactivate. The receipt and the gate-owned block go; nothing else does.
  await assertThrowawayRepository(root);

  const deactivated = await deactivateGate({
    evidenceStore: store,
    repositoryRoot: root,
  }, dependencies());

  check(findings, deactivated.deactivated === true, `Deactivation failed: ${deactivated.reasonCode}.`);
  check(
    findings,
    (await readFile(hookPath, 'utf8')) === PRIOR_HOOK,
    'Deactivation did not restore the repository\'s own prior hook chain byte for byte.',
  );
  check(
    findings,
    (await store.activationReceipt().read()) === null,
    'Deactivation left the Activation receipt behind.',
  );

  // And the gate really is disarmed: the same commit now succeeds, and the
  // repository's own hook chain still runs.
  await rm(path.join(root, 'prior-ran'), { force: true });

  const committed = await commit(root, 'a deactivated clone commits again').then(() => true, () => false);

  check(findings, committed === true, 'A deactivated clone still blocked a commit.');
  check(
    findings,
    (await readFile(path.join(root, 'prior-ran'), 'utf8').catch(() => null)) === 'prior chain ran\n',
    'The repository\'s own hook chain no longer runs after deactivation.',
  );

  // Uninstall requires that prior deactivation, and removes only project assets.
  const manifest = [{
    path: projectAsset,
    identity: contentIdentity(await readFile(projectAsset, 'utf8')),
  }];
  const refused = await uninstallGate({
    evidenceStore: store,
    repositoryRoot: root,
    assets: [...manifest, { path: globalAsset, identity: contentIdentity(await readFile(globalAsset, 'utf8')) }],
  });

  check(findings, refused.uninstalled === false, 'Uninstall removed an asset outside the project.');
  check(
    findings,
    (refused.refused ?? []).some((entry) => entry.reason === 'asset-outside-project'),
    'Uninstall did not name the out-of-project asset as its reason.',
  );

  const uninstalled = await uninstallGate({
    evidenceStore: store,
    repositoryRoot: root,
    assets: manifest,
  });

  check(findings, uninstalled.uninstalled === true, `Uninstall failed: ${uninstalled.reasonCode}.`);
  check(
    findings,
    (await readFile(projectAsset, 'utf8').catch(() => null)) === null,
    'Uninstall did not remove the unchanged project-installed asset.',
  );

  // Assert the survivors, not merely the gate's absence.
  check(
    findings,
    (await readFile(path.join(hooksDirectory, 'pre-push'), 'utf8')) === UNRELATED_HOOK,
    'Removal disturbed an unrelated hook.',
  );
  check(
    findings,
    (await readFile(configuration, 'utf8')) === SHARED_CONFIGURATION,
    'Removal changed the shared configuration file.',
  );
  check(
    findings,
    (await readFile(globalAsset, 'utf8')) === '# global asset\n',
    'Removal deleted a global asset.',
  );
  check(
    findings,
    (await store.listBlobs()).length === blobsBefore,
    'Removal deleted historical Evidence.',
  );
  check(
    findings,
    (await store.readEvents()).length > eventsBefore,
    'Removal was not recorded as a Lifecycle event.',
  );
  check(
    findings,
    (await store.readEvents()).filter((event) => event.type === 'removal').length >= 2,
    'Deactivation and uninstall were not both recorded.',
  );

  return { name: 'packaged-removal', ok: findings.length === 0, findings };
};

/** Observation reconciles and reports; it repairs nothing and writes nothing. */
const observationMutatesNothing = async () => {
  const findings = [];
  const { root, store, hooksDirectory } = await fixtureClone();
  const activated = await activateFixture(root, store);

  check(findings, activated.activated === true, `The fixture failed to activate: ${activated.reasonCode}.`);

  if (!activated.activated) {
    return { name: 'observation-mutates-nothing', ok: false, findings };
  }

  const hookPath = path.join(hooksDirectory, 'pre-commit');
  const healthyBefore = await snapshotOf(root);
  const healthy = await statusGate({
    evidenceStore: store,
    repositoryRoot: root,
    adapters: [
      { id: 'git', version: '1.0.0', authoritative: true },
      { id: 'claude-code', version: '1.2.3', authoritative: false },
    ],
  }, dependencies());

  check(findings, healthy.status === 'healthy', `An intact clone reported ${healthy.status}.`);
  check(findings, (await snapshotOf(root)) === healthyBefore, 'Observing a healthy clone changed it.');

  const degraded = await statusGate({
    evidenceStore: store,
    repositoryRoot: root,
    adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
  }, dependencies());

  check(findings, degraded.status === 'degraded', `Losing a supporting adapter reported ${degraded.status}.`);
  check(findings, (await snapshotOf(root)) === healthyBefore, 'Observing a degraded clone changed it.');

  // Real drift, introduced inside the gate-owned block without disturbing its
  // markers: only a durable content identity can see this.
  const registration = await readFile(hookPath, 'utf8');

  await writeFile(hookPath, registration.replace(/\|\| exit \$\?/, '|| true'), 'utf8');

  const brokenBefore = await snapshotOf(root);
  const broken = await statusGate({ evidenceStore: store, repositoryRoot: root }, dependencies());

  check(findings, broken.status === 'broken', `A tampered registration reported ${broken.status}.`);
  check(
    findings,
    broken.findings.some((finding) => finding.code === 'hook-block-tampered'),
    'The tampered gate-owned block was not detected through its durable identity.',
  );
  check(findings, broken.repaired === false, 'Status claimed to have repaired something.');
  check(
    findings,
    (await snapshotOf(root)) === brokenBefore,
    'Observing a broken clone changed it: status is not free of side effects.',
  );

  // Repeated observation is still observation, and the drift is still drift.
  await statusGate({ evidenceStore: store, repositoryRoot: root }, dependencies());
  await statusGate({ evidenceStore: store, repositoryRoot: root }, dependencies());

  check(
    findings,
    (await snapshotOf(root)) === brokenBefore,
    'Repeated observation accumulated changes in the clone.',
  );

  return { name: 'observation-mutates-nothing', ok: findings.length === 0, findings };
};

/**
 * The packaged command a maintainer types and an agent runs, driven as a real
 * child process against a real activated clone.
 *
 * `observationMutatesNothing` above proves the library. This proves the thing
 * anybody can actually reach: the same clone, observed through `gate.mjs`,
 * reports its health, renders that health identically to a person and to a
 * parser, refuses the confirmed operations by name, and leaves the clone and
 * its Evidence store byte for byte as it found them (`AC-LIFE-004`,
 * `AC-EVID-002`, `NFR-OPER-001`, `SG-LIFE-001`).
 */
const packagedObservation = async () => {
  const findings = [];
  const { root, store } = await fixtureClone();
  // Authoritative Git alone: a desktop surface this fixture pins but never
  // registers is a drifted clone, and this scenario wants a healthy one.
  const activated = await activateFixture(root, store, {
    adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
  });

  check(findings, activated.activated === true, `The fixture failed to activate: ${activated.reasonCode}.`);

  if (!activated.activated) {
    return { name: 'packaged-observation', ok: false, findings };
  }

  const gate = (args) => runFile(process.execPath, [PACKAGED_COMMAND, ...args], {
    cwd: root,
    env: gitEnvironment(),
  }).catch((error) => error);

  const before = await snapshotOf(root);
  const blobsBefore = (await store.listBlobs()).length;
  const eventsBefore = (await store.readEvents()).length;

  const machine = await gate(['status', '--json']);
  const document = JSON.parse(machine.stdout || '{}');

  check(findings, (machine.code ?? 0) === 0, `An activated clone exited ${machine.code} from gate status.`);
  check(findings, document.observation?.health === 'healthy', `The packaged command reported ${document.observation?.health}.`);
  check(findings, document.observation?.state === 'activated', `The packaged command reported state ${document.observation?.state}.`);
  check(findings, document.observation?.repaired === false, 'The packaged command claimed to have repaired something.');

  // The same invocation, rendered for a person: an agent and a maintainer
  // never observe different things.
  const human = await gate(['status']);

  check(findings, human.stdout.includes('healthy'), 'The human rendering did not state the health the document names.');
  check(
    findings,
    (document.observation?.findings ?? []).every((finding) => human.stdout.includes(finding.code)),
    'The human rendering did not name every finding the document carries.',
  );
  check(
    findings,
    human.stdout.includes(document.trustBoundary?.statement ?? ' '),
    'The human rendering did not state the local trust boundary.',
  );

  // The other two observations, through the same program.
  const locks = JSON.parse((await gate(['locks', '--json'])).stdout || '{}');

  check(findings, locks.observation?.held === false, 'A clone with no evaluation running reported a held lock.');
  check(findings, locks.observation?.acquired === false, 'Inspecting the lock acquired it.');
  check(findings, locks.observation?.recovered === false, 'Inspecting the lock recovered it.');

  const prune = JSON.parse((await gate(['prune', '--json'])).stdout || '{}');

  check(findings, prune.observation?.removed === false, 'The prune preview claimed to have removed something.');
  check(
    findings,
    /^sha256:[0-9a-f]{64}$/.test(prune.observation?.confirmationToken ?? ''),
    'The prune preview returned no confirmation token.',
  );
  check(
    findings,
    prune.observation?.blobs?.length === blobsBefore,
    `The prune preview named ${prune.observation?.blobs?.length} blobs of ${blobsBefore}.`,
  );

  // Refusal, by name, of the confirmed half of the lifecycle.
  for (const [args, owner] of [
    [['locks', '--recover'], 'gate locks --recover'],
    [['prune', '--confirm', prune.observation?.confirmationToken ?? 'x'], 'gate prune --confirm'],
    [['repair'], 'gate repair'],
    [['deactivate'], 'gate deactivate'],
  ]) {
    const refused = await gate(args);

    check(findings, refused.code === 2, `gate ${args.join(' ')} exited ${refused.code ?? 0} instead of refusing.`);
    check(
      findings,
      (refused.stderr ?? '').includes(owner),
      `gate ${args.join(' ')} did not name ${owner} as the operation that owns it.`,
    );
  }

  // A broken clone is not a failed invocation, and the difference is readable
  // from the exit status alone.
  const registration = await readFile(path.join(store.gitCommonDirectory, 'hooks', 'pre-commit'), 'utf8');

  await writeFile(
    path.join(store.gitCommonDirectory, 'hooks', 'pre-commit'),
    registration.replace(/\|\| exit \$\?/, '|| true'),
    'utf8',
  );

  const brokenBefore = await snapshotOf(root);
  const broken = await gate(['status', '--json']);
  const brokenDocument = JSON.parse(broken.stdout || '{}');

  check(findings, broken.code === 1, `A broken clone exited ${broken.code ?? 0} rather than 1.`);
  check(findings, brokenDocument.observation?.health === 'broken', `A tampered registration reported ${brokenDocument.observation?.health}.`);
  check(findings, brokenDocument.failure === null, 'An unhealthy clone was reported as a failed invocation.');
  check(
    findings,
    (await snapshotOf(root)) === brokenBefore,
    'Observing a broken clone through the packaged command changed it.',
  );

  // Everything above ran against this clone and its store, and left both
  // exactly as they were.
  check(
    findings,
    (await store.listBlobs()).length === blobsBefore,
    'Observation removed Evidence.',
  );
  check(
    findings,
    (await store.readEvents()).length === eventsBefore,
    'Observation recorded a Lifecycle event.',
  );
  check(findings, before !== brokenBefore, 'The tampering fixture did not change the clone at all.');

  return { name: 'packaged-observation', ok: findings.length === 0, findings };
};

const main = async () => {
  const asJson = process.argv.includes('--json');
  let scenarios = [];

  try {
    scenarios = [
      await packagedUpdate(),
      await packagedRemoval(),
      await observationMutatesNothing(),
      await packagedObservation(),
    ];
  } finally {
    for (const root of temporaryRoots) {
      // The guard again, immediately before the only recursive removal in this
      // capability. A fixture root that somehow escaped is never deleted.
      await assertThrowawayRepository(root);
      await rm(root, { recursive: true, force: true });
    }
  }

  const ok = scenarios.every((scenario) => scenario.ok);
  const report = { capability: CAPABILITY, ok, scenarios };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const scenario of scenarios) {
      process.stdout.write(`${scenario.ok ? 'ok' : 'FAILED'} ${scenario.name}\n`);

      for (const finding of scenario.findings) {
        process.stdout.write(`  - ${finding}\n`);
      }
    }

    process.stdout.write(`${ok ? 'ok' : 'FAILED'} ${CAPABILITY}\n`);
  }

  process.exitCode = ok ? 0 : 1;
};

await main();
