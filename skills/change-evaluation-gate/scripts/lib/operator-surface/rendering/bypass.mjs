import { line, renderConfirmation } from './shared.mjs';

/** Why a preview offers no token, in the policy's own rejection words. */
const BYPASS_REFUSALS = Object.freeze({
  'bypass-disabled': 'this clone\'s Gate policy disables bypass; nothing can be granted',
  'marker-unconfigured': 'this clone\'s Gate policy enables bypass with no commit-visible marker; nothing can be granted',
  'reason-missing': 'name the reason with --reason <text>',
  'reference-missing': 'this clone\'s Gate policy requires a reference; name it with --reference <ref>',
});

export const renderBypass = (observation, document) => [
  line('bypass policy', `${observation.policy.enabled ? 'enabled' : 'disabled'} (marker ${observation.policy.marker ?? 'none'}, reference ${observation.policy.requireReference ? 'required' : 'optional'})`),
  line('snapshot', observation.snapshotId),
  line('staged paths', observation.changedPaths.length),
  ...observation.changedPaths.map((changed) => `  - ${changed}`),
  line('reason', observation.grant.reason ?? 'none'),
  line('reference', observation.grant.reference ?? 'none'),
  line('actor', observation.grant.actor === null ? 'none' : `${observation.grant.actor.name} (${observation.grant.actor.source})`),
  line('pending grant', observation.pending === null ? 'none' : `${observation.pending.snapshotId} (${observation.pending.requestedAt})`),
  line('grantable', observation.grantable),
  observation.grantable
    ? renderConfirmation('bypass', observation, document)
    : line('next', BYPASS_REFUSALS[observation.rejectionCode] ?? `nothing to grant (${observation.rejectionCode})`),
];
