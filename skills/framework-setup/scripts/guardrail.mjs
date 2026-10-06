#!/usr/bin/env node
/**
 * The destructive-command guardrail (FS-006, FS-007).
 *
 * A hook that runs before a client's agent runs a shell command. It reads the
 * hook's JSON payload on standard input and decides whether the command would
 * silently destroy uncommitted or unpushed work. Each client hears the answer
 * in its own format; the rules and the message are shared:
 *
 *   BLOCKED: '<command>' matches dangerous pattern '<rule>'. The user has prevented you from doing this.
 *
 * - **Claude Code** (no argument): a `PreToolUse` hook for the `Bash` tool. The
 *   command is `tool_input.command`. A blocked command exits 2 with the message
 *   on standard error, which Claude Code hands back to the model; anything else
 *   exits 0 and prints nothing.
 * - **Cursor** (`--client cursor`): a `beforeShellExecution` hook. The command
 *   is the payload's `command`. The answer is one JSON object on standard
 *   output, and the exit status is always 0: `{"permission":"deny",
 *   "userMessage":…,"agentMessage":…}`, both messages carrying the line above,
 *   stops the command, and `{"permission":"allow"}` lets it run. That is the
 *   contract observed on Cursor 3.23.23; whether Cursor shows either message,
 *   and how it treats a non-zero exit or output that is not JSON, was not
 *   established, so nothing here depends on them. The payload also carries the
 *   person's `user_email`, which is why nothing of the payload but the command
 *   is ever echoed.
 *
 * It never runs, rewrites, or fixes a command; it only allows or blocks.
 *
 * The command is read as arguments, not as raw text: it is split on `&&`, `||`,
 * `;`, `|`, `&`, parentheses, backticks, and newlines; each part is split into
 * words the way a POSIX shell would (quotes, backslashes, comments); `sh -c`
 * and `bash -c` strings are read the same way; Git's global options (`-C`,
 * `-c`, `--git-dir`, `--work-tree`, …) are skipped; and each rule matches the
 * Git subcommand and its flags. Only a command that cannot be split into words
 * — an unbalanced quote, say — is matched against the plain text instead, and
 * blocked only when that text is plainly destructive.
 *
 * A payload that is not what the client's contract describes, or arguments
 * this program does not know, allow the command with a one-line notice on
 * standard error: a broken guardrail must not stop every command. This is a
 * guardrail against accidents, not a security boundary; a script file the
 * agent writes and runs, a Git alias, or a shell the hook does not see is not
 * stopped.
 *
 * It has no dependency beyond Node, reads nothing but its arguments and
 * standard input, writes nothing, logs nothing, and makes no network access.
 */

import path from 'node:path';
import process from 'node:process';

/** The exit status Claude Code reads as "block this tool call". */
const EXIT_BLOCK = 2;

const blockedMessage = (command, rule) => `BLOCKED: '${command}' matches dangerous pattern '${rule}'. The user has prevented you from doing this.`;

/** How deep `sh -c '… sh -c …'` is followed; deeper is matched as plain text. */
const MAXIMUM_DEPTH = 4;

const NOT_WORDS = Symbol('not-words');

/**
 * Split a command line into simple commands, each a list of words, the way a
 * POSIX shell reads it. Quotes and backslashes are removed as the shell
 * removes them; `$…` expansions are kept as written. Returns `NOT_WORDS` when
 * a quote is left open.
 */
