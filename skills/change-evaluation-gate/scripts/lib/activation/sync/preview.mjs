import { adapterIdentity, configurationIdentity, repositoryIdentity } from '../identities.mjs';
import { pinnedRunnerEntries, receiptBodyOf, recoverTrustedConfiguration } from '../receipts.mjs';
import { keptAdapterRegistrations, keptHookRegistration } from './reconciliation.mjs';
import { describeAdapter } from '../../adapters.mjs';
import { createRunnerResolver, resolveExecutables } from '../../command-descriptor.mjs';
import { contentIdentity, resolveGitCommonDirectory } from '../../evidence-store.mjs';
import { evaluatePolicyTransition } from '../../security-control.mjs';
import { recordedProvisioning } from '../../snapshot.mjs';

/**
 * Why a sync preview offers no token, in the order a reader has to act on them.
 * Every one is a refusal the transaction repeats if it is confirmed anyway.
 */
const syncRefusal = ({
  receiptIntact, trusted, adapterSetChanged, hook, registrations, changed, transition, acknowledged,
}) => {
  // A receipt that no longer reproduces its own identity is receipt drift, and
  // re-pinning on top of it would launder that drift into a fresh receipt.
  if (!receiptIntact) {
    return { reasonCode: 'receipt-drifted', errors: [] };
  }

  if (adapterSetChanged) {
    return { reasonCode: 'adapter-set-changed', errors: [] };
  }

  if (!hook.intact) {
    return { reasonCode: 'hook-registration-drifted', errors: [{ path: hook.path }] };
  }

  if (!hook.reproducible) {
    return { reasonCode: 'hook-registration-not-reproducible', errors: [{ path: hook.path }] };
  }

  const changedRegistrations = registrations.filter((registration) => !registration.intact);

  if (changedRegistrations.length > 0) {
    return {
      reasonCode: 'adapter-registration-changed',
      errors: changedRegistrations.map(({ adapter, path: registrationPath, state, reproducible }) => ({
        adapter, path: registrationPath, state, reproducible,
      })),
    };
  }

  if (!changed) {
    return { reasonCode: 'nothing-to-sync', errors: [] };
  }

  if (trusted === null) {
    return { reasonCode: 'trusted-configuration-unrecoverable', errors: [] };
  }

  if (transition.candidate.valid !== true) {
    return { reasonCode: 'candidate-policy-invalid', errors: transition.candidate.errors };
  }

  if (transition.weakened && !acknowledged) {
    return { reasonCode: 'weakening-unacknowledged', errors: transition.weakenings };
  }

  return null;
};

/**
 * Preview one `gate sync`: re-pin the configuration this clone declares now,
 * under the adapter set its receipt already pins.
 *
 * The preview writes nothing. It states the Trusted identity the receipt
 * pinned, the candidate identity the file produces, what
 * `evaluatePolicyTransition` finds between the two — every way the candidate
 * is weaker than the policy that authorized this clone — the adapters and
 * registrations it keeps, and the commands it would pin. The token is the
 * content identity of all of it, so confirming it approves exactly that
 * candidate, and any weakening it names, by hash (`FR-CFG-005`, `FR-LIFE-004`,
 * `SG-CFG-001`, `TB-062`).
 *
 * `refusal` is derived from the body, never hashed beside it: a preview that
 * refuses offers no token, and a confirmation the transaction receives anyway
 * is refused for the same reason.
 */
