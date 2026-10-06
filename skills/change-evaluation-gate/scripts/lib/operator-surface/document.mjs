import { DOCUMENT_VERSION, EXIT_OBSERVED, EXIT_UNHEALTHY, EXIT_UNRUNNABLE, GATE_ID } from './constants.mjs';
import { instructionSelectors } from './instructions.mjs';
import { TRUST_BOUNDARY } from '../security-control.mjs';

/** The envelope every rendering is made from, whether the command ran or not. */
export const documentOf = ({ command, repositoryRoot, result, selector = null }) => {
  const failed = result.failure !== undefined;
  const resolvedCommand = result.command ?? command ?? null;
  const exitStatus = failed
    ? EXIT_UNRUNNABLE
    : (result.healthy ? EXIT_OBSERVED : EXIT_UNHEALTHY);

  return {
    document: DOCUMENT_VERSION,
    gate: GATE_ID,
    command: resolvedCommand,
    ok: !failed && result.healthy === true,
    exitStatus,
    repository: { root: repositoryRoot },
    // The value selectors THIS invocation carried, as the parser read them and
    // as the argument vector that would reproduce them. The `next:` line is
    // composed from these, so the instruction a preview prints is a statement
    // about the invocation that produced the preview rather than a template
    // built from the command's name (`FR-LIFE-004`, `TB-053`).
    invocation: {
      selectors: failed || resolvedCommand === null ? [] : instructionSelectors(resolvedCommand, selector),
    },
    // What this invocation would do, re-derived from the clone as it is now.
    observation: failed ? null : result.observation,
    // What it did, or refused to do. `null` on every preview, which is what
    // makes "this run wrote nothing" a field rather than a promise in prose.
    mutation: failed ? null : (result.mutation ?? null),
    failure: failed ? result.failure : null,
    // Stated on every document, in the words the skill states it in once
    // (`SG-TRUST-001`): this reports what a cooperative local process can see
    // and do about itself, and it resists nobody. Reaching these operations
    // from an agent changes nothing about a boundary that was already
    // cooperative — `--no-verify` has always been one flag away — except that
    // what is done here leaves a record.
    trustBoundary: TRUST_BOUNDARY,
  };
};
