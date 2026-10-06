export const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export const listOrEmpty = (value) => (Array.isArray(value) ? value : []);

export const sortUnique = (values) => [...new Set(values)].sort();
