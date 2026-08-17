/**
 * Protected policy transitions, Sensitive runtime inputs, and control-surface
 * drift.
 *
 * Three concerns share one module because they share one honest premise: the
 * Gate is a COOPERATIVE LOCAL PROCESS on a machine its owner controls
 * (`ASM-001`, `SG-TRUST-001`). Nothing here resists that owner, and nothing
 * here should ever be described as if it did.
 *
 * 1. A change that edits the Gate control surface is graded against the policy
 *    that was already Trusted, not against the policy it proposes. A candidate
 *    that weakens its own authorization can never authorize itself
 *    (`SG-CFG-001`, `FR-CFG-005`).
 * 2. An approved Sensitive runtime input is confirmed at activation, copied
 *    only temporarily into the isolated materialization, recorded by name and
 *    source only, and removed with that materialization (`FR-CFG-006`,
 *    `SG-SECRET-001`).
 * 3. Independent drift of the Gate control surface is reported, never repaired
 *    (`FR-LIFE-019`), and it makes health `broken` while an authoritative
 *    evaluation becomes `unverified` (`NFR-SEC-004`, `AC-SEC-001`).
 *
 * Seeing a changed Grader surface is VISIBILITY, not an accusation. Nothing in
 * this module classifies a change or a developer as malicious.
 */

import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { touchesControlSurface } from './grader-surface.mjs';
import {
  authorizationFor,
  bindPolicy,
  decisionOutcome,
  validateGatePolicy,
} from './policy.mjs';

const canonical = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value ?? null);
};

/**
 * The trust boundary, stated once and travelling with every drift result.
 *
 * The Gate runs as the developer, on the developer's machine, with the
 * developer's permissions. Detecting that something changed is not the same as
 * preventing it, and this feature only ever claims the first (`ASM-001`,
 * `SG-TRUST-001`, `RISK-001`).
 */
export const TRUST_BOUNDARY = Object.freeze({
  model: 'cooperative-local-process',
  // Stated as data so a reader, a report, and a test all see the same words.
  statement: 'The Change Evaluation Gate is a cooperative local process running with the machine owner\'s own permissions. Control-surface reconciliation reports what changed; it does not resist the machine owner, and it is neither tamper-proof nor a sandbox.',
  tamperResistant: false,
  resistsMachineOwner: false,
  containsHostileCode: false,
  encryptsEvidence: false,
});

/**
 * The Gate control surface: every part of the machine whose identity the
 * Activation receipt pinned and whose independent change means the Gate is no
 * longer the Gate the clone consented to (`NFR-SEC-004`, `AC-SEC-001`).
 */
export const CONTROL_SURFACES = Object.freeze([
  'runtime',
  'adapters',
  'managed-hooks',
  'receipt',
  'trusted-configuration',
  'command-descriptors',
  'providers',
]);

/** The identity the receipt pinned for each control surface. */
const pinnedControlSurface = (receipt) => ({
  runtime: identityOf({
    gate: receipt?.runtime?.gate ?? null,
    runnerVersion: receipt?.runtime?.runnerVersion ?? null,
  }),
  adapters: identityOf((receipt?.adapters ?? []).map((adapter) => ({
    id: adapter?.id ?? null,
    version: adapter?.version ?? null,
    authoritative: adapter?.authoritative === true,
  }))),
  'managed-hooks': identityOf(receipt?.hookChain?.blockIdentity ?? null),
  receipt: identityOf(receipt?.receiptId ?? null),
  'trusted-configuration': identityOf(receipt?.configuration?.identity ?? null),
  'command-descriptors': identityOf(receipt?.runtime?.runners ?? []),
  providers: identityOf(receipt?.providers ?? {}),
});

