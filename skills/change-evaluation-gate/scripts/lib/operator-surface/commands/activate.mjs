import { COMMAND_ALIAS_NAME, PACKAGED_COMMAND, SELF_DECLARED, createTrustEstablishment, registerCommandAlias, selfTestAdapterSurface, selfTestEvaluationDenial } from '../../activation-seams.mjs';
import { activate, adapterIdentity, previewActivation, unreportableAdapterRefusal } from '../../activation.mjs';
import { describeAdapter } from '../../adapters.mjs';
import { gateChecksFromConfiguration } from '../../configuration.mjs';
import { PROTOCOL_VERSION } from '../../evaluation-contract.mjs';
import { resolveConfiguration, resolveReceipt } from '../../hook-runner.mjs';
import { resolveClone } from '../clone.mjs';
import { GATE_ID } from '../constants.mjs';
import { runGit } from '../git.mjs';
import { instructionSelectors, mismatchExplanation, previewInstruction } from '../instructions.mjs';
import { failure, mutation, recordSurfaceRefusal } from '../outcomes.mjs';
import { PACKAGED_HOOK_PROGRAM, installedDistribution } from '../runtime.mjs';
import { declaredSensitiveInputs } from '../../policy.mjs';

/**
 * Everything one activation of THIS clone would be, resolved from the clone
 * itself and from the installed distribution running this command.
 *
 * Nothing here is a value a caller handed in. The policy and the checks come
 * from the clone's own configuration through the same reader the authoritative
 * runner uses; the hook program and the gate release come from the distribution
 * that would register them; the adapter set comes from the declared registry.
 * An activation whose request was assembled from anything else would pin a
 * clone that does not exist.
 *
 * Runtime inputs are deliberately empty: nothing in schema v4 declares one, so
 * an activation performed from a configuration has none to pin, and inventing a
 * name here would put an unapproved Sensitive value in the receipt.
 */
export const activationRequestFor = async ({ repositoryRoot, selector }) => {
  const configuration = await resolveConfiguration(repositoryRoot);

  if (!configuration.ok) {
    return {
      failed: failure({
        command: 'activate',
        reasonCode: configuration.reasonCode,
        // Activation never configures a clone on the way past.
        detail: `${configuration.detail} Activation configures nothing; configure this clone first, then activate it.`,
      }),
    };
  }

  const { checks, errors } = gateChecksFromConfiguration(configuration.configuration);

  if (errors.length > 0) {
    return {
      failed: failure({
        command: 'activate',
        reasonCode: 'check-descriptors-invalid',
        detail: `this clone's configured verification commands cannot be resolved into checks: ${errors.map((error) => `${error.path}: ${error.message}`).join(' ')}`,
      }),
    };
  }

  const clientId = selector.client ?? 'git';
  const client = describeAdapter(clientId);

  if (client === null) {
    return {
      failed: failure({
        command: 'activate',
        reasonCode: 'adapter-undeclared',
        detail: `${JSON.stringify(clientId)} is not an adapter this gate declares, so it declares no trust model to satisfy and nothing to self-test.`,
      }),
    };
  }

  const git = describeAdapter('git');
  // Authoritative Git is always in the set: it is what a `pre-commit`
  // registration makes authoritative, whichever client asked for the
  // activation.
  const adapters = [
    { id: git.id, version: git.version, authoritative: git.role === 'authoritative' },
    ...(client.id === git.id
      ? []
      : [{ id: client.id, version: client.version, authoritative: client.role === 'authoritative' }]),
  ];
  const distribution = await installedDistribution();

  return {
    client,
    distribution,
    request: {
      scope: 'repository',
      // A package or plugin lifecycle can never reach this: the operator ran a
      // command, twice, and the transaction is told exactly that.
      trigger: 'explicit',
      repository: { root: repositoryRoot },
      configuration: {
        schemaVersion: configuration.configuration?.schema_version ?? null,
        policy: configuration.policy,
      },
      client: { id: client.id, surface: client.surface, version: client.version },
      gate: {
        id: GATE_ID,
        version: distribution.version,
        protocolVersion: PROTOCOL_VERSION,
      },
      runtime: {
        runnerVersion: `${GATE_ID}/${distribution.version ?? 'unknown'}`,
        hookProgram: {
          interpreter: process.execPath,
          script: PACKAGED_HOOK_PROGRAM,
          args: [],
        },
      },
      checks,
      adapters,
      // The Sensitive runtime inputs the clone's own policy declares, by name
      // and source. This is the one production path that fills the request:
      // the preview shows the names, consent is granted against them, the
      // receipt pins them, and the runners arm the redactor from them. A
      // value is never read here (`FR-CFG-006`, `TB-045`).
      runtimeInputs: declaredSensitiveInputs(configuration.policy),
    },
  };
};

