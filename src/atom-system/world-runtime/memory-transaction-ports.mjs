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
  const durableById = new Map(durableReceipts.map((entry) => [entry.commandId, entry]));
  const accepted = new Map();
  const prepared = new Map();
  const outcomes = new Map(durableOutcomes);
  let staged = null;

  const worldRepository = Object.freeze({
    async read() {
      const current = authority.snapshot();
      return { contract: 'atom.world-snapshot', version: 1,
        worldId: initialSnapshot.worldId, revision: current.revision, facts: current.facts };
    },
    async compareAndSwap({ commandId, expectedRevision, nextSnapshot }) {
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
      const receipt = accepted.get(identity.commandId)?.receipt;
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

  const entries = () => [...durableReceipts, ...accepted.values()];
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
    async findReceipt(id) { return structuredClone(receiptFor(id)); },
    async findPrepared(id) { return structuredClone(prepared.get(id) ?? null); },
    async findCommitted(id) {
      return structuredClone(accepted.get(id) ?? await durableFindCommitted(id));
    },
    async listPrepared() { return structuredClone([...prepared.values()]); },
    async readState() { return { prepared: structuredClone([...prepared.values()]),
      receipts: structuredClone(entries()) }; },
    async prepare(record) {
      if (prepared.has(record.commandId) || receiptFor(record.commandId)) {
        throw problem('DUPLICATE_COMMAND_ID', `Command ${record.commandId} already exists`);
      }
      prepared.set(record.commandId, record);
    },
    async commit(commandId, receipt) {
      const existing = receiptFor(commandId);
      if (existing) return structuredClone(existing);
      const record = prepared.get(commandId);
      if (!record || !staged) {
        throw problem('MISSING_PREPARED_TRANSACTION', `Command ${commandId} was not staged`);
      }
      const facts = structuredClone(staged.nextSnapshot.facts);
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
      const stored = structuredClone({ ...outcome, ...(execution.childReceipt
        ? { childCommandId: execution.childReceipt.commandId } : {}) });
      outcomes.set(sourceCommandId, stored);
      onOutcome({ sourceCommandId, outcome: stored });
      return structuredClone(stored);
    }
  });

  return Object.freeze({ authority, worldRepository, journalRepository });
}
