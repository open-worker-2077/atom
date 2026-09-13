import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
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
const UNSUPPORTED_DIRECTORY_SYNC_ERRORS = new Set([
  'EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOSYS', 'ENOTSUP', 'EPERM'
]);
const localCommitPublications = new Map();
const repositoryRuntimeId = crypto.randomUUID();

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
    let directorySynced = null;
    if (options.syncDirectory) {
      let directoryHandle;
      try {
        directoryHandle = await fileSystem.open(path.dirname(file), 'r');
        await directoryHandle.sync();
        directorySynced = true;
      } catch (error) {
        if (!UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(error.code)) throw error;
        directorySynced = false;
      } finally {
        await directoryHandle?.close();
      }
    }
    return { directorySynced };
  } finally {
    await fileSystem.rm(temporary, { force: true }).catch(() => {});
  }
}

function publicationFor(file) {
  const resolved = path.resolve(file);
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  let publication = localCommitPublications.get(key);
  if (!publication) {
    publication = {
      version: 0,
      pending: false,
      repairRequired: false,
      visibleBytes: 0,
      initialized: false,
      tail: Promise.resolve(),
      startupProofPending: true,
      startupProof: null,
      provenBaselineRevision: null,
      directorySyncUnavailable: false,
      baselineFrozen: false,
      indeterminate: null
    };
    localCommitPublications.set(key, publication);
  }
  return publication;
}

function completePrefixBytes(raw) {
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw ?? '', 'utf8');
  const newline = buffer.lastIndexOf(0x0a);
  return newline < 0 ? 0 : newline + 1;
}

async function completeFilePrefixBytes(handle, size, blockSize = 64 * 1024) {
  let end = size;
  while (end > 0) {
    const start = Math.max(0, end - blockSize);
    const length = end - start;
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const result = await handle.read(buffer, offset, length - offset, start + offset);
      const bytesRead = typeof result === 'number' ? result : result?.bytesRead;
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > length - offset) {
        throw problem('INCOMPLETE_FILE_READ', 'File tail read made no forward progress', {
          expectedBytes: length,
          readBytes: offset
        });
      }
      offset += bytesRead;
    }
    const newline = buffer.lastIndexOf(0x0a);
    if (newline >= 0) return start + newline + 1;
    end = start;
  }
  return 0;
}

