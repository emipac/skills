import { desktopCommandFor, pendingClientReview, pinnedRegistration, registerDeclaredSurface, withdrawDeclaredSurface } from './adapters/registration.mjs';
import { ACTIVATION_RECEIPT_VERSION } from './constants.mjs';
import { AUTHORITATIVE_HOOK } from './hooks/constants.mjs';
import { hookBlockIdentity, plannedHookRegistration } from './hooks/content.mjs';
import { registerManagedBlock, registerOwnedHook, removeManagedBlock, removeOwnedHook } from './hooks/registration.mjs';
import { selfTestHookProgramDenial } from './hooks/self-test.mjs';
import { activationTransactionIdentity, adapterIdentity } from './identities.mjs';
import { describeActivation } from './inspection/description.mjs';
import { previewActivation } from './inspection/preview.mjs';
import { entryRefusal, hookChainRefusal, runnerResolutionRefusal, unreportableAdapterRefusal } from './inspection/refusals.mjs';
import { pinnedRunnerEntries } from './receipts.mjs';
import { activationTransaction } from './transaction.mjs';
import { contentIdentity } from '../evidence-store.mjs';

/**
 * Run one Activation transaction.
 *
 * Every seam that touches the machine is injected, so a fixture can inject a
 * genuine failure at any step and observe the rollback rather than simulate it.
 *
 * An exception escaping the pipeline is not allowed to escape the transaction:
 * it is caught here, the journal is unwound exactly as a refusal would unwind
 * it, and the clone's real state is reported rather than thrown at the caller
 * with a half-finished activation behind it (SG-LIFE-001).
 */
export const activate = async (request, dependencies = {}) => {
  const transaction = activationTransaction({ evidenceStore: dependencies.evidenceStore ?? null });

  try {
    return await runActivation(request, dependencies, transaction);
  } catch (error) {
    return transaction.fail(
      transaction.currentStep(),
      'activation-interrupted',
      [{ message: error.message }],
    );
  }
};

