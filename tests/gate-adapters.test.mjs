import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { evaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import {
  ADAPTER_CAPABILITY_CATEGORIES,
  ADAPTER_IDS,
  BASELINE_CHECKS,
  classifySupport,
  describeAdapter,
  normalizeNativeInvocation,
  normalizeTrigger,
  presentDecision,
  runAdapterEvaluation,
  runCompatibilityBaseline,
  SUPPORT_TIERS,
  validateAdapterDeclaration,
} from '../skills/change-evaluation-gate/scripts/lib/adapters.mjs';
import {
  REASON_OUTCOMES,
  validateEvaluationRequest,
} from '../skills/change-evaluation-gate/scripts/lib/evaluation-contract.mjs';

const runFile = promisify(execFile);

/**
 * These fixtures create real Git repositories. Every one of them must be a
 * throwaway repository under the OS temporary directory and never this
 * repository: an escaped fixture would operate on the framework clone's own
 * Git state.
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
    `Refusing to run an adapter fixture outside the OS temporary directory: ${resolved}.`,
  );
  assert.equal(
    isInside(frameworkRoot, resolved),
    false,
    `Refusing to run an adapter fixture inside this repository: ${resolved}.`,
  );

  return resolved;
};

const isolatedGitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const temporaryRoots = [];

const temporaryDirectory = async (prefix) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));

  temporaryRoots.push(directory);
  await assertThrowawayRepository(directory);

  return directory;
};

const createRepository = async (files) => {
  const root = await temporaryDirectory('gate-adapter-repo-');

  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);

    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, 'utf8');
  }

  await runFile('git', ['init', '--quiet'], { cwd: root, env: isolatedGitEnvironment() });
  await runFile('git', ['add', '--all'], { cwd: root, env: isolatedGitEnvironment() });

  return root;
};

test.after(async () => {
  for (const root of temporaryRoots) {
    await assertThrowawayRepository(root);
    await rm(root, { recursive: true, force: true });
  }
});

const command = (args, overrides = {}) => ({
  runner: 'package-script',
  args,
  working_directory: '.',
  timeout_seconds: 60,
  allowed_environment: ['PATH'],
  evidence_category: 'test',
  source_scope: 'both',
  ...overrides,
});

const descriptor = (overrides = {}) => ({
  id: 'node-package.broad-tests.test',
  provider: 'node-package',
  stage: 'broad-tests',
  capability: 'test',
  scope: 'both',
  applicability: { changed_path_globs: ['**'], required_facts: [] },
  prerequisites: [],
  policy: 'required',
  evaluate: command(['run', 'test']),
  fix: null,
  timeout_seconds: 120,
  declared_writes: [],
  evidence: { claims: ['test:broad'], success_exit_codes: [0], report: null },
  order: 10,
  selection: null,
  ...overrides,
});

const evaluationRequest = ({ root, role, trigger, adapter, sessionId = 'session-a' }) => ({
  protocolVersion: '1.0',
  operation: 'evaluate',
  repository: { root },
  change: { kind: 'git-index', baseRevision: 'HEAD' },
  evaluation: { purpose: 'regression-only', contractRef: null },
  invocation: { role, trigger, adapter, sessionId },
});

/** The exact identity the authoritative Git adapter reports for itself. */
const GIT_ADAPTER = {
  id: 'git',
  surface: 'git-pre-commit',
  version: '1.0.0',
  capabilities: { nativeBlocking: true },
};

const DESKTOP_ADAPTER_IDS = ['claude-code-desktop', 'codex-desktop', 'cursor'];

/**
 * One authoritative evaluation whose required check fails. Every adapter in
 * this suite presents *this* decision; nothing is re-evaluated per surface.
 */
const denyingDecision = async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const executionRoot = await temporaryDirectory('gate-adapter-exec-');

  return evaluate(
    evaluationRequest({
      root,
      role: 'authoritative',
      trigger: 'commit-attempt',
      adapter: GIT_ADAPTER,
    }),
    {
      checks: [descriptor()],
      executionRoot,
      execute: async () => ({
        executed: true,
        exitCode: 1,
        timedOut: false,
        error: null,
        durationMs: 7,
      }),
    },
  );
};

test('AC-ADAPT-001: the same deny decision blocks the Git fixture while every desktop fixture presents structured not-authoritative preflight feedback', async () => {
  const decision = await denyingDecision();

  assert.equal(decision.outcome, 'failed');
  assert.equal(decision.authorization, 'deny');

  const git = presentDecision({ adapterId: 'git', decision });

  assert.equal(git.role, 'authoritative');
  assert.equal(git.authorization, 'deny');
  assert.equal(git.blocking, true, 'A deny decision must block the authoritative Git surface.');
  assert.notEqual(git.exitCode, 0, 'A blocked commit must leave a non-zero native status.');
  assert.equal(git.presentation.kind, 'blocked');

  for (const adapterId of DESKTOP_ADAPTER_IDS) {
    const view = presentDecision({ adapterId, decision });

    assert.equal(view.role, 'preflight', `${adapterId} must never claim an authoritative role.`);
    assert.equal(
      view.authorization,
      'not-authoritative',
      `${adapterId} must present the decision without claiming commit authority.`,
    );
    assert.equal(view.blocking, false, `${adapterId} must not block anything.`);
    assert.equal(view.exitCode, 0, `${adapterId} must not fail its host process on a deny.`);
    assert.equal(view.presentation.kind, 'preflight');

    // The feedback is structured, not a rendered string: the same decision
    // content reaches every surface.
    assert.equal(view.outcome, decision.outcome);
    assert.deepEqual(
      view.presentation.checks.map((check) => check.id),
      decision.checks.map((check) => check.id),
    );
    assert.deepEqual(
      view.presentation.checks.map((check) => check.reasonCode),
      decision.checks.map((check) => check.reasonCode),
    );
    assert.equal(view.presentation.evaluationId, decision.evaluationId);
  }
});

