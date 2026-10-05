// The terminal the Framework command asks its guided questions on.
//
// `agent-framework setup` asks a maintainer for an answer only in an
// interactive terminal (`FR-GUIDE-003`, `SG-GUIDE-001`), so the one thing this
// module decides is whether there is one: standard input AND standard output
// are both terminals, as Node reports them. Anything else — a pipe, a file,
// CI, an agent's captured output — is not interactive, and the command then
// prints its plan and confirms nothing.
//
// The terminal is a seam: `runFrameworkCommand` takes any object of this shape,
// so tests drive the guided flow with scripted answers and capture what it
// wrote. The bin passes the one built here, on Node's own line reader; no
// dependency is needed (feature contract `GAP-004`).
//
//   { interactive: boolean,
//     write(text): void,
//     ask(question): Promise<string | null>,   // null: input ended
//     close(): void }

import process from 'node:process';
import { createInterface } from 'node:readline';

/**
 * The process's own terminal. Standard input is not read at all until the
 * first question, so a non-interactive run never holds it open.
 */
export const processTerminal = ({ input = process.stdin, output = process.stdout } = {}) => {
  let lines = null;
  let ended = false;
  const unread = [];
  const waiting = [];

  const reader = () => {
    if (lines === null) {
      lines = createInterface({ input, terminal: false });
      lines.on('line', (line) => {
        const resolve = waiting.shift();

        if (resolve === undefined) {
          unread.push(line);
        } else {
          resolve(line);
        }
      });
      lines.on('close', () => {
        ended = true;

        for (const resolve of waiting.splice(0)) {
          resolve(null);
        }
      });
    }
  };

  return {
    interactive: input.isTTY === true && output.isTTY === true,
    write: (text) => {
      output.write(text);
    },
    ask: (question) => new Promise((resolve) => {
      output.write(question);
      reader();

      if (unread.length > 0) {
        resolve(unread.shift());
      } else if (ended) {
        resolve(null);
      } else {
        waiting.push(resolve);
      }
    }),
    close: () => {
      lines?.close();
    },
  };
};
