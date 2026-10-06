

/** The document an agent parses. Versioned, so a later field is an addition rather than a surprise. */
export const DOCUMENT_VERSION = 'change-evaluation-gate/observation/1';

/**
 * The three exit statuses, in the `diff`/`grep` shape a shell and an agent
 * already know: `0` nothing wrong, `1` a real answer that is not good news,
 * `2` the command could not run at all.
 *
 * A clone that is `broken`, and a confirmation this clone refused, are NOT
 * failed invocations. Conflating the two would make every agent parse prose to
 * recover the difference, which is the whole reason this surface states it in
 * the exit status.
 */
export const EXIT_OBSERVED = 0;

export const EXIT_UNHEALTHY = 1;

export const EXIT_UNRUNNABLE = 2;

/**
 * Every command this surface performs. All of them but `status`, `check`, and
 * `doctor` preview by default; those three observe, and have nothing to
 * confirm.
 */
export const COMMANDS = Object.freeze([
  'activate',
  'status',
  'history',
  'check',
  'doctor',
  'locks',
  'prune',
  'repair',
  'update',
  'deactivate',
  'uninstall',
  'cleanup',
  'bypass',
  'sync',
]);

/**
 * The selector each command's confirmation arrives on.
 *
 * `locks` uses `--recover` and `prune` uses `--confirm` because those are the
 * two spellings the seams themselves already publish as their `action`
 * (`inspectCoordination` returns `gate locks --recover`; `previewEvidencePrune`
 * returns `gate prune --confirm`). Naming them anything else here would make the
 * command a clone reports differ from the command it accepts.
 *
 * `status` is absent deliberately: reconciliation has nothing to confirm, and
 * it is the one command that must still record nothing at all. `check` is
 * absent for the same reason it has no preview/confirm pair: it evaluates and
 * reports, and mutates nothing under the clone (`TB-061`). `doctor` observes
 * this machine and writes nothing under the clone at all (`TB-063`).
 */
export const CONFIRMABLE_COMMANDS = Object.freeze({
  activate: '--confirm',
  locks: '--recover',
  prune: '--confirm',
  repair: '--confirm',
  update: '--confirm',
  deactivate: '--confirm',
  uninstall: '--confirm',
  cleanup: '--confirm',
  bypass: '--confirm',
  sync: '--confirm',
});

/**
 * Every mutating selector this surface still refuses, and the operation that
 * owns it.
 *
 * `TB-040` stated these as data precisely so a later slice could move entries
 * OUT of them as it implemented each one, rather than growing a second parser
 * beside them. `TB-041` moved `--recover`, `--confirm`, `--confirmation`, and
 * `--token` out and made `repair` a first-class command, so `--repair` is no
 * longer a selector anything owns: it is refused like any other selector no
 * command takes (`TB-050`). What is left belongs to `gate fix`, whose risk
 * profile is a different contract's.
 */
export const CONFIRMED_SELECTORS = Object.freeze({
  '--fix': 'gate fix',
});

/**
 * Every lifecycle operation that mutates and that this surface does NOT
 * perform, named so a refusal can point at it.
 *
 * `TB-042` moved `activate` OUT of this table and into the command registry,
 * once the three behaviors `runActivation` left abstract had real
 * implementations and the trust question was settled by dispatching on the
 * model each adapter already declares. What is left is `gate fix`, which mutates
 * a maintainer's working tree — a different risk profile, and its own contract.
 */
export const CONFIRMED_COMMANDS = Object.freeze({
  fix: 'gate fix',
});

/**
 * Flags that no operation on this surface owns, because nothing here can be
 * forced. They are refused rather than ignored: a `--force` that is silently
 * accepted teaches a caller that forcing is available, and no token on this
 * surface may be bypassed by any of them.
 */
export const UNOWNED_MUTATION_FLAGS = Object.freeze(['--force', '-f', '--yes', '-y', '--no-confirm']);

/** A confirmation token, in the one shape every preview in this skill produces. */
export const CONFIRMATION_TOKEN = /^sha256:[0-9a-f]{64}$/;

/** The selectors each command accepts, and how each one is read. */
export const SELECTORS = Object.freeze({
  activate: Object.freeze({
    '--client': 'value',
    '--actor': 'value',
    '--resume': 'value',
    '--consent-channel': 'value',
    '--confirm': 'confirmation',
  }),
  status: Object.freeze({}),
  history: Object.freeze({ '--limit': 'value', '--evidence': 'value', '--blob': 'value' }),
  // The index instead of the working tree. A flag, because the scope is one of
  // exactly two, and neither is inferred from the other (`TB-061`).
  check: Object.freeze({ '--staged': 'flag' }),
  // Observation only: nothing to select and nothing to confirm (`TB-063`).
  doctor: Object.freeze({}),
  locks: Object.freeze({ '--recover': 'confirmation' }),
  prune: Object.freeze({
    '--evaluation': 'repeatable',
    '--before': 'value',
    '--reclaim': 'value',
    '--confirm': 'confirmation',
  }),
  repair: Object.freeze({ '--hook-script': 'value', '--consent-channel': 'value', '--confirm': 'confirmation' }),
  update: Object.freeze({ '--confirm': 'confirmation' }),
  deactivate: Object.freeze({ '--consent-channel': 'value', '--confirm': 'confirmation' }),
  uninstall: Object.freeze({ '--asset': 'repeatable', '--confirm': 'confirmation' }),
  cleanup: Object.freeze({ '--confirm': 'confirmation' }),
  bypass: Object.freeze({
    '--reason': 'value',
    '--reference': 'value',
    '--actor': 'value',
    '--confirm': 'confirmation',
  }),
  // A flag, because what it says is only ever "yes": the weakening it
  // acknowledges is named by the preview and bound by the token (`TB-062`).
  sync: Object.freeze({
    '--acknowledge-weakening': 'flag',
    '--consent-channel': 'value',
    '--confirm': 'confirmation',
  }),
});

/**
 * The parsed field each value selector is read into — the inverse of the
 * `if (argument === '--…')` ladder in `parseArguments`, stated once so the
 * instruction a preview prints is derived from what the parser READ and never
 * from a second look at the argument vector (`TB-053`).
 */
export const SELECTOR_FIELDS = Object.freeze({
  '--limit': 'historyLimit',
  '--evidence': 'evidenceId',
  '--blob': 'blobId',
  '--client': 'client',
  '--actor': 'actor',
  '--resume': 'resume',
  '--evaluation': 'evaluationIds',
  '--before': 'appendedBefore',
  '--reclaim': 'reclaimBytes',
  '--hook-script': 'hookScript',
  '--asset': 'assets',
  '--reason': 'reason',
  '--reference': 'reference',
  '--acknowledge-weakening': 'acknowledgeWeakening',
  '--staged': 'staged',
  '--consent-channel': 'consentChannel',
});

/** What every removal path on this surface preserves, in the seams' own words. */
export const DEACTIVATION_PRESERVES = Object.freeze([
  'shared-configuration',
  'project-installed-assets',
  'global-assets',
  'historical-evidence',
]);

export const UNINSTALL_PRESERVES = Object.freeze([
  'shared-configuration',
  'global-assets',
  'historical-evidence',
]);

/** The gate this surface speaks for; one name, stated once. */
export const GATE_ID = 'change-evaluation-gate';