test('AC-ADAPT-001 / FR-ADAPT-003: every desktop adapter normalizes its own deterministic completion event to work-complete and refuses every other native event, including another client\'s and its own in the wrong case', () => {
  for (const adapterId of DESKTOP_ADAPTER_IDS) {
    const adapter = describeAdapter(adapterId);
    const nativeEvents = adapter.nativeEvents ?? {};
    const completion = nativeEvents['work-complete'] ?? null;

    assert.notEqual(
      completion,
      null,
      `${adapterId} must declare the deterministic native event it maps to work-complete.`,
    );
    assert.equal(
      normalizeTrigger({ adapterId, nativeEvent: completion }),
      'work-complete',
      `${adapterId} must normalize ${completion} to work-complete.`,
    );

    // No desktop surface provides a deterministic before-commit event, and none
    // of them invents one.
    assert.equal(
      normalizeTrigger({ adapterId, nativeEvent: 'before-commit-attempt' }),
      null,
      `${adapterId} does not provide a before-commit event and must not claim one.`,
    );

    // An unrecognized native event is never guessed into a contract trigger.
    assert.equal(normalizeTrigger({ adapterId, nativeEvent: 'chat.message-sent' }), null);
    assert.equal(normalizeTrigger({ adapterId, nativeEvent: '' }), null);

    // The same event name in the other case belongs to a different client, and
    // matching it would erase a real per-client distinction.
    assert.equal(
      normalizeTrigger({ adapterId, nativeEvent: completion.toLowerCase() === completion
        ? completion.toUpperCase()
        : completion.toLowerCase() }),
      null,
      `${adapterId} matched its own native event ${completion} case-insensitively.`,
    );

    // FR-ADAPT-004: no adapter assumes another client's event contract.
    for (const other of DESKTOP_ADAPTER_IDS.filter((candidate) => candidate !== adapterId)) {
      const foreign = describeAdapter(other).nativeEvents['work-complete'];

      if (foreign !== completion) {
        assert.equal(
          normalizeTrigger({ adapterId, nativeEvent: foreign }),
          null,
          `${adapterId} accepted ${other}'s native event ${foreign}.`,
        );
      }
    }
  }

  // Authoritative Git normalizes its own hook, and nothing else.
  assert.equal(normalizeTrigger({ adapterId: 'git', nativeEvent: 'pre-commit' }), 'commit-attempt');
  assert.equal(normalizeTrigger({ adapterId: 'git', nativeEvent: 'post-commit' }), null);
  assert.equal(normalizeTrigger({ adapterId: 'not-a-v1-client', nativeEvent: 'pre-commit' }), null);
});

/**
 * The observed native contract, per client.
 *
 * These field names and event values were read off real captured payloads from
 * each client (see the adapter qualification findings). Every value in this
 * suite is synthetic; only the SHAPE is taken from the captures, because the
 * real payloads carry conversation text and personal data.
 */
test('TB-013 / FR-ADAPT-004: claude-code-desktop declares the native field names and event value its real client sends', () => {
  const adapter = describeAdapter('claude-code-desktop');

  assert.equal(adapter.nativeIdentity.event, 'hook_event_name');
  assert.equal(adapter.nativeIdentity.sessionId, 'session_id');
  assert.equal(adapter.nativeIdentity.repositoryRoot.field, 'cwd');
  assert.equal(adapter.nativeIdentity.repositoryRoot.shape, 'path');
  assert.equal(adapter.nativeEvents['work-complete'], 'Stop');
  assert.equal(normalizeTrigger({ adapterId: 'claude-code-desktop', nativeEvent: 'Stop' }), 'work-complete');

  // Event casing is a real per-client distinction and must not be erased.
  assert.equal(
    normalizeTrigger({ adapterId: 'claude-code-desktop', nativeEvent: 'stop' }),
    null,
    'This client sends Stop; matching another client\'s lowercase stop would lose that distinction.',
  );
});

test('TB-013 / FR-ADAPT-004: codex-desktop declares the native field names and event value its real client sends', () => {
  const adapter = describeAdapter('codex-desktop');

  assert.equal(adapter.nativeIdentity.event, 'hook_event_name');
  assert.equal(adapter.nativeIdentity.sessionId, 'session_id');
  assert.equal(adapter.nativeIdentity.repositoryRoot.field, 'cwd');
  assert.equal(adapter.nativeIdentity.repositoryRoot.shape, 'path');
  assert.equal(adapter.nativeEvents['work-complete'], 'Stop');
  assert.equal(normalizeTrigger({ adapterId: 'codex-desktop', nativeEvent: 'Stop' }), 'work-complete');
  assert.equal(normalizeTrigger({ adapterId: 'codex-desktop', nativeEvent: 'stop' }), null);
});

