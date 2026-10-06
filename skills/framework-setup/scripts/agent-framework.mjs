#!/usr/bin/env node
/**
 * The Framework command entry point and public module interface.
 * Implementation lives in lib/agent-framework/command.mjs.
 */

import process from 'node:process';

import { runFrameworkCommand } from './lib/agent-framework/command.mjs';
import { isCliEntryPoint } from './lib/cli-entry-point.mjs';
import { processTerminal } from './lib/terminal.mjs';

export { runFrameworkCommand };
export {
  DOCUMENT_VERSION,
  CONFIG_DOCUMENT_VERSION,
  SUGGEST_DOCUMENT_VERSION,
  REVISION_DOCUMENT_VERSION,
  GUARDRAIL_DOCUMENT_VERSION,
  EXIT_DONE,
  EXIT_STEPS_REMAIN,
  EXIT_UNRUNNABLE,
  GUIDED_DOCUMENT_VERSION,
} from './lib/agent-framework/contracts.mjs';

if (isCliEntryPoint(import.meta.url)) {
  const terminal = processTerminal();
  let result;

  try {
    result = await runFrameworkCommand({
      cwd: process.cwd(),
      argv: process.argv.slice(2),
      environment: process.env,
      terminal,
    });
  } finally {
    terminal.close();
  }

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
