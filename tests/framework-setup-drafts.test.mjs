import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  draftGatePolicy,
  draftMigrationMapping,
  previewConfigurationMigration,
  previewGateConfiguration,
  migrateConfiguration,
} from '../skills/framework-setup/scripts/configure.mjs';
import { laravelCheckPlan } from '../skills/change-evaluation-gate/scripts/lib/providers/laravel.mjs';
import { nodePackageCheckPlan } from '../skills/change-evaluation-gate/scripts/lib/providers/node-package.mjs';
import { validateGatePolicy } from '../skills/change-evaluation-gate/scripts/lib/policy.mjs';
import {
  gateChecksFromConfiguration,
  readRepositoryConfiguration,
} from '../skills/change-evaluation-gate/scripts/lib/configuration.mjs';

const CONFIGURATION_FILE = '.agent-framework.yaml';

const temporaryRoot = async () => mkdtemp(path.join(tmpdir(), 'framework-setup-drafts-'));

const schemaV3 = ({ backend = 'laravel', frontend = 'unknown', commands }) => [
  'schema_version: 3',
  `backend: ${backend}`,
  `frontend: ${frontend}`,
  'tracker: local-markdown',
  'artifacts:',
  '  srs: null',
  '  glossary: null',
  '  adrs: null',
  'guidelines: []',
  'source_scopes:',
  '  backend:',
  '    - app',
  '  frontend: []',
  '  shared: []',
  'verification:',
  '  profile: laravel',
  '  capabilities: []',
  '  commands:',
  ...commands,
  'history:',
  '  path: null',
  '  required: false',
  'protected_files: []',
  '',
].join('\n');

const AMBIGUOUS_COMMANDS = [
  '    format:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  '        - "vendor/bin/pint --dirty"',
  '    test:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  '        - "node tools/check.mjs app/Order.php"',
];

/** Fill exactly the `null` leaves the draft exposed; the shape stays the draft's. */
const FILL = {
  profile: 'none',
  runner: 'repository-script',
  args: ['tools/check.mjs', 'app/Order.php'],
  timeout_seconds: 60,
};

const fillDraft = (draft) => ({
  ...(draft.profiles
    ? {
      profiles: Object.fromEntries(
        Object.keys(draft.profiles).map((profile) => [profile, FILL.profile]),
      ),
    }
    : {}),
  ...(draft.commands
    ? {
      commands: Object.fromEntries(Object.entries(draft.commands).map(([commandPath, fields]) => [
        commandPath,
        Object.fromEntries(Object.keys(fields).map((field) => [field, FILL[field]])),
      ])),
    }
    : {}),
});

const laravelProject = async (context) => {
  const root = await temporaryRoot();

  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, 'composer.json'),
    JSON.stringify({ require: { 'laravel/framework': '^11.0' } }),
    'utf8',
  );
  await writeFile(
    path.join(root, CONFIGURATION_FILE),
    schemaV3({ commands: AMBIGUOUS_COMMANDS }),
    'utf8',
  );

  return root;
};

const nodeProject = async (context) => {
  const root = await temporaryRoot();

  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }),
    'utf8',
  );
  await writeFile(
    path.join(root, CONFIGURATION_FILE),
    schemaV3({ backend: 'unknown', frontend: 'none', commands: AMBIGUOUS_COMMANDS }),
    'utf8',
  );

  return root;
};

/**
 * A minimal, valid schema v4 Command descriptor, JSON-encoded exactly the way
 * `migratedCommandDescriptor` renders one, so the hand-rolled configuration
 * reader parses it the same way a real migration output would.
 */
const v4Command = ({ args, category, sourceScope = 'both', timeoutSeconds }) => {
  const descriptor = {
    runner: 'repository-script',
    args,
    working_directory: '.',
    allowed_environment: [],
    evidence_category: category,
    source_scope: sourceScope,
  };

  if (timeoutSeconds !== undefined) {
    descriptor.timeout_seconds = timeoutSeconds;
  }

  return JSON.stringify(descriptor);
};

