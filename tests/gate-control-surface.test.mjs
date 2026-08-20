import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { configurationIdentity } from '../skills/change-evaluation-gate/scripts/lib/activation.mjs';
import { commandPreview } from '../skills/change-evaluation-gate/scripts/lib/command-descriptor.mjs';
import {
  gateChecksFromConfiguration,
  readRepositoryConfiguration,
} from '../skills/change-evaluation-gate/scripts/lib/configuration.mjs';
import { evaluate as realEvaluate } from '../skills/change-evaluation-gate/scripts/lib/evaluate.mjs';
import { contentIdentity } from '../skills/change-evaluation-gate/scripts/lib/evidence-store.mjs';
import { runHook } from '../skills/change-evaluation-gate/scripts/lib/hook-runner.mjs';
import { runPreflight } from '../skills/change-evaluation-gate/scripts/lib/preflight-runner.mjs';

const runFile = promisify(execFile);

/**
 * This suite drives the two runners that reach a maintainer. The rule under
 * test — that an activated clone is graded by the configuration it activated —
 * is only true if the runners reconcile it, so nothing here calls
 * `reconcileControlSurface` or `evaluate` directly. A component proved in
 * isolation and never reached by the runtime is the defect this closes.
 *
 * Every fixture is a throwaway repository under the OS temporary directory and
 * never this repository, so no fixture can reach the framework clone's Git
 * state.
 */
const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LIBRARY = path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib');

const isInside = (parent, candidate) => candidate === parent
  || candidate.startsWith(`${parent}${path.sep}`);

const assertThrowawayRepository = async (root) => {
  const resolved = await realpath(root).catch(() => path.resolve(root));
  const temporaryRoot = await realpath(tmpdir());
  const frameworkRoot = await realpath(FRAMEWORK_ROOT).catch(() => FRAMEWORK_ROOT);

  assert.equal(isInside(temporaryRoot, resolved), true, `Refusing to operate outside the OS temporary directory: ${resolved}.`);
  assert.equal(isInside(frameworkRoot, resolved), false, `Refusing to operate inside this repository: ${resolved}.`);

  return resolved;
};

const isolatedGitEnvironment = () => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const git = (root, args) => runFile('git', args, { cwd: root, env: isolatedGitEnvironment() });

const throwawayRepository = async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'gate-control-surface-repo-')));

  t.after(() => rm(root, { recursive: true, force: true }));
  await assertThrowawayRepository(root);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'app/Order.php'), 'baseline\n', 'utf8');
  await git(root, ['init', '--quiet']);
  await git(root, ['add', '--all']);
  await git(root, [
    '-c', 'user.email=gate@example.test',
    '-c', 'user.name=Gate Control Surface',
    'commit', '--quiet', '--message', 'baseline',
  ]);

  return root;
};

/** The clone's configuration: one required broad test run by a repository script. */
const configuration = ({
  profile = 'gate-control-surface',
  argument = 'app/Order.php',
  required = ['configuration.broad-tests.test'],
  advisory = [],
} = {}) => [
  'schema_version: 4',
  'backend: unknown',
  'frontend: none',
  'verification:',
  `  profile: ${profile}`,
  '  capabilities: []',
  '  commands:',
  '    test:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  '        - runner: repository-script',
  '          args:',
  '            - tools/check.mjs',
  `            - ${argument}`,
  '          working_directory: "."',
  '          timeout_seconds: 60',
  '          allowed_environment:',
  '            - PATH',
  '          evidence_category: test',
  '          source_scope: both',
  'evaluation_gate:',
  '  checks:',
  ...(required.length === 0
    ? ['    required: []']
    : ['    required:', ...required.map((id) => `      - ${id}`)]),
  ...(advisory.length === 0
    ? ['    advisory: []']
    : ['    advisory:', ...advisory.map((id) => `      - ${id}`)]),
  '  budget:',
  '    total_seconds: 600',
  '  bypass:',
  '    enabled: false',
  '  execution: {}',
  '  evidence: {}',
  '',
].join('\n');

