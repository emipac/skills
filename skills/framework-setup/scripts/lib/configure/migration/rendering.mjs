import { yamlScalar } from '../yaml.mjs';

export const inferredCommandDescriptor = (command) => {
  const packageScript = command.match(/^(npm|pnpm|bun) run ([a-zA-Z0-9:_-]+)$/)
    ?? command.match(/^yarn ([a-zA-Z0-9:_-]+)$/);

  if (packageScript) {
    return {
      runner: 'package-script',
      args: [packageScript.at(-1)],
    };
  }

  const safeCommand = /^[a-zA-Z0-9_./:=@-]+(?:\s+[a-zA-Z0-9_./:=@-]+)*$/;

  if (!safeCommand.test(command)) {
    return null;
  }

  const composerBinary = command.match(/^(?:\.\/)?vendor\/bin\/([a-zA-Z0-9_.-]+)(?:\s+(.+))?$/);

  if (composerBinary) {
    return {
      runner: 'composer-bin',
      args: [composerBinary[1], ...(composerBinary[2]?.split(' ') ?? [])],
    };
  }

  const phpScript = command.match(/^php\s+(.+)$/);

  if (phpScript) {
    return {
      runner: 'php-script',
      args: phpScript[1].split(' '),
    };
  }

  return null;
};

const verificationProfile = (backend, frontend) => {
  if (backend === 'none' && frontend === 'none') {
    return 'tooling';
  }

  if (backend === 'none') {
    return frontend;
  }

  return frontend === 'none' ? backend : `${backend}-${frontend}`;
};

const migratedCommandDescriptor = (command, mappings) => {
  const commandPath = `verification.commands.${command.category}.${command.scope}[${command.index}]`;
  const mapping = mappings.commands?.[commandPath] ?? {};
  const inferredDescriptor = inferredCommandDescriptor(command.value) ?? {};

  return {
    runner: mapping.runner ?? inferredDescriptor.runner,
    args: mapping.args ?? inferredDescriptor.args,
    working_directory: mapping.working_directory ?? '.',
    timeout_seconds: mapping.timeout_seconds,
    allowed_environment: mapping.allowed_environment ?? [],
    evidence_category: command.category,
    source_scope: command.scope,
  };
};

export const renderMigratedConfiguration = (contents, configuration, mappings) => {
  const backend = mappings.profiles?.backend ?? configuration.backend;
  const frontend = mappings.profiles?.frontend ?? configuration.frontend;
  const commandLines = new Map(configuration.commands.map((command) => [
    command.lineIndex,
    `        - ${JSON.stringify(migratedCommandDescriptor(command, mappings))}`,
  ]));

  return contents.split(/\r?\n/).map((line, lineIndex) => {
    if (commandLines.has(lineIndex)) {
      return commandLines.get(lineIndex);
    }

    if (/^schema_version:/.test(line)) {
      return 'schema_version: 4';
    }

    if (/^backend:/.test(line)) {
      return `backend: ${yamlScalar(backend)}`;
    }

    if (/^frontend:/.test(line)) {
      return `frontend: ${yamlScalar(frontend)}`;
    }

    if (/^  profile:/.test(line)) {
      return `  profile: ${yamlScalar(verificationProfile(backend, frontend))}`;
    }

    return line;
  }).join('\n');
};