/** A schema v4 configuration fixture with real `verification.commands`. */
const schemaV4 = ({ backend = 'unknown', frontend = 'none', commandLines = [] }) => [
  'schema_version: 4',
  `backend: ${backend}`,
  `frontend: ${frontend}`,
  'history: {}',
  'verification:',
  '  commands:',
  ...commandLines,
  '',
].join('\n');

const v4Project = async (context, { backend, frontend, commandLines, node = false, laravel = false }) => {
  const root = await temporaryRoot();

  context.after(() => rm(root, { recursive: true, force: true }));

  if (node) {
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }),
      'utf8',
    );
  }

  if (laravel) {
    await writeFile(
      path.join(root, 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^11.0' } }),
      'utf8',
    );
  }

  await writeFile(
    path.join(root, CONFIGURATION_FILE),
    schemaV4({ backend, frontend, commandLines }),
    'utf8',
  );

  return root;
};

/** The `checks[].id` values a configuration's own runtime function derives. */
const configuredIdentities = async (root) => {
  const read = await readRepositoryConfiguration({ repositoryRoot: root });

  assert.equal(read.ok, true, `fixture configuration is unreadable: ${read.detail}`);

  return gateChecksFromConfiguration(read.configuration);
};

const singleCommandLines = [
  '    format:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  `        - ${v4Command({ args: ['tools/format.mjs'], category: 'format', timeoutSeconds: 60 })}`,
  '    test:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  `        - ${v4Command({ args: ['tools/test.mjs'], category: 'test', timeoutSeconds: 120 })}`,
];

const multiCommandLines = [
  '    format:',
  '      backend:',
  `        - ${v4Command({
    args: ['tools/format-backend.mjs'], category: 'format', sourceScope: 'backend', timeoutSeconds: 30,
  })}`,
  '      frontend:',
  `        - ${v4Command({
    args: ['tools/format-frontend.mjs'], category: 'format', sourceScope: 'frontend', timeoutSeconds: 30,
  })}`,
  '      both: []',
];

const unmatchedPlanEntryLines = [
  '    format:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  `        - ${v4Command({ args: ['tools/format.mjs'], category: 'format', timeoutSeconds: 60 })}`,
  '    smoke:',
  '      backend: []',
  '      frontend: []',
  '      both:',
  `        - ${v4Command({ args: ['tools/smoke.mjs'], category: 'smoke', timeoutSeconds: 90 })}`,
];

test('AC-CFG-002: the mapping draft is keyed by the reported ambiguities', async (context) => {
  const root = await laravelProject(context);
  const before = await readFile(path.join(root, CONFIGURATION_FILE), 'utf8');
  const report = await previewConfigurationMigration({ projectRoot: root, mappings: {} });

  assert.equal(report.status, 'requires-mapping');

  const draft = await draftMigrationMapping({ projectRoot: root });
  const commandAmbiguities = report.ambiguities.filter(
    (ambiguity) => ambiguity.path.startsWith('verification.commands.'),
  );

  assert.deepEqual(
    Object.keys(draft.commands),
    commandAmbiguities.map((ambiguity) => ambiguity.path),
  );

  for (const ambiguity of commandAmbiguities) {
    assert.deepEqual(Object.keys(draft.commands[ambiguity.path]), ambiguity.required);
    assert.deepEqual(
      Object.values(draft.commands[ambiguity.path]),
      ambiguity.required.map(() => null),
    );
  }

  assert.deepEqual(draft.profiles, { frontend: null });

  for (const envelopeKey of ['status', 'fromVersion', 'toVersion', 'previewHash', 'ambiguities']) {
    assert.equal(envelopeKey in draft, false, `${envelopeKey} must not appear in a mapping draft`);
  }

  assert.deepEqual(Object.keys(draft).sort(), ['commands', 'profiles']);
  assert.equal(await readFile(path.join(root, CONFIGURATION_FILE), 'utf8'), before);
});

