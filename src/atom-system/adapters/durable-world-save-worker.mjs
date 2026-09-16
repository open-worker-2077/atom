import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parentPort, workerData } from 'node:worker_threads';

import { writeAtomGraphProjection } from '../../../work-engine/atom-language/context-store.mjs';
import { createCommitCoordinator } from '../world-runtime/commit-coordinator.mjs';
import { applyLocalWorldPatch } from '../world-runtime/local-world-patch.mjs';
import { revisionOfWorldFacts } from '../world-runtime/world-revision.mjs';
import { createJsonTransactionJournal, createJsonWorldRepository } from './json-world-repository.mjs';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

const { contextFile, journalFile, worldId } = workerData;
const worldRepository = createJsonWorldRepository({ file: contextFile, worldId,
  initialFacts: [], localCommitFile: path.join(`${journalFile}.d`, 'world-commits.jsonl'),
  autoCompact: true });
const journalRepository = createJsonTransactionJournal({ file: journalFile });
const coordinator = createCommitCoordinator({ worldRepository, journalRepository });
let latestCompatibilityManifest = null;
let manifestLoaded = false;

async function persistRecord(record) {
  const existing = await journalRepository.findReceipt(record.commandId);
  if (existing) {
    if (!isDeepStrictEqual(existing, record.receipt)) {
      throw problem('WORLD_SAVE_RECEIPT_CONFLICT', 'Durable receipt differs from accepted memory receipt');
    }
    return;
  }
  const current = await worldRepository.read();
  if (current.revision !== record.receipt.beforeRevision) {
    throw problem('WORLD_SAVE_ORDER_CONFLICT', 'Durable world is not at the accepted transition base');
  }
  let next;
  if (record.historyMode === 'local-patch') {
    const facts = applyLocalWorldPatch(current.facts, record.patch);
    next = { contract: 'atom.world-snapshot', version: 1, worldId,
      revision: revisionOfWorldFacts(facts), facts };
  } else {
    next = record.after;
  }
  if (next.revision !== record.receipt.afterRevision) {
    throw problem('WORLD_SAVE_REVISION_MISMATCH', 'Accepted transition does not reproduce its receipt');
  }
  await journalRepository.prepare(record);
  if (record.historyMode === 'local-patch') {
    await worldRepository.appendLocalCommit({ commandId: record.commandId,
      expectedRevision: current.revision, nextSnapshot: next, patch: record.patch });
  } else {
    await worldRepository.compareAndSwap({ commandId: record.commandId,
      expectedRevision: current.revision, nextSnapshot: next, currentSnapshot: current });
  }
  await journalRepository.commit(record.commandId, record.receipt);
  worldRepository.scheduleCompaction?.();
}

let tail = Promise.resolve();
parentPort.on('message', ({ id, records, events, revision, projectionFiles = [] }) => {
  const work = async () => {
    try {
      await coordinator.recover();
      if (!manifestLoaded) {
        const state = await journalRepository.readState();
        latestCompatibilityManifest = state.receipts.at(-1)?.receipt?.result?.compatibilityManifest ?? null;
        manifestLoaded = true;
      }
      for (const event of events ?? records.map((record) => ({ kind: 'record', record }))) {
        if (event.kind === 'record') {
          await persistRecord(event.record);
          latestCompatibilityManifest = event.record.receipt?.result?.compatibilityManifest ?? null;
        }
        else if (event.kind === 'outcome') {
          const stored = (await journalRepository.programExecution(event.sourceCommandId))?.outcome;
          if (stored && stored.status !== 'pending'
            && !isDeepStrictEqual(stored, event.outcome)) {
            throw problem('WORLD_SAVE_OUTCOME_CONFLICT', 'Durable Program outcome differs from accepted memory');
          }
          if (!isDeepStrictEqual(stored, event.outcome)) {
            await journalRepository.recordProgramExecution({ sourceCommandId: event.sourceCommandId,
              outcome: event.outcome });
          }
        } else throw problem('INVALID_WORLD_SAVE_EVENT', 'Unknown save event');
      }
      const current = await worldRepository.read();
      if (current.revision !== revision) {
        throw problem('WORLD_SAVE_REVISION_MISMATCH', 'Saved world differs from requested watermark');
      }
      if (projectionFiles.length) {
        for (const projectionFile of projectionFiles) {
          await writeAtomGraphProjection(projectionFile, current.facts, {
            rootName: path.basename(contextFile),
            allowLegacyStrut: Boolean(latestCompatibilityManifest)
          });
        }
      }
      parentPort.postMessage({ id, ok: true, revision: current.revision });
    } catch (error) {
      parentPort.postMessage({ id, ok: false, error: { code: error.code ?? error.name,
        message: error.message } });
    }
  };
  tail = tail.then(work, work);
});
parentPort.postMessage({ ready: true });
