import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PORTABILITY_FIXTURES,
  buildCompatibilityManifest,
  qualifyRelease,
  PROMOTION_REQUIREMENTS,
  promotionProcedure,
  readReleaseVersion,
} from '../skills/change-evaluation-gate/scripts/lib/release-qualification.mjs';
import { BASELINE_CHECKS } from '../skills/change-evaluation-gate/scripts/lib/adapters.mjs';
import { TRUST_BOUNDARY } from '../skills/change-evaluation-gate/scripts/lib/security-control.mjs';

const FRAMEWORK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every fixture passing, in the canonical order. */
const passingFixtures = () => PORTABILITY_FIXTURES.map((id) => ({
  id,
  ok: true,
  detail: `${id} held.`,
  durationMs: 1,
}));

const environmentFixture = (overrides = {}) => ({
  id: 'darwin-arm64-node-v24.6.0',
  claim: 'claimed',
  os: { platform: 'darwin', name: 'macOS', version: '26.6.1', kernel: '25.6.0', arch: 'arm64' },
  runtime: { node: 'v24.6.0', npm: '11.5.1' },
  tools: { git: '2.51.0' },
  fixtures: passingFixtures(),
  ...overrides,
});

/** The two risks that stay open, with the evidence each one owes. */
const visibleRiskFixture = () => [
  {
    id: 'RISK-003',
    status: 'open',
    owner: 'Product owner',
    evidence: {
      kind: 'timing',
      observations: [{ id: 'timeout', durationMs: 214 }],
    },
  },
  {
    id: 'RISK-007',
    status: 'open',
    owner: 'Repository maintainer',
    evidence: {
      kind: 'attempts',
      observations: [{ id: 'conflicting-attempts', attempts: 2, outcome: 'unverified' }],
    },
  },
];

const manifestFixture = (overrides = {}) => buildCompatibilityManifest({
  release: {
    id: 'change-evaluation-gate',
    version: '0.8.0',
    versionSource: 'package.json',
    protocolVersion: '1.0',
  },
  environments: [environmentFixture()],
  surfaces: [],
  risks: visibleRiskFixture(),
  recordedAt: '2026-08-11T00:00:00.000Z',
  ...overrides,
});

/**
 * The first red test named by TB-015: a manifest claiming one environment
 * without its required portability outcome fails qualification (AC-PORT-001).
 *
 * Omitting a fixture is the cheapest way to make a matrix look green, so the
 * canonical fixture set — not the set the manifest happens to carry — decides
 * what a claimed environment owes.
 */
test('a claimed environment missing a portability outcome fails qualification', () => {
  const complete = qualifyRelease(manifestFixture());

  assert.equal(complete.qualified, true);
  assert.deepEqual(complete.errors, []);

  const withoutTimeout = manifestFixture({
    environments: [environmentFixture({
      fixtures: passingFixtures().filter((fixture) => fixture.id !== 'timeout'),
    })],
  });
  const result = qualifyRelease(withoutTimeout);

  assert.equal(result.qualified, false);
  assert.deepEqual(
    result.errors.map((error) => error.code),
    ['portability-outcome-missing'],
  );
  assert.match(result.errors[0].message, /timeout/);
  assert.equal(result.errors[0].path, 'environments[0].fixtures');
});

/**
 * The other half of the same rule. Omission is caught above; this is the
 * manifest that reports the failure honestly and still tries to claim the
 * environment. Reporting a failed fixture is required — passing anyway is not
 * (AC-PORT-001).
 */
