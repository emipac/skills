/**
 * Changed Grader surface detection.
 *
 * A Grader surface is anything that decides evidence: the tests a check runs,
 * the declared `repository-script` a check invokes, the provider that resolves
 * check descriptors, and the Gate configuration that binds policy. When a
 * change edits one of them, the decision that judges that change must say so,
 * so a change cannot quietly weaken the evidence judging it (FR-EVAL-009,
 * RISK-008).
 *
 * Every surface is declared, never guessed: repository scripts come from the
 * Command descriptors already validated by `command-descriptor`, and tests,
 * providers, and configuration come from what the project declared. An
 * undeclared path is not reported, and reporting a changed surface is never a
 * malicious classification — it is visibility (SG-CFG-001).
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { graderSurfaces as declaredScriptSurfaces } from './command-descriptor.mjs';
import { pathMatchesGlob } from './verification-seam.mjs';

export const GRADER_SURFACE_KINDS = Object.freeze([
  'gate-configuration',
  'provider',
  'test',
  'verification-script',
]);

/**
 * The Gate control surface is the configuration that binds Gate policy. It is
 * named by the framework, not inferred from a changed path.
 */
export const DEFAULT_GATE_CONFIGURATION_PATHS = Object.freeze(['.agent-framework.yaml']);

/** Kinds whose change touches the Gate control surface rather than ordinary evidence. */
const CONTROL_SURFACE_KINDS = Object.freeze(['gate-configuration', 'provider']);

const matchesAny = (candidate, globs) => globs.some((glob) => pathMatchesGlob(candidate, glob));

/**
 * Bind one surface to the content that was actually evaluated. The identity is
 * read from the materialized snapshot, so it names the surface the checks ran
 * under and not the mutable live worktree.
 */
const surfaceIdentity = async (executionRoot, relative) => {
  if (!executionRoot) {
    return null;
  }

  try {
    const contents = await readFile(path.join(executionRoot, relative));

    return `sha256:${createHash('sha256').update(contents).digest('hex')}`;
  } catch {
    return null;
  }
};

const order = (left, right) => {
  if (left.kind !== right.kind) {
    return left.kind < right.kind ? -1 : 1;
  }

  if (left.path !== right.path) {
    return left.path < right.path ? -1 : 1;
  }

  return 0;
};

/**
 * Every declared Grader surface among `paths`, sorted by kind then path, each
 * bound to the content it was evaluated under. One classification serves both
 * words, so `changed` and `unversioned` can never disagree about what a
 * surface is — only about which paths are asked about.
 */
const declaredSurfacesAmong = async (paths, { checks, declarations, executionRoot }) => {
  const among = new Set(paths);
  const configurationPaths = declarations.configuration ?? DEFAULT_GATE_CONFIGURATION_PATHS;
  const providerSources = declarations.providers ?? {};
  const testGlobs = declarations.tests ?? [];
  const found = new Map();

  const record = (kind, relative, checkId = null, role = null) => {
    const key = `${kind}\x00${relative}\x00${checkId ?? ''}\x00${role ?? ''}`;

    if (!found.has(key)) {
      found.set(key, { kind, path: relative, checkId, role });
    }
  };

  for (const relative of configurationPaths) {
    if (among.has(relative)) {
      record('gate-configuration', relative);
    }
  }

  for (const [provider, relative] of Object.entries(providerSources)) {
    if (among.has(relative)) {
      record('provider', relative, provider);
    }
  }

  for (const relative of among) {
    if (testGlobs.length > 0 && matchesAny(relative, testGlobs)) {
      record('test', relative);
    }
  }

  for (const surface of declaredScriptSurfaces(checks)) {
    if (among.has(surface.path)) {
      record('verification-script', surface.path, surface.check_id, surface.role);
    }
  }

  const surfaces = [...found.values()].sort(order);

  for (const surface of surfaces) {
    surface.identity = await surfaceIdentity(executionRoot, surface.path);
  }

  return surfaces;
};

/**
 * Report every declared Grader surface this change modified.
 *
 * A path Git does not track is never one of them. An untracked file is in a
 * worktree change's path set because it is new work an applicability rule must
 * see, but a declared surface Git does not track has no version for this
 * change to have moved it from: it is unversioned, reported by
 * `unversionedGraderSurfaces`, and a path is never both (`TB-066`).
 *
 * @param {object} input changed paths, untracked paths, resolved checks, declarations, snapshot
 * @returns {Promise<Array<{kind: string, path: string, checkId: string|null, role: string|null, identity: string|null}>>}
 */
export const changedGraderSurfaces = async ({
  changedPaths = [],
  untrackedPaths = [],
  checks = [],
  declarations = {},
  executionRoot = null,
} = {}) => {
  const untracked = new Set(untrackedPaths);

  return declaredSurfacesAmong(
    changedPaths.filter((relative) => !untracked.has(relative)),
    { checks, declarations, executionRoot },
  );
};

/**
 * Report every declared Grader surface Git does not track.
 *
 * Unversioned is a standing fact about the clone, not something this change
 * did: such a surface has no history, no review, and nothing to diff an edit
 * against. It is reported in the same shape as a changed surface, of every
 * declared kind — a test matched by a declared glob included, because an
 * untracked test is the same fact about the same class of file — and, like a
 * changed one, it classifies no intent and never changes an outcome
 * (`FR-EVAL-009`, `AC-SEC-001`, `SG-TRUST-001`). Only declared surfaces are
 * reported: an untracked file nothing declares is ordinary new work.
 *
 * @param {object} input untracked paths, resolved checks, declarations, snapshot
 * @returns {Promise<Array<{kind: string, path: string, checkId: string|null, role: string|null, identity: string|null}>>}
 */
export const unversionedGraderSurfaces = async ({
  untrackedPaths = [],
  checks = [],
  declarations = {},
  executionRoot = null,
} = {}) => declaredSurfacesAmong(untrackedPaths, { checks, declarations, executionRoot });

/**
 * Whether this change touched the Gate control surface. The full dual-policy
 * transition that a control-surface change requires is owned elsewhere; here it
 * is made visible so it can never pass unnoticed (SG-CFG-001). It is asked of
 * changed surfaces only, so it is true only when a tracked control surface
 * moved; an unversioned one never sets it (`TB-066`).
 */
export const touchesControlSurface = (surfaces) => surfaces.some(
  (surface) => CONTROL_SURFACE_KINDS.includes(surface.kind),
);
