/**
 * Release qualification for a Gate-capable release candidate.
 *
 * This module owns one artifact — the compatibility manifest — and one
 * question about it: does the evidence the manifest carries actually support
 * every claim the manifest makes?
 *
 * Nothing here runs a fixture, and nothing here decides what a fixture proves.
 * Outcomes arrive already observed, from the `gate-runtime-portability`
 * capability that executed them. Qualification only refuses to let a claim
 * outrun its evidence (AC-PORT-001, AC-ADAPT-002, SG-SUPPORT-001, Q-004).
 */

import { readFile as readFileFromDisk } from 'node:fs/promises';
import path from 'node:path';

import { BASELINE_CHECKS, classifySupport } from './adapters.mjs';
import { TRUST_BOUNDARY } from './security-control.mjs';

export const MANIFEST_VERSION = 'change-evaluation-gate/compatibility/v1';

/** Where a release version may legitimately come from. */
export const RELEASE_VERSION_SOURCE = 'package.json';

/**
 * Read the release version from the package that will carry it.
 *
 * The version is read, never asserted. This repository moves to its next
 * version through the release pull request's `changeset version` step, so a
 * literal written into a manifest could disagree with the package it describes
 * from the moment it was written (Q-005).
 */
export const readReleaseVersion = async (repositoryRoot, { readFile = readFileFromDisk } = {}) => {
  const manifestPath = path.join(repositoryRoot, RELEASE_VERSION_SOURCE);
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));

  return { version: parsed.version ?? null, source: RELEASE_VERSION_SOURCE };
};

/**
 * The runtime portability fixtures AC-PORT-001 names, in its own order.
 *
 * This list is the contract, not a suggestion: a claimed environment owes an
 * outcome for every one of them. Deriving the required set from whatever a
 * manifest happens to carry would make omission the cheapest way to look green.
 */
export const PORTABILITY_FIXTURES = Object.freeze([
  'executable',
  'stream',
  'json',
  'timeout',
  'process-tree',
  'git-index',
  'linked-worktree',
  'path-with-spaces',
  'materialized-root-declared-write',
  'source-immutability',
  'non-interactive-shell',
]);

/**
 * What a manifest may say about an environment.
 *
 * There is no `denied`. Evidence proves what was tested; it cannot refuse what
 * was not. An untested combination simply has no verified claim yet, and the
 * only way to acquire one is to run this matrix there (Q-004).
 */
export const ENVIRONMENT_CLAIMS = Object.freeze(['claimed', 'unverified']);

/** The only standing this manifest's version evidence may be given. */
export const EVIDENCE_POLICY = 'evidence-snapshot';

/**
 * What this release actually enforces with, and where.
 *
 * Authorization is one local `pre-commit` hook in one clone. There is no
 * server-side and no continuous-integration authority anywhere in this feature,
 * and a release manifest is exactly the document where that would be easiest to
 * imply (SG-TRUST-001, FR-ADAPT-007).
 */
export const RELEASE_AUTHORITY = Object.freeze({
  model: 'authoritative-local-git',
  serverSide: false,
  ci: false,
});

/**
 * The two delivery risks that are accepted as OPEN, and the evidence each one
 * was accepted against. Qualifying a release does not close them; it shows what
 * was measured while they stayed open.
 */
export const VISIBLE_RISKS = Object.freeze({
  'RISK-003': 'timing',
  'RISK-007': 'attempts',
});

/**
 * What a real client-driven baseline run must record before a surface may be
 * promoted from `experimental` to `supported`.
 *
 * This exists because TB-013 shipped three surfaces as `supported` on payloads
 * this repository built from the declarations under test, and real captures
 * later refuted every declared mapping. `experimental` is therefore a state
 * with a stated exit, and this list is that exit: each item is something only a
 * real invocation can produce (SG-SUPPORT-001, AC-ADAPT-002, FR-ADAPT-004).
 */
export const PROMOTION_REQUIREMENTS = Object.freeze([
  // The client's own payload, captured from an invocation it initiated, with
  // every top-level key it actually sent.
  'captured-payload-shape',
  // The exact event value that arrived, including its casing: Cursor sends
  // `stop` where Claude Code and Codex send `Stop`, and trigger matching is an
  // exact-string compare per adapter.
  'captured-event-name',
  // Where the client registers a hook and in which schema. All three differ:
  // one general settings file and two dedicated files, one of them with a
  // materially different block shape and its own top-level version.
  'registration-file-and-schema',
  // The exact client version the capture came from, self-reported by the client
  // where it offers one.
  'exact-client-version',
  // Every shared baseline check re-run against that captured shape, with its
  // outcome recorded.
  'shared-baseline-outcomes',
  // How a repository root was resolved from the path the client sent, which is
  // sometimes a root and sometimes not, and which is an array for one client.
  'repository-root-resolution',
  // Qualification re-run, so the manifest that carries the promotion is the
  // manifest the evidence produced.
  're-run-qualification',
]);

const isPlainObject = (value) => typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

