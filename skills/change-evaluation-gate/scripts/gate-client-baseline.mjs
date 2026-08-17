#!/usr/bin/env node
/**
 * Run one supported surface's shared compatibility baseline from inside its
 * real client.
 *
 * This is the promotion path `SG-SUPPORT-001` requires and the only one that
 * can earn `captured-client-invocation`. Everything else the Gate runs drives a
 * payload this repository built from the adapter's own declaration, which
 * proves the declaration is coherent, not that it describes the client. Here the
 * client itself supplies the payload on standard input, the adapter's declared
 * field names must read it, and the ten baseline checks run against what
 * actually arrived.
 *
 * Register it as the client's completion hook, trigger one turn, and hand the
 * written record to release qualification:
 *
 *   node .../gate-client-baseline.mjs --adapter cursor
 *
 * It writes one JSON record per invocation and always exits 0, so a client is
 * never broken by an adapter experiment.
 *
 * PRIVACY: a native payload carries conversation text and, for at least one
 * client, an end user's email. This records the payload's KEY NAMES and the
 * baseline outcomes; it never writes the payload's values, and the only value
 * it copies is the client's self-reported version (SG-SECRET-001).
 */

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  classifySupport,
  describeAdapter,
  runCompatibilityBaseline,
} from './lib/adapters.mjs';
import { evaluate } from './lib/evaluate.mjs';

const runFile = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '..', '..', '..');

/** Where each client self-reports its own version, when it does at all. */
const CLIENT_VERSION_FIELD = Object.freeze({
  cursor: 'cursor_version',
  'claude-code-desktop': null,
  'codex-desktop': null,
});

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};

const readStdin = async () => {
  if (process.stdin.isTTY) {
    return '';
  }

  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
};

const gitVersion = async () => {
  const { stdout } = await runFile('git', ['--version']);

  return stdout.trim();
};

const gateVersion = async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'));

  return `change-evaluation-gate/${manifest.version}`;
};

/** A throwaway repository to grade, so the client's own workspace is untouched. */
const throwawayRepository = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'gate-client-baseline-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

  await runFile('git', ['init', '-q'], { cwd: root, env });
  await writeFile(path.join(root, 'src.txt'), 'baseline\n', 'utf8');
  await runFile('git', ['add', '.'], { cwd: root, env });
  await runFile('git', [
    '-c', 'user.email=baseline@example.test', '-c', 'user.name=baseline',
    'commit', '-q', '-m', 'baseline',
  ], { cwd: root, env });

  return { root, env };
};

const main = async () => {
  const adapterId = argument('adapter');
  const outputDirectory = argument('out', path.join(tmpdir(), 'gate-client-baselines'));
  const adapter = adapterId === null ? null : describeAdapter(adapterId);
  const raw = await readStdin();

  let payload = null;

  try {
    payload = raw.trim() === '' ? null : JSON.parse(raw);
  } catch {
    payload = null;
  }

  await mkdir(outputDirectory, { recursive: true });
  const destination = path.join(outputDirectory, `${adapterId ?? 'unknown'}-${Date.now()}.json`);

  const refuse = async (reasonCode, detail) => {
    await writeFile(destination, `${JSON.stringify({
      ok: false, adapterId, reasonCode, detail, recordedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
    process.stderr.write(`gate-client-baseline: ${reasonCode} — ${detail}\n`);
  };

  if (adapter === null) {
    await refuse('unknown-adapter', `Pass --adapter with one of the declared v1 surfaces; got ${JSON.stringify(adapterId)}.`);

    return;
  }

  if (payload === null) {
    await refuse('no-native-payload', 'The client sent nothing parseable on standard input, so there is no invocation to prove.');

    return;
  }

  const { root, env } = await throwawayRepository();
  const versionField = CLIENT_VERSION_FIELD[adapterId] ?? null;
  const clientVersion = versionField === null ? null : (payload[versionField] ?? null);

  const baseline = await runCompatibilityBaseline(
    { adapterId, repositoryRoot: root },
    {
      // The client's own payload. This is what makes the run promotable.
      capturedPayload: payload,
      evidence: { payloadSource: 'captured-client-invocation' },
      evaluate: async (request) => evaluate(request, {
        checks: [{
          id: 'baseline-regression',
          stage: 'broad-tests',
          capability: 'test',
          scope: 'both',
          policy: 'required',
          applicability: { always: true },
          evidence_claims: ['regression'],
          order: 10,
          command: { runner: 'node', args: ['-e', 'process.exit(0)'], evidence_category: 'test' },
        }],
        execute: async () => ({ executed: true, exitCode: 0, timedOut: false, error: null, durationMs: 1 }),
      }),
      runGit: async (args) => {
        const { stdout } = await runFile('git', args, { cwd: root, env });

        return stdout.trim();
      },
      versions: {
        gate: await gateVersion(),
        node: process.version,
        os: `${process.platform} ${process.arch}`,
        client: clientVersion,
      },
    },
  );

  const support = classifySupport({
    adapterId,
    variant: 'desktop',
    capabilities: { repositoryFilesystem: true, processExecution: true, git: true },
    baseline,
  });

  const record = {
    ok: baseline.passed && support.tier === 'supported',
    adapterId,
    surface: adapter.surface,
    recordedAt: new Date().toISOString(),
    // Key names only. The values are the client's, and not ours to keep.
    observedPayloadKeys: Object.keys(payload).sort(),
    clientVersion,
    clientVersionSource: versionField === null
      ? 'not-self-reported-by-this-client'
      : `payload.${versionField}`,
    git: await gitVersion(),
    baseline,
    support,
  };

  await writeFile(destination, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await appendFile(
    path.join(outputDirectory, 'index.log'),
    `${record.recordedAt} ${adapterId} ${support.tier} ${destination}\n`,
    'utf8',
  );

  process.stderr.write(
    `gate-client-baseline: ${adapterId} -> ${support.tier}`
    + ` (${baseline.checks.filter((check) => check.ok).length}/${baseline.checks.length} checks)`
    + ` -> ${destination}\n`,
  );
};

// A client is never broken by this. Every path exits 0.
main().then(() => process.exit(0), () => process.exit(0));
