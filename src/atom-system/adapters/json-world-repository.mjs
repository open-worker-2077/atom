import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { constants as zlibConstants, gzip, gunzip } from 'node:zlib';
import { revisionOfWorldFacts } from '../world-runtime/world-revision.mjs';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

const TRANSIENT_REPLACE_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);

function wait(milliseconds) {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

export async function writeJsonAtomically(file, value, options = {}) {
  const fileSystem = options.fileSystem ?? fs;
  const retryDelaysMs = options.retryDelaysMs ?? [20, 50, 100, 200, 400];
  await fileSystem.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fileSystem.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx'
    });
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fileSystem.rename(temporary, file);
        break;
      } catch (error) {
        if (!TRANSIENT_REPLACE_ERRORS.has(error.code) || attempt >= retryDelaysMs.length - 1) throw error;
        await wait(retryDelaysMs[attempt]);
      }
    }
  } finally {
    await fileSystem.rm(temporary, { force: true }).catch(() => {});
  }
}

function snapshot(worldId, facts) {
  if (!Array.isArray(facts)) {
    throw problem('INVALID_WORLD_FILE', 'Atom world facts must be a JSON array');
  }
  return Object.freeze({
    contract: 'atom.world-snapshot',
    version: 1,
    worldId,
    revision: revisionOfWorldFacts(facts),
    facts: structuredClone(facts)
  });
}

export function createJsonWorldRepository({ file, worldId, initialFacts }) {
  if (!file || !worldId) throw problem('INVALID_WORLD_REPOSITORY', 'file and worldId are required');

  async function read() {
    let value;
    try {
      value = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' && Array.isArray(initialFacts)) {
        return snapshot(worldId, initialFacts);
      }
      throw problem('WORLD_READ_FAILED', `Cannot read Atom world ${worldId}`, { cause: error.code });
    }
    return snapshot(worldId, value);
  }

  async function compareAndSwap({ expectedRevision, nextSnapshot }) {
    const current = await read();
    if (current.revision !== expectedRevision) {
      throw problem('WORLD_REVISION_CONFLICT', 'Atom world changed before commit', {
        expectedRevision,
        actualRevision: current.revision
      });
    }
    if (nextSnapshot.worldId !== worldId || !Array.isArray(nextSnapshot.facts)) {
      throw problem('INVALID_WORLD_SNAPSHOT', 'The next world snapshot is invalid');
    }
    if (revisionOfWorldFacts(nextSnapshot.facts) !== nextSnapshot.revision) {
      throw problem('INVALID_WORLD_REVISION', 'The next snapshot revision does not match its facts');
    }
    await writeJsonAtomically(file, nextSnapshot.facts);
    return read();
  }

  return Object.freeze({ file, worldId, read, compareAndSwap });
}

const JOURNAL_HISTORY_MODE = 'latest-rollback-snapshot';
const EMPTY_JOURNAL = Object.freeze({
  schemaVersion: 1,
  historyMode: JOURNAL_HISTORY_MODE,
  prepared: [],
  receipts: []
});

function compactSnapshot(value) {
  if (!value || typeof value !== 'object') return value;
  const { facts: _facts, ...identity } = value;
  return identity;
}

function compactReceiptHistory(receipts) {
  const latestIndex = receipts.length - 1;
  return receipts.map((entry, index) => index === latestIndex
    ? entry
    : {
        ...entry,
        before: compactSnapshot(entry.before),
        after: compactSnapshot(entry.after)
      });
}