/** The identity actually observed on this machine right now. */
const observedControlSurface = (observed) => ({
  runtime: identityOf({
    gate: observed?.runtime?.gate ?? null,
    runnerVersion: observed?.runtime?.runnerVersion ?? null,
  }),
  adapters: identityOf((observed?.adapters ?? []).map((adapter) => ({
    id: adapter?.id ?? null,
    version: adapter?.version ?? null,
    authoritative: adapter?.authoritative === true,
  }))),
  'managed-hooks': identityOf(observed?.hookBlockIdentity ?? null),
  receipt: identityOf(observed?.receiptId ?? null),
  'trusted-configuration': identityOf(observed?.configurationId ?? null),
  'command-descriptors': identityOf(observed?.runners ?? []),
  providers: identityOf(observed?.providers ?? {}),
});

/**
 * Reconcile every pinned Gate control surface against what is on this machine.
 *
 * Independent drift of any of them makes health `broken` and makes an
 * authoritative evaluation `unverified` with `integrity-drift`: the clone can
 * no longer say what it is enforcing, and nothing that cannot be said is
 * proved (`AC-SEC-001`, `NFR-SEC-004`).
 *
 * This is OBSERVATION. It writes nothing, repairs nothing, and records nothing
 * — recovery stays a confirmed operator action (`FR-LIFE-019`). It is also not
 * resistance: a machine owner can change any of these identities, and detecting
 * that they did is all this claims to do (`SG-TRUST-001`, `ASM-001`).
 */
export const reconcileControlSurface = ({
  receipt = null,
  observed = null,
  role = 'preflight',
  graderSurfaces = [],
} = {}) => {
  const pinned = pinnedControlSurface(receipt);
  const present = observedControlSurface(observed);
  const findings = [];

  for (const surface of CONTROL_SURFACES) {
    if (pinned[surface] === present[surface]) {
      continue;
    }

    findings.push({
      area: 'control-surface',
      // Every control surface is authoritative: the gate cannot enforce what it
      // can no longer identify.
      severity: 'authoritative',
      code: 'control-surface-drift',
      surface,
      expected: pinned[surface],
      observed: present[surface],
      detail: `The ${surface} control surface no longer matches the identity the Activation receipt pinned.`,
    });
  }

  const drifted = findings.length > 0;
  const outcome = drifted ? 'unverified' : null;

  return {
    drifted,
    findings,
    health: drifted ? 'broken' : 'healthy',
    outcome,
    reasonCode: drifted ? 'integrity-drift' : null,
    authorization: drifted ? authorizationFor(role, outcome) : null,
    // A change that edits a declared Grader surface is REPORTED, in full, and
    // that report is visibility only. Editing tests, a provider, or the Gate
    // configuration is ordinary work; the Gate never infers intent from it
    // (FR-EVAL-009, TB-014 non-goal).
    visibleGraderSurfaces: [...graderSurfaces],
    classification: 'none',
    // A change that edits the Gate control surface takes the dual-policy
    // transition. That is a stricter path, not an accusation, and it is a
    // different thing from independent drift of this machine.
    policyTransitionRequired: touchesControlSurface(graderSurfaces),
    // Nothing above opened a file for writing.
    repaired: false,
    mutations: [],
    // Stated on every result: this is detection, not resistance.
    tamperResistant: false,
    trustBoundary: TRUST_BOUNDARY.statement,
  };
};

/**
 * Where an approved Sensitive runtime input lives while a check runs. It is a
 * child of the isolated materialization, so it is created with that
 * materialization and removed with it — never written into the repository, the
 * configuration, or the Evidence store.
 */
export const RUNTIME_INPUT_DIRECTORY = '.change-evaluation-gate-runtime-inputs';

/** Owner-only, because the value inside is Sensitive on a shared machine. */
const INPUT_FILE_MODE = 0o600;

const INPUT_DIRECTORY_MODE = 0o700;

/**
 * A runtime input name is an environment-variable name. Anything else could
 * name a path, and a path could leave the isolated materialization.
 */