test('AC-CFG-002: the filled mapping draft migrates without an unsupported section', async (context) => {
  const root = await laravelProject(context);
  const draft = await draftMigrationMapping({ projectRoot: root });
  const preview = await previewConfigurationMigration({
    projectRoot: root,
    mappings: fillDraft(draft),
  });

  assert.equal(preview.status, 'ready');
  assert.deepEqual(preview.ambiguities, []);
});

test('SG-CMD-001: a null-bearing mapping draft is refused rather than guessed', async (context) => {
  const root = await laravelProject(context);
  const draft = await draftMigrationMapping({ projectRoot: root });

  await assert.rejects(
    previewConfigurationMigration({ projectRoot: root, mappings: draft }),
    /Unsupported frontend profile mapping: null/,
  );
  await assert.rejects(
    previewConfigurationMigration({
      projectRoot: root,
      mappings: { commands: draft.commands },
    }),
    /Unsupported command runner: null|Invalid command timeout/,
  );
});

test('AC-CFG-002, FR-PROF-010: single-command identities equal gateChecksFromConfiguration output', async (context) => {
  const root = await v4Project(context, { node: true, commandLines: singleCommandLines });
  const before = await readFile(path.join(root, CONFIGURATION_FILE), 'utf8');
  const draft = await draftGatePolicy({ projectRoot: root });
  const { checks, errors } = await configuredIdentities(root);

  assert.deepEqual(errors, []);

  const expectedIds = checks.map((check) => check.id).sort();
  const actualIds = [...draft.checks.required, ...draft.checks.advisory].sort();

  assert.deepEqual(actualIds, expectedIds);
  assert.deepEqual(expectedIds, ['configuration.broad-tests.test', 'configuration.format.formatter']);
  assert.equal(draft.checks.required.includes('format.formatter'), false);
  assert.equal(draft.checks.required.includes('broad-tests.test'), false);
  assert.deepEqual(
    Object.keys(draft).sort(),
    ['budget', 'bypass', 'checks', 'evidence', 'execution'],
  );
  assert.equal('previewHash' in draft, false);
  assert.equal(await readFile(path.join(root, CONFIGURATION_FILE), 'utf8'), before);
});

test('AC-CFG-002, FR-PROF-010: multi-command identities carry the ordinal a shared stage earns', async (context) => {
  const root = await v4Project(context, { node: true, commandLines: multiCommandLines });
  const draft = await draftGatePolicy({ projectRoot: root });
  const { checks, errors } = await configuredIdentities(root);

  assert.deepEqual(errors, []);

  const expectedIds = checks.map((check) => check.id).sort();
  const actualIds = [...draft.checks.required, ...draft.checks.advisory].sort();

  assert.deepEqual(actualIds, expectedIds);
  assert.deepEqual(expectedIds, ['configuration.format.formatter.1', 'configuration.format.formatter.2']);
  assert.equal(draft.checks.required.includes('configuration.format.formatter'), false);
});

test('SG-OWNER-001: a configuration check with no matching provider entry binds advisory', async (context) => {
  const root = await v4Project(context, { node: true, commandLines: unmatchedPlanEntryLines });
  const draft = await draftGatePolicy({ projectRoot: root });

  assert.deepEqual(draft.checks.required, ['configuration.format.formatter']);
  assert.deepEqual(draft.checks.advisory, ['configuration.smoke.smoke']);
});

