#!/usr/bin/env node
/**
 * `gate-evidence-prune-smoke` — bounded immutable Evidence and pruning.
 *
 * Proves, against a real materialized Evaluation snapshot, real spawned check
 * processes, and a real on-disk Evidence store under a throwaway repository's
 * Git common directory:
 *
 * 1. `bounded-redacted-append` — an evaluation appends one canonical,
 *    content-addressed envelope at the Git-common location; every retained
 *    excerpt is bounded to 32 KiB while preserving the beginning and the end of
 *    the output with its redacted and omitted byte counts; and a secret canary
 *    planted in captured output appears nowhere in the persisted store
 *    (AC-EVID-001, SG-SECRET-001).
 * 2. `preview-mismatch-removes-nothing` — a prune preview identifies the exact
 *    blobs and bytes, and a confirmation that does not reproduce it removes
 *    nothing and records a refusal, never a successful deletion (AC-EVID-002).
 * 3. `confirmed-prune-preserves-audit-trail` — a matching confirmation removes
 *    only the previewed blobs and preserves envelopes, decisions, Lifecycle
 *    events, pruning records, and a tombstone for every removed blob
 *    (AC-EVID-002, SG-EVID-001).
 *
 * It is non-interactive and offline. Every fixture is a throwaway Git
 * repository, every command is a repository script executed by this Node
 * runtime, and no external toolchain is required. It never touches this
 * repository's Git state and never deletes anything automatically.
 *
 * The store it exercises is cooperative local state, not tamper-proof: this
 * capability proves the gate's own behavior, never that a machine owner cannot
 * edit these files (SG-TRUST-001).
 *
 * Usage:
 *   node skills/change-evaluation-gate/scripts/gate-evidence-prune-smoke.mjs [--json]
 *
 * Exit status is 0 only when every scenario holds.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createBoundedExecutor } from './lib/bounded-execution.mjs';
import { evaluate } from './lib/evaluate.mjs';
import { validateDecision } from './lib/evaluation-contract.mjs';
import { EVIDENCE_CEILINGS } from './lib/evidence-bounds.mjs';
import { openEvidenceStore } from './lib/evidence-store.mjs';
import { collectChecks } from './lib/gate-core.mjs';
import { validateLifecycleEvent } from './lib/lifecycle-event.mjs';
import { createRedactor } from './lib/redaction.mjs';
import laravelProvider from './lib/providers/laravel.mjs';

const CAPABILITY = 'gate-evidence-prune-smoke';

const SOURCE = 'app/Order.php';

/** A value that must never survive into the persisted store. */
const CANARY = 'canary-secret-4f2b81d0e6a7';

const HEAD_MARKER = 'EVIDENCE-BEGIN-MARKER';

const TAIL_MARKER = 'EVIDENCE-END-MARKER';

const runFile = promisify(execFile);

const temporaryRoots = [];

const temporaryDirectory = async (prefix) => {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));

  temporaryRoots.push(directory);

  return directory;
};

const git = (cwd, args) => runFile('git', args, { cwd });

/**
 * A check that really talks. It writes a marked beginning, far more filler than
 * any excerpt may retain, the planted secret, and a marked end, then fails —
 * so the retained excerpt has both ends to preserve and something to redact.
 */
const CHECK_SCRIPT = [
  "import { readFile } from 'node:fs/promises';",
  '',
  "const graded = await readFile(process.argv[5], 'utf8').catch(() => '');",
  '',
  "process.stdout.write(`${process.argv[2]}\\n`);",
  // The graded source is echoed, so two different snapshots genuinely produce
  // two different outputs and therefore two different content-addressed blobs.
  'process.stdout.write(`graded ${graded}\\n`);',
  "process.stderr.write('EVIDENCE-STDERR-MARKER\\n');",
  "process.stdout.write(`${'filler-'.repeat(20000)}\\n`);",
  "process.stdout.write(`connecting with token ${process.argv[4]}\\n`);",
  "process.stdout.write(`${process.argv[3]}\\n`);",
  // The exit status is set rather than forced, so no buffered output is lost:
  // a check that is cut off mid-sentence is not the evidence it produced.
  'process.exitCode = 1;',
  '',
].join('\n');

