import { cloneShortcut } from '../../activation-seams.mjs';
import { configurationIdentity, recoverTrustedConfiguration } from '../../activation.mjs';
import { composeArguments } from '../../command-descriptor.mjs';
import { CONFIGURATION_FILE, gateChecksFromConfiguration } from '../../configuration.mjs';
import { unversionedGraderSurfaces } from '../../grader-surface.mjs';
import { observeControlSurface, pinnedRunners, resolveConfiguration } from '../../hook-runner.mjs';
import { statusGate } from '../../lifecycle.mjs';
import { observedAdapters, resolveClone } from '../clone.mjs';
import { committedConfiguration } from './sync.mjs';
import { runGit } from '../git.mjs';
import { nextRemedies } from '../../remedies.mjs';
import { listPathChanges } from '../../snapshot.mjs';
import path from 'node:path';

/**
 * The Gate control surface of an activated clone, observed exactly as the
 * runners observe it before every evaluation.
 *
 * The same `observeControlSurface`, over the same configuration read and the
 * same runner pinning, so status and the next commit can never disagree about
 * whether this clone drifted: one observation, two readers (`TB-060`). Pinning
 * re-observes each executable with a single `access(2)` and composes each
 * argument vector in-process; no pinned program is started and nothing is
 * written. A pin the runners would refuse resolves nothing here, and the
 * descriptor surface then reports the drift the commit would be denied for.
 */
export const observeStatusControlSurface = async ({ repositoryRoot, receipt }) => {
  const configuration = await resolveConfiguration(repositoryRoot);
  const { checks } = configuration.ok
    ? gateChecksFromConfiguration(configuration.configuration)
    : { checks: [] };
  const runners = await pinnedRunners(checks, { receipt, compose: composeArguments });
  const surface = await observeControlSurface({
    activation: { receipt },
    configuration,
    resolved: runners.ok ? runners.resolved : new Map(),
  });

  return { ...surface, configuration, checks };
};

/**
 * The Gate configuration section as values: the one this clone declares, and
 * on an activated clone the one its Activation receipt pinned (`TB-068`,
 * `GAP-005`).
 *
 * The receipt pins the section's identity, not the section, so the pinned
 * values are recovered by the rule `gate sync` already judges a transition
 * with (`recoverTrustedConfiguration`): the receipt itself when a sync wrote
 * it, else the file when its identity never moved, else the committed
 * `.agent-framework.yaml` at `HEAD` — and only from a document that
 * reproduces the pinned identity. Anything else is reported as the identity
 * alone, `source` and `policy` null, never guessed. Git is only read. The
 * section holds names and limits, never a Sensitive runtime value.
 */
const observeConfigurationSection = async ({ repositoryRoot, receipt, configuration }) => {
  const working = configuration.ok
    ? { schemaVersion: configuration.configuration?.schema_version ?? null, policy: configuration.policy }
    : null;
  const pinned = receipt === null
    ? null
    : (recoverTrustedConfiguration({
      prior: receipt,
      trusted: working === null ? null : { ...working, source: 'configuration-file' },
    }) ?? recoverTrustedConfiguration({ prior: receipt, trusted: await committedConfiguration(repositoryRoot) }));

  return {
    working: {
      resolved: configuration.ok,
      reasonCode: configuration.ok ? null : configuration.reasonCode,
      detail: configuration.ok ? null : configuration.detail,
      identity: working === null ? null : configurationIdentity(working),
      policy: working?.policy ?? null,
    },
    pinned: receipt === null ? null : {
      identity: receipt.configuration?.identity ?? null,
      source: pinned?.source ?? null,
      policy: pinned?.policy ?? null,
    },
  };
};

/**
 * The declared Grader surfaces of this clone that Git does not track, asked of
 * the same status parse and the same classification every evaluation uses, so
 * status and the next decision cannot disagree about which surfaces are
 * unversioned (`TB-066`). Git is asked without optional locks, so not even its
 * opportunistic index refresh writes anything: status goes on recording
 * nothing at all.
 */