test('TB-013 / FR-ADAPT-004: cursor declares the native field names, the lowercase event value, and the array-shaped workspace roots its real client sends', () => {
  const adapter = describeAdapter('cursor');

  assert.equal(adapter.nativeIdentity.event, 'hook_event_name');
  assert.equal(adapter.nativeIdentity.sessionId, 'session_id');
  assert.equal(adapter.nativeIdentity.repositoryRoot.field, 'workspace_roots');
  assert.equal(
    adapter.nativeIdentity.repositoryRoot.shape,
    'path-array',
    'Cursor sends an array of workspace roots, not a scalar path.',
  );
  assert.equal(adapter.nativeEvents['work-complete'], 'stop');
  assert.equal(normalizeTrigger({ adapterId: 'cursor', nativeEvent: 'stop' }), 'work-complete');
  assert.equal(
    normalizeTrigger({ adapterId: 'cursor', nativeEvent: 'Stop' }),
    null,
    'Cursor sends lowercase stop; accepting the capitalised value would assume another client\'s contract.',
  );

  // Cursor self-reports its exact client version in every payload.
  assert.equal(adapter.nativeIdentity.clientVersion, 'cursor_version');
  assert.equal(describeAdapter('claude-code-desktop').nativeIdentity.clientVersion, null);
  assert.equal(describeAdapter('codex-desktop').nativeIdentity.clientVersion, null);
});

test('TB-013 / FR-ADAPT-003: no desktop surface declares a commit-attempt event, and cursor records its unproved one instead of claiming it', () => {
  for (const adapterId of DESKTOP_ADAPTER_IDS) {
    const adapter = describeAdapter(adapterId);

    assert.equal(
      'commit-attempt' in adapter.nativeEvents,
      false,
      `${adapterId} declares a commit-attempt native event that its real client does not emit.`,
    );
    assert.deepEqual(
      [...adapter.capabilities.event.normalizedTriggers],
      ['work-complete'],
      `${adapterId} advertises a normalized trigger it cannot deliver.`,
    );

    for (const nativeEvent of [
      'commit-attempt',
      'pre-commit',
      'code-tab.before-commit',
      'agent.before-commit',
    ]) {
      assert.notEqual(
        normalizeTrigger({ adapterId, nativeEvent }),
        'commit-attempt',
        `${adapterId} normalized ${nativeEvent} to a trigger no client event produces.`,
      );
    }
  }

  // The absences are not the same absence, and each adapter says which it has.
  // Claude Code's and Codex's pre-commit events are known not to exist;
  // Cursor's is simply unobserved, and recording it keeps that open question
  // alive without letting the surface claim the capability (Q-004).
  assert.deepEqual([...describeAdapter('claude-code-desktop').unverifiedTriggers], []);
  assert.deepEqual([...describeAdapter('codex-desktop').unverifiedTriggers], []);
  assert.deepEqual([...describeAdapter('cursor').unverifiedTriggers], ['commit-attempt']);
  assert.deepEqual([...describeAdapter('git').unverifiedTriggers], []);

  for (const adapterId of ADAPTER_IDS) {
    const adapter = describeAdapter(adapterId);

    for (const trigger of adapter.unverifiedTriggers) {
      assert.equal(
        adapter.capabilities.event.normalizedTriggers.includes(trigger),
        false,
        `${adapterId} advertises ${trigger} as a normalized trigger while recording it as unverified.`,
      );
      assert.equal(trigger in adapter.nativeEvents, false);
    }
  }

  // Authoritative Git still owns commit-attempt; only it ever had the event.
  assert.equal(normalizeTrigger({ adapterId: 'git', nativeEvent: 'pre-commit' }), 'commit-attempt');
  assert.deepEqual([...describeAdapter('git').capabilities.event.normalizedTriggers], ['commit-attempt']);
});

const CAPABILITY_CATEGORIES = [
  'blocking',
  'event',
  'filesystem',
  'git',
  'invocation',
  'repository',
  'session',
  'trust',
];

test('FR-ADAPT-004: every v1 adapter declares its own event, blocking, trust, repository, session, filesystem, Git, and invocation capabilities instead of inheriting another client contract', () => {
  assert.deepEqual(
    [...ADAPTER_CAPABILITY_CATEGORIES].sort(),
    CAPABILITY_CATEGORIES,
    'The declared capability categories are fixed by FR-ADAPT-004.',
  );

  const declarations = [];

  for (const adapterId of ADAPTER_IDS) {
    const adapter = describeAdapter(adapterId);

    assert.deepEqual(
      Object.keys(adapter.capabilities ?? {}).sort(),
      CAPABILITY_CATEGORIES,
      `${adapterId} must declare every capability category explicitly.`,
    );
    assert.equal(
      validateAdapterDeclaration(adapter.capabilities).length,
      0,
      `${adapterId} has an invalid capability declaration.`,
    );

    // A declaration is the adapter's own frozen statement about itself, not a
    // shared default object that silently applies another client's contract.
    assert.equal(Object.isFrozen(adapter.capabilities), true, `${adapterId} must freeze its declaration.`);
    assert.equal(
      declarations.some((other) => other === adapter.capabilities),
      false,
      `${adapterId} reuses another adapter's declaration object.`,
    );
    declarations.push(adapter.capabilities);
  }

  // A declaration that omits a category, or invents one, is invalid rather
  // than silently defaulted.
  const complete = describeAdapter('cursor').capabilities;

  for (const category of CAPABILITY_CATEGORIES) {
    const partial = { ...complete };

    delete partial[category];

    assert.equal(
      validateAdapterDeclaration(partial).some((error) => error.path === `capabilities.${category}`),
      true,
      `A declaration missing ${category} must be rejected, not defaulted.`,
    );
  }

  assert.equal(
    validateAdapterDeclaration({ ...complete, telemetry: {} })
      .some((error) => error.code === 'adapter-capability-unknown'),
    true,
    'An undeclared capability category must be rejected rather than ignored.',
  );

  // FR-ADAPT-007: only the authoritative Git surface declares native blocking,
  // and the desktop surfaces declare that they have none.
  assert.equal(describeAdapter('git').capabilities.blocking.native, true);

  for (const adapterId of DESKTOP_ADAPTER_IDS) {
    const capabilities = describeAdapter(adapterId).capabilities;

    assert.equal(capabilities.blocking.native, false, `${adapterId} must not claim native blocking.`);
    assert.equal(capabilities.invocation.nonInteractive, true);
    assert.equal(capabilities.repository.localFilesystemRoot, true);
    assert.equal(capabilities.git.metadata, true);
    assert.equal(capabilities.session.parallelIsolation, true);
  }
});