async function writeFully(handle, value, position = 0) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  let offset = 0;
  while (offset < buffer.length) {
    const remaining = buffer.length - offset;
    const result = await handle.write(buffer, offset, remaining, position + offset);
    const bytesWritten = typeof result === 'number' ? result : result?.bytesWritten;
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > remaining) {
      throw problem('INCOMPLETE_FILE_WRITE', 'File write made no forward progress', {
        expectedBytes: buffer.length,
        writtenBytes: offset
      });
    }
    offset += bytesWritten;
  }
  return buffer.length;
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
  const publication = publicationFor(localCommitFile);
  const localCommitHeadFile = `${localCommitFile}.head.json`;
  const fallbackGenerationFile = `${localCommitFile}.fallback.json`;
  const compactionThreshold = autoCompact === true
    ? 128
    : Number.isSafeInteger(autoCompact) && autoCompact > 0 ? autoCompact : 0;

  function indeterminateProblem(cause) {
    const details = { ...(publication.indeterminate?.identity ?? {}) };
    if (cause) details.cause = cause.code ?? cause.name ?? 'UNKNOWN';
    return problem('LOCAL_WORLD_COMMIT_RECOVERY_PENDING',
      'A local world commit has an indeterminate durability result and requires owner recovery',
      details);
  }

  function assertPublicationAvailable() {
    if (publication.indeterminate) throw indeterminateProblem();
  }

  function recordStartupProof(proof) {
    publication.provenBaselineRevision = proof.provenRevision;
    publication.directorySyncUnavailable = proof.directorySyncUnavailable;
    publication.baselineFrozen = proof.directorySyncUnavailable === true;
    return proof;
  }

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
    return `${await fileSignature(file)}|${await fileSignature(localCommitFile, true)}|${await fileSignature(localCommitHeadFile, true)}|${publication.version}`;
  }

  async function publicationHead(buffer) {
    let parsed;
    try {
      parsed = JSON.parse(await fileSystem.readFile(localCommitHeadFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw problem('INVALID_LOCAL_WORLD_COMMIT_HEAD', 'Local commit publication head is invalid', {
        cause: error.code ?? error.message
      });
    }
    if (parsed?.contract !== 'atom.local-commit-head' || parsed.version !== 1
      || parsed.worldId !== worldId || !Number.isSafeInteger(parsed.bytes) || parsed.bytes < 0) {
      throw problem('INVALID_LOCAL_WORLD_COMMIT_HEAD', 'Local commit publication head has an invalid shape');
    }
    const completeBytes = completePrefixBytes(buffer);
    return { ...parsed, bytes: Math.min(parsed.bytes, completeBytes) };
  }

  async function persistPublicationHead(bytes, throughCommandId = null) {
    return writeJsonAtomically(localCommitHeadFile, null, {
      fileSystem,
      serialized: `${JSON.stringify({
        contract: 'atom.local-commit-head', version: 1, worldId, bytes, throughCommandId
      })}\n`,
      syncTemporary: true,
      syncDirectory: true
    });
  }

  function framedRecord(record) {
    const serializedRecord = JSON.stringify(record);
    const proof = {
      contract: 'atom.local-commit-publication', version: 1, worldId,
      publicationId: record.publicationId,
      recordDigest: `sha256:${crypto.createHash('sha256').update(serializedRecord).digest('hex')}`
    };
    return `${serializedRecord}\n${JSON.stringify(proof)}\n`;
  }

  function abortedPublication(record) {
    const serializedRecord = JSON.stringify(record);
    return `${JSON.stringify({
      contract: 'atom.local-commit-publication-abort', version: 1, worldId,
      publicationId: record.publicationId,
      recordDigest: `sha256:${crypto.createHash('sha256').update(serializedRecord).digest('hex')}`
    })}\n`;
  }

  function scanLocalLog(raw) {
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw ?? '', 'utf8');
    const completeBytes = completePrefixBytes(buffer);
    const records = [];
    const frames = [];
    let cursor = 0;
    let publishedBytes = 0;
    while (cursor < completeBytes) {
      const newline = buffer.indexOf(0x0a, cursor);
      if (newline < 0 || newline >= completeBytes) break;
      const line = buffer.subarray(cursor, newline).toString('utf8');
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        throw problem('INVALID_LOCAL_WORLD_COMMIT', 'Local world commit record is invalid', {
          line: records.length + 1, cause: error.message
        });
      }
      if (record?.contract === 'atom.local-commit-publication') break;
      if (typeof record?.publicationId === 'string' && record.publicationId) {
        const proofStart = newline + 1;
        const proofNewline = buffer.indexOf(0x0a, proofStart);
        if (proofNewline < 0 || proofNewline >= completeBytes) break;
        let proof;
        try {
          proof = JSON.parse(buffer.subarray(proofStart, proofNewline).toString('utf8'));
        } catch {
          break;
        }
        const digest = `sha256:${crypto.createHash('sha256').update(line).digest('hex')}`;
        if (proof?.contract !== 'atom.local-commit-publication' || proof.version !== 1
          || proof.worldId !== worldId || proof.publicationId !== record.publicationId
          || proof.recordDigest !== digest) break;
        const afterProof = proofNewline + 1;
        const abortNewline = buffer.indexOf(0x0a, afterProof);
        if (abortNewline >= 0 && abortNewline < completeBytes) {
          let abort;
          try {
            abort = JSON.parse(buffer.subarray(afterProof, abortNewline).toString('utf8'));
          } catch {
            abort = null;
          }
          if (abort?.contract === 'atom.local-commit-publication-abort' && abort.version === 1
            && abort.worldId === worldId && abort.publicationId === record.publicationId
            && abort.recordDigest === digest) {
            publishedBytes = abortNewline + 1;
            cursor = abortNewline + 1;
            continue;
          }
        }
        records.push(record);
        frames.push({ record, start: cursor, end: proofNewline + 1 });
        publishedBytes = proofNewline + 1;
        cursor = proofNewline + 1;
        continue;
      }
      records.push(record);
      frames.push({ record, start: cursor, end: newline + 1 });
      publishedBytes = newline + 1;
      cursor = newline + 1;
    }
    return { records, frames, publishedBytes };
  }

  async function localRecords() {
    assertPublicationAvailable();
    let raw;
    try {
      raw = await fileSystem.readFile(localCommitFile);
    } catch (error) {
      if (error.code === 'ENOENT') {
        publication.visibleBytes = 0;
        publication.initialized = true;
        return [];
      }
      throw error;
    }
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
    await publicationHead(buffer);
    const scanned = scanLocalLog(buffer);
    const visibleBytes = publication.pending || publication.repairRequired
      ? Math.min(publication.visibleBytes, scanned.publishedBytes)
      : scanned.publishedBytes;
    publication.visibleBytes = visibleBytes;
    publication.initialized = true;
    return scanLocalLog(buffer.subarray(0, visibleBytes)).records.map((record, index) => {
      try {
        const localCommit = record?.contract === 'atom.local-commit'
          && record.version === 1
          && record.worldId === worldId
          && ['patch', 'full'].includes(record.mode)
          && typeof record.commandId === 'string' && record.commandId.length > 0
          && /^sha256:[a-f0-9]{64}$/u.test(record.beforeRevision ?? '')
          && /^sha256:[a-f0-9]{64}$/u.test(record.afterRevision ?? '');
        const watermark = record?.contract === 'atom.local-commit-watermark'
          && record.version === 1
          && record.worldId === worldId
          && /^sha256:[a-f0-9]{64}$/u.test(record.revision ?? '')
          && (record.throughCommandId === null || typeof record.throughCommandId === 'string')
          && (record.throughBeforeRevision === undefined
            || /^sha256:[a-f0-9]{64}$/u.test(record.throughBeforeRevision));
        const generation = record?.contract === 'atom.local-commit-generation'
          && record.version === 1 && record.worldId === worldId && record.mode === 'full'
          && typeof record.generationId === 'string' && record.generationId.length > 0
          && /^sha256:[a-f0-9]{64}$/u.test(record.beforeRevision ?? '')
          && /^sha256:[a-f0-9]{64}$/u.test(record.afterRevision ?? '')
          && Array.isArray(record.facts) && Array.isArray(record.members)
          && record.members.every((member) => typeof member?.commandId === 'string'
            && /^sha256:[a-f0-9]{64}$/u.test(member.beforeRevision ?? '')
            && /^sha256:[a-f0-9]{64}$/u.test(member.afterRevision ?? ''));
        if (!localCommit && !watermark && !generation) {
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
    assertPublicationAvailable();
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
        if (['atom.local-commit', 'atom.local-commit-generation'].includes(records[index].contract)
          && records[index].afterRevision === materialized.revision) {
          start = index + 1;
          break;
        }
      }
    }
    if (start === 0) {
      const continuation = records.findIndex((record) => ['atom.local-commit', 'atom.local-commit-generation'].includes(record.contract)
        && record.beforeRevision === materialized.revision);
      start = continuation >= 0 ? continuation : records.length;
    }
    const pendingRecords = records.slice(start)
      .filter((record) => ['atom.local-commit', 'atom.local-commit-generation'].includes(record.contract));
    localRecordCount = pendingRecords.filter((record) => record.contract === 'atom.local-commit').length;
    for (const record of pendingRecords) materialized = applyRecord(materialized, record);
    const finalSignature = await signature();
    if (finalSignature !== beforeSignature) return read();
    if (publication.startupProofPending && !publication.pending) {
      publication.startupProofPending = false;
      publication.startupProof ??= pruneFallbackGeneration().catch(() => null);
      await publication.startupProof;
      if (await signature() !== finalSignature) return read();
    }
    cached = materialized;
    cachedSignature = finalSignature;
    return cached;
  }

  function withPublicationLock(work) {
    const running = publication.tail.then(work, work);
    publication.tail = running.catch(() => {});
    return running;
  }

  async function fallbackGeneration() {
    try {
      const marker = JSON.parse(await fileSystem.readFile(fallbackGenerationFile, 'utf8'));
      if (marker?.contract !== 'atom.local-commit-fallback' || marker.version !== 1
        || marker.worldId !== worldId || !/^sha256:[a-f0-9]{64}$/u.test(marker.revision ?? '')
        || typeof marker.throughCommandId !== 'string'
        || !/^sha256:[a-f0-9]{64}$/u.test(marker.throughBeforeRevision ?? '')
        || !/^sha256:[a-f0-9]{64}$/u.test(marker.baselineRevision ?? marker.revision ?? '')
        || (marker.generationId !== undefined && typeof marker.generationId !== 'string')
        || typeof marker.writerRuntimeId !== 'string') return null;
      return marker;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      return null;
    }
  }

  async function persistFallbackGeneration(record, revision, generationId = null,
    baselineRevision = revision) {
    if (!record) return;
    await writeJsonAtomically(fallbackGenerationFile, null, {
      fileSystem,
      serialized: `${JSON.stringify({
        contract: 'atom.local-commit-fallback', version: 1, worldId, revision,
        throughCommandId: record.commandId,
        throughBeforeRevision: record.beforeRevision,
        baselineRevision,
        ...(generationId ? { generationId } : {}),
        writerRuntimeId: repositoryRuntimeId
      })}\n`,
      syncTemporary: true
    });
  }

  async function replaceLogWithWatermark(watermark) {
    const serialized = `${JSON.stringify(watermark)}\n`;
    await writeJsonAtomically(localCommitFile, null, {
      fileSystem,
      serialized,
      syncTemporary: true
    });
    const bytes = Buffer.byteLength(serialized, 'utf8');
    await persistPublicationHead(bytes, watermark.throughCommandId).catch(() => null);
    publication.visibleBytes = bytes;
    publication.pending = false;
    publication.repairRequired = false;
    publication.version += 1;
  }

  async function replaceLogWithRecoveryGeneration(current, committedRecords) {
    const generationId = crypto.randomUUID();
    const members = committedRecords.slice(-Math.max(1, compactionThreshold || 1)).map((record) => ({
      commandId: record.commandId,
      beforeRevision: record.beforeRevision,
      afterRevision: record.afterRevision
    }));
    const generation = {
      contract: 'atom.local-commit-generation', version: 1, mode: 'full', worldId,
      generationId, publicationId: crypto.randomUUID(),
      beforeRevision: publication.provenBaselineRevision, afterRevision: current.revision,
      facts: current.facts, members
    };
    const serialized = framedRecord(generation);
    await writeJsonAtomically(localCommitFile, null, {
      fileSystem, serialized, syncTemporary: true
    });
    const bytes = Buffer.byteLength(serialized, 'utf8');
    await persistPublicationHead(bytes, members.at(-1)?.commandId ?? null).catch(() => null);
    publication.visibleBytes = bytes;
    publication.pending = false;
    publication.repairRequired = false;
    publication.version += 1;
    return generation;
  }

  async function pruneFallbackGeneration() {
    const marker = await fallbackGeneration();
    if (!marker || marker.writerRuntimeId === repositoryRuntimeId) return null;
    return withPublicationLock(async () => {
      const baseline = snapshot(worldId, JSON.parse(await fileSystem.readFile(file, 'utf8')), { ownsFacts: true });
      const baselineRevision = marker.baselineRevision ?? marker.revision;
      if (baseline.revision !== baselineRevision) return null;
      const records = await localRecords();
      const ownerIndex = records.findIndex((record) => marker.generationId
        ? record.contract === 'atom.local-commit-generation'
          && record.generationId === marker.generationId
          && record.afterRevision === marker.revision
        : record.contract === 'atom.local-commit'
          && record.commandId === marker.throughCommandId
          && record.beforeRevision === marker.throughBeforeRevision
          && record.afterRevision === marker.revision);
      if (ownerIndex < 0 || records.slice(ownerIndex + 1)
        .some((record) => record.contract === 'atom.local-commit')) return null;
      if (marker.generationId && baselineRevision !== marker.revision) {
        return recordStartupProof({
          provenRevision: baselineRevision, pruned: false, directorySyncUnavailable: true
        });
      }
      try {
        await replaceLogWithWatermark({
          contract: 'atom.local-commit-watermark', version: 1, worldId,
          revision: marker.revision,
          throughCommandId: marker.throughCommandId,
          throughBeforeRevision: marker.throughBeforeRevision
        });
        localRecordCount = 0;
        return recordStartupProof({
          provenRevision: marker.revision, pruned: true, directorySyncUnavailable: true
        });
      } catch {
        return recordStartupProof({
          provenRevision: marker.revision, pruned: false, directorySyncUnavailable: true
        });
      }
    });
  }

  async function appendRecordUnsafe(record) {
    await fileSystem.mkdir(path.dirname(localCommitFile), { recursive: true });
    let fileBytes = 0;
    let publishedBytes = null;
    if (publication.initialized && !publication.pending && !publication.repairRequired
      && !publication.indeterminate) {
      try {
        fileBytes = Number((await fileSystem.stat(localCommitFile)).size);
        if (fileBytes === publication.visibleBytes) publishedBytes = publication.visibleBytes;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (publication.visibleBytes === 0) publishedBytes = 0;
      }
    }
    if (publishedBytes === null) {
      let raw;
      try {
        raw = await fileSystem.readFile(localCommitFile);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        raw = Buffer.alloc(0);
      }
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
      fileBytes = buffer.length;
      const head = await publicationHead(buffer);
      const scanned = scanLocalLog(buffer);
      publishedBytes = publication.repairRequired
        ? Math.min(publication.visibleBytes, scanned.publishedBytes)
        : scanned.publishedBytes;
      if (!head) await persistPublicationHead(publishedBytes);
      publication.visibleBytes = publishedBytes;
      publication.initialized = true;
    }
    const framed = { ...record, publicationId: record.publicationId ?? crypto.randomUUID() };
    const serializedRecord = `${JSON.stringify(framed)}\n`;
    const serializedProof = framedRecord(framed).slice(serializedRecord.length);
    publication.pending = true;
    publication.visibleBytes = publishedBytes;
    publication.version += 1;
    let handle;
    let recordBytes = 0;
    let proofBytes = 0;
    let proofWritten = false;
    try {
      handle = await fileSystem.open(localCommitFile, fileBytes ? 'r+' : 'w+');
      await handle.truncate(publishedBytes);
      recordBytes = await writeFully(handle, serializedRecord, publishedBytes);
      await handle.sync();
      proofBytes = await writeFully(handle, serializedProof, publishedBytes + recordBytes);
      proofWritten = true;
      await handle.sync();
      const nextBytes = publishedBytes + recordBytes + proofBytes;
      await persistPublicationHead(nextBytes, record.commandId).catch(() => null);
      publication.visibleBytes = nextBytes;
      publication.pending = false;
      publication.repairRequired = false;
      publication.version += 1;
      localRecordCount += 1;
    } catch (error) {
      publication.pending = false;
      publication.repairRequired = true;
      publication.visibleBytes = publishedBytes;
      publication.version += 1;
      let truncateCompleted = false;
      let repairDurable = false;
      let abortDurable = false;
      try {
        await handle?.truncate(publishedBytes);
        truncateCompleted = true;
        await handle?.sync();
        repairDurable = true;
        publication.repairRequired = false;
        publication.version += 1;
      } catch {
        // Resolution below distinguishes a durable repair/abort from an
        // indeterminate proof that only explicit owner recovery may settle.
      }
      if (proofWritten && !truncateCompleted) {
        try {
          const abort = abortedPublication(framed);
          const abortBytes = await writeFully(handle, abort, publishedBytes + recordBytes + proofBytes);
          await handle.sync();
          publication.visibleBytes = publishedBytes + recordBytes + proofBytes + abortBytes;
          publication.repairRequired = false;
          abortDurable = true;
          publication.version += 1;
        } catch {
          // The shared indeterminate state below fails closed until recovery.
        }
      }
      if (proofWritten && !repairDurable && !abortDurable) {
        publication.indeterminate = {
          identity: {
            commandId: framed.commandId,
            beforeRevision: framed.beforeRevision,
            afterRevision: framed.afterRevision,
            publicationId: framed.publicationId
          },
          originalPrefix: publishedBytes
        };
        publication.repairRequired = true;
        publication.visibleBytes = publishedBytes;
        publication.version += 1;
        throw indeterminateProblem(error);
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  function recoverIndeterminateCommit(identity) {
    return withPublicationLock(async () => {
      const pending = publication.indeterminate;
      if (pending && (pending.identity.commandId !== identity?.commandId
        || pending.identity.beforeRevision !== identity?.beforeRevision
        || pending.identity.afterRevision !== identity?.afterRevision)) {
        throw indeterminateProblem();
      }
      await fileSystem.mkdir(path.dirname(localCommitFile), { recursive: true });
      let raw;
      try {
        raw = await fileSystem.readFile(localCommitFile);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        raw = Buffer.alloc(0);
      }
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
      const scanned = scanLocalLog(buffer);
      const exactFrame = scanned.frames.find(({ record }) => record.contract === 'atom.local-commit'
        && record.worldId === worldId
        && record.commandId === identity?.commandId
        && record.beforeRevision === identity?.beforeRevision
        && record.afterRevision === identity?.afterRevision);
      const originalPrefix = pending?.originalPrefix ?? exactFrame?.start ?? scanned.publishedBytes;
      let handle;
      try {
        handle = await fileSystem.open(localCommitFile, buffer.length ? 'r+' : 'w+');
        if (!exactFrame) {
          const safeBytes = Math.min(originalPrefix, scanned.publishedBytes);
          if (buffer.length !== safeBytes) await handle.truncate(safeBytes);
        }
        await handle.sync();
        publication.indeterminate = null;
        publication.pending = false;
        publication.repairRequired = false;
        publication.visibleBytes = exactFrame ? scanned.publishedBytes : Math.min(originalPrefix, scanned.publishedBytes);
        publication.version += 1;
        return Object.freeze({
          status: exactFrame ? 'committed' : 'prepared',
          commandId: identity?.commandId,
          beforeRevision: identity?.beforeRevision,
          afterRevision: identity?.afterRevision
        });
      } catch (error) {
        publication.indeterminate ??= {
          identity: {
            commandId: identity?.commandId,
            beforeRevision: identity?.beforeRevision,
            afterRevision: identity?.afterRevision,
            publicationId: exactFrame?.record.publicationId ?? null
          },
          originalPrefix
        };
        publication.pending = false;
        publication.repairRequired = true;
        publication.visibleBytes = originalPrefix;
        publication.version += 1;
        throw error;
      } finally {
        await handle?.close();
      }
    });
  }

  async function repairLocalTail() {
    let raw;
    try {
      raw = await fileSystem.readFile(localCommitFile);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
    await publicationHead(buffer);
    const scanned = scanLocalLog(buffer);
    const completeBytes = publication.repairRequired
      ? Math.min(publication.visibleBytes, scanned.publishedBytes)
      : scanned.publishedBytes;
    if (buffer.length === completeBytes) return;
    const handle = await fileSystem.open(localCommitFile, 'r+');
    try {
      await handle.truncate(completeBytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    publication.visibleBytes = completeBytes;
    publication.pending = false;
    publication.repairRequired = false;
    publication.version += 1;
  }

  function appendLocalCommit({ commandId, expectedRevision, nextSnapshot, patch }) {
    publication.startupProofPending = false;
    return serialize(() => withPublicationLock(async () => {
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
      if (await fileSignature(file, true) === 'missing') {
        const preparedBaseline = prepareWorldFactsRevision(current.facts);
        const baselineWrite = await writeJsonAtomically(file, current.facts, {
          fileSystem,
          serialized: `${preparedBaseline.json}\n`,
          syncTemporary: true,
          syncDirectory: true,
          beforeRename: async (temporary) => {
            const verifiedFacts = JSON.parse(await fileSystem.readFile(temporary, 'utf8'));
            if (revisionOfWorldFacts(verifiedFacts) !== current.revision) {
              throw problem('INVALID_WORLD_REVISION', 'Initial baseline failed revision verification');
            }
          }
        });
        if (baselineWrite.directorySynced) {
          publication.provenBaselineRevision = current.revision;
          publication.directorySyncUnavailable = false;
          publication.baselineFrozen = false;
        } else {
          publication.directorySyncUnavailable = true;
        }
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
      await appendRecordUnsafe(record);
      await faultInjector('after-local-append-sync', structuredClone(record));
      await faultInjector('before-memory-publication', structuredClone(record));
      cached = prepared;
      cachedSignature = await signature();
      return prepared;
    }));
  }

  function compactCommittedState() {
    publication.startupProofPending = false;
    return serialize(() => withPublicationLock(async () => {
      const current = await read();
      const committedRecords = (await localRecords())
        .filter((record) => record.contract === 'atom.local-commit');
      await repairLocalTail();
      if (publication.baselineFrozen && publication.provenBaselineRevision) {
        const generation = await replaceLogWithRecoveryGeneration(current, committedRecords);
        const latestMember = generation.members.at(-1);
        await persistFallbackGeneration({
          commandId: latestMember?.commandId ?? `generation-${generation.generationId}`,
          beforeRevision: latestMember?.beforeRevision ?? generation.beforeRevision
        }, current.revision, generation.generationId, publication.provenBaselineRevision).catch(() => {});
        localRecordCount = 0;
        cached = current;
        cachedSignature = await signature();
        return current;
      }
      const prepared = prepareWorldFactsRevision(current.facts);
      const baselineWrite = await writeJsonAtomically(file, current.facts, {
        fileSystem,
        serialized: `${prepared.json}\n`,
        syncTemporary: true,
        syncDirectory: true,
        beforeRename: async (temporary) => {
          const verifiedFacts = JSON.parse(await fileSystem.readFile(temporary, 'utf8'));
          if (revisionOfWorldFacts(verifiedFacts) !== current.revision) {
            throw problem('INVALID_WORLD_REVISION', 'Compacted baseline failed revision verification');
          }
          await faultInjector('during-compaction-write', structuredClone(current));
        }
      });
      await faultInjector('after-compaction-replace', structuredClone(current));
      const latest = committedRecords.at(-1);
      if (baselineWrite.directorySynced) {
        publication.provenBaselineRevision = current.revision;
        publication.directorySyncUnavailable = false;
        publication.baselineFrozen = false;
        const watermark = {
          contract: 'atom.local-commit-watermark',
          version: 1,
          worldId,
          revision: current.revision,
          throughCommandId: latest?.commandId ?? null,
          ...(latest ? { throughBeforeRevision: latest.beforeRevision } : {})
        };
        await replaceLogWithWatermark(watermark);
      } else if (publication.provenBaselineRevision) {
        publication.directorySyncUnavailable = true;
        publication.baselineFrozen = true;
        const generation = await replaceLogWithRecoveryGeneration(current, committedRecords);
        const latestMember = generation.members.at(-1);
        await persistFallbackGeneration({
          commandId: latestMember?.commandId ?? `generation-${generation.generationId}`,
          beforeRevision: latestMember?.beforeRevision ?? generation.beforeRevision
        }, current.revision, generation.generationId, publication.provenBaselineRevision).catch(() => {});
      } else {
        publication.directorySyncUnavailable = true;
        await persistFallbackGeneration(latest, current.revision).catch(() => {});
      }
      localRecordCount = 0;
      cached = current;
      cachedSignature = await signature();
      return current;
    }));
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

  function compareAndSwap({ commandId = `full-${crypto.randomUUID()}`, expectedRevision,
    nextSnapshot, currentSnapshot: _currentSnapshot = null }) {
    publication.startupProofPending = false;
    return serialize(() => withPublicationLock(async () => {
      const current = await read();
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
      await appendRecordUnsafe({
        contract: 'atom.local-commit', version: 1, mode: 'full', worldId,
        commandId,
        beforeRevision: current.revision,
        afterRevision: nextSnapshot.revision,
        facts: nextSnapshot.facts
      });
      if (publication.baselineFrozen && publication.provenBaselineRevision) {
        const committedRecords = (await localRecords())
          .filter((record) => record.contract === 'atom.local-commit');
        const currentNext = snapshot(worldId, nextSnapshot.facts, {
          ownsFacts: Object.isFrozen(nextSnapshot.facts)
        });
        const generation = await replaceLogWithRecoveryGeneration(currentNext, committedRecords);
        await persistFallbackGeneration({ commandId, beforeRevision: current.revision },
          nextSnapshot.revision, generation.generationId, publication.provenBaselineRevision).catch(() => {});
        localRecordCount = 0;
        cached = currentNext;
        cachedSignature = await signature();
        return nextSnapshot;
      }
      const baselineWrite = await writeJsonAtomically(file, nextSnapshot.facts, {
        fileSystem,
        serialized: `${prepared.json}\n`,
        syncTemporary: true,
        syncDirectory: true,
        beforeRename: async (temporary) => {
          const verifiedFacts = JSON.parse(await fileSystem.readFile(temporary, 'utf8'));
          if (revisionOfWorldFacts(verifiedFacts) !== nextSnapshot.revision) {
            throw problem('INVALID_WORLD_REVISION', 'Full baseline failed revision verification');
          }
        }
      });
      if (baselineWrite.directorySynced) {
        publication.provenBaselineRevision = nextSnapshot.revision;
        publication.directorySyncUnavailable = false;
        publication.baselineFrozen = false;
        await replaceLogWithWatermark({
          contract: 'atom.local-commit-watermark',
          version: 1,
          worldId,
          revision: nextSnapshot.revision,
          throughCommandId: commandId,
          throughBeforeRevision: current.revision
        });
      } else if (publication.provenBaselineRevision) {
        publication.directorySyncUnavailable = true;
        publication.baselineFrozen = true;
        const generation = await replaceLogWithRecoveryGeneration(
          snapshot(worldId, nextSnapshot.facts, { ownsFacts: Object.isFrozen(nextSnapshot.facts) }),
          [{ commandId, beforeRevision: current.revision, afterRevision: nextSnapshot.revision }]
        );
        await persistFallbackGeneration({ commandId, beforeRevision: current.revision },
          nextSnapshot.revision, generation.generationId, publication.provenBaselineRevision).catch(() => {});
      } else {
        publication.directorySyncUnavailable = true;
        await persistFallbackGeneration({
          commandId,
          beforeRevision: current.revision
        }, nextSnapshot.revision).catch(() => {});
      }
      localRecordCount = 0;
      cached = snapshot(worldId, nextSnapshot.facts, {
        ownsFacts: Object.isFrozen(nextSnapshot.facts)
      });
      cachedSignature = await signature();
      return nextSnapshot;
    }));
  }

  async function durableCommitEvidence({ commandId, beforeRevision, afterRevision }) {
    const records = await localRecords();
    const record = records.find((candidate) => candidate.contract === 'atom.local-commit'
      && candidate.commandId === commandId
      && candidate.beforeRevision === beforeRevision
      && candidate.afterRevision === afterRevision);
    if (record) return Object.freeze({ source: 'record', commandId, beforeRevision, afterRevision });
    const generation = records.find((candidate) => candidate.contract === 'atom.local-commit-generation'
      && candidate.members.some((member) => member.commandId === commandId
        && member.beforeRevision === beforeRevision && member.afterRevision === afterRevision));
    if (generation) return Object.freeze({ source: 'generation', commandId, beforeRevision, afterRevision });
    const watermark = records.find((candidate) => candidate.contract === 'atom.local-commit-watermark'
      && candidate.throughCommandId === commandId
      && candidate.throughBeforeRevision === beforeRevision
      && candidate.revision === afterRevision);
    return watermark
      ? Object.freeze({ source: 'watermark', commandId, beforeRevision, afterRevision })
      : null;
  }

  async function durableSuccessor(beforeRevision) {
    const records = await localRecords();
    const record = records.find((candidate) => candidate.contract === 'atom.local-commit'
      && candidate.beforeRevision === beforeRevision);
    if (record) return Object.freeze({
      commandId: record.commandId,
      beforeRevision: record.beforeRevision,
      afterRevision: record.afterRevision,
      source: 'record'
    });
    const generation = records.find((candidate) => candidate.contract === 'atom.local-commit-generation'
      && candidate.members.some((member) => member.beforeRevision === beforeRevision));
    const member = generation?.members.find((candidate) => candidate.beforeRevision === beforeRevision);
    if (member) return Object.freeze({
      commandId: member.commandId,
      beforeRevision: member.beforeRevision,
      afterRevision: member.afterRevision,
      source: 'generation'
    });
    const watermark = records.find((candidate) => candidate.contract === 'atom.local-commit-watermark'
      && candidate.throughBeforeRevision === beforeRevision);
    return watermark ? Object.freeze({
      commandId: watermark.throughCommandId,
      beforeRevision: watermark.throughBeforeRevision,
      afterRevision: watermark.revision,
      source: 'watermark'
    }) : null;
  }

  async function hasDurableCommit(identity) {
    return Boolean(await durableCommitEvidence(identity));
  }

  return Object.freeze({
    file, worldId, localCommitFile, read, compareAndSwap,
    appendLocalCommit, compactCommittedState, scheduleCompaction,
    durableCommitEvidence, durableSuccessor, hasDurableCommit,
    recoverIndeterminateCommit
  });
}

const JOURNAL_HISTORY_MODE = 'latest-rollback-snapshot';
const EMPTY_JOURNAL = Object.freeze({
  schemaVersion: 1,
  historyMode: JOURNAL_HISTORY_MODE,
  prepared: [],
  receipts: []
});
const LOCAL_COMMIT_PROTOCOL = Object.freeze({
  contract: 'atom.local-world-commit-protocol',
  version: 1
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
  const eventPublication = publicationFor(eventFile);
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

  function appendEvent(event) {
    const work = async () => {
      await fs.mkdir(incrementalDirectory, { recursive: true });
      let handle;
      try {
        handle = await fs.open(eventFile, 'r+');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        handle = await fs.open(eventFile, 'w+');
      }
      try {
        const { size } = await handle.stat();
        const completeBytes = await completeFilePrefixBytes(handle, size);
        if (completeBytes !== size) await handle.truncate(completeBytes);
        await writeFully(handle, `${JSON.stringify({ schemaVersion: 2, ...event })}\n`, completeBytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    };
    const running = eventPublication.tail.then(work, work);
    eventPublication.tail = running.catch(() => {});
    return running;
  }

  function parseEventLine(line, lineNumber) {
    try {
      const event = JSON.parse(line);
      const ordinary = ['prepared', 'committed', 'aborted'].includes(event?.type);
      const protocol = event?.localCommitProtocol;
      const validProtocol = protocol === undefined || (event.type === 'prepared'
        && protocol?.contract === LOCAL_COMMIT_PROTOCOL.contract
        && protocol.version === LOCAL_COMMIT_PROTOCOL.version);
      if (event?.schemaVersion !== 2 || !ordinary || !validProtocol) throw new Error('invalid event');
      return event;
    } catch (error) {
      throw problem('INVALID_TRANSACTION_EVENT', 'Incremental transaction event is invalid', {
        line: lineNumber,
        cause: error.message
      });
    }
  }

  async function* loadEvents() {
    let remainder = '';
    let lineNumber = 0;
    try {
      for await (const chunk of createReadStream(eventFile, { encoding: 'utf8' })) {
        remainder += chunk;
        let newline = remainder.indexOf('\n');
        while (newline >= 0) {
          const line = remainder.slice(0, newline);
          remainder = remainder.slice(newline + 1);
          lineNumber += 1;
          if (line) yield parseEventLine(line, lineNumber);
          newline = remainder.indexOf('\n');
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') return;
      if (error.code === 'INVALID_TRANSACTION_EVENT') throw error;
      throw problem('TRANSACTION_JOURNAL_READ_FAILED', 'Cannot read incremental transaction events', {
        cause: error.code
      });
    }
    // A final record without a newline was interrupted before publication.
  }

  async function loadState() {
    const legacy = await loadLegacy();
    const prepared = new Map(legacy.prepared.map((entry) => [entry.commandId, structuredClone(entry)]));
    const legacyPrepared = new Map(legacy.prepared.map((entry) => [entry.commandId, 1]));
    const receipts = new Map(legacy.receipts.map((entry) => [entry.commandId, structuredClone(entry)]));
    const order = legacy.receipts.map((entry) => entry.commandId);
    const records = new Map(legacy.receipts.map((entry) => [entry.commandId, structuredClone(entry)]));
    const outcomes = new Map();
    for await (const event of loadEvents()) {
      if (event.type === 'prepared') {
        if (receipts.has(event.commandId)) continue;
        prepared.set(event.commandId, event.record);
        if (event.localCommitProtocol) legacyPrepared.delete(event.commandId);
        else legacyPrepared.set(event.commandId, 2);
        continue;
      }
      if (event.type === 'aborted') {
        prepared.delete(event.commandId);
        legacyPrepared.delete(event.commandId);
        continue;
      }
      prepared.delete(event.commandId);
      legacyPrepared.delete(event.commandId);
      if (!receipts.has(event.commandId)) order.push(event.commandId);
      receipts.set(event.commandId, { ...event.record, receipt: event.receipt });
      records.set(event.commandId, event.record);
      if (event.programOutcome) outcomes.set(event.commandId, event.programOutcome);
    }
    const state = {
      prepared, legacyPrepared, receipts, records, order, outcomes,
      sources: new Map(), children: new Map()
    };
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

  async function legacyPreparedEvidence(identity) {
    const state = await load();
    const sourceSchemaVersion = state.legacyPrepared.get(identity?.commandId);
    if (!sourceSchemaVersion) return null;
    const record = state.prepared.get(identity.commandId);
    const localPatch = record?.historyMode === 'local-patch';
    const recordWorldId = localPatch ? record?.patch?.worldId : record?.before?.worldId;
    const afterWorldId = localPatch ? record?.inversePatch?.worldId : record?.after?.worldId;
    const beforeRevision = localPatch ? record?.patch?.beforeRevision : record?.before?.revision;
    const afterRevision = localPatch ? record?.patch?.afterRevision : record?.after?.revision;
    const recordDigest = localPatch
      ? `sha256:${crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex')}`
      : undefined;
    if (!record
      || identity.historyMode !== (localPatch ? 'local-patch' : 'whole-world')
      || record.commandId !== identity.commandId
      || record.correlationId !== record.command?.correlationId
      || recordWorldId !== identity.worldId
      || afterWorldId !== identity.worldId
      || beforeRevision !== identity.beforeRevision
      || afterRevision !== identity.afterRevision
      || recordDigest !== identity.recordDigest) return null;
    return Object.freeze({
      contract: 'atom.legacy-prepared-evidence',
      version: 1,
      sourceSchemaVersion,
      cutoverIdentity: 'pre-local-commit-cutover',
      historyMode: identity.historyMode,
      recordDigest,
      commandId: identity.commandId,
      worldId: identity.worldId,
      beforeRevision: identity.beforeRevision,
      afterRevision: identity.afterRevision
    });
  }

  function prepare(record) {
    return serialize(async () => {
      const state = await load();
      if (state.prepared.has(record.commandId) || state.receipts.has(record.commandId)) {
        throw problem('DUPLICATE_COMMAND_ID', `Command ${record.commandId} already exists`);
      }
      const compact = await compactRecord(record);
      await appendEvent({
        type: 'prepared', commandId: record.commandId, record: compact,
        localCommitProtocol: LOCAL_COMMIT_PROTOCOL
      });
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

  function abort(commandId, reason) {
    return serialize(async () => {
      const state = await load();
      if (!state.prepared.has(commandId)) return false;
      await appendEvent({
        type: 'aborted', commandId, reason: structuredClone(reason ?? null)
      });
      state.prepared.delete(commandId);
      return true;
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
    findReceipt, findPrepared, findCommitted, legacyPreparedEvidence,
    prepare, commit, abort, listPrepared, readState,
    programExecution, programExecutionForInteraction, pendingProgramExecutions, recordProgramExecution
  });
}
