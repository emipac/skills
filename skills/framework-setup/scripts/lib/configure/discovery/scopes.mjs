import path from 'node:path';

import { sortUnique } from '../values.mjs';

const hasFilesUnder = (files, root) => files.some((file) => (
  (file === root || file.startsWith(`${root}${path.sep}`))
  && /\.(?:(?:c|m)?(?:js|ts)x?|svelte|php|blade\.php)$/i.test(file)
));

const existingRoots = (files, candidates) => candidates.filter(
  (candidate) => hasFilesUnder(files, candidate),
);

export const discoverSourceScopes = (files, backend, frontend) => {
  const backendCandidates = existingRoots(
    files,
    backend === 'laravel'
      ? [
          'app',
          'bootstrap',
          'config',
          'database',
          'routes',
          'tests',
          path.join('resources', 'views'),
        ]
      : [
          'server',
          'backend',
          'api',
          'database',
          path.join('src', 'server'),
          path.join('src', 'backend'),
          path.join('src', 'api'),
        ],
  );
  const frontendCandidates = existingRoots(files, [
    'client',
    'frontend',
    path.join('src', 'client'),
    path.join('src', 'frontend'),
    path.join('resources', 'js'),
  ]);
  const shared = existingRoots(files, ['shared', path.join('src', 'shared')]);

  if (backend === 'express-typescript' && backendCandidates.length === 0) {
    const sourceRoot = existingRoots(files, ['src']);

    if (sourceRoot.length > 0 && frontend === 'none') {
      backendCandidates.push(...sourceRoot);
    }
  }

  if (
    ['react-typescript', 'svelte-typescript'].includes(frontend)
    && frontendCandidates.length === 0
  ) {
    frontendCandidates.push(...existingRoots(files, ['src']));
  }

  return {
    backend: sortUnique(backendCandidates),
    frontend: sortUnique(frontendCandidates),
    shared: sortUnique(shared),
  };
};

export const normalizeSourceScopes = (sourceScopes) => Object.fromEntries(
  ['backend', 'frontend', 'shared'].map((scope) => {
    const roots = sourceScopes?.[scope];

    if (!Array.isArray(roots)) {
      throw new Error(`Source scope ${scope} must be an array`);
    }

    return [
      scope,
      sortUnique(roots.map((root) => {
        if (typeof root !== 'string') {
          throw new Error(`Invalid ${scope} source root: ${String(root)}`);
        }

        const normalized = root.replaceAll('\\', '/').replace(/^\.\/|\/$/g, '');

        if (
          !normalized
          || path.posix.isAbsolute(normalized)
          || normalized.split('/').includes('..')
        ) {
          throw new Error(`Invalid ${scope} source root: ${root}`);
        }

        return normalized;
      })),
    ];
  }),
);