test('a claimed environment with a failed portability outcome fails qualification', () => {
  const failed = manifestFixture({
    environments: [environmentFixture({
      fixtures: passingFixtures().map((fixture) => (fixture.id === 'process-tree'
        ? { ...fixture, ok: false, detail: 'a descendant outlived its parent' }
        : fixture)),
    })],
  });
  const result = qualifyRelease(failed);

  assert.equal(result.qualified, false);
  assert.deepEqual(
    result.errors.map((error) => error.code),
    ['portability-fixture-failed'],
  );
  assert.match(result.errors[0].message, /process-tree/);

  // An outcome the contract does not name cannot stand in for one it does.
  const substituted = manifestFixture({
    environments: [environmentFixture({
      fixtures: [
        ...passingFixtures().filter((fixture) => fixture.id !== 'linked-worktree'),
        { id: 'linked-worktree-lite', ok: true, detail: 'a narrower thing passed', durationMs: 1 },
      ],
    })],
  });

  assert.deepEqual(
    qualifyRelease(substituted).errors.map((error) => error.code),
    ['portability-outcome-missing', 'portability-outcome-unknown'],
  );
});

/**
 * A matrix is a function of what is claimed. A manifest that claims nothing
 * proves nothing, and must not qualify a release by being empty (Q-004).
 */
test('a manifest that claims no environment cannot qualify a release', () => {
  const unclaimed = manifestFixture({
    environments: [environmentFixture({
      claim: 'unverified',
      reason: 'the matrix was not executed here',
      fixtures: [],
    })],
  });

  assert.deepEqual(
    qualifyRelease(unclaimed).errors.map((error) => error.code),
    ['no-claimed-environment'],
  );
});

/**
 * The release version is read from `package.json` at generation time.
 *
 * A hardcoded version is a claim that silently rots: the release PR's
 * `changeset version` step is what moves this repository to `0.9.0`, and a
 * manifest carrying a literal could disagree with the package it describes
 * from the moment it is written (Q-005).
 */
test('the manifest reads its release version from package.json rather than carrying a literal', async () => {
  const onDisk = JSON.parse(await readFile(path.join(FRAMEWORK_ROOT, 'package.json'), 'utf8'));
  const read = await readReleaseVersion(FRAMEWORK_ROOT);

  assert.equal(read.source, 'package.json');
  assert.equal(read.version, onDisk.version);
  assert.match(read.version, /^\d+\.\d+\.\d+/);

  // A manifest that disagrees with the package it describes cannot qualify.
  const disagreeing = manifestFixture({
    release: {
      id: 'change-evaluation-gate',
      version: '9.9.9',
      versionSource: 'package.json',
      protocolVersion: '1.0',
    },
  });

  assert.deepEqual(
    qualifyRelease(disagreeing, { expectedVersion: read.version }).errors.map((error) => error.code),
    ['release-version-mismatch'],
  );

  // And a version that was never read from the package is not evidence at all.
  const asserted = manifestFixture({
    release: {
      id: 'change-evaluation-gate',
      version: read.version,
      versionSource: 'release-notes',
      protocolVersion: '1.0',
    },
  });

  assert.deepEqual(
    qualifyRelease(asserted, { expectedVersion: read.version }).errors.map((error) => error.code),
    ['release-version-not-read'],
  );

  // The generator itself must contain no version literal to disagree with.
  const generatorSources = [
    'skills/change-evaluation-gate/scripts/lib/release-qualification.mjs',
    'skills/change-evaluation-gate/scripts/gate-runtime-portability.mjs',
  ];

  for (const relative of generatorSources) {
    const source = await readFile(path.join(FRAMEWORK_ROOT, relative), 'utf8');
    const literals = source.match(/(?<![\w.])\d+\.\d+\.\d+(?![\w.])/g) ?? [];

    assert.deepEqual(literals, [], `${relative} hardcodes a version literal: ${literals.join(', ')}.`);
  }
});

/**
 * `Q-004`: exact tested versions are an evidence snapshot, never a permanent
 * runtime allowlist. An environment nobody tested has no verified claim yet —
 * which is a different thing from being refused.
 */