const RUNTIME_INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Copy the APPROVED Sensitive runtime inputs into one isolated materialization.
 *
 * Approval is the list of names the Activation receipt pinned: an input the
 * operator did not confirm at activation is refused here by name, and its value
 * is never read, copied, or reported. What travels onward is the NAME and the
 * SOURCE only; the value exists as a temporary file inside the materialization
 * and in the environment handed to the check process (`FR-CFG-006`,
 * `AC-CFG-004`, `SG-SECRET-001`).
 *
 * This module never reads an ambient environment, a credential store, or a
 * developer's files. Values arrive from the caller that resolved them.
 */
export const materializeRuntimeInputs = async ({
  approved = [],
  inputs = [],
  executionRoot = null,
} = {}) => {
  const confirmed = new Set(approved);
  const directory = executionRoot === null
    ? null
    : path.join(executionRoot, RUNTIME_INPUT_DIRECTORY);
  const record = [];
  const refused = [];
  const environment = {};
  const files = [];

  if (directory === null) {
    return {
      materialized: false,
      reasonCode: 'prerequisite-missing',
      directory: null,
      record,
      refused: inputs.map((input) => ({
        name: input?.name ?? null,
        source: input?.source ?? null,
        code: 'runtime-input-unmaterializable',
      })),
      environment,
      files,
      release: async () => ({ released: true, removed: [] }),
    };
  }

  await mkdir(directory, { recursive: true, mode: INPUT_DIRECTORY_MODE });

  for (const input of inputs) {
    const name = input?.name ?? null;
    const source = input?.source ?? null;

    if (typeof name !== 'string' || !confirmed.has(name)) {
      // Neither the value nor any derived form of it is reported.
      refused.push({ name, source, code: 'runtime-input-unapproved' });

      continue;
    }

    if (!RUNTIME_INPUT_NAME.test(name)) {
      refused.push({ name, source, code: 'runtime-input-name-invalid' });

      continue;
    }

    const file = path.join(directory, name);

    await writeFile(file, String(input.value ?? ''), { encoding: 'utf8', mode: INPUT_FILE_MODE });

    files.push(file);
    environment[name] = String(input.value ?? '');
    record.push({ name, source });
  }

  return {
    materialized: true,
    reasonCode: null,
    directory,
    // Name and source only. This is what a receipt, a decision, an envelope, or
    // a Lifecycle event is ever allowed to carry.
    record,
    refused,
    environment,
    files,
    /**
     * Remove the materialization, and with it every copied value. The removal
     * is bounded to the one directory this call created inside the isolated
     * execution root; nothing else is ever removed (`AC-CFG-004`).
     */
    release: async () => {
      if (path.basename(directory) !== RUNTIME_INPUT_DIRECTORY
        || path.dirname(directory) !== path.resolve(executionRoot)) {
        return { released: false, reasonCode: 'runtime-input-release-refused', removed: [] };
      }

      await rm(directory, { recursive: true, force: true });

      return { released: true, reasonCode: null, removed: [directory] };
    },
  };
};

const identityOf = (value) => `sha256:${createHash('sha256')
  .update(canonical(value ?? null))
  .digest('hex')}`;

/** The content identity a policy transition is approved by (`AC-CFG-003`). */
export const policyIdentity = (policy) => identityOf(policy);

/**
 * How strict each decision outcome is. A transition is decided by the stricter
 * of the two policies, never by the more permissive one.
 */
const OUTCOME_SEVERITY = Object.freeze({ passed: 0, failed: 1, unverified: 2 });

const stricter = (left, right) => (
  (OUTCOME_SEVERITY[left] ?? 2) >= (OUTCOME_SEVERITY[right] ?? 2) ? left : right
);

/**
 * Every way a candidate policy is weaker than the policy that is already
 * Trusted, in the terms the Gate policy contract actually expresses.
 *
 * This list is DIAGNOSTIC. It is not what protects the transition: the
 * protection is that the Trusted policy decides the outcome no matter what the
 * candidate says about itself (`SG-CFG-001`).
 */
