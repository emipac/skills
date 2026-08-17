import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  configureGate,
  migrateConfiguration,
  previewConfigurationMigration,
  previewGateConfiguration,
} from '../skills/framework-setup/scripts/configure.mjs';
import {
  CONFIGURATION_FILE,
  parseConfigurationDocument,
  readRepositoryConfiguration,
  gateChecksFromConfiguration,
} from '../skills/change-evaluation-gate/scripts/lib/configuration.mjs';
import { validateCheckDescriptor } from '../skills/change-evaluation-gate/scripts/lib/check-descriptor.mjs';
import { validateGatePolicy } from '../skills/change-evaluation-gate/scripts/lib/policy.mjs';

const temporaryRoot = async () => mkdtemp(path.join(tmpdir(), 'gate-configuration-'));

test('the documented starter policy is accepted by setup and the Gate runtime', async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const guide = await readFile(path.join(process.cwd(), 'docs', 'framework-guide.html'), 'utf8');
  // The guide stopped telling maintainers to hand-write this file: the policy
  // it documents is now the one `--draft-policy` produces, so the sample under
  // test is that block. A policy the guide shows must still configure.
  const sample = guide.match(/<pre><code>(?<policy>\{\s*\n\s*"checks":[\s\S]*?\n\})<\/code><\/pre>/);

  assert.notEqual(sample?.groups?.policy, undefined, 'The guide must contain its documented policy.');

  const policy = JSON.parse(sample.groups.policy);

  await writeFile(path.join(root, CONFIGURATION_FILE), 'schema_version: 4\nhistory: {}\n');

  const preview = await previewGateConfiguration({ projectRoot: root, policy });

  assert.equal(preview.status, 'ready');
  assert.deepEqual(validateGatePolicy(policy), []);
});

test('framework setup refuses a policy the Gate runtime cannot evaluate', async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const policy = {
    checks: { required: [], advisory: [] },
    budget: { total_seconds: 900 },
    bypass: {},
    execution: {},
    evidence: {},
  };

  await writeFile(path.join(root, CONFIGURATION_FILE), 'schema_version: 4\nhistory: {}\n');

  assert.deepEqual(
    validateGatePolicy(policy).map((issue) => issue.code),
    ['gate-policy-bypass-invalid'],
  );
  await assert.rejects(
    previewGateConfiguration({ projectRoot: root, policy }),
    /The bypass subcontract must state explicitly whether bypass is enabled/,
  );
});

test('the configuration reader reads the block structure the framework is configured in', () => {
  const document = [
    '# The framework configuration.',
    'schema_version: 4',
    'backend: unknown',
    'artifacts:',
    '  srs: docs/specifications/srs.md',
    '  adrs: null',
    'guidelines:',
    '  - AGENTS.md',
    '  - CLAUDE.md',
    'history:',
    '  path: docs/history',
    '  required: true',
    '',
  ].join('\n');

  const result = parseConfigurationDocument(document);

  assert.equal(result.ok, true, result.detail ?? '');
  assert.deepEqual(result.value, {
    schema_version: 4,
    backend: 'unknown',
    artifacts: { srs: 'docs/specifications/srs.md', adrs: null },
    guidelines: ['AGENTS.md', 'CLAUDE.md'],
    history: { path: 'docs/history', required: true },
  });
});

test('a quoted value keeps every character it was written with, apostrophes included', () => {
  const document = [
    "profile: \"the project's own profile\"",
    "note: 'it said \"no\" # not a comment'",
    'plain: a value # with a trailing comment',
    '',
  ].join('\n');

  const result = parseConfigurationDocument(document);

  assert.equal(result.ok, true, result.detail ?? '');
  assert.equal(result.value.profile, "the project's own profile");
  assert.equal(result.value.note, 'it said "no" # not a comment');
  assert.equal(result.value.plain, 'a value');
});

