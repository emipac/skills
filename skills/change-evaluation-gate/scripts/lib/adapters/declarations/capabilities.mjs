import { ADAPTER_CAPABILITY_CATEGORIES, ADAPTER_TRUST_MODELS, CAPABILITY_FIELDS, CLIENT_REVIEW_FIELDS, FEEDBACK_ABSENCES } from './contracts.mjs';
import { isPlainObject } from '../values.mjs';

/**
 * Check what an adapter declared about trust against what a trust model is.
 *
 * This is the check whose absence let `explicit-workspace-grant` pass every
 * review this project has: the categories were validated and the value inside
 * one of them was not. A model nothing defines is rejected here, at declaration
 * time, rather than becoming a pause nothing can clear at activation time
 * (`TB-046`, `FR-LIFE-016`).
 */
const trustDeclarationErrors = (trust) => {
  if (!isPlainObject(trust) || !('model' in trust)) {
    // The missing-category and missing-field checks already said so.
    return [];
  }

  const errors = [];
  const declared = ADAPTER_TRUST_MODELS[trust.model] ?? null;

  if (declared === null) {
    errors.push({
      code: 'adapter-trust-model-undefined',
      path: 'capabilities.trust.model',
      message: `${JSON.stringify(trust.model)} is not a trust model this contract defines, so nothing states what it asserts or what would prove it.`,
    });
  } else if (declared.declarable !== true) {
    errors.push({
      code: 'adapter-trust-model-undeclarable',
      path: 'capabilities.trust.model',
      message: `${JSON.stringify(trust.model)} is defined but cannot be established before an activation registers anything, so an adapter declaring it would pause at trust with nothing able to clear the pause: ${declared.rationale}`,
    });
  }

  if ('clientReview' in trust && trust.clientReview !== null) {
    if (!isPlainObject(trust.clientReview)) {
      errors.push({
        code: 'adapter-client-review-invalid',
        path: 'capabilities.trust.clientReview',
        message: 'A declared client review must be an object, or null where the client performs none.',
      });
    } else {
      for (const field of CLIENT_REVIEW_FIELDS) {
        if (!(field in trust.clientReview)) {
          errors.push({
            code: 'adapter-client-review-incomplete',
            path: `capabilities.trust.clientReview.${field}`,
            message: `A declared client review must state ${field}.`,
          });
        }
      }
    }
  }

  return errors;
};

/**
 * Check what an adapter declared about its feedback against what an absence of
 * a channel is (`TB-048`).
 *
 * A declaration with no channel must say why, in a value `FEEDBACK_ABSENCES`
 * defines, and `not-needed` is coherent only beside native blocking. A
 * declaration with a channel states no absence.
 */
const feedbackDeclarationErrors = (capabilities) => {
  const feedback = capabilities.feedback;

  if (!isPlainObject(feedback) || !('channel' in feedback)) {
    // The missing-category and missing-field checks already said so.
    return [];
  }

  if (feedback.channel !== null) {
    return 'absence' in feedback && feedback.absence !== null
      ? [{
        code: 'adapter-feedback-absence-contradictory',
        path: 'capabilities.feedback.absence',
        message: `A declaration naming the feedback channel ${JSON.stringify(feedback.channel)} has no absence to explain; absence must be null beside a channel.`,
      }]
      : [];
  }

  const declared = FEEDBACK_ABSENCES[feedback.absence] ?? null;

  if (declared === null) {
    return [{
      code: 'adapter-feedback-absence-undeclared',
      path: 'capabilities.feedback.absence',
      message: `A declaration with no feedback channel must say why: ${Object.keys(FEEDBACK_ABSENCES).map((id) => JSON.stringify(id)).join(' or ')}. ${JSON.stringify(feedback.absence ?? null)} says neither, so nothing can tell a surface that needs no channel from one nobody has observed.`,
    }];
  }

  if (declared.requiresNativeBlocking && capabilities.blocking?.native !== true) {
    return [{
      code: 'adapter-feedback-absence-incoherent',
      path: 'capabilities.feedback.absence',
      message: `${JSON.stringify(declared.id)} asserts that ${declared.asserts} This surface declares no native blocking, so it has no answer that is not a channel.`,
    }];
  }

  return [];
};

/**
 * Validate one adapter capability declaration.
 *
 * A missing category is an error rather than a default, and an unknown one is
 * an error rather than an ignored extra: an adapter that does not state a
 * capability has not declared it, and a gate that defaults it would be
 * assuming another client's contract (FR-ADAPT-004).
 */
export const validateAdapterDeclaration = (capabilities) => {
  if (!isPlainObject(capabilities)) {
    return [{
      code: 'adapter-capability-invalid',
      path: 'capabilities',
      message: 'An adapter capability declaration must be an object.',
    }];
  }

  const errors = [];

  for (const category of ADAPTER_CAPABILITY_CATEGORIES) {
    if (!isPlainObject(capabilities[category])) {
      errors.push({
        code: 'adapter-capability-missing',
        path: `capabilities.${category}`,
        message: `An adapter must declare its ${category} capability explicitly.`,
      });

      continue;
    }

    for (const field of CAPABILITY_FIELDS[category]) {
      if (!(field in capabilities[category])) {
        errors.push({
          code: 'adapter-capability-incomplete',
          path: `capabilities.${category}.${field}`,
          message: `The ${category} capability must state ${field}.`,
        });
      }
    }
  }

  for (const category of Object.keys(capabilities)) {
    if (!ADAPTER_CAPABILITY_CATEGORIES.includes(category)) {
      errors.push({
        code: 'adapter-capability-unknown',
        path: `capabilities.${category}`,
        message: `${category} is not a declared adapter capability category.`,
      });
    }
  }

  errors.push(...trustDeclarationErrors(capabilities.trust));
  errors.push(...feedbackDeclarationErrors(capabilities));

  return errors;
};
