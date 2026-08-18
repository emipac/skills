import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CHECK_OUTCOMES,
  CONTRACT_VERSION,
  LADDER_STAGES,
  POLICY_BINDINGS,
  assertOutcome,
  resolveOutcome,
} from '../skills/change-evaluation-gate/scripts/lib/check-descriptor.mjs';
import {
  COMMAND_RUNNERS,
  graderSurfaces,
  resolveExecutables,
  validateCommandDescriptor,
} from '../skills/change-evaluation-gate/scripts/lib/command-descriptor.mjs';
import { collectChecks } from '../skills/change-evaluation-gate/scripts/lib/gate-core.mjs';
import laravelProvider from '../skills/change-evaluation-gate/scripts/lib/providers/laravel.mjs';
import nodePackageProvider from '../skills/change-evaluation-gate/scripts/lib/providers/node-package.mjs';

const gateCoreSource = fileURLToPath(
  new URL('../skills/change-evaluation-gate/scripts/lib/gate-core.mjs', import.meta.url),
);
const checkDescriptorSource = fileURLToPath(
  new URL('../skills/change-evaluation-gate/scripts/lib/check-descriptor.mjs', import.meta.url),
);

const command = (runner, args, sourceScope, category, overrides = {}) => ({
  runner,
  args,
  working_directory: '.',
  timeout_seconds: 120,
  allowed_environment: ['PATH'],
  evidence_category: category,
  source_scope: sourceScope,
  ...overrides,
});

const laravelFacts = () => ({
  scopes: { backend: ['app', 'tests'], frontend: ['resources/js'] },
  proved: {
    format: {
      evaluate: command('composer-bin', ['pint', '--test'], 'backend', 'format'),
      fix: command('composer-bin', ['pint'], 'backend', 'format'),
    },
    rewrite_check: {
      evaluate: command('composer-bin', ['rector', 'process', '--dry-run'], 'backend', 'static_analysis'),
      fix: command('composer-bin', ['rector', 'process'], 'backend', 'static_analysis'),
    },
    static_analysis: {
      evaluate: command('composer-bin', ['phpstan', 'analyse'], 'backend', 'static_analysis'),
      covers_tests: false,
    },
    static_analysis_tests: {
      evaluate: command('composer-bin', ['phpstan', 'analyse', 'tests'], 'backend', 'static_analysis'),
    },
    focused_test: {
      evaluate: command('php-script', ['artisan', 'test', '--compact', '--filter', 'OrderTest'], 'backend', 'test'),
      selection: { kind: 'delivery-matrix', value: 'OrderTest' },
    },
    affected_test: {
      evaluate: command('php-script', ['artisan', 'test', '--compact', '--testsuite', 'Feature'], 'backend', 'test'),
      selection: { kind: 'impact-rule', value: 'Feature' },
    },
    smoke: {
      evaluate: command('php-script', ['artisan', 'test', '--compact', '--group', 'smoke'], 'backend', 'smoke'),
      prerequisites: [{ kind: 'service', name: 'database' }],
    },
    build: {
      evaluate: command('package-script', ['build'], 'frontend', 'build'),
    },
    browser: {
      evaluate: command('composer-bin', ['pest', '--group', 'browser'], 'backend', 'e2e'),
      prerequisites: [{ kind: 'executable', name: 'chromium' }],
    },
    broad_test: {
      evaluate: command('php-script', ['artisan', 'test', '--compact'], 'backend', 'test'),
    },
  },
});

const nodeFacts = () => ({
  scopes: { backend: ['src'], frontend: ['web/src'] },
  proved: {
    format: {
      evaluate: command('package-script', ['format:check'], 'both', 'format'),
      fix: command('package-script', ['format'], 'both', 'format'),
    },
    static_analysis: {
      evaluate: command('package-script', ['typecheck'], 'both', 'static_analysis'),
      covers_tests: true,
    },
    focused_test: {
      evaluate: command('package-script', ['test:unit'], 'backend', 'test'),
      selection: { kind: 'explicit-filter', value: 'orders' },
    },
    broad_test: {
      evaluate: command('package-script', ['test'], 'both', 'test'),
    },
  },
});

