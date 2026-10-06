import { constants } from 'node:fs';
import { lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const REPORT_LIMIT = 1024 * 1024;
const refused = () => ({ exitCode: 2, document: { status: 'refused', failure: { reasonCode: 'report-unavailable', detail: 'The Framework report could not be generated within the dashboard limits. Use the report command in a terminal.' } } });

/** Export the owning static report from one private temporary destination. */
export const exportReport = async ({ projectRoot, environment, runFrameworkCommand }) => {
  let directory;
  try {
    directory = await mkdtemp(path.join(tmpdir(), 'agent-framework-ui-report-'));
    const target = path.join(await realpath(directory), 'report.html');
    const result = await runFrameworkCommand({ cwd: projectRoot, environment, terminal: null, argv: ['report', '--html', '--out', target] });
    if (!result.document || result.document.failure || result.document.report !== target) return refused();
    if (!(await lstat(target)).isFile()) return refused();
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let reportHtml;
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > REPORT_LIMIT) return refused();
      const buffer = Buffer.alloc(REPORT_LIMIT + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > REPORT_LIMIT) return refused();
      reportHtml = buffer.subarray(0, length).toString('utf8');
    } finally {
      await handle.close();
    }
    const { report, ...document } = result.document;
    return { exitCode: result.exitCode, document: { ...document, reportHtml } };
  } catch {
    return refused();
  } finally {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  }
};
