import { gateRevisions } from '../../configure.mjs';
import { ACKNOWLEDGE_WEAKENING } from './contracts.mjs';
import { CONFIGURE_SCRIPT, ENTRY_SCRIPT } from './paths.mjs';

/**
 * Characters a POSIX shell passes through unchanged outside quotes; anything
 * else is single-quoted. The same rule the Gate prints its own instructions
 * with, restated because a skill never imports another skill's files.
 */
const SHELL_BARE = /^[A-Za-z0-9_@%+=:,./-]+$/;

export const quoteForShell = (value) => (
  SHELL_BARE.test(value) || /^<[A-Za-z]+>$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
);

export const command = (role, argv) => ({ role, argv, run: argv.map(quoteForShell).join(' ') });

export const configureCommand = (role, projectRoot, ...argv) => command(
  role,
  ['node', CONFIGURE_SCRIPT, '--project', projectRoot, ...argv],
);

export const gateCommand = (role, prefix, ...argv) => command(role, [...prefix, ...argv]);

/**
 * The Framework command that previews or confirms one revision, as a
 * maintainer types it: the operation, its value, its options, and the token
 * when confirming.
 */
export const revisionCommand = (projectRoot, revision, confirmation = null, acknowledgeWeakening = false) => {
  const { argument, options } = gateRevisions[revision.operation];

  return command(confirmation === null ? 'preview' : 'confirm', [
    'node',
    ENTRY_SCRIPT,
    'config',
    revision.operation,
    revision[argument],
    ...options.flatMap((option) => (revision[option] === undefined ? [] : [`--${option}`, revision[option]])),
    '--project',
    projectRoot,
    ...(confirmation === null ? [] : ['--confirm', confirmation]),
    ...(acknowledgeWeakening ? [ACKNOWLEDGE_WEAKENING] : []),
  ]);
};

/**
 * The Framework command that previews or confirms one guardrail change, as a
 * maintainer types it.
 */
export const guardrailCommandLine = (projectRoot, guardrail, confirmation = null) => command(
  confirmation === null ? 'preview' : 'confirm',
  [
    'node',
    ENTRY_SCRIPT,
    'guardrail',
    guardrail.operation,
    guardrail.client,
    '--project',
    projectRoot,
    ...(confirmation === null ? [] : ['--confirm', confirmation]),
  ],
);