const configureClone = async (root, options = {}) => {
  await mkdir(path.join(root, 'tools'), { recursive: true });
  await writeFile(
    path.join(root, 'tools/check.mjs'),
    [
      "import { readFile } from 'node:fs/promises';",
      '',
      "const graded = await readFile(process.argv[2], 'utf8').catch(() => '');",
      '',
      'process.stdout.write(`graded ${graded.length} bytes\\n`);',
      "process.exitCode = graded.includes('BROKEN') ? 1 : 0;",
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(path.join(root, '.agent-framework.yaml'), configuration(options), 'utf8');
};

const CHECK_ID = 'configuration.broad-tests.test';

/**
 * The pin a real activation records: the executable it resolved, and the exact
 * invocation the operator consented to. Both are computed from the clone's own
 * configuration, never asserted, so this fixture is a clone activation could
 * actually have produced.
 */
const pinnedRunner = async (root) => {
  const read = await readRepositoryConfiguration({ repositoryRoot: root });
  const { checks } = gateChecksFromConfiguration(read.configuration);
  const check = checks.find((candidate) => candidate.id === CHECK_ID);

  return {
    check_id: CHECK_ID,
    role: 'evaluate',
    runner: 'repository-script',
    executable: process.execPath,
    interpreter: null,
    version: process.versions.node,
    preview: commandPreview(check.evaluate, process.execPath),
  };
};

const activationDirectory = async (root) => {
  const common = (await git(root, ['rev-parse', '--git-common-dir'])).stdout.trim();

  return path.resolve(root, common, 'change-evaluation-gate/evidence/activation');
};

/**
 * The Activation receipt a real activation publishes for this clone.
 *
 * The pinned identities are COMPUTED, never invented: the configuration
 * identity is `configurationIdentity` over the file this clone was configured
 * with, and the receipt id is the content identity of the receipt body, exactly
 * as `activate` derives them. A fixture that pinned placeholders would prove
 * the reconciliation fires while proving nothing about what it compares.
 */
const publishReceipt = async (root, overrides = {}) => {
  const read = await readRepositoryConfiguration({ repositoryRoot: root });

  assert.equal(read.ok, true, `the fixture configuration is unreadable: ${read.detail}`);

  const directory = await activationDirectory(root);
  const runners = [await pinnedRunner(root)];
  const body = {
    receiptVersion: 'change-evaluation-gate/activation/v1',
    activatedAt: '2026-08-17T00:00:00.000Z',
    previewId: `sha256:${'1'.repeat(64)}`,
    repository: { root, identity: `sha256:${'2'.repeat(64)}` },
    configuration: {
      schemaVersion: read.configuration.schema_version ?? null,
      identity: configurationIdentity({
        schemaVersion: read.configuration.schema_version ?? null,
        policy: read.configuration.evaluation_gate ?? null,
      }),
    },
    runtime: {
      gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '1.0' },
      runnerVersion: 'fixture/1.0.0',
      runners,
    },
    adapters: [{ id: 'git', version: '1.0.0', authoritative: true }],
    hooks: [],
    hookChain: {
      strategy: 'gate-owned-shim', manager: null, path: null, priorIdentity: null, blockIdentity: null,
    },
    runtimeInputs: [],
    ...overrides,
  };

  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'receipt.json'),
    `${JSON.stringify({ ...body, receiptId: contentIdentity(body) }, null, 2)}\n`,
    'utf8',
  );

  return { directory, body };
};

const stage = async (root, contents) => {
  await writeFile(path.join(root, 'app/Order.php'), contents, 'utf8');
  await git(root, ['add', '--all']);
};

/** An activated clone that allows and denies exactly as it was activated to. */
const activatedClone = async (t, options = {}) => {
  const root = await throwawayRepository(t);

  await configureClone(root, options);
  await publishReceipt(root);

  return root;
};