/** The client-independent skeleton an adapter is handed for one invocation. */
const invocationContext = (root) => ({
  repository: { root },
  change: { kind: 'worktree', baseRevision: 'HEAD' },
  evaluation: { purpose: 'regression-only', contractRef: null },
  session: { id: 'session-desktop-a' },
});

const passingDependencies = (overrides = {}) => ({
  evaluate: async (request) => evaluate(request, {
    checks: [descriptor()],
    executionRoot: overrides.executionRoot ?? null,
    execute: async () => ({
      executed: true,
      exitCode: 0,
      timedOut: false,
      error: null,
      durationMs: 4,
    }),
  }),
  establishTrust: async () => ({ established: true, detail: 'workspace grant present' }),
  ...overrides,
});

test('FR-ADAPT-005: trust, invocation, timeout, capability, and malformed-output failures all present as unverified and never as a clean preflight', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const executionRoot = await temporaryDirectory('gate-adapter-exec-ok-');
  const context = invocationContext(root);

  // The contrast case: a healthy preflight really does look clean.
  const healthy = await runAdapterEvaluation(
    { adapterId: 'cursor', nativeEvent: 'stop', context },
    passingDependencies({ executionRoot }),
  );

  assert.equal(healthy.outcome, 'passed');
  assert.equal(healthy.presentation.kind, 'preflight');
  assert.equal(healthy.failure, null);

  const families = [
    {
      family: 'trust',
      reasonCode: 'prerequisite-missing',
      nativeEvent: 'stop',
      dependencies: passingDependencies({
        executionRoot,
        establishTrust: async () => ({ established: false, detail: 'the workspace grant was revoked' }),
      }),
    },
    {
      family: 'invocation',
      reasonCode: 'crash',
      nativeEvent: 'stop',
      dependencies: passingDependencies({
        executionRoot,
        evaluate: async () => {
          throw new Error('spawn gate ENOENT');
        },
      }),
    },
    {
      family: 'timeout',
      reasonCode: 'timeout',
      nativeEvent: 'stop',
      dependencies: passingDependencies({
        executionRoot,
        timeoutMs: 5,
        evaluate: () => new Promise(() => {}),
      }),
    },
    {
      family: 'capability',
      reasonCode: 'configuration-invalid',
      // Cursor declares no such native event; the surface cannot serve this
      // invocation and must not guess a trigger for it.
      nativeEvent: 'chat.message-sent',
      dependencies: passingDependencies({ executionRoot }),
    },
    {
      family: 'output',
      reasonCode: 'malformed-output',
      nativeEvent: 'stop',
      dependencies: passingDependencies({
        executionRoot,
        evaluate: async () => ({ verdict: 'looks fine to me' }),
      }),
    },
  ];

  for (const { family, reasonCode, nativeEvent, dependencies } of families) {
    const result = await runAdapterEvaluation({ adapterId: 'cursor', nativeEvent, context }, dependencies);

    assert.equal(result.outcome, 'unverified', `A ${family} failure produced ${result.outcome}.`);
    assert.equal(result.failure?.family, family);
    assert.equal(result.failure?.reasonCode, reasonCode);
    assert.equal(
      REASON_OUTCOMES[result.failure.reasonCode],
      'unverified',
      `${reasonCode} must be a contract reason that normalizes to unverified.`,
    );

    // A broken adapter must never be mistakable for a clean preflight.
    assert.notEqual(result.presentation.kind, 'preflight');
    assert.equal(result.presentation.kind, 'unverified');
    assert.equal(result.authorization, 'not-authoritative');
    assert.equal(result.blocking, false);
  }

  // The same failure on the authoritative surface can only ever deny.
  const authoritative = await runAdapterEvaluation(
    { adapterId: 'git', nativeEvent: 'pre-commit', context },
    passingDependencies({
      executionRoot,
      evaluate: async () => {
        throw new Error('spawn gate ENOENT');
      },
    }),
  );

  assert.equal(authoritative.outcome, 'unverified');
  assert.equal(authoritative.authorization, 'deny');
  assert.equal(authoritative.blocking, true);
});

/**
 * Client-native payloads, each in the shape its own client really sends, each
 * carrying fields the Gate has no business seeing. None of this may cross the
 * boundary.
 *
 * The SHAPE — the field names, the event-value casing, the array-ness of
 * Cursor's workspace roots, and the presence of conversation text and personal
 * data — is taken from real captures. Every VALUE here is synthetic. Real
 * captures carry the user's own conversation content and email address and must
 * never enter this repository (SG-SECRET-001).
 */