const fixtureRepository = async () => {
  const root = await temporaryDirectory('gate-evidence-smoke-repo-');

  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(path.join(root, 'tools/check.mjs'), CHECK_SCRIPT, 'utf8');
  await writeFile(path.join(root, SOURCE), 'baseline\n', 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await git(root, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Evidence Smoke',
    'commit', '--quiet', '--message', 'baseline',
  ]);
  await writeFile(path.join(root, SOURCE), 'baseline\nproposed\n', 'utf8');

  return root;
};

const checkCommand = (category) => ({
  runner: 'repository-script',
  args: ['tools/check.mjs', HEAD_MARKER, TAIL_MARKER, CANARY, SOURCE],
  working_directory: '.',
  timeout_seconds: 30,
  allowed_environment: ['PATH'],
  evidence_category: category,
  source_scope: 'backend',
});

const provedFacts = () => ({
  scopes: { backend: ['app'], frontend: [] },
  proved: { broad_test: { evaluate: checkCommand('test') } },
});

const request = (root) => ({
  protocolVersion: '1.0',
  operation: 'evaluate',
  repository: { root },
  change: { kind: 'worktree', baseRevision: 'HEAD' },
  evaluation: { purpose: 'regression-only', contractRef: null },
  invocation: {
    role: 'authoritative',
    trigger: 'work-complete',
    adapter: {
      id: 'git',
      surface: 'git-pre-commit',
      version: '1.0.0',
      capabilities: { nativeBlocking: true },
    },
    sessionId: `${CAPABILITY}-session`,
  },
});

const storeIdentity = () => ({
  actor: { name: 'gate-evidence-smoke', source: 'fixture' },
  client: { id: 'git', surface: 'git-pre-commit', version: '1.0.0' },
  gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '1.0' },
  repository: { identity: `sha256:${'0'.repeat(64)}` },
});

/**
 * Run one real evaluation whose captured output is persisted through the
 * Evidence store, and return the decision alongside the store it wrote to.
 */
const evaluateOnce = async (root) => {
  const store = await openEvidenceStore({
    repositoryRoot: root,
    identity: storeIdentity(),
    redactor: createRedactor({
      secrets: [{ name: 'APP_TOKEN', source: 'approved-environment-file', value: CANARY }],
    }),
  });
  const collected = collectChecks([{ provider: laravelProvider, facts: provedFacts() }]);
  const executor = createBoundedExecutor({
    captureOutput: true,
    resolveExecutable: (command) => (
      command.runner === 'repository-script' ? { executable: process.execPath } : null
    ),
  });
  const decision = await evaluate(request(root), {
    executionRoot: await temporaryDirectory('gate-evidence-smoke-exec-'),
    runnerVersion: `${CAPABILITY}/1.0.0`,
    providerVersions: { laravel: '1.0.0' },
    resolvePrerequisite: () => true,
    checks: collected.checks,
    evidenceStore: store,
    execute: executor.execute,
  });

  return { store, decision };
};

/** Every byte the store persisted, so a canary cannot hide in one file. */
const persistedBytes = async (root) => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const contents = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      contents.push(await readFile(path.join(entry.parentPath ?? entry.path, entry.name), 'utf8'));
    }
  }

  return contents.join('\n');
};

const check = (findings, condition, detail) => {
  if (!condition) {
    findings.push(detail);
  }
};

