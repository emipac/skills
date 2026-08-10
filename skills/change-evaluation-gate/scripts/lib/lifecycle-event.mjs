/**
 * Lifecycle events.
 *
 * Every governed lifecycle and integrity action creates exactly one immutable
 * local record: configuration approval, activation, update, repair, removal,
 * trust, evaluation, bypass, pruning, stale-lock recovery, and detected drift
 * (FR-EVID-005).
 *
 * Each record states UTC time, a best-effort actor that is explicitly
 * unauthenticated, the acting client and gate identity, the repository
 * identity, the relevant before and after hashes, the outcome, the reason, and
 * the redaction metadata (NFR-AUD-001).
 *
 * Actor attribution is a local convenience, never an authentication claim: a
 * machine owner controls every input to it (SG-TRUST-001). `authenticated` is
 * therefore always `false` and cannot be set.
 *
 * Later slices emit their own event types through this same contract; nothing
 * here knows what activation, trust, or coordination mean.
 */

import { createHash } from 'node:crypto';

export const LIFECYCLE_EVENT_VERSION = 'change-evaluation-gate/lifecycle/v1';

/** Every governed action that must leave a record (FR-EVID-005). */
export const LIFECYCLE_EVENT_TYPES = Object.freeze([
  'configuration-approval',
  'activation',
  'update',
  'repair',
  'removal',
  'trust',
  'evaluation',
  'bypass',
  'pruning',
  'stale-lock-recovery',
  'drift-detected',
]);

export const LIFECYCLE_OUTCOMES = Object.freeze(['succeeded', 'refused', 'failed', 'detected']);

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isPlainObject = (value) => typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

const isHash = (value) => value === null || /^sha256:[0-9a-f]{64}$/.test(value ?? '');

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
 * Normalize one lifecycle event. The returned record is complete and
 * content-addressed; the store only ever appends it.
 */
export const createLifecycleEvent = (input = {}, { clock = () => new Date() } = {}) => {
  const body = {
    eventVersion: LIFECYCLE_EVENT_VERSION,
    type: input.type ?? null,
    occurredAt: isNonEmptyString(input.occurredAt)
      ? input.occurredAt
      : clock().toISOString(),
    actor: {
      name: input.actor?.name ?? null,
      source: input.actor?.source ?? null,
      // Local attribution is best effort. Nothing may claim otherwise.
      authenticated: false,
    },
    client: {
      id: input.client?.id ?? null,
      surface: input.client?.surface ?? null,
      version: input.client?.version ?? null,
    },
    gate: {
      id: input.gate?.id ?? null,
      version: input.gate?.version ?? null,
      protocolVersion: input.gate?.protocolVersion ?? null,
    },
    repository: {
      identity: input.repository?.identity ?? null,
      gitCommonDirectory: input.repository?.gitCommonDirectory ?? null,
    },
    before: input.before ?? null,
    after: input.after ?? null,
    outcome: input.outcome ?? null,
    reason: input.reason ?? null,
    redaction: {
      version: input.redaction?.version ?? null,
      applied: Number.isInteger(input.redaction?.applied) ? input.redaction.applied : 0,
      rules: Array.isArray(input.redaction?.rules) ? input.redaction.rules : [],
    },
  };

  return {
    ...body,
    eventId: `sha256:${createHash('sha256').update(canonical(body)).digest('hex')}`,
  };
};

/**
 * Audit one event against the schema every event-producing operation must
 * satisfy (NFR-AUD-001).
 */
export const validateLifecycleEvent = (event) => {
  const errors = [];
  const error = (path, message) => errors.push({ code: 'lifecycle-event-invalid', path, message });

  if (!isPlainObject(event)) {
    return [{
      code: 'lifecycle-event-invalid',
      path: '<event>',
      message: 'A lifecycle event must be an object.',
    }];
  }

  if (event.eventVersion !== LIFECYCLE_EVENT_VERSION) {
    error('event.eventVersion', `A lifecycle event must declare ${LIFECYCLE_EVENT_VERSION}.`);
  }

  if (!LIFECYCLE_EVENT_TYPES.includes(event.type)) {
    error('event.type', `A lifecycle event must name one governed action: ${LIFECYCLE_EVENT_TYPES.join(', ')}.`);
  }

  if (!UTC_INSTANT.test(event.occurredAt ?? '')) {
    error('event.occurredAt', 'A lifecycle event must record the UTC instant it occurred.');
  }

  if (!isPlainObject(event.actor) || event.actor.authenticated !== false) {
    error('event.actor', 'A lifecycle event must record a best-effort actor that is explicitly unauthenticated.');
  }

  for (const section of ['client', 'gate']) {
    if (!isPlainObject(event[section]) || !isNonEmptyString(event[section].id)) {
      error(`event.${section}`, `A lifecycle event must record the ${section} identity.`);
    }
  }

  if (!isPlainObject(event.repository) || !isNonEmptyString(event.repository.identity)) {
    error('event.repository', 'A lifecycle event must record the repository identity.');
  }

  for (const field of ['before', 'after']) {
    if (!(event[field] === null || isNonEmptyString(event[field]))) {
      error(`event.${field}`, `A lifecycle event must record its ${field} hash or null.`);
    }
  }

  if (!LIFECYCLE_OUTCOMES.includes(event.outcome)) {
    error('event.outcome', `A lifecycle event outcome must be one of: ${LIFECYCLE_OUTCOMES.join(', ')}.`);
  }

  if (!isNonEmptyString(event.reason)) {
    error('event.reason', 'A lifecycle event must state why it was recorded.');
  }

  if (!isPlainObject(event.redaction) || !Array.isArray(event.redaction.rules)) {
    error('event.redaction', 'A lifecycle event must carry its redaction metadata.');
  }

  if (!isHash(event.eventId === null ? null : event.eventId)) {
    error('event.eventId', 'A lifecycle event must carry its content identity.');
  }

  return errors;
};
