import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';

import { createJobs, UIRequestError } from './jobs.mjs';

const ASSETS = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.mjs', { file: 'app.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/dom.mjs', { file: 'dom.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/forms.mjs', { file: 'forms.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/renderers.mjs', { file: 'renderers.mjs', type: 'text/javascript; charset=utf-8' }],
  ['/favicon.svg', { file: 'favicon.svg', type: 'image/svg+xml' }],
  ['/download.mjs', { file: 'download.mjs', type: 'text/javascript; charset=utf-8' }],
]);
const ASSET_ROOT = new URL('../../ui-assets/', import.meta.url);

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};

const send = (response, status, value, type = 'application/json; charset=utf-8') => {
  response.writeHead(status, { ...headers, 'Content-Type': type });
  response.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
};

const bodyOf = async (request, limit) => {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new UIRequestError('json-required', 'Send a JSON request.', 415);
  }
  const chunks = await new Promise((resolve, reject) => {
    const collected = [];
    let bytes = 0;
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        request.removeListener('data', onData);
        request.resume();
        reject(new UIRequestError('body-too-large', 'The request exceeds the dashboard limit.', 413));
        return;
      }
      collected.push(chunk);
    };
    request.on('data', onData);
    request.once('end', () => resolve(collected));
    request.once('error', reject);
    request.once('aborted', () => reject(new UIRequestError('request-aborted', 'The request was interrupted.')));
  });
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new UIRequestError('json-invalid', 'Send a JSON object.');
  }
};

/** Serve exactly one project on loopback; all writes remain owner operations. */
export const startProjectUi = async ({ projectRoot, environment = process.env, port = 0, operations: injected = null, bodyLimit = 65_536, ...jobOptions }) => {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UIRequestError('port-invalid', 'Port must be between 0 and 65535.');
  const root = await realpath(projectRoot);
  if (!(await stat(root)).isDirectory()) throw new UIRequestError('project-invalid', 'Choose a project directory.');
  const operations = injected ?? (await import('./operations.mjs')).createOperations({ projectRoot: root, environment });
  const jobs = createJobs({ operations, ...jobOptions });
  const token = randomBytes(32).toString('hex');
  let origin;
  const authorized = (request) => {
    const supplied = Buffer.from(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
    const expected = Buffer.from(token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) {
        throw new UIRequestError('origin-denied', 'This dashboard accepts only its own local origin.', 403);
      }
      const url = new URL(request.url, origin);
      if (url.origin !== origin || url.search || request.url.includes('..') || request.url.includes('%')) throw new UIRequestError('path-invalid', 'Choose a dashboard route.', 404);
      if (!url.pathname.startsWith('/api/')) {
        const asset = ASSETS.get(url.pathname);
        if (request.method !== 'GET' || !asset) throw new UIRequestError('route-missing', 'This dashboard route is unavailable.', 404);
        let contents;
        try { contents = await readFile(new URL(asset.file, ASSET_ROOT)); }
        catch (error) {
          throw new UIRequestError('asset-missing', 'This dashboard asset is unavailable. Reinstall the Framework setup skill.', 404);
        }
        send(response, 200, contents, asset.type);
        return;
      }
      if (!authorized(request)) throw new UIRequestError('session-denied', 'Open the session URL printed by the dashboard command.', 403);
      if (request.method === 'GET') {
        if (url.pathname === '/api/catalog') return send(response, 200, { operations: operations.catalog() });
        if (url.pathname === '/api/overview') return send(response, 200, await jobs.observe());
        if (url.pathname === '/api/jobs') return send(response, 200, { jobs: jobs.list() });
        const match = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)$/);
        if (match) {
          const job = jobs.get(match[1]);
          if (!job) throw new UIRequestError('job-missing', 'This job is no longer available.', 404);
          return send(response, 200, { job });
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/jobs') {
        if (request.headers.origin !== origin) throw new UIRequestError('origin-required', 'A dashboard action requires its local origin.', 403);
        const body = await bodyOf(request, bodyLimit);
        if (Object.keys(body).some((key) => !['operation', 'fields', 'previewId'].includes(key))
          || (body.fields !== undefined && (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)))
          || (body.previewId !== undefined && typeof body.previewId !== 'string')) {
          throw new UIRequestError('request-invalid', 'Choose an operation and its declared fields, or a reviewed preview ID.');
        }
        return send(response, 202, { job: jobs.submit(body) });
      }
      throw new UIRequestError('route-missing', 'This dashboard route is unavailable.', 404);
    } catch (error) {
      send(response, error.status ?? 500, { failure: { code: error.code ?? 'request-failed', detail: error.status ? error.message : 'The dashboard could not complete this request.' } });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  let closing;
  const close = () => {
    closing ??= (async () => {
      const stopped = new Promise((resolve) => server.close(resolve));
      server.closeIdleConnections();
      await jobs.close();
      await stopped;
    })();
    return closing;
  };
  return { projectRoot: root, url: `${origin}/#${token}`, origin, close };
};

export const runUi = async ({ projectRoot, environment, port = 0 }) => {
  const ui = await startProjectUi({ projectRoot, environment, port });
  const stop = () => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    ui.close().catch(() => { process.exitCode = 2; });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const document = { document: 'agent-framework/ui/1', command: 'ui', ok: true, exitStatus: 0, project: ui.projectRoot, url: ui.url };
  return { document, render: () => `Project dashboard: ${ui.url}\nProject: ${ui.projectRoot}\nPress Ctrl+C to stop.\n` };
};
