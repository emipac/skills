import { SELECTORS, SELECTOR_FIELDS } from './constants.mjs';

/**
 * Characters a POSIX shell (`sh`, `bash`, `zsh` — macOS and Linux, the
 * platforms this skill claims) passes through unchanged outside quotes. A value
 * made only of these is printed bare; anything else is single-quoted, with an
 * embedded `'` spelled `'\''`, which is the one quoting every POSIX shell reads
 * identically. This repository's own resolved PHP lives under
 * `Application Support`, so a path with a space is not hypothetical.
 */
const SHELL_BARE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** One argument, as it has to be pasted for a POSIX shell to hand it back unchanged. */
export const quoteForShell = (value) => (
  SHELL_BARE.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
);

/**
 * The selectors one parsed invocation carried, as the argument vector that
 * would reproduce them.
 *
 * Every value selector the command declares and the invocation supplied is
 * echoed, in the order `SELECTORS` declares them, once per value for a
 * `repeatable` selector; the confirmation selector is never among them. This
 * is what a `next:` line is composed from: the instruction a preview prints
 * is a statement about the invocation that produced the preview, so it has to
 * carry whatever that invocation carried — whether or not the value reached
 * the confirmation token (`--client` does; `--actor` and `--resume` shape what
 * the confirmation records and resumes without changing the token, and are
 * carried for the same reason).
 */
export const instructionSelectors = (command, selector) => Object.entries(SELECTORS[command] ?? {})
  .filter(([, reading]) => reading !== 'confirmation')
  .flatMap(([flag, reading]) => {
    const value = selector?.[SELECTOR_FIELDS[flag]] ?? null;

    if (value === null) {
      return [];
    }

    if (reading === 'flag') {
      return value === true ? [flag] : [];
    }

    return (reading === 'repeatable' ? value : [value])
      .flatMap((each) => [flag, String(each)]);
  });

/** The preview invocation, as a person pastes it: `gate <command> <selectors…>`. */
export const previewInstruction = (command, selectors) => ['gate', command, ...selectors.map(quoteForShell)].join(' ');

/**
 * Why a confirmation did not reproduce the preview its token names, in words
 * that assert only what this process established.
 *
 * All the confirmation path holds is two opaque `sha256:` identities — the one
 * the operator carried and the one this invocation recomputed. A token that
 * differs says the preview differs; it cannot say WHY. The preview body is
 * hashed whole, no preview is ever persisted to diff against, and a clone that
 * changed underneath the operator and an invocation that dropped a selector
 * (`gate activate --confirm …` where the preview was `--client cursor`) produce
 * exactly the same evidence: `expected !== actual`. So the refusal names both
 * causes and blames neither, and points at the one thing that decides between
 * them — the `next:` line the preview printed, which carries every selector its
 * preview needed (`NFR-OPER-001`, `TB-053`).
 */
export const mismatchExplanation = (command, selectors) => (
  `the confirmation did not reproduce the preview that token names: either this clone changed since that preview, or this invocation's selectors differ from the one that printed it (this one ran as \`${previewInstruction(command, selectors)}\`). Preview again, read it, and confirm the \`next:\` line it prints.`
);
