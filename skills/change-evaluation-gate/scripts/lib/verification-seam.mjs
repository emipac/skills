/**
 * Delegation to the existing `verify-change` Verification seam.
 *
 * The gate resolves nothing about ordering or the Evidence ladder on its own:
 * the settled stage order is imported from `verify-change` and applied through
 * the descriptor contract's comparator. There is no second verifier here, and
 * no stage name is restated (SG-OWNER-001, FR-EVAL-003).
 *
 * Evaluation invokes a descriptor's non-mutating evaluation command only. A
 * descriptor's fix command exists for `gate fix` and is never reachable from
 * this seam (FR-EVAL-005).
 */

import { evidenceLadderStages } from '../../../verify-change/scripts/verification-plan.mjs';
import { orderChecks } from './check-descriptor.mjs';
import { bindPolicy } from './policy.mjs';

export const VERIFICATION_SEAM = 'verify-change';

/** Evaluation invokes non-mutating evaluation commands only, never a fix. */
export const INVOKED_ROLES = Object.freeze(['evaluate']);

const globToRegExp = (glob) => {
  let pattern = '^';

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];

    if (character === '*') {
      if (glob[index + 1] === '*') {
        pattern += '.*';
        index += 1;
      } else {
        pattern += '[^/]*';
      }

      continue;
    }

    if (character === '?') {
      pattern += '[^/]';

      continue;
    }

    pattern += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  return new RegExp(`${pattern}$`);
};

/** Whether one repository-relative path matches one declared glob. */
export const pathMatchesGlob = (candidate, glob) => globToRegExp(glob).test(candidate);

/** Deterministic applicability: a declared changed-path glob, never a guess. */
export const isApplicable = (check, changedPaths) => {
  const globs = check?.applicability?.changed_path_globs ?? [];

  return globs.some((glob) => changedPaths.some((changed) => pathMatchesGlob(changed, glob)));
};

/**
 * Resolve which checks apply to this snapshot and in which order.
 *
 * @returns {{ordered: Array, diagnostics: Array, delegation: object}}
 */
export const delegateResolution = ({ checks = [], changedPaths = [], policy = null } = {}) => {
  const { bound, diagnostics } = bindPolicy(checks, policy);

  return {
    ordered: orderChecks(bound).map((check) => ({
      check,
      applicable: isApplicable(check, changedPaths),
    })),
    diagnostics,
    delegation: {
      seam: VERIFICATION_SEAM,
      ladder: [...evidenceLadderStages],
      invokedRoles: [...INVOKED_ROLES],
    },
  };
};