const runActivation = async (request, dependencies, transaction) => {
  const { journal, order, fail, suspend, record } = transaction;
  const {
    establishTrust,
    revokeTrust = null,
    selfTestEvaluation,
    selfTestAdapter,
    // The registered hook program is runtime, and FR-LIFE-004 requires runtime
    // to be self-tested before Git is enabled. The default really executes it.
    selfTestHookProgram = selfTestHookProgramDenial,
    // Desktop adapter registration goes through the adapter's own declared
    // surface. The seam stays injectable so a fixture can fail it on purpose,
    // but the default is the real declaration-driven write: activation carries
    // no knowledge of any client (FR-ADAPT-008, SG-OWNER-001).
    registerAdapter = registerDeclaredSurface,
    unregisterAdapter = withdrawDeclaredSurface,
    registerHook = registerOwnedHook,
    unregisterHook = removeOwnedHook,
    composeHook = registerManagedBlock,
    decomposeHook = removeManagedBlock,
    evidenceStore = null,
    clock = () => new Date(),
  } = dependencies;

  // 1. Repository identity, and the entry points that may never reach it.
  order.push('repository-identity');

  const entry = entryRefusal(request);

  if (entry !== null) {
    return fail(entry.step, entry.reasonCode, entry.errors);
  }

  const described = await describeActivation(request, dependencies);

  // A non-interactive run has nobody to look at the preview, so the caller must
  // say in advance which clone and which approved policy it means. A flag alone
  // is never enough: it says "do not ask", not "this is the right repository"
  // (FR-LIFE-015).
  if (request.interactive === false) {
    const missing = [
      ...(request.repository.expectedIdentity ? [] : ['repository.expectedIdentity']),
      ...(request.configuration?.expectedIdentity ? [] : ['configuration.expectedIdentity']),
    ];

    if (missing.length > 0) {
      return fail('repository-identity', 'non-interactive-identity-missing', [{ missing }]);
    }
  }

  // A non-interactive activation must name the clone and the policy it expects.
  if (request.repository.expectedIdentity
    && request.repository.expectedIdentity !== described.repository.identity) {
    return fail('repository-identity', 'repository-identity-mismatch', [{
      expected: request.repository.expectedIdentity,
      actual: described.repository.identity,
    }]);
  }

  if (request.configuration?.expectedIdentity
    && request.configuration.expectedIdentity !== described.configuration.identity) {
    return fail('repository-identity', 'configuration-identity-mismatch', [{
      expected: request.configuration.expectedIdentity,
      actual: described.configuration.identity,
    }]);
  }

  // A resumed transaction must be the same transaction. Every identity is
  // checked here, before consent is even read and long before anything on the
  // machine changes, so a resumption that no longer applies writes nothing
  // (FR-LIFE-016, SG-HOOK-001).
  const resume = request.resume ?? null;
  const selectedAdapters = adapterIdentity(described.adapters);

  if (resume) {
    if (resume.repositoryIdentity !== described.repository.identity) {
      return fail('repository-identity', 'resume-repository-mismatch', [{
        expected: resume.repositoryIdentity ?? null,
        actual: described.repository.identity,
      }]);
    }

    if (resume.configurationIdentity !== described.configuration.identity) {
      return fail('repository-identity', 'resume-configuration-mismatch', [{
        expected: resume.configurationIdentity ?? null,
        actual: described.configuration.identity,
      }]);
    }

    if (resume.adapterIdentity !== selectedAdapters) {
      return fail('repository-identity', 'resume-adapter-mismatch', [{
        expected: resume.adapterIdentity ?? null,
        actual: selectedAdapters,
      }]);
    }
  }

  // 2. Preview: the transaction restates exactly what it is about to do.
  order.push('preview');

  const preview = await previewActivation(request, dependencies);
  const transactionId = activationTransactionIdentity({
    repositoryIdentity: described.repository.identity,
    configurationIdentity: described.configuration.identity,
    adapterIdentity: selectedAdapters,
    previewId: preview.previewId,
  });

  if (resume) {
    if (resume.previewId !== preview.previewId) {
      return fail('preview', 'resume-preview-mismatch', [{
        expected: resume.previewId ?? null,
        actual: preview.previewId,
      }]);
    }

    if (resume.transactionId !== transactionId) {
      return fail('preview', 'resume-transaction-mismatch', [{
        expected: resume.transactionId ?? null,
        actual: transactionId,
      }]);
    }
  }

  // A selected preflight surface that could not answer anything it evaluated
  // is refused here, before consent, so the whole selection registers nothing
  // (`TB-048`, `AC-LIFE-009`).
  const unreportable = unreportableAdapterRefusal(described.adapters);

  if (unreportable !== null) {
    return fail(unreportable.step, unreportable.reasonCode, unreportable.errors);
  }

  // 3. Consent, bound to this repository and this preview. Consent is never
  //    implied by configuration, never reusable, and never for another clone.
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

  if (consent.repositoryIdentity !== described.repository.identity
    || consent.configurationIdentity !== described.configuration.identity) {
    return fail('consent', 'consent-identity-mismatch', [{
      repository: described.repository.identity,
      configuration: described.configuration.identity,
    }]);
  }

  // 4. Runner resolution: every logical runner becomes one platform executable
  //    whose identity and version are pinned, or the transaction stops.
  order.push('runner-resolution');

  const unresolvedRunners = runnerResolutionRefusal(described);

  if (unresolvedRunners !== null) {
    return fail(unresolvedRunners.step, unresolvedRunners.reasonCode, unresolvedRunners.errors);
  }

  // 5. Trust: client-controlled, never granted on the operator's behalf.
  order.push('trust');

  const trust = await establishTrust({ client: request.client, repository: described.repository });

  // The client may need the operator to answer a trust prompt first. That is a
  // pause, not a refusal: the transaction states the identities it may be
  // resumed against and leaves the clone exactly as it found it.
  if (trust?.established !== true && trust?.pending === true) {
    return suspend('trust', 'trust-pending', [{ reason: trust.reason ?? null }], {
      transactionId,
      previewId: preview.previewId,
      repositoryIdentity: described.repository.identity,
      configurationIdentity: described.configuration.identity,
      adapterIdentity: selectedAdapters,
      client: request.client?.id ?? null,
      pausedAt: clock().toISOString(),
    });
  }

  if (!trust?.established) {
    return fail('trust', 'trust-not-established', [trust ?? null]);
  }

  journal.push({
    name: 'trust',
    remains: `Trust established for ${request.client?.id ?? 'the client'} in ${described.repository.root} was not withdrawn.`,
    undo: async () => {
      if (revokeTrust) {
        await revokeTrust({ client: request.client, repository: described.repository, trust });
      }
    },
  });

  // 6. Hook chain validation: the existing chain decides whether activation may
  //    proceed at all. Nothing here rewrites, relocates, or takes over a hook.
  order.push('hook-chain-validation');

  const hookChain = hookChainRefusal(described);

  if (hookChain !== null) {
    return fail(hookChain.step, hookChain.reasonCode, hookChain.errors);
  }

  // 7. Self-test: the evaluation process and every selected adapter.
  order.push('self-test');

  const evaluationSelfTest = await selfTestEvaluation({
    repository: described.repository,
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

  // The runtime the authoritative hook will exec, proved against a change it
  // must deny. A program that cannot be proved to deny is refused here, before
  // any receipt exists and long before Git is enabled (NFR-REL-003).
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

  selfTests.push({
    name: 'hook-program',
    ok: true,
    detail: hookProgramSelfTest.detail ?? null,
  });

  const adapters = [];
  const quotedDesktopCommand = (adapterId) => desktopCommandFor(request, adapterId);

  // An adapter becomes active only after it has proved itself, and the set is
  // all-or-nothing: the first failure unwinds every adapter already registered,
  // so a clone is never left half-integrated (SG-HOOK-001).
  for (const adapter of described.adapters) {
    const result = await selfTestAdapter(adapter, { repository: described.repository });
    const selfTest = { ok: result?.ok === true, detail: result?.detail ?? null };

    selfTests.push({ name: `adapter:${adapter.id}`, ...selfTest });

    if (!selfTest.ok) {
      return fail('self-test', 'adapter-self-test-failed', [{ adapter: adapter.id, ...selfTest }]);
    }

    if (!registerAdapter) {
      adapters.push({ ...adapter, selfTest });

      continue;
    }

    let command = null;

    try {
      command = quotedDesktopCommand(adapter.id);
    } catch {
      command = null;
    }

    const registration = await registerAdapter(adapter, {
      repository: described.repository,
      command,
    });
    const pinned = pinnedRegistration(registration);

    adapters.push({
      ...adapter,
      selfTest,
      ...(pinned === null ? {} : { registration: pinned }),
      ...(pinned?.registered === true
        ? { clientReview: pendingClientReview(adapter.id) }
        : {}),
    });

    // An adapter that registers nothing has nothing to compensate. Journalling
    // it anyway would claim a rollback action that never had anything to undo.
    if (registration !== null && (pinned === null || pinned.registered === true)) {
      journal.push({
        name: `adapter:${adapter.id}`,
        remains: `The ${adapter.id} adapter registration ${pinned?.path === undefined || pinned?.path === null ? 'on its declared surface' : `in ${pinned.path}`} is still in place.`,
        undo: async () => {
          if (unregisterAdapter) {
            await unregisterAdapter(adapter, { repository: described.repository, registration: pinned });
          }
        },
      });
    }
  }

  // 8. Receipt: everything the activation is pinned to, published atomically.
  order.push('receipt');

  // The exact registration this transaction is about to write, with its own
  // receipt-id line elided so its identity can be pinned by the receipt that
  // will name it. A program the gate cannot safely quote has no plannable
  // registration; `git-enablement` refuses it a moment later, on its own terms.
  let plannedRegistration = null;

  try {
    plannedRegistration = plannedHookRegistration({
      strategy: described.hook.strategy,
      hook: AUTHORITATIVE_HOOK,
      program: request.runtime?.hookProgram ?? null,
      repositoryRoot: request.repository.root,
    });
  } catch {
    plannedRegistration = null;
  }

  const body = {
    receiptVersion: ACTIVATION_RECEIPT_VERSION,
    activatedAt: clock().toISOString(),
    previewId: preview.previewId,
    repository: described.repository,
    configuration: described.configuration,
    runtime: {
      gate: {
        id: request.gate?.id ?? null,
        version: request.gate?.version ?? null,
        protocolVersion: request.gate?.protocolVersion ?? null,
      },
      runnerVersion: request.runtime?.runnerVersion ?? null,
      runners: pinnedRunnerEntries(described.runners.resolved),
    },
    adapters,
    hooks: described.hooks.map((hook) => ({
      hook: hook.hook,
      path: hook.path,
      ownership: hook.ownership,
    })),
    // Which strategy the declared order selected, and what chain it composed
    // with. `priorIdentity` is the pre-existing hook this activation promised to
    // preserve; rollback and later drift checks compare against it.
    //
    // `blockIdentity` is the durable identity of the gate-owned registration
    // itself, hashed with its own receipt-id line elided so it can be computed
    // here — before the receipt that will name it exists — and recomputed from
    // disk at any later time. It is what lets `gate status` and `gate repair`
    // detect tampering without depending on an in-flight journal.
    hookChain: {
      strategy: described.hook.strategy,
      manager: described.hook.manager?.id ?? null,
      path: described.hook.path,
      priorIdentity: described.hook.priorIdentity,
      blockIdentity: plannedRegistration === null ? null : hookBlockIdentity(plannedRegistration),
    },
    trust: {
      client: request.client?.id ?? null,
      established: true,
      grantedBy: trust.grantedBy ?? null,
      at: trust.at ?? null,
    },
    runtimeInputs: described.runtimeInputs,
    selfTests,
  };
  const receipt = { ...body, receiptId: contentIdentity(body) };

  // The receipt is the only thing the registered hook reads to know what was
  // activated. A transaction with nowhere to put one cannot enable
  // authoritative Git: it would leave a clone with a registered hook and
  // nothing for it to honour, while reporting a healthy activation
  // (NFR-REL-002, AC-LIFE-002).
  if (!evidenceStore) {
    return fail('receipt', 'receipt-store-missing', [{
      message: 'Activation has no evidence store, so the receipt the registered hook reads could not be published.',
    }]);
  }

  const receiptFile = evidenceStore.activationReceipt();

  try {
    await receiptFile.write(receipt);
  } catch (error) {
    return fail('receipt', 'receipt-write-failed', [{ message: error.message }]);
  }

  journal.push({
    name: 'receipt',
    remains: `The activation receipt at ${receiptFile.path ?? 'the evidence store'} is still on disk.`,
    undo: () => receiptFile.remove(),
  });

  // The write is published by one atomic rename, so what is read back is either
  // the whole receipt or nothing. Confirming it here — before `git-enablement`,
  // and while the receipt's own compensating action is already journalled —
  // is what makes "activated implies a receipt on disk" true rather than
  // assumed (NFR-REL-002).
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
      message: 'The activation receipt could not be read back as it was written; authoritative Git was never enabled.',
    }]);
  }

  // 9. Authoritative Git, last.
  order.push('git-enablement');

  let registration = null;

  // The strategy the declared order selected decides how Git is enabled: a
  // composed block into a hook that already exists, or a whole owned file where
  // there is none — never both, and never a replacement.
  const composing = described.hook.strategy === 'marker-delimited-block';
  const target = {
    hook: AUTHORITATIVE_HOOK,
    path: described.hook.path,
    directory: described.hook.directory,
    repositoryRoot: request.repository.root,
    program: request.runtime?.hookProgram ?? null,
    receipt,
  };

  try {
    registration = composing
      ? await composeHook({ ...target, existing: described.hook.existing })
      : await registerHook(target);
  } catch (error) {
    return fail('git-enablement', 'hook-registration-failed', [{ message: error.message }]);
  }

  journal.push({
    name: 'git-enablement',
    remains: `The gate-owned ${AUTHORITATIVE_HOOK} registration at ${described.hook.path} is still in place and Git is still authoritative.`,
    undo: () => (composing ? decomposeHook : unregisterHook)({
      path: described.hook.path,
      directory: described.hook.directory,
      ...(registration ?? {}),
    }),
  });

  const result = {
    activated: true,
    state: 'activated',
    step: 'git-enablement',
    reasonCode: null,
    errors: [],
    receipt,
    order,
    rollback: { performed: false, actions: [], failures: [], remains: [] },
    resumption: null,
  };

  // An activation nobody can audit is not an activation. If the transition
  // cannot be recorded, authoritative Git is withdrawn again (NFR-AUD-001).
  try {
    await record(result);
  } catch (error) {
    return fail('git-enablement', 'activation-record-failed', [{ message: error.message }]);
  }

  return result;
};
