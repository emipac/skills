/**
 * Served-source binding for HTTP and browser evidence.
 *
 * An HTTP or browser check only proves something about the Evaluation snapshot
 * when the runtime answering the request is serving that snapshot's
 * materialized source. The gate never launches an alternate application
 * runtime: it asks the project's existing local runtime for content it can
 * compare, byte for byte, against the materialized snapshot.
 *
 * Proof is content, never coincidence. A matching path, a reachable port, or a
 * runtime that simply answers is not evidence of anything. Failure to PROVE the
 * binding is `unverified` — absence of evidence is never success (FR-EVAL-010,
 * SG-EVAL-002, NFR-SEC-001).
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Evidence categories whose result depends on what a runtime served. These are
 * declared by the Command descriptor, so a check opts into runtime binding by
 * declaring what kind of evidence it produces, never by its name.
 */
export const SERVED_EVIDENCE_CATEGORIES = Object.freeze(['smoke', 'browser']);

const digest = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

/** Whether one check's evidence depends on a served runtime. */
export const requiresServedSourceBinding = (check) => SERVED_EVIDENCE_CATEGORIES.includes(
  check?.evaluate?.evidence_category,
);

const unproved = (reasonCode, detail, probes = []) => ({
  proved: false,
  reasonCode,
  detail,
  servedSourceId: null,
  probes,
});

const readProbe = async (executionRoot, relative) => {
  try {
    return await readFile(path.join(executionRoot, relative));
  } catch {
    return null;
  }
};

const defaultFetchResource = async (baseUrl, relative) => {
  const response = await fetch(new URL(relative, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`));

  if (!response.ok) {
    throw new Error(`The runtime answered ${response.status} for ${relative}.`);
  }

  return Buffer.from(await response.arrayBuffer());
};

/**
 * Prove that `runtime` serves the materialized snapshot.
 *
 * @param {object} input runtime descriptor, execution root, and fetch seam
 * @returns {Promise<{proved: boolean, reasonCode: string|null, detail: string|null, servedSourceId: string|null, probes: Array}>}
 */
export const proveServedSource = async ({
  runtime = null,
  executionRoot = null,
  fetchResource = defaultFetchResource,
} = {}) => {
  if (!runtime || typeof runtime.baseUrl !== 'string' || runtime.baseUrl.length === 0) {
    return unproved(
      'prerequisite-missing',
      'No local runtime binding was resolvable, so HTTP or browser evidence cannot be tied to the Evaluation snapshot.',
    );
  }

  const probePaths = runtime.probePaths ?? [];

  if (probePaths.length === 0) {
    return unproved(
      'prerequisite-missing',
      'The runtime declared no probe, and a reachable runtime is not by itself proof that it serves the Evaluation snapshot.',
    );
  }

  const probes = [];

  for (const relative of probePaths) {
    const expected = await readProbe(executionRoot, relative);

    if (expected === null) {
      return unproved(
        'prerequisite-missing',
        `The probe ${JSON.stringify(relative)} does not exist in the materialized snapshot, so nothing can be compared against it.`,
        probes,
      );
    }

    let served;

    try {
      served = await fetchResource(runtime.baseUrl, relative);
    } catch (error) {
      return unproved(
        'prerequisite-missing',
        `The runtime could not be probed for ${JSON.stringify(relative)}: ${error.message}`,
        probes,
      );
    }

    const expectedId = digest(expected);
    const servedId = digest(served);

    probes.push({
      path: relative,
      expected: expectedId,
      served: servedId,
      matched: expectedId === servedId,
    });
  }

  const mismatched = probes.filter((probe) => !probe.matched);

  if (mismatched.length > 0) {
    return {
      ...unproved(
        'snapshot-mismatch',
        `The runtime is not serving the materialized Evaluation snapshot; ${mismatched.map((probe) => JSON.stringify(probe.path)).join(', ')} differ.`,
        probes,
      ),
    };
  }

  return {
    proved: true,
    reasonCode: null,
    detail: null,
    servedSourceId: digest(probes.map((probe) => `${probe.path} ${probe.served}`).sort().join('')),
    probes,
  };
};

/** The integrity record a decision carries when no served evidence applies. */
export const unboundRuntime = (snapshotId = null) => ({
  required: false,
  proved: null,
  reasonCode: null,
  detail: null,
  snapshotId,
  servedSourceId: null,
  probes: [],
});
