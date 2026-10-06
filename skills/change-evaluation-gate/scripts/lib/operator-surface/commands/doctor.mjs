import { STEPS_ANSWERED_BY_ACTIVATION, inspectActivation } from '../../activation.mjs';
import { CONFIGURATION_FILE } from '../../configuration.mjs';
import { createExecutionRoot, releaseExecutionRoot, resolveConfiguration, resolveReceipt, resolveSensitiveInputs } from '../../hook-runner.mjs';
import { activationRequestFor } from './activate.mjs';
import { runGit } from '../git.mjs';
import { probeDependencyProvisioning } from '../../snapshot.mjs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

/** What a doctor is, stated on every rendering of one (`SG-TRUST-001`, `TB-063`). */
const DOCTOR_LIMIT = 'this describes this machine, now, to its owner: it installs, fixes, and activates nothing, and a proceeding verdict is not an activation — the steps answered by activation are still open until one runs.';

/** The directory a doctor probes in, under the one the execution roots are created in. */
const DOCTOR_PROBE_PREFIX = 'gate-doctor-probe-';

/**
 * Ask what a capture would do with the declared dependency roots, in a probe
 * directory under the temporary directory that is removed before this returns
 * (`TB-055`, `TB-063`). The probe is the one thing a doctor writes.
 */
const probeProvisioning = async ({ repositoryRoot, policy, copyProgram }) => {
  const probeRoot = await createExecutionRoot(DOCTOR_PROBE_PREFIX);

  try {
    const probed = await probeDependencyProvisioning({
      repositoryRoot,
      dependencyRoots: policy?.execution?.dependency_roots ?? [],
      provisioning: policy?.execution?.dependency_provisioning,
      probeRoot,
      copyProgram,
    });

    return { ...probed, probeRoot };
  } finally {
    await releaseExecutionRoot(probeRoot).catch(() => {});
  }
};

/**
 * What stopped an inspected activation, naming the declaration it came from
 * (`NFR-OPER-001`): the unresolved descriptors, the hook that refused, or the
 * preview's own refusal.
 */
const doctorStopDetail = ({ step, errors = [] }) => {
  if (step === 'runner-resolution') {
    return `no platform executable was found for ${errors
      .map((entry) => `${entry.check_id} (${entry.role}): ${entry.runner}`)
      .join(', ')}.`;
  }

  if (step === 'hook-chain-validation') {
    return `the existing hook chain is not one activation registers into: ${JSON.stringify(errors)}.`;
  }

  return errors.map((entry) => entry?.message ?? JSON.stringify(entry)).join(' ');
};

/** The clone's lifecycle state, in `gate status`'s words, read without opening a store. */
const doctorState = async (repositoryRoot) => {
  if ((await resolveReceipt(repositoryRoot)).ok) {
    return 'activated';
  }

  const configuration = await resolveConfiguration(repositoryRoot);

  return configuration.ok || configuration.reasonCode === 'gate-policy-invalid' ? 'configured' : 'installed';
};

/**
 * `gate doctor` — tell a maintainer, before activating anything, whether this
 * machine can run the Gate this clone configured (`TB-063`).
 *
 * Every question is asked of the seam that answers it for activation or for
 * the runners, so doctor's answer cannot disagree with what they then do:
 *
 * - configuration: `activationRequestFor`, the request `gate activate` builds,
 *   through `resolveConfiguration` (the reader and the policy validator every
 *   command uses);
 * - runners, hook chain, and verdict: `inspectActivation`, which resolves
 *   exactly what the transaction resolves, builds its preview — which writes
 *   nothing (`FR-LIFE-004`) — and applies its own refusals in its own order;
 * - dependency roots: `probeDependencyProvisioning`, the classification, clone
 *   probe, volume rule, and `link` provisioner a capture uses;
 * - Sensitive inputs: `resolveSensitiveInputs`, the resolution `openStore`
 *   performs, for the names an activation would pin; names, sources, and file
 *   statuses only, never a value (`FR-CFG-006`).
 *
 * It opens no Evidence store, writes no receipt, registers nothing, and prints
 * no confirmation token. Its one footprint is the probe directory, created
 * under the temporary directory and removed. Nothing here names an operating
 * system: each capability is attempted (`NFR-PORT-002`).
 */
