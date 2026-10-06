/* ---------------------------------------------------------------------------
 * The report: one static page a maintainer can read or share (`FR-GUIDE-008`,
 * `TB-073`).
 *
 * The page is rendered from the documents `setup --json` and
 * `config show --json` print — the same functions build them — so it cannot
 * disagree with either, and from the doctor's findings copied field by field
 * out of `gate doctor --json`. It holds no script, stylesheet, font, image, or
 * link, and every string it shows is escaped. It is written only outside the
 * clone, judged on the real path, and never over an existing file; nothing
 * under the clone changes (`SG-GUIDE-001`, `SG-GUIDE-002`). A Sensitive
 * runtime input appears by name and source only (`SG-SECRET-001`).
 * ------------------------------------------------------------------------- */

import { randomUUID } from 'node:crypto';
import { lstat, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { command } from '../commands.mjs';
import { runConfigShow } from '../config/show.mjs';
import { EXIT_DONE, EXIT_STEPS_REMAIN, EXIT_UNRUNNABLE, REPORT_LIMIT } from '../contracts.mjs';
import { ENTRY_SCRIPT } from '../paths.mjs';
import { failure } from '../presentation.mjs';
import { observeDoctor } from './doctor.mjs';
import { reportPage } from './html.mjs';
import { runSetup } from '../setup/plan.mjs';

const REPORT_PREFIX = 'agent-framework-report-';

/**
 * Where the page goes: `--out` as given, else a fresh name in the temporary
 * directory. The directory is resolved by the operating system — symbolic
 * links, then `..` — and the file named in it is the one checked and written,
 * so no spelling of a path reaches the clone. Refused, with nothing written,
 * when that path is inside the clone, already exists, or names no file in an
 * existing directory.
 */
const reportTarget = async ({ cwd, projectRoot, out }) => {
  let clone;

  try {
    clone = await realpath(projectRoot);
  } catch {
    return failure('project-missing', `${projectRoot} does not exist.`);
  }

  const requested = out === null
    ? path.join(tmpdir(), `${REPORT_PREFIX}${randomUUID()}.html`)
    : (path.isAbsolute(out) ? out : `${cwd}${path.sep}${out}`);
  const name = path.basename(requested);

  if (['', '.', '..'].includes(name) || requested.endsWith(path.sep)) {
    return failure('report-target-invalid', `${requested} names no file to write the report to.`);
  }

  let directory;

  try {
    directory = await realpath(path.dirname(requested));
  } catch {
    directory = null;
  }

  if (directory === null || !(await stat(directory)).isDirectory()) {
    return failure('report-directory-missing', `${path.dirname(requested)} is not an existing directory; report creates no directory.`);
  }

  const target = path.join(directory, name);

  if (target === clone || target.startsWith(`${clone}${path.sep}`)) {
    return failure(
      'report-inside-clone',
      `${requested} is ${target}, inside the clone ${clone}; a report is never written inside the clone (SG-GUIDE-002). Name a path outside it with --out, or omit --out for the temporary directory.`,
    );
  }

  if (await lstat(target).then(() => true, () => false)) {
    return failure('report-target-exists', `${target} already exists; report never overwrites a file. Remove it or name another path with --out.`);
  }

  return { target };
};

const renderReport = (document) => [
  'agent-framework report',
  `project: ${document.project}`,
  ...(document.failure === null
    ? [`report: ${document.report}`]
    : [`failed: ${document.failure.reasonCode} — ${document.failure.detail}`]),
  REPORT_LIMIT,
  '',
].join('\n');

/**
 * Write the page. Every refusal comes before anything is asked or written;
 * the file is created exclusively, so a file that appears meanwhile is not
 * overwritten either. Exit status: `0` the page is written and neither setup
 * nor config show names anything further, `1` the page is written and one of
 * them does (or could not run, which the page states), `2` nothing was
 * written.
 */
export const runReport = async ({ cwd, projectRoot, environment, out }) => {
  const document = {
    document: 'agent-framework/report/1',
    command: 'report',
    ok: false,
    exitStatus: EXIT_UNRUNNABLE,
    project: projectRoot,
    report: null,
    generatedAt: null,
    failure: null,
    limit: REPORT_LIMIT,
  };
  const located = await reportTarget({ cwd, projectRoot, out });

  if (located.failure) {
    return { document: { ...document, failure: located.failure }, render: renderReport };
  }

  const { document: setup } = await runSetup({ projectRoot, environment });
  const { document: shown } = await runConfigShow({ projectRoot, environment });
  const doctor = await observeDoctor({ projectRoot, environment, setup });
  const generatedAt = new Date().toISOString();
  const page = reportPage({
    setup,
    shown,
    doctor,
    generatedAt,
    regenerate: command('regenerate', ['node', ENTRY_SCRIPT, 'report', '--html', '--project', projectRoot]).run,
  });

  try {
    await writeFile(located.target, page, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    return {
      document: {
        ...document,
        failure: error.code === 'EEXIST'
          ? { reasonCode: 'report-target-exists', detail: `${located.target} already exists; report never overwrites a file. Remove it or name another path with --out.` }
          : { reasonCode: 'report-unwritable', detail: `${located.target} could not be written: ${error.message}` },
      },
      render: renderReport,
    };
  }

  const exitStatus = setup.exitStatus === EXIT_DONE && shown.exitStatus === EXIT_DONE ? EXIT_DONE : EXIT_STEPS_REMAIN;

  return {
    document: { ...document, ok: true, exitStatus, report: located.target, generatedAt },
    render: renderReport,
  };
};