export const previewSync = async (request, dependencies = {}) => {
  const prior = request.prior ?? null;
  const {
    runGit,
    environment = process.env,
    resolveExecutable = createRunnerResolver({
      repositoryRoot: request.repository.root,
      environment,
    }),
  } = dependencies;
  const gitCommonDirectory = await resolveGitCommonDirectory({
    repositoryRoot: request.repository.root,
    runGit,
  });
  const runners = resolveExecutables(request.checks ?? [], resolveExecutable);
  const candidate = {
    schemaVersion: request.configuration?.schemaVersion ?? null,
    identity: configurationIdentity(request.configuration),
  };
  const trustedIdentity = prior?.configuration?.identity ?? null;
  const trusted = recoverTrustedConfiguration({
    prior,
    trusted: candidate.identity === trustedIdentity
      ? { ...request.configuration, source: 'configuration-file' }
      : (request.trusted ?? null),
  });
  const transition = evaluatePolicyTransition({
    trusted: { identity: trustedIdentity, policy: trusted?.policy ?? null },
    candidate: { identity: candidate.identity, policy: request.configuration?.policy ?? null },
    checks: request.checks ?? [],
    // Not an evaluation: nothing here may allow or deny a commit.
    role: 'operator',
    approval: null,
  });
  const weakened = trusted !== null && transition.weakened;
  const acknowledged = weakened && request.acknowledgeWeakening === true;
  // The adapter set is the receipt's, and nothing else's. What the installed
  // gate declares under those ids is compared, never substituted: a changed
  // set is `activate` and `deactivate`, not a sync.
  const adapters = (prior?.adapters ?? []).map((adapter) => ({
    id: adapter?.id ?? null,
    version: adapter?.version ?? null,
    authoritative: adapter?.authoritative === true,
  }));
  const declared = adapters.map((adapter) => {
    const declaration = describeAdapter(adapter.id);

    return {
      id: adapter.id,
      version: declaration?.version ?? null,
      authoritative: declaration?.role === 'authoritative',
    };
  });
  const hook = await keptHookRegistration({ prior, request });
  const registrations = await keptAdapterRegistrations({ prior, request });
  const pins = pinnedRunnerEntries(runners.resolved);
  const policy = request.configuration?.policy ?? null;
  const body = {
    operation: 'sync',
    repository: {
      root: request.repository.root,
      gitCommonDirectory,
      identity: repositoryIdentity(gitCommonDirectory),
    },
    receiptId: prior?.receiptId ?? null,
    // The Active gate release is `gate update`'s to move, and a sync keeps it.
    release: prior?.runtime?.gate ?? null,
    trusted: { identity: trustedIdentity, source: trusted?.source ?? null },
    candidate,
    transition: trusted === null ? null : {
      weakened,
      weakenings: transition.weakenings,
      candidateValid: transition.candidate.valid,
    },
    acknowledgedWeakening: acknowledged,
    adapters,
    hook: {
      hook: hook.hook,
      path: hook.path,
      ownership: hook.ownership,
      blockIdentity: hook.blockIdentity,
      receiptId: hook.receiptId,
      action: hook.action,
    },
    adapterRegistrations: registrations.map(({ adapter, path: registrationPath, entryIdentity, state, action }) => ({
      adapter, path: registrationPath, entryIdentity, state, action,
    })),
    commands: runners.resolved.map((entry) => ({
      check_id: entry.check_id,
      role: entry.role,
      runner: entry.runner,
      executable: entry.executable,
      version: entry.version,
      preview: entry.preview,
      working_directory: entry.working_directory,
    })),
    unresolved: runners.unresolved,
    dependencyRoots: [...(policy?.execution?.dependency_roots ?? [])],
    dependencyProvisioning: recordedProvisioning(
      policy?.execution?.dependency_provisioning,
      policy?.execution?.dependency_roots ?? [],
    ),
    runtimeInputs: (request.runtimeInputs ?? []).map((input) => input.name),
  };
  const changed = candidate.identity !== trustedIdentity
    || contentIdentity(pins) !== contentIdentity(prior?.runtime?.runners ?? [])
    || contentIdentity(body.runtimeInputs) !== contentIdentity(prior?.runtimeInputs ?? []);

  return {
    ...body,
    previewId: contentIdentity(body),
    changed,
    refusal: syncRefusal({
      receiptIntact: prior !== null && contentIdentity(receiptBodyOf(prior)) === prior.receiptId,
      trusted,
      adapterSetChanged: adapterIdentity(declared) !== adapterIdentity(adapters),
      hook,
      registrations,
      changed,
      transition,
      acknowledged,
    }),
    // What the transaction judges the approval against. Not hashed: its
    // identity is `trusted.identity`, which is.
    trustedPolicy: trusted?.policy ?? null,
    runnerPins: pins,
  };
};
