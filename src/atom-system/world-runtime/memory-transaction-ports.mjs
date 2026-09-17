import { createMemoryWorldAuthority } from './memory-world-authority.mjs';
import { sealWorldFactsRevision } from './world-revision.mjs';
import { createPendingWorldCapacity, isHardCapacityBlocked, pendingWorldEventBytes } from './pending-world-capacity.mjs';

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
  pendingLimits,
  onCapacityReleased = () => {},
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
  const capacity = createPendingWorldCapacity(pendingLimits);
  const preparedCapacity = new Map();
  const programCapacity = new Map();
  // Identity-only projections: saving can discard record bodies without any
  // index retaining them. Public readers still receive detached executions.
  const sourceByInteraction = new Map();
  const childBySource = new Map();
  const sourceOrder = new Map();
  const pendingSources = new Set();
  let staged = null;
  let closing = false;

  function assertAccepting() {
    if (closing) throw problem('WORLD_SAVE_WORKER_CLOSED', 'Memory world is closed to new writes');
  }

  function beginClose() {
    closing = true;
    for (const reservation of preparedCapacity.values()) {
      capacity.release([reservation.record, ...(reservation.program ?? [])]);
    }
    preparedCapacity.clear();
    for (const slots of programCapacity.values()) capacity.release([slots.first, slots.final]);
    programCapacity.clear();
    prepared.clear();
    staged = null;
  }

  function releaseCapacity(tokens) {
    if (capacity.release(tokens)) notifyCapacityReleased();
  }

  function notifyCapacityReleased() {
    if (closing) return;
    try { Promise.resolve(onCapacityReleased()).catch(() => {}); }
    catch { /* Scheduling cannot undo a completed capacity/state transition. */ }
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
  function refreshPending(sourceCommandId) {
    if (!sourceOrder.has(sourceCommandId)) return;
    const outcome = outcomes.get(sourceCommandId);
    const pending = (!outcome || outcome.status === 'pending')
      && (!childBySource.has(sourceCommandId) || isHardCapacityBlocked(outcome));
    if (pending) pendingSources.add(sourceCommandId);
    else pendingSources.delete(sourceCommandId);
  }

  function indexReceipt(receipt) {
    const id = receipt.commandId;
    const event = receipt.result?.postCommitEvent;
    if (event) {
      if (!sourceByInteraction.has(receipt.correlationId)) sourceByInteraction.set(receipt.correlationId, id);
      if (!sourceOrder.has(id)) sourceOrder.set(id, sourceOrder.size);
    }
    const parent = receipt.result?.subsequentOf;
    if (parent != null && !childBySource.has(parent)) childBySource.set(parent, id);
    // An effectsCommitted source competes in the same original receipt order
    // as an ordinary child, including a historical child preceding its source.
    if (event?.effectsCommitted && !childBySource.has(id)) childBySource.set(id, id);
    if (event) refreshPending(id);
    if (parent != null) refreshPending(parent);
  }
  for (const entry of durableHistory) indexReceipt(entry.receipt);

  const executionFor = (sourceCommandId) => {
    const sourceReceipt = receiptFor(sourceCommandId);
    const event = sourceReceipt?.result?.postCommitEvent;
    if (!event) return null;
    const childReceipt = receiptFor(childBySource.get(sourceCommandId));
    let outcome = outcomes.get(sourceCommandId) ?? null;
    if (childReceipt && outcome?.status !== 'completed' && !isHardCapacityBlocked(outcome)) {
      outcome = { status: 'completed', sourceRevision: (event.sourceRevision
        ?? sourceReceipt.afterRevision).replace(/^sha256:/u, ''),
      revisionAfter: childReceipt.afterRevision.replace(/^sha256:/u, ''), errors: [],
      attemptId: outcome?.attemptId ?? childReceipt.correlationId,
      childCommandId: childReceipt.commandId };
    }
    return { sourceReceipt, event, outcome, childReceipt };
  };

  function reserveProgramExecution(sourceCommandId) {
    assertAccepting();
    if (!receiptFor(sourceCommandId)?.result?.postCommitEvent) {
      throw problem('PROGRAM_SOURCE_NOT_FOUND', 'Post-commit source is unavailable');
    }
    if (!programCapacity.has(sourceCommandId)) {
      const [first, final] = capacity.reserve([capacity.limits.maxEventBytes, capacity.limits.maxEventBytes]);
      programCapacity.set(sourceCommandId, { first, final });
    }
    return programCapacity.get(sourceCommandId);
  }

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
      const bytes = pendingWorldEventBytes({ kind: 'record', record });
      const source = Boolean(record.receipt?.result?.postCommitEvent);
      const [token, ...program] = capacity.reserve([bytes, ...(source
        ? [capacity.limits.maxEventBytes, capacity.limits.maxEventBytes] : [])]);
      preparedCapacity.set(record.commandId, { record: token, program });
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
      const entry = deepFreeze({ ...structuredClone(record), receipt: structuredClone(receipt) });
      const reservation = preparedCapacity.get(commandId);
      const bytes = pendingWorldEventBytes({ kind: 'record', record: { ...record, receipt } });
      capacity.resize(reservation.record, bytes);
      const expected = authority.snapshot();
      const acceptedState = authority.accept({
        expectedVersion: expected.version,
        expectedRevision: receipt.beforeRevision,
        nextSnapshot: { facts, revision,
          compatibilityManifest: receipt.result?.compatibilityManifest ?? null },
        receipt
      });
      capacity.accept(reservation.record);
      accepted.set(commandId, entry);
      indexReceipt(entry.receipt);
      if (reservation.program.length) programCapacity.set(commandId, { first: reservation.program[0], final: reservation.program[1] });
      preparedCapacity.delete(commandId);
      acceptedVersions.set(acceptedState.acceptedVersion, commandId);
      prepared.delete(commandId);
      staged = null;
      onAccepted({ version: acceptedState.acceptedVersion, revision,
        snapshot: authority.snapshot(), record: entry, reservation: reservation.record });
      return structuredClone(receipt);
    },
    async abort(id) {
      if (staged?.commandId === id) staged = null;
      const reservation = preparedCapacity.get(id);
      if (reservation) releaseCapacity([reservation.record, ...reservation.program]);
      preparedCapacity.delete(id);
      return prepared.delete(id);
    },
    async programExecution(id) { return structuredClone(executionFor(id)); },
    async programExecutionForInteraction(correlationId) {
      return structuredClone(executionFor(sourceByInteraction.get(correlationId)));
    },
    async pendingProgramExecutions() {
      return [...pendingSources].sort((a, b) => sourceOrder.get(a) - sourceOrder.get(b))
        .map(id => structuredClone(executionFor(id)));
    },
    async recordProgramExecution({ sourceCommandId, outcome }) {
      const execution = executionFor(sourceCommandId);
      if (!execution) throw problem('PROGRAM_SOURCE_NOT_FOUND', 'Post-commit source is unavailable');
      if (!['pending', 'completed', 'failed'].includes(outcome?.status) || !outcome?.attemptId) {
        throw problem('INVALID_PROGRAM_OUTCOME', 'Post-commit outcome requires status and attempt id');
      }
      const existing = outcomes.get(sourceCommandId);
      if (existing && existing.status !== 'pending') return structuredClone(existing);
      if (isHardCapacityBlocked(existing) && outcome.status === 'pending') return structuredClone(existing);
      if (execution.childReceipt && outcome.status !== 'completed' && !isHardCapacityBlocked(outcome)) return structuredClone(execution.outcome);
      assertAccepting();
      let value = { ...outcome, ...(execution.childReceipt ? { childCommandId: execution.childReceipt.commandId } : {}) };
      let bytes = pendingWorldEventBytes({ kind: 'outcome', sourceCommandId, outcome: value });
      if (bytes > capacity.limits.maxEventBytes) {
        // Keep the reason, never the unbounded body. This explicit pending state
        // cannot be replaced by child-derived synthetic completion on restart.
        value = { status: 'pending', attemptId: 'capacity-blocked',
          ...(execution.childReceipt ? { childCommandId: execution.childReceipt.commandId } : {}), capacityBlocked: {
          code: 'WORLD_SAVE_EVENT_TOO_LARGE', requiredBytes: bytes, limitBytes: capacity.limits.maxEventBytes,
          retryable: false } };
        bytes = pendingWorldEventBytes({ kind: 'outcome', sourceCommandId, outcome: value });
      }
      const stored = structuredClone(value);
      const slots = reserveProgramExecution(sourceCommandId);
      const terminal = stored.status !== 'pending' || isHardCapacityBlocked(stored);
      const slot = terminal ? 'final' : 'first';
      const token = slots[slot] ?? capacity.reserve([bytes])[0];
      const released = capacity.resize(token, bytes);
      outcomes.set(sourceCommandId, stored);
      refreshPending(sourceCommandId);
      capacity.accept(token);
      slots[slot] = null;
      onOutcome({ sourceCommandId, outcome: stored, reservation: token });
      if (terminal) {
        releaseCapacity([slots.first, slots.final]);
        programCapacity.delete(sourceCommandId);
      }
      if (released) notifyCapacityReleased();
      return structuredClone(stored);
    }
  });

  function markSaved(watermark, savedReservations = []) {
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
    releaseCapacity(savedReservations);
    return status;
  }

  return Object.freeze({ authority, worldRepository, journalRepository, markSaved, claimCandidate, beginClose,
    pendingStatus: () => capacity.status(), reserveProgramExecution });
}