/** One bounded, redacted, content-addressed envelope at the Git-common location. */
const boundedRedactedAppend = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const { store, decision } = await evaluateOnce(root);

  check(findings, validateDecision(decision).length === 0, 'The decision envelope is not contract valid.');
  check(findings, decision.evidence.persisted === true, 'The decision does not report persisted evidence.');
  check(
    findings,
    store.root === path.join(store.gitCommonDirectory, 'change-evaluation-gate', 'evidence'),
    `The store is not at the Git-common location: ${store.root}.`,
  );

  const envelope = await store.readEnvelope(decision.evidence.reference?.evidenceId);

  check(findings, envelope !== null, 'No envelope was appended.');

  const attempt = envelope?.retention?.attempts?.[0] ?? null;

  check(findings, attempt !== null, 'The envelope retained no attempt.');

  if (attempt !== null) {
    const inlineBytes = Buffer.byteLength(attempt.inline, 'utf8');

    check(
      findings,
      inlineBytes <= EVIDENCE_CEILINGS.inlineBytes,
      `The retained excerpt is ${inlineBytes} bytes, above the 32 KiB ceiling.`,
    );
    check(findings, attempt.truncated === true, 'A 140 KB output was not reported as truncated.');
    check(
      findings,
      attempt.inline.includes(HEAD_MARKER),
      'Truncation did not preserve the beginning of the output.',
    );
    check(
      findings,
      attempt.inline.includes(TAIL_MARKER),
      'Truncation did not preserve the end of the output.',
    );
    check(
      findings,
      attempt.retainedBytes + attempt.omittedBytes === attempt.capturedBytes,
      'The retained and omitted byte counts do not account for the captured output.',
    );
    check(findings, attempt.omittedBytes > 0, 'A truncated excerpt reported no omitted bytes.');
    check(findings, attempt.redaction.applied > 0, 'No redaction was recorded for output carrying a secret.');
  }

  // The secret canary: no form of it may exist anywhere in the store.
  const persisted = await persistedBytes(store.root);

  check(findings, persisted.includes(CANARY) === false, 'The raw secret canary survived into the store.');
  check(
    findings,
    persisted.includes(Buffer.from(CANARY, 'utf8').toString('base64')) === false,
    'A base64 form of the secret canary survived into the store.',
  );

  const events = await store.readEvents();

  check(
    findings,
    events.length === 1 && events[0].type === 'evaluation',
    `Expected exactly one evaluation lifecycle event, got ${JSON.stringify(events.map((event) => event.type))}.`,
  );
  check(
    findings,
    events.every((event) => validateLifecycleEvent(event).length === 0),
    'A lifecycle event failed the audit schema.',
  );

  return { name: 'bounded-redacted-append', ok: findings.length === 0, findings };
};

/** A confirmation that does not reproduce the preview removes nothing. */
const previewMismatchRemovesNothing = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const { store, decision } = await evaluateOnce(root);
  const before = await store.listBlobs();

  check(findings, before.length === 1, `Expected one retained blob, got ${before.length}.`);

  const preview = await store.previewPrune({ evaluationIds: [decision.evaluationId] });

  check(findings, preview.blobs.length === 1, 'The preview did not identify the exact blob.');
  check(
    findings,
    preview.totalBytes === before[0].bytes,
    'The preview did not identify the exact byte count.',
  );

  // A preview on its own is not a removal.
  check(
    findings,
    (await store.listBlobs()).length === 1,
    'Previewing removed something on its own.',
  );

  const refused = await store.confirmPrune({ preview, confirmation: `${preview.confirmationToken}x` });

  check(findings, refused.pruned === false, 'A mismatched confirmation reported a removal.');
  check(
    findings,
    refused.reasonCode === 'preview-mismatch',
    `Expected preview-mismatch, got ${refused.reasonCode}.`,
  );
  check(findings, refused.removed.length === 0, 'A mismatched confirmation removed blobs.');
  check(findings, refused.reclaimedBytes === 0, 'A mismatched confirmation claimed reclaimed bytes.');
  check(findings, (await store.listBlobs()).length === 1, 'A mismatched confirmation emptied the store.');
  check(
    findings,
    (await store.readBlob(before[0].blobId)) !== null,
    'A mismatched confirmation deleted the blob from disk.',
  );
  check(findings, (await store.readTombstones()).length === 0, 'A refusal left a tombstone.');

  const prunings = await store.readPrunings();

  check(
    findings,
    prunings.length === 1 && prunings[0].pruned === false && prunings[0].outcome === 'refused',
    'The refusal was not recorded exactly once as a refusal.',
  );
  check(
    findings,
    prunings.every((record) => record.pruned !== true),
    'A refused prune recorded a successful deletion.',
  );

  const events = await store.readEvents();

  check(
    findings,
    events.filter((event) => event.type === 'pruning' && event.outcome === 'succeeded').length === 0,
    'A refused prune recorded a successful pruning event.',
  );

  return { name: 'preview-mismatch-removes-nothing', ok: findings.length === 0, findings };
};