const NATIVE_PAYLOADS = {
  'claude-code-desktop': (root) => ({
    session_id: 'synthetic-claude-session',
    transcript_path: '/synthetic/transcripts/claude/conversation.jsonl',
    cwd: root,
    prompt_id: 'synthetic-prompt-id',
    permission_mode: 'synthetic-permission-mode',
    effort: 'synthetic-effort',
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'synthetic assistant reply that must never cross the boundary',
    background_tasks: [],
    session_crons: [],
  }),
  'codex-desktop': (root) => ({
    session_id: 'synthetic-codex-session',
    turn_id: 'synthetic-turn-id',
    transcript_path: '/synthetic/transcripts/codex/conversation.jsonl',
    cwd: root,
    hook_event_name: 'Stop',
    model: 'synthetic-model',
    permission_mode: 'synthetic-permission-mode',
    stop_hook_active: false,
    last_assistant_message: 'synthetic assistant reply that must never cross the boundary',
  }),
  cursor: (root) => ({
    conversation_id: 'synthetic-conversation-id',
    generation_id: 'synthetic-generation-id',
    model: 'synthetic-model',
    model_id: 'synthetic-model-id',
    model_params: { temperature: 0 },
    status: 'synthetic-status',
    loop_count: 1,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    session_id: 'synthetic-cursor-session',
    hook_event_name: 'stop',
    cursor_version: '0.0.0-synthetic',
    workspace_roots: [root],
    user_email: 'synthetic-user@example.test',
    transcript_path: '/synthetic/transcripts/cursor/conversation.jsonl',
  }),
};

/** Every leaf key and string value in one object graph. */
const flatten = (value, keys = new Set(), values = new Set()) => {
  if (Array.isArray(value)) {
    value.forEach((entry) => flatten(entry, keys, values));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      keys.add(key);
      flatten(entry, keys, values);
    }
  } else if (typeof value === 'string') {
    values.add(value);
  }

  return { keys, values };
};

test('FR-ADAPT-003 / NFR-COMP-001: each adapter normalizes its own native payload into contract identity and no native payload field reaches gate core', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const executionRoot = await temporaryDirectory('gate-adapter-exec-native-');

  for (const adapterId of DESKTOP_ADAPTER_IDS) {
    const native = NATIVE_PAYLOADS[adapterId](root);
    const seen = [];

    // The gate-side context carries what the *repository* decides, never what
    // the client sent: no repository root and no session identity here.
    const context = {
      change: { kind: 'worktree', baseRevision: 'HEAD' },
      evaluation: { purpose: 'regression-only', contractRef: null },
    };

    const result = await runAdapterEvaluation(
      { adapterId, native, context },
      passingDependencies({
        executionRoot,
        evaluate: async (request) => {
          seen.push(request);

          return evaluate(request, {
            checks: [descriptor()],
            executionRoot,
            execute: async () => ({
              executed: true,
              exitCode: 0,
              timedOut: false,
              error: null,
              durationMs: 3,
            }),
          });
        },
      }),
    );

    assert.equal(result.outcome, 'passed', `${adapterId} failed to normalize its own native payload.`);
    assert.equal(seen.length, 1);

    const [request] = seen;

    // Identity really was extracted from the native payload.
    assert.equal(request.repository.root, root);
    assert.equal(request.invocation.trigger, 'work-complete');
    assert.equal(request.invocation.adapter.id, adapterId);

    const identity = normalizeNativeInvocation({ adapterId, native });

    assert.equal(identity.repositoryRootCandidate, root);
    assert.equal(request.invocation.sessionId, identity.sessionId);
    assert.notEqual(identity.sessionId, null);

    // ...and nothing else did. The request gate core receives is exactly the
    // process contract's shape, byte for byte, with no native residue.
    assert.equal(validateEvaluationRequest(request).length, 0);
    assert.deepEqual(request, {
      protocolVersion: '1.0',
      operation: 'evaluate',
      repository: { root },
      change: { kind: 'worktree', baseRevision: 'HEAD' },
      evaluation: { purpose: 'regression-only', contractRef: null },
      invocation: {
        role: 'preflight',
        trigger: 'work-complete',
        adapter: {
          id: adapterId,
          surface: describeAdapter(adapterId).surface,
          version: describeAdapter(adapterId).version,
          capabilities: { nativeBlocking: false },
        },
        sessionId: identity.sessionId,
      },
    });

    const crossed = flatten(request);
    const nativeShape = flatten(native);

    for (const value of nativeShape.values) {
      if (value === root || value === identity.sessionId) {
        continue;
      }

      assert.equal(
        crossed.values.has(value),
        false,
        `${adapterId} leaked the native value ${JSON.stringify(value)} into the evaluation request.`,
      );
    }
  }

  // FR-ADAPT-004: one client's payload is unreadable to another client's
  // adapter, and an unreadable payload is a capability failure, not a guess.
  const foreign = await runAdapterEvaluation(
    { adapterId: 'codex-desktop', native: NATIVE_PAYLOADS.cursor(root), context: {
      change: { kind: 'worktree', baseRevision: 'HEAD' },
      evaluation: { purpose: 'regression-only', contractRef: null },
    } },
    passingDependencies({ executionRoot }),
  );

  assert.equal(foreign.outcome, 'unverified');
  assert.equal(foreign.failure.family, 'capability');
});

