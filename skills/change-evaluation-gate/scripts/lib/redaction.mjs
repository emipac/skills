/**
 * Redaction at the persistence boundary.
 *
 * A raw Sensitive value must never reach an Evidence envelope, an output blob,
 * or a Lifecycle event. Redaction therefore happens before anything is written,
 * not after, and the store proves the result before it commits it: if a
 * declared value survives redaction in any recognized form, the capture is
 * unsafe and nothing is persisted (SG-SECRET-001, NFR-SEC-003, RISK-006).
 *
 * The name and the source of a Sensitive runtime input may be recorded; its
 * value may not (FR-CFG-006).
 *
 * Approving and injecting Sensitive runtime inputs is a separate concern. This
 * module only receives the declarations and guards the boundary.
 */

/** What replaces every redacted span. Its presence is the redaction evidence. */
export const REDACTION_PLACEHOLDER = '[redacted]';

export const REDACTION_VERSION = 'change-evaluation-gate/redaction/v1';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Shapes that carry a secret even when no value was declared. These are a net,
 * not a guarantee: a declared value is what the store actually proves absent.
 */
const BUILT_IN_PATTERNS = Object.freeze([
  {
    rule: 'authorization-header',
    pattern: /\b(authorization\s*[:=]\s*)(bearer|basic|token)?\s*[\w.~+/=-]{16,}/gi,
    replace: (match, prefix, scheme) => `${prefix}${scheme ? `${scheme} ` : ''}${REDACTION_PLACEHOLDER}`,
  },
  {
    rule: 'credential-assignment',
    pattern: /\b([A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL)[A-Z0-9_]*)(\s*[:=]\s*)("?)([^\s"']{6,})\3/gi,
    replace: (match, name, separator, quote) => `${name}${separator}${quote}${REDACTION_PLACEHOLDER}${quote}`,
  },
  {
    rule: 'url-userinfo',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):([^\s@/]+)@/gi,
    replace: (match, prefix) => `${prefix}:${REDACTION_PLACEHOLDER}@`,
  },
  {
    rule: 'private-key-block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    replace: () => REDACTION_PLACEHOLDER,
  },
]);

/**
 * Every form of a declared value the store recognizes. A secret that survives
 * as one of these is exactly what the residual scan looks for, so redaction and
 * proof always agree about what "present" means.
 */
export const secretForms = (value) => {
  const raw = String(value ?? '');

  if (raw.length === 0) {
    return [];
  }

  return [...new Set([
    raw,
    Buffer.from(raw, 'utf8').toString('base64'),
    Buffer.from(raw, 'utf8').toString('base64url'),
    Buffer.from(raw, 'utf8').toString('hex'),
    encodeURIComponent(raw),
  ])].filter((form) => form.length > 0);
};

/**
 * Create the redactor used at one store's persistence boundary.
 *
 * @param {object} options declared Sensitive inputs and extra project patterns
 */
export const createRedactor = ({ secrets = [], patterns = [] } = {}) => {
  const declared = secrets
    .filter((secret) => typeof secret?.value === 'string' && secret.value.length > 0)
    .map((secret) => ({
      name: secret.name ?? null,
      source: secret.source ?? null,
      value: secret.value,
      forms: secretForms(secret.value),
    }));
  const rules = [
    ...declared.flatMap((secret) => secret.forms.map((form) => ({
      rule: `declared:${secret.name ?? 'unnamed'}`,
      pattern: new RegExp(escapeRegExp(form), 'g'),
      replace: () => REDACTION_PLACEHOLDER,
    }))),
    ...patterns.map((entry) => ({
      rule: entry.rule ?? 'project-pattern',
      pattern: entry.pattern,
      replace: entry.replace ?? (() => REDACTION_PLACEHOLDER),
    })),
    ...BUILT_IN_PATTERNS,
  ];

  const redactText = (input) => {
    let text = typeof input === 'string' ? input : String(input ?? '');
    const before = Buffer.byteLength(text, 'utf8');
    const applied = [];

    for (const rule of rules) {
      let count = 0;

      text = text.replace(rule.pattern, (...args) => {
        count += 1;

        return rule.replace(...args);
      });

      if (count > 0) {
        applied.push({ rule: rule.rule, count });
      }
    }

    return {
      text,
      rules: applied,
      applied: applied.reduce((total, entry) => total + entry.count, 0),
      redactedBytes: Math.max(before - Buffer.byteLength(text, 'utf8'), 0),
    };
  };

  /** Redact every string reachable in a structured value, keys included. */
  const redactValue = (input) => {
    const applied = [];
    let redactedBytes = 0;

    const walk = (value) => {
      if (typeof value === 'string') {
        const result = redactText(value);

        applied.push(...result.rules);
        redactedBytes += result.redactedBytes;

        return result.text;
      }

      if (Array.isArray(value)) {
        return value.map(walk);
      }

      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, entry]) => [walk(key), walk(entry)]),
        );
      }

      return value;
    };

    const value = walk(input);

    return {
      value,
      rules: applied,
      applied: applied.reduce((total, entry) => total + entry.count, 0),
      redactedBytes,
    };
  };

  return {
    version: REDACTION_VERSION,
    // Only the identity of a declared Sensitive input travels; never its value.
    secrets: declared.map(({ name, source, value }) => ({ name, source, value })),
    redactText,
    redactValue,
  };
};

/**
 * Every declared Sensitive value that is still recognizable in what is about to
 * be persisted. A non-empty result means safe handling could not be proved.
 */
export const residualFindings = (serialized, secrets = []) => {
  const findings = [];

  for (const secret of secrets) {
    for (const form of secretForms(secret?.value)) {
      if (serialized.includes(form)) {
        findings.push({
          name: secret?.name ?? null,
          source: secret?.source ?? null,
          // The value itself is never reported; only that it survived.
          form: form === secret.value ? 'raw' : 'encoded',
          code: 'sensitive-value-survived-redaction',
        });

        break;
      }
    }
  }

  return findings;
};
