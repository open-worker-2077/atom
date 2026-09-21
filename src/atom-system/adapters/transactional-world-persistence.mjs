import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';

import {
  adoptAtomContextSnapshot,
  writeAtomGraphProjection
} from '../../../work-engine/atom-language/context-store.mjs';
import {
  advanceCompatibilityManifest,
  validateCompatibilityManifest
} from '../world-runtime/legacy-graph-compat.mjs';
import { createCommitCoordinator } from '../world-runtime/commit-coordinator.mjs';
import { createIndependentWorldSaver } from '../world-runtime/independent-world-saver.mjs';
import { createMemoryTransactionPorts } from '../world-runtime/memory-transaction-ports.mjs';
import { isSealedWorldFacts, revisionOfWorldFacts } from '../world-runtime/world-revision.mjs';
import { DEFAULT_WORLD_SHUTDOWN_TIMEOUT_MS, withinWorldShutdown,
  worldShutdownDeadline, worldShutdownTimeout } from '../world-runtime/world-shutdown.mjs';
import { createDurableWorldWriter } from './durable-world-writer.mjs';
import {
  createJsonTransactionJournal,
  createJsonWorldRepository
} from './json-world-repository.mjs';
import {
  createProgramRefBindingUpdate,
  programRefBindingsForRollback,
  redactProgramRefBindings
} from '../../../work-engine/atom-language/program-ref-binding-ledger.mjs';
import {
  rebuildThingIdWatermark,
  thingIdentityAllocatorUpdate
} from '../../../work-engine/atom-language/thing-id-allocator.mjs';

function redactInternalMetadata(value) {
  const redacted = redactProgramRefBindings(value);
  const redactReceipt = (receipt) => {
    if (receipt?.result && typeof receipt.result === 'object') delete receipt.result.thingIdentityAllocator;
  };
  redactReceipt(redacted);
  redactReceipt(redacted?.receipt);
  redactReceipt(redacted?.sourceReceipt);
  redactReceipt(redacted?.childReceipt);
  if (Array.isArray(redacted)) for (const entry of redacted) {
    redactReceipt(entry);
    redactReceipt(entry?.receipt);
    redactReceipt(entry?.sourceReceipt);
    redactReceipt(entry?.childReceipt);
  }
  return redacted;
}

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function commandIdFor({ correlationId, expectedRevision, nextRevision }) {
  const digest = crypto.createHash('sha256')
    .update(`${correlationId}\0${expectedRevision}\0${nextRevision}`)
    .digest('hex');
  return `legacy-${digest}`;
}

function rollbackCommandIdFor({ correlationId, expectedRevision, targetCommandId }) {
  const digest = crypto.createHash('sha256')
    .update(`${correlationId}\0${expectedRevision}\0${targetCommandId}`)
    .digest('hex');
  return `rollback-${digest}`;
}

function canonicalRevision(value) {
  return String(value).startsWith('sha256:') ? String(value) : `sha256:${value}`;
}

// All in-process writers for a world use its existing coordinator. Projection hooks
// stay on each facade; weak ownership never evicts a live writer or retains a world.
const worldOwners = new Map();
// A timed-out close must not become a second writer merely because its last
// facade is collected. Keep the owner strongly fenced until termination proves.
const quarantinedWorldOwners = new Map();
function assertWorldUnfenced(worldKey) {
  if (quarantinedWorldOwners.has(worldKey)) {
    throw problem('WORLD_SAVE_WORKER_QUARANTINED', 'Prior world writer termination is not confirmed');
  }
}

