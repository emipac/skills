/**
 * What recovers each drift and finding the Gate reports — the one remedy table.
 *
 * Every place the Gate tells a maintainer what to run renders through this
 * module: `gate status`'s `next:` line, `gate repair`'s and `gate sync`'s
 * refusals, the `integrity-drift` diagnostic `evaluate` composes, and the
 * runner-pin denials both runners raise. Five copies of one inline sentence is
 * what once let that sentence name `gate repair` for drift `gate repair`
 * cannot touch, in five places at once (`NFR-OPER-001`, `TB-065`).
 *
 * It is a leaf: it imports nothing that evaluates, activates, or observes, so
 * the runners, `evaluate`, and the operator surface all reach it without the
 * operator surface importing a runner or a runner importing the operator
 * surface. It names commands; it never runs one, and nothing here repairs,
 * re-pins, or writes (`FR-LIFE-019`, `SG-LIFE-001`).
 */

import { CONFIGURATION_FILE } from './configuration.mjs';

/**
 * What recovers each finding and reason code — or the explicit marker that
 * nothing needs recovering.
 *
 * One entry per finding code `gate status` can report, one per control surface
 * for `control-surface-drift` (whose code every surface shares), and one per
 * runner-pin reason code the runners deny with. The lines follow
 * `FR-LIFE-019`: a gate-owned Git registration is restored by `gate repair`,
 * which repairs exactly those three findings and nothing else (`AC-LIFE-010`);
 * what the receipt pinned from `.agent-framework.yaml` — the policy's identity,
 * the commands it resolves to, and the executable each is pinned to — is
 * re-pinned by `gate sync`, the Activation transaction that keeps the adapter
 * set (`TB-062`); everything else the receipt pinned is re-established by a
 * new Activation transaction. A code or surface with no entry is a test
 * failure, never a default (`TB-060`, `TB-065`).
 */
export const REMEDIES = Object.freeze({
  // An installed clone holds no Gate policy: nothing is enforced, and adopting
  // the Gate is a choice, not a fault.
  'configuration-missing': 'informational',
  'gate-policy-missing': 'informational',
  'repository-unresolved': 'informational',
  'configuration-unreadable': 'correct-configuration',
  'gate-policy-invalid': 'correct-configuration',
  'activation-absent': 'activate',
  'hook-absent': 'repair',
  'hook-block-tampered': 'repair',
  'hook-receipt-mismatch': 'repair',
  // Adapter loss is a reinstall, not a repair (`RISK-004`): a new Activation
  // transaction pins the adapter set this installed gate declares.
  'authoritative-adapter-lost': 'activation-transaction',
  'adapter-lost': 'activation-transaction',
  'adapter-registration-absent': 'activation-transaction',
  'adapter-registration-unverified': 'activation-transaction',
  // Deactivation refuses a client entry that changed underneath it, and the
  // Gate never overwrites a client's own file.
  'adapter-registration-drifted': 'reconcile-client-registration',
  'adapter-registration-ambiguous': 'reconcile-client-registration',
  'control-surface-drift': Object.freeze({
    runtime: 'activation-transaction',
    adapters: 'activation-transaction',
    'managed-hooks': 'repair',
    receipt: 'activation-transaction',
    // Both are pinned from the configuration file, and a sync re-pins both.
    'trusted-configuration': 'sync',
    'command-descriptors': 'sync',
    providers: 'activation-transaction',
  }),
  // A runner pin is part of what the receipt pinned from the configuration: a
  // sync re-resolves every declared check and pins what it finds, and never
  // silently substitutes one program for another (`NFR-REL-003`).
  'runner-unpinned': 'sync',
  'runner-pin-drift': 'sync',
});

/** The order remedies are performed in when a clone needs more than one. */
const REMEDY_ORDER = Object.freeze([
  'correct-configuration',
  'reconcile-client-registration',
  'repair',
  'sync',
  'activation-transaction',
  'activate',
]);

/** What every recovery that writes on this clone leaves exactly as it found. */
const KEPT = `keeps ${CONFIGURATION_FILE} and all historical Evidence`;

/**
 * One remedy, as a maintainer is told it, through `command` — the clone's own
 * shortcut where activation recorded one, `gate` otherwise.
 *
 * A new Activation transaction is the deactivate/activate pair; each half
 * previews and prints its own token. `gate sync` is the scoped one that keeps
 * the adapter set (`TB-062`). Each recovery that writes states what survives
 * it, because a maintainer who hesitates over an instruction does not follow
 * it.
 */
export const remedyInstruction = (remedy, command = 'gate') => ({
  'correct-configuration': `correct ${CONFIGURATION_FILE} so its evaluation_gate policy reads and validates`,
  'reconcile-client-registration': `reconcile the changed client registration by hand — the Gate never overwrites a client's own file — and run ${command} status again`,
  repair: `${command} repair — it restores only the gate-owned Git registration the Activation receipt pins, and ${KEPT}`,
  sync: `${command} sync — a new Activation transaction that re-pins the configuration and the commands it resolves to under the adapters this clone already has; it previews first, writes only the receipt, and ${KEPT}`,
  'activation-transaction': `${command} deactivate, then ${command} activate — a new Activation transaction that pins what this clone declares now; each previews first and prints the token that confirms it, and each ${KEPT}`,
  activate: `${command} activate`,
})[remedy] ?? null;

/** The remedy recorded for one finding or reason code, or `null` when none is. */
export const remedyFor = ({ code, surface } = {}) => {
  const entry = REMEDIES[code] ?? null;

  return typeof entry === 'string' ? entry : (entry?.[surface] ?? null);
};

/**
 * What a maintainer does next about everything reported, in the order it has
 * to be done, through the clone's own shortcut where activation recorded one.
 * Nothing to act on says `nothing`.
 *
 * `findings` are `{ code, surface? }`: a status finding, a control-surface
 * drift finding, or a runner's reason code.
 */
export const nextRemedies = (findings, shortcut = null) => {
  const command = shortcut ?? 'gate';
  const informational = [];
  const byRemedy = new Map();

  for (const finding of findings) {
    const remedy = remedyFor(finding);

    if (remedy === 'informational') {
      informational.push(finding.code);

      continue;
    }

    // Unreachable while the fixture enumerating every code holds; stated
    // rather than silently dropped if it ever does not.
    const key = remedy ?? `unrecorded:${finding.code}`;

    byRemedy.set(key, [...(byRemedy.get(key) ?? []), finding.surface === undefined ? finding.code : `${finding.code}:${finding.surface}`]);
  }

  // A new Activation transaction pins the configuration too, and a sync
  // refuses a clone whose adapter set or receipt changed, so where both are
  // needed the pair alone is named and answers for both.
  if (byRemedy.has('sync') && byRemedy.has('activation-transaction')) {
    byRemedy.set('activation-transaction', [...byRemedy.get('activation-transaction'), ...byRemedy.get('sync')]);
    byRemedy.delete('sync');
  }

  const rank = (remedy) => (REMEDY_ORDER.includes(remedy) ? REMEDY_ORDER.indexOf(remedy) : REMEDY_ORDER.length);
  const remedies = [...byRemedy.entries()]
    .sort(([left], [right]) => rank(left) - rank(right))
    .map(([remedy, codes]) => ({
      remedy,
      instruction: remedyInstruction(remedy, command) ?? `no remedy is recorded for ${codes.join(', ')}; read its finding above`,
      findings: codes,
    }));

  return {
    instruction: remedies.length === 0 ? 'nothing' : remedies.map((remedy) => remedy.instruction).join('; then '),
    shortcut,
    remedies,
    informational,
  };
};