/** A matching confirmation removes only previewed blobs and keeps the trail. */
const confirmedPrunePreservesAuditTrail = async () => {
  const findings = [];
  const root = await fixtureRepository();
  const first = await evaluateOnce(root);

  // A second evaluation of a different snapshot, so pruning has something it
  // must leave alone.
  await writeFile(path.join(root, SOURCE), 'baseline\nproposed\nsecond\n', 'utf8');

  const second = await evaluateOnce(root);
  const store = second.store;
  const retained = await store.listBlobs();

  check(findings, retained.length === 2, `Expected two retained blobs, got ${retained.length}.`);
  check(
    findings,
    first.decision.evaluationId !== second.decision.evaluationId,
    'The two evaluations were not distinct.',
  );

  const preview = await store.previewPrune({ evaluationIds: [first.decision.evaluationId] });

  check(findings, preview.blobs.length === 1, 'The preview selected the wrong number of blobs.');

  const result = await store.confirmPrune({ preview, confirmation: preview.confirmationToken });

  check(findings, result.pruned === true, 'A matching confirmation did not prune.');
  check(
    findings,
    result.reclaimedBytes === preview.totalBytes,
    'The reclaimed bytes did not match the preview.',
  );

  const remaining = await store.listBlobs();

  check(findings, remaining.length === 1, `Expected one blob to remain, got ${remaining.length}.`);
  check(
    findings,
    remaining[0].blobId !== preview.blobs[0].blobId,
    'Pruning removed the wrong blob.',
  );
  check(
    findings,
    (await store.readBlob(preview.blobs[0].blobId)) === null,
    'The confirmed blob is still on disk.',
  );
  check(
    findings,
    (await store.readBlob(remaining[0].blobId)) !== null,
    'Pruning removed an unselected blob.',
  );

  // Everything else survives: envelopes, decisions, events, records, tombstones.
  const log = await store.readLog();

  check(findings, log.length === 2, `Expected both envelopes to survive, got ${log.length}.`);

  const envelope = await store.readEnvelope(first.decision.evidence.reference?.evidenceId);

  check(findings, envelope !== null, 'The pruned evaluation lost its envelope.');
  check(
    findings,
    envelope?.decision?.evaluationId === first.decision.evaluationId,
    'The retained envelope no longer carries its decision.',
  );

  const tombstones = await store.readTombstones();

  check(
    findings,
    tombstones.length === 1 && tombstones[0].blobId === preview.blobs[0].blobId,
    'The removed blob left no matching tombstone.',
  );
  check(
    findings,
    tombstones[0]?.pruningId === result.pruningId,
    'The tombstone is not bound to its pruning record.',
  );

  const prunings = await store.readPrunings();

  check(
    findings,
    prunings.some((record) => record.pruningId === result.pruningId && record.pruned === true),
    'The pruning record was not retained.',
  );

  const events = await store.readEvents();

  check(
    findings,
    events.filter((event) => event.type === 'evaluation').length === 2,
    'The evaluation lifecycle events did not survive pruning.',
  );
  check(
    findings,
    events.filter((event) => event.type === 'pruning' && event.outcome === 'succeeded').length === 1,
    'The pruning was not recorded as its own lifecycle event.',
  );
  check(
    findings,
    events.every((event) => validateLifecycleEvent(event).length === 0),
    'A lifecycle event failed the audit schema after pruning.',
  );

  return { name: 'confirmed-prune-preserves-audit-trail', ok: findings.length === 0, findings };
};

const main = async () => {
  const asJson = process.argv.includes('--json');
  let scenarios = [];

  try {
    scenarios = [
      await boundedRedactedAppend(),
      await previewMismatchRemovesNothing(),
      await confirmedPrunePreservesAuditTrail(),
    ];
  } finally {
    for (const root of temporaryRoots) {
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
