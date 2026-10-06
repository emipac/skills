/**
 * The operator surface: the one command a maintainer and an agent both run.
 *
 * Until it existed, every lifecycle operation was proved in isolation and
 * reachable by nothing a person or an agent runs. `TB-040` made the read-only
 * half reachable; `TB-041` added the half that writes — `repair`, `update`,
 * `deactivate`, `uninstall`, `cleanup`, `prune --confirm`, and
 * `locks --recover` — which until then existed only in `tests/` and in three
 * smoke scripts, so the only recovery available to an operator whose managed
 * hook block had been clobbered was to re-activate. `TB-042` added the
 * operation that had no entrypoint at all: `activate`, which until then was
 * reachable only by writing a throwaway script that imported `activation.mjs`
 * and reconstructed its argument shapes from the test suite.
 *
 * This module is the surface, not a second implementation of anything behind
 * it. It resolves the same inputs the authoritative runner resolves
 * (`resolveRepositoryRoot`, `resolveConfiguration`, `resolveReceipt`,
 * `openStore`), calls the lifecycle seams unchanged, and renders what they
 * returned. It adds no health grading, no lock judgement, no removal rule, and
 * no selection logic of its own; where it would have to invent one, it reports
 * the seam's own answer instead.
 *
 * TWO INVOCATIONS, NEVER ONE. Every command previews by default and performs
 * only when a separate later invocation names the token of a preview that still
 * describes this clone. There is no flag that previews and confirms in one run,
 * and `--confirm` without a token is refused by name rather than helpfully
 * resolved: a single call that did both would put the decision inside this
 * process instead of with the operator, which is the property every one of
 * these operations was designed around. It does not stop a determined caller
 * from running both commands back to back, and it is not meant to — it means no
 * single command destroys anything.
 *
 * THE PREVIEW IS RE-DERIVED, NEVER CARRIED. Every invocation — preview and
 * confirmation alike — rebuilds the preview from the filesystem as it is right
 * now, and the operator's token is checked against THAT. Nothing the caller
 * holds decides what happens, which is `TB-036`'s rule applied at the command
 * boundary: a confirmation naming a preview this clone no longer matches writes
 * nothing and says so (`NFR-REL-002`).
 *
 * WHAT REFUSES IS WHAT RECORDS. Where a lifecycle seam takes the confirmation
 * itself (`confirmRepair`, `updateGate`, `confirmConfigurationCleanup`,
 * `confirmEvidencePrune`, `recoverStale`), the token is handed straight to it
 * and the seam does the refusing and appends its own Lifecycle event. Only
 * `deactivateGate` and `uninstallGate` take no confirmation, so the surface
 * compares the token for those two and records the refusal through the one
 * helper below — the same event type their own `record` would have appended, in
 * the same store, through the same seam (`NFR-AUD-001`).
 *
 * TWO READERS, ONE ANSWER. Every invocation builds exactly one document and
 * then renders it once: as `--json` for an agent, or as a summary for a person.
 * The two cannot disagree, because there is only one thing to disagree about
 * (`NFR-OPER-001`).
 *
 * It is not interactive, has no prompt, no spinner, and no colour: a prompt is
 * exactly what would lock an agent out of a surface both callers must reach.
 * And it claims nothing it does not have — exposing these operations to an
 * agent changes nothing about a boundary that was already cooperative, and the
 * surface states that rather than implying enforcement it never had
 * (`SG-TRUST-001`).
 */

export {
  DOCUMENT_VERSION,
  EXIT_OBSERVED,
  EXIT_UNHEALTHY,
  EXIT_UNRUNNABLE,
  COMMANDS,
  CONFIRMABLE_COMMANDS,
  CONFIRMED_SELECTORS,
  CONFIRMED_COMMANDS,
} from './operator-surface/constants.mjs';

export {
  quoteForShell,
  instructionSelectors,
} from './operator-surface/instructions.mjs';

export { PACKAGED_HOOK_PROGRAM } from './operator-surface/runtime.mjs';

export { USAGE } from './operator-surface/usage.mjs';

export { renderDocument } from './operator-surface/rendering/document.mjs';

export { runOperatorCommand } from './operator-surface/dispatch.mjs';

/**
 * This command itself, as an activated clone's shortcut has to name it. Stated
 * once, beside the shortcut, so every remedy that names the shortcut asks
 * about the same program (`TB-065`).
 */
export { PACKAGED_COMMAND } from './activation-seams.mjs';
