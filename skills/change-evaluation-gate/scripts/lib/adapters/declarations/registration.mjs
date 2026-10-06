import { isPlainObject } from '../values.mjs';

/** The registration surface kinds an adapter may declare (FR-ADAPT-008). */
export const REGISTRATION_SURFACE_KINDS = Object.freeze([
  'client-configuration-file',
  'repository-hook-chain',
]);

/** The block schemas a declared client configuration surface may use. */
export const REGISTRATION_BLOCK_SCHEMAS = Object.freeze(['matcher-group', 'flat-command']);

/**
 * What a client-configuration registration surface must state.
 *
 * `schemaVersion` is required even when it is `null`, because "this format is
 * not independently versioned" is a claim about the client, not an absence.
 */
const REGISTRATION_FIELDS = Object.freeze([
  'file',
  'ownership',
  'container',
  'trigger',
  'blockSchema',
  'matcher',
  'commandType',
  'schemaVersion',
]);

/**
 * Validate one adapter registration declaration.
 *
 * A missing field is an error rather than a default and an unknown block schema
 * is an error rather than a guess: an adapter that has not stated where and how
 * it registers has not declared a registration surface, and a gate that filled
 * one in would be assuming another client's file, block shape, or format
 * version (FR-ADAPT-008, AC-ADAPT-003).
 */
export const validateRegistrationDeclaration = (registration) => {
  if (!isPlainObject(registration)) {
    return [{
      code: 'adapter-registration-invalid',
      path: 'registration',
      message: 'An adapter must declare its registration surface.',
    }];
  }

  if (!REGISTRATION_SURFACE_KINDS.includes(registration.kind)) {
    return [{
      code: 'adapter-registration-kind-unknown',
      path: 'registration.kind',
      message: `${registration.kind} is not a declared registration surface kind.`,
    }];
  }

  // A surface that registers through this clone's own hook chain states that,
  // and owes nothing about a client configuration file it never writes.
  if (registration.kind !== 'client-configuration-file') {
    return [];
  }

  const errors = REGISTRATION_FIELDS
    .filter((field) => !(field in registration))
    .map((field) => ({
      code: 'adapter-registration-incomplete',
      path: `registration.${field}`,
      message: `A client configuration registration surface must state ${field}.`,
    }));

  if ('blockSchema' in registration
    && !REGISTRATION_BLOCK_SCHEMAS.includes(registration.blockSchema)) {
    errors.push({
      code: 'adapter-registration-schema-unknown',
      path: 'registration.blockSchema',
      message: `${registration.blockSchema} is not a declared registration block schema.`,
    });
  }

  return errors;
};
