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

import { accessSync, constants } from 'node:fs';
import path from 'node:path';

const { X_OK } = constants;

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

/**
 * How each logical runner combines its resolved executable with its stored
 * arguments.
 *
 * The rule lives with the runner, never with the resolver and never with a
 * caller. The resolver's job is to find an executable and record its identity
 * and version; if it also had to know how each runner shapes its arguments,
 * every caller would carry a copy of that knowledge and they would drift —
 * which is exactly how a preview came to describe a command that would not run.
 *
 * A rule only ever selects, reorders, or prefixes whole stored arguments. It
 * never parses, splits, joins, or re-quotes one (`SG-CMD-001`).
 */
const RUNNER_ARGUMENTS = Object.freeze({
  // The leading argument names the binary under the vendor directory and is
  // already consumed by resolution to find it, so only the rest is passed on.
  'composer-bin': (args) => (args.length > 0
    ? { args: args.slice(1) }
    : {
      error: {
        code: 'command-args-uncomposable',
        message: 'A composer-bin descriptor must name its binary as its first argument.',
      },
    }),
  'php-script': (args) => ({ args: [...args] }),
  // The descriptor stores a package script name, and a package manager reaches
  // a script through its `run` subcommand.
  'package-script': (args) => (args.length > 0
    ? { args: ['run', ...args] }
    : {
      error: {
        code: 'command-args-uncomposable',
        message: 'A package-script descriptor must name its script as its first argument.',
      },
    }),
  'repository-script': (args) => ({ args: [...args] }),
});

/**
 * Compose the argument list one descriptor hands to its resolved executable.
 *
 * Returns `{ args }` when the runner can compose its stored arguments, and
 * `{ error }` when it cannot. A descriptor that cannot be composed is reported;
 * it is never silently adjusted into something that happens to run.
 *
 * @param {object} command a schema v4 Command descriptor
 * @returns {{ args: string[] | null, error: object | null }}
 */
export const composeArguments = (command) => {
  const compose = RUNNER_ARGUMENTS[command?.runner];

  if (!compose) {
    return {
      args: null,
      error: {
        code: 'runner-unresolved',
        message: `Runner ${JSON.stringify(command?.runner ?? null)} is not a settled logical runner.`,
      },
    };
  }

  if (!Array.isArray(command.args) || command.args.some((argument) => typeof argument !== 'string')) {
    return {
      args: null,
      error: {
        code: 'command-args-uncomposable',
        message: 'Command descriptor requires an array of string arguments.',
      },
    };
  }

  return { args: null, error: null, ...compose(command.args) };
};

export const commandPreview = (command, executable) => {
  const { args, error } = composeArguments(command);

  return error ? null : [executable, ...args].join(' ');
};

/** Which platform executable each logical runner runs on this machine. */
const PLATFORM_EXECUTABLES = Object.freeze({
  'package-script': 'npm',
  'php-script': 'php',
});

/** Where a `composer-bin` runner finds the binary its descriptor names. */
const VENDOR_BINARY_DIRECTORY = path.join('vendor', 'bin');

/**
 * Find one executable on `PATH` without asking a shell to do it.
 *
 * An unresolved runner never falls back to shell lookup, so resolution walks
 * the search path itself and reports nothing when it finds nothing.
 */
const locateOnPath = (name, environment) => {
  if (name.includes('/')) {
    return isExecutable(name) ? name : null;
  }

  for (const directory of (environment.PATH ?? '').split(path.delimiter)) {
    if (directory === '') {
      continue;
    }

    const candidate = path.join(directory, name);

    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
};

const isExecutable = (candidate) => {
  try {
    accessSync(candidate, X_OK);

    return true;
  } catch {
    return false;
  }
};

/**
 * Resolve the vendor binary a `composer-bin` descriptor names.
 *
 * The leading argument names the binary and composition already consumes it, so
 * resolution is the half that must find it. It is looked up under the vendor
 * directory of the descriptor's own working directory — a repository whose PHP
 * application lives in a subdirectory keeps `vendor/` there — and the result is
 * absolute, because a check runs inside a materialised snapshot where `vendor/`
 * is absent. The tool is not the thing under test; the snapshot content is
 * (`SG-EVAL-001`).
 *
 * A name carrying a path separator is refused rather than joined, so no
 * descriptor can reach outside the vendor directory (`SG-CMD-001`).
 */
const resolveVendorBinary = (command, repositoryRoot) => {
  const name = command.args?.[0] ?? null;

  if (typeof name !== 'string' || name === '' || typeof repositoryRoot !== 'string') {
    return null;
  }

  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return null;
  }

  const candidate = path.resolve(
    repositoryRoot,
    command.working_directory ?? '.',
    VENDOR_BINARY_DIRECTORY,
    name,
  );

  return isExecutable(candidate) ? candidate : null;
};

/**
 * The one rule that turns a logical runner into the executable it runs.
 *
 * Activation resolves through this rule and pins what it resolved; the hook
 * honours that pin rather than resolving again. A second copy of this mapping
 * is how activation came to prove one program while the hook ran another, so
 * the rule is exported once and never restated (`SG-OWNER-001`).
 *
 * It reads a descriptor through the command contract alone and learns nothing
 * about which stack produced it. A runner it cannot resolve is reported as
 * unresolved; it is never looked up through a shell (`SG-CMD-001`).
 *
 * @param {object} context the repository root and environment resolution reads
 * @returns {(runner: string, command: object) => ({ executable: string, version: string|null }|null)}
 */
export const createRunnerResolver = ({ repositoryRoot = null, environment = process.env } = {}) => (
  (runner, command) => {
    if (runner === GRADER_SURFACE_RUNNER) {
      // A repository script is a Grader surface this Node runtime can run when
      // it is a Node module. Anything else is left unresolved rather than
      // guessed.
      return /\.[cm]?js$/.test(command?.args?.[0] ?? '')
        ? { executable: process.execPath, version: process.versions.node }
        : null;
    }

    if (runner === 'composer-bin') {
      const executable = resolveVendorBinary(command ?? {}, repositoryRoot);

      return executable === null ? null : { executable, version: null };
    }

    const name = PLATFORM_EXECUTABLES[runner] ?? null;

    if (name === null) {
      return null;
    }

    const executable = locateOnPath(name, environment);

    return executable === null ? null : { executable, version: null };
  }
);

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

      // A descriptor its own runner cannot compose is reported, never quietly
      // reshaped into something that happens to run.
      const composition = composeArguments(command);

      if (composition.error) {
        unresolved.push({
          check_id: check.id,
          role,
          runner: command.runner,
          reason: composition.error.code,
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