test('TB-031 AC-CFG-004 / SG-POL-001: a clone whose Gate policy is weakened after activation is denied, not graded by the edit', async (t) => {
  const root = await activatedClone(t);

  await stage(root, 'baseline\nBROKEN\n');

  const enforced = await runHook({ cwd: root, environment: process.env });

  assert.notEqual(enforced.exitCode, 0, 'the activated policy must deny a failing required check.');

  // The agent whose commit was just blocked demotes the check that blocked it.
  // Nothing else changes: same runner, same receipt, same staged content.
  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    configuration({ required: [], advisory: ['configuration.broad-tests.test'] }),
    'utf8',
  );
  await git(root, ['add', '--all']);

  const result = await runHook({ cwd: root, environment: process.env });
  const output = result.lines.join('\n');

  assert.notEqual(
    result.exitCode,
    0,
    `a commit graded by a policy nobody activated is the defect TB-031 closes; got: ${output}`,
  );
  assert.match(output, /integrity-drift/, 'the denial names the drift, not merely a failing check.');
  assert.match(output, /trusted-configuration/, 'the denial names the surface that drifted.');
  assert.match(output, /gate repair/, 'the maintainer is told what to do, and nothing is repaired.');
});

test('TB-031 AC-CFG-004: a command argument widened after activation is denied, so the pinned invocation is what runs', async (t) => {
  const root = await activatedClone(t);

  await stage(root, 'baseline\nBROKEN\n');
  // The check is pointed at a file that cannot break instead of the source it
  // was activated to grade. The Gate policy section is untouched: nothing about
  // which checks are required has changed, only what one of them runs.
  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    configuration({ argument: 'tools/check.mjs' }),
    'utf8',
  );
  await git(root, ['add', '--all']);

  const result = await runHook({ cwd: root, environment: process.env });
  const output = result.lines.join('\n');

  assert.notEqual(result.exitCode, 0, `a widened command must not grade the next commit; got: ${output}`);
  assert.match(output, /integrity-drift/);
  assert.match(output, /command-descriptors/, 'the denial names the surface the argument belongs to.');
});

test('TB-031 AC-CFG-004: a check identity added to the activated policy is denied rather than enforced', async (t) => {
  const root = await activatedClone(t);

  await stage(root, 'baseline\nrepaired\n');
  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    configuration({ advisory: ['configuration.smoke.smoke'] }),
    'utf8',
  );
  await git(root, ['add', '--all']);

  const result = await runHook({ cwd: root, environment: process.env });
  const output = result.lines.join('\n');

  assert.notEqual(result.exitCode, 0, `an added check identity is still an unactivated policy; got: ${output}`);
  assert.match(output, /integrity-drift/);
  assert.match(output, /trusted-configuration/);
});

test('TB-031 AC-EVAL-001: an undrifted clone allows and denies exactly as before, with no added diagnostic', async (t) => {
  const root = await activatedClone(t);

  await stage(root, 'baseline\nrepaired\n');

  const allowed = await runHook({ cwd: root, environment: process.env });

  assert.equal(allowed.exitCode, 0, `an undrifted clone must still allow: ${allowed.lines.join('\n')}`);
  assert.doesNotMatch(allowed.lines.join('\n'), /integrity-drift/);

  await stage(root, 'baseline\nBROKEN\n');

  const denied = await runHook({ cwd: root, environment: process.env });

  assert.notEqual(denied.exitCode, 0);
  assert.equal(denied.reasonCode, 'denied', 'a failing check is denied as a failing check, never as drift.');
  assert.doesNotMatch(denied.lines.join('\n'), /integrity-drift/);
});