export function createJsonTransactionJournal({ file, incrementalDirectory = `${file}.d` }) {
  if (!file) throw problem('INVALID_TRANSACTION_JOURNAL', 'file is required');
  const eventFile = path.join(incrementalDirectory, 'events.jsonl');
  const objectDirectory = path.join(incrementalDirectory, 'objects');
  let statePromise = null;
  let tail = Promise.resolve();

  async function loadLegacy() {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.prepared) || !Array.isArray(parsed.receipts)) {
        throw problem('INVALID_TRANSACTION_JOURNAL', 'Transaction journal has an invalid shape');
      }
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(EMPTY_JOURNAL);
      if (error.code === 'INVALID_TRANSACTION_JOURNAL') throw error;
      throw problem('TRANSACTION_JOURNAL_READ_FAILED', 'Cannot read transaction journal', { cause: error.code });
    }
  }

  function snapshotObjectFile(revision) {
    const match = /^sha256:([a-f0-9]{64})$/u.exec(revision ?? '');
    if (!match) throw problem('INVALID_WORLD_REVISION', 'Snapshot requires a sha256 revision');
    return path.join(objectDirectory, `${match[1]}.json.gz`);
  }

  async function readSnapshot(identity) {
    if (Array.isArray(identity?.facts)) return structuredClone(identity);
    if (!identity?.snapshotRef) return structuredClone(identity);
    const objectFile = snapshotObjectFile(identity?.snapshotRef ?? identity?.revision);
    let value;
    try {
      value = JSON.parse((await gunzipAsync(await fs.readFile(objectFile))).toString('utf8'));
    } catch (error) {
      throw problem('TRANSACTION_SNAPSHOT_READ_FAILED', 'Cannot read transaction snapshot object', {
        revision: identity?.revision,
        cause: error.code ?? error.name
      });
    }
    if (value?.revision !== identity.revision
      || value?.worldId !== identity.worldId
      || revisionOfWorldFacts(value?.facts) !== value.revision) {
      throw problem('INVALID_TRANSACTION_SNAPSHOT', 'Transaction snapshot object failed revision verification', {
        revision: identity?.revision
      });
    }
    return value;
  }

  async function persistSnapshot(value) {
    if (!value || revisionOfWorldFacts(value.facts) !== value.revision) {
      throw problem('INVALID_TRANSACTION_SNAPSHOT', 'Transaction snapshot does not match its revision');
    }
    const objectFile = snapshotObjectFile(value.revision);
    await fs.mkdir(objectDirectory, { recursive: true });
    let handle;
    let created = false;
    try {
      handle = await fs.open(objectFile, 'wx');
      created = true;
      await handle.writeFile(await gzipAsync(
        Buffer.from(JSON.stringify(value), 'utf8'),
        { level: zlibConstants.Z_BEST_SPEED }
      ));
      await handle.sync();
    } catch (error) {
      await handle?.close();
      handle = null;
      if (error.code !== 'EEXIST') {
        if (created) await fs.rm(objectFile, { force: true }).catch(() => {});
        throw error;
      }
      await readSnapshot({ ...compactSnapshot(value), snapshotRef: value.revision });
    } finally {
      await handle?.close();
    }
    return { ...compactSnapshot(value), snapshotRef: value.revision };
  }

  async function compactRecord(record) {
    const [before, after] = await Promise.all([
      persistSnapshot(record.before),
      persistSnapshot(record.after)
    ]);
    return { ...structuredClone(record), before, after };
  }

  async function hydrateRecord(record) {
    if (!record) return null;
    const [before, after] = await Promise.all([
      readSnapshot(record.before),
      readSnapshot(record.after)
    ]);
    return { ...structuredClone(record), before, after };
  }

  async function appendEvent(event) {
    await fs.mkdir(incrementalDirectory, { recursive: true });
    const handle = await fs.open(eventFile, 'a');
    try {
      await handle.writeFile(`${JSON.stringify({ schemaVersion: 2, ...event })}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function loadEvents() {
    let text;
    try {
      text = await fs.readFile(eventFile, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw problem('TRANSACTION_JOURNAL_READ_FAILED', 'Cannot read incremental transaction events', {
        cause: error.code
      });
    }
    const lines = text.split('\n');
    if (lines.at(-1) !== '') lines.pop();
    else lines.pop();
    return lines.filter(Boolean).map((line, index) => {
      try {
        const event = JSON.parse(line);
        if (event?.schemaVersion !== 2 || !['prepared', 'committed'].includes(event.type)) {
          throw new Error('invalid event');
        }
        return event;
      } catch (error) {
        throw problem('INVALID_TRANSACTION_EVENT', 'Incremental transaction event is invalid', {
          line: index + 1,
          cause: error.message
        });
      }
    });
  }

  async function loadState() {
    const legacy = await loadLegacy();
    const prepared = new Map(legacy.prepared.map((entry) => [entry.commandId, structuredClone(entry)]));
    const receipts = new Map(legacy.receipts.map((entry) => [entry.commandId, structuredClone(entry)]));
    const order = legacy.receipts.map((entry) => entry.commandId);
    for (const event of await loadEvents()) {
      if (event.type === 'prepared') {
        if (receipts.has(event.commandId)) continue;
        prepared.set(event.commandId, event.record);
        continue;
      }
      prepared.delete(event.commandId);
      if (!receipts.has(event.commandId)) order.push(event.commandId);
      receipts.set(event.commandId, { ...event.record, receipt: event.receipt });
    }
    return { prepared, receipts, order };
  }

  function load() {
    statePromise ??= loadState();
    return statePromise;
  }

  function serialize(operation) {
    const running = tail.then(operation, operation);
    tail = running.catch(() => {});
    return running;
  }

  async function findReceipt(commandId) {
    return structuredClone((await load()).receipts.get(commandId)?.receipt ?? null);
  }

  async function findPrepared(commandId) {
    return hydrateRecord((await load()).prepared.get(commandId));
  }

  async function findCommitted(commandId) {
    return hydrateRecord((await load()).receipts.get(commandId));
  }

  function prepare(record) {
    return serialize(async () => {
      const state = await load();
      if (state.prepared.has(record.commandId) || state.receipts.has(record.commandId)) {
        throw problem('DUPLICATE_COMMAND_ID', `Command ${record.commandId} already exists`);
      }
      const compact = await compactRecord(record);
      await appendEvent({ type: 'prepared', commandId: record.commandId, record: compact });
      state.prepared.set(record.commandId, compact);
    });
  }

  function commit(commandId, receipt) {
    return serialize(async () => {
      const state = await load();
      const prepared = state.prepared.get(commandId);
      if (!prepared) {
        const existing = state.receipts.get(commandId);
        if (existing) return structuredClone(existing.receipt);
        throw problem('MISSING_PREPARED_TRANSACTION', `Command ${commandId} was not prepared`);
      }
      await appendEvent({
        type: 'committed', commandId, record: prepared, receipt: structuredClone(receipt)
      });
      state.prepared.delete(commandId);
      if (!state.receipts.has(commandId)) state.order.push(commandId);
      state.receipts.set(commandId, { ...prepared, receipt: structuredClone(receipt) });
      return structuredClone(receipt);
    });
  }

  async function listPrepared() {
    return Promise.all([...((await load()).prepared.values())].map(hydrateRecord));
  }

  async function readState() {
    const state = await load();
    const prepared = await Promise.all([...state.prepared.values()].map(hydrateRecord));
    const compactReceipts = state.order.map((id) => structuredClone(state.receipts.get(id)));
    const receipts = compactReceiptHistory(compactReceipts);
    if (receipts.length) receipts[receipts.length - 1] = await hydrateRecord(receipts.at(-1));
    return { prepared, receipts };
  }

  return Object.freeze({
    file, incrementalDirectory, eventFile, objectDirectory,
    findReceipt, findPrepared, findCommitted, prepare, commit, listPrepared, readState
  });
}
