import path from 'node:path';

import { PACKAGE_LOCK_FILES } from '../contracts.mjs';
import { exists } from '../filesystem.mjs';

/**
 * Draft the Gate policy this project's own configuration and matching
 * provider already describe.
 *
 * Check identities are read out of `gateChecksFromConfiguration`, the exact
 * function the activated hook binds through, so the draft cannot name a check
 * the hook will not enforce. The required/advisory binding for each identity
 * is still read out of the provider's declared plan, matched by the stage and
 * capability the configuration proves — a configured check with no matching
 * plan entry binds advisory rather than guessing required. Nothing here
 * restates either catalogue (SG-OWNER-001), and nothing unproved is invented:
 * bypass stays disabled with no marker, and an unprovable budget stays `null`.
 */
/**
 * Which installed dependency directory each logical runner reaches into.
 *
 * A `composer-bin` binary lives under the vendor directory and a PHP entry
 * point autoloads from it; a package script runs through a package manager that
 * resolves from the module tree. A `repository-script` is run by this Node
 * runtime against a file the repository tracks and needs neither.
 */
const RUNNER_DEPENDENCY_ROOTS = Object.freeze({
  'composer-bin': 'vendor',
  'php-script': 'vendor',
  'package-script': 'node_modules',
});

/**
 * Which manifest and lock files govern each installed dependency directory.
 *
 * This is the one place `framework-setup` records which directory a
 * dependency manager installs into: the Gate drafter reads a runner's root's
 * manifest from it, and `config suggest` reads which repository facts imply a
 * root (`SG-OWNER-001`). Gate core learns no manifest, lock file, or directory
 * name from it.
 */
export const DEPENDENCY_INSTALLS = Object.freeze({
  vendor: Object.freeze({ manifest: 'composer.json', lockFiles: Object.freeze(['composer.lock']) }),
  node_modules: Object.freeze({
    manifest: 'package.json',
    lockFiles: Object.freeze(PACKAGE_LOCK_FILES.map(([lockFile]) => lockFile)),
  }),
});

/**
 * Where this project installs the dependencies its own checks need to run.
 *
 * A materialized Evaluation snapshot holds tracked content, and an installed
 * dependency tree is never tracked — so a tool starts inside the snapshot and
 * cannot find the autoloader or module tree it needs to read the code at all.
 *
 * Two proved facts are required before a root is declared, and a manifest alone
 * is not enough: some configured check must run through a runner that reaches
 * into that directory, *and* the manifest that governs it must exist. A project
 * carrying a `package.json` whose only check is a repository script needs no
 * module tree, and declaring one would deny its commits for a directory nothing
 * was going to read.
 *
 * A root the project has not installed yet is the Gate's to report, not this
 * drafter's to hide.
 */
export const derivedDependencyRoots = async (projectRoot, checks) => {
  const resolvedRoot = path.resolve(projectRoot);
  const roots = [];

  for (const check of checks) {
    for (const command of [check.evaluate, check.fix]) {
      const root = RUNNER_DEPENDENCY_ROOTS[command?.runner] ?? null;

      if (root === null || roots.includes(root)) {
        continue;
      }

      if (await exists(path.join(resolvedRoot, DEPENDENCY_INSTALLS[root].manifest))) {
        roots.push(root);
      }
    }
  }

  return roots.sort();
};