test('TB-031 FR-EVAL-009: a commit that edits a declared Grader surface is reported as visibility, never as drift', async (t) => {
  const root = await activatedClone(t);

  await stage(root, 'baseline\nrepaired\n');
  // Ordinary work: the maintainer edits their own configuration file, outside
  // the Gate policy and the commands it binds. That is a changed Grader surface
  // and the decision must say so — it is not an accusation, and it is a
  // different thing from independent drift of what activation pinned.
  await writeFile(path.join(root, '.agent-framework.yaml'), configuration({ profile: 'renamed-profile' }), 'utf8');
  await git(root, ['add', '--all']);

  let decision = null;
  const result = await runHook({
    cwd: root,
    environment: process.env,
    evaluate: async (request, dependencies) => {
      decision = await realEvaluate(request, dependencies);

      return decision;
    },
  });

  assert.equal(result.exitCode, 0, `editing a declared Grader surface is ordinary work: ${result.lines.join('\n')}`);
  assert.equal(
    decision.integrity.controlSurfaceChanged,
    true,
    'the changed Gate configuration is reported as visibility.',
  );
  assert.equal(
    decision.integrity.changedGraderSurfaces.some((surface) => surface.kind === 'gate-configuration'),
    true,
    'the surface the change edited is named.',
  );
  assert.equal(
    decision.diagnostics.some((diagnostic) => diagnostic.reasonCode === 'integrity-drift'),
    false,
    'a maintainer editing their own configuration is never accused of tampering.',
  );
});

test('TB-031 SG-SUPPORT-001: the preflight runner reports the same drift as unverified and not-authoritative, blocking nothing', async (t) => {
  const root = await activatedClone(t);

  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    configuration({ required: [], advisory: ['configuration.broad-tests.test'] }),
    'utf8',
  );

  const result = await runPreflight({
    cwd: root,
    stdin: `${JSON.stringify({
      hook_event_name: 'stop',
      session_id: 'control-surface-session',
      workspace_roots: [root],
      cursor_version: '3.15.6',
      status: 'completed',
      loop_count: 0,
    })}\n`,
    argv: ['--adapter', 'cursor'],
    environment: process.env,
  });

  assert.equal(result.exitCode, 0, 'a preflight surface never blocks.');
  assert.equal(result.view.outcome, 'unverified');
  assert.equal(result.view.authorization, 'not-authoritative');
  assert.equal(result.view.blocking, false);
  assert.match(
    JSON.stringify(result.view.presentation),
    /unverified/,
    'the maintainer is told the clone no longer matches what it activated.',
  );
});

test('TB-031 FR-LIFE-019: a drifted clone is reported and never repaired; no gate-owned file is written by the observation', async (t) => {
  const root = await activatedClone(t);
  const directory = await activationDirectory(root);

  await stage(root, 'baseline\nrepaired\n');
  await writeFile(
    path.join(root, '.agent-framework.yaml'),
    configuration({ required: [], advisory: ['configuration.broad-tests.test'] }),
    'utf8',
  );

  const receiptBefore = await readFile(path.join(directory, 'receipt.json'), 'utf8');
  const configurationBefore = await readFile(path.join(root, '.agent-framework.yaml'), 'utf8');
  const result = await runHook({ cwd: root, environment: process.env });
  const output = result.lines.join('\n');

  assert.notEqual(result.exitCode, 0);
  assert.match(output, /trusted-configuration/, 'the drifted surface is named.');
  assert.match(output, /gate repair/, 'the one confirmed operator action is named, and nothing else is done.');
  assert.equal(
    await readFile(path.join(directory, 'receipt.json'), 'utf8'),
    receiptBefore,
    'observing drift re-pinned the receipt.',
  );
  assert.equal(
    await readFile(path.join(root, '.agent-framework.yaml'), 'utf8'),
    configurationBefore,
    'observing drift rewrote the configuration it disagreed with.',
  );
});