test('AC-PROF-001: Laravel and a non-Laravel provider are consumed through one contract without a stack-name branch', async () => {
  const result = collectChecks([
    { provider: laravelProvider, facts: laravelFacts() },
    { provider: nodePackageProvider, facts: nodeFacts() },
  ]);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.contract_version, 1);

  const providers = new Set(result.checks.map((check) => check.provider));

  assert.deepEqual([...providers].sort(), ['laravel', 'node-package']);

  for (const check of result.checks) {
    assert.equal(typeof check.id, 'string');
    assert.equal(typeof check.stage, 'string');
    assert.equal(typeof check.capability, 'string');
    assert.equal(typeof check.evaluate.runner, 'string');
  }

  const stackNames = /laravel|pint|rector|phpstan|larastan|pest|artisan|dusk|livewire|express|django|rails|symfony/i;

  assert.doesNotMatch(await readFile(gateCoreSource, 'utf8'), stackNames);
  assert.doesNotMatch(await readFile(checkDescriptorSource, 'utf8'), stackNames);
});

test('AC-PROF-002: the Laravel provider maps every confirmed command to a defined stage and a distinct claim', () => {
  const result = collectChecks([{ provider: laravelProvider, facts: laravelFacts() }]);

  assert.deepEqual(result.errors, []);

  const mapped = result.checks.map((check) => [
    check.id,
    check.stage,
    check.capability,
    check.evidence.claims.join('+'),
  ]);

  assert.deepEqual(mapped, [
    ['laravel.focused.test', 'focused', 'test', 'test:focused'],
    ['laravel.format.formatter', 'format', 'formatter', 'format:style'],
    ['laravel.static-analysis.rewrite-check', 'static-analysis', 'rewrite-check', 'static-analysis:rewrite'],
    ['laravel.static-analysis.application', 'static-analysis', 'static-analysis', 'static-analysis:application'],
    ['laravel.static-analysis.tests', 'static-analysis', 'static-analysis', 'static-analysis:tests'],
    ['laravel.affected-tests.test', 'affected-tests', 'test', 'test:affected'],
    ['laravel.smoke.runtime', 'smoke', 'smoke', 'smoke:runtime'],
    ['laravel.build.artifact', 'build', 'build', 'build:artifact'],
    ['laravel.browser.user-visible', 'browser', 'browser', 'browser:user-visible'],
    ['laravel.broad-tests.test', 'broad-tests', 'test', 'test:broad'],
  ]);

  const claims = result.checks.flatMap((check) => check.evidence.claims);

  assert.equal(new Set(claims).size, claims.length);

  const formatter = result.checks.find((check) => check.capability === 'formatter');

  assert.deepEqual(formatter.evaluate.args, ['pint', '--test']);
  assert.deepEqual(formatter.fix.args, ['pint']);

  const rewriteCheck = result.checks.find((check) => check.capability === 'rewrite-check');

  assert.deepEqual(rewriteCheck.evaluate.args, ['rector', 'process', '--dry-run']);
});

test('AC-PROF-002: one analysis covering application and test paths emits one check with both claims', () => {
  const facts = laravelFacts();

  facts.proved.static_analysis.covers_tests = true;

  const result = collectChecks([{ provider: laravelProvider, facts }]);

  assert.deepEqual(result.errors, []);

  const analysis = result.checks.filter((check) => check.capability === 'static-analysis');

  assert.equal(analysis.length, 1);
  assert.deepEqual(analysis[0].evidence.claims, [
    'static-analysis:application',
    'static-analysis:tests',
  ]);
});

test('AC-PROF-002: duplicated evidence claims are rejected by the contract', () => {
  const duplicateClaimProvider = {
    id: 'duplicate',
    contract_version: 1,
    resolve: () => {
      const base = collectChecks([{ provider: laravelProvider, facts: laravelFacts() }]).checks
        .filter((check) => check.stage === 'format' || check.stage === 'broad-tests')
        .map((check) => ({
          ...check,
          provider: 'duplicate',
          id: check.id.replace('laravel.', 'duplicate.'),
          evidence: { ...check.evidence, claims: ['same:claim'] },
        }));

      return { provider: 'duplicate', contract_version: 1, descriptors: base };
    },
  };

  const result = collectChecks([{ provider: duplicateClaimProvider, facts: {} }]);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'duplicate-evidence-claim'));
});