test('untested environments are unverified rather than denied, and evidence is never an allowlist', () => {
  const withUnverified = manifestFixture({
    environments: [
      environmentFixture(),
      {
        id: 'linux-x64',
        claim: 'unverified',
        reason: 'no-such-environment-was-available-to-this-qualification-run',
        os: { platform: 'linux', name: null, version: null, kernel: null, arch: 'x64' },
        runtime: { node: null, npm: null },
        tools: { git: null },
        fixtures: [],
      },
    ],
  });
  const result = qualifyRelease(withUnverified);

  assert.equal(result.qualified, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.claimed.length, 1);
  assert.equal(result.unverified.length, 1);

  // An unverified row still owes a reason: silence would read as an omission.
  const silent = manifestFixture({
    environments: [environmentFixture(), { id: 'linux-x64', claim: 'unverified', fixtures: [] }],
  });

  assert.deepEqual(
    qualifyRelease(silent).errors.map((error) => error.code),
    ['environment-reason-missing'],
  );

  // Denying an environment is not a claim this evidence can support.
  const denied = manifestFixture({
    environments: [environmentFixture(), { id: 'win32-x64', claim: 'denied', fixtures: [] }],
  });

  assert.deepEqual(
    qualifyRelease(denied).errors.map((error) => error.code),
    ['environment-claim-invalid'],
  );

  // Nor may the manifest present its snapshot as a standing allowlist.
  const allowlisted = manifestFixture({ evidencePolicy: 'permanent-allowlist' });

  assert.deepEqual(
    qualifyRelease(allowlisted).errors.map((error) => error.code),
    ['permanent-allowlist-rejected'],
  );
  assert.equal(manifestFixture().evidencePolicy, 'evidence-snapshot');
});

/** A surface record carrying a real baseline result shape. */
const surfaceFixture = (overrides = {}) => ({
  adapterId: 'cursor',
  surface: 'cursor-agent-stop',
  variant: 'desktop',
  capabilities: { repositoryFilesystem: true, processExecution: true, git: true },
  tier: 'experimental',
  reason: 'client-invocation-not-observed',
  baseline: {
    passed: true,
    failedChecks: [],
    checks: BASELINE_CHECKS.map((id) => ({ id, ok: true, detail: `${id} held.` })),
    evidence: { payloadSource: 'synthetic-fixture' },
    versions: { gate: '0.8.0', git: 'git version 2.51.0', node: 'v24.6.0', os: 'darwin 25.6.0', client: null },
  },
  ...overrides,
});

/**
 * `SG-SUPPORT-001`: the declared tier is not the claim of record — the tier the
 * evidence produces is. A manifest may state a tier, but qualification derives
 * it again from the same baseline and refuses any disagreement.
 */
test('a declared support tier must be the tier its own evidence produces', () => {
  const honest = manifestFixture({ surfaces: [surfaceFixture()] });

  assert.equal(qualifyRelease(honest).qualified, true);

  // The whole point of TB-013's reopen: a pass on payloads this repository
  // built from the declaration under test cannot establish support.
  const overclaimed = manifestFixture({
    surfaces: [surfaceFixture({ tier: 'supported', reason: 'baseline-passed' })],
  });
  const result = qualifyRelease(overclaimed);

  assert.equal(result.qualified, false);
  assert.deepEqual(result.errors.map((error) => error.code), ['support-tier-unproved']);
  assert.match(result.errors[0].message, /experimental/);
  assert.match(result.errors[0].message, /client-invocation-not-observed/);

  // The rule is evidence-based, not a blanket refusal: a baseline a real client
  // actually drove does reach `supported`.
  const captured = manifestFixture({
    surfaces: [surfaceFixture({
      tier: 'supported',
      reason: 'baseline-passed',
      baseline: {
        ...surfaceFixture().baseline,
        evidence: { payloadSource: 'captured-client-invocation' },
      },
    })],
  });

  assert.equal(qualifyRelease(captured).qualified, true);

  // And a context that cannot reach the repository cannot be experimental
  // either; understating a tier is as much a disagreement as overstating one.
  const unreachable = manifestFixture({
    surfaces: [surfaceFixture({
      capabilities: { repositoryFilesystem: false, processExecution: true, git: true },
    })],
  });

  assert.deepEqual(
    qualifyRelease(unreachable).errors.map((error) => error.code),
    ['support-tier-unproved'],
  );
});

/**
 * `SG-SUPPORT-001` again, from the other side: a tier is a claim about a
 * baseline that ran. A surface with no per-check outcomes and no exact versions
 * has recorded nothing to disagree with (NFR-COMP-001).
 */
