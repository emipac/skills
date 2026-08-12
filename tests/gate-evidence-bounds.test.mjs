import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVIDENCE_CEILINGS,
  boundOutput,
  resolveEvidenceLimits,
} from '../skills/change-evaluation-gate/scripts/lib/evidence-bounds.mjs';

test('the v1 evidence ceilings are fixed and a project may only lower them', () => {
  assert.deepEqual({ ...EVIDENCE_CEILINGS }, {
    inlineBytes: 32 * 1024,
    blobBytes: 4 * 1024 * 1024,
    evaluationBlobBytes: 32 * 1024 * 1024,
  });

  // No configuration at all means exactly the ceilings.
  const unconfigured = resolveEvidenceLimits(null);

  assert.deepEqual(unconfigured.limits, { ...EVIDENCE_CEILINGS });
  assert.deepEqual(unconfigured.violations, []);

  // Lower project limits are honored.
  const lowered = resolveEvidenceLimits({
    inline_bytes: 4096,
    blob_bytes: 1024 * 1024,
    evaluation_blob_bytes: 8 * 1024 * 1024,
  });

  assert.deepEqual(lowered.limits, {
    inlineBytes: 4096,
    blobBytes: 1024 * 1024,
    evaluationBlobBytes: 8 * 1024 * 1024,
  });
  assert.deepEqual(lowered.violations, []);

  // A configured raise never takes effect and is never silent.
  const raised = resolveEvidenceLimits({
    inline_bytes: 1024 * 1024,
    blob_bytes: 64 * 1024 * 1024,
    evaluation_blob_bytes: 1024 * 1024 * 1024,
  });

  assert.deepEqual(raised.limits, { ...EVIDENCE_CEILINGS });
  assert.deepEqual(
    raised.violations.map((violation) => violation.limit).sort(),
    ['blobBytes', 'evaluationBlobBytes', 'inlineBytes'],
  );
  assert.equal(raised.violations[0].configured > raised.violations[0].applied, true);
});

test('inline truncation preserves the beginning and the end and reports its byte counts', () => {
  const head = 'BEGIN-MARKER';
  const tail = 'END-MARKER';
  const captured = `${head}${'p'.repeat(100 * 1024)}${tail}`;
  const bounded = boundOutput(captured, { inlineLimitBytes: EVIDENCE_CEILINGS.inlineBytes });

  assert.equal(bounded.truncated, true);
  assert.equal(Buffer.byteLength(bounded.inline, 'utf8') <= EVIDENCE_CEILINGS.inlineBytes, true);
  assert.equal(bounded.inline.startsWith(head), true);
  assert.equal(bounded.inline.endsWith(tail), true);

  // Truncation is stated in the retained excerpt itself, never silent.
  assert.match(bounded.inline, /bytes omitted/);

  assert.equal(bounded.capturedBytes, Buffer.byteLength(captured, 'utf8'));
  assert.equal(bounded.retainedBytes + bounded.omittedBytes, bounded.capturedBytes);
  assert.equal(bounded.omittedBytes > 0, true);
  assert.equal(bounded.boundary.headBytes > 0, true);
  assert.equal(bounded.boundary.tailBytes > 0, true);

  // Output that fits is retained whole with nothing omitted.
  const small = boundOutput('short output', { inlineLimitBytes: EVIDENCE_CEILINGS.inlineBytes });

  assert.equal(small.truncated, false);
  assert.equal(small.inline, 'short output');
  assert.equal(small.omittedBytes, 0);
  assert.equal(small.retainedBytes, small.capturedBytes);
  assert.equal(small.boundary, null);
});