/**
 * What a client will do with a registration this activation only wrote.
 *
 * `activated` must not be read as "this client is already running it". Where a
 * client reviews the registration afterwards, the receipt already carries that
 * fact in the adapter's own declared words; this restates the same sentence
 * where the maintainer meets it, so nobody has to open the receipt to learn
 * that one more step belongs to them (`SG-TRUST-001`, `TB-046`).
 */
const pendingClientReviews = (result) => (result.receipt?.adapters ?? [])
  .filter((adapter) => adapter.clientReview !== null && adapter.clientReview !== undefined)
  .map((adapter) => adapter.clientReview.detail);

/** What one activation invocation did, in the transaction's own terms. */
const activationSummary = (result, shortcut, selector) => {
  if (result.activated === true) {
    return [
      `This clone is activated: every step ran in the settled order, the receipt ${result.receipt.receiptId} was published and confirmed, and authoritative Git was enabled last.`,
      shortcut.detail,
      ...pendingClientReviews(result),
    ].join(' ');
  }

  if (result.state === 'paused') {
    // The resumption carries every selector this invocation carried, with the
    // transaction identity in place of any `--resume` it was itself given: a
    // resumption that dropped `--client` would preview a different activation.
    const resumption = previewInstruction('activate', instructionSelectors('activate', {
      ...selector,
      resume: result.resumption.transactionId,
    }));

    return `Nothing was activated (${result.reasonCode}): the transaction paused at ${result.step}, no gate integration is active, and it resumes only as \`${resumption} --confirm <token>\` against the same clone, policy, adapters, and preview.`;
  }

  if (result.state === 'recovery-required') {
    return `The activation failed at ${result.step} (${result.reasonCode}) and could not be fully rolled back; this clone requires recovery: ${result.rollback.remains.join(' ')}`;
  }

  return `Nothing was activated (${result.reasonCode}): the transaction failed at ${result.step}, every gate-owned change was rolled back, no shortcut was written, and this clone commits exactly as it did while configured.`;
};

/**
 * `gate activate` — activate this configured clone, in two invocations.
 *
 * The first previews and writes nothing. The second names the token the first
 * printed, and this rebuilds the preview from the clone AS IT IS NOW and checks
 * the token against that. A confirmation naming a preview this clone no longer
 * matches — because a command resolved differently, because the policy changed,
 * because it is a different clone — performs no mutation and says so
 * (`AC-LIFE-008`, `TB-036`).
 *
 * The consent handed to the transaction is built from the RECOMPUTED preview,
 * never from anything the caller carried, so the identities the transaction
 * checks are identities this process observed.
 */
