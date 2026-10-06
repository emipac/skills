export const parseArguments = (argumentsList) => {
  const options = {};

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if ([
      '--discover',
      '--migrate-v4',
      '--configure-gate',
      '--draft-mapping',
      '--draft-policy',
    ].includes(argument)) {
      options[argument.slice(2)] = true;
      continue;
    }

    if (argument.startsWith('--')) {
      options[argument.slice(2)] = argumentsList[index + 1];
      index += 1;
    }
  }

  return options;
};

export const nullableArgument = (value) => value === 'null' ? null : value;

export const listArgument = (value) => (
  value === undefined || value === ''
    ? []
    : value.split(',').map((item) => item.trim()).filter(Boolean)
);

export const sourceScopeArguments = (options) => (
  ['backend-scopes', 'frontend-scopes', 'shared-scopes']
    .some((key) => options[key] !== undefined)
    ? {
        backend: listArgument(options['backend-scopes']),
        frontend: listArgument(options['frontend-scopes']),
        shared: listArgument(options['shared-scopes']),
      }
    : undefined
);

export const scriptScopeArguments = (options) => Object.fromEntries(
  ['backend', 'frontend', 'both'].flatMap((scope) => (
    listArgument(options[`${scope}-scripts`]).map((script) => [script, scope])
  )),
);