test('AC-PROF-003: unproved commands become visible capability gaps and never a guessed descriptor', () => {
  const facts = laravelFacts();

  delete facts.proved.rewrite_check;
  delete facts.proved.browser;

  const result = collectChecks([{ provider: laravelProvider, facts }]);

  assert.deepEqual(result.errors, []);

  const gaps = result.capability_gaps.map((gap) => [gap.capability, gap.stage, gap.reason]);

  assert.deepEqual(gaps, [
    ['rewrite-check', 'static-analysis', 'command-not-proved'],
    ['browser', 'browser', 'command-not-proved'],
  ]);

  for (const gap of result.capability_gaps) {
    assert.equal(gap.provider, 'laravel');
    assert.ok(gap.detail.length > 0);
  }

  const capabilities = result.checks.map((check) => check.capability);

  assert.equal(capabilities.includes('rewrite-check'), false);
  assert.equal(capabilities.includes('browser'), false);
});

test('AC-PROF-003: test relevance is never inferred from filenames alone', () => {
  const facts = laravelFacts();

  facts.proved.focused_test.selection = { kind: 'filename', value: 'tests/Feature/OrderTest.php' };
  delete facts.proved.affected_test.selection;

  const result = collectChecks([{ provider: laravelProvider, facts }]);

  assert.deepEqual(result.errors, []);

  const gaps = result.capability_gaps.map((gap) => [gap.stage, gap.reason]);

  assert.deepEqual(gaps, [
    ['focused', 'selection-not-deterministic'],
    ['affected-tests', 'selection-not-deterministic'],
  ]);

  const stages = result.checks.map((check) => check.stage);

  assert.equal(stages.includes('focused'), false);
  assert.equal(stages.includes('affected-tests'), false);
});

test('AC-PROF-003: a deterministic selection is carried on the descriptor it justifies', () => {
  const result = collectChecks([{ provider: laravelProvider, facts: laravelFacts() }]);

  const focused = result.checks.find((check) => check.stage === 'focused');
  const format = result.checks.find((check) => check.stage === 'format');

  assert.deepEqual(focused.selection, { kind: 'delivery-matrix', value: 'OrderTest' });
  assert.equal(format.selection, null);
});

test('AC-PROF-003: a malformed capability gap is rejected rather than silently dropped', () => {
  const sloppyProvider = {
    id: 'sloppy',
    contract_version: 1,
    resolve: () => ({
      provider: 'sloppy',
      contract_version: 1,
      descriptors: [],
      capability_gaps: [{ provider: 'sloppy', capability: 'test', stage: 'focused' }],
    }),
  };

  const result = collectChecks([{ provider: sloppyProvider, facts: {} }]);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'capability-gap-invalid'));
});

const descriptorFrom = (provider, overrides) => ({
  id: `${provider}.format.formatter`,
  provider,
  stage: 'format',
  capability: 'formatter',
  scope: 'both',
  applicability: { changed_path_globs: ['**'], required_facts: [] },
  prerequisites: [],
  policy: 'required',
  evaluate: command('package-script', ['format:check'], 'both', 'format'),
  fix: null,
  timeout_seconds: 120,
  declared_writes: [],
  evidence: { claims: ['format:style'], success_exit_codes: [0], report: null },
  order: 10,
  selection: null,
  ...overrides,
});

const fixedProvider = (id, contractVersion, descriptors) => ({
  id,
  contract_version: contractVersion,
  resolve: () => ({
    provider: id,
    contract_version: contractVersion,
    descriptors,
    capability_gaps: [],
  }),
});