// Guard at the actual I/O dispatch boundary, including handles opened before
// close began. Entry checks alone cannot fence a disk operation across await.
function fencedDiskFileSystem(worldKey, capability) {
  const mutations = new Set(['mkdir', 'writeFile', 'appendFile', 'rename', 'link', 'truncate', 'rm', 'unlink', 'copyFile']);
  const handleMutations = new Set(['write', 'writev', 'writeFile', 'appendFile', 'truncate', 'sync', 'datasync']);
  async function dispatch(work) {
    if (capability.revoked) throw problem('WORLD_SAVE_WORKER_QUARANTINED', 'Disk writer capability was revoked by world close');
    assertWorldUnfenced(worldKey);
    const pending = Promise.resolve(work());
    capability.pending.add(pending);
    try { return await pending; }
    finally { capability.pending.delete(pending); }
  }
  return new Proxy(fs, { get(target, name) {
    if (name === 'open') return async (...args) => {
      const handle = await (args[1] === 'r' ? target.open(...args) : dispatch(() => target.open(...args)));
      return new Proxy(handle, { get(opened, method) {
        if (handleMutations.has(method)) return (...values) => dispatch(() => opened[method](...values));
        const value = opened[method];
        return typeof value === 'function' ? value.bind(opened) : value;
      } });
    };
    if (mutations.has(name)) return (...args) => dispatch(() => target[name](...args));
    const value = target[name];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
const releaseWorldOwner = new FinalizationRegistry(({ key, reference }) => {
  if (worldOwners.get(key) === reference) worldOwners.delete(key);
});

function fenceWorldOwner(owner) {
  quarantinedWorldOwners.set(owner.worldKey, owner);
  owner.retiredDiskCapabilities ??= new Set();
  for (const [key, reference] of worldOwners) {
    const disk = reference.deref();
    if (disk?.worldKey !== owner.worldKey || !disk.writeCapability) continue;
    disk.writeCapability.revoked = true;
    owner.retiredDiskCapabilities.add(disk.writeCapability);
    // New facades after confirmed shutdown get a fresh capability. Existing
    // facades and operations never regain write authority when the fence lifts.
    worldOwners.delete(key);
  }
}

function terminateWorldOwner(owner) {
  if (!owner.termination) {
    fenceWorldOwner(owner);
    owner.termination = Promise.resolve().then(async () => {
      await owner.writer?.close();
      // Already dispatched OS work cannot be recalled. Do not reopen the
      // world until its completion is observed; revoked capabilities cannot
      // dispatch a successor while we wait.
      await Promise.allSettled([...owner.retiredDiskCapabilities].flatMap(capability => [...capability.pending]));
      owner.retiredDiskCapabilities.clear();
    }).then(() => {
      owner.terminated = true;
      if (worldOwners.get(owner.key)?.deref() === owner) worldOwners.delete(owner.key);
      if (quarantinedWorldOwners.get(owner.worldKey) === owner) quarantinedWorldOwners.delete(owner.worldKey);
    });
    owner.termination.catch(() => {});
  }
  return owner.termination;
}

function ownerFor({ contextFile, journalFile, projectionFile, publishLegacyProjection,
  worldId, runtimeAuthority = 'disk', saveSchedule, writerFactory = createDurableWorldWriter,
  onSaved, pendingLimits }) {
  const key = JSON.stringify([path.resolve(contextFile), path.resolve(journalFile), worldId, runtimeAuthority]);
  const pathKey = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
  const worldKey = JSON.stringify([pathKey(contextFile), pathKey(journalFile), worldId]);
  assertWorldUnfenced(worldKey);
  let owner = worldOwners.get(key)?.deref();
  if (owner?.closing) throw problem('WORLD_SAVE_WORKER_CLOSED', 'World owner is closing');
  if (!owner) {
    if (runtimeAuthority === 'memory') {
      owner = { key, worldKey, runtimeAuthority, recovery: null, ready: null, writer: null, saver: null,
        projections: new Set(), savedListeners: new Set(), capacityListeners: new Set(), durableTail: Promise.resolve(),
        closing: false, closed: false, closePromise: null, writerReady: null };
      owner.cancelled = new Promise((_, reject) => {
        owner.cancel = (error) => {
          owner.cancelError ??= error;
          reject(owner.cancelError);
        };
      });
      owner.cancelled.catch(() => {});
      owner.cancellable = (operation) => Promise.race([operation, owner.cancelled]);
      const writerClosed = () => problem('WORLD_SAVE_WORKER_CLOSED', 'Durable writer owner is closing');
      const durableOperation = (operation, work) => {
        const running = owner.cancellable(owner.durableTail.then(async () => {
          if (owner.closed || (owner.closing && operation === 'history')) throw writerClosed();
          if (owner.writer.lifecycle?.terminalFailure) {
            if (owner.closing) throw writerClosed();
            await owner.cancellable(owner.writer.close());
            if (owner.closing || owner.closed) throw writerClosed();
            const replacement = writerFactory({ contextFile, journalFile, worldId });
            owner.writer = replacement;
            // Recover disk once, but never seed the running memory world from
            // this older checkpoint. Keep non-transport initialization errors
            // latched rather than spawning another worker on every retry.
            owner.writerReady = Promise.resolve().then(() => replacement.initialize());
            await owner.cancellable(owner.writerReady);
            if (owner.closing || owner.closed) throw writerClosed();
          }
          await owner.cancellable(owner.writerReady);
          if (owner.closed || (owner.closing && operation === 'history')) throw writerClosed();
          return work(owner.writer);
        }));
        owner.durableTail = running.then(() => {}, () => {});
        return running;
      };
      const delegate = (field) => new Proxy({}, { get: (_, name) => (...args) =>
        owner.ready.then(() => owner[field][name](...args)) });
      owner.worldRepository = delegate('memoryWorldRepository');
      owner.journalRepository = delegate('memoryJournalRepository');
      owner.coordinator = delegate('memoryCoordinator');
      owner.ready = (async () => {
        const writer = writerFactory({ contextFile, journalFile, worldId });
        owner.writer = writer;
        owner.writerReady = Promise.resolve().then(() => writer.initialize());
        const { initialSnapshot, compatibilityManifest, durableReceipts, durableOutcomes } =
          await owner.cancellable(owner.writerReady);
        let sequence = 0;
        let savedSequence = 0;
        let unsaved = [];
        let ports;
        const saver = createIndependentWorldSaver({
          save: async ({ version, revision }) => {
            const events = unsaved.filter((entry) => entry.sequence > savedSequence
              && entry.sequence <= version).map(({ event }) => event);
            const result = await durableOperation('save', (activeWriter) => activeWriter.save({ events, revision,
              projectionFiles: [...owner.projections] }));
            return result.revision;
          },
          onSaved: ({ version }) => {
            if (owner.cancelError) throw owner.cancelError;
            if (owner.closing && Date.now() >= owner.closeDeadline) throw worldShutdownTimeout();
            const savedEvent = owner.savedWorldVersions.get(version);
            ports.markSaved({ version: savedEvent.version, revision: savedEvent.revision },
              unsaved.filter(entry => entry.sequence <= version).map(entry => entry.reservation));
            // onSaved runs only after the saver validates the exact returned
            // watermark. Until then the ordered events remain replay evidence.
            savedSequence = version;
            unsaved = unsaved.filter((entry) => entry.sequence > savedSequence);
            for (const key of owner.savedWorldVersions.keys()) {
              if (key <= version) owner.savedWorldVersions.delete(key);
            }
            owner.auxiliaryFailure = null;
            const notice = { contextFile, version: savedEvent.version, revision: savedEvent.revision };
            for (const listener of owner.savedListeners) {
              try {
                Promise.resolve(listener(notice)).catch((error) => {
                  owner.auxiliaryFailure = { code: error.code ?? error.name ?? 'WORLD_SAVE_NOTICE_FAILED' };
                });
              } catch (error) {
                owner.auxiliaryFailure = { code: error.code ?? error.name ?? 'WORLD_SAVE_NOTICE_FAILED' };
              }
            }
          },
          quietMs: saveSchedule?.quietMs ?? 250,
          maxDirtyMs: saveSchedule?.maxDirtyMs ?? 2000,
          retryMs: saveSchedule?.retryMs ?? 2000
        });
        owner.savedWorldVersions = new Map();
        const enqueue = (event, worldVersion, revision, reservation) => {
          const next = ++sequence;
          unsaved.push({ sequence: next, event, reservation });
          owner.savedWorldVersions.set(next, { version: worldVersion, revision });
          saver.enqueue({ version: next, revision });
        };
        ports = createMemoryTransactionPorts({ initialSnapshot, compatibilityManifest, pendingLimits,
          durableReceipts, durableOutcomes,
          onCapacityReleased: () => queueMicrotask(() => {
            if (owner.closing || owner.closed) return;
            for (const listener of owner.capacityListeners) {
              try { Promise.resolve(listener()).catch(() => {}); }
              catch { /* Capacity notification cannot undo accepted facts. */ }
            }
          }),
          durableFindCommitted: (id) => durableOperation('history', (activeWriter) => activeWriter.findCommitted(id)),
          onAccepted: ({ version, revision, record, reservation }) => enqueue({ kind: 'record', record }, version, revision, reservation),
          onOutcome: ({ sourceCommandId, outcome, reservation }) => {
            const current = ports.authority.snapshot();
            enqueue({ kind: 'outcome', sourceCommandId, outcome }, current.version, current.revision, reservation);
          } });
        owner.memoryPorts = ports;
        owner.memoryWorldRepository = ports.worldRepository;
        owner.memoryJournalRepository = ports.journalRepository;
        owner.memoryCoordinator = createCommitCoordinator(ports);
        owner.saver = saver;
        if (owner.closing) ports.beginClose();
      })().catch(async (error) => {
        try { await owner.cancellable(terminateWorldOwner(owner)); }
        catch { /* Preserve the initialization failure as the authoritative cause. */ }
        throw error;
      });
    } else {
      const writeCapability = { revoked: false, pending: new Set() };
      const fileSystem = fencedDiskFileSystem(worldKey, writeCapability);
      const worldRepository = createJsonWorldRepository({ file: contextFile, worldId,
        initialFacts: [], localCommitFile: path.join(`${journalFile}.d`, 'world-commits.jsonl'),
        autoCompact: true, fileSystem });
      const journalRepository = createJsonTransactionJournal({ file: journalFile, fileSystem });
      owner = { worldKey, writeCapability, runtimeAuthority, worldRepository, journalRepository,
        coordinator: createCommitCoordinator({ worldRepository, journalRepository }), recovery: null };
      // An in-flight capability keeps its weak-registry owner discoverable.
      writeCapability.owner = owner;
    }
    const reference = new WeakRef(owner);
    worldOwners.set(key, reference);
    releaseWorldOwner.register(owner, { key, reference });
  }
  if (runtimeAuthority === 'memory' && publishLegacyProjection && projectionFile) {
    owner.projections.add(path.resolve(projectionFile));
  }
  if (runtimeAuthority === 'memory' && typeof onSaved === 'function') owner.savedListeners.add(onSaved);
  return owner;
}

function assertSourceBinding(execution, event) {
  if (execution && execution.event.binding !== event.binding) {
    throw problem('ATOM_INTERACTION_ID_CONFLICT', '同一 Atom 请求标识不能对应不同命令或 Agent');
  }
}

export function createTransactionalWorldPersistence({
  contextFile,
  projectionFile,
  journalFile = path.join(path.dirname(contextFile), 'atom.transactions.json'),
  worldId = 'primary',
  publishLegacyProjection = true,
  runtimeAuthority = 'disk',
  saveSchedule = null,
  shutdownTimeoutMs = DEFAULT_WORLD_SHUTDOWN_TIMEOUT_MS,
  writerFactory = createDurableWorldWriter,
  onAuthoritativeWrite = async () => {},
  onSaved = null,
  pendingLimits
}) {
  worldShutdownDeadline({ timeoutMs: shutdownTimeoutMs });
  const owner = ownerFor({ contextFile, journalFile, projectionFile, publishLegacyProjection,
    worldId, runtimeAuthority, saveSchedule, writerFactory, onSaved, pendingLimits });
  const { worldRepository, journalRepository, coordinator } = owner;

  function beginClose() {
    if (owner.runtimeAuthority !== 'memory' || owner.closing) return;
    owner.closing = true;
    if (!owner.terminated) fenceWorldOwner(owner);
    owner.memoryPorts?.beginClose();
  }

  function assertAccepting() {
    if (owner.runtimeAuthority === 'memory' && (owner.closing || owner.closed)) {
      throw problem('WORLD_SAVE_WORKER_CLOSED', 'World owner is closed to new writes');
    }
    if (owner.writeCapability?.revoked) throw problem('WORLD_SAVE_WORKER_QUARANTINED', 'Disk writer capability was revoked by world close');
    assertWorldUnfenced(owner.worldKey);
  }

  function recover() {
    owner.recovery ??= coordinator.recover()
      .then((result) => {
        if (result.recovered > 0) {
          owner.cachedManifest = null;
          owner.manifestLoaded = false;
          owner.compatibilityGeneration = (owner.compatibilityGeneration ?? 0) + 1;
        }
        return result;
      })
      .finally(() => {
        owner.recovery = null;
      });
    return owner.recovery;
  }

  async function compatibilityManifest() {
    await recover();
    if (owner.manifestLoaded) return structuredClone(owner.cachedManifest);
    const latest = owner.runtimeAuthority === 'memory'
      ? await journalRepository.latestReceipt()
      : (await journalRepository.readState()).receipts.at(-1)?.receipt;
    owner.cachedManifest = structuredClone(latest?.result?.compatibilityManifest ?? null);
    owner.manifestLoaded = true;
    return structuredClone(owner.cachedManifest);
  }

  async function compatibilityManifestForRevision(revision) {
    const state = await journalRepository.readState();
    for (const entry of [...state.receipts].reverse()) {
      if (entry.receipt?.afterRevision === revision
        && entry.receipt?.result?.compatibilityManifest) {
        return structuredClone(entry.receipt.result.compatibilityManifest);
      }
      if (entry.receipt?.beforeRevision === revision
        && entry.receipt?.result?.previousCompatibilityManifest) {
        return structuredClone(entry.receipt.result.previousCompatibilityManifest);
      }
    }
    return null;
  }

  async function inspectCommittedSnapshot(copyFacts) {
    await recover();
    return coordinator.inspectCommitted(async (snapshot) => {
      const latest = owner.runtimeAuthority === 'memory'
        ? await journalRepository.latestReceipt()
        : (await journalRepository.readState()).receipts.at(-1)?.receipt;
      const compatibilityManifest = structuredClone(latest?.result?.compatibilityManifest ?? null);
      if (compatibilityManifest) validateCompatibilityManifest(compatibilityManifest, snapshot.facts);
      owner.cachedManifest = structuredClone(compatibilityManifest);
      owner.manifestLoaded = true;
      return Object.freeze({
        facts: copyFacts(snapshot.facts),
        revision: snapshot.revision,
        compatibilityManifest
      });
    });
  }

  async function readCommittedSnapshot() {
    return inspectCommittedSnapshot((facts) => structuredClone(facts));
  }

  async function readOwnedCommittedSnapshot() {
    if (owner.runtimeAuthority !== 'memory') return null;
    return inspectCommittedSnapshot((facts) => {
      if (!isSealedWorldFacts(facts)) {
        throw problem('INVALID_WORLD_SNAPSHOT', 'Memory authority returned unsealed facts');
      }
      return facts;
    });
  }

  async function transformLogEntries() {
    await recover();
    if (owner.cachedTransformLog) return structuredClone(owner.cachedTransformLog);
    if (owner.runtimeAuthority === 'memory') {
      owner.cachedTransformLog = await journalRepository.transformLogRecords();
    } else {
      const state = await journalRepository.readState();
      owner.cachedTransformLog = state.receipts.flatMap((entry) => {
        const record = entry.receipt?.result?.transformLogRecord;
        return record ? [structuredClone(record)] : [];
      });
    }
    return structuredClone(owner.cachedTransformLog);
  }

  async function readInternalMetadataState() {
    await recover();
    return journalRepository.readMetadataState();
  }

  async function readDiscardEvidence({ discardId, archivePath, originalPath }) {
    if (![discardId, archivePath, originalPath].every((value) => typeof value === 'string' && value)) return null;
    await recover();
    // Only restore asks for historical facts. Ordinary interactions keep their
    // existing metadata-only log path; auxiliary transform logs are never evidence.
    const state = await journalRepository.readState();
    const matches = state.receipts.filter((entry) => entry.receipt?.result?.transformLogRecord?.id === discardId);
    if (matches.length !== 1 || state.receipts.some((entry) => {
      const record = entry.receipt?.result?.transformLogRecord;
      return record?.operation === 'restore' && record.discardId === discardId;
    })) return null;
    const entry = await journalRepository.findCommitted(matches[0].commandId);
    const record = entry?.receipt?.result?.transformLogRecord;
    if (entry?.receipt?.status !== 'committed' || entry.receipt.commandId !== entry.commandId
      || record?.operation !== 'discard' || record.archivePath !== archivePath
      || record.originalPath !== originalPath) return null;
    const axis = (atom, name) => Object.entries(atom ?? {})
      .find(([key]) => (key.match(/^[^@&#$~]+/u)?.[0] ?? '') === name)?.[1];
    const locate = (facts, parts) => {
      let children = facts;
      let atom = null;
      for (const part of parts) {
        const found = Array.isArray(children) ? children.filter((child) => axis(child, 'thing') === part) : [];
        if (found.length !== 1) return null;
        atom = found[0];
        children = axis(atom, 'slot');
      }
      return atom;
    };
    let archivedAtom = null;
    let originalAtom = null;
    if (entry.historyMode === 'local-patch') {
      const patch = entry.patch;
      if (patch?.contract !== 'atom.world-patch' || patch.version !== 1 || patch.worldId !== worldId
        || patch.beforeRevision !== entry.receipt.beforeRevision || patch.afterRevision !== entry.receipt.afterRevision) return null;
      const extract = (targetPath, side) => {
        const owners = patch.operations.filter((operation) => operation.path === targetPath || targetPath.startsWith(`${operation.path}/`));
        if (owners.length !== 1) return null;
        const operation = owners[0];
        const relative = targetPath.slice(operation.path.length).split('/').filter(Boolean);
        return locate([operation[side]], [operation.path.split('/').at(-1), ...relative]);
      };
      archivedAtom = extract(archivePath, 'after');
      originalAtom = extract(originalPath, 'before');
    } else if (entry.after?.worldId === worldId && entry.after.revision === entry.receipt.afterRevision
      && entry.before?.worldId === worldId && entry.before.revision === entry.receipt.beforeRevision) {
      archivedAtom = locate(entry.after.facts, archivePath.split('/'));
      originalAtom = locate(entry.before.facts, originalPath.split('/'));
    }
    return archivedAtom && originalAtom ? { discardId, archivePath, originalPath,
      archivedAtom: structuredClone(archivedAtom), originalAtom: structuredClone(originalAtom) } : null;
  }

  async function commit({
    correlationId,
    expectedRevision,
    nextRevision,
    facts,
    beforeFacts = null,
    source = 'legacy-interaction',
    changedPaths = null,
    affectedAtoms = null,
    affectedPathClosureComplete = false,
    relationEndpoints = null,
    lockPaths = null,
    shortcutPaths = null,
    referencePaths = null,
    transformLogRecord = null,
    postCommitEvent = null,
    subsequentOf = null,
    programRefBindings = null,
    thingIdentityAllocator = null,
    compatibilityManifest: suppliedManifest = null,
    baseCompatibilityManifest: suppliedBaseManifest = null
  }) {
    assertAccepting();
    await recover();
    async function existingExecutionReceipt() {
      if (postCommitEvent) {
        const existing = await journalRepository.programExecutionForInteraction(correlationId);
        assertSourceBinding(existing, postCommitEvent);
        if (existing) return existing.sourceReceipt;
      }
      if (subsequentOf) {
        const execution = await journalRepository.programExecution(subsequentOf);
        if (!execution) throw problem('PROGRAM_SOURCE_NOT_FOUND', 'Subsequent effects require a committed source');
        if (execution.childReceipt) return execution.childReceipt;
        if (execution.outcome && execution.outcome.status !== 'pending') {
          throw problem('PROGRAM_EXECUTION_FINAL', 'A final post-commit business outcome cannot be executed again');
        }
      }
      return null;
    }
    const existing = await existingExecutionReceipt();
    if (existing) return redactInternalMetadata(existing);
    const computedRevision = revisionOfWorldFacts(facts);
    const canonicalNextRevision = canonicalRevision(nextRevision);
    const canonicalExpectedRevision = canonicalRevision(expectedRevision);
    if (computedRevision !== canonicalNextRevision) {
      throw problem('INVALID_WORLD_REVISION', 'Legacy transition revision does not match its facts', {
        nextRevision,
        computedRevision
      });
    }
    const latestManifest = await compatibilityManifest();
    const previousManifest = suppliedBaseManifest
      ? structuredClone(suppliedBaseManifest)
      : latestManifest?.currentWorldRevision === canonicalExpectedRevision
        ? structuredClone(latestManifest)
        : await compatibilityManifestForRevision(canonicalExpectedRevision);
    if (latestManifest && latestManifest.currentWorldRevision !== canonicalExpectedRevision
      && !previousManifest) {
      throw problem('WORLD_REVISION_CONFLICT', 'Compatibility manifest for the command base is unavailable', {
        expectedRevision: canonicalExpectedRevision,
        actualRevision: latestManifest.currentWorldRevision
      });
    }
    if (suppliedBaseManifest && Array.isArray(beforeFacts)) {
      validateCompatibilityManifest(previousManifest, beforeFacts);
    }
    const commandId = commandIdFor({
      correlationId,
      expectedRevision: canonicalExpectedRevision,
      nextRevision: canonicalNextRevision
    });
    let nextManifest = suppliedManifest
      ? (validateCompatibilityManifest(suppliedManifest, facts), structuredClone(suppliedManifest))
      : null;
    const bindingUpdate = programRefBindings == null
      ? null
      : createProgramRefBindingUpdate(programRefBindings);
    const identityUpdate = thingIdentityAllocator == null
      ? null
      : thingIdentityAllocatorUpdate({
        previousWatermark: thingIdentityAllocator.previousWatermark,
        ids: thingIdentityAllocator.issued
      });
    if (identityUpdate && (thingIdentityAllocator.version !== identityUpdate.version
      || thingIdentityAllocator.nextWatermark !== identityUpdate.nextWatermark)) {
      throw problem('INVALID_THING_ID_ALLOCATION', 'Thing ID allocation metadata is not canonical');
    }
    let receipt;
    let reusedReceipt = false;
    try {
      receipt = await coordinator.execute({
        ...(Array.isArray(beforeFacts) ? { baseFacts: beforeFacts } : {}),
        rebaseResult: async ({ current, after, facts: rebasedFacts, result }) => {
          const state = await journalRepository.readState();
          const currentManifest = structuredClone(
            state.receipts.at(-1)?.receipt?.result?.compatibilityManifest ?? null
          );
          if (currentManifest) validateCompatibilityManifest(currentManifest, current.facts);
          const rebasedManifest = currentManifest
            ? advanceCompatibilityManifest(currentManifest, current.facts, rebasedFacts)
            : null;
          const {
            compatibilityManifest: _staleManifest,
            previousCompatibilityManifest: _stalePreviousManifest,
            postCommitEvent: stalePostCommitEvent,
            ...stableResult
          } = result ?? {};
          return {
            ...stableResult,
            ...(stalePostCommitEvent ? { postCommitEvent: {
              ...stalePostCommitEvent,
              sourceRevision: stalePostCommitEvent.sourceChanged === false
                ? current.revision
                : after.revision
            } } : {}),
            ...(rebasedManifest ? { compatibilityManifest: rebasedManifest } : {}),
            ...(currentManifest ? { previousCompatibilityManifest: currentManifest } : {})
          };
        },
        validateCommit: async () => {
          const existing = await existingExecutionReceipt()
            ?? await journalRepository.findReceipt(commandId);
          reusedReceipt = Boolean(existing);
          if (!existing && identityUpdate) {
            const metadata = await journalRepository.readMetadataState();
            const watermark = rebuildThingIdWatermark(metadata.receipts);
            if (watermark !== identityUpdate.previousWatermark) {
              throw problem('THING_IDENTITY_WATERMARK_CONFLICT', 'Thing ID allocation is based on a stale watermark', {
                expectedWatermark: identityUpdate.previousWatermark,
                actualWatermark: watermark
              });
            }
          }
          return existing;
        },
        command: {
          contract: 'atom.world-command',
          version: 1,
          commandId,
          correlationId,
          expectedRevision: canonicalExpectedRevision,
          name: 'legacy-transition',
          payload: { source }
        },
        transitionInputMode: 'trusted-readonly',
        transition: (current) => {
          nextManifest ??= previousManifest
            ? (validateCompatibilityManifest(previousManifest, current.facts),
              advanceCompatibilityManifest(previousManifest, current.facts, facts))
            : null;
          return {
            facts,
            revision: canonicalNextRevision,
            ...(Array.isArray(changedPaths) && changedPaths.length ? { changedPaths } : {}),
            result: {
              source,
              ...(postCommitEvent ? { postCommitEvent: structuredClone({ ...postCommitEvent,
                sourceCommandId: commandId, sourceRevision: postCommitEvent.sourceChanged === false
                  ? canonicalExpectedRevision : canonicalNextRevision }) } : {}),
              ...(subsequentOf ? { subsequentOf } : {}),
              ...(Array.isArray(affectedAtoms) ? {
                affectedAtoms,
                affectedAtomsComplete: true
              } : {}),
              ...(affectedPathClosureComplete === true ? {
                affectedPathClosureComplete: true,
                relationEndpoints,
                lockPaths,
                shortcutPaths,
                referencePaths
              } : {}),
              ...(nextManifest ? { compatibilityManifest: nextManifest } : {}),
              ...(previousManifest ? { previousCompatibilityManifest: previousManifest } : {}),
              ...(transformLogRecord ? {
                transformLogRecord: structuredClone(transformLogRecord)
              } : {}),
              ...(bindingUpdate ? { programRefBindings: bindingUpdate } : {}),
              ...(identityUpdate ? { thingIdentityAllocator: identityUpdate } : {})
            }
          };
        }
      });
    } catch (error) {
      if (postCommitEvent) {
        const existing = await journalRepository.programExecutionForInteraction(correlationId);
        assertSourceBinding(existing, postCommitEvent);
        if (existing) return redactInternalMetadata(existing.sourceReceipt);
      }
      throw error;
    }
    if (reusedReceipt) return redactInternalMetadata(receipt);
    if (postCommitEvent) assertSourceBinding({ event: receipt.result.postCommitEvent }, postCommitEvent);
    const committedSnapshot = await (owner.runtimeAuthority === 'memory'
      ? readOwnedCommittedSnapshot() : readCommittedSnapshot());
    const committedFacts = committedSnapshot.revision === canonicalNextRevision
      ? facts
      : committedSnapshot.facts;
    nextManifest = committedSnapshot.compatibilityManifest;
    owner.cachedManifest = structuredClone(nextManifest);
    owner.manifestLoaded = true;
    owner.compatibilityGeneration = (owner.compatibilityGeneration ?? 0) + 1;
    if (transformLogRecord && owner.cachedTransformLog) {
      owner.cachedTransformLog.push(structuredClone(transformLogRecord));
    }
    try {
      await adoptAtomContextSnapshot(contextFile, committedFacts, {
        ...(nextManifest ? { compatibilityManifest: nextManifest } : {})
      });
      await onAuthoritativeWrite({
        operation: 'commit',
        contextFile,
        revision: receipt.afterRevision,
        receipt: redactInternalMetadata(receipt)
      });
    } catch (error) {
      throw problem(
        error.code ?? 'WORLD_COMMITTED_AUXILIARY_PENDING',
        error.message ?? 'World transition committed, but an auxiliary projection requires recovery',
        { ...(error.details ?? {}), receipt: redactInternalMetadata(receipt), cause: error.code ?? error.name }
      );
    }
    if (publishLegacyProjection && owner.runtimeAuthority !== 'memory') {
      try {
        await writeAtomGraphProjection(projectionFile, committedFacts, {
          rootName: path.basename(contextFile),
          allowLegacyStrut: Boolean(nextManifest)
        });
      } catch (error) {
        throw problem(
          'WORLD_COMMITTED_PROJECTION_PENDING',
          'World transition committed, but the legacy Graph projection requires recovery',
          { receipt: redactInternalMetadata(receipt), projection: 'graph', cause: error.code ?? error.name }
        );
      }
    }
    return redactInternalMetadata(receipt);
  }

  async function rollback({ targetCommandId, correlationId, expectedRevision }) {
    assertAccepting();
    await recover();
    const canonicalExpectedRevision = canonicalRevision(expectedRevision);
    const metadataState = await journalRepository.readMetadataState();
    const inverseBindings = programRefBindingsForRollback(metadataState.receipts, targetCommandId);
    const receipt = await coordinator.rollback({
      targetCommandId,
      ...(inverseBindings ? { result: { programRefBindings: inverseBindings } } : {}),
      rebaseResult: async ({ current, facts: rebasedFacts, result }) => {
        const state = await journalRepository.readState();
        const currentManifest = structuredClone(
          state.receipts.at(-1)?.receipt?.result?.compatibilityManifest ?? null
        );
        if (currentManifest) validateCompatibilityManifest(currentManifest, current.facts);
        const rebasedManifest = currentManifest
          ? advanceCompatibilityManifest(currentManifest, current.facts, rebasedFacts)
          : null;
        const {
          compatibilityManifest: _staleManifest,
          previousCompatibilityManifest: _stalePreviousManifest,
          ...stableResult
        } = result ?? {};
        return {
          ...stableResult,
          ...(rebasedManifest ? { compatibilityManifest: rebasedManifest } : {}),
          ...(currentManifest ? { previousCompatibilityManifest: currentManifest } : {})
        };
      },
      command: {
        contract: 'atom.world-command',
        version: 1,
        commandId: rollbackCommandIdFor({
          correlationId,
          expectedRevision: canonicalExpectedRevision,
          targetCommandId
        }),
        correlationId,
        expectedRevision: canonicalExpectedRevision,
        name: 'rollback-world-command',
        payload: { targetCommandId }
      }
    });
    owner.manifestLoaded = false;
    owner.compatibilityGeneration = (owner.compatibilityGeneration ?? 0) + 1;
    await onAuthoritativeWrite({
      operation: 'rollback',
      contextFile,
      revision: receipt.afterRevision,
      receipt: redactInternalMetadata(receipt)
    });
    if (publishLegacyProjection && owner.runtimeAuthority !== 'memory') {
      const restored = await worldRepository.read();
      try {
        await writeAtomGraphProjection(projectionFile, restored.facts, {
          rootName: path.basename(contextFile),
          allowLegacyStrut: Boolean(await compatibilityManifest())
        });
      } catch (error) {
        throw problem(
          'WORLD_COMMITTED_PROJECTION_PENDING',
          'World rollback committed, but the legacy Graph projection requires recovery',
          { receipt: redactInternalMetadata(receipt), projection: 'graph', cause: error.code ?? error.name }
        );
      }
    }
    return redactInternalMetadata(receipt);
  }

  return Object.freeze({
    // Cache invalidation only; authoritative identity remains the world receipt.
    get compatibilityGeneration() { return owner.compatibilityGeneration ?? 0; },
    get saveStatus() {
      return owner.runtimeAuthority === 'memory'
        ? owner.saver ? { ...owner.memoryPorts.authority.status(),
          pending: owner.saver.status().pending,
          failure: owner.shutdownFailure ?? owner.saver.status().failure,
          auxiliaryFailure: owner.auxiliaryFailure ?? null,
          capacity: owner.memoryPorts.pendingStatus() }
          : { pending: false, initializing: true }
        : { pending: false };
    },
    async flushSaves() {
      if (owner.runtimeAuthority !== 'memory') return { pending: false };
      if (owner.closing || owner.closed) throw problem('WORLD_SAVE_WORKER_CLOSED', 'Durable writer owner is closing');
      await owner.ready;
      return owner.saver.flush();
    },
    beginClose,
    subscribeCapacityRelease(listener) {
      if (owner.runtimeAuthority !== 'memory') return () => {};
      owner.capacityListeners.add(listener);
      return () => owner.capacityListeners.delete(listener);
    },
    async reserveProgramExecution(sourceCommandId) {
      assertAccepting();
      await recover();
      if (owner.runtimeAuthority === 'memory') owner.memoryPorts.reserveProgramExecution(sourceCommandId);
    },
    async closeSaves({ timeoutMs = shutdownTimeoutMs, deadline } = {}) {
      if (owner.runtimeAuthority !== 'memory') return { pending: false };
      if (owner.closePromise) return owner.closePromise;
      owner.closeDeadline = worldShutdownDeadline({ timeoutMs, deadline });
      beginClose();
      owner.closePromise = (async () => {
        try {
          return await withinWorldShutdown((async () => {
            await owner.ready;
            try { return await owner.saver.close(); }
            finally {
              owner.closed = true;
              owner.cancel(problem('WORLD_SAVE_WORKER_CLOSED', 'Durable writer owner is closed'));
              await terminateWorldOwner(owner);
            }
          })(), owner.closeDeadline);
        } catch (error) {
          owner.closed = true;
          if (error.code === 'WORLD_SAVE_CLOSE_TIMEOUT') owner.shutdownFailure = { code: error.code };
          owner.cancel(error);
          // Do not wait behind a hung durable operation before terminating its
          // worker. The strong quarantine clears only on actual confirmation.
          void terminateWorldOwner(owner);
          throw error;
        }
      })();
      return owner.closePromise;
    },
    commit,
    compatibilityManifest,
    readInternalMetadataState,
    readCommittedSnapshot,
    ...(owner.runtimeAuthority === 'memory' ? {
      readOwnedCommittedSnapshot,
      async claimCandidate(facts) {
        assertAccepting();
        await owner.ready;
        return owner.memoryPorts.claimCandidate(facts);
      }
    } : {}),
    recover,
    rollback,
    transformLogEntries,
    readDiscardEvidence,
    async programExecution(sourceCommandId) {
      await recover();
      return redactInternalMetadata(await journalRepository.programExecution(sourceCommandId));
    },
    async programExecutionForInteraction(correlationId) {
      await recover();
      return redactInternalMetadata(await journalRepository.programExecutionForInteraction(correlationId));
    },
    async pendingProgramExecutions() {
      await recover();
      return redactInternalMetadata(await journalRepository.pendingProgramExecutions());
    },
    async recordProgramExecution(request) {
      assertAccepting();
      await recover();
      return coordinator.recordProgramExecution(request);
    }
  });
}