const simpleCommands = (text) => {
  const commands = [];
  let words = [];
  let word = '';
  let inWord = false;
  let quote = null;

  const endWord = () => {
    if (inWord) {
      words.push(word);
    }

    word = '';
    inWord = false;
  };

  const endCommand = () => {
    endWord();

    if (words.length > 0) {
      commands.push(words);
    }

    words = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (quote === "'") {
      if (character === "'") {
        quote = null;
      } else {
        word += character;
      }
    } else if (quote === '"') {
      if (character === '"') {
        quote = null;
      } else if (character === '\\' && ['$', '`', '"', '\\', '\n'].includes(next)) {
        word += next === '\n' ? '' : next;
        index += 1;
      } else {
        word += character;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
      inWord = true;
    } else if (character === '\\') {
      if (next !== '\n' && next !== undefined) {
        word += next;
        inWord = true;
      }

      index += 1;
    } else if (character === '#' && !inWord) {
      while (index + 1 < text.length && text[index + 1] !== '\n') {
        index += 1;
      }
    } else if (character === '&' && (word.endsWith('>') || word.endsWith('<') || next === '>')) {
      // A redirection such as `2>&1` or `&>file`, not a separator.
      word += character;
      inWord = true;
    } else if ([';', '|', '&', '(', ')', '`', '\n', '\r'].includes(character)) {
      endCommand();
    } else if (character === ' ' || character === '\t') {
      endWord();
    } else {
      word += character;
      inWord = true;
    }
  }

  if (quote !== null) {
    return NOT_WORDS;
  }

  endCommand();

  return commands;
};

/** Words that may open a simple command without being the program it runs. */
const RESERVED_WORDS = new Set(['!', '{', '}', 'if', 'then', 'else', 'elif', 'do', 'while', 'until', 'time']);

/** Programs that run the program named after them, with their options that take the next word as a value. */
const WRAPPERS = Object.freeze({
  command: '',
  exec: '',
  env: 'uCS',
  nohup: '',
  sudo: 'ugCDhpUrtT',
  time: '',
});

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

const programName = (word) => path.posix.basename(word.replace(/\\/g, '/')).replace(/\.exe$/i, '').toLowerCase();

/** The program a simple command runs, and its arguments, past assignments and wrappers. */
const invocation = (words) => {
  let index = 0;

  while (index < words.length) {
    const word = words[index];

    if (RESERVED_WORDS.has(word) || ASSIGNMENT.test(word)) {
      index += 1;
    } else if (Object.hasOwn(WRAPPERS, programName(word))) {
      const valued = WRAPPERS[programName(word)];

      index += 1;

      // A wrapper's own options (`sudo -u root`, `env -i`) are skipped too.
      while (index < words.length && words[index].startsWith('-')) {
        const letters = shortOptions(words[index], valued);

        index += letters !== '' && valued.includes(letters.at(-1)) && letters.length === words[index].length - 1 ? 2 : 1;
      }
    } else {
      return { program: programName(word), args: words.slice(index + 1) };
    }
  }

  return null;
};

/** The command string a shell's `-c` option runs, if any. */
const shellCommandString = (args) => {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '-o' || argument === '+o') {
      index += 1;
      continue;
    }

    if (!argument.startsWith('-') || argument === '-' || argument === '--') {
      return null;
    }

    if (!argument.startsWith('--') && argument.slice(1).includes('c')) {
      return args[index + 1] ?? null;
    }
  }

  return null;
};

/** Git's global options that take their value as the next word. */
const GIT_VALUED_GLOBALS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix', '--list-cmds']);

/** The Git subcommand and its arguments, past Git's global options. */
const gitSubcommand = (args) => {
  let index = 0;

  while (index < args.length && args[index].startsWith('-')) {
    index += GIT_VALUED_GLOBALS.has(args[index]) ? 2 : 1;
  }

  return index < args.length ? { subcommand: args[index], args: args.slice(index + 1) } : null;
};

/**
 * The single-letter options a word sets, when it is a cluster such as `-xdf`;
 * letters after one that takes a value (`-e<pattern>`) are that value.
 */
const shortOptions = (argument, valued = '') => {
  if (!/^-[^-]/.test(argument)) {
    return '';
  }

  let letters = '';

  for (const letter of argument.slice(1)) {
    letters += letter;

    if (valued.includes(letter)) {
      break;
    }
  }

  return letters;
};