test('FR-PROF-010: the Laravel policy draft binds the provider plan policy for each configured check', async (context) => {
  const root = await v4Project(context, { laravel: true, commandLines: singleCommandLines });
  const draft = await draftGatePolicy({ projectRoot: root });
  const { checks } = await configuredIdentities(root);

  for (const check of checks) {
    const planEntry = laravelCheckPlan.find(
      (entry) => entry.stage === check.stage && entry.capability === check.capability,
    );
    const expectedBinding = planEntry?.policy === 'required' ? 'required' : 'advisory';

    assert.equal(
      draft.checks[expectedBinding].includes(check.id),
      true,
      `${check.id} was not bound ${expectedBinding} as the Laravel plan declares`,
    );
  }

  assert.equal(
    draft.checks.required.some((identity) => draft.checks.advisory.includes(identity)),
    false,
  );
});

test('SG-OWNER-001: framework-setup keeps no copy of the check catalogue', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../skills/framework-setup/scripts/configure.mjs', import.meta.url)),
    'utf8',
  );

  for (const entry of [...laravelCheckPlan, ...nodePackageCheckPlan]) {
    assert.equal(
      source.includes(entry.id),
      false,
      `configure.mjs restates the check identity ${entry.id}`,
    );
  }

  assert.equal(
    /['"]configuration\./.test(source),
    false,
    'configure.mjs hardcodes a literal configuration.<stage>.<capability> identity prefix',
  );
});

test('FR-EVAL-001: a project with no schema v4 configuration is refused with a migration message', async (context) => {
  const root = await laravelProject(context);

  await assert.rejects(
    draftGatePolicy({ projectRoot: root }),
    /migrat/i,
  );
});

test('FR-EVAL-001: a schema v4 configuration with nothing in verification.commands is refused with a migration message', async (context) => {
  const root = await v4Project(context, { node: true, commandLines: [] });

  await assert.rejects(
    draftGatePolicy({ projectRoot: root }),
    /migrat/i,
  );
});

test('FR-PROF-010: a drafted policy passes validateGatePolicy and configures the Gate', async (context) => {
  const root = await laravelProject(context);
  const draft = await draftMigrationMapping({ projectRoot: root });
  const mappings = fillDraft(draft);
  const migration = await previewConfigurationMigration({ projectRoot: root, mappings });

  await migrateConfiguration({ projectRoot: root, mappings, confirmation: migration.previewHash });

  const policy = await draftGatePolicy({ projectRoot: root });

  assert.deepEqual(validateGatePolicy(policy), []);
  assert.equal(policy.budget.total_seconds, FILL.timeout_seconds * 2);

  const preview = await previewGateConfiguration({ projectRoot: root, policy });

  assert.equal(preview.status, 'ready');
});

test('SG-CMD-001: an unprovable budget stays null and is refused by the reader', async (context) => {
  const commandLines = [
    '    format:',
    '      backend: []',
    '      frontend: []',
    '      both:',
    `        - ${v4Command({ args: ['tools/format.mjs'], category: 'format', timeoutSeconds: 60 })}`,
    '    smoke:',
    '      backend: []',
    '      frontend: []',
    '      both:',
    // No `timeoutSeconds`: a proved check identity with an unproved timeout,
    // so the budget stays unprovable even while checks still derive.
    `        - ${v4Command({ args: ['tools/smoke.mjs'], category: 'smoke' })}`,
  ];
  const root = await v4Project(context, { node: true, commandLines });

  const policy = await draftGatePolicy({ projectRoot: root });

  assert.deepEqual(policy.checks.required, ['configuration.format.formatter']);
  assert.equal(policy.budget.total_seconds, null);
  await assert.rejects(
    previewGateConfiguration({ projectRoot: root, policy }),
    /budget/i,
  );
});

test('SG-CMD-001: drafting to --out refuses to overwrite an existing file', async (context) => {
  const root = await laravelProject(context);
  const out = path.join(root, 'mapping.json');

  await writeFile(out, '{"commands":{}}\n', 'utf8');
  await assert.rejects(
    draftMigrationMapping({ projectRoot: root, out }),
    /already exists/,
  );
  assert.equal(await readFile(out, 'utf8'), '{"commands":{}}\n');
});