test('TB-013 / FR-ADAPT-002 / FR-ADAPT-005: a desktop adapter RESOLVES a repository root from the path its client sent, and reports unverified when none resolves', async () => {
  const root = await createRepository({
    'src/order.txt': 'original\n',
    'packages/api/src/order.ts': 'export const order = 1;\n',
  });
  const outsideAnyRepository = await temporaryDirectory('gate-adapter-not-a-repo-');
  const executionRoot = await temporaryDirectory('gate-adapter-exec-resolve-');
  const context = {
    change: { kind: 'worktree', baseRevision: 'HEAD' },
    evaluation: { purpose: 'regression-only', contractRef: null },
  };

  // Each surface declares for itself whether its path is already a root.
  assert.equal(describeAdapter('claude-code-desktop').nativeIdentity.repositoryRoot.resolution, 'resolve-upward');
  assert.equal(describeAdapter('codex-desktop').nativeIdentity.repositoryRoot.resolution, 'resolve-upward');
  assert.equal(describeAdapter('cursor').nativeIdentity.repositoryRoot.resolution, 'resolve-upward');
  assert.equal(
    describeAdapter('git').nativeIdentity.repositoryRoot.resolution,
    'declared-root',
    'Git invokes its hook at the repository root by its own contract and declares that separately.',
  );

  const drive = async (adapterId, nativePath) => {
    const seen = [];
    const declaration = describeAdapter(adapterId).nativeIdentity.repositoryRoot;
    const result = await runAdapterEvaluation(
      {
        adapterId,
        native: {
          ...NATIVE_PAYLOADS[adapterId](root),
          [declaration.field]: declaration.shape === 'path-array' ? [nativePath] : nativePath,
        },
        context,
      },
      passingDependencies({
        executionRoot,
        evaluate: async (request) => {
          seen.push(request);

          return evaluate(request, {
            checks: [descriptor()],
            executionRoot,
            execute: async () => ({
              executed: true,
              exitCode: 0,
              timedOut: false,
              error: null,
              durationMs: 3,
            }),
          });
        },
      }),
    );

    return { result, request: seen[0] ?? null };
  };

  for (const adapterId of DESKTOP_ADAPTER_IDS) {
    // Observed in the wild: the path a client sends is sometimes a repository
    // root...
    const atRoot = await drive(adapterId, root);

    assert.equal(atRoot.result.outcome, 'passed', `${adapterId} could not use a path that is a repository root.`);
    assert.equal(atRoot.request.repository.root, root);

    // ...and sometimes a path inside one. The adapter must resolve, not assume.
    const insideRepository = await drive(adapterId, path.join(root, 'packages/api/src'));

    assert.equal(
      insideRepository.result.outcome,
      'passed',
      `${adapterId} could not resolve a repository root from a path inside the repository.`,
    );
    assert.equal(
      insideRepository.request.repository.root,
      root,
      `${adapterId} handed gate core a path that is not a repository root.`,
    );

    // And sometimes it is inside no repository at all, which is unverified.
    const nowhere = await drive(adapterId, outsideAnyRepository);

    assert.equal(
      nowhere.result.outcome,
      'unverified',
      `${adapterId} claimed a repository root where none exists.`,
    );
    assert.equal(nowhere.result.failure.family, 'capability');
    assert.match(nowhere.result.failure.detail, /repositor/i);
    assert.equal(nowhere.request, null, 'A path with no repository above it must never reach gate core.');
  }
});

test('TB-013 / FR-ADAPT-005: cursor reads its workspace_roots ARRAY, and a multi-root workspace is unverified rather than one guessed root', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const otherRoot = await createRepository({ 'src/invoice.txt': 'original\n' });
  const executionRoot = await temporaryDirectory('gate-adapter-exec-roots-');
  const context = {
    change: { kind: 'worktree', baseRevision: 'HEAD' },
    evaluation: { purpose: 'regression-only', contractRef: null },
  };

  const drive = async (workspaceRoots) => {
    const seen = [];
    const result = await runAdapterEvaluation(
      {
        adapterId: 'cursor',
        native: { ...NATIVE_PAYLOADS.cursor(root), workspace_roots: workspaceRoots },
        context,
      },
      passingDependencies({
        executionRoot,
        evaluate: async (request) => {
          seen.push(request);

          return evaluate(request, {
            checks: [descriptor()],
            executionRoot,
            execute: async () => ({
              executed: true,
              exitCode: 0,
              timedOut: false,
              error: null,
              durationMs: 3,
            }),
          });
        },
      }),
    );

    return { result, request: seen[0] ?? null };
  };

  // A single-root workspace: the one element really is read out of the array.
  const single = await drive([root]);

  assert.equal(single.result.outcome, 'passed', 'A single-root workspace_roots array must be readable.');
  assert.equal(single.request.repository.root, root);

  // A multi-root workspace has no single repository root. Selecting an element
  // would be a guess, so the honest answer is unverified.
  const multi = await drive([root, otherRoot]);

  assert.equal(multi.result.outcome, 'unverified');
  assert.equal(multi.result.failure.family, 'capability');
  assert.match(
    multi.result.failure.detail,
    /multi-root workspace has no single repository root/,
    'A multi-root workspace must be reported as exactly that, not as a generic unreadable payload.',
  );
  assert.equal(multi.request, null, 'A guessed repository root must never reach gate core.');

  // An empty array is no root at all, and a scalar is not this client's
  // declared shape. Neither may be quietly accepted.
  for (const workspaceRoots of [[], root, null]) {
    const rejected = await drive(workspaceRoots);

    assert.equal(
      rejected.result.outcome,
      'unverified',
      `cursor accepted ${JSON.stringify(workspaceRoots)} as a workspace_roots value.`,
    );
    assert.equal(rejected.result.failure.family, 'capability');
    assert.equal(rejected.request, null);
  }
});

