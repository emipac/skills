/**
 * TB-024 — Resolve every runner to the executable its contract names, once.
 *
 * The provider descriptor contract says a `composer-bin` descriptor names its
 * binary in its leading argument and that resolution consumes it. Composition
 * already drops that argument; the shipped resolver ignored it and ran
 * `composer` instead, so an activated clone ran a program its policy never
 * named (`FR-PROF-010`, `SG-CMD-001`, `NFR-REL-003`).
 *
 * These fixtures drive resolution itself — the participant no test had ever
 * exercised — against real files on disk, so a resolver can only pass by
 * producing an executable that exists.
 */

import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createRunnerResolver,
  resolveExecutables,
} from '../skills/change-evaluation-gate/scripts/lib/command-descriptor.mjs';

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Wrap a stored runner/args pair in the rest of the schema v4 command shape. */
const stored = (runner, args, overrides = {}) => ({
  runner,
  args,
  working_directory: '.',
  timeout_seconds: 300,
  allowed_environment: ['PATH'],
  evidence_category: 'format',
  source_scope: 'backend',
  ...overrides,
});

/** The descriptor a real Laravel migration stores for `vendor/bin/pint`. */
const PINT = stored('composer-bin', ['pint', '--dirty', '--format', 'agent']);

/** A throwaway repository, optionally carrying real vendor binaries. */
const repositoryWith = async (t, binaries = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'gate-runner-resolution-'));

  t.after(() => import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true })));

  for (const [relative, contents] of Object.entries(binaries)) {
    const target = path.join(root, relative);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
    await chmod(target, 0o755);
  }

  return root;
};

const resolutionOf = (root, command, environment = process.env) => createRunnerResolver({
  repositoryRoot: root,
  environment,
})(command.runner, command);

test('FR-PROF-010: a composer-bin descriptor resolves to the vendor binary its arguments name', async (t) => {
  const root = await repositoryWith(t, { 'vendor/bin/pint': '#!/bin/sh\nexit 0\n' });

  const resolution = resolutionOf(root, PINT);

  assert.equal(
    resolution?.executable,
    path.join(root, 'vendor/bin/pint'),
    'a composer-bin runner names a binary under the vendor directory, never the composer front end.',
  );
  // The path must be absolute: checks execute inside a materialised snapshot,
  // where `vendor/` is absent because it is git-ignored.
  assert.equal(path.isAbsolute(resolution.executable), true);
});

test('SG-CMD-001: the resolved vendor binary composes to the command the maintainer wrote', async (t) => {
  const root = await repositoryWith(t, { 'vendor/bin/pint': '#!/bin/sh\nexit 0\n' });
  const activation = resolveExecutables(
    [{ id: 'configuration.format.backend', evaluate: PINT }],
    createRunnerResolver({ repositoryRoot: root, environment: process.env }),
  );

  assert.deepEqual(activation.unresolved, []);
  assert.equal(
    activation.resolved[0].preview,
    `${path.join(root, 'vendor/bin/pint')} --dirty --format agent`,
  );
  assert.doesNotMatch(
    activation.resolved[0].preview,
    /composer/,
    'running composer with the descriptor arguments discarded is the defect this closes.',
  );
});

test('FR-PROF-010: a composer-bin descriptor whose vendor binary is absent is unresolved and denies', async (t) => {
  const root = await repositoryWith(t);

  assert.equal(resolutionOf(root, PINT), null);

  const activation = resolveExecutables(
    [{ id: 'configuration.format.backend', evaluate: PINT }],
    createRunnerResolver({ repositoryRoot: root, environment: process.env }),
  );

  assert.deepEqual(activation.resolved, []);
  assert.deepEqual(activation.unresolved, [{
    check_id: 'configuration.format.backend',
    role: 'evaluate',
    runner: 'composer-bin',
    reason: 'runner-unresolved',
  }]);
});

test('SG-CMD-001: a composer-bin binary name carrying a path separator is refused, never joined', async (t) => {
  const root = await repositoryWith(t, {
    'vendor/bin/pint': '#!/bin/sh\nexit 0\n',
    'tools/escape': '#!/bin/sh\nexit 0\n',
  });

  for (const name of ['../../tools/escape', 'nested/pint', '..', '.']) {
    assert.equal(
      resolutionOf(root, stored('composer-bin', [name])),
      null,
      `a binary name of ${JSON.stringify(name)} must be refused rather than normalised into a path.`,
    );
  }
});

test('FR-PROF-010: a composer-bin descriptor resolves under its own working directory', async (t) => {
  const root = await repositoryWith(t, {
    'api/vendor/bin/pint': '#!/bin/sh\nexit 0\n',
  });

  const resolution = resolutionOf(root, stored('composer-bin', ['pint'], { working_directory: 'api' }));

  assert.equal(
    resolution?.executable,
    path.join(root, 'api/vendor/bin/pint'),
    'a repository whose PHP application lives in a subdirectory keeps vendor under that subdirectory.',
  );
});

test('FR-PROF-010: the three unchanged runners still resolve exactly as their contract rows say', async (t) => {
  const root = await repositoryWith(t, { 'tools/php': '#!/bin/sh\nexit 0\n', 'tools/npm': '#!/bin/sh\nexit 0\n' });
  const environment = { PATH: path.join(root, 'tools') };

  assert.equal(
    resolutionOf(root, stored('php-script', ['artisan', 'test']), environment)?.executable,
    path.join(root, 'tools/php'),
  );
  assert.equal(
    resolutionOf(root, stored('package-script', ['format:check']), environment)?.executable,
    path.join(root, 'tools/npm'),
  );
  assert.equal(
    resolutionOf(root, stored('repository-script', ['scripts/smoke.mjs']), environment)?.executable,
    process.execPath,
  );
  // A repository script this Node runtime cannot run is left unresolved rather
  // than guessed at.
  assert.equal(resolutionOf(root, stored('repository-script', ['scripts/smoke.sh']), environment), null);
  // An unresolved runner never falls back to a shell lookup.
  assert.equal(resolutionOf(root, stored('php-script', ['artisan']), { PATH: '' }), null);
});

test('SG-OWNER-001: exactly one module maps a logical runner to an executable', async () => {
  const libraryRoot = path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/lib');
  const { readdir } = await import('node:fs/promises');
  const modules = (await readdir(libraryRoot)).filter((entry) => entry.endsWith('.mjs'));
  const vendorDirectory = /vendor[/\\]bin/;
  const platformBinary = /['"](?:composer|php|npm)['"]/;
  const owners = [];

  for (const module of modules) {
    const source = await readFile(path.join(libraryRoot, module), 'utf8');

    if (vendorDirectory.test(source) || platformBinary.test(source)) {
      owners.push(module);
    }
  }

  assert.deepEqual(
    owners,
    ['command-descriptor.mjs'],
    'a second copy of runner resolution is how activation and the hook came to name different programs.',
  );
});
