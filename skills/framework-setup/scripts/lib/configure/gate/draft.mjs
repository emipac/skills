import path from 'node:path';

import { readExistingConfiguration } from '../configuration-read.mjs';
import { discoverProject } from '../discovery/project.mjs';
import { emitDraft, exists } from '../filesystem.mjs';
import { derivedDependencyRoots } from './dependencies.mjs';

/**
 * Which provider module speaks for which proved stack.
 *
 * This is a module table, not a check catalogue. `framework-setup` learns from
 * it only where to ask; every check identity and every default binding is read
 * back out of the provider's own declared plan, so a provider that changes its
 * checks changes this draft with no edit here (SG-OWNER-001).
 */
const gateProviderModules = Object.freeze({
  laravel: '../../../../../change-evaluation-gate/scripts/lib/providers/laravel.mjs',
  node: '../../../../../change-evaluation-gate/scripts/lib/providers/node-package.mjs',
});

/** The backend profile a Gate draft is derived for: configured, else discovered. */
const resolveDraftBackend = async (projectRoot) => {
  const existing = await readExistingConfiguration(projectRoot);

  return existing.backend && existing.backend !== 'unknown'
    ? existing.backend
    : (await discoverProject(projectRoot)).backend;
};

const resolveDraftProvider = async (projectRoot) => {
  const backend = await resolveDraftBackend(projectRoot);
  const specifier = backend === 'laravel'
    ? gateProviderModules.laravel
    : (await exists(path.join(path.resolve(projectRoot), 'package.json'))
      ? gateProviderModules.node
      : null);

  if (!specifier) {
    throw new Error('No verification provider matches this project; a Gate policy cannot be drafted');
  }

  return (await import(specifier)).default;
};

/**
 * The total evaluation budget, summed from the timeouts this project proved.
 *
 * A schema v4 configuration states an exact timeout for every command it owns,
 * so their total is a derived project fact rather than a default. A project
 * that has proved none leaves the budget `null`, and a `null` budget is refused
 * by `--policy` rather than silently replaced with a plausible number.
 */
const derivedBudgetSeconds = async (projectRoot) => {
  const { readRepositoryConfiguration } = await import(
    '../../../../../change-evaluation-gate/scripts/lib/configuration.mjs',
  );
  const read = await readRepositoryConfiguration({ repositoryRoot: path.resolve(projectRoot) });

  if (!read.ok) {
    return null;
  }

  let total = 0;

  for (const scopes of Object.values(read.configuration?.verification?.commands ?? {})) {
    for (const scoped of Object.values(scopes ?? {})) {
      if (!Array.isArray(scoped)) {
        continue;
      }

      for (const command of scoped) {
        if (!Number.isInteger(command?.timeout_seconds) || command.timeout_seconds <= 0) {
          return null;
        }

        total += command.timeout_seconds;
      }
    }
  }

  return total > 0 ? total : null;
};

/**
 * The check identities the activated Git hook actually binds through, read
 * from this project's own schema v4 configuration.
 *
 * `gateChecksFromConfiguration` is the same function `hook-runner.mjs` calls
 * at evaluation time, so the identities this returns are exactly the ones a
 * configured, activated hook will bind (SG-OWNER-001, NFR-REL-003) — never a
 * restated copy of its `configuration.<stage>.<capability>` naming rule.
 *
 * A project that has not migrated, or that has migrated but proved no
 * verification command yet, has nothing this function can derive an identity
 * from: the drafter refuses rather than guess or fall back to provider-plan
 * names, because a draft that cannot bind is worse than no draft at all.
 */
const configuredChecksToDraft = async (projectRoot) => {
  const { readRepositoryConfiguration, gateChecksFromConfiguration } = await import(
    '../../../../../change-evaluation-gate/scripts/lib/configuration.mjs',
  );
  const read = await readRepositoryConfiguration({ repositoryRoot: path.resolve(projectRoot) });
  const { checks } = read.ok ? gateChecksFromConfiguration(read.configuration) : { checks: [] };

  if (checks.length === 0) {
    throw new Error(
      'A Gate policy cannot be drafted before this project migrates to schema version 4 and '
      + 'proves at least one verification command; run the schema v4 migration (--mapping) first.',
    );
  }

  return checks;
};

/**
 * The Sensitive runtime inputs a stock project of each profile needs its test
 * suite to receive, and where that profile keeps them.
 *
 * A Laravel application reads its encryption key from `.env`, which is
 * git-ignored and therefore absent from the Evaluation snapshot; its stock
 * `phpunit.xml` deliberately sets no `APP_KEY`, so a suite that runs locally
 * fails inside the snapshot with a missing key on first activation. Declaring
 * the name and the file here lets the Gate resolve that one approved name from
 * the file, hand it to the check, and scrub it from Evidence — the declaration
 * is names and paths only, never a value (`FR-CFG-006`, `FR-LIFE-013`,
 * `TB-059`). A maintainer who does not want it removes one line. Every other
 * profile declares nothing, exactly as before.
 *
 * This is the profile's knowledge, kept in `framework-setup`'s profile table:
 * Gate core learns no variable name, file name, or framework (`SG-OWNER-001`).
 */
const PROFILE_EVIDENCE_DEFAULTS = Object.freeze({
  laravel: Object.freeze({
    sensitive_inputs: Object.freeze(['APP_KEY']),
    environment_files: Object.freeze(['.env']),
  }),
});

const derivedEvidencePolicy = (backend) => {
  const defaults = PROFILE_EVIDENCE_DEFAULTS[backend] ?? null;

  return defaults === null
    ? {}
    : Object.fromEntries(Object.entries(defaults).map(([key, values]) => [key, [...values]]));
};

export const draftGatePolicy = async ({ projectRoot, out = null } = {}) => {
  const provider = await resolveDraftProvider(projectRoot);
  const checks = await configuredChecksToDraft(projectRoot);
  const required = [];
  const advisory = [];

  for (const check of checks) {
    const planEntry = provider.plan.find(
      (entry) => entry.stage === check.stage && entry.capability === check.capability,
    );

    (planEntry?.policy === 'required' ? required : advisory).push(check.id);
  }

  return emitDraft({
    checks: { required, advisory },
    budget: { total_seconds: await derivedBudgetSeconds(projectRoot) },
    bypass: { enabled: false, marker: null },
    execution: {
      budget_skippable: [],
      dependency_roots: await derivedDependencyRoots(projectRoot, checks),
    },
    evidence: derivedEvidencePolicy(await resolveDraftBackend(projectRoot)),
  }, out);
};
