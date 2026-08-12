/**
 * Desktop adapter registration surfaces (FR-ADAPT-008).
 *
 * A desktop client does not run the Gate because the Gate is installed. It runs
 * it because an entry naming the Gate's command sits in that client's own
 * configuration file — and the three v1 surfaces disagree about which file that
 * is, what shape the entry has, and whether the format is versioned at all.
 *
 * Nothing in this module knows any of that. Every file path, container key,
 * block shape, matcher, event-key casing, and schema version is read from the
 * adapter's own declaration, so activation, health reconciliation, and removal
 * act on a registration only through the declaration and never through a branch
 * on a client name (SG-OWNER-001, AC-ADAPT-003).
 *
 * Two rules shape every write here:
 *
 * 1. **The adapter owns one entry, and nothing else in the file.** These are
 *    documents their clients own: one of them holds `permissions` beside its
 *    hooks, another holds its own format version. Registration merges one entry
 *    into the declared array and leaves every other key, every other event, and
 *    every other entry exactly as their owner wrote them (SG-HOOK-001).
 * 2. **A surface that cannot be confirmed is `unverified`, never registered.**
 *    A missing file, unreadable bytes, or a container that is not where the
 *    declaration says it is means the Gate does not know what it is looking at,
 *    and it says so rather than assuming a mechanism it cannot confirm.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { describeAdapter } from './adapters.mjs';
import { contentIdentity } from './evidence-store.mjs';

const isPlainObject = (value) => typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

/**
 * Resolve one adapter's declared registration surface against a clone.
 *
 * The answer is `null` for an adapter that declares no client configuration
 * file, which is how authoritative Git is excluded without naming it.
 */
export const describeRegistrationSurface = ({ adapterId, repositoryRoot } = {}) => {
  const adapter = describeAdapter(adapterId);
  const declaration = adapter?.registration ?? null;

  if (declaration === null || declaration.kind !== 'client-configuration-file') {
    return null;
  }

  return {
    adapterId: adapter.id,
    declaration,
    // The event key is the adapter's own declared native event for the declared
    // trigger, so registration and trigger matching can never disagree about a
    // client's event-name casing.
    eventKey: adapter.nativeEvents[declaration.trigger] ?? null,
    path: path.resolve(repositoryRoot ?? '.', declaration.file),
  };
};

/**
 * The exact entry a given surface would register for a given command.
 *
 * The shape comes from the declaration and nowhere else: a matcher group
 * wrapping a typed inner array, or a flat command with neither.
 */
export const plannedRegistrationEntry = ({ declaration, command }) => {
  if (declaration.blockSchema === 'matcher-group') {
    return {
      matcher: declaration.matcher,
      hooks: [{ type: declaration.commandType, command }],
    };
  }

  return { command };
};

/** The durable content identity of one registered entry. */
export const registrationEntryIdentity = (entry) => contentIdentity(entry);

/** Every command one entry names, read through the declared block schema. */
const commandsIn = (declaration, entry) => {
  if (declaration.blockSchema === 'matcher-group') {
    return (Array.isArray(entry?.hooks) ? entry.hooks : [])
      .map((inner) => inner?.command)
      .filter((command) => typeof command === 'string');
  }

  return typeof entry?.command === 'string' ? [entry.command] : [];
};

/**
 * The indentation a document already uses.
 *
 * A client configuration file is its owner's file. Reading its own indentation
 * back means a registration that is later withdrawn returns the document to the
 * bytes it started with rather than to this module's house style.
 */
const detectIndent = (text) => {
  const match = /\n([ \t]+)\S/.exec(text);

  return match === null ? 2 : (match[1].includes('\t') ? '\t' : match[1].length);
};

/**
 * Read one declared surface without judging it.
 *
 * Everything this returns is either what the file actually holds or an explicit
 * statement that it could not be read. Nothing is defaulted into existence.
 */
