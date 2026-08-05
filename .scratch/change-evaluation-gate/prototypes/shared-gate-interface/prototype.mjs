import readline from 'node:readline';
import process from 'node:process';

import { adapters, buildPrototypeState, scenarios } from './gate-model.mjs';

let adapterIndex = 0;
let scenarioIndex = 0;

if (process.argv.includes('--matrix')) {
  for (const adapter of adapters) {
    for (const scenario of scenarios) {
      const state = buildPrototypeState({
        adapterId: adapter.id,
        scenarioId: scenario.id,
      });

      process.stdout.write([
        adapter.id,
        scenario.id,
        state.decision.outcome,
        state.decision.authorization,
        state.adapterResponse.exitCode,
      ].join('\t') + '\n');
    }
  }

  process.exit(0);
}

const render = () => {
  if (process.stdout.isTTY) {
    console.clear();
  }

  const state = buildPrototypeState({
    adapterId: adapters[adapterIndex].id,
    scenarioId: scenarios[scenarioIndex].id,
  });

  process.stdout.write('\x1b[1mPROTOTYPE — shared gate interface\x1b[0m\n');
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n\n`);
  process.stdout.write('\x1b[1m[a]\x1b[0m adapter  ');
  process.stdout.write('\x1b[1m[s]\x1b[0m scenario  ');
  process.stdout.write('\x1b[1m[q]\x1b[0m quit\n');
};

render();

if (process.argv.includes('--once') || !process.stdin.isTTY) {
  process.exit(0);
}

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('keypress', (_, key) => {
  if (key.name === 'a') {
    adapterIndex = (adapterIndex + 1) % adapters.length;
  } else if (key.name === 's') {
    scenarioIndex = (scenarioIndex + 1) % scenarios.length;
  } else if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
    process.stdout.write('\n');
    process.exit(0);
  }

  render();
});
