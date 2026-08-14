import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { revisionOfWorldFacts } from '../world-runtime/world-revision.mjs';

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

export function createJsonTransactionJournal({ file }) {
  if (!file) throw problem('INVALID_TRANSACTION_JOURNAL', 'file is required');

  async function preserveLegacyHistory() {
    const archive = `${file}.full-history-v1.archive`;
    try {
      await fs.copyFile(file, archive, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'ENOENT') throw error;
    }
  }

  async function load() {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.prepared) || !Array.isArray(parsed.receipts)) {
        throw problem('INVALID_TRANSACTION_JOURNAL', 'Transaction journal has an invalid shape');
      }
      if (parsed.historyMode !== JOURNAL_HISTORY_MODE) {
        await preserveLegacyHistory();
        parsed.receipts = compactReceiptHistory(parsed.receipts);
        parsed.historyMode = JOURNAL_HISTORY_MODE;
        await writeJsonAtomically(file, parsed);
      }
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(EMPTY_JOURNAL);
      if (error.code === 'INVALID_TRANSACTION_JOURNAL') throw error;
      throw problem('TRANSACTION_JOURNAL_READ_FAILED', 'Cannot read transaction journal', { cause: error.code });
    }
  }

  async function save(state) {
    await writeJsonAtomically(file, state);
  }

  async function findReceipt(commandId) {
    return structuredClone((await load()).receipts.find((entry) => entry.commandId === commandId)?.receipt ?? null);
  }

  async function findPrepared(commandId) {
    return structuredClone((await load()).prepared.find((entry) => entry.commandId === commandId) ?? null);
  }

  async function findCommitted(commandId) {
    return structuredClone((await load()).receipts.find((entry) => entry.commandId === commandId) ?? null);
  }

  async function prepare(record) {
    const state = await load();
    if (state.prepared.some((entry) => entry.commandId === record.commandId)
      || state.receipts.some((entry) => entry.commandId === record.commandId)) {
      throw problem('DUPLICATE_COMMAND_ID', `Command ${record.commandId} already exists`);
    }
    state.prepared.push(structuredClone(record));
    await save(state);
  }

  async function commit(commandId, receipt) {
    const state = await load();
    const prepared = state.prepared.find((entry) => entry.commandId === commandId);
    if (!prepared) {
      const existing = state.receipts.find((entry) => entry.commandId === commandId);
      if (existing) return structuredClone(existing.receipt);
      throw problem('MISSING_PREPARED_TRANSACTION', `Command ${commandId} was not prepared`);
    }
    state.prepared = state.prepared.filter((entry) => entry.commandId !== commandId);
    state.receipts.push({ ...structuredClone(prepared), receipt: structuredClone(receipt) });
    state.receipts = compactReceiptHistory(state.receipts);
    await save(state);
    return structuredClone(receipt);
  }

  async function listPrepared() {
    return structuredClone((await load()).prepared);
  }

  async function readState() {
    const state = await load();
    return {
      prepared: structuredClone(state.prepared),
      receipts: structuredClone(state.receipts)
    };
  }

  return Object.freeze({ file, findReceipt, findPrepared, findCommitted, prepare, commit, listPrepared, readState });
}