export const policyWeakenings = (trusted, candidate) => {
  const trustedRequired = trusted?.checks?.required ?? [];
  const candidateRequired = new Set(candidate?.checks?.required ?? []);
  const candidateAdvisory = new Set(candidate?.checks?.advisory ?? []);
  const weakenings = [];

  for (const checkId of trustedRequired) {
    if (candidateRequired.has(checkId)) {
      continue;
    }

    weakenings.push(candidateAdvisory.has(checkId)
      ? {
        code: 'required-check-demoted',
        checkId,
        detail: `The candidate demotes required check ${JSON.stringify(checkId)} to advisory.`,
      }
      : {
        code: 'required-check-removed',
        checkId,
        detail: `The candidate no longer binds required check ${JSON.stringify(checkId)} at all.`,
      });
  }

  return weakenings;
};

const outcomeUnder = (checks, policy) => {
  const { bound } = bindPolicy(checks ?? [], policy ?? null);

  return decisionOutcome(bound);
};

/**
 * Evaluate one policy-surface change under BOTH the prior Trusted gate
 * configuration and the candidate configuration it proposes.
 *
 * A candidate is evaluated against the policy that is already Trusted. Its own
 * policy is applied as well — a transition may not advance while the
 * configuration it proposes is itself unsatisfied — but the candidate never
 * gets to decide the transition that would make it Trusted (`FR-CFG-005`,
 * `AC-CFG-003`, `SG-CFG-001`).
 */
export const evaluatePolicyTransition = ({
  trusted = null,
  candidate = null,
  checks = [],
  role = 'preflight',
  approval = null,
} = {}) => {
  const trustedPolicy = trusted?.policy ?? null;
  const candidatePolicy = candidate?.policy ?? null;
  // A candidate is validated as a candidate: on its own terms, before anything
  // it proposes is allowed to bound an evaluation (`AC-CFG-003`).
  const trustedErrors = validateGatePolicy(trustedPolicy);
  const candidateErrors = validateGatePolicy(candidatePolicy);
  const trustedOutcome = outcomeUnder(checks, trustedPolicy);
  const candidateOutcome = candidateErrors.length > 0
    ? 'unverified'
    : outcomeUnder(checks, candidatePolicy);
  const weakenings = policyWeakenings(trustedPolicy, candidatePolicy);
  const outcome = stricter(trustedOutcome, candidateOutcome);
  const candidateId = candidate?.identity ?? policyIdentity(candidatePolicy);
  // Ordered by what a reader must fix first. The Trusted policy is named before
  // the candidate's own result, and evidence is named before approval: an
  // operator is never asked to approve a transition that could not advance.
  const refusal = () => {
    if (candidateErrors.length > 0) {
      return 'candidate-policy-invalid';
    }

    if (trustedOutcome !== 'passed') {
      return 'trusted-policy-unsatisfied';
    }

    if (candidateOutcome !== 'passed') {
      return 'candidate-policy-unsatisfied';
    }

    if (typeof approval?.candidateId !== 'string' || approval.candidateId.length === 0) {
      return 'approval-missing';
    }

    return approval.candidateId === candidateId ? null : 'approval-mismatch';
  };
  const reasonCode = refusal();
  const advanced = reasonCode === null;

  return {
    trustedId: trusted?.identity ?? policyIdentity(trustedPolicy),
    candidateId,
    trusted: {
      outcome: trustedOutcome,
      valid: trustedErrors.length === 0,
      errors: trustedErrors,
    },
    candidate: {
      outcome: candidateOutcome,
      valid: candidateErrors.length === 0,
      errors: candidateErrors,
    },
    weakened: weakenings.length > 0,
    weakenings,
    outcome,
    authorization: authorizationFor(role, outcome),
    advanced,
    // Trust advances to the exact configuration that was approved by hash, and
    // to nothing else.
    trustedNext: advanced ? candidateId : null,
    approval: approval === null ? null : {
      candidateId: approval.candidateId ?? null,
      grantedBy: approval.grantedBy ?? null,
      at: approval.at ?? null,
    },
    reasonCode,
  };
};
