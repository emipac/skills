import { ACTIVATION_RECEIPT_VERSION } from '../constants.mjs';
import { selfTestHookProgramDenial } from '../hooks/self-test.mjs';
import { receiptBodyOf, receiptLineageOf } from '../receipts.mjs';
import { previewSync } from './preview.mjs';
import { keptHookRegistration } from './reconciliation.mjs';
import { activationTransaction } from '../transaction.mjs';
import { contentIdentity } from '../../evidence-store.mjs';
import { evaluatePolicyTransition } from '../../security-control.mjs';

/** How a sync's Lifecycle event names what happened. */
const syncEvent = (prior) => (result) => ({
  before: prior?.receiptId ?? null,
  after: result.activated ? result.receipt?.receiptId ?? null : null,
  reason: result.activated
    ? `Sync re-pinned the configuration ${result.receipt?.configuration?.identity ?? 'unknown'} under the adapter set receipt ${prior?.receiptId ?? 'none'} pinned; every registration was kept byte for byte and the receipt was switched last.`
    : `Sync failed at ${result.step} (${result.reasonCode}); ${result.state === 'recovery-required' ? `the clone requires recovery: ${result.rollback.remains.join(' ')}` : `the prior receipt ${prior?.receiptId ?? 'none'} and every registration are exactly as they were.`}`,
});

/**
 * Run one `gate sync` — an Activation transaction scoped to a changed
 * configuration under an adapter set that stays (`FR-LIFE-019`, `TB-062`).
 *
 * It takes the same ordered steps activation takes, runs the same self-tests,
 * and registers nothing: every registration the receipt pins is kept exactly
 * as it is, and a registration that is not what this sync would write refuses
 * the whole sync rather than being rewritten. What changes is the receipt,
 * published by one atomic write and read back; its lineage keeps every earlier
 * id, so the registration that names one stays this activation's. Git was
 * authoritative before and stays authoritative throughout — under the prior
 * receipt until the switch, under the new one after it — and the last step
 * re-confirms the registration the new receipt authorizes.
 *
 * A failure at any step unwinds to the prior receipt, byte for byte, and
 * leaves the clone activated exactly as it was (`AC-LIFE-009`).
 */
export const syncActivation = async (request, dependencies = {}) => {
  const transaction = activationTransaction({
    evidenceStore: dependencies.evidenceStore ?? null,
    restingState: 'activated',
    describeEvent: syncEvent(request.prior ?? null),
  });

  try {
    return await runSync(request, dependencies, transaction);
  } catch (error) {
    return transaction.fail(transaction.currentStep(), 'sync-interrupted', [{ message: error.message }]);
  }
};