/**
 * Assemble a compatibility manifest from already-observed evidence.
 *
 * The manifest is a record, so this is deliberately not a place where facts are
 * derived. Every version, outcome, and tier is supplied by the caller that
 * observed it.
 */
export const buildCompatibilityManifest = ({
  release,
  environments = [],
  surfaces = [],
  risks = [],
  recordedAt,
  evidencePolicy = EVIDENCE_POLICY,
  authority = RELEASE_AUTHORITY,
  // Stated once, by the module that owns it. Restating the boundary here would
  // let the two drift apart, and the weaker of the two would be the one a
  // reader happened to find.
  trustBoundary = TRUST_BOUNDARY.statement,
} = {}) => ({
  manifestVersion: MANIFEST_VERSION,
  release: { ...release },
  evidencePolicy,
  authority: { ...authority },
  trustBoundary,
  environments: environments.map((environment) => ({ ...environment })),
  surfaces: surfaces.map((surface) => ({ ...surface })),
  risks: risks.map((risk) => ({ ...risk })),
  recordedAt: recordedAt ?? null,
});

/**
 * State the route out of `experimental` for one surface.
 *
 * Only a surface held back by an unobserved client invocation has a route: a
 * context that cannot reach the repository is not one capture away from
 * support, and handing it a procedure would say otherwise.
 */
export const promotionProcedure = (surface) => {
  const derived = classifySupport({
    adapterId: surface?.adapterId,
    variant: surface?.variant,
    capabilities: surface?.capabilities ?? {},
    baseline: isPlainObject(surface?.baseline) ? surface.baseline : null,
  });
  const promotable = derived.tier === 'experimental'
    && derived.reason === 'client-invocation-not-observed';

  return {
    adapterId: derived.adapterId,
    currentTier: derived.tier,
    blockedBy: derived.tier === 'supported' ? null : derived.reason,
    requirements: promotable ? [...PROMOTION_REQUIREMENTS] : [],
  };
};

/**
 * Qualify one manifest against the evidence it carries.
 *
 * @returns {{ qualified: boolean, errors: Array<{code: string, path: string, message: string}> }}
 */