test('a sequence of command descriptors is read as a list of objects', () => {
  const document = [
    'verification:',
    '  commands:',
    '    test:',
    '      both:',
    '        - runner: package-script',
    '          args:',
    '            - test:unit',
    '          working_directory: "."',
    '          timeout_seconds: 600',
    '          allowed_environment:',
    '            - PATH',
    '          evidence_category: test',
    '          source_scope: both',
    '      backend: []',
    '      frontend: []',
    '',
  ].join('\n');

  const result = parseConfigurationDocument(document);

  assert.equal(result.ok, true, result.detail ?? '');
  assert.deepEqual(result.value.verification.commands.test, {
    both: [{
      runner: 'package-script',
      args: ['test:unit'],
      working_directory: '.',
      timeout_seconds: 600,
      allowed_environment: ['PATH'],
      evidence_category: 'test',
      source_scope: 'both',
    }],
    backend: [],
    frontend: [],
  });
});

test('a migrated and Gate-configured repository reads like equivalent block YAML', async (context) => {
  const root = await temporaryRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const configurationPath = path.join(root, CONFIGURATION_FILE);
  const mappings = {
    profiles: { backend: 'none' },
    commands: {
      'verification.commands.test.both[0]': { timeout_seconds: 300 },
    },
  };
  const policy = {
    checks: { required: ['configuration.broad-tests.test'], advisory: [] },
    budget: { total_seconds: 300 },
    bypass: { enabled: false },
    execution: {},
    evidence: {},
  };

  await writeFile(configurationPath, [
    'schema_version: 3',
    'backend: unknown',
    'frontend: none',
    'verification:',
    '  profile: unknown',
    '  capabilities: []',
    '  commands:',
    '    test:',
    '      backend: []',
    '      frontend: []',
    '      both:',
    '        - "npm run test:unit"',
    'history:',
    '  path: null',
    '  required: false',
    '',
  ].join('\n'));

  const migration = await previewConfigurationMigration({ projectRoot: root, mappings });

  await migrateConfiguration({
    projectRoot: root,
    mappings,
    confirmation: migration.previewHash,
  });

  const gateConfiguration = await previewGateConfiguration({ projectRoot: root, policy });

  await configureGate({
    projectRoot: root,
    policy,
    confirmation: gateConfiguration.previewHash,
  });

  const written = await readRepositoryConfiguration({ repositoryRoot: root });
  const equivalentBlockConfiguration = parseConfigurationDocument([
    'schema_version: 4',
    'backend: none',
    'frontend: none',
    'verification:',
    '  profile: tooling',
    '  capabilities: []',
    '  commands:',
    '    test:',
    '      backend: []',
    '      frontend: []',
    '      both:',
    '        - runner: package-script',
    '          args:',
    '            - test:unit',
    '          working_directory: "."',
    '          timeout_seconds: 300',
    '          allowed_environment: []',
    '          evidence_category: test',
    '          source_scope: both',
    'evaluation_gate:',
    '  checks:',
    '    required:',
    '      - configuration.broad-tests.test',
    '    advisory: []',
    '  budget:',
    '    total_seconds: 300',
    '  bypass:',
    '    enabled: false',
    '  execution: {}',
    '  evidence: {}',
    'history:',
    '  path: null',
    '  required: false',
    '',
  ].join('\n'));

  assert.equal(written.ok, true, written.detail ?? '');
  assert.equal(equivalentBlockConfiguration.ok, true, equivalentBlockConfiguration.detail ?? '');
  assert.deepEqual(written.configuration, equivalentBlockConfiguration.value);
});

test('non-JSON flow YAML and YAML references keep their existing refusals', () => {
  for (const value of [
    '{runner: "package-script"}',
    '[test:unit, test:install]',
    '{"runner":"package-script",}',
    "{'runner':'package-script'}",
  ]) {
    const result = parseConfigurationDocument(`value: ${value}\n`);

    assert.equal(result.ok, false);
    assert.equal(
      result.detail,
      `${CONFIGURATION_FILE} could not be read at line 1: flow collections are outside the supported configuration subset.`,
    );
  }

  for (const value of ['&defaults', '*defaults', '!custom']) {
    const result = parseConfigurationDocument(`value: ${value}\n`);

    assert.equal(result.ok, false);
    assert.equal(
      result.detail,
      `${CONFIGURATION_FILE} could not be read at line 1: anchors, aliases, and tags are outside the supported configuration subset.`,
    );
  }
});

