/**
 * Laravel verification profile provider.
 *
 * Stack knowledge lives here and only here. Every command is a proved project
 * fact supplied by configuration; this provider never guesses one.
 */

import { createProvider } from './provider-kit.mjs';

/**
 * Stage answers *when* a check runs; capability answers *what evidence* it
 * provides. Rector therefore stays in `static-analysis` as a distinct
 * `rewrite-check` capability instead of earning a new stage.
 *
 * Policy defaults are earned, not assumed (FR-PROF-009). Proved Pint, Rector
 * dry-run, PHPStan/Larastan, and broad tests are proposed as `required`
 * because their applicability is unconditional. Focused, affected-test, smoke,
 * build, and browser evidence is `earnable`: it stays advisory until the
 * project confirms both that it applies and that its exact command is proved.
 *
 * `fix_order` is the provider's own mutation ordering. Rector runs before Pint
 * because a structural rewrite creates formatting work, and the reverse order
 * would leave the tree unformatted. Gate core reads this order and never knows
 * which tool it names (FR-PROF-010, SG-OWNER-001).
 */
export const laravelCheckPlan = Object.freeze([
  {
    key: 'focused_test',
    id: 'focused.test',
    stage: 'focused',
    capability: 'test',
    claims: ['test:focused'],
    policy: 'advisory',
    earnable: true,
    order: 10,
  },
  {
    key: 'format',
    id: 'format.formatter',
    stage: 'format',
    capability: 'formatter',
    claims: ['format:style'],
    policy: 'required',
    order: 10,
    fix_order: 20,
  },
  {
    key: 'rewrite_check',
    id: 'static-analysis.rewrite-check',
    stage: 'static-analysis',
    capability: 'rewrite-check',
    claims: ['static-analysis:rewrite'],
    policy: 'required',
    order: 10,
    fix_order: 10,
  },
  {
    key: 'static_analysis',
    id: 'static-analysis.application',
    stage: 'static-analysis',
    capability: 'static-analysis',
    claims: ['static-analysis:application'],
    policy: 'required',
    order: 20,
  },
  {
    key: 'static_analysis_tests',
    id: 'static-analysis.tests',
    stage: 'static-analysis',
    capability: 'static-analysis',
    claims: ['static-analysis:tests'],
    policy: 'required',
    order: 30,
    merge_into: 'static_analysis',
  },
  {
    key: 'affected_test',
    id: 'affected-tests.test',
    stage: 'affected-tests',
    capability: 'test',
    claims: ['test:affected'],
    policy: 'advisory',
    earnable: true,
    order: 10,
  },
  {
    key: 'smoke',
    id: 'smoke.runtime',
    stage: 'smoke',
    capability: 'smoke',
    claims: ['smoke:runtime'],
    policy: 'advisory',
    earnable: true,
    order: 10,
  },
  {
    key: 'build',
    id: 'build.artifact',
    stage: 'build',
    capability: 'build',
    claims: ['build:artifact'],
    policy: 'advisory',
    earnable: true,
    order: 10,
  },
  {
    key: 'browser',
    id: 'browser.user-visible',
    stage: 'browser',
    capability: 'browser',
    claims: ['browser:user-visible'],
    policy: 'advisory',
    earnable: true,
    order: 10,
  },
  {
    key: 'broad_test',
    id: 'broad-tests.test',
    stage: 'broad-tests',
    capability: 'test',
    claims: ['test:broad'],
    policy: 'required',
    order: 10,
    applies_to_all: true,
  },
]);

export default createProvider({
  id: 'laravel',
  contractVersion: 1,
  plan: laravelCheckPlan,
});
