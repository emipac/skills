import { gateRevisions, guardrailClients, guardrailOperations } from '../../configure.mjs';
import { ACKNOWLEDGE_WEAKENING } from './contracts.mjs';

export const USAGE = [
  'usage: agent-framework setup [--json] [--project <directory>]',
  '       agent-framework config show [--json] [--project <directory>]',
  '       agent-framework config suggest [--json] [--project <directory>]',
  '       agent-framework report --html [--out <path>] [--project <directory>]',
  '       agent-framework ui [--project <directory>] [--port <0..65535>]',
  ...Object.entries(gateRevisions).map(([name, { argument, options }]) => [
    `       agent-framework config ${name} <${argument}>`,
    ...options.map((option) => `[--${option} <${option}>]`),
    '[--confirm <token>] [--acknowledge-weakening] [--json] [--project <directory>]',
  ].join(' ')),
  `       agent-framework guardrail ${guardrailOperations.join('|')} ${guardrailClients.join('|')} [--confirm <token>] [--json] [--project <directory>]`,
].join('\n');

export const parseArguments = (argv) => {
  const [first, second] = argv;
  const revision = first === 'config' && Object.hasOwn(gateRevisions, second ?? '') ? gateRevisions[second] : null;
  const guardrail = first === 'guardrail' && guardrailOperations.includes(second) ? { operation: second, client: null } : null;
  const subcommand = first === 'config' && (['show', 'suggest'].includes(second) || revision !== null) ? `config ${second}` : first;

  if (!['setup', 'config show', 'config suggest', 'report', 'ui'].includes(subcommand) && revision === null && guardrail === null) {
    return null;
  }

  const report = subcommand === 'report';
  const ui = subcommand === 'ui';
  const rest = argv.slice(['setup', 'report', 'ui'].includes(subcommand) ? 1 : 2);
  const options = {
    subcommand,
    json: false,
    html: false,
    out: null,
    project: null,
    revision: null,
    confirmation: null,
    acknowledgeWeakening: false,
    guardrail,
    ...(ui ? { port: 0 } : {}),
  };
  const valued = new Set([
    '--project',
    ...(report ? ['--out'] : []),
    ...(ui ? ['--port'] : []),
    ...(guardrail === null ? [] : ['--confirm']),
    ...(revision === null ? [] : ['--confirm', ...revision.options.map((option) => `--${option}`)]),
  ]);

  if (revision !== null) {
    options.revision = { operation: second };
  }

  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];

    if (argument === '--json' && !report && !ui) {
      options.json = true;
    } else if (argument === '--html' && report) {
      options.html = true;
    } else if (argument === ACKNOWLEDGE_WEAKENING && revision !== null) {
      options.acknowledgeWeakening = true;
    } else if (valued.has(argument) && rest[index + 1] !== undefined) {
      const value = rest[index + 1];

      if (argument === '--project') {
        options.project = value;
      } else if (argument === '--out') {
        options.out = value;
      } else if (argument === '--port') {
        if (!/^\d+$/.test(value) || Number(value) > 65535) return null;
        options.port = Number(value);
      } else if (argument === '--confirm') {
        options.confirmation = value;
      } else {
        options.revision[argument.slice(2)] = value;
      }

      index += 1;
    } else if (revision !== null && !argument.startsWith('--') && options.revision[revision.argument] === undefined) {
      options.revision[revision.argument] = argument;
    } else if (guardrail !== null && !argument.startsWith('--') && guardrail.client === null) {
      guardrail.client = argument;
    } else {
      return null;
    }
  }

  const incomplete = (revision !== null && options.revision[revision.argument] === undefined)
    || (report && !options.html)
    || (guardrail !== null && guardrail.client === null);

  return incomplete ? null : options;
};