test('AC-PROF-004: the contract defines exactly the eight ordered stages and four outcomes', () => {
  assert.deepEqual([...LADDER_STAGES], [
    'focused',
    'format',
    'static-analysis',
    'affected-tests',
    'smoke',
    'build',
    'browser',
    'broad-tests',
  ]);

  assert.deepEqual([...CHECK_OUTCOMES], ['passed', 'failed', 'unverified', 'not-applicable']);
  assert.deepEqual([...POLICY_BINDINGS], ['required', 'advisory']);
  assert.equal(CONTRACT_VERSION, 1);

  const result = collectChecks([
    { provider: laravelProvider, facts: laravelFacts() },
    { provider: nodePackageProvider, facts: nodeFacts() },
  ]);
  const observed = result.checks.map((check) => check.stage);
  const ladderPositions = observed.map((stage) => LADDER_STAGES.indexOf(stage));

  assert.deepEqual(ladderPositions, [...ladderPositions].sort((left, right) => left - right));
});

test('AC-PROF-004: outcomes separate not-applicable from unavailable unverified evidence', () => {
  assert.equal(resolveOutcome({ applicable: false }), 'not-applicable');
  assert.equal(resolveOutcome({ applicable: true, executed: false }), 'unverified');
  assert.equal(resolveOutcome({ applicable: true, executed: true, timed_out: true }), 'unverified');
  assert.equal(
    resolveOutcome({ applicable: true, executed: true, error: 'missing executable' }),
    'unverified',
  );
  assert.equal(resolveOutcome({ applicable: true, executed: true, exit_code: 0 }), 'passed');
  assert.equal(resolveOutcome({ applicable: true, executed: true, exit_code: 1 }), 'failed');
});

test('AC-PROF-004: required and advisory are policy bindings, never outcomes', () => {
  assert.equal(assertOutcome('unverified'), null);

  for (const binding of POLICY_BINDINGS) {
    assert.equal(assertOutcome(binding).code, 'policy-binding-is-not-an-outcome');
  }

  assert.equal(assertOutcome('bypassed').code, 'outcome-unknown');
});

test('AC-PROF-004: a new capability needs no gate-core branch', async () => {
  const provider = fixedProvider('mutation', 1, [
    descriptorFrom('mutation', {
      id: 'mutation.static-analysis.mutation-testing',
      stage: 'static-analysis',
      capability: 'mutation-testing',
      evidence: {
        claims: ['static-analysis:mutation'],
        success_exit_codes: [0],
        report: null,
      },
    }),
  ]);

  const result = collectChecks([{ provider, facts: {} }]);

  assert.equal(result.valid, true);
  assert.equal(result.checks[0].capability, 'mutation-testing');

  const core = await readFile(gateCoreSource, 'utf8');

  assert.doesNotMatch(core, /formatter|mutation-testing|rewrite-check/);
});

test('AC-PROF-004: a new stage or changed outcome semantics requires a contract-version change', () => {
  const newStage = collectChecks([
    { provider: fixedProvider('experimental', 1, [descriptorFrom('experimental', { stage: 'mutation' })]), facts: {} },
  ]);

  assert.equal(newStage.valid, false);
  assert.ok(newStage.errors.some((error) => error.code === 'stage-unknown'));

  const bumped = collectChecks([
    { provider: fixedProvider('experimental', 2, [descriptorFrom('experimental', { stage: 'mutation' })]), facts: {} },
  ]);

  assert.equal(bumped.valid, false);
  assert.ok(bumped.errors.some((error) => error.code === 'unsupported-contract-version'));
  assert.deepEqual(bumped.checks, []);
});