export const operateDoctor = async ({ repositoryRoot, environment, copyProgram }) => {
  const state = await doctorState(repositoryRoot);
  const requested = await activationRequestFor({ repositoryRoot, selector: { client: null } });
  const configurationFailure = requested.failed?.failure ?? null;
  const policy = configurationFailure === null ? requested.request.configuration.policy : null;
  const provisioning = await probeProvisioning({ repositoryRoot, policy, copyProgram });
  const probeRemoved = await stat(provisioning.probeRoot).then(() => false, () => true);
  const dependencies = {
    declared: policy !== null,
    probe: { directory: provisioning.probeRoot, removed: probeRemoved },
    copyProgram: provisioning.copyProgram,
    clone: provisioning.clone === null
      ? null
      : { program: provisioning.clone.program, request: [...provisioning.clone.request] },
    directoryLink: provisioning.directoryLink,
    repositorySharesVolume: provisioning.repositorySharesVolume,
    roots: provisioning.roots,
  };
  const answeredByActivation = STEPS_ANSWERED_BY_ACTIVATION.map(({ step, question }) => ({ step, question }));

  if (configurationFailure !== null) {
    return {
      command: 'doctor',
      healthy: false,
      observation: {
        state,
        configuration: {
          resolved: false,
          path: path.join(repositoryRoot, CONFIGURATION_FILE),
          reasonCode: configurationFailure.reasonCode,
          detail: configurationFailure.detail,
        },
        identities: null,
        runners: null,
        dependencies,
        runtimeInputs: null,
        hooks: null,
        verdict: {
          proceeds: false,
          preview: 'not-reached',
          reached: [],
          stop: { step: null, reasonCode: configurationFailure.reasonCode, detail: configurationFailure.detail },
        },
        answeredByActivation,
        limit: DOCTOR_LIMIT,
      },
      mutation: null,
    };
  }

  const { request } = requested;
  const inspected = await inspectActivation(request, { runGit, environment });
  const { described, preview } = inspected;
  // The descriptor an unresolved runner came from, as the configuration declares it.
  const argumentsOf = (checkId, role) => [
    ...((request.checks.find((entry) => entry.id === checkId) ?? {})[role]?.args ?? []),
  ];
  const sensitive = await resolveSensitiveInputs({
    approved: request.runtimeInputs.map((input) => input.name),
    environment,
    policy,
    repositoryRoot,
  });
  const hook = described?.hook ?? null;

  return {
    command: 'doctor',
    healthy: inspected.stop === null,
    observation: {
      state,
      configuration: {
        resolved: true,
        path: path.join(repositoryRoot, CONFIGURATION_FILE),
        schemaVersion: request.configuration.schemaVersion,
        checks: request.checks.map((entry) => entry.id),
        reasonCode: null,
        detail: null,
      },
      // The identities the receipt would pin; never the preview identity, which
      // is the token that confirms an activation, and doctor confirms nothing.
      identities: described === null ? null : {
        repository: described.repository.identity,
        configuration: described.configuration.identity,
      },
      runners: described === null ? null : {
        resolved: described.runners.resolved.map((entry) => ({
          checkId: entry.check_id,
          role: entry.role,
          runner: entry.runner,
          executable: entry.executable,
          interpreter: entry.interpreter ?? null,
          version: entry.version ?? null,
          preview: entry.preview ?? null,
        })),
        unresolved: described.runners.unresolved.map((entry) => ({
          checkId: entry.check_id,
          role: entry.role,
          runner: entry.runner,
          args: argumentsOf(entry.check_id, entry.role),
          reason: entry.reason,
        })),
      },
      dependencies,
      runtimeInputs: {
        resolved: sensitive.redaction.armed,
        unresolved: sensitive.redaction.unresolved,
        environmentFiles: sensitive.redaction.environmentFiles,
      },
      hooks: hook === null ? null : {
        hook: described.hooks[0].hook,
        path: hook.path,
        action: hook.action,
        ownership: hook.ownership,
        strategy: hook.strategy,
        hooksPath: {
          configured: described.hooksPath.configured,
          value: described.hooksPath.value,
          shared: described.hooksPath.shared,
          directory: described.hooksPath.directory,
        },
        manager: described.hookManager?.id ?? null,
        valid: hook.reasonCode === null,
        reasonCode: hook.reasonCode,
      },
      verdict: {
        proceeds: inspected.stop === null,
        preview: preview === null ? 'not-reached' : 'reached',
        reached: inspected.reached,
        stop: inspected.stop === null ? null : {
          step: inspected.stop.step,
          reasonCode: inspected.stop.reasonCode,
          detail: doctorStopDetail(inspected.stop),
        },
      },
      answeredByActivation,
      limit: DOCTOR_LIMIT,
    },
    mutation: null,
  };
};
