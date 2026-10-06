import { revisionRefusal } from '../refusals.mjs';
import { isPlainObject, listOrEmpty } from '../values.mjs';

const nothingToRevise = (detail) => revisionRefusal(
  'nothing-to-revise',
  `${detail}, so this revision changes nothing; nothing was written.`,
);

/** `subcontract` with `value` appended to its `key` list. */
const withListed = (subcontract, key, value) => ({ ...subcontract, [key]: [...listOrEmpty(subcontract[key]), value] });

/** `subcontract` with `value` gone from its `key` list, which stays declared. */
const withoutListed = (subcontract, key, value) => (
  Array.isArray(subcontract[key])
    ? { ...subcontract, [key]: subcontract[key].filter((declared) => declared !== value) }
    : subcontract
);

/**
 * `checks` with one bound check moved from one severity to the other.
 *
 * Only a check the policy already binds moves: an identity bound as neither is
 * refused rather than bound, because binding a check is not a severity change
 * and which identities a profile resolves is Verification's (`SG-OWNER-001`).
 */
const movedCheck = (checks, check, from, to) => {
  if (listOrEmpty(checks[to]).includes(check)) {
    throw nothingToRevise(`check ${check} is already ${to}`);
  }

  if (!listOrEmpty(checks[from]).includes(check)) {
    throw revisionRefusal(
      'check-unbound',
      `check ${check} is not bound by the Gate policy, so there is no severity to change: a revision moves only a check the policy already binds between required and advisory, and never binds a new one or edits a Verification profile command. Nothing was written.`,
    );
  }

  return { ...checks, [from]: checks[from].filter((declared) => declared !== check), [to]: [...listOrEmpty(checks[to]), check] };
};

/**
 * `true` and `false` as the booleans they spell; any other value as given, so
 * the Gate policy validator refuses it with its own reason.
 */
const spelledBoolean = (value) => {
  if (value === 'true') {
    return true;
  }

  return value === 'false' ? false : value;
};

/**
 * `execution` with one root given `provisioning`, changing as little of the
 * declaration as that takes, and returned as is when the root already has it.
 *
 * A single strategy that differs becomes the per-root map the Gate validator
 * accepts, every other declared root keeping the strategy it already had, so
 * no root's provisioning moves except the one named. Which strategy a root
 * gets when nothing names it is the Gate's default and is not restated here.
 */
const withRootProvisioning = (execution, root, provisioning) => {
  const declared = execution.dependency_provisioning;

  if (typeof declared === 'string') {
    return declared === provisioning ? execution : {
      ...execution,
      dependency_provisioning: {
        ...Object.fromEntries(listOrEmpty(execution.dependency_roots).map((declaredRoot) => [declaredRoot, declared])),
        [root]: provisioning,
      },
    };
  }

  if (isPlainObject(declared) && Object.hasOwn(declared, root) && declared[root] === provisioning) {
    return execution;
  }

  return {
    ...execution,
    dependency_provisioning: { ...(isPlainObject(declared) ? declared : {}), [root]: provisioning },
  };
};

/**
 * The named revisions of the Gate configuration section (`FR-GUIDE-006`).
 *
 * Each changes one subcontract and nothing else: `argument` is the value it
 * names, `options` the optional values it accepts, and `revise` derives the
 * revised subcontract from the current one, or refuses when the revision would
 * change nothing. None of them judges the candidate — the Gate policy
 * validator `configure-gate` loads does, after (`SG-OWNER-001`): a value it
 * would refuse, such as an enabled bypass with no marker, reaches it as given
 * and is refused with its own reason. `TB-069` added the `execution` rows;
 * `TB-070` the `evidence`, `checks`, `budget`, and `bypass` rows.
 *
 * A Sensitive runtime input is declared by name, and the source it may be
 * resolved from besides the environment by naming its environment file; no
 * value is read, asked for, or written (`SG-SECRET-001`). A check is moved or
 * removed only when the policy already binds it, so no revision binds a new
 * check, and none adds or edits a Verification profile command or an
 * `allowed_environment`, which is never a Gate policy property.
 */