/** Everything the baseline needs that is not the adapter itself. */
const baselineDependencies = (root, overrides = {}) => ({
  evaluate: async (request) => evaluate(request, {
    checks: [descriptor()],
    executionRoot: overrides.executionRoot ?? null,
    execute: async () => ({
      executed: true,
      exitCode: 0,
      timedOut: false,
      error: null,
      durationMs: 3,
    }),
  }),
  runGit: async (args) => {
    const { stdout } = await runFile('git', args, { cwd: root, env: isolatedGitEnvironment() });

    return stdout.trim();
  },
  versions: {
    gate: 'change-evaluation-gate/0.9.0',
    node: process.version,
    os: `${process.platform} ${process.arch}`,
    client: '2026.08.1',
  },
  clock: () => new Date('2026-08-11T12:00:00.000Z'),
  ...overrides,
});

test('AC-ADAPT-002 / SG-SUPPORT-001 / NFR-COMP-001: every named desktop surface passes the shared baseline without native blocking, and the exact versions and per-check outcomes are recorded', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const executionRoot = await temporaryDirectory('gate-adapter-exec-baseline-');

  assert.ok(BASELINE_CHECKS.length >= 8, 'The shared baseline must cover every NFR-COMP-001 dimension.');
  assert.ok(BASELINE_CHECKS.includes('declared-native-blocking'));
  assert.ok(BASELINE_CHECKS.includes('deterministic-event'));
  assert.ok(BASELINE_CHECKS.includes('trust-failure-unverified'));

  for (const adapterId of DESKTOP_ADAPTER_IDS) {
    const result = await runCompatibilityBaseline(
      { adapterId, repositoryRoot: root },
      baselineDependencies(root, { executionRoot }),
    );

    assert.equal(result.passed, true, `${adapterId} failed the shared baseline: ${JSON.stringify(result.checks?.filter((check) => !check.ok))}`);
    assert.deepEqual(
      result.checks.map((check) => check.id),
      [...BASELINE_CHECKS],
      `${adapterId} must report an outcome for every baseline check.`,
    );

    // SG-SUPPORT-001 / FR-ADAPT-007: no native blocking, and it still passes.
    assert.equal(describeAdapter(adapterId).capabilities.blocking.native, false);
    assert.equal(result.checks.every((check) => check.ok), true);

    // AC-ADAPT-002: exact versions and outcomes are recorded, not summarized.
    for (const field of ['gate', 'git', 'node', 'os', 'client']) {
      assert.equal(
        typeof result.versions[field] === 'string' && result.versions[field].length > 0,
        true,
        `${adapterId} recorded no exact ${field} version.`,
      );
    }

    assert.equal(result.adapterId, adapterId);
    assert.equal(result.surface, describeAdapter(adapterId).surface);
    assert.equal(result.recordedAt, '2026-08-11T12:00:00.000Z');
  }

  // A surface whose baseline really fails is reported as failing that exact
  // check, and never quietly as a pass.
  const broken = await runCompatibilityBaseline(
    { adapterId: 'cursor', repositoryRoot: root },
    baselineDependencies(root, {
      executionRoot,
      establishTrust: async () => ({ established: true }),
      evaluate: async () => ({ verdict: 'looks fine to me' }),
    }),
  );

  assert.equal(broken.passed, false);
  assert.equal(broken.checks.some((check) => !check.ok), true);
  assert.equal(
    broken.checks.every((check) => typeof check.detail === 'string'),
    true,
    'Every baseline outcome must record why it holds or fails.',
  );
});

test('TB-013 / AC-ADAPT-002 / SG-SUPPORT-001: a baseline records how it was driven, and a surface proved only by injected payloads cannot claim supported', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const executionRoot = await temporaryDirectory('gate-adapter-exec-evidence-');
  const localCapabilities = { repositoryFilesystem: true, processExecution: true, git: true };

  for (const adapterId of DESKTOP_ADAPTER_IDS) {
    // The baseline this repository can run offline injects payloads built from
    // each adapter's own declaration. That proves the declaration is coherent;
    // it does not prove a real client ever invoked the adapter.
    const fixtureDriven = await runCompatibilityBaseline(
      { adapterId, repositoryRoot: root },
      baselineDependencies(root, { executionRoot }),
    );

    assert.equal(fixtureDriven.passed, true);
    assert.equal(
      fixtureDriven.evidence.payloadSource,
      'synthetic-fixture',
      'A baseline must record how it was driven, and an unstated source must default to the conservative answer.',
    );

    const onFixtures = classifySupport({
      adapterId,
      variant: 'desktop',
      capabilities: localCapabilities,
      baseline: fixtureDriven,
    });

    assert.equal(
      onFixtures.tier,
      'experimental',
      `${adapterId} claimed supported on injected-payload evidence alone.`,
    );
    assert.equal(onFixtures.reason, 'client-invocation-not-observed');

    // Q-004: this is evidence-based, not a permanent denial. The same passing
    // baseline, recorded against a real client invocation, is supported.
    const clientDriven = await runCompatibilityBaseline(
      { adapterId, repositoryRoot: root },
      baselineDependencies(root, {
        executionRoot,
        evidence: { payloadSource: 'captured-client-invocation' },
      }),
    );

    assert.equal(clientDriven.evidence.payloadSource, 'captured-client-invocation');
    assert.equal(
      classifySupport({
        adapterId,
        variant: 'desktop',
        capabilities: localCapabilities,
        baseline: clientDriven,
      }).tier,
      'supported',
    );
  }
});

