/**
 * The fixed v1 Evidence retention bounds.
 *
 * Q-008 settled three ceilings and they are not negotiable at runtime: 32 KiB
 * of inline redacted output per Check attempt, 4 MiB per retained output blob,
 * and 32 MiB of output blobs for one evaluation. A project may configure lower
 * limits; a configured higher limit never takes effect and is reported rather
 * than silently ignored (FR-EVID-003, RISK-010).
 *
 * Truncation is never silent: the retained excerpt keeps the beginning and the
 * end of the output and states, inside the excerpt, how many bytes were left
 * out. The byte counts travel with the envelope.
 */

/** The three fixed v1 ceilings, in bytes. Nothing may raise them. */
export const EVIDENCE_CEILINGS = Object.freeze({
  inlineBytes: 32 * 1024,
  blobBytes: 4 * 1024 * 1024,
  evaluationBlobBytes: 32 * 1024 * 1024,
});

/** Configured names, in the project's `evaluation_gate.evidence` subcontract. */
const CONFIGURED_NAMES = Object.freeze({
  inlineBytes: 'inline_bytes',
  blobBytes: 'blob_bytes',
  evaluationBlobBytes: 'evaluation_blob_bytes',
});

const OMISSION_PREFIX = '\n…[change-evaluation-gate: ';

const OMISSION_SUFFIX = ' bytes omitted]…\n';

/**
 * Resolve the effective limits for one project.
 *
 * @param {object|null} configured the `evaluation_gate.evidence` subcontract
 * @returns {{limits: object, violations: Array}} effective limits and every
 *   configured value that tried to exceed a fixed ceiling
 */
export const resolveEvidenceLimits = (configured) => {
  const limits = {};
  const violations = [];

  for (const [limit, ceiling] of Object.entries(EVIDENCE_CEILINGS)) {
    const value = configured?.[CONFIGURED_NAMES[limit]];

    if (!Number.isInteger(value) || value <= 0) {
      limits[limit] = ceiling;

      continue;
    }

    limits[limit] = Math.min(value, ceiling);

    if (value > ceiling) {
      violations.push({
        limit,
        configured: value,
        applied: ceiling,
        ceiling,
        code: 'evidence-ceiling-exceeded',
        message: `Configured ${CONFIGURED_NAMES[limit]} of ${value} exceeds the fixed v1 ceiling of ${ceiling}; the ceiling applies.`,
      });
    }
  }

  violations.sort((left, right) => left.limit.localeCompare(right.limit));

  return { limits, violations };
};

/**
 * Bound one attempt's already-redacted output to the inline limit, preserving
 * its beginning and its end.
 *
 * @param {string|Buffer} output redacted output offered for capture
 * @param {object} options the effective inline limit in bytes
 */
export const boundOutput = (output, { inlineLimitBytes = EVIDENCE_CEILINGS.inlineBytes } = {}) => {
  const captured = Buffer.isBuffer(output) ? output : Buffer.from(String(output ?? ''), 'utf8');
  const limit = Math.min(inlineLimitBytes, EVIDENCE_CEILINGS.inlineBytes);

  if (captured.length <= limit) {
    return {
      inline: captured.toString('utf8'),
      capturedBytes: captured.length,
      retainedBytes: captured.length,
      omittedBytes: 0,
      truncated: false,
      boundary: null,
    };
  }

  // The omission notice is itself retained output, so it is budgeted before the
  // head and tail are sized; the excerpt can never exceed the limit.
  const omittedBytes = captured.length - limit;
  const notice = `${OMISSION_PREFIX}${omittedBytes}${OMISSION_SUFFIX}`;
  const noticeBytes = Buffer.byteLength(notice, 'utf8');
  const available = Math.max(limit - noticeBytes, 0);
  const headBytes = Math.ceil(available / 2);
  const tailBytes = available - headBytes;
  const inline = [
    captured.subarray(0, headBytes).toString('utf8'),
    `${OMISSION_PREFIX}${captured.length - headBytes - tailBytes}${OMISSION_SUFFIX}`,
    tailBytes > 0 ? captured.subarray(captured.length - tailBytes).toString('utf8') : '',
  ].join('');

  return {
    inline,
    capturedBytes: captured.length,
    retainedBytes: headBytes + tailBytes,
    omittedBytes: captured.length - headBytes - tailBytes,
    truncated: true,
    boundary: { headBytes, tailBytes },
  };
};
