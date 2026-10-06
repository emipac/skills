import { SELF_DECLARED } from '../../activation-seams.mjs';
import { contentIdentity } from '../../evidence-store.mjs';
import { createExecutionRoot, releaseExecutionRoot, resolveConfiguration } from '../../hook-runner.mjs';
import { resolveClone } from '../clone.mjs';
import { runGit } from '../git.mjs';
import { instructionSelectors, mismatchExplanation } from '../instructions.mjs';
import { failure, mutation, recordSurfaceRefusal } from '../outcomes.mjs';
import { BYPASS_GRANT_VERSION, bypassGrantFrom, resolveBypass } from '../../policy.mjs';
import { captureSnapshot } from '../../snapshot.mjs';

/**
 * The identity of the staged snapshot as a commit would create it.
 *
 * Learned the way the authoritative runner learns it and by nothing else: the
 * index is materialized through `captureSnapshot` into a fresh execution root
 * under the runners' own lifecycle, its identity is read back from that root,
 * and the root is released. No declared dependency root is provided — a
 * provided root is outside the identity by construction (`SG-EVAL-001`), so
 * the identity this reads is the identity the hook will compute for the same
 * index, and a grant bound to it binds to exactly the tree the commit grades
 * (`FR-POL-006`, `NFR-REL-001`).
 */
const stagedSnapshotIdentity = async (repositoryRoot) => {
  const executionRoot = await createExecutionRoot('gate-bypass-exec-');

  try {
    const captured = await captureSnapshot({
      repositoryRoot,
      kind: 'git-index',
      executionRoot,
      runGit,
    });

    return captured.captured === true
      ? { ok: true, snapshotId: captured.snapshot.id, changedPaths: captured.changedPaths }
      : { ok: false, reasonCode: captured.reasonCode, detail: captured.detail };
  } finally {
    await releaseExecutionRoot(executionRoot);
  }
};

/**
 * `gate bypass` — grant one one-shot bypass of the staged snapshot, in two
 * invocations.
 *
 * Until `TB-052` the bypass subcontract was inert: `resolveBypass` refused
 * without a grant, and nothing a maintainer could run ever produced one. A
 * policy that read `enabled: true` changed nothing and said nothing. This is
 * where a grant comes from, and the only place: an explicit operator act, in
 * its own process, before the commit, bound to the exact snapshot that commit
 * would create. The authoritative runner reads the grant once and spends it.
 *
 * The preview applies the policy's OWN bypass rule to the grant it would write
 * — `resolveBypass`, with no ledger to consume and no decision to bypass — so
 * a disabled policy, an unconfigured marker, a missing reason, or a missing
 * policy-required reference is refused here by the code the hook would refuse
 * it with, rather than by a second copy of the rule kept on this surface
 * (`SG-BYP-001`). What cannot be known before the commit is not claimed: which
 * checks fail is decided when the commit is graded, and a commit that passes
 * on its own is `nothing-to-bypass` then.
 *
 * The confirmation token binds the snapshot identity, so staging anything
 * between the preview and the confirmation refuses the confirmation. The grant
 * binds the same identity, so staging anything between the grant and the
 * commit refuses the grant as `snapshot-mismatch` (`FR-POL-006`).
 */