const readSurfaceDocument = async (surface) => {
  const text = await readFile(surface.path, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (text === null) {
    return {
      confirmed: false,
      detail: `The declared registration file ${surface.declaration.file} is not on disk.`,
      text: null,
      document: null,
    };
  }

  let document = null;

  try {
    document = JSON.parse(text);
  } catch (error) {
    return {
      confirmed: false,
      detail: `The declared registration file ${surface.declaration.file} is not readable as its declared format: ${error.message}.`,
      text,
      document: null,
    };
  }

  if (!isPlainObject(document)) {
    return {
      confirmed: false,
      detail: `The declared registration file ${surface.declaration.file} does not hold a configuration document.`,
      text,
      document: null,
    };
  }

  return { confirmed: true, detail: null, text, document };
};

/** Follow the declared container path, without creating anything. */
const containerIn = (document, declaration) => {
  let node = document;

  for (const key of declaration.container) {
    if (!isPlainObject(node?.[key])) {
      return null;
    }

    node = node[key];
  }

  return node;
};

/**
 * Follow the declared container path, creating only what is missing — and
 * remembering exactly what had to be created.
 *
 * What the Gate created, the Gate takes back. A file whose owner has never
 * registered a hook must be returned to exactly that state on removal, not left
 * with an empty container implying a registration that is not there.
 */
const ensureContainer = (document, declaration) => {
  let node = document;
  let createdAt = null;

  declaration.container.forEach((key, index) => {
    if (!isPlainObject(node[key])) {
      node[key] = {};
      createdAt = createdAt === null ? index : createdAt;
    }

    node = node[key];
  });

  return { container: node, createdAt };
};

/** Drop the outermost container segment the Gate created, if it created one. */
const dropCreatedContainer = (document, declaration, createdAt) => {
  if (createdAt === null || createdAt === undefined) {
    return;
  }

  let node = document;

  for (const key of declaration.container.slice(0, createdAt)) {
    node = node[key];
  }

  delete node[declaration.container[createdAt]];
};

/** Publish a configuration document by one atomic rename. */
const publishDocument = async ({ surface, document, indent, trailingNewline }) => {
  const directory = path.dirname(surface.path);
  const staged = path.join(directory, `.${path.basename(surface.path)}.${randomUUID()}.part`);
  const serialized = `${JSON.stringify(document, null, indent)}${trailingNewline ? '\n' : ''}`;

  await mkdir(directory, { recursive: true });
  await writeFile(staged, serialized, 'utf8');

  try {
    await rename(staged, surface.path);
  } catch (error) {
    await rm(staged, { force: true });

    throw error;
  }
};

/**
 * Register one adapter's Gate entry in its own declared surface.
 *
 * The entry is appended to the declared event's array, so an entry that was
 * already there keeps both its content and its position. Every other key in the
 * document is written back exactly as it was read (SG-HOOK-001).
 */
export const registerAdapterSurface = async ({
  adapterId,
  repositoryRoot,
  command,
} = {}) => {
  const surface = describeRegistrationSurface({ adapterId, repositoryRoot });

  if (surface === null) {
    return null;
  }

  /**
   * One registration outcome, in one shape.
   *
   * A surface that could not be registered reports `unverified` and carries no
   * entry identity, so nothing downstream can mistake it for a registration
   * (FR-ADAPT-008, AC-ADAPT-003).
   */
  const record = (fields) => ({
    adapterId: surface.adapterId,
    kind: surface.declaration.kind,
    path: surface.path,
    eventKey: surface.eventKey,
    blockSchema: surface.declaration.blockSchema,
    command: typeof command === 'string' && command.length > 0 ? command : null,
    entryIdentity: null,
    registered: false,
    confirmed: false,
    state: 'unverified',
    reason: null,
    detail: null,
    ...fields,
  });

  if (typeof command !== 'string' || command.length === 0) {
    return record({
      reason: 'command-missing',
      detail: `${surface.adapterId} has no Gate command to register.`,
    });
  }

  const read = await readSurfaceDocument(surface);

  if (!read.confirmed) {
    // The Gate never creates a client's configuration file. It cannot know a
    // format it has not confirmed — including whether that format carries its
    // own version — so it reports the surface rather than inventing one.
    return record({ reason: 'surface-unconfirmed', detail: read.detail });
  }

  const entry = plannedRegistrationEntry({ declaration: surface.declaration, command });
  const { container, createdAt } = ensureContainer(read.document, surface.declaration);
  const createdEventKey = !Array.isArray(container[surface.eventKey]);

  if (createdEventKey) {
    container[surface.eventKey] = [];
  }

  container[surface.eventKey].push(entry);

  await publishDocument({
    surface,
    document: read.document,
    indent: detectIndent(read.text),
    trailingNewline: read.text.endsWith('\n'),
  });

  return record({
    registered: true,
    confirmed: true,
    state: 'registered',
    entryIdentity: registrationEntryIdentity(entry),
    // Exactly what this registration added beyond the entry itself, so removal
    // can return the document to the shape its owner wrote.
    created: { container: createdAt, eventKey: createdEventKey },
  });
};

/**
 * Locate the Gate's own entry in a declared surface, without judging it.
 *
 * The entry is found by the command the receipt pinned, never by position: a
 * client that reorders its own hooks, or an operator who adds one above the
 * Gate's, must not cause the Gate to read somebody else's entry as its own.
 */
const locateRegistration = ({ surface, document, command }) => {
  const container = containerIn(document, surface.declaration);
  const entries = Array.isArray(container?.[surface.eventKey]) ? container[surface.eventKey] : null;

  if (entries === null) {
    return { entries: null, indexes: [] };
  }

  const indexes = entries
    .map((entry, index) => (commandsIn(surface.declaration, entry).includes(command) ? index : -1))
    .filter((index) => index !== -1);

  return { entries, indexes };
};

/**
 * Reconcile one pinned registration against the surface the adapter declares.
 *
 * This is observation only: it opens nothing for writing, creates nothing, and
 * repairs nothing it finds. Every answer is either what the client's file
 * actually holds or an explicit statement that the declared surface could not
 * be confirmed — which is never counted as registered (FR-ADAPT-008,
 * FR-LIFE-009, SG-LIFE-001).
 */
export const reconcileAdapterRegistration = async ({
  adapterId,
  repositoryRoot,
  registration = null,
} = {}) => {
  const surface = describeRegistrationSurface({ adapterId, repositoryRoot });

  if (surface === null) {
    return null;
  }

  const state = (value, detail = null) => ({
    adapterId: surface.adapterId,
    state: value,
    path: surface.path,
    registered: value === 'registered',
    detail,
  });

  const command = registration?.command ?? null;
  const entryIdentity = registration?.entryIdentity ?? null;

  // A receipt that pins an unverified surface is already telling the truth: the
  // Gate never registered there, so there is no entry to reconcile and the
  // surface stays `unverified` rather than being counted or quietly forgotten.
  if (registration !== null && registration.registered !== true) {
    return state(
      'unverified',
      registration.reason === null || registration.reason === undefined
        ? `${surface.adapterId} has no confirmed registration in ${surface.declaration.file}.`
        : `${surface.adapterId} has no confirmed registration in ${surface.declaration.file} (${registration.reason}).`,
    );
  }

  if (typeof command !== 'string' || command.length === 0 || entryIdentity === null) {
    return state('unpinned', 'The receipt pins no registration for this surface.');
  }

  // A registration written into a file this adapter no longer declares cannot
  // be reconciled through the declaration, and reconciling it any other way
  // would be exactly the assumption FR-ADAPT-008 forbids.
  if (registration.path != null && path.resolve(registration.path) !== surface.path) {
    return state(
      'unverified',
      `The registered file ${registration.path} is not the file ${surface.adapterId} declares.`,
    );
  }

  const read = await readSurfaceDocument(surface);

  if (!read.confirmed) {
    return state('unverified', read.detail);
  }

  const located = locateRegistration({ surface, document: read.document, command });

  if (located.entries === null || located.indexes.length === 0) {
    return state('absent', `No entry naming the Gate command remains under ${surface.eventKey}.`);
  }

  if (located.indexes.length > 1) {
    return state(
      'ambiguous',
      `${located.indexes.length} entries under ${surface.eventKey} name the Gate command.`,
    );
  }

  if (registrationEntryIdentity(located.entries[located.indexes[0]]) !== entryIdentity) {
    return state('drifted', `The registered entry under ${surface.eventKey} is no longer the entry this activation wrote.`);
  }

  return state('registered');
};

/**
 * Withdraw one adapter's Gate entry from its own declared surface.
 *
 * Removal takes exactly one entry, and only when that entry is still byte-for-
 * byte the entry the receipt pinned. Every other entry under the same event,
 * every other event, and every other key in the document is written back
 * unchanged — including the client's own format version, which the Gate never
 * owns and never advances.
 *
 * Nothing here repairs, forces, or removes a drifted entry: a mismatch is
 * reported and left exactly where it is. `dryRun` answers the same question
 * without touching the file, so a caller can prove every removal is safe before
 * it performs the first one (SG-HOOK-001, SG-LIFE-001).
 */
export const withdrawAdapterRegistration = async ({
  adapterId,
  repositoryRoot,
  registration = null,
  dryRun = false,
} = {}) => {
  const refuse = (reason, detail = null) => ({ removable: false, removed: false, reason, detail });
  const surface = describeRegistrationSurface({ adapterId, repositoryRoot });

  if (surface === null) {
    return refuse('no-registration-surface');
  }

  const command = registration?.command ?? null;
  const entryIdentity = registration?.entryIdentity ?? null;

  if (typeof command !== 'string' || command.length === 0 || entryIdentity === null) {
    // Without both the command that names the entry and the identity that
    // proves it is unchanged, nothing shows the Gate wrote it.
    return refuse('unknown-registration');
  }

  const read = await readSurfaceDocument(surface);

  if (!read.confirmed) {
    return refuse('surface-unverified', read.detail);
  }

  const located = locateRegistration({ surface, document: read.document, command });

  if (located.entries === null || located.indexes.length === 0) {
    return refuse('registration-absent');
  }

  if (located.indexes.length > 1) {
    return refuse('registration-ambiguous');
  }

  const [index] = located.indexes;

  if (registrationEntryIdentity(located.entries[index]) !== entryIdentity) {
    return refuse('registration-drifted');
  }

  if (dryRun) {
    return { removable: true, removed: false, reason: null, detail: null };
  }

  located.entries.splice(index, 1);

  // Whatever this registration had to create around its entry goes back with
  // it, and only when it is still empty: an event another hook has since been
  // added under is not the Gate's to remove.
  const created = registration.created ?? { container: null, eventKey: false };

  if (created.eventKey === true && located.entries.length === 0) {
    const container = containerIn(read.document, surface.declaration);

    delete container[surface.eventKey];

    if (Object.keys(container).length === 0) {
      dropCreatedContainer(read.document, surface.declaration, created.container);
    }
  }

  await publishDocument({
    surface,
    document: read.document,
    indent: detectIndent(read.text),
    trailingNewline: read.text.endsWith('\n'),
  });

  return { removable: true, removed: true, reason: null, detail: null };
};
