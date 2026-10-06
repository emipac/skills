import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { exists } from './filesystem.mjs';
import { parseYamlScalar } from './yaml.mjs';

export const readExistingConfiguration = async (projectRoot) => {
  const configurationPath = path.join(projectRoot, '.agent-framework.yaml');

  if (!(await exists(configurationPath))) {
    return {
      schemaVersion: null,
      backend: null,
      frontend: null,
      sourceScopes: null,
    };
  }

  const contents = await readFile(configurationPath, 'utf8');
  const schemaVersion = Number(contents.match(/^schema_version:\s*(\d+)$/m)?.[1] ?? 0);
  const backend = parseYamlScalar(contents.match(/^backend:\s*(.+)$/m)?.[1] ?? 'unknown');
  const frontend = parseYamlScalar(contents.match(/^frontend:\s*(.+)$/m)?.[1] ?? 'unknown');
  const sourceScopes = { backend: [], frontend: [], shared: [] };
  let inSourceScopes = false;
  let currentScope = null;

  for (const line of contents.split(/\r?\n/)) {
    if (line === 'source_scopes:') {
      inSourceScopes = true;
      continue;
    }

    if (inSourceScopes && line && !line.startsWith(' ')) {
      break;
    }

    const scope = line.match(/^  (backend|frontend|shared):(?:\s*\[\])?$/);

    if (inSourceScopes && scope) {
      currentScope = scope[1];
      continue;
    }

    const root = line.match(/^    -\s+(.+)$/);

    if (inSourceScopes && currentScope && root) {
      sourceScopes[currentScope].push(root[1].replace(/^"|"$/g, ''));
    }
  }

  return {
    schemaVersion: schemaVersion || null,
    backend,
    frontend,
    sourceScopes: schemaVersion >= 3 ? sourceScopes : null,
  };
};