export const operateActivate = async ({ repositoryRoot, environment, selector, confirmation }) => {
  const resolved = await activationRequestFor({ repositoryRoot, selector });

  if (resolved.failed) {
    return resolved.failed;
  }

  const { client, distribution, request } = resolved;

  // A selected preflight surface that could not answer is refused before it is
  // previewed, by the refusal the transaction itself makes at its preview: no
  // token is offered for an activation that would register a surface which
  // evaluates every turn and says nothing (`TB-048`, `SG-HOOK-001`).
  const unreportable = unreportableAdapterRefusal(request.adapters);

  if (unreportable !== null) {
    return failure({
      command: 'activate',
      reasonCode: unreportable.reasonCode,
      detail: `${unreportable.errors.map((entry) => entry.message).join(' ')} Nothing was previewed, registered, or written.`,
    });
  }

  const dependencies = { runGit, environment };
  let preview;

  try {
    preview = await previewActivation(request, dependencies);
  } catch (error) {
    return failure({
      command: 'activate',
      reasonCode: 'activation-unpreviewable',
      detail: `this clone cannot be previewed for activation (${error.message}); nothing was written.`,
    });
  }

  // What this clone IS right now, read without opening — and therefore without
  // creating — an Evidence store. A clone that already carries a receipt is
  // `activated`, and the transaction refuses to take over the hook it owns; a
  // preview that called it `configured` regardless would be describing the
  // request rather than the clone.
  const existing = await resolveReceipt(repositoryRoot);
  const observation = {
    state: existing.ok ? 'activated' : 'configured',
    client: client.id,
    // What has to be satisfied before this clone can be activated, in the
    // adapter's own declared words.
    trustModel: client.capabilities?.trust?.model ?? null,
    release: {
      id: GATE_ID,
      version: distribution.version,
      protocolVersion: PROTOCOL_VERSION,
    },
    repositoryIdentity: preview.repository.identity,
    configurationIdentity: preview.configuration.identity,
    hooks: preview.hooks.map((hook) => ({
      hook: hook.hook,
      path: hook.path,
      action: hook.action,
      ownership: hook.ownership,
    })),
    hookManager: preview.hookManager,
    hookProgram: request.runtime.hookProgram,
    commands: preview.commands,
    unresolved: preview.unresolved,
    adapters: preview.adapters,
    dependencyRoots: preview.dependencyRoots,
    dependencyProvisioning: preview.dependencyProvisioning,
    runtimeInputs: preview.runtimeInputs,
    shortcut: { kind: 'clone-local-git-alias', name: `alias.${COMMAND_ALIAS_NAME}` },
    confirmationToken: preview.previewId,
  };

  if (confirmation === null) {
    return { command: 'activate', healthy: true, observation, mutation: null };
  }

  const clone = await resolveClone({
    repositoryRoot,
    environment,
    command: 'activate',
    // A clone that is not activated has no receipt, which is the whole point.
    // The store is opened because a confirmation writes: the receipt goes in
    // it, and so does the Lifecycle event that records this either way.
    receiptRequired: false,
    consentChannel: selector.consentChannel,
  });

  if (clone.failed) {
    return clone.failed;
  }

  if (confirmation !== preview.previewId) {
    await recordSurfaceRefusal({
      evidenceStore: clone.store,
      type: 'activation',
      before: confirmation,
      reason: 'preview-mismatch: the confirmation did not reproduce the activation preview its token names; nothing was registered and no receipt was written.',
    });

    return {
      command: 'activate',
      healthy: false,
      observation,
      mutation: mutation({
        confirmation,
        performed: false,
        reasonCode: 'preview-mismatch',
        expected: preview.previewId,
        summary: `Nothing was activated (preview-mismatch): ${mismatchExplanation('activate', instructionSelectors('activate', selector))}`,
      }),
    };
  }

  const consent = {
    previewId: preview.previewId,
    repositoryIdentity: preview.repository.identity,
    configurationIdentity: preview.configuration.identity,
    // Carried, never asserted. See `SELF_DECLARED`.
    actor: selector.actor === null ? null : { name: selector.actor, source: SELF_DECLARED },
    grantedAt: new Date().toISOString(),
  };
  // A resumption names the transaction it is resuming, and that identity binds
  // all four things a resumption may never change. Every one of them is
  // re-derived here, so a clone, policy, adapter set, or preview that moved
  // since the pause produces a different identity and the transaction refuses.
  const resume = selector.resume === null ? null : {
    transactionId: selector.resume,
    previewId: preview.previewId,
    repositoryIdentity: preview.repository.identity,
    configurationIdentity: preview.configuration.identity,
    adapterIdentity: adapterIdentity(preview.adapters),
  };
  const result = await activate({ ...request, consent, resume }, {
    ...dependencies,
    evidenceStore: clone.store,
    // The three seams `runActivation` leaves abstract. They are supplied here
    // and nowhere else on this surface, and none of them can be replaced from
    // an argument vector: a caller that could inject its own self-test could
    // activate a clone that proves nothing.
    establishTrust: createTrustEstablishment({ consent, actor: selector.actor }),
    selfTestEvaluation: () => selfTestEvaluationDenial({
      runnerVersion: request.runtime.runnerVersion,
    }),
    selfTestAdapter: selfTestAdapterSurface,
  });

  // The shortcut is registered only after the transaction has fully succeeded,
  // and outside its stepped sequence: `ACTIVATION_STEPS` may not grow and the
  // transaction may not change, so there is no journal entry to hang it from. A
  // failed or rolled-back activation therefore never writes one at all, which
  // is the property `SG-LIFE-001` asks for, reached by not writing rather than
  // by taking back. A shortcut that cannot be registered is an inconvenience,
  // never a reason to leave an otherwise activated clone unactivated.
  const shortcut = result.activated === true
    ? await registerCommandAlias({
      repositoryRoot,
      command: PACKAGED_COMMAND,
      runGit: (args) => runGit(repositoryRoot, args),
    })
    : {
      registered: false,
      reason: 'activation-not-completed',
      name: `alias.${COMMAND_ALIAS_NAME}`,
      value: null,
      detail: 'No shortcut was registered, because nothing was activated.',
    };

  return {
    command: 'activate',
    healthy: result.activated === true,
    observation: { ...observation, state: result.state },
    mutation: mutation({
      confirmation,
      performed: result.activated === true,
      reasonCode: result.reasonCode,
      step: result.step,
      order: result.order,
      state: result.state,
      receiptId: result.receipt?.receiptId ?? null,
      // Exactly what the receipt claims about consent, restated where a reader
      // meets it, so nobody has to open the receipt to see that no human was
      // asserted.
      trust: result.receipt?.trust ?? null,
      resumption: result.resumption,
      rollback: result.rollback,
      shortcut,
      errors: result.errors ?? [],
      summary: activationSummary(result, shortcut, selector),
    }),
  };
};