test('this repository\'s own configuration is readable through the supported reader', async () => {
  const result = await readRepositoryConfiguration({ repositoryRoot: process.cwd() });

  assert.equal(result.ok, true, result.detail ?? '');
  assert.equal(result.configuration.schema_version, 3);
  assert.ok(result.configuration.verification.capabilities.includes('gate-activation-smoke'));
  assert.equal(result.configuration.history.path, 'docs/history');
});

test('an absent configuration is reported, never defaulted', async () => {
  const root = await temporaryRoot();

  try {
    const result = await readRepositoryConfiguration({ repositoryRoot: root });

    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, 'configuration-missing');
    assert.equal(result.configuration, null);
    assert.match(result.detail, /\.agent-framework\.yaml/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a configuration the reader cannot read is refused rather than guessed at', async () => {
  const root = await temporaryRoot();

  try {
    await writeFile(
      path.join(root, CONFIGURATION_FILE),
      'schema_version: 4\n\tbackend: unknown\n',
      'utf8',
    );

    const result = await readRepositoryConfiguration({ repositoryRoot: root });

    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, 'configuration-unreadable');
    assert.equal(result.configuration, null);
    assert.match(result.detail, /line 2/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const commandDescriptor = (overrides = {}) => ({
  runner: 'repository-script',
  args: ['tools/check.mjs'],
  working_directory: '.',
  timeout_seconds: 60,
  allowed_environment: ['PATH'],
  evidence_category: 'test',
  source_scope: 'both',
  ...overrides,
});

const configured = (commands) => ({
  schema_version: 4,
  verification: { profile: 'fixture', capabilities: [], commands },
});

test('configured commands become check descriptors the contract accepts', () => {
  const { checks, errors } = gateChecksFromConfiguration(configured({
    test: { backend: [], frontend: [], both: [commandDescriptor()] },
    format: {
      backend: [commandDescriptor({ evidence_category: 'format', source_scope: 'backend' })],
      frontend: [],
      both: [],
    },
  }));

  assert.deepEqual(errors, []);
  assert.deepEqual(checks.map((check) => check.id), [
    'configuration.format.formatter',
    'configuration.broad-tests.test',
  ]);
  assert.deepEqual(
    checks.map((check) => check.stage),
    ['format', 'broad-tests'],
    'checks are ordered by the Evidence ladder, which the gate imports rather than restates.',
  );

  const broad = checks.find((check) => check.id === 'configuration.broad-tests.test');

  assert.equal(broad.provider, 'configuration');
  assert.equal(broad.scope, 'both');
  assert.equal(broad.fix, null, 'evaluation is non-mutating; a configured command is an evaluate command.');
  assert.deepEqual(validateCheckDescriptor(broad), []);
});

test('two commands at one stage get distinct stable identities', () => {
  const { checks, errors } = gateChecksFromConfiguration(configured({
    test: {
      backend: [],
      frontend: [],
      both: [commandDescriptor(), commandDescriptor({ args: ['tools/other.mjs'] })],
    },
  }));

  assert.deepEqual(errors, []);
  assert.deepEqual(checks.map((check) => check.id), [
    'configuration.broad-tests.test.1',
    'configuration.broad-tests.test.2',
  ]);
});

test('a configured command the descriptor contract rejects is reported, never dropped', () => {
  const { checks, errors } = gateChecksFromConfiguration(configured({
    test: { backend: [], frontend: [], both: [commandDescriptor({ runner: 'bash' })] },
  }));

  assert.deepEqual(checks, []);
  assert.equal(errors.length > 0, true);
  assert.equal(errors[0].code, 'runner-unresolved');
});

test('a stage the Evidence ladder does not define is reported rather than mapped by guess', () => {
  const { checks, errors } = gateChecksFromConfiguration(configured({
    invented_stage: { backend: [], frontend: [], both: [commandDescriptor()] },
  }));

  assert.deepEqual(checks, []);
  assert.equal(errors[0].code, 'verification-stage-unknown');
});
