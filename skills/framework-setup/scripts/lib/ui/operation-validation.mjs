export class UIInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UIInputError';
    this.code = 'invalid-operation-input';
    this.status = 400;
  }
}

const plain = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const invalid = () => { throw new UIInputError('Operation fields do not match the published contract.'); };
const boundedJSON = (value, depth = 0) => {
  if (depth > 12) invalid();
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!Array.isArray(value) && !plain(value)) invalid();
  if (Object.keys(value).length > 256) invalid();
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid();
    boundedJSON(child, depth + 1);
  }
};

export const validateRequest = (request, catalog) => {
  if (!plain(request) || Object.keys(request).some((key) => !['operation', 'fields', 'confirmation'].includes(key))) invalid();
  const descriptor = catalog.find(({ id }) => id === request.operation);
  if (!descriptor) invalid();
  const fields = request.fields ?? {};
  if (!plain(fields) || Object.keys(fields).some((key) => !Object.hasOwn(descriptor.fields, key))) invalid();
  for (const [name, schema] of Object.entries(descriptor.fields)) {
    const value = fields[name];
    if (value === undefined && !schema.required) continue;
    if (schema.type === 'string' && (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.startsWith('-') || /[\0\r\n]/.test(value))) invalid();
    if (schema.type === 'boolean' && typeof value !== 'boolean') invalid();
    if (schema.type === 'integer' && (!Number.isSafeInteger(value) || value < 0)) invalid();
    if (schema.type === 'strings' && (!Array.isArray(value) || value.length > 128 || value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 4096 || item.startsWith('-') || /[\0\r\n]/.test(item)))) invalid();
    if (schema.options && !schema.options.includes(value)) invalid();
    if (schema.type === 'object') {
      if (!plain(value)) invalid();
      boundedJSON(value);
      if (JSON.stringify(value).length > 65536) invalid();
    }
  }
  const confirmation = request.confirmation ?? null;
  if (descriptor.id === 'gate:history') {
    if (fields.limit !== undefined && (fields.limit < 1 || fields.limit > 100)) invalid();
    for (const key of ['evidence', 'blob']) {
      if (fields[key] !== undefined && !/^sha256:[0-9a-f]{64}$/.test(fields[key])) invalid();
    }
    if (fields.blob !== undefined && fields.evidence === undefined) invalid();
  }
  if (confirmation !== null && (!descriptor.previewable || typeof confirmation !== 'string'
    || !/^(?:sha256:)?[0-9a-f]{64}$/.test(confirmation))) invalid();
  return { descriptor, fields, confirmation };
};