export const qualifyRelease = (manifest, { expectedVersion = null } = {}) => {
  const errors = [];
  const release = isPlainObject(manifest?.release) ? manifest.release : {};

  if (release.versionSource !== RELEASE_VERSION_SOURCE) {
    errors.push({
      code: 'release-version-not-read',
      path: 'release.versionSource',
      message: `A release version is evidence only when it was read from ${RELEASE_VERSION_SOURCE}.`,
    });
  } else if (expectedVersion !== null && release.version !== expectedVersion) {
    errors.push({
      code: 'release-version-mismatch',
      path: 'release.version',
      message: `The manifest describes ${release.version} while the package it qualifies is ${expectedVersion}.`,
    });
  }

  if (manifest?.evidencePolicy !== EVIDENCE_POLICY) {
    errors.push({
      code: 'permanent-allowlist-rejected',
      path: 'evidencePolicy',
      message: `Tested versions are an ${EVIDENCE_POLICY}; they never become a standing allowlist.`,
    });
  }

  const environments = Array.isArray(manifest?.environments) ? manifest.environments : [];
  const claimed = environments.filter((environment) => environment?.claim === 'claimed');
  const unverified = environments.filter((environment) => environment?.claim === 'unverified');

  environments.forEach((environment, index) => {
    if (!ENVIRONMENT_CLAIMS.includes(environment?.claim)) {
      errors.push({
        code: 'environment-claim-invalid',
        path: `environments[${index}].claim`,
        message: `${environment?.id ?? 'an environment'} is recorded as ${environment?.claim}; this evidence supports ${ENVIRONMENT_CLAIMS.join(' or ')} only.`,
      });

      return;
    }

    if (environment.claim === 'unverified'
      && (typeof environment.reason !== 'string' || environment.reason.length === 0)) {
      errors.push({
        code: 'environment-reason-missing',
        path: `environments[${index}].reason`,
        message: `${environment.id ?? 'an environment'} is unverified without saying why it was not tested.`,
      });
    }
  });

  if (claimed.length === 0) {
    errors.push({
      code: 'no-claimed-environment',
      path: 'environments',
      message: 'A release candidate qualifies on evidence, and this manifest claims no environment.',
    });
  }

  environments.forEach((environment, index) => {
    if (environment?.claim !== 'claimed') {
      return;
    }

    const name = environment.id ?? 'a claimed environment';
    const observed = Array.isArray(environment.fixtures) ? environment.fixtures : [];
    const byId = new Map(
      observed.filter((fixture) => isPlainObject(fixture)).map((fixture) => [fixture.id, fixture]),
    );
    const missing = PORTABILITY_FIXTURES.filter((fixture) => !byId.has(fixture));

    if (missing.length > 0) {
      errors.push({
        code: 'portability-outcome-missing',
        path: `environments[${index}].fixtures`,
        message: `${name} claims support without an outcome for ${missing.join(', ')}.`,
      });
    }

    // A fixture the contract does not name is not a substitute for one it
    // does, and a renamed outcome must not read as coverage.
    const unknown = [...byId.keys()].filter((id) => !PORTABILITY_FIXTURES.includes(id));

    if (unknown.length > 0) {
      errors.push({
        code: 'portability-outcome-unknown',
        path: `environments[${index}].fixtures`,
        message: `${name} records ${unknown.join(', ')}, which AC-PORT-001 does not name.`,
      });
    }

    const failed = PORTABILITY_FIXTURES.filter((id) => byId.has(id) && byId.get(id).ok !== true);

    if (failed.length > 0) {
      errors.push({
        code: 'portability-fixture-failed',
        path: `environments[${index}].fixtures`,
        message: `${name} is claimed although ${failed.join(', ')} failed on it.`,
      });
    }
  });

  const surfaces = Array.isArray(manifest?.surfaces) ? manifest.surfaces : [];

  surfaces.forEach((surface, index) => {
    const name = surface?.adapterId ?? 'a surface';
    const baseline = isPlainObject(surface?.baseline) ? surface.baseline : null;
    const observed = Array.isArray(baseline?.checks) ? baseline.checks : [];
    const recorded = new Set(observed.map((entry) => entry?.id));
    const missing = BASELINE_CHECKS.filter((id) => !recorded.has(id));

    // A tier is a claim about a baseline that ran. Without every shared check's
    // outcome and the exact versions it ran under, nothing was recorded to
    // agree or disagree with (NFR-COMP-001, SG-SUPPORT-001).
    if (baseline === null || missing.length > 0) {
      errors.push({
        code: 'baseline-outcomes-missing',
        path: `surfaces[${index}].baseline.checks`,
        message: `${name} claims ${surface?.tier ?? 'a tier'} without an outcome for ${missing.length > 0 ? missing.join(', ') : 'any shared baseline check'}.`,
      });

      return;
    }

    if (!isPlainObject(baseline.versions)) {
      errors.push({
        code: 'baseline-versions-missing',
        path: `surfaces[${index}].baseline.versions`,
        message: `${name} records no exact versions for the baseline it claims to have passed.`,
      });

      return;
    }

    // The declared tier is not the claim of record. Deriving it again from the
    // same evidence is what makes a tier unfalsifiable by assertion, and it is
    // the one seam that already refuses a pass on payloads this repository
    // built from the declaration under test.
    const derived = classifySupport({
      adapterId: surface.adapterId,
      variant: surface.variant,
      capabilities: surface.capabilities ?? {},
      baseline,
    });

    if (derived.tier !== surface.tier || derived.reason !== surface.reason) {
      errors.push({
        code: 'support-tier-unproved',
        path: `surfaces[${index}].tier`,
        message: `${name} is recorded ${surface.tier} (${surface.reason}); its own evidence produces ${derived.tier} (${derived.reason}).`,
      });
    }
  });

  const authority = isPlainObject(manifest?.authority) ? manifest.authority : {};

  if (authority.model !== RELEASE_AUTHORITY.model
    || authority.serverSide !== false
    || authority.ci !== false) {
    errors.push({
      code: 'authority-overclaimed',
      path: 'authority',
      message: `This release enforces through ${RELEASE_AUTHORITY.model} in one local clone; it holds no server-side or continuous-integration authority.`,
    });
  }

  if (manifest?.trustBoundary !== TRUST_BOUNDARY.statement) {
    errors.push({
      code: 'trust-boundary-restated',
      path: 'trustBoundary',
      message: 'The trust boundary is carried from the module that states it, never rewritten in a release document.',
    });
  }

  const risks = Array.isArray(manifest?.risks) ? manifest.risks : [];

  for (const [id, requiredKind] of Object.entries(VISIBLE_RISKS)) {
    const risk = risks.find((entry) => entry?.id === id) ?? null;

    if (risk === null) {
      errors.push({
        code: 'risk-not-visible',
        path: 'risks',
        message: `${id} is accepted only while it stays visible, and this manifest does not carry it.`,
      });

      continue;
    }

    if (risk.status !== 'open') {
      errors.push({
        code: 'risk-closed-without-evidence',
        path: `risks[${risks.indexOf(risk)}].status`,
        message: `${id} is recorded ${risk.status}; qualifying a release does not close it.`,
      });

      continue;
    }

    const observations = Array.isArray(risk.evidence?.observations) ? risk.evidence.observations : [];

    if (risk.evidence?.kind !== requiredKind || observations.length === 0) {
      errors.push({
        code: 'risk-evidence-missing',
        path: `risks[${risks.indexOf(risk)}].evidence`,
        message: `${id} stays open against observed ${requiredKind} evidence, and none is recorded.`,
      });
    }
  }

  return {
    qualified: errors.length === 0,
    errors,
    claimed: claimed.map((environment) => environment.id ?? null),
    unverified: unverified.map((environment) => environment.id ?? null),
  };
};