/** Arguments before `--`, and every argument that is not an option (pathspecs, refs, the `--` tail). */
const splitOptions = (args, valuedLong = [], valuedShort = '') => {
  const options = [];
  const operands = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--') {
      operands.push(...args.slice(index + 1));
      break;
    }

    if (argument.startsWith('-') && argument !== '-') {
      options.push(argument);

      const letters = shortOptions(argument, valuedShort);
      const takesNext = valuedLong.includes(argument)
        || (letters !== '' && valuedShort.includes(letters.at(-1)) && letters.length === argument.length - 1);

      if (takesNext) {
        index += 1;
      }
    } else {
      operands.push(argument);
    }
  }

  return { options, operands };
};

const hasShort = (options, letter, valued = '') => options.some((option) => shortOptions(option, valued).includes(letter));

/** A pathspec naming the whole working tree. */
const isWholeTree = (operand) => operand === '.' || operand === './';

/**
 * Each rule: the name the block message gives it, the Git subcommand it reads,
 * and whether that subcommand's arguments destroy work.
 */
const RULES = Object.freeze([
  {
    rule: 'git reset --hard',
    subcommand: 'reset',
    matches: (args) => splitOptions(args).options.includes('--hard'),
  },
  {
    rule: 'git clean --force',
    subcommand: 'clean',
    matches: (args) => {
      const { options } = splitOptions(args, ['--exclude'], 'e');

      return options.includes('--force') || hasShort(options, 'f', 'e');
    },
  },
  {
    rule: 'git branch -D',
    subcommand: 'branch',
    matches: (args) => {
      const { options } = splitOptions(args, ['--contains', '--no-contains', '--merged', '--no-merged', '--points-at', '--sort', '--format', '--set-upstream-to'], 'tu');
      const deletes = options.includes('--delete') || hasShort(options, 'd', 'tu');
      const forced = options.includes('--force') || hasShort(options, 'f', 'tu');

      return hasShort(options, 'D', 'tu') || (deletes && forced);
    },
  },
  {
    rule: 'git checkout .',
    subcommand: 'checkout',
    matches: (args) => splitOptions(args, ['--conflict', '--orphan', '--pathspec-from-file'], 'bB').operands.some(isWholeTree),
  },
  {
    rule: 'git restore .',
    subcommand: 'restore',
    matches: (args) => {
      const { options, operands } = splitOptions(args, ['--source', '--conflict', '--pathspec-from-file'], 's');
      const staged = options.includes('--staged') || hasShort(options, 'S', 's');
      const worktree = options.includes('--worktree') || hasShort(options, 'W', 's');

      // A restore of the index alone only unstages; the working tree is kept.
      return operands.some(isWholeTree) && (worktree || !staged);
    },
  },
  {
    rule: 'git push --force',
    subcommand: 'push',
    matches: (args) => {
      const { options } = splitOptions(args, ['--repo', '--receive-pack', '--exec', '--push-option'], 'o');

      return options.includes('--force') || hasShort(options, 'f', 'o');
    },
  },
  {
    rule: 'git stash clear',
    subcommand: 'stash',
    matches: (args) => splitOptions(args).operands[0] === 'clear',
  },
  {
    rule: 'git stash drop',
    subcommand: 'stash',
    matches: (args) => splitOptions(args).operands[0] === 'drop',
  },
]);

/**
 * The same rules over plain text, for a command that cannot be split into
 * words: each needs the destructive spelling itself, so a near miss is allowed.
 */
const TEXT_RULES = Object.freeze([
  ['git reset --hard', /\bgit\s+reset\s+--hard\b/],
  ['git clean --force', /\bgit\s+clean\s+(?:-[A-Za-z]*f|--force\b)/],
  ['git branch -D', /\bgit\s+branch\s+-D\b/],
  ['git checkout .', /\bgit\s+checkout\s+(?:--\s+)?\.\/?(?=\s|$)/],
  ['git restore .', /\bgit\s+restore\s+(?:--worktree\s+)?\.\/?(?=\s|$)/],
  ['git push --force', /\bgit\s+push\s+(?:\S+\s+)*?(?:--force(?![-\w])|-f\b)/],
  ['git stash clear', /\bgit\s+stash\s+clear\b/],
  ['git stash drop', /\bgit\s+stash\s+drop\b/],
]);

