/**
 * Evaluation scope resolution from the repository-owned delivery contract.
 *
 * The gate never infers requested behavior. Task-specific acceptance coverage
 * exists only when a valid delivery contract is readable inside the
 * materialized Evaluation snapshot and declares stable acceptance IDs. Anything
 * else — no reference, an unreadable reference, or a contract that declares no
 * acceptance criterion — is `regression-only`, and the decision says so instead
 * of implying the requested behavior was proved (FR-EVAL-007, SG-SCOPE-001).
 *
 * The contract is read from the snapshot, never from the mutable live worktree,
 * so the scope a decision reports belongs to the tree that was graded.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Stable acceptance identity shape, e.g. `AC-EVAL-005`. */
export const ACCEPTANCE_ID = /^AC-[A-Z][A-Z0-9]*-\d{3}$/;

/** Why a decision may not claim task-specific acceptance coverage. */
export const CONTRACT_STATUSES = Object.freeze([
  'valid',
  'not-declared',
  'missing',
  'invalid',
]);

export const REGRESSION_ONLY = 'regression-only';

export const CHANGE_ACCEPTANCE = 'change-acceptance-and-regression';

const ACCEPTANCE_HEADING = /^#{1,6}\s+acceptance criteria\s*$/i;

const HEADING = /^#{1,6}\s+/;

/**
 * Collect the stable acceptance IDs a delivery contract declares under its
 * acceptance-criteria section. Identities elsewhere in the document — a
 * traceability list, prose, a verification matrix — are references, not the
 * contract's own acceptance criteria, so they are not collected.
 */
export const acceptanceIdsIn = (contents) => {
  const declared = new Set();
  let inside = false;

  for (const line of String(contents ?? '').split(/\r?\n/)) {
    if (ACCEPTANCE_HEADING.test(line)) {
      inside = true;

      continue;
    }

    if (inside && HEADING.test(line)) {
      break;
    }

    if (!inside) {
      continue;
    }

    for (const [, candidate] of line.matchAll(/`([^`]+)`/g)) {
      if (ACCEPTANCE_ID.test(candidate)) {
        declared.add(candidate);
      }
    }
  }

  return [...declared].sort();
};

/**
 * Resolve the delivery contract named by the request against the materialized
 * snapshot.
 *
 * @returns {{status: string, contents: string|null, acceptanceIds: string[], detail: string|null}}
 */
export const resolveDeliveryContract = async (executionRoot, contractRef) => {
  if (contractRef === null || contractRef === undefined) {
    return {
      status: 'not-declared',
      contents: null,
      acceptanceIds: [],
      detail: 'The request named no delivery contract.',
    };
  }

  if (!executionRoot) {
    return {
      status: 'missing',
      contents: null,
      acceptanceIds: [],
      detail: 'No Evaluation snapshot was materialized, so the delivery contract could not be read.',
    };
  }

  let contents;

  try {
    contents = await readFile(path.join(executionRoot, contractRef), 'utf8');
  } catch {
    return {
      status: 'missing',
      contents: null,
      acceptanceIds: [],
      detail: `The delivery contract ${JSON.stringify(contractRef)} is not readable in the evaluated snapshot.`,
    };
  }

  const acceptanceIds = acceptanceIdsIn(contents);

  if (acceptanceIds.length === 0) {
    return {
      status: 'invalid',
      contents,
      acceptanceIds: [],
      detail: `The delivery contract ${JSON.stringify(contractRef)} declares no stable acceptance criterion.`,
    };
  }

  return { status: 'valid', contents, acceptanceIds, detail: null };
};

/**
 * Decide the Evaluation scope. A requested acceptance scope is honored only by
 * a valid contract; every other combination degrades to `regression-only` and
 * records why.
 */
export const resolveScope = (requestedPurpose, contract) => {
  if (requestedPurpose !== CHANGE_ACCEPTANCE) {
    return {
      scope: REGRESSION_ONLY,
      limitations: [
        'regression-only: the evaluation requested regression evidence and proves no requested behavior or acceptance criterion.',
      ],
    };
  }

  if (contract.status !== 'valid') {
    return {
      scope: REGRESSION_ONLY,
      limitations: [
        `regression-only: ${contract.detail} Regression evidence never claims the requested behavior or acceptance criteria were proved.`,
      ],
    };
  }

  return { scope: CHANGE_ACCEPTANCE, limitations: [] };
};
