/** The document an agent parses. Versioned, so a later field is an addition rather than a surprise. */
export const DOCUMENT_VERSION = 'agent-framework/setup/1';

/** The `config show` document, versioned the same way. */
export const CONFIG_DOCUMENT_VERSION = 'agent-framework/config-show/1';

/** The `config suggest` document, versioned the same way. */
export const SUGGEST_DOCUMENT_VERSION = 'agent-framework/config-suggest/1';

/** The `config <revision>` document, versioned the same way. */
export const REVISION_DOCUMENT_VERSION = 'agent-framework/config-revision/1';

/** The `guardrail` document, versioned the same way. */
export const GUARDRAIL_DOCUMENT_VERSION = 'agent-framework/guardrail/1';

export const EXIT_DONE = 0;

export const EXIT_STEPS_REMAIN = 1;

export const EXIT_UNRUNNABLE = 2;

/**
 * The Gate's own selector that acknowledges a weakening its re-pin preview
 * names, and the refusal that preview gives a weaker candidate without it.
 * Passed through and reported, never judged here (`SG-CFG-001`).
 */
export const ACKNOWLEDGE_WEAKENING = '--acknowledge-weakening';

export const WEAKENING_UNACKNOWLEDGED = 'weakening-unacknowledged';

/**
 * How guided setup performs a planned step, kept on the step under a symbol so
 * that no plan document — text or `--json` — changes by a byte (`TB-072`).
 * `kind` is `unpreviewed`, `migration`, `gate-configuration`, `doctor`, or
 * `gate` with the Gate subcommands the step names, in order.
 */
export const PERFORM = Symbol('perform');

/** The guided run's record, returned in-process to the caller that drove it. */
export const GUIDED_DOCUMENT_VERSION = 'agent-framework/setup-guided/1';

export const REPORT_LIMIT = 'report writes one static HTML file, only outside the clone and never over an existing file; it changes nothing under the clone, confirms nothing, and shows a Sensitive runtime input by name and source only.';