test('a surface without per-check outcomes and exact versions records no baseline at all', () => {
  const withoutChecks = manifestFixture({
    surfaces: [surfaceFixture({ baseline: { ...surfaceFixture().baseline, checks: [] } })],
  });

  assert.deepEqual(
    qualifyRelease(withoutChecks).errors.map((error) => error.code),
    ['baseline-outcomes-missing'],
  );

  const withoutVersions = manifestFixture({
    surfaces: [surfaceFixture({ baseline: { ...surfaceFixture().baseline, versions: null } })],
  });

  assert.deepEqual(
    qualifyRelease(withoutVersions).errors.map((error) => error.code),
    ['baseline-versions-missing'],
  );

  // Every shared baseline check owes an outcome, exactly as every portability
  // fixture does.
  const partial = manifestFixture({
    surfaces: [surfaceFixture({
      baseline: {
        ...surfaceFixture().baseline,
        checks: surfaceFixture().baseline.checks.slice(1),
      },
    })],
  });

  assert.deepEqual(
    qualifyRelease(partial).errors.map((error) => error.code),
    ['baseline-outcomes-missing'],
  );
});

/**
 * `RISK-003` and `RISK-007` are conditionally accepted as OPEN. Qualifying a
 * release is not an occasion to close them, and a manifest that quietly drops
 * them is the same failure as one that closes them.
 */
test('the two open delivery risks stay visible with timing and attempt evidence', () => {
  const visible = manifestFixture({ risks: visibleRiskFixture() });

  assert.equal(qualifyRelease(visible).qualified, true);

  assert.deepEqual(
    qualifyRelease(manifestFixture({ risks: [] })).errors.map((error) => error.code),
    ['risk-not-visible', 'risk-not-visible'],
  );

  const closed = manifestFixture({
    risks: visibleRiskFixture().map((risk) => (risk.id === 'RISK-003'
      ? { ...risk, status: 'closed' }
      : risk)),
  });

  assert.deepEqual(
    qualifyRelease(closed).errors.map((error) => error.code),
    ['risk-closed-without-evidence'],
  );

  // Visible is not enough: each risk owes the specific evidence it was accepted
  // against — measured timing for RISK-003, recorded attempts for RISK-007.
  const unevidenced = manifestFixture({
    risks: visibleRiskFixture().map((risk) => ({
      ...risk,
      evidence: { ...risk.evidence, observations: [] },
    })),
  });

  assert.deepEqual(
    qualifyRelease(unevidenced).errors.map((error) => error.code),
    ['risk-evidence-missing', 'risk-evidence-missing'],
  );

  const wrongKind = manifestFixture({
    risks: visibleRiskFixture().map((risk) => (risk.id === 'RISK-007'
      ? { ...risk, evidence: { kind: 'timing', observations: [{ durationMs: 1 }] } }
      : risk)),
  });

  assert.deepEqual(
    qualifyRelease(wrongKind).errors.map((error) => error.code),
    ['risk-evidence-missing'],
  );
});

/**
 * `SG-TRUST-001`: this manifest describes a cooperative local process. It may
 * not present itself as a server-side or CI control, and it carries the trust
 * boundary statement the security module owns rather than restating it.
 */
test('the manifest claims local Git authority only and carries the stated trust boundary', () => {
  const honest = manifestFixture({ risks: visibleRiskFixture() });

  assert.equal(honest.authority.model, 'authoritative-local-git');
  assert.equal(honest.authority.serverSide, false);
  assert.equal(honest.authority.ci, false);
  assert.equal(honest.trustBoundary, TRUST_BOUNDARY.statement);
  assert.equal(qualifyRelease(honest).qualified, true);

  const overclaimed = manifestFixture({
    risks: visibleRiskFixture(),
    authority: { model: 'ci-enforced', serverSide: true, ci: true },
  });

  assert.deepEqual(
    qualifyRelease(overclaimed).errors.map((error) => error.code),
    ['authority-overclaimed'],
  );

  const restated = manifestFixture({
    risks: visibleRiskFixture(),
    trustBoundary: 'The Gate protects the repository from its owner.',
  });

  assert.deepEqual(
    qualifyRelease(restated).errors.map((error) => error.code),
    ['trust-boundary-restated'],
  );
});

