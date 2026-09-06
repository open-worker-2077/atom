import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { constants as zlibConstants, gzip, gunzip } from 'node:zlib';
import {
  revisionOfWorldFacts,
  prepareWorldFactsRevision,
  sealWorldFactsRevision
} from '../world-runtime/world-revision.mjs';
import { applyLocalWorldPatch } from '../world-runtime/local-world-patch.mjs';

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
    const serialized = options.serialized ?? `${JSON.stringify(value, null, 2)}\n`;
    if (options.syncTemporary) {
      const handle = await fileSystem.open(temporary, 'wx');
      try {
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } else {
      await fileSystem.writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx' });
    }
    await options.beforeRename?.(temporary);
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

function snapshot(worldId, facts, { ownsFacts = false } = {}) {
  if (!Array.isArray(facts)) {
    throw problem('INVALID_WORLD_FILE', 'Atom world facts must be a JSON array');
  }
  const ownedFacts = ownsFacts ? facts : structuredClone(facts);
  return Object.freeze({
    contract: 'atom.world-snapshot',
    version: 1,
    worldId,
    revision: sealWorldFactsRevision(ownedFacts),
    facts: ownedFacts
  });
}

export function createJsonWorldRepository({
  file,
  worldId,
  initialFacts,
  localCommitFile = `${file}.local-commits.jsonl`,
  autoCompact = false,
  fileSystem = fs,
  faultInjector = async () => {}
}) {
  if (!file || !worldId) throw problem('INVALID_WORLD_REPOSITORY', 'file and worldId are required');
  let cached = null;
  let cachedSignature = null;
  let tail = Promise.resolve();
  let localRecordCount = 0;
  let compactionPromise = null;
  const compactionThreshold = autoCompact === true
    ? 128
    : Number.isSafeInteger(autoCompact) && autoCompact > 0 ? autoCompact : 0;

  function serialize(work) {
    const running = tail.then(work, work);
    tail = running.catch(() => {});
    return running;
  }

  async function fileSignature(target, optional = false) {
    try {
      const stat = await fileSystem.stat(target, { bigint: true });
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    } catch (error) {
      if (optional && error.code === 'ENOENT') return 'missing';
      throw error;
    }
  }

  async function signature() {
    return `${await fileSignature(file)}|${await fileSignature(localCommitFile, true)}`;
  }

  async function localRecords() {
    let raw;
    try {
      raw = await fileSystem.readFile(localCommitFile, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const lines = raw.split('\n');
    if (lines.at(-1) !== '') lines.pop();
    else lines.pop();
    return lines.filter(Boolean).map((line, index) => {
      try {
        const record = JSON.parse(line);
        const localCommit = record?.contract === 'atom.local-commit'
          && record.version === 1
          && record.worldId === worldId
          && ['patch', 'full'].includes(record.mode);
        const watermark = record?.contract === 'atom.local-commit-watermark'
          && record.version === 1
          && record.worldId === worldId
          && /^sha256:[a-f0-9]{64}$/u.test(record.revision ?? '')
          && (record.throughCommandId === null || typeof record.throughCommandId === 'string');
        if (!localCommit && !watermark) {
          throw new Error('invalid local commit');
        }
        return record;
      } catch (error) {
        throw problem('INVALID_LOCAL_WORLD_COMMIT', 'Local world commit record is invalid', {
          line: index + 1,
          cause: error.message
        });
      }
    });
  }

  function applyRecord(current, record) {
    if (current.revision !== record.beforeRevision) {
      throw problem('LOCAL_WORLD_COMMIT_CHAIN_BROKEN', 'Local world commit does not continue the baseline', {
        expectedRevision: current.revision,
        recordRevision: record.beforeRevision,
        commandId: record.commandId
      });
    }
    const facts = record.mode === 'patch'
      ? applyLocalWorldPatch(current.facts, record.patch)
      : structuredClone(record.facts);
    const next = snapshot(worldId, facts, { ownsFacts: true });
    if (next.revision !== record.afterRevision) {
      throw problem('INVALID_LOCAL_WORLD_COMMIT', 'Local world commit result has the wrong revision', {
        commandId: record.commandId
      });
    }
    return next;
  }

  async function read() {
    let beforeSignature;
    let value;
    try {
      beforeSignature = await signature();
      if (cached && cachedSignature === beforeSignature) return cached;
      const raw = await fileSystem.readFile(file, 'utf8');
      const afterSignature = await signature();
      if (afterSignature !== beforeSignature) return read();
      value = JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT' && Array.isArray(initialFacts)) {
        cached = snapshot(worldId, initialFacts);
        cachedSignature = null;
        return cached;
      }
      throw problem('WORLD_READ_FAILED', `Cannot read Atom world ${worldId}`, { cause: error.code });
    }
    let materialized = snapshot(worldId, value, { ownsFacts: true });
    const records = await localRecords();
    let start = 0;
    for (let index = records.length - 1; index >= 0; index -= 1) {
      if (records[index].contract === 'atom.local-commit-watermark'
        && records[index].revision === materialized.revision) {
        start = index + 1;
        break;
      }
    }
    if (start === 0) {
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (records[index].contract === 'atom.local-commit'
          && records[index].afterRevision === materialized.revision) {
          start = index + 1;
          break;
        }
      }
    }
    const pendingRecords = records.slice(start)
      .filter((record) => record.contract === 'atom.local-commit');
    localRecordCount = pendingRecords.length;
    for (const record of pendingRecords) materialized = applyRecord(materialized, record);
    const finalSignature = await signature();
    if (finalSignature !== beforeSignature) return read();
    cached = materialized;
    cachedSignature = finalSignature;
    return cached;
  }

  async function appendRecord(record) {
    await fileSystem.mkdir(path.dirname(localCommitFile), { recursive: true });
    const handle = await fileSystem.open(localCommitFile, 'a');
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    localRecordCount += 1;
  }

  function appendLocalCommit({ commandId, expectedRevision, nextSnapshot, patch }) {
    return serialize(async () => {
      if (nextSnapshot?.worldId !== worldId || !Array.isArray(nextSnapshot?.facts)) {
        throw problem('INVALID_WORLD_SNAPSHOT', 'The next world snapshot is invalid');
      }
      if (revisionOfWorldFacts(nextSnapshot.facts) !== nextSnapshot.revision) {
        throw problem('INVALID_WORLD_REVISION', 'The next snapshot revision does not match its facts');
      }
      const current = await read();
      if (current.revision !== expectedRevision) {
        throw problem('WORLD_REVISION_CONFLICT', 'Atom world changed before local commit', {
          expectedRevision,
          actualRevision: current.revision
        });
      }
      const facts = applyLocalWorldPatch(current.facts, patch);
      const prepared = snapshot(worldId, facts, { ownsFacts: true });
      if (prepared.revision !== nextSnapshot.revision) {
        throw problem('INVALID_WORLD_REVISION', 'Local patch does not produce the next snapshot revision');
      }
      const record = {
        contract: 'atom.local-commit', version: 1, mode: 'patch', worldId,
        commandId, beforeRevision: current.revision, afterRevision: prepared.revision,
        patch
      };
      await faultInjector('before-local-append', structuredClone(record));
      await appendRecord(record);
      await faultInjector('after-local-append-sync', structuredClone(record));
      await faultInjector('before-memory-publication', structuredClone(record));
      cached = prepared;
      cachedSignature = await signature();
      return prepared;
    });
  }

  function compactCommittedState() {
    return serialize(async () => {
      const current = await read();
      const committedRecords = (await localRecords())
        .filter((record) => record.contract === 'atom.local-commit');
      const prepared = prepareWorldFactsRevision(current.facts);
      await writeJsonAtomically(file, current.facts, {
        fileSystem,
        serialized: `${prepared.json}\n`,
        syncTemporary: true,
        beforeRename: async (temporary) => {
          const verifiedFacts = JSON.parse(await fileSystem.readFile(temporary, 'utf8'));
          if (revisionOfWorldFacts(verifiedFacts) !== current.revision) {
            throw problem('INVALID_WORLD_REVISION', 'Compacted baseline failed revision verification');
          }
          await faultInjector('during-compaction-write', structuredClone(current));
        }
      });
      await faultInjector('after-compaction-replace', structuredClone(current));
      const watermark = {
        contract: 'atom.local-commit-watermark',
        version: 1,
        worldId,
        revision: current.revision,
        throughCommandId: committedRecords.at(-1)?.commandId ?? null
      };
      await writeJsonAtomically(localCommitFile, null, {
        fileSystem,
        serialized: `${JSON.stringify(watermark)}\n`,
        syncTemporary: true
      });
      localRecordCount = 0;
      cached = current;
      cachedSignature = await signature();
      return current;
    });
  }

  function scheduleCompaction() {
    if (!compactionThreshold || localRecordCount < compactionThreshold) return null;
    if (compactionPromise) return compactionPromise;
    compactionPromise = new Promise((resolve) => {
      const timer = setTimeout(resolve, 0);
      timer.unref?.();
    }).then(compactCommittedState).catch(() => null).finally(() => {
      compactionPromise = null;
    });
    return compactionPromise;
  }

  function compareAndSwap({ expectedRevision, nextSnapshot, currentSnapshot = null }) {
    return serialize(async () => {
      const current = currentSnapshot ?? await read();
      if (current.worldId !== worldId || !Array.isArray(current.facts)) {
        throw problem('INVALID_WORLD_SNAPSHOT', 'The current world snapshot is invalid');
      }
      if (current.revision !== expectedRevision) {
        throw problem('WORLD_REVISION_CONFLICT', 'Atom world changed before commit', {
          expectedRevision,
          actualRevision: current.revision
        });
      }
      if (nextSnapshot.worldId !== worldId || !Array.isArray(nextSnapshot.facts)) {
        throw problem('INVALID_WORLD_SNAPSHOT', 'The next world snapshot is invalid');
      }
      const prepared = prepareWorldFactsRevision(nextSnapshot.facts);
      if (prepared.revision !== nextSnapshot.revision) {
        throw problem('INVALID_WORLD_REVISION', 'The next snapshot revision does not match its facts');
      }
      const fullCommandId = `full-${crypto.randomUUID()}`;
      await appendRecord({
        contract: 'atom.local-commit', version: 1, mode: 'full', worldId,
        commandId: fullCommandId,
        beforeRevision: current.revision,
        afterRevision: nextSnapshot.revision,
        facts: nextSnapshot.facts
      });
      await writeJsonAtomically(file, nextSnapshot.facts, {
        fileSystem,
        serialized: `${prepared.json}\n`
      });
      await writeJsonAtomically(localCommitFile, null, {
        fileSystem,
        serialized: `${JSON.stringify({
          contract: 'atom.local-commit-watermark',
          version: 1,
          worldId,
          revision: nextSnapshot.revision,
          throughCommandId: fullCommandId
        })}\n`,
        syncTemporary: true
      });
      localRecordCount = 0;
      cached = snapshot(worldId, nextSnapshot.facts, {
        ownsFacts: Object.isFrozen(nextSnapshot.facts)
      });
      cachedSignature = await signature();
      return nextSnapshot;
    });
  }

  return Object.freeze({
    file, worldId, localCommitFile, read, compareAndSwap,
    appendLocalCommit, compactCommittedState, scheduleCompaction
  });
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
    if (record?.historyMode === 'local-patch') return structuredClone(record);
    const [before, after] = await Promise.all([
      persistSnapshot(record.before),
      persistSnapshot(record.after)
    ]);
    return { ...structuredClone(record), before, after };
  }

  async function hydrateRecord(record) {
    if (!record) return null;
    if (record.historyMode === 'local-patch') return structuredClone(record);
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
    const records = new Map(legacy.receipts.map((entry) => [entry.commandId, structuredClone(entry)]));
    const outcomes = new Map();
    for (const event of await loadEvents()) {
      if (event.type === 'prepared') {
        if (receipts.has(event.commandId)) continue;
        prepared.set(event.commandId, event.record);
        continue;
      }
      prepared.delete(event.commandId);
      if (!receipts.has(event.commandId)) order.push(event.commandId);
      receipts.set(event.commandId, { ...event.record, receipt: event.receipt });
      records.set(event.commandId, event.record);
      if (event.programOutcome) outcomes.set(event.commandId, event.programOutcome);
    }
    const state = { prepared, receipts, records, order, outcomes, sources: new Map(), children: new Map() };
    for (const entry of receipts.values()) indexProgramReceipt(state, entry.receipt);
    return state;
  }

  function indexProgramReceipt(state, receipt) {
    if (receipt?.result?.postCommitEvent) state.sources.set(receipt.correlationId, receipt.commandId);
    if (receipt?.result?.postCommitEvent?.effectsCommitted) state.children.set(receipt.commandId, receipt.commandId);
    if (receipt?.result?.subsequentOf) state.children.set(receipt.result.subsequentOf, receipt.commandId);
  }

  async function programExecution(sourceCommandId) {
    const state = await load();
    const sourceReceipt = state.receipts.get(sourceCommandId)?.receipt;
    if (!sourceReceipt?.result?.postCommitEvent) return null;
    const childReceipt = state.receipts.get(state.children.get(sourceCommandId))?.receipt ?? null;
    let outcome = state.outcomes.get(sourceCommandId) ?? null;
    if (childReceipt && outcome?.status !== 'completed') {
      outcome = { status: 'completed', sourceRevision: (sourceReceipt.result.postCommitEvent.sourceRevision
        ?? sourceReceipt.afterRevision).replace(/^sha256:/u, ''),
        revisionAfter: childReceipt.afterRevision.replace(/^sha256:/u, ''), errors: [],
        attemptId: outcome?.attemptId ?? childReceipt.correlationId, childCommandId: childReceipt.commandId };
    }
    return structuredClone({ sourceReceipt, event: sourceReceipt.result.postCommitEvent, outcome, childReceipt });
  }

  async function programExecutionForInteraction(correlationId) {
    return programExecution((await load()).sources.get(correlationId));
  }

  async function pendingProgramExecutions() {
    const state = await load();
    const executions = await Promise.all([...state.sources.values()].map(programExecution));
    return executions.filter(({ outcome }) => !outcome || outcome.status === 'pending');
  }

  function recordProgramExecution({ sourceCommandId, outcome }) {
    return serialize(async () => {
      const state = await load();
      const source = state.receipts.get(sourceCommandId);
      if (!source?.receipt?.result?.postCommitEvent) {
        throw problem('PROGRAM_SOURCE_NOT_FOUND', 'Post-commit execution requires a committed source');
      }
      if (!['pending', 'completed', 'failed'].includes(outcome?.status) || !outcome?.attemptId) {
        throw problem('INVALID_PROGRAM_OUTCOME', 'Post-commit outcome requires a status and attempt id');
      }
      const existing = state.outcomes.get(sourceCommandId);
      if (existing && existing.status !== 'pending') return structuredClone(existing);
      const childId = state.children.get(sourceCommandId);
      if (childId && outcome.status !== 'completed') return (await programExecution(sourceCommandId)).outcome;
      const stored = structuredClone({ ...outcome, ...(childId ? { childCommandId: childId } : {}) });
      await appendEvent({ type: 'committed', commandId: sourceCommandId,
        record: state.records.get(sourceCommandId), receipt: source.receipt, programOutcome: stored });
      state.outcomes.set(sourceCommandId, stored);
      return structuredClone(stored);
    });
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
      state.records.set(commandId, prepared);
      indexProgramReceipt(state, receipt);
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
    findReceipt, findPrepared, findCommitted, prepare, commit, listPrepared, readState,
    programExecution, programExecutionForInteraction, pendingProgramExecutions, recordProgramExecution
  });
}
