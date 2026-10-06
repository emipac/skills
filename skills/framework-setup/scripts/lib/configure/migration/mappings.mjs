import path from 'node:path';

import { backendProfilesV4, commandRunners, frontendProfiles } from '../contracts.mjs';
import { inferredCommandDescriptor } from './rendering.mjs';

export const migrationAmbiguities = (configuration, mappings) => {
  const ambiguities = [];

  for (const profile of ['backend', 'frontend']) {
    if (configuration[profile] === 'unknown' && !mappings.profiles?.[profile]) {
      ambiguities.push({
        path: profile,
        value: 'unknown',
        required: ['profile'],
      });
    }
  }

  for (const command of configuration.commands) {
    const commandPath = `verification.commands.${command.category}.${command.scope}[${command.index}]`;
    const mapping = mappings.commands?.[commandPath] ?? {};
    const inferredDescriptor = inferredCommandDescriptor(command.value);
    const required = [];

    if (!inferredDescriptor && !mapping.runner) {
      required.push('runner');
    }

    if (!inferredDescriptor && !Array.isArray(mapping.args)) {
      required.push('args');
    }

    if (!Number.isInteger(mapping.timeout_seconds) || mapping.timeout_seconds <= 0) {
      required.push('timeout_seconds');
    }

    if (required.length > 0) {
      ambiguities.push({
        path: commandPath,
        value: command.value,
        required,
      });
    }
  }

  return ambiguities;
};

const validateCommandWorkingDirectory = (workingDirectory) => {
  const isInvalid = typeof workingDirectory !== 'string'
    || !workingDirectory
    || workingDirectory.includes('\\')
    || path.posix.isAbsolute(workingDirectory)
    || path.win32.isAbsolute(workingDirectory)
    || workingDirectory.split('/').includes('..');

  if (isInvalid) {
    throw new Error(`Invalid command working directory: ${String(workingDirectory)}`);
  }
};

export const validateMigrationMappings = (configuration, mappings) => {
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
    throw new Error('Migration mappings must be an object');
  }

  const unsupportedSection = Object.keys(mappings).find(
    (section) => !['profiles', 'commands'].includes(section),
  );

  if (unsupportedSection) {
    throw new Error(`Unsupported migration mapping section: ${unsupportedSection}`);
  }

  for (const section of ['profiles', 'commands']) {
    const value = mappings[section];

    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
      throw new Error(`Migration mapping ${section} must be an object`);
    }
  }

  for (const [profile, value] of Object.entries(mappings.profiles ?? {})) {
    if (!['backend', 'frontend'].includes(profile)) {
      throw new Error(`Unsupported profile mapping: ${profile}`);
    }

    if (configuration[profile] !== 'unknown') {
      throw new Error(
        `Profile mapping for ${profile} is only allowed when its schema v3 value is unknown`,
      );
    }

    const supportedProfiles = profile === 'backend' ? backendProfilesV4 : frontendProfiles;

    if (!supportedProfiles.has(value)) {
      throw new Error(`Unsupported ${profile} profile mapping: ${String(value)}`);
    }
  }

  const commandPaths = new Set(configuration.commands.map(
    (command) => `verification.commands.${command.category}.${command.scope}[${command.index}]`,
  ));

  for (const [commandPath, mapping] of Object.entries(mappings.commands ?? {})) {
    if (!commandPaths.has(commandPath)) {
      throw new Error(`Unknown command mapping: ${commandPath}`);
    }

    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      throw new Error(`Command mapping must be an object: ${commandPath}`);
    }

    const allowedKeys = new Set([
      'runner',
      'args',
      'working_directory',
      'timeout_seconds',
      'allowed_environment',
    ]);
    const unsupportedKey = Object.keys(mapping).find((key) => !allowedKeys.has(key));

    if (unsupportedKey) {
      throw new Error(`Unsupported command mapping field: ${unsupportedKey}`);
    }

    if (mapping.runner !== undefined && !commandRunners.has(mapping.runner)) {
      throw new Error(`Unsupported command runner: ${String(mapping.runner)}`);
    }

    if (
      mapping.args !== undefined
      && (!Array.isArray(mapping.args)
        || mapping.args.length === 0
        || mapping.args.some((argument) => typeof argument !== 'string'))
    ) {
      throw new Error(`Invalid command arguments: ${commandPath}`);
    }

    if (mapping.working_directory !== undefined) {
      validateCommandWorkingDirectory(mapping.working_directory);
    }

    if (
      mapping.timeout_seconds !== undefined
      && (!Number.isInteger(mapping.timeout_seconds) || mapping.timeout_seconds <= 0)
    ) {
      throw new Error(`Invalid command timeout: ${commandPath}`);
    }

    if (
      mapping.allowed_environment !== undefined
      && (!Array.isArray(mapping.allowed_environment)
        || new Set(mapping.allowed_environment).size !== mapping.allowed_environment.length
        || mapping.allowed_environment.some(
          (name) => typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name),
        ))
    ) {
      throw new Error(`Invalid allowed environment names: ${commandPath}`);
    }
  }
};

export const validateMigratedProfilePresence = (configuration, mappings) => {
  const backend = mappings.profiles?.backend ?? configuration.backend;
  const frontend = mappings.profiles?.frontend ?? configuration.frontend;

  for (const [profile, value] of Object.entries({ backend, frontend })) {
    if (value !== 'none') {
      continue;
    }

    const hasProfileScopes = configuration.sourceScopes[profile].length > 0;
    const hasProfileCommands = configuration.commands.some(
      (command) => command.scope === profile,
    );

    if (hasProfileScopes || hasProfileCommands) {
      const title = profile[0].toUpperCase() + profile.slice(1);

      throw new Error(
        `${title} profile none cannot retain ${profile} source scopes or commands`,
      );
    }
  }
};