test('TB-031 AC-SEC-001 / NFR-SEC-004: each pinned control surface, drifted on its own, denies the next commit', async (t) => {
  const surfaces = {
    runtime: async (root) => {
      // A gate speaking a protocol version this clone never activated against.
      await publishReceipt(root, {
        runtime: {
          gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '0.9' },
          runnerVersion: 'fixture/1.0.0',
          runners: [await pinnedRunner(root)],
        },
      });
    },
    adapters: async (root) => {
      await publishReceipt(root, { adapters: [{ id: 'git', version: '2.0.0', authoritative: true }] });
    },
    'managed-hooks': async (root) => {
      // A registration activation pinned, at a path that holds nothing now.
      await publishReceipt(root, {
        hookChain: {
          strategy: 'gate-owned-shim',
          manager: null,
          path: path.join(root, '.git/hooks/pre-commit'),
          priorIdentity: null,
          blockIdentity: `sha256:${'c'.repeat(64)}`,
        },
      });
    },
    receipt: async (root) => {
      // The receipt itself edited after it was published — the move that would
      // otherwise let a weakened configuration re-pin itself as trusted.
      const directory = await publishReceipt(root).then((published) => published.directory);
      const receiptPath = path.join(directory, 'receipt.json');
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));

      await writeFile(
        receiptPath,
        `${JSON.stringify({ ...receipt, previewId: `sha256:${'9'.repeat(64)}` }, null, 2)}\n`,
        'utf8',
      );
    },
    'trusted-configuration': async (root) => {
      await publishReceipt(root);
      await writeFile(
        path.join(root, '.agent-framework.yaml'),
        configuration({ required: [], advisory: ['configuration.broad-tests.test'] }),
        'utf8',
      );
    },
    'command-descriptors': async (root) => {
      // A pinned program that is gone. `pinnedRunners` denies that by name for
      // an evaluating check, so the surface is proved through a pin no declared
      // check resolves through — which nothing else would notice.
      await publishReceipt(root, {
        runtime: {
          gate: { id: 'change-evaluation-gate', version: '1.0.0', protocolVersion: '1.0' },
          runnerVersion: 'fixture/1.0.0',
          runners: [
            await pinnedRunner(root),
            {
              check_id: CHECK_ID,
              role: 'fix',
              runner: 'repository-script',
              executable: path.join(root, 'vendor/bin/removed'),
              interpreter: null,
              version: '1.0.0',
              preview: null,
            },
          ],
        },
      });
    },
    providers: async (root) => {
      // A provider identity this machine cannot observe at all. An unobservable
      // surface is drift, never an assumed match.
      await publishReceipt(root, { providers: { 'node-package': '1.0.0' } });
    },
  };

  for (const [surface, drift] of Object.entries(surfaces)) {
    const root = await throwawayRepository(t);

    await configureClone(root);
    await drift(root);
    await stage(root, 'baseline\nrepaired\n');

    const result = await runHook({ cwd: root, environment: process.env });
    const output = result.lines.join('\n');

    assert.notEqual(result.exitCode, 0, `drift of ${surface} still authorized a commit: ${output}`);
    assert.match(output, /integrity-drift/, `drift of ${surface} was not reported as drift: ${output}`);
    assert.match(output, new RegExp(surface), `drift of ${surface} did not name that surface: ${output}`);
  }
});

test('TB-031 SG-OWNER-001: exactly one function assembles the observed control surface, and both runners reach it', async () => {
  const sources = (await readdir(LIBRARY)).filter((entry) => entry.endsWith('.mjs'));
  const definitions = [];
  const callers = [];

  for (const source of sources) {
    const contents = await readFile(path.join(LIBRARY, source), 'utf8');

    if (contents.includes('export const observeControlSurface')) {
      definitions.push(source);
    }

    // The call is required in the shape that reaches `evaluate`: a runner that
    // merely mentions the observer is not one that reconciles anything.
    if (/controlSurface: await observeControlSurface\(\{/.test(contents)) {
      callers.push(source);
    }

    // A second assembly of the observed surface is how the two runners would
    // come to disagree about what this machine is, so there is none: nothing
    // outside the observer builds the dependency `evaluate` reconciles.
    if (source !== 'hook-runner.mjs' && source !== 'preflight-runner.mjs') {
      assert.doesNotMatch(
        contents,
        /controlSurface:/,
        `${source} assembles a control surface of its own.`,
      );
    }
  }

  assert.deepEqual(definitions, ['hook-runner.mjs'], 'the observed control surface has exactly one owner.');
  assert.deepEqual(
    callers.sort(),
    ['hook-runner.mjs', 'preflight-runner.mjs'],
    'both runners that reach a maintainer observe through that owner.',
  );
});
