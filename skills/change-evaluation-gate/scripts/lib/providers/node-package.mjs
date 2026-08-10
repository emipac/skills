/**
 * Reference non-Laravel provider: a package-script driven Node repository.
 *
 * It exists to prove NFR-MAINT-001 — a second stack reaches the gate through
 * exactly the same descriptor contract, with no gate-core change and no
 * stack-name branch anywhere outside this file.
 */

import { createProvider } from './provider-kit.mjs';

export const nodePackageCheckPlan = Object.freeze([
  {
    key: 'format',
    id: 'format.formatter',
    stage: 'format',
    capability: 'formatter',
    claims: ['format:style'],
    policy: 'required',
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
  id: 'node-package',
  contractVersion: 1,
  plan: nodePackageCheckPlan,
});
