/**
 * Command descriptor contract (schema v4).
 *
 * A Command descriptor is operating-system independent and shell free. It names
 * a logical runner, an argument array, a repository-relative working directory,
 * a timeout, the allowed environment names, an evidence category, and a source
 * scope. Nothing here parses, expands, or executes shell text.
 *
 * Safeguard SG-CMD-001 is enforced structurally: shell constructions and
 * unknown runners are rejected before any execution seam can see the
 * descriptor, and complex behavior is only reachable through an explicitly
 * declared `repository-script` Grader surface.
 */

export const COMMAND_RUNNERS = Object.freeze([
  'composer-bin',
  'php-script',
  'package-script',
  'repository-script',
]);

export const GRADER_SURFACE_RUNNER = 'repository-script';

const SHELL_CONSTRUCTS = Object.freeze([
  { pattern: /[;|&]/, name: 'operator' },
  { pattern: /[<>]/, name: 'redirection' },
  { pattern: /[`$]/, name: 'substitution' },
  { pattern: /[\n\r]/, name: 'newline' },
  { pattern: /\\/, name: 'escape' },
  { pattern: /[*?[\]{}]/, name: 'glob' },
  { pattern: /["']/, name: 'quote' },
]);

const INLINE_ENVIRONMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Reject every construction that would require a shell to interpret it. */
export const shellConstructErrors = (value, path) => {
  const errors = [];

  for (const { pattern, name } of SHELL_CONSTRUCTS) {
    if (pattern.test(value)) {
      errors.push({
        code: 'shell-syntax-rejected',
        path,
        message: `Command text contains a shell ${name}; descriptors are shell free.`,
      });
    }
  }

  return errors;
};

const REQUIRED_COMMAND_FIELDS = Object.freeze([
  'runner',
  'args',
  'working_directory',
  'timeout_seconds',
  'allowed_environment',
  'evidence_category',
  'source_scope',
]);

const SOURCE_SCOPES = Object.freeze(['backend', 'frontend', 'both']);

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const EVIDENCE_CATEGORY = /^[a-z][a-z0-9_-]*$/;

const isPlainObject = (value) => typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

export const isRepositoryRelativePath = (value) => typeof value === 'string'
  && value.length > 0
  && !value.startsWith('/')
  && !/^[A-Za-z]:/.test(value)
  && !value.split(/[\\/]/).includes('..');

export const validateCommandDescriptor = (command, path) => {
  const errors = [];

  if (!isPlainObject(command)) {
    return [{ code: 'command-invalid', path, message: 'Command descriptor must be an object.' }];
  }

  for (const field of REQUIRED_COMMAND_FIELDS) {
    if (!(field in command)) {
      errors.push({
        code: 'command-field-missing',
        path: `${path}.${field}`,
        message: `Command descriptor is missing ${field}.`,
      });
    }
  }

  for (const field of Object.keys(command)) {
    if (!REQUIRED_COMMAND_FIELDS.includes(field)) {
      errors.push({
        code: 'command-field-unknown',
        path: `${path}.${field}`,
        message: `Command descriptor does not accept ${field}.`,
      });
    }
  }

  if (!COMMAND_RUNNERS.includes(command.runner)) {
    errors.push({
      code: 'runner-unresolved',
      path: `${path}.runner`,
      message: `Runner ${JSON.stringify(command.runner)} is not a settled logical runner.`,
    });
  }

  if (!Array.isArray(command.args) || command.args.length === 0) {
    errors.push({
      code: 'command-args-invalid',
      path: `${path}.args`,
      message: 'Command descriptor requires a non-empty argument array.',
    });
  } else {
    command.args.forEach((argument, index) => {
      const argumentPath = `${path}.args[${index}]`;

      if (typeof argument !== 'string' || argument.length === 0) {
        errors.push({
          code: 'command-args-invalid',
          path: argumentPath,
          message: 'Every argument must be a non-empty string.',
        });

        return;
      }

      errors.push(...shellConstructErrors(argument, argumentPath));

      if (index === 0 && INLINE_ENVIRONMENT.test(argument)) {
        errors.push({
          code: 'shell-syntax-rejected',
          path: argumentPath,
          message: 'Inline environment assignment is not a command argument.',
        });
      }
    });
  }

  if (!isRepositoryRelativePath(command.working_directory)) {
    errors.push({
      code: 'command-working-directory-invalid',
      path: `${path}.working_directory`,
      message: 'Working directory must be a repository-relative path without traversal.',
    });
  } else {
    errors.push(...shellConstructErrors(command.working_directory, `${path}.working_directory`));
  }

  if (!Number.isInteger(command.timeout_seconds) || command.timeout_seconds < 1) {
    errors.push({
      code: 'command-timeout-invalid',
      path: `${path}.timeout_seconds`,
      message: 'Timeout must be a positive integer number of seconds.',
    });
  }

  if (!Array.isArray(command.allowed_environment)
    || command.allowed_environment.some((name) => !ENVIRONMENT_NAME.test(String(name)))) {
    errors.push({
      code: 'command-environment-invalid',
      path: `${path}.allowed_environment`,
      message: 'Allowed environment must list plain environment variable names.',
    });
  }

  if (typeof command.evidence_category !== 'string'
    || !EVIDENCE_CATEGORY.test(command.evidence_category)) {
    errors.push({
      code: 'command-evidence-category-invalid',
      path: `${path}.evidence_category`,
      message: 'Evidence category must be a lowercase identifier.',
    });
  }

  if (!SOURCE_SCOPES.includes(command.source_scope)) {
    errors.push({
      code: 'command-source-scope-invalid',
      path: `${path}.source_scope`,
      message: 'Source scope must be backend, frontend, or both.',
    });
  }

  return errors;
};

/**
 * Every explicitly declared repository script is a Grader surface: it decides
 * evidence, so the gate must be able to report it when it changes.
 */
export const graderSurfaces = (checks) => {
  const surfaces = [];

  for (const check of checks) {
    for (const [role, command] of [['evaluate', check.evaluate], ['fix', check.fix]]) {
      if (!command || command.runner !== GRADER_SURFACE_RUNNER) {
        continue;
      }

      const directory = command.working_directory === '.' ? '' : `${command.working_directory}/`;

      surfaces.push({ check_id: check.id, role, path: `${directory}${command.args[0]}` });
    }
  }

  return surfaces;
};

export const commandPreview = (command, executable) => [executable, ...command.args].join(' ');

/**
 * Activation-time executable resolution.
 *
 * `resolve(runner, command)` is supplied by the caller so resolution stays a
 * pure function of proved facts. A runner that cannot be resolved never falls
 * back to a shell lookup; it is reported so its check becomes `unverified`.
 */
export const resolveExecutables = (checks, resolve) => {
  const resolved = [];
  const unresolved = [];

  for (const check of checks) {
    for (const [role, command] of [['evaluate', check.evaluate], ['fix', check.fix]]) {
      if (!command) {
        continue;
      }

      const resolution = resolve(command.runner, command) ?? null;

      if (!resolution || typeof resolution.executable !== 'string' || !resolution.executable) {
        unresolved.push({
          check_id: check.id,
          role,
          runner: command.runner,
          reason: 'runner-unresolved',
        });

        continue;
      }

      const version = resolution.version ?? null;

      resolved.push({
        check_id: check.id,
        role,
        runner: command.runner,
        executable: resolution.executable,
        version,
        pinned: { executable: resolution.executable, version },
        preview: commandPreview(command, resolution.executable),
        working_directory: command.working_directory,
      });
    }
  }

  return { resolved, unresolved };
};