const runSync = async (request, dependencies, transaction) => {
  const { journal, order, fail, record } = transaction;
  const {
    establishTrust,
    selfTestEvaluation,
    selfTestAdapter,
    selfTestHookProgram = selfTestHookProgramDenial,
    evidenceStore = null,
    clock = () => new Date(),
  } = dependencies;
  const prior = request.prior ?? null;

  // 1. Repository identity: a sync re-pins the clone its receipt names.
  order.push('repository-identity');

  if (prior === null) {
    return fail('repository-identity', 'activation-absent', [{
      message: 'Only an activated clone has a receipt to re-pin; activate it instead.',
    }]);
  }

  if ((request.trigger ?? 'explicit') !== 'explicit') {
    return fail('repository-identity', 'activation-trigger-prohibited', [{ trigger: request.trigger }]);
  }

  const preview = await previewSync(request, dependencies);

  if (preview.repository.identity !== (prior.repository?.identity ?? null)) {
    return fail('repository-identity', 'repository-identity-mismatch', [{
      expected: prior.repository?.identity ?? null,
      actual: preview.repository.identity,
    }]);
  }

  // 2. Preview, re-derived from the clone as it is now.
  order.push('preview');

  if (preview.refusal !== null) {
    return fail('preview', preview.refusal.reasonCode, preview.refusal.errors);
  }

  // 3. Consent, bound to this clone and this preview — and through it, the
  //    candidate-hash approval `FR-CFG-005` requires, judged by the one
  //    function that owns policy transitions.
  order.push('consent');

  const { consent = null } = request;

  if (!consent) {
    return fail('consent', 'consent-missing', []);
  }

  if (consent.previewId !== preview.previewId) {
    return fail('consent', 'consent-preview-mismatch', [{
      expected: preview.previewId,
      actual: consent.previewId ?? null,
    }]);
  }

  if (consent.repositoryIdentity !== preview.repository.identity
    || consent.configurationIdentity !== preview.candidate.identity) {
    return fail('consent', 'consent-identity-mismatch', [{
      repository: preview.repository.identity,
      configuration: preview.candidate.identity,
    }]);
  }

  const transition = evaluatePolicyTransition({
    trusted: { identity: preview.trusted.identity, policy: preview.trustedPolicy },
    candidate: { identity: preview.candidate.identity, policy: request.configuration?.policy ?? null },
    checks: request.checks ?? [],
    role: 'operator',
    approval: {
      candidateId: consent.configurationIdentity,
      grantedBy: consent.actor ?? null,
      at: consent.grantedAt ?? null,
    },
  });

  if (!transition.advanced) {
    return fail('consent', transition.reasonCode, transition.weakenings);
  }

  // 4. Runner resolution: every command the configuration declares now.
  order.push('runner-resolution');

  if (preview.unresolved.length > 0) {
    return fail('runner-resolution', 'runner-unresolved', preview.unresolved);
  }

  // 5. Trust, for the client the receipt pinned, by its declared model.
  order.push('trust');

  const client = { id: prior.trust?.client ?? 'git' };
  const trust = await establishTrust({ client, repository: preview.repository });

  if (trust?.established !== true) {
    return fail('trust', 'trust-not-established', [trust ?? null]);
  }

  // 6. Hook chain: the registration the receipt pins is the one kept. The
  //    preview already refused anything else; nothing here writes.
  order.push('hook-chain-validation');

  // 7. Self-test: the same proofs activation requires.
  order.push('self-test');

  const evaluationSelfTest = await selfTestEvaluation({
    repository: preview.repository,
    checks: request.checks ?? [],
  });
  const selfTests = [{
    name: 'evaluation-process',
    ok: evaluationSelfTest?.ok === true,
    detail: evaluationSelfTest?.detail ?? null,
  }];

  if (!selfTests[0].ok) {
    return fail('self-test', 'self-test-failed', [selfTests[0]]);
  }

  const hookProgramSelfTest = await selfTestHookProgram({
    program: request.runtime?.hookProgram ?? null,
    repositoryRoot: request.repository.root,
  });

  if (hookProgramSelfTest?.ok !== true) {
    return fail('self-test', 'hook-program-self-test-failed', [{
      name: 'hook-program',
      ok: false,
      reason: hookProgramSelfTest?.reason ?? null,
      detail: hookProgramSelfTest?.detail ?? null,
    }]);
  }

  selfTests.push({ name: 'hook-program', ok: true, detail: hookProgramSelfTest.detail ?? null });

  const adapters = [];

  for (const adapter of prior.adapters ?? []) {
    const result = await selfTestAdapter(adapter, { repository: preview.repository });
    const selfTest = { ok: result?.ok === true, detail: result?.detail ?? null };

    selfTests.push({ name: `adapter:${adapter.id}`, ...selfTest });

    if (!selfTest.ok) {
      return fail('self-test', 'adapter-self-test-failed', [{ adapter: adapter.id, ...selfTest }]);
    }

    // The registration and any recorded client review are kept as pinned:
    // nothing about them changed, because nothing wrote them.
    adapters.push({ ...adapter, selfTest });
  }

  // 8. Receipt: the one write, atomic, read back, and undone to the prior
  //    receipt byte for byte if anything after it fails.
  order.push('receipt');

  if (!evidenceStore) {
    return fail('receipt', 'receipt-store-missing', [{
      message: 'Sync has no evidence store, so the receipt the registered hook reads could not be published.',
    }]);
  }

  const body = {
    ...receiptBodyOf(prior),
    receiptVersion: ACTIVATION_RECEIPT_VERSION,
    previewId: preview.previewId,
    syncedAt: clock().toISOString(),
    // The policy itself, beside its identity, so the next sync judges its
    // transition against this document rather than having to recover it.
    configuration: {
      schemaVersion: preview.candidate.schemaVersion,
      identity: preview.candidate.identity,
      policy: request.configuration?.policy ?? null,
    },
    runtime: { ...(prior.runtime ?? {}), runners: preview.runnerPins },
    adapters,
    trust: {
      client: client.id,
      established: true,
      grantedBy: trust.grantedBy ?? null,
      at: trust.at ?? null,
    },
    runtimeInputs: preview.runtimeInputs,
    selfTests,
    supersedes: {
      operation: 'sync',
      receiptId: prior.receiptId,
      configurationIdentity: preview.trusted.identity,
      previewId: preview.previewId,
      weakenings: transition.weakenings,
    },
    receiptLineage: receiptLineageOf(prior),
  };
  const receipt = { ...body, receiptId: contentIdentity(body) };
  const receiptFile = evidenceStore.activationReceipt();

  try {
    await receiptFile.write(receipt);
  } catch (error) {
    return fail('receipt', 'receipt-write-failed', [{ message: error.message }]);
  }

  journal.push({
    name: 'receipt',
    remains: `The activation receipt at ${receiptFile.path ?? 'the evidence store'} pins the synced configuration; the prior receipt ${prior.receiptId} was not restored.`,
    undo: () => receiptFile.write(prior),
  });

  let persisted = null;

  try {
    persisted = await receiptFile.read();
  } catch (error) {
    return fail('receipt', 'receipt-not-confirmed', [{ message: error.message }]);
  }

  if (persisted?.receiptId !== receipt.receiptId) {
    return fail('receipt', 'receipt-not-confirmed', [{
      expected: receipt.receiptId,
      actual: persisted?.receiptId ?? null,
    }]);
  }

  // 9. Authoritative Git, last: the registration the new receipt authorizes
  //    is re-confirmed on disk, and nothing is written to it.
  order.push('git-enablement');

  const confirmed = await keptHookRegistration({ prior: receipt, request });

  if (!confirmed.intact) {
    return fail('git-enablement', 'hook-registration-drifted', [{ path: confirmed.path }]);
  }

  const result = {
    activated: true,
    state: 'activated',
    step: 'git-enablement',
    reasonCode: null,
    errors: [],
    receipt,
    transition: {
      trustedId: transition.trustedId,
      candidateId: transition.candidateId,
      weakened: transition.weakened,
      weakenings: transition.weakenings,
    },
    order,
    rollback: { performed: false, actions: [], failures: [], remains: [] },
    resumption: null,
  };

  // A sync nobody can audit is not a sync: the prior receipt is restored.
  try {
    await record(result);
  } catch (error) {
    return fail('git-enablement', 'activation-record-failed', [{ message: error.message }]);
  }

  return result;
};
