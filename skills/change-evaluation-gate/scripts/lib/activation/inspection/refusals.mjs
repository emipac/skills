import { unreportableSurface } from '../../adapters.mjs';

/**
 * The refusal step 1 makes of a request's scope and trigger, or `null`.
 *
 * v1 activation is always clone-local: there is no global activation to opt
 * into, so there is nothing for a machine-wide install to switch on. And
 * installing assets or running setup is not consent: a package or plugin
 * lifecycle can never activate the gate (FR-LIFE-004).
 */
export const entryRefusal = (request) => {
  const scope = request.scope ?? 'repository';

  if (scope !== 'repository') {
    return {
      step: 'repository-identity',
      reasonCode: scope === 'global' ? 'activation-scope-global' : 'activation-scope-unsupported',
      errors: [{ scope }],
    };
  }

  if ((request.trigger ?? 'explicit') !== 'explicit') {
    return {
      step: 'repository-identity',
      reasonCode: 'activation-trigger-prohibited',
      errors: [{ trigger: request.trigger }],
    };
  }

  return null;
};

/**
 * The refusal step 2 makes: a selected preflight surface that could not answer
 * anything it evaluated (`TB-048`).
 *
 * Whether a surface can answer is the adapter's own declared data, asked of
 * `unreportableSurface`; this names no client. It is asked of the whole
 * selection at the preview, before consent is read and long before anything is
 * registered, so a selection holding one such surface registers nothing at all
 * and offers nothing to confirm (`AC-LIFE-009`, `SG-HOOK-001`). Authoritative
 * Git is never refused here: it answers by blocking.
 */
export const unreportableAdapterRefusal = (adapters = []) => {
  const refused = adapters
    .map((adapter) => unreportableSurface(adapter?.id ?? null))
    .filter((entry) => entry !== null);

  return refused.length === 0
    ? null
    : {
      step: 'preview',
      reasonCode: refused[0].reasonCode,
      errors: refused.map((entry) => ({
        adapter: entry.adapterId,
        absence: entry.absence,
        message: `${entry.detail} It is not registered; it stays declared and testable until a real client invocation shows how it answers.`,
      })),
    };
};

/** The refusal step 4 makes: a logical runner no platform executable was found for (FR-CFG-004). */
export const runnerResolutionRefusal = (described) => (described.runners.unresolved.length > 0
  ? { step: 'runner-resolution', reasonCode: 'runner-unresolved', errors: described.runners.unresolved }
  : null);

/**
 * The refusal step 6 makes: the existing hook chain decides whether activation
 * may proceed at all. Nothing here rewrites, relocates, or takes over a hook.
 */
export const hookChainRefusal = (described) => (described.hook.reasonCode !== null
  ? { step: 'hook-chain-validation', reasonCode: described.hook.reasonCode, errors: described.hook.errors }
  : null);
