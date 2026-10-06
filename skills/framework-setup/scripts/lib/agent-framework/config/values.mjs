import { gatePolicyKeys } from '../../../configure.mjs';

/**
 * A JSON value with every object's keys in one order, so two values compare
 * equal exactly when they hold the same data.
 */
export const canonical = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
};

/** One key of one subcontract, as `{ declared, value }`; an absent key is not declared. */
const declaredAt = (subcontract, key) => (
  subcontract !== null && typeof subcontract === 'object' && Object.hasOwn(subcontract, key)
    ? { declared: true, value: subcontract[key] }
    : { declared: false, value: null }
);

const isNameList = (entry) => !entry.declared
  || (Array.isArray(entry.value) && entry.value.every((item) => typeof item === 'string'));

/**
 * One value of the working section beside the pinned one.
 *
 * `marking` is `null` when nothing is pinned, `unrecoverable` when the Gate
 * knows the pinned section only by its identity, and otherwise `matches` or
 * `differs`. A differing list of names also says which names were added and
 * which removed.
 */
const shownValue = ({ key, working, pinned }) => {
  const value = declaredAt(working, key);
  const pinnedValue = pinned === undefined || pinned === null ? null : declaredAt(pinned, key);
  let marking = null;

  if (pinned === null) {
    marking = 'unrecoverable';
  } else if (pinnedValue !== null) {
    marking = value.declared === pinnedValue.declared && canonical(value.value) === canonical(pinnedValue.value)
      ? 'matches'
      : 'differs';
  }

  const listed = marking === 'differs' && isNameList(value) && isNameList(pinnedValue);
  const names = (entry) => (entry.declared ? entry.value : []);

  return {
    key,
    ...value,
    pinned: pinnedValue,
    marking,
    added: listed ? names(value).filter((name) => !names(pinnedValue).includes(name)) : null,
    removed: listed ? names(pinnedValue).filter((name) => !names(value).includes(name)) : null,
  };
};

/**
 * Every subcontract by name, each value marked against the pinned section.
 * `pinned` is `undefined` when nothing is pinned and `null` when the pinned
 * values are unrecoverable. A key only the pinned section declares is shown
 * too, as not set.
 */
export const shownSubcontracts = (working, pinned) => gatePolicyKeys.map((name) => {
  const pinnedSubcontract = pinned === undefined || pinned === null ? pinned : (pinned[name] ?? {});
  const keys = [...new Set([
    ...Object.keys(working[name] ?? {}),
    ...Object.keys(pinnedSubcontract ?? {}),
  ])];

  return {
    name,
    values: keys.map((key) => shownValue({ key, working: working[name] ?? {}, pinned: pinnedSubcontract })),
  };
});