export const gateRevisions = Object.freeze({
  'add-dependency-root': Object.freeze({
    subcontract: 'execution',
    argument: 'root',
    options: Object.freeze(['provisioning']),
    revise: (execution, { root, provisioning }) => {
      const roots = listOrEmpty(execution.dependency_roots);

      if (roots.includes(root)) {
        throw nothingToRevise(`dependency root ${root} is already declared`);
      }

      const added = { ...execution, dependency_roots: [...roots, root] };

      return provisioning === undefined ? added : withRootProvisioning(added, root, provisioning);
    },
  }),
  'remove-dependency-root': Object.freeze({
    subcontract: 'execution',
    argument: 'root',
    options: Object.freeze([]),
    revise: (execution, { root }) => {
      const roots = listOrEmpty(execution.dependency_roots);

      if (!roots.includes(root)) {
        throw nothingToRevise(`dependency root ${root} is not declared`);
      }

      const removed = { ...execution, dependency_roots: roots.filter((declared) => declared !== root) };
      const declared = execution.dependency_provisioning;

      // A map may name only declared roots, so the removed root leaves it too;
      // a map that named nothing else says what no map says.
      if (isPlainObject(declared) && Object.hasOwn(declared, root)) {
        const { [root]: _removed, ...others } = declared;

        if (Object.keys(others).length === 0) {
          delete removed.dependency_provisioning;
        } else {
          removed.dependency_provisioning = others;
        }
      }

      return removed;
    },
  }),
  'set-dependency-provisioning': Object.freeze({
    subcontract: 'execution',
    argument: 'provisioning',
    options: Object.freeze(['root']),
    revise: (execution, { provisioning, root }) => {
      if (root === undefined) {
        if (execution.dependency_provisioning === provisioning) {
          throw nothingToRevise(`every dependency root is already provided by ${provisioning}`);
        }

        return { ...execution, dependency_provisioning: provisioning };
      }

      const revised = withRootProvisioning(execution, root, provisioning);

      if (revised === execution) {
        throw nothingToRevise(`dependency root ${root} is already provided by ${provisioning}`);
      }

      return revised;
    },
  }),
  'add-budget-skippable': Object.freeze({
    subcontract: 'execution',
    argument: 'check',
    options: Object.freeze([]),
    revise: (execution, { check }) => {
      const skippable = listOrEmpty(execution.budget_skippable);

      if (skippable.includes(check)) {
        throw nothingToRevise(`check ${check} is already budget-skippable`);
      }

      return { ...execution, budget_skippable: [...skippable, check] };
    },
  }),
  'remove-budget-skippable': Object.freeze({
    subcontract: 'execution',
    argument: 'check',
    options: Object.freeze([]),
    revise: (execution, { check }) => {
      const skippable = listOrEmpty(execution.budget_skippable);

      if (!skippable.includes(check)) {
        throw nothingToRevise(`check ${check} is not budget-skippable`);
      }

      return { ...execution, budget_skippable: skippable.filter((declared) => declared !== check) };
    },
  }),
  'add-sensitive-input': Object.freeze({
    subcontract: 'evidence',
    argument: 'name',
    options: Object.freeze(['environment-file']),
    revise: (evidence, { name, 'environment-file': file }) => {
      const addsName = !listOrEmpty(evidence.sensitive_inputs).includes(name);
      const addsFile = file !== undefined && !listOrEmpty(evidence.environment_files).includes(file);

      if (!addsName && !addsFile) {
        throw nothingToRevise(file === undefined
          ? `Sensitive runtime input ${name} is already declared`
          : `Sensitive runtime input ${name} and environment file ${file} are already declared`);
      }

      const named = addsName ? withListed(evidence, 'sensitive_inputs', name) : evidence;

      return addsFile ? withListed(named, 'environment_files', file) : named;
    },
  }),
  'remove-sensitive-input': Object.freeze({
    subcontract: 'evidence',
    argument: 'name',
    options: Object.freeze([]),
    revise: (evidence, { name }) => {
      if (!listOrEmpty(evidence.sensitive_inputs).includes(name)) {
        throw nothingToRevise(`Sensitive runtime input ${name} is not declared`);
      }

      return withoutListed(evidence, 'sensitive_inputs', name);
    },
  }),
  'add-environment-file': Object.freeze({
    subcontract: 'evidence',
    argument: 'file',
    options: Object.freeze([]),
    revise: (evidence, { file }) => {
      if (listOrEmpty(evidence.environment_files).includes(file)) {
        throw nothingToRevise(`environment file ${file} is already declared`);
      }

      return withListed(evidence, 'environment_files', file);
    },
  }),
  'remove-environment-file': Object.freeze({
    subcontract: 'evidence',
    argument: 'file',
    options: Object.freeze([]),
    revise: (evidence, { file }) => {
      if (!listOrEmpty(evidence.environment_files).includes(file)) {
        throw nothingToRevise(`environment file ${file} is not declared`);
      }

      return withoutListed(evidence, 'environment_files', file);
    },
  }),
  'promote-check': Object.freeze({
    subcontract: 'checks',
    argument: 'check',
    options: Object.freeze([]),
    revise: (checks, { check }) => movedCheck(checks, check, 'advisory', 'required'),
  }),
  'demote-check': Object.freeze({
    subcontract: 'checks',
    argument: 'check',
    options: Object.freeze([]),
    revise: (checks, { check }) => movedCheck(checks, check, 'required', 'advisory'),
  }),
  'remove-check': Object.freeze({
    subcontract: 'checks',
    argument: 'check',
    options: Object.freeze([]),
    revise: (checks, { check }) => {
      if (![...listOrEmpty(checks.required), ...listOrEmpty(checks.advisory)].includes(check)) {
        throw nothingToRevise(`check ${check} is not bound by the Gate policy`);
      }

      return withoutListed(withoutListed(checks, 'required', check), 'advisory', check);
    },
  }),
  'set-budget': Object.freeze({
    subcontract: 'budget',
    argument: 'seconds',
    options: Object.freeze([]),
    revise: (budget, { seconds }) => {
      // Digits are the number they spell; anything else reaches the validator as given.
      const total = /^\d+$/.test(seconds) ? Number(seconds) : seconds;

      if (budget.total_seconds === total) {
        throw nothingToRevise(`the total budget is already ${total} seconds`);
      }

      return { ...budget, total_seconds: total };
    },
  }),
  'set-bypass': Object.freeze({
    subcontract: 'bypass',
    argument: 'enabled',
    options: Object.freeze(['marker', 'require-reference']),
    revise: (bypass, { enabled, marker, 'require-reference': requireReference }) => {
      const revised = {
        ...bypass,
        enabled: spelledBoolean(enabled),
        ...(marker === undefined ? {} : { marker }),
        ...(requireReference === undefined ? {} : { require_reference: spelledBoolean(requireReference) }),
      };

      if (JSON.stringify(revised) === JSON.stringify(bypass)) {
        throw nothingToRevise(`bypass is already ${JSON.stringify(bypass)}`);
      }

      return revised;
    },
  }),
});
