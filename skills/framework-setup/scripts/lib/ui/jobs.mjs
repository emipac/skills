import { randomUUID } from 'node:crypto';

const tokenOf = (result) => {
  const document = result?.document;

  if (document?.failure || document?.refusal || document?.observation?.refusal || document?.mutation || document?.applied === true
    || ['configured', 'refused'].includes(document?.status) || result?.exitCode === 2) {
    return null;
  }

  return document?.confirmationToken ?? document?.previewHash
    ?? document?.observation?.confirmationToken ?? document?.observation?.previewHash ?? null;
};

export class UIRequestError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** A bounded, serial queue. Owner tokens never arrive from the browser. */
export const createJobs = ({ operations, limit = 40, previewTtlMs = 300_000, resultLimit = 2_000_000, now = Date.now }) => {
  const jobs = new Map();
  const previews = new Map();
  let tail = Promise.resolve();
  let closed = false;

  const serial = (run) => {
    const result = tail.then(run);
    tail = result.catch(() => {});
    return result;
  };

  const prune = () => {
    for (const [id, preview] of previews) {
      if (preview.expiresAt <= now()) previews.delete(id);
    }

    while (jobs.size >= limit) {
      const completed = [...jobs.values()].find((job) => ['completed', 'failed'].includes(job.state));
      if (!completed) throw new UIRequestError('queue-full', 'Wait for an existing operation to finish.', 429);
      jobs.delete(completed.id);
      if (completed.previewId) previews.delete(completed.previewId);
    }
  };

  const submit = ({ operation, fields = {}, previewId = null }) => {
    if (closed) throw new UIRequestError('server-closing', 'The dashboard is shutting down.', 503);
    let confirmation = null;
    let reviewed = null;

    if (previewId !== null) {
      const preview = previews.get(previewId);
      if (!preview || preview.expiresAt <= now()) throw new UIRequestError('preview-expired', 'Review a fresh preview before confirming.', 409);
      if (operation !== undefined || Object.keys(fields).length !== 0) {
        throw new UIRequestError('preview-bound', 'Confirmation accepts only the reviewed preview ID.');
      }
      ({ operation, fields, token: confirmation } = preview);
      reviewed = previewId;
    }

    if (typeof operation !== 'string' || !operations.catalog().some((entry) => entry.id === operation)) {
      throw new UIRequestError('operation-unknown', 'Choose an available dashboard operation.');
    }

    prune();
    if (reviewed !== null) previews.delete(reviewed);

    fields = structuredClone(fields);
    const job = { id: randomUUID(), operation, confirmation: confirmation !== null, state: 'queued', createdAt: new Date(now()).toISOString(), startedAt: null, completedAt: null, result: null, failure: null, previewId: null };
    jobs.set(job.id, job);

    serial(async () => {
      if (closed) {
        job.state = 'failed';
        job.failure = { code: 'server-closing', detail: 'The queued operation was not started.' };
        return;
      }
      job.state = 'running';
      job.startedAt = new Date(now()).toISOString();
      try {
        const result = await operations.execute({ operation, fields, confirmation });
        if (Buffer.byteLength(JSON.stringify(result)) > resultLimit) {
          throw new UIRequestError('result-too-large', 'The operation result exceeded the dashboard display limit.');
        }
        job.result = result;
        const previewable = operations.catalog().find((entry) => entry.id === operation)?.previewable === true;
        const token = confirmation === null && previewable ? tokenOf(result) : null;
        if (typeof token === 'string' && token.length > 0) {
          job.previewId = randomUUID();
          previews.set(job.previewId, { operation, fields: structuredClone(fields), token, expiresAt: now() + previewTtlMs });
        }
        job.state = 'completed';
      } catch (error) {
        job.state = 'failed';
        job.failure = { code: error.code ?? 'operation-failed', detail: error.status === 400 || error instanceof UIRequestError ? error.message : 'The operation could not finish. Review project health and try again.' };
      } finally {
        job.completedAt = new Date(now()).toISOString();
      }
    });
    return job;
  };

  return {
    submit,
    list: () => [...jobs.values()],
    get: (id) => jobs.get(id) ?? null,
    observe: () => serial(() => operations.observe()),
    close: async () => { closed = true; await operations.close?.(); await tail; },
  };
};