export const operateBypass = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const configuration = await resolveConfiguration(repositoryRoot);

  if (!configuration.ok) {
    return failure({
      command: 'bypass',
      reasonCode: configuration.reasonCode,
      detail: `${configuration.detail} A bypass is granted against this clone's own Gate policy, and there is none to grant it against.`,
    });
  }

  const clone = await resolveClone({ repositoryRoot, environment, command: 'bypass' });

  if (clone.failed) {
    return clone.failed;
  }

  const staged = await stagedSnapshotIdentity(repositoryRoot);

  if (!staged.ok) {
    return failure({
      command: 'bypass',
      reasonCode: staged.reasonCode,
      detail: `the staged snapshot could not be identified, so no grant can bind to it: ${staged.detail}`,
    });
  }

  const policy = configuration.policy;
  const requested = {
    snapshotId: staged.snapshotId,
    actor: selector.actor,
    reason: selector.reason,
    reference: selector.reference,
  };
  // The policy's own rule, applied to the grant this invocation would write.
  // `outcome: null` is "not yet graded": the only rejection it cannot produce
  // is `nothing-to-bypass`, which belongs to the commit.
  const resolved = resolveBypass({
    grant: { ...requested, requestedAt: null },
    policy,
    snapshotId: staged.snapshotId,
    outcome: null,
    checks: [],
    ledger: null,
  });
  const grantable = resolved?.applied === true;
  const pending = bypassGrantFrom(await clone.store.bypassGrant().read().catch(() => null));
  const observation = {
    state: 'activated',
    policy: {
      enabled: policy?.bypass?.enabled === true,
      requireReference: policy?.bypass?.require_reference === true,
      marker: policy?.bypass?.marker ?? null,
    },
    snapshotId: staged.snapshotId,
    changedPaths: staged.changedPaths,
    grant: {
      reason: resolved?.reason ?? null,
      reference: resolved?.reference ?? null,
      // Carried, never asserted. See `SELF_DECLARED`.
      actor: selector.actor === null ? null : { name: selector.actor, source: SELF_DECLARED },
    },
    grantable,
    rejectionCode: grantable ? null : (resolved?.rejectionCode ?? null),
    // A grant already waiting for the next commit, if any. A confirmation here
    // replaces it: there is one pending grant per clone, never a queue.
    pending: pending === null
      ? null
      : { snapshotId: pending.snapshotId, reason: pending.reason, requestedAt: pending.requestedAt },
    confirmationToken: grantable
      ? contentIdentity({
        operation: 'bypass',
        snapshotId: staged.snapshotId,
        reason: resolved.reason,
        reference: resolved.reference,
        actor: selector.actor,
        marker: resolved.marker,
        requireReference: policy?.bypass?.require_reference === true,
        configurationIdentity: clone.receipt?.configuration?.identity ?? null,
      })
      : null,
  };

  if (confirmation === null) {
    return { command: 'bypass', healthy: grantable, observation, mutation: null };
  }

  const refuse = async (reasonCode, summary) => {
    await recordSurfaceRefusal({
      evidenceStore: clone.store,
      type: 'bypass',
      before: staged.snapshotId,
      reason: `${reasonCode}: ${summary}`,
    });

    return {
      command: 'bypass',
      healthy: false,
      observation,
      mutation: mutation({ confirmation, performed: false, reasonCode, summary }),
    };
  };

  if (!grantable) {
    return refuse(
      observation.rejectionCode,
      `Nothing was granted (${observation.rejectionCode}): this clone's Gate policy refuses the bypass this invocation asked for, and a confirmation cannot change that.`,
    );
  }

  if (confirmation !== observation.confirmationToken) {
    return refuse(
      'preview-mismatch',
      `Nothing was granted (preview-mismatch): ${mismatchExplanation('bypass', instructionSelectors('bypass', selector))}`,
    );
  }

  const requestedAt = new Date().toISOString();
  const identified = resolveBypass({
    grant: { ...requested, requestedAt },
    policy,
    snapshotId: staged.snapshotId,
    outcome: null,
    checks: [],
    ledger: null,
  });
  // The five identity fields are stored exactly as the identity was computed
  // over them, so the id the hook derives from this file is `grantId`.
  const grant = {
    grantVersion: BYPASS_GRANT_VERSION,
    grantId: identified.id,
    snapshotId: staged.snapshotId,
    actor: selector.actor,
    reason: selector.reason,
    reference: selector.reference,
    requestedAt,
    marker: identified.marker,
  };

  await clone.store.bypassGrant().write(grant);
  await clone.store.appendLifecycleEvent({
    type: 'bypass',
    before: staged.snapshotId,
    after: grant.grantId,
    outcome: 'succeeded',
    reason: `A one-shot bypass grant was written for snapshot ${staged.snapshotId}; it is spent by the next commit attempt, and applies only if that commit grades exactly this snapshot.`,
  });

  return {
    command: 'bypass',
    healthy: true,
    observation: { ...observation, pending: { snapshotId: grant.snapshotId, reason: grant.reason, requestedAt } },
    mutation: mutation({
      confirmation,
      performed: true,
      grantId: grant.grantId,
      snapshotId: grant.snapshotId,
      marker: grant.marker,
      summary: `One one-shot bypass grant ${grant.grantId} was written for snapshot ${grant.snapshotId}${pending === null ? '' : ', replacing the grant that was pending'}. The next commit attempt spends it: if it grades exactly this snapshot and would otherwise be denied, the commit proceeds as bypassed — never passed — with every failed check preserved, and the marker ${JSON.stringify(grant.marker)} is printed for the commit message. Stage anything else and it is refused as snapshot-mismatch.`,
    }),
  };
};
