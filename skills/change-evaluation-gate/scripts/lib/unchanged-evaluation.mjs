/**
 * Recognize a tree the Gate has already passed (`TB-039` generalized).
 *
 * A preflight is registered on the end of every turn. When nothing in the
 * worktree changed since the last evaluation that passed — the same content
 * under the same configuration — repeating the checks proves nothing new and
 * costs a full evaluation. This module decides whether that is the case, and
 * does it without materializing a snapshot: the content identity is derived
 * from the live files by the same function a materialized root is, so the two
 * name a tree identically.
 *
 * It decides nothing about authorization and widens nothing: only a recorded
 * `passed` decision with no diagnostic, no changed Grader surface, and no unversioned
 * one counts, a
 * failed, unverified, or bypassed one never does, and anything this module
 * cannot establish — an unreadable file, an unreadable log, a pruned envelope —
 * is "not proved", which runs the evaluation (`NFR-REL-003`).
 *
 * What it cannot see is outside the snapshot: an ignored `.env`, an installed
 * dependency changed without its lock file, a database. Those are not part of
 * the identity the Gate computes for any evaluation.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { configurationIdentityFor } from './evaluate.mjs';
import { contentIdentity, listWorktreePaths } from './snapshot.mjs';
import { delegateResolution } from './verification-seam.mjs';

/** How many of the newest recorded evaluations are looked at; the log is append-only and unbounded. */
export const RECENT_EVALUATIONS = 25;

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The identity a worktree snapshot of this tree would be given, without the
 * copy, or `null` when it cannot be established.
 */
export const worktreeSnapshotIdentity = async (repositoryRoot, runGit) => {
  try {
    const relatives = await listWorktreePaths(repositoryRoot, runGit);
    const entries = [];

    for (const relative of relatives) {
      entries.push({
        path: relative.split(path.sep).join('/'),
        contentDigest: digest(await readFile(path.join(repositoryRoot, relative))),
      });
    }

    return contentIdentity(entries);
  } catch {
    return null;
  }
};

/** Whether a recorded decision is one a later identical tree may rely on. */
const isCleanPass = (decision, { snapshotId, configurationId, purpose }) => decision?.outcome === 'passed'
  && decision.snapshot?.id === snapshotId
  && decision.configurationId === configurationId
  && decision.task?.purpose === purpose
  && (decision.diagnostics ?? []).length === 0
  && (decision.integrity?.changedGraderSurfaces ?? []).length === 0
  // A decision states its own conditions completely, every time, so an
  // unversioned Grader surface is recorded on each evaluation that observes it
  // (`FR-EVAL-009`, `TB-066`); a pass that carried one is never stood in for.
  && (decision.integrity?.unversionedGraderSurfaces ?? []).length === 0;

/**
 * The evidence identity of a recorded passing evaluation of exactly this tree
 * under exactly this configuration, or `null`.
 *
 * @param {object} request versioned evaluation request
 * @param {object} options the resolved gate inputs and the opened store
 */
export const unchangedSincePassed = async (request, {
  store, checks, policy, profile = null, runnerVersion, providerVersions, runGit,
}) => {
  if (typeof store?.readLog !== 'function' || typeof store.readEnvelope !== 'function') {
    return null;
  }

  const snapshotId = await worktreeSnapshotIdentity(request.repository.root, runGit);

  if (snapshotId === null) {
    return null;
  }

  // Applicability depends on the changed paths, but the set of checks and the
  // policy each is bound under does not, and that set is all the configuration
  // identity reads.
  const resolution = delegateResolution({ checks, changedPaths: [], policy });
  const expected = {
    snapshotId,
    purpose: request.evaluation?.purpose,
    configurationId: configurationIdentityFor({
      profile,
      policy,
      runnerVersion,
      providerVersions,
      checks: resolution.ordered.map((descriptor) => descriptor.check),
    }),
  };

  try {
    const recent = (await store.readLog()).slice(-RECENT_EVALUATIONS).reverse();

    for (const entry of recent) {
      const envelope = await store.readEnvelope(entry.evidenceId);

      if (isCleanPass(envelope?.decision, expected)) {
        return entry.evidenceId;
      }
    }
  } catch {
    return null;
  }

  return null;
};
