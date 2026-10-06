export const parseYamlScalar = (value) => {
  const trimmed = value.trim();

  return trimmed.startsWith('"') ? JSON.parse(trimmed) : trimmed;
};

export const yamlScalar = (value) => {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }

  return /^[a-z0-9_./-]+$/i.test(value) ? value : JSON.stringify(value);
};

const yamlList = (values, indentation = 2) => {
  return values
    .map((value) => `${' '.repeat(indentation)}- ${yamlScalar(value)}`)
    .join('\n');
};

export const appendYamlList = (lines, key, values, indentation = 0) => {
  const prefix = ' '.repeat(indentation);

  if (values.length === 0) {
    lines.push(`${prefix}${key}: []`);
    return;
  }

  lines.push(`${prefix}${key}:`);
  lines.push(yamlList(values, indentation + 2));
};