/**
 * `experimental` is a state with an exit, not a verdict. TB-013 was reopened
 * because a fixture-driven baseline cannot establish support, so the manifest
 * must say what a real client-driven run has to record instead — otherwise the
 * tier is a dead end rather than a step (SG-SUPPORT-001, Q-004).
 */
test('an experimental surface carries the procedure that would promote it', () => {
  const pending = promotionProcedure(surfaceFixture());

  assert.equal(pending.adapterId, 'cursor');
  assert.equal(pending.currentTier, 'experimental');
  assert.equal(pending.blockedBy, 'client-invocation-not-observed');
  assert.deepEqual(pending.requirements, [...PROMOTION_REQUIREMENTS]);

  // A surface whose baseline a real client already drove has nothing to do.
  const promoted = promotionProcedure(surfaceFixture({
    tier: 'supported',
    reason: 'baseline-passed',
    baseline: {
      ...surfaceFixture().baseline,
      evidence: { payloadSource: 'captured-client-invocation' },
    },
  }));

  assert.equal(promoted.currentTier, 'supported');
  assert.equal(promoted.blockedBy, null);
  assert.deepEqual(promoted.requirements, []);

  // A surface that cannot reach the repository is not one capture away from
  // support, and must not be handed a procedure that says otherwise.
  const unreachable = promotionProcedure(surfaceFixture({
    capabilities: { repositoryFilesystem: false, processExecution: true, git: true },
  }));

  assert.equal(unreachable.currentTier, 'unsupported');
  assert.equal(unreachable.blockedBy, 'repository-execution-unavailable');
  assert.deepEqual(unreachable.requirements, []);
});

/**
 * The procedure is a deliverable, not a comment. If the contract document and
 * the executable list drift apart, the document is the one a maintainer reads.
 */
test('the release qualification contract documents every promotion requirement', async () => {
  const contract = await readFile(
    path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/references/release-qualification-contract.md'),
    'utf8',
  );

  for (const requirement of PROMOTION_REQUIREMENTS) {
    assert.match(contract, new RegExp(requirement.replace(/[-]/g, '[-]')), `The contract does not document ${requirement}.`);
  }

  for (const fixture of PORTABILITY_FIXTURES) {
    assert.match(contract, new RegExp(fixture.replace(/[-]/g, '[-]')), `The contract does not document the ${fixture} fixture.`);
  }
});

/**
 * The capability convention, and the one place the matrix could quietly shrink.
 *
 * NOT RED-FIRST: the npm script, the configured capability, and the fixture map
 * were already in place when this test was written. It is a drift guard, not a
 * behaviour this cycle introduced.
 */
test('the portability capability is registered and implements exactly the named fixtures', async () => {
  const packageManifest = JSON.parse(await readFile(path.join(FRAMEWORK_ROOT, 'package.json'), 'utf8'));

  assert.equal(
    packageManifest.scripts['gate-runtime-portability'],
    'node skills/change-evaluation-gate/scripts/gate-runtime-portability.mjs',
  );

  const configuration = await readFile(path.join(FRAMEWORK_ROOT, '.agent-framework.yaml'), 'utf8');

  assert.match(configuration, /^\s+- gate-runtime-portability$/m);

  const source = await readFile(
    path.join(FRAMEWORK_ROOT, 'skills/change-evaluation-gate/scripts/gate-runtime-portability.mjs'),
    'utf8',
  );
  const registry = source.slice(source.indexOf('const FIXTURES = Object.freeze({'));
  const declared = [...registry.slice(0, registry.indexOf('});')).matchAll(/^\s{2}'?([a-z-]+)'?:/gm)]
    .map((match) => match[1]);

  assert.deepEqual(declared, [...PORTABILITY_FIXTURES]);
});