const matchText = (text) => TEXT_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;

/** The rule a command breaks, or `null`. */
const dangerousRule = (command, depth = 0) => {
  const commands = depth > MAXIMUM_DEPTH ? NOT_WORDS : simpleCommands(command);

  if (commands === NOT_WORDS) {
    return matchText(command);
  }

  for (const words of commands) {
    const invoked = invocation(words);

    if (invoked === null) {
      continue;
    }

    if (SHELLS.has(invoked.program)) {
      const inner = shellCommandString(invoked.args);
      const rule = inner === null ? null : dangerousRule(inner, depth + 1);

      if (rule !== null) {
        return rule;
      }

      continue;
    }

    const git = invoked.program === 'git' ? gitSubcommand(invoked.args) : null;
    const broken = git === null ? undefined : RULES.find((rule) => rule.subcommand === git.subcommand && rule.matches(git.args));

    if (broken !== undefined) {
      return broken.rule;
    }
  }

  return null;
};

const NOTICE = (reason) => `guardrail: ${reason}; the command was allowed unchecked.\n`;

/**
 * How each client is answered: where its payload carries the command, and how
 * an allowed or a blocked command is told back to it. Claude Code is the
 * client answered when no argument is given, exactly as before Cursor was.
 */
const CLIENTS = Object.freeze({
  'claude-code': Object.freeze({
    field: 'tool_input.command',
    command: (hookPayload) => hookPayload?.tool_input?.command,
    allow: (notice = '') => ({ exitCode: 0, stdout: '', stderr: notice }),
    block: (message) => ({ exitCode: EXIT_BLOCK, stdout: '', stderr: `${message}\n` }),
  }),
  cursor: Object.freeze({
    field: 'command',
    command: (hookPayload) => hookPayload?.command,
    allow: (notice = '') => ({ exitCode: 0, stdout: `${JSON.stringify({ permission: 'allow' })}\n`, stderr: notice }),
    block: (message) => ({
      exitCode: 0,
      stdout: `${JSON.stringify({ permission: 'deny', userMessage: message, agentMessage: message })}\n`,
      stderr: '',
    }),
  }),
});

/** The client the arguments name: none is Claude Code, `--client cursor` is Cursor, anything else is `null`. */
const clientFor = (argv) => {
  if (argv.length === 0) {
    return CLIENTS['claude-code'];
  }

  return argv.length === 2 && argv[0] === '--client' && argv[1] === 'cursor' ? CLIENTS.cursor : null;
};

/**
 * Decide one hook payload for one client: `{ exitCode, stdout, stderr }`.
 * Anything but a JSON object carrying the client's command string is allowed
 * with a notice that names no part of the payload.
 */
const decide = (client, input) => {
  let hookPayload;

  try {
    hookPayload = JSON.parse(input);
  } catch {
    return client.allow(NOTICE('the hook payload on standard input is not JSON'));
  }

  const command = client.command(hookPayload);

  if (typeof command !== 'string') {
    return client.allow(NOTICE(`the hook payload carries no ${client.field} string`));
  }

  const rule = dangerousRule(command);

  return rule === null ? client.allow() : client.block(blockedMessage(command, rule));
};

const readStandardInput = async () => {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
};

// A program, not a module: it always runs, through whatever path the client
// invoked it by, so it carries no entry-point guard and exports nothing.
// Standard input is read in full either way, so the client never writes into
// a closed pipe.
const input = await readStandardInput();
const client = clientFor(process.argv.slice(2));
const { exitCode, stdout, stderr } = client === null
  // Arguments it does not know name no client format it could answer in.
  ? { exitCode: 0, stdout: '', stderr: NOTICE('its arguments name no client it answers') }
  : decide(client, input);

process.stdout.write(stdout);
process.stderr.write(stderr);
process.exitCode = exitCode;