const observeUnversionedSurfaces = async ({ repositoryRoot, checks }) => unversionedGraderSurfaces({
  untrackedPaths: (await listPathChanges(
    repositoryRoot,
    'worktree',
    (root, args) => runGit(root, ['--no-optional-locks', ...args]),
  )).untracked,
  checks,
});

/**
 * Say which file moved when the trusted configuration drifted.
 *
 * The receipt pins an identity, not a document, so no diff is available; what
 * is known is that the file on disk no longer produces the identity activation
 * pinned, and that every evaluation is graded against the pinned policy until
 * an Activation transaction pins this one. The finding's code and severity are
 * unchanged; the command that re-pins it is named once, by the `next:` line,
 * from the one remedy table (`TB-065`).
 */
export const namedConfigurationDrift = (finding, { repositoryRoot, configuration }) => {
  if (finding.code !== 'control-surface-drift' || finding.surface !== 'trusted-configuration') {
    return finding;
  }

  return {
    ...finding,
    path: path.join(repositoryRoot, CONFIGURATION_FILE),
    detail: [
      finding.detail,
      `${CONFIGURATION_FILE} changed since this clone was activated, and every evaluation is graded against the policy the receipt pinned, not the file, until an Activation transaction re-pins it.`,
      ...(configuration.ok ? [] : [`It no longer resolves to a Gate policy at all: ${configuration.detail}`]),
    ].join(' '),
  };
};

/**
 * `gate status` — reconcile desired against actual state and report it.
 *
 * A clone with no receipt has nothing to open and nothing to reconcile, so no
 * store is opened for it. `statusGate` already answers that case from a null
 * store, and it is the one that answers it here. This is the only command with
 * no confirmed form, and it must go on recording nothing at all.
 *
 * An activated clone is reconciled against the whole control surface the
 * receipt pinned — the configuration included — and not only its adapter
 * registrations, which is what let a status report `healthy` over a policy the
 * next commit was denied for (`NFR-SEC-004`, `AC-SEC-001`, `TB-060`).
 */
export const operateStatus = async ({ repositoryRoot, environment }) => {
  const clone = await resolveClone({
    repositoryRoot,
    environment,
    command: 'status',
    receiptRequired: false,
    // A clone that was never activated is never given a store by the act of
    // being looked at.
    wantStore: 'when-activated',
  });

  if (clone.failed) {
    return clone.failed;
  }

  const surface = clone.receipt === null
    ? null
    : await observeStatusControlSurface({ repositoryRoot, receipt: clone.receipt });
  const status = await statusGate({
    evidenceStore: clone.store,
    repositoryRoot,
    adapters: clone.receipt === null ? null : observedAdapters(clone.receipt),
    controlSurface: surface?.observed ?? null,
    unversionedGraderSurfaces: surface === null
      ? null
      : await observeUnversionedSurfaces({ repositoryRoot, checks: surface.checks }),
  });
  const findings = surface === null
    ? status.findings
    : status.findings.map((finding) => namedConfigurationDrift(finding, {
      repositoryRoot,
      configuration: surface.configuration,
    }));
  const shortcut = await cloneShortcut({ repositoryRoot, runGit: (args) => runGit(repositoryRoot, args) });

  return {
    command: 'status',
    healthy: status.status === 'healthy',
    observation: {
      state: status.state,
      health: status.status,
      release: status.release,
      receiptId: status.receipt?.receiptId ?? null,
      repaired: status.repaired,
      mutations: status.mutations,
      findings,
      // What was observed, and which pinned surfaces it no longer matches.
      controlSurface: surface === null ? null : {
        observed: surface.observed,
        drifted: findings
          .filter((finding) => finding.code === 'control-surface-drift')
          .map((finding) => finding.surface),
      },
      configuration: await observeConfigurationSection({
        repositoryRoot,
        receipt: clone.receipt,
        configuration: surface?.configuration ?? await resolveConfiguration(repositoryRoot),
      }),
      next: nextRemedies(findings, shortcut),
    },
    mutation: null,
  };
};
