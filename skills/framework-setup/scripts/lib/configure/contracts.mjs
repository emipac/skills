export const trackerAdapters = new Set([
  'local-markdown',
  'github',
  'jira',
  'linear',
]);

export const backendProfiles = new Set(['laravel', 'express-typescript', 'unknown']);

export const frontendProfiles = new Set([
  'livewire',
  'react-typescript',
  'svelte-typescript',
  'none',
  'unknown',
]);

export const backendProfilesV4 = new Set([...backendProfiles, 'none']);

export const commandRunners = new Set([
  'composer-bin',
  'php-script',
  'package-script',
  'repository-script',
]);

/**
 * The Node lock files, each with the package manager that writes it, in the
 * order a project's package manager is detected by.
 */
export const PACKAGE_LOCK_FILES = Object.freeze([
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
]);

/** The Gate configuration section's five subcontracts, in the order `configure-gate` writes them. */
export const gatePolicyKeys = Object.freeze(['checks', 'budget', 'bypass', 'execution', 'evidence']);

export const verificationCategories = [
  'format',
  'static_analysis',
  'test',
  'smoke',
  'build',
  'e2e',
];

export const verificationScopes = ['backend', 'frontend', 'both'];
