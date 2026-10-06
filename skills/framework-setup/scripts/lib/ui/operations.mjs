import path from 'node:path';
import process from 'node:process';

import * as configuration from '../../configure.mjs';
import { runFrameworkCommand } from '../agent-framework/command.mjs';
import { locateGateCommand, runGateCommand } from '../gate-command.mjs';
import { baseSetup, publicDiscovery } from './operation-base-setup.mjs';
import { GATE_FIELDS, GATE_FLAGS, operationCatalog } from './operation-catalog.mjs';
import { UIInputError, validateRequest } from './operation-validation.mjs';
import { listWorktrees } from './operation-worktrees.mjs';
import { exportReport } from './operation-report.mjs';

export { UIInputError };

const refusal = (operation, reasonCode, detail) => ({ operation, exitCode: 2, document: { status: 'refused', failure: { reasonCode, detail } } });
const resultOf = (operation, document) => ({ operation, exitCode: document?.status === 'refused' ? 2 : 0, document });
const safeDocument = (value) => {
  if (Array.isArray(value)) return value.map(safeDocument);
  if (value === null || typeof value !== 'object') return value;
  if (value.reasonCode === 'gate-unreadable') return { ...value, detail: 'The Gate returned an unreadable observation. Use the terminal for detailed diagnostics.' };
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, safeDocument(child)]));
};
const selectors = (fields) => Object.entries(fields).flatMap(([key, value]) => {
  if (typeof value === 'boolean') return value ? [GATE_FLAGS[key]] : [];
  if (Array.isArray(value)) return value.flatMap((item) => [GATE_FLAGS[key], item]);
  return [GATE_FLAGS[key], String(value)];
});

/** Fixed-project operation bridge. Injection is only an in-process testing seam. */
export const createOperations = ({ projectRoot, environment = process.env, dependencies = {} }) => {
  const root = path.resolve(projectRoot);
  const owners = { ...configuration, runFrameworkCommand, locateGateCommand, runGateCommand, ...dependencies };
  const catalog = () => operationCatalog().map((descriptor) => ({ ...descriptor, confirmable: descriptor.previewable }));
  const framework = async (operation, argv) => {
    const result = await owners.runFrameworkCommand({ cwd: root, argv: [...argv, '--json'], environment, terminal: null });
    return { operation, exitCode: result.exitCode, document: safeDocument(result.document) };
  };
  const gate = async (operation, command, fields, confirmation) => {
    const located = await owners.locateGateCommand({ environment });
    if (!located.available) return refusal(operation, 'gate-unavailable', 'The Change Evaluation Gate skill is not installed beside Framework and is not available on PATH.');
    const answer = await owners.runGateCommand(located, {
      cwd: root, environment,
      args: [command, ...selectors(fields), ...(confirmation === null ? [] : [command === 'locks' ? '--recover' : '--confirm', confirmation])],
    });
    if (answer.failure) return refusal(operation, 'gate-unavailable-answer', 'The Gate could not return a supported structured observation. Run the command in a terminal for diagnostics.');
    return { operation, exitCode: answer.document.exitStatus, document: answer.document };
  };

  const execute = async (request) => {
    const { descriptor, fields, confirmation } = validateRequest(request, catalog());
    const operation = descriptor.id;
    try {
      if (Object.hasOwn(GATE_FIELDS, operation.slice(5)) && operation.startsWith('gate:')) return await gate(operation, operation.slice(5), fields, confirmation);
      if (['setup', 'config-show', 'config-suggest'].includes(operation)) return await framework(operation, operation === 'setup' ? ['setup'] : ['config', operation.slice(7)]);
      if (operation.startsWith('config:')) {
        const name = operation.slice(7);
        const revision = configuration.gateRevisions[name];
        return await framework(operation, ['config', name, fields[revision.argument],
          ...revision.options.flatMap((option) => fields[option] === undefined ? [] : [`--${option}`, fields[option]]),
          ...(fields.acknowledgeWeakening === true ? ['--acknowledge-weakening'] : []),
          ...(confirmation === null ? [] : ['--confirm', confirmation]),
        ]);
      }
      if (operation === 'guardrail') return await framework(operation, ['guardrail', fields.action, fields.client, ...(confirmation === null ? [] : ['--confirm', confirmation])]);
      if (operation === 'discovery') return resultOf(operation, publicDiscovery(await owners.discoverProject(root)));
      if (operation === 'worktrees') return resultOf(operation, await listWorktrees({ projectRoot: root, environment }));
      if (operation === 'report') return { operation, ...await exportReport({ projectRoot: root, environment, runFrameworkCommand: owners.runFrameworkCommand }) };
      if (operation === 'base-setup') return resultOf(operation, await baseSetup({ projectRoot: root, fields, confirmation, discoverProject: owners.discoverProject, configureProject: owners.configureProject }));
      if (operation === 'migration-draft') return resultOf(operation, await owners.draftMigrationMapping({ projectRoot: root, out: null }));
      if (operation === 'policy-draft') return resultOf(operation, await owners.draftGatePolicy({ projectRoot: root, out: null }));
      if (operation === 'migration') return resultOf(operation, await owners[confirmation === null ? 'previewConfigurationMigration' : 'migrateConfiguration']({ projectRoot: root, mappings: fields.mappings, ...(confirmation === null ? {} : { confirmation }) }));
      if (operation === 'policy') return resultOf(operation, await owners[confirmation === null ? 'previewGateConfiguration' : 'configureGate']({ projectRoot: root, policy: fields.policy, ...(confirmation === null ? {} : { confirmation }) }));
      throw new UIInputError('Operation is unavailable.');
    } catch (error) {
      if (error instanceof UIInputError) throw error;
      return refusal(operation, 'operation-refused', 'The owning operation refused this request. Check its prerequisites and preview again; use the terminal for detailed diagnostics.');
    }
  };

  const observe = async () => {
    const setup = await execute({ operation: 'setup' });
    const configurationResult = await execute({ operation: 'config-show' });
    const status = await execute({ operation: 'gate:status' });
    return { projectRoot: root, setup: setup.document, configuration: configurationResult.document, status: status.document };
  };
  return { catalog, observe, execute };
};