test('FR-ADAPT-006 / SG-SUPPORT-001: only a named desktop surface with a passing baseline is supported, unproved variants are experimental, and a context without repository, process, and Git access cannot claim support', async () => {
  const root = await createRepository({ 'src/order.txt': 'original\n' });
  const executionRoot = await temporaryDirectory('gate-adapter-exec-tiers-');

  assert.deepEqual([...SUPPORT_TIERS], ['supported', 'experimental', 'unsupported']);

  const localCapabilities = {
    repositoryFilesystem: true,
    processExecution: true,
    git: true,
  };

  for (const adapterId of DESKTOP_ADAPTER_IDS) {
    // The strongest evidence a surface can hold: a passing baseline that a real
    // client invocation drove. Everything below removes one part of it.
    const baseline = await runCompatibilityBaseline(
      { adapterId, repositoryRoot: root },
      baselineDependencies(root, {
        executionRoot,
        evidence: { payloadSource: 'captured-client-invocation' },
      }),
    );

    assert.equal(
      classifySupport({ adapterId, variant: 'desktop', capabilities: localCapabilities, baseline }).tier,
      'supported',
      `${adapterId} passed its baseline on its declared surface and must be supported.`,
    );

    // SG-SUPPORT-001: the declaration alone never earns the label.
    const unproved = classifySupport({
      adapterId,
      variant: 'desktop',
      capabilities: localCapabilities,
      baseline: null,
    });

    assert.equal(unproved.tier, 'experimental');
    assert.equal(unproved.reason, 'baseline-not-run');

    const failed = classifySupport({
      adapterId,
      variant: 'desktop',
      capabilities: localCapabilities,
      baseline: { ...baseline, passed: false, failedChecks: ['git-access'] },
    });

    assert.equal(failed.tier, 'experimental');
    assert.equal(failed.reason, 'baseline-failed');
  }

  // FR-ADAPT-006: unproved variants of an otherwise supported client.
  for (const variant of ['cli', 'ssh', 'remote', 'cloud', 'background-agent']) {
    const classification = classifySupport({
      adapterId: 'cursor',
      variant,
      capabilities: localCapabilities,
      baseline: null,
    });

    assert.equal(classification.tier, 'experimental', `${variant} must not be supported in v1.`);
  }

  // A remote or cloud variant cannot buy support with a passing local baseline.
  const remote = await runCompatibilityBaseline(
    { adapterId: 'cursor', repositoryRoot: root },
    baselineDependencies(root, { executionRoot }),
  );

  assert.equal(
    classifySupport({ adapterId: 'cursor', variant: 'cloud', capabilities: localCapabilities, baseline: remote }).tier,
    'experimental',
  );

  // FR-ADAPT-006: chat-only and hosted surfaces without repository, process,
  // and Git access are unsupported, whatever they claim.
  const hosted = [
    { repositoryFilesystem: false, processExecution: true, git: true },
    { repositoryFilesystem: true, processExecution: false, git: true },
    { repositoryFilesystem: true, processExecution: true, git: false },
  ];

  for (const capabilities of hosted) {
    const classification = classifySupport({
      adapterId: 'cursor',
      variant: 'desktop',
      capabilities,
      baseline: remote,
    });

    assert.equal(classification.tier, 'unsupported');
    assert.equal(classification.reason, 'repository-execution-unavailable');
  }

  // Q-003: a client that is not in the v1 set cannot reach supported at all.
  assert.equal(
    classifySupport({
      adapterId: 'some-other-client',
      variant: 'desktop',
      capabilities: localCapabilities,
      baseline: { passed: true, failedChecks: [] },
    }).tier,
    'unsupported',
  );
});

/**
 * A boundary guard, in the shape TB-003 established for stack names.
 *
 * NOTE FOR REVIEW: this test was green the first time it ran. It is a guard
 * against a regression that has not happened yet, not evidence of behavior
 * this slice introduced — gate core carried no client-name branch before
 * TB-013 and must not acquire one now.
 */
test('FR-ADAPT-003 prohibited behavior: gate core carries no client-name branch, and no desktop surface can authorize a change', async () => {
  const coreRoot = path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib');
  const clientNames = /\b(cursor|codex|claude|copilot|vscode|jetbrains|intellij|windsurf|zed)\b/i;

  for (const module of [
    'gate-core.mjs',
    'evaluate.mjs',
    'evaluation-contract.mjs',
    'policy.mjs',
    'check-descriptor.mjs',
    'command-descriptor.mjs',
    'snapshot.mjs',
    'delivery-contract.mjs',
  ]) {
    assert.doesNotMatch(
      await readFile(path.join(coreRoot, module), 'utf8'),
      clientNames,
      `Gate core module ${module} branches on a client name.`,
    );
  }

  // The client names live in exactly one place: the adapter layer that owns
  // the native boundary.
  assert.match(await readFile(path.join(coreRoot, 'adapters.mjs'), 'utf8'), clientNames);

  // FR-ADAPT-001 / FR-ADAPT-007: whatever the decision says, a preflight
  // surface presents `not-authoritative` and never allow or deny.
  for (const outcome of ['passed', 'failed', 'unverified', 'bypassed']) {
    for (const adapterId of DESKTOP_ADAPTER_IDS) {
      const view = presentDecision({
        adapterId,
        decision: { outcome, evaluationId: null, checks: [], authorization: 'allow' },
      });

      assert.equal(view.authorization, 'not-authoritative', `${adapterId} claimed authority on ${outcome}.`);
      assert.equal(view.blocking, false);
    }

    // Only authoritative Git turns an outcome into an authorization.
    assert.equal(
      ['allow', 'deny'].includes(
        presentDecision({ adapterId: 'git', decision: { outcome, evaluationId: null, checks: [] } }).authorization,
      ),
      true,
    );
  }
});