test('SG-OWNER-001: gate core owns no provider selection and no ladder of its own', async () => {
  const core = await readFile(gateCoreSource, 'utf8');
  const contract = await readFile(checkDescriptorSource, 'utf8');

  // Providers arrive as arguments; the core never registers or selects them.
  assert.doesNotMatch(core, /providers\s*=\s*[[{]/);
  assert.doesNotMatch(core, /'focused'|'broad-tests'/);

  // The settled Evidence ladder stays owned by verify-change.
  assert.match(contract, /from '\.\.\/\.\.\/\.\.\/verify-change\/scripts\/verification-plan\.mjs'/);

  const unknownProvider = collectChecks([{ provider: { id: 'nameless' }, facts: {} }]);

  assert.equal(unknownProvider.valid, false);
  assert.ok(unknownProvider.errors.some((error) => error.code === 'provider-invalid'));
});

test('AC-CFG-002: only the settled logical runners are accepted', () => {
  assert.deepEqual([...COMMAND_RUNNERS], [
    'composer-bin',
    'php-script',
    'package-script',
    'repository-script',
  ]);

  const errors = validateCommandDescriptor(
    command('bash', ['-lc', 'run'], 'both', 'format'),
    'unresolved',
  );

  assert.ok(errors.some((error) => error.code === 'runner-unresolved'));
});

test('AC-CFG-002: shell syntax is rejected before anything can execute it (SG-CMD-001)', () => {
  const rejected = [
    ['operator', ['test', '&&', 'lint']],
    ['pipe', ['test', '|', 'tee']],
    ['redirection', ['test', '>', 'out.log']],
    ['substitution', ['test', '$(whoami)']],
    ['backtick', ['test', '`whoami`']],
    ['semicolon', ['test;', 'rm']],
    ['newline', ['test\nrm']],
    ['inline-environment', ['NODE_ENV=production', 'test']],
  ];

  for (const [label, args] of rejected) {
    const errors = validateCommandDescriptor(
      command('package-script', args, 'both', 'test'),
      label,
    );

    assert.ok(
      errors.some((error) => error.code === 'shell-syntax-rejected'),
      `expected ${label} to be rejected as shell syntax`,
    );
  }

  assert.deepEqual(
    validateCommandDescriptor(command('package-script', ['test:unit'], 'both', 'test'), 'ok'),
    [],
  );
});

test('AC-CFG-002: an explicitly declared repository script is surfaced as a Grader surface', () => {
  const facts = laravelFacts();

  facts.proved.smoke.evaluate = command(
    'repository-script',
    ['scripts/smoke.mjs', '--json'],
    'backend',
    'smoke',
  );

  const result = collectChecks([{ provider: laravelProvider, facts }]);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(graderSurfaces(result.checks), [
    { check_id: 'laravel.smoke.runtime', role: 'evaluate', path: 'scripts/smoke.mjs' },
  ]);
});

test('AC-CFG-002: activation resolves, versions, pins, and previews each approved executable', () => {
  const result = collectChecks([{ provider: laravelProvider, facts: laravelFacts() }]);
  const formatter = result.checks.filter((check) => check.capability === 'formatter');

  // Resolution finds the binary the descriptor's leading argument names, so the
  // executable is the binary itself rather than the directory holding it.
  const activation = resolveExecutables(formatter, (runner, command_) => (
    runner === 'composer-bin'
      ? { executable: `vendor/bin/${command_.args[0]}`, version: '1.18.1' }
      : null
  ));

  // The interpreter a resolver reports is pinned beside the executable: a tool
  // binary that is a script cannot start until the kernel finds it. This
  // fixture's resolver names none (TB-028).
  assert.deepEqual(activation.resolved, [
    {
      check_id: 'laravel.format.formatter',
      role: 'evaluate',
      runner: 'composer-bin',
      executable: 'vendor/bin/pint',
      interpreter: null,
      version: '1.18.1',
      pinned: { executable: 'vendor/bin/pint', interpreter: null, version: '1.18.1' },
      preview: 'vendor/bin/pint --test',
      working_directory: '.',
    },
    {
      check_id: 'laravel.format.formatter',
      role: 'fix',
      runner: 'composer-bin',
      executable: 'vendor/bin/pint',
      interpreter: null,
      version: '1.18.1',
      pinned: { executable: 'vendor/bin/pint', interpreter: null, version: '1.18.1' },
      preview: 'vendor/bin/pint',
      working_directory: '.',
    },
  ]);
  assert.deepEqual(activation.unresolved, []);
});

test('AC-CFG-002: an unresolved runner is reported rather than looked up through a shell', () => {
  const result = collectChecks([{ provider: laravelProvider, facts: laravelFacts() }]);
  const build = result.checks.filter((check) => check.capability === 'build');

  const activation = resolveExecutables(build, () => null);

  assert.deepEqual(activation.resolved, []);
  assert.deepEqual(activation.unresolved, [
    {
      check_id: 'laravel.build.artifact',
      role: 'evaluate',
      runner: 'package-script',
      reason: 'runner-unresolved',
    },
  ]);
});
