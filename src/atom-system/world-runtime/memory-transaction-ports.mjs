import { createMemoryWorldAuthority } from './memory-world-authority.mjs';
import { sealWorldFactsRevision } from './world-revision.mjs';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// The coordinator keeps its existing validation, conflict, patch, and rollback
// rules. These ports move only publication from disk to the running authority.
export function createMemoryTransactionPorts({
  initialSnapshot,
  compatibilityManifest = null,
  durableReceipts = [],
  durableOutcomes = [],
  durableFindCommitted = async () => null,
  onAccepted = () => {},
  onOutcome = () => {}
}) {
  const authority = createMemoryWorldAuthority({ initialSnapshot: {
    facts: initialSnapshot.facts,
    revision: initialSnapshot.revision,
    compatibilityManifest
  } });
  const durableHistory = [...durableReceipts];
  const durableById = new Map(durableHistory.map((entry) => [entry.commandId, entry]));
  const accepted = new Map();
  const acceptedVersions = new Map();
  const prepared = new Map();
  const outcomes = new Map(durableOutcomes);
  const claimedCandidates = new WeakSet();
  let staged = null;
  let closing = false;

  function assertAccepting() {
    if (closing) throw problem('WORLD_SAVE_WORKER_CLOSED', 'Memory world is closed to new writes');
  }

  function beginClose() {
    closing = true;
    prepared.clear();
    staged = null;
  }

  function claimCandidate(facts) {
    assertAccepting();
    sealWorldFactsRevision(facts);
    claimedCandidates.add(facts);
    return facts;
  }

  const worldRepository = Object.freeze({
    async read() {
      const current = authority.snapshot();
      return { contract: 'atom.world-snapshot', version: 1,
        worldId: initialSnapshot.worldId, revision: current.revision, facts: current.facts };
    },
    async compareAndSwap({ commandId, expectedRevision, nextSnapshot }) {
      assertAccepting();
      if (staged?.commandId === commandId
        && staged.expectedRevision === expectedRevision
        && staged.nextSnapshot.revision === nextSnapshot.revision) return staged.nextSnapshot;
      if (authority.snapshot().revision !== expectedRevision || staged) {
        throw problem('WORLD_REVISION_CONFLICT', 'Memory world changed before staging');
      }
      staged = { commandId, expectedRevision, nextSnapshot };
      return nextSnapshot;
    },
    async appendLocalCommit({ commandId, expectedRevision, nextSnapshot }) {
      return this.compareAndSwap({ commandId, expectedRevision, nextSnapshot });
    },
    async durableCommitEvidence(identity) {
      const receipt = receiptFor(identity.commandId);
      if (receipt?.beforeRevision === identity.beforeRevision
        && receipt.afterRevision === identity.afterRevision) return identity;
      return staged?.commandId === identity.commandId
        && staged.expectedRevision === identity.beforeRevision
        && staged.nextSnapshot.revision === identity.afterRevision ? identity : null;
    },
    async hasDurableCommit(identity) {
      return Boolean(await this.durableCommitEvidence(identity));
    }
  });

  const entries = () => [...durableHistory, ...accepted.values()];
  const receiptFor = (id) => accepted.get(id)?.receipt ?? durableById.get(id)?.receipt ?? null;
  const executionFor = (sourceCommandId) => {
    const sourceReceipt = receiptFor(sourceCommandId);
    const event = sourceReceipt?.result?.postCommitEvent;
    if (!event) return null;
    const childReceipt = entries().map((entry) => entry.receipt).find((receipt) =>
      receipt?.result?.subsequentOf === sourceCommandId
      || (receipt?.commandId === sourceCommandId && event.effectsCommitted)) ?? null;
    let outcome = outcomes.get(sourceCommandId) ?? null;
    if (childReceipt && outcome?.status !== 'completed') {
      outcome = { status: 'completed', sourceRevision: (event.sourceRevision
        ?? sourceReceipt.afterRevision).replace(/^sha256:/u, ''),
      revisionAfter: childReceipt.afterRevision.replace(/^sha256:/u, ''), errors: [],
      attemptId: outcome?.attemptId ?? childReceipt.correlationId,
      childCommandId: childReceipt.commandId };
    }
    return structuredClone({ sourceReceipt, event, outcome, childReceipt });
  };

  const journalRepository = Object.freeze({
    async latestReceipt() {
      return structuredClone((accepted.size
        ? [...accepted.values()].at(-1)
        : durableHistory.at(-1))?.receipt ?? null);
    },
    async transformLogRecords() {
      return structuredClone(entries().flatMap((entry) => {
        const record = entry.receipt?.result?.transformLogRecord;
        return record ? [record] : [];
      }));
    },
    async findReceipt(id) { return structuredClone(receiptFor(id)); },
    async findPrepared(id) { return structuredClone(prepared.get(id) ?? null); },
    async findCommitted(id) {
      // Saved entries live only in durableHistory/durableById. They cannot
      // shadow complete historical evidence supplied by the durable lane.
      return structuredClone(accepted.get(id) ?? await durableFindCommitted(id));
    },
    async listPrepared() { return structuredClone([...prepared.values()]); },
    async readState() { return { prepared: structuredClone([...prepared.values()]),
      receipts: structuredClone(entries()) }; },
    async prepare(record) {
      assertAccepting();
      if (prepared.has(record.commandId) || receiptFor(record.commandId)) {
        throw problem('DUPLICATE_COMMAND_ID', `Command ${record.commandId} already exists`);
      }
      prepared.set(record.commandId, record);
    },
    async commit(commandId, receipt) {
      const existing = receiptFor(commandId);
      if (existing) return structuredClone(existing);
      assertAccepting();
      const record = prepared.get(commandId);
      if (!record || !staged) {
        throw problem('MISSING_PREPARED_TRANSACTION', `Command ${commandId} was not staged`);
      }
      const stagedFacts = staged.nextSnapshot.facts;
      const facts = claimedCandidates.has(stagedFacts)
        ? stagedFacts : structuredClone(stagedFacts);
      const revision = sealWorldFactsRevision(facts);
      if (revision !== receipt.afterRevision) {
        throw problem('INVALID_WORLD_REVISION', 'Staged memory facts differ from receipt');
      }
      const expected = authority.snapshot();
      const acceptedState = authority.accept({
        expectedVersion: expected.version,
        expectedRevision: receipt.beforeRevision,
        nextSnapshot: { facts, revision,
          compatibilityManifest: receipt.result?.compatibilityManifest ?? null },
        receipt
      });
      const entry = deepFreeze({ ...structuredClone(record), receipt: structuredClone(receipt) });
      accepted.set(commandId, entry);
      acceptedVersions.set(acceptedState.acceptedVersion, commandId);
      prepared.delete(commandId);
      staged = null;
      onAccepted({ version: acceptedState.acceptedVersion, revision,
        snapshot: authority.snapshot(), record: entry });
      return structuredClone(receipt);
    },
    async abort(id) { staged = null; return prepared.delete(id); },
    async programExecution(id) { return executionFor(id); },
    async programExecutionForInteraction(correlationId) {
      const source = entries().find((entry) => entry.receipt?.correlationId === correlationId
        && entry.receipt?.result?.postCommitEvent);
      return source ? executionFor(source.commandId) : null;
    },
    async pendingProgramExecutions() {
      return entries().filter((entry) => entry.receipt?.result?.postCommitEvent)
        .map((entry) => executionFor(entry.commandId))
        .filter((execution) => !execution.outcome || execution.outcome.status === 'pending');
    },
    async recordProgramExecution({ sourceCommandId, outcome }) {
      const execution = executionFor(sourceCommandId);
      if (!execution) throw problem('PROGRAM_SOURCE_NOT_FOUND', 'Post-commit source is unavailable');
      if (!['pending', 'completed', 'failed'].includes(outcome?.status) || !outcome?.attemptId) {
        throw problem('INVALID_PROGRAM_OUTCOME', 'Post-commit outcome requires status and attempt id');
      }
      const existing = outcomes.get(sourceCommandId);
      if (existing && existing.status !== 'pending') return structuredClone(existing);
      if (execution.childReceipt && outcome.status !== 'completed') return execution.outcome;
      assertAccepting();
      const stored = structuredClone({ ...outcome, ...(execution.childReceipt
        ? { childCommandId: execution.childReceipt.commandId } : {}) });
      outcomes.set(sourceCommandId, stored);
      onOutcome({ sourceCommandId, outcome: stored });
      return structuredClone(stored);
    }
  });

  function markSaved(watermark) {
    // Validate before releasing any evidence. Versions, not repeated content
    // hashes, identify the exact acknowledged prefix (including A -> B -> A).
    const status = authority.markSaved(watermark);
    for (const [version, commandId] of acceptedVersions) {
      if (version > status.savedVersion) break;
      const record = accepted.get(commandId);
      const metadata = Object.freeze({ commandId, historyMode: record.historyMode, receipt: record.receipt });
      durableHistory.push(metadata);
      durableById.set(commandId, metadata);
      accepted.delete(commandId);
      acceptedVersions.delete(version);
    }
    return status;
  }

  return Object.freeze({ authority, worldRepository, journalRepository, markSaved, claimCandidate, beginClose });
}
