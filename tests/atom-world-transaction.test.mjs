import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createLocalWorldPatch } from '../src/atom-system/world-runtime/local-world-patch.mjs';
import {
  createJsonTransactionJournal,
  createJsonWorldRepository,
  writeJsonAtomically
} from '../src/atom-system/adapters/json-world-repository.mjs';
import {
  advanceCompatibilityManifest,
  createCompatibilityManifest,
  validateCompatibilityManifest
} from '../src/atom-system/world-runtime/legacy-graph-compat.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import { applyTransform } from '../work-engine/atom-language/transform-executor.mjs';
import {
  createShortcutAtom,
  resolveShortcutMatch
} from '../work-engine/atom-language/shortcut-runtime.mjs';

function revisionOf(facts) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex')}`;
}

function command(id, expectedRevision) {
  return {
    contract: 'atom.world-command',
    version: 1,
    commandId: id,
    correlationId: `interaction-${id}`,
    expectedRevision,
    name: 'append-fact',
    payload: {}
  };
}

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-world-transaction-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const journalFile = path.join(directory, 'transactions.json');
  await fs.writeFile(worldFile, '[]\n', 'utf8');
  const worldRepository = createJsonWorldRepository({ file: worldFile, worldId: 'primary' });
  const journalRepository = createJsonTransactionJournal({ file: journalFile });
  const coordinator = createCommitCoordinator({
    worldRepository,
    journalRepository,
    faultInjector: options.faultInjector
  });
  return { coordinator, worldRepository, journalRepository, worldFile, journalFile };
}

function completeLocalEffects(result = {}) {
  return {
    relationEndpoints: [],
    lockPaths: [],
    shortcutPaths: [],
    referencePaths: [],
    affectedPathClosureComplete: true,
    ...result
  };
}

function directorySyncCapableFileSystem(directory) {
  return {
    ...fs,
    async open(target, flags, ...args) {
      if (path.resolve(target) === path.resolve(directory)) {
        return { async sync() {}, async close() {} };
      }
      return fs.open(target, flags, ...args);
    }
  };
}

function transformLocalEffects(transformed) {
  return {
    relationEndpoints: transformed.relationPaths ?? [],
    shortcutPaths: transformed.shortcutPaths ?? [],
    referencePaths: [
      ...(transformed.programSourcePaths ?? []),
      ...(transformed.referencePaths ?? [])
    ],
    affectedPathClosureComplete: transformed.affectedPathClosureComplete === true
  };
}

function transformChangedPaths(transformed) {
  return [...new Set([
    transformed.sourcePath,
    transformed.resultPath,
    ...(transformed.relationPaths ?? []),
    ...(transformed.programSourcePaths ?? []),
    ...(transformed.shortcutPaths ?? [])
  ].filter(Boolean))];
}

function journalFailingCommits(journalRepository, count) {
  let remaining = count;
  return Object.freeze({
    findReceipt: (...args) => journalRepository.findReceipt(...args),
    findPrepared: (...args) => journalRepository.findPrepared(...args),
    findCommitted: (...args) => journalRepository.findCommitted(...args),
    prepare: (...args) => journalRepository.prepare(...args),
    async commit(...args) {
      if (remaining > 0) {
        remaining -= 1;
        throw Object.assign(new Error('simulated journal commit failure'), { code: 'EIO' });
      }
      return journalRepository.commit(...args);
    },
    listPrepared: (...args) => journalRepository.listPrepared(...args),
    readState: (...args) => journalRepository.readState(...args)
  });
}

test('concurrent commands with one expected revision serialize and cannot lose updates', async (t) => {
  const { coordinator, worldRepository, journalRepository } = await fixture(t);
  const initial = await worldRepository.read();

  const outcomes = await Promise.allSettled([
    coordinator.execute({
      command: command('cmd-a', initial.revision),
      transition: ({ facts }) => ({ facts: [...facts, { name: 'A' }], result: { added: 'A' } })
    }),
    coordinator.execute({
      command: command('cmd-b', initial.revision),
      transition: ({ facts }) => ({ facts: [...facts, { name: 'B' }], result: { added: 'B' } })
    })
  ]);

  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejection = outcomes.find(({ status }) => status === 'rejected').reason;
  assert.equal(rejection.code, 'WORLD_REVISION_CONFLICT');
  assert.equal((await worldRepository.read()).facts.length, 1);
  assert.equal((await journalRepository.readState()).receipts.length, 1);
});

async function concurrentLocalPair({ coordinator, initial, left, right }) {
  let entered = 0;
  let release;
  let bothEntered;
  const gate = new Promise((resolve) => { release = resolve; });
  const ready = new Promise((resolve) => { bothEntered = resolve; });
  const run = (id, change) => coordinator.execute({
    command: command(id, initial.revision),
    transition: async ({ facts }) => {
      entered += 1;
      if (entered === 2) bothEntered();
      await gate;
      return change(structuredClone(facts));
    }
  });
  const outcomes = Promise.allSettled([run('local-left', left), run('local-right', right)]);
  await ready;
  release();
  return outcomes;
}

for (const scenario of ['different top-level Atoms', 'different slot instances']) {
  test(`concurrent local commits merge ${scenario}`, async (t) => {
    const files = await fixture(t);
    const initialFacts = scenario === 'different top-level Atoms'
      ? [
          { thing: 'A', situation: 'old', slot: [], strut: [] },
          { thing: 'B', situation: 'old', slot: [], strut: [] }
        ]
      : [{ thing: 'Root', situation: '', slot: [
          { thing: 'A', situation: 'old', slot: [], strut: [] },
          { thing: 'B', situation: 'old', slot: [], strut: [] }
        ], strut: [] }];
    await writeJsonAtomically(files.worldRepository.file, initialFacts);
    const initial = await files.worldRepository.read();
    const pathA = scenario === 'different top-level Atoms' ? 'A' : 'Root/A';
    const pathB = scenario === 'different top-level Atoms' ? 'B' : 'Root/B';
    const outcomes = await concurrentLocalPair({ coordinator: files.coordinator, initial,
      left(facts) {
        (scenario === 'different top-level Atoms' ? facts[0] : facts[0].slot[0]).situation = 'new-a';
        return { facts, changedPaths: [pathA], result: completeLocalEffects() };
      },
      right(facts) {
        (scenario === 'different top-level Atoms' ? facts[1] : facts[0].slot[1]).situation = 'new-b';
        return { facts, changedPaths: [pathB], result: completeLocalEffects() };
      }
    });

    assert.equal(outcomes.every(({ status }) => status === 'fulfilled'), true, JSON.stringify(outcomes));
    const committed = (await files.worldRepository.read()).facts;
    assert.equal((scenario === 'different top-level Atoms' ? committed[0] : committed[0].slot[0]).situation, 'new-a');
    assert.equal((scenario === 'different top-level Atoms' ? committed[1] : committed[0].slot[1]).situation, 'new-b');
  });
}

test('concurrent edits of the same Atom remain one explicit local conflict', async (t) => {
  const files = await fixture(t);
  const initialFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
  await writeJsonAtomically(files.worldRepository.file, initialFacts);
  const initial = await files.worldRepository.read();
  const outcomes = await concurrentLocalPair({ coordinator: files.coordinator, initial,
    left(facts) { facts[0].situation = 'left'; return { facts, changedPaths: ['Root'], result: completeLocalEffects() }; },
    right(facts) { facts[0].situation = 'right'; return { facts, changedPaths: ['Root'], result: completeLocalEffects() }; }
  });
  const rejected = outcomes.find(({ status }) => status === 'rejected')?.reason;
  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(rejected?.code, 'WORLD_REVISION_CONFLICT');
  assert.deepEqual(rejected?.details?.conflictingPaths, ['Root']);
});

test('real shortcut retarget guards its validated target against a concurrent rename', async (t) => {
  const files = await fixture(t);
  const initialFacts = [
    { thing: 'Old', situation: '', slot: [], strut: [] },
    { thing: 'New', situation: '', slot: [], strut: [] },
    createShortcutAtom({ thing: 'Entry', targetPath: 'Old', referenceId: 'entry-ref' })
  ];
  await writeJsonAtomically(files.worldFile, initialFacts);
  const initial = await files.worldRepository.read();
  const receiver = createAtomLanguageReceiver();
  const retargetItem = receiver.receive('transform {"thing.lnk.New":"Entry"}').items[0];
  const renameItem = receiver.receive('transform {"thing.ren.Moved":"New"}').items[0];

  const [retargeted, renamed] = await Promise.all([
    applyTransform({
      atoms: initialFacts,
      item: retargetItem,
      contextFile: files.worldFile
    }),
    applyTransform({
      atoms: initialFacts,
      item: renameItem,
      contextFile: files.worldFile
    })
  ]);
  assert.equal(retargeted.error, undefined, JSON.stringify(retargeted.error));
  assert.equal(renamed.error, undefined, JSON.stringify(renamed.error));
  assert.equal(retargeted.affectedPathClosureComplete, true);
  assert.deepEqual(retargeted.referencePaths, ['New']);
  assert.equal(renamed.affectedPathClosureComplete, false,
    'global rename scans are conservatively ineligible for local rebase');

  await files.coordinator.execute({
    command: command('shortcut-target-rename', initial.revision),
    transition: () => ({
      facts: renamed.atoms,
      changedPaths: transformChangedPaths(renamed),
      result: transformLocalEffects(renamed)
    })
  });
  await assert.rejects(files.coordinator.execute({
    command: command('stale-shortcut-retarget', initial.revision),
    baseFacts: initialFacts,
    transitionReadsSnapshot: false,
    transition: () => ({
      facts: retargeted.atoms,
      changedPaths: transformChangedPaths(retargeted),
      result: transformLocalEffects(retargeted)
    })
  }), (error) => error.code === 'WORLD_REVISION_CONFLICT');

  const committed = (await files.worldRepository.read()).facts;
  assert.deepEqual(committed.map((atom) => atom.thing ?? atom['thing@shortcut']), [
    'Old', 'Moved', 'Entry'
  ]);
  const entry = committed.find((atom) => atom['thing@shortcut'] === 'Entry');
  const resolved = resolveShortcutMatch(committed, { atom: entry, path: ['Entry'] });
  assert.equal(resolved.path.join('/'), 'Old');
});

test('a disjoint local command may enter after another commit using its exact base facts', async (t) => {
  const files = await fixture(t);
  const initialFacts = [
    { thing: 'A', situation: 'old', slot: [], strut: [] },
    { thing: 'B', situation: 'old', slot: [], strut: [] }
  ];
  await writeJsonAtomically(files.worldRepository.file, initialFacts);
  const initial = await files.worldRepository.read();
  const left = structuredClone(initialFacts);
  left[0].situation = 'new-a';
  await files.coordinator.execute({
    command: command('entered-first', initial.revision),
    transition: () => ({ facts: left, changedPaths: ['A'], result: completeLocalEffects() })
  });
  const right = structuredClone(initialFacts);
  right[1].situation = 'new-b';
  await files.coordinator.execute({
    command: command('entered-late', initial.revision),
    baseFacts: initialFacts,
    transitionReadsSnapshot: false,
    transition: () => ({ facts: right, changedPaths: ['B'], result: completeLocalEffects() })
  });

  const committed = (await files.worldRepository.read()).facts;
  assert.equal(committed[0].situation, 'new-a');
  assert.equal(committed[1].situation, 'new-b');
});

for (const guard of ['relationEndpoints', 'lockPaths', 'shortcutPaths']) {
  test(`concurrent local commits reject shared ${guard}`, async (t) => {
    const files = await fixture(t);
    const initialFacts = [
      { thing: 'A', situation: 'old', slot: [], strut: [] },
      { thing: 'B', situation: 'old', slot: [], strut: [] },
      { thing: 'Guard', situation: 'kept', slot: [], strut: [] }
    ];
    await writeJsonAtomically(files.worldRepository.file, initialFacts);
    const initial = await files.worldRepository.read();
    const outcomes = await concurrentLocalPair({ coordinator: files.coordinator, initial,
      left(facts) { facts[0].situation = 'left'; return { facts, changedPaths: ['A'], result: completeLocalEffects({ [guard]: ['Guard'] }) }; },
      right(facts) { facts[1].situation = 'right'; return { facts, changedPaths: ['B'], result: completeLocalEffects({ [guard]: ['Guard'] }) }; }
    });
    const rejected = outcomes.find(({ status }) => status === 'rejected')?.reason;
    assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(rejected?.code, 'WORLD_REVISION_CONFLICT');
    assert.deepEqual(rejected?.details?.conflictingPaths, ['Guard']);
  });
}

test('an ancestor move and descendant edit cannot split one subtree across local commits', async (t) => {
  const files = await fixture(t);
  const initialFacts = [{ thing: 'Root', situation: '', slot: [
    { thing: 'Child', situation: 'old', slot: [], strut: [] }
  ], strut: [] }];
  await writeJsonAtomically(files.worldRepository.file, initialFacts);
  const initial = await files.worldRepository.read();
  const outcomes = await concurrentLocalPair({ coordinator: files.coordinator, initial,
    left(facts) {
      facts[0].thing = 'Moved';
      return { facts, changedPaths: ['Root', 'Moved'], result: completeLocalEffects() };
    },
    right(facts) {
      facts[0].slot[0].situation = 'new';
      return { facts, changedPaths: ['Root/Child'], result: completeLocalEffects() };
    }
  });
  const rejected = outcomes.find(({ status }) => status === 'rejected')?.reason;
  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(rejected?.code, 'WORLD_REVISION_CONFLICT');
  assert.ok(rejected?.details?.conflictingPaths?.some((path) => path === 'Root' || path === 'Root/Child'));
});

test('committed inspection cannot observe the world-write and journal-commit gap', async (t) => {
  let releaseWorldWrite;
  let signalWorldWritten;
  const worldWritten = new Promise((resolve) => { signalWorldWritten = resolve; });
  const holdWorldWrite = new Promise((resolve) => { releaseWorldWrite = resolve; });
  const files = await fixture(t, {
    faultInjector: async (stage) => {
      if (stage !== 'after-world-write') return;
      signalWorldWritten();
      await holdWorldWrite;
    }
  });
  const initial = await files.worldRepository.read();
  const committing = files.coordinator.execute({
    command: command('committed-inspection-gap', initial.revision),
    transition: ({ facts }) => ({ facts: [...facts, { name: 'committed' }] })
  });
  await worldWritten;

  let inspected = false;
  const inspection = files.coordinator.inspectCommitted(async (snapshot) => {
    inspected = true;
    const state = await files.journalRepository.readState();
    return { snapshot, receipt: state.receipts.at(-1)?.receipt ?? null };
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(inspected, false, 'inspection must wait until the journal commit completes');

  releaseWorldWrite();
  const [receipt, observed] = await Promise.all([committing, inspection]);
  assert.equal(observed.snapshot.revision, receipt.afterRevision);
  assert.equal(observed.receipt.afterRevision, receipt.afterRevision);
});

test('an incomplete declared patch cannot rebase and commit only part of one Transform', async (t) => {
  const files = await fixture(t);
  const initialFacts = ['A', 'B', 'C'].map((thing) => ({ thing, situation: 'old', slot: [], strut: [] }));
  await writeJsonAtomically(files.worldFile, initialFacts);
  const initial = await files.worldRepository.read();
  const firstFacts = structuredClone(initialFacts);
  firstFacts[2].situation = 'new-c';
  await files.coordinator.execute({
    command: command('complete-c', initial.revision),
    transition: () => ({ facts: firstFacts, changedPaths: ['C'], result: completeLocalEffects() })
  });
  const incompleteFacts = structuredClone(initialFacts);
  incompleteFacts[0].situation = 'new-a';
  incompleteFacts[1].situation = 'new-b';

  await assert.rejects(files.coordinator.execute({
    command: command('incomplete-a-b', initial.revision),
    baseFacts: initialFacts,
    transitionReadsSnapshot: false,
    transition: () => ({
      facts: incompleteFacts,
      changedPaths: ['A'],
      result: completeLocalEffects()
    })
  }), (error) => error.code === 'WORLD_REVISION_CONFLICT');

  const committed = (await files.worldRepository.read()).facts;
  assert.deepEqual(committed.map(({ situation }) => situation), ['old', 'old', 'new-c']);
  assert.equal((await files.journalRepository.readState()).receipts.length, 1);
});

test('an incomplete declared patch retains whole-world rollback atomicity', async (t) => {
  const files = await fixture(t);
  const initialFacts = ['A', 'B'].map((thing) => ({ thing, situation: 'old', slot: [], strut: [] }));
  await writeJsonAtomically(files.worldFile, initialFacts);
  const initial = await files.worldRepository.read();
  const changed = structuredClone(initialFacts);
  changed[0].situation = 'new-a';
  changed[1].situation = 'new-b';
  const receipt = await files.coordinator.execute({
    command: command('incomplete-current', initial.revision),
    transition: () => ({ facts: changed, changedPaths: ['A'], result: completeLocalEffects() })
  });

  const history = await files.journalRepository.findCommitted(receipt.commandId);
  assert.equal(history.historyMode, undefined);
  await files.coordinator.rollback({
    targetCommandId: receipt.commandId,
    command: command('rollback-incomplete-current', receipt.afterRevision)
  });
  assert.deepEqual((await files.worldRepository.read()).facts, initialFacts);
});

test('a late candidate without complete closure evidence remains a whole-world conflict', async (t) => {
  const files = await fixture(t);
  const initialFacts = ['A', 'C'].map((thing) => ({ thing, situation: 'old', slot: [], strut: [] }));
  await writeJsonAtomically(files.worldFile, initialFacts);
  const initial = await files.worldRepository.read();
  const firstFacts = structuredClone(initialFacts);
  firstFacts[1].situation = 'new-c';
  await files.coordinator.execute({
    command: command('closure-complete-c', initial.revision),
    transition: () => ({ facts: firstFacts, changedPaths: ['C'], result: completeLocalEffects() })
  });
  const lateFacts = structuredClone(initialFacts);
  lateFacts[0].situation = 'new-a';

  await assert.rejects(files.coordinator.execute({
    command: command('closure-missing-a', initial.revision),
    baseFacts: initialFacts,
    transitionReadsSnapshot: false,
    transition: () => ({ facts: lateFacts, changedPaths: ['A'] })
  }), (error) => error.code === 'WORLD_REVISION_CONFLICT');
  assert.deepEqual((await files.worldRepository.read()).facts, firstFacts);
});

test('a missing closure proof in intervening local history blocks rebase', async (t) => {
  const files = await fixture(t);
  let hideClosureProof = false;
  const journalRepository = Object.freeze({
    findReceipt: (...args) => files.journalRepository.findReceipt(...args),
    findPrepared: (...args) => files.journalRepository.findPrepared(...args),
    findCommitted: (...args) => files.journalRepository.findCommitted(...args),
    prepare: (...args) => files.journalRepository.prepare(...args),
    commit: (...args) => files.journalRepository.commit(...args),
    listPrepared: (...args) => files.journalRepository.listPrepared(...args),
    async readState() {
      const state = await files.journalRepository.readState();
      if (!hideClosureProof) return state;
      for (const entry of state.receipts) {
        if (entry.receipt?.result) delete entry.receipt.result.affectedPathClosureComplete;
      }
      return state;
    }
  });
  const coordinator = createCommitCoordinator({ worldRepository: files.worldRepository, journalRepository });
  const initialFacts = ['A', 'C'].map((thing) => ({ thing, situation: 'old', slot: [], strut: [] }));
  await writeJsonAtomically(files.worldFile, initialFacts);
  const initial = await files.worldRepository.read();
  const firstFacts = structuredClone(initialFacts);
  firstFacts[1].situation = 'new-c';
  await coordinator.execute({
    command: command('history-complete-c', initial.revision),
    transition: () => ({ facts: firstFacts, changedPaths: ['C'], result: completeLocalEffects() })
  });
  hideClosureProof = true;
  const lateFacts = structuredClone(initialFacts);
  lateFacts[0].situation = 'new-a';

  await assert.rejects(coordinator.execute({
    command: command('history-after-missing-a', initial.revision),
    baseFacts: initialFacts,
    transitionReadsSnapshot: false,
    transition: () => ({ facts: lateFacts, changedPaths: ['A'], result: completeLocalEffects() })
  }), (error) => error.code === 'WORLD_REVISION_CONFLICT');
  assert.deepEqual((await files.worldRepository.read()).facts, firstFacts);
});

for (const direction of ['parent lock then child edit', 'child lock then parent edit']) {
  test(`subtree lock overlap rejects ${direction}`, async (t) => {
    const files = await fixture(t);
    const initialFacts = [
      { thing: 'A', situation: 'old', slot: [], strut: [] },
      { thing: 'Guard', situation: 'old', slot: [
        { thing: 'Child', situation: 'old', slot: [], strut: [] }
      ], strut: [] }
    ];
    await writeJsonAtomically(files.worldFile, initialFacts);
    const initial = await files.worldRepository.read();
    const outcomes = await concurrentLocalPair({ coordinator: files.coordinator, initial,
      left(facts) {
        facts[0].situation = 'new-a';
        return {
          facts,
          changedPaths: ['A'],
          result: completeLocalEffects({
            lockPaths: [direction.startsWith('parent') ? 'Guard' : 'Guard/Child']
          })
        };
      },
      right(facts) {
        if (direction.startsWith('parent')) facts[1].slot[0].situation = 'new-child';
        else facts[1].situation = 'new-parent';
        return {
          facts,
          changedPaths: [direction.startsWith('parent') ? 'Guard/Child' : 'Guard'],
          result: completeLocalEffects()
        };
      }
    });
    const rejection = outcomes.find(({ status }) => status === 'rejected')?.reason;
    assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(rejection?.code, 'WORLD_REVISION_CONFLICT');
    assert.ok(rejection?.details?.conflictingPaths?.some((entry) => entry.startsWith('Guard')));
  });
}

for (const guard of ['relationEndpoints', 'shortcutPaths', 'referencePaths']) {
  test(`${guard} retain exact-path granularity across an unrelated descendant edit`, async (t) => {
    const files = await fixture(t);
    const initialFacts = [
      { thing: 'A', situation: 'old', slot: [], strut: [] },
      { thing: 'Guard', situation: 'old', slot: [
        { thing: 'Child', situation: 'old', slot: [], strut: [] }
      ], strut: [] }
    ];
    await writeJsonAtomically(files.worldFile, initialFacts);
    const initial = await files.worldRepository.read();
    const outcomes = await concurrentLocalPair({ coordinator: files.coordinator, initial,
      left(facts) {
        facts[0].situation = 'new-a';
        return {
          facts,
          changedPaths: ['A'],
          result: completeLocalEffects({ [guard]: ['Guard'] })
        };
      },
      right(facts) {
        facts[1].slot[0].situation = 'new-child';
        return {
          facts,
          changedPaths: ['Guard/Child'],
          result: completeLocalEffects()
        };
      }
    });
    assert.equal(outcomes.every(({ status }) => status === 'fulfilled'), true, JSON.stringify(outcomes));
    const committed = (await files.worldRepository.read()).facts;
    assert.equal(committed[0].situation, 'new-a');
    assert.equal(committed[1].slot[0].situation, 'new-child');
  });
}

test('an exact node lock keeps exact-path granularity for a descendant edit', async (t) => {
  const files = await fixture(t);
  const initialFacts = [
    { thing: 'A', situation: 'old', slot: [], strut: [] },
    { thing: 'Guard', situation: 'old', slot: [
      { thing: 'Child', situation: 'old', slot: [], strut: [] }
    ], strut: [] }
  ];
  await writeJsonAtomically(files.worldFile, initialFacts);
  const initial = await files.worldRepository.read();
  const outcomes = await concurrentLocalPair({ coordinator: files.coordinator, initial,
    left(facts) {
      facts[0].situation = 'new-a';
      return {
        facts,
        changedPaths: ['A'],
        result: completeLocalEffects({ lockPaths: [{ path: 'Guard', scope: 'exact' }] })
      };
    },
    right(facts) {
      facts[1].slot[0].situation = 'new-child';
      return {
        facts,
        changedPaths: ['Guard/Child'],
        result: completeLocalEffects()
      };
    }
  });
  assert.equal(outcomes.every(({ status }) => status === 'fulfilled'), true, JSON.stringify(outcomes));
});

test('late persistence commit pairs its old base facts with the old manifest before rebasing', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-late-manifest-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const source = [{ thing: 'Legacy', situation: '', slot: [], strut: [{ verb: 'v', object: 'O' }] }];
  await fs.writeFile(contextFile, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  const persistence = createTransactionalWorldPersistence({
    contextFile,
    projectionFile,
    publishLegacyProjection: false
  });
  const seeded = [...structuredClone(source),
    { thing: 'A', situation: 'old', slot: [], strut: [] },
    { thing: 'C', situation: 'old', slot: [], strut: [] }];
  const sourceManifest = createCompatibilityManifest({
    sourceRevision: 'sha256:legacy',
    targetFacts: source
  });
  await persistence.commit({
    correlationId: 'manifest-seed',
    expectedRevision: revisionOf(source),
    nextRevision: revisionOf(seeded),
    facts: seeded,
    changedPaths: ['A', 'C'],
    affectedPathClosureComplete: true,
    relationEndpoints: [], lockPaths: [], shortcutPaths: [], referencePaths: [],
    compatibilityManifest: advanceCompatibilityManifest(sourceManifest, source, seeded)
  });
  const firstFacts = structuredClone(seeded);
  firstFacts[2].situation = 'new-c';
  await persistence.commit({
    correlationId: 'manifest-first',
    expectedRevision: revisionOf(seeded),
    nextRevision: revisionOf(firstFacts),
    facts: firstFacts,
    beforeFacts: seeded,
    changedPaths: ['C'],
    affectedPathClosureComplete: true,
    relationEndpoints: [], lockPaths: [], shortcutPaths: [], referencePaths: []
  });
  const lateFacts = structuredClone(seeded);
  lateFacts[1].situation = 'new-a';
  const late = await persistence.commit({
    correlationId: 'manifest-late',
    expectedRevision: revisionOf(seeded),
    nextRevision: revisionOf(lateFacts),
    facts: lateFacts,
    beforeFacts: seeded,
    changedPaths: ['A'],
    affectedPathClosureComplete: true,
    relationEndpoints: [], lockPaths: [], shortcutPaths: [], referencePaths: []
  });

  let committed = await persistence.readCommittedSnapshot();
  assert.deepEqual(committed.facts.slice(1).map(({ situation }) => situation), ['new-a', 'new-c']);
  assert.equal(committed.compatibilityManifest.currentWorldRevision, committed.revision);
  assert.doesNotThrow(() => validateCompatibilityManifest(committed.compatibilityManifest, committed.facts));
  await persistence.rollback({
    targetCommandId: late.commandId,
    correlationId: 'manifest-late-rollback',
    expectedRevision: committed.revision
  });
  committed = await persistence.readCommittedSnapshot();
  assert.deepEqual(committed.facts.slice(1).map(({ situation }) => situation), ['old', 'new-c']);
  assert.equal(committed.compatibilityManifest.currentWorldRevision, committed.revision);
  assert.doesNotThrow(() => validateCompatibilityManifest(committed.compatibilityManifest, committed.facts));
});

for (const manifestKind of ['null', 'non-null']) {
  test(`committed inspection resolves a failed journal decision before exposing a ${manifestKind} manifest`, async (t) => {
    const files = await fixture(t);
    const initial = await files.worldRepository.read();
    const nextFacts = [{ thing: 'Root', situation: 'committed', slot: [], strut: [] }];
    const compatibilityManifest = manifestKind === 'non-null'
      ? createCompatibilityManifest({ sourceRevision: initial.revision, targetFacts: nextFacts })
      : null;
    const coordinator = createCommitCoordinator({
      worldRepository: files.worldRepository,
      journalRepository: journalFailingCommits(files.journalRepository, 1)
    });

    await assert.rejects(
      coordinator.execute({
        command: command(`inspection-recovery-${manifestKind}`, initial.revision),
        transition: () => ({
          facts: nextFacts,
          result: compatibilityManifest ? { compatibilityManifest } : {}
        })
      }),
      (error) => error.code === 'EIO'
    );
    assert.deepEqual((await files.journalRepository.readState()).receipts, []);

    const observed = await coordinator.inspectCommitted(async (snapshot) => {
      const state = await files.journalRepository.readState();
      const manifest = state.receipts.at(-1)?.receipt?.result?.compatibilityManifest ?? null;
      if (manifest) validateCompatibilityManifest(manifest, snapshot.facts);
      return { snapshot, manifest, preparedCount: state.prepared.length, receipt: state.receipts.at(-1)?.receipt };
    });

    assert.deepEqual(observed.snapshot.facts, nextFacts);
    assert.equal(observed.snapshot.revision, observed.receipt.afterRevision);
    assert.deepEqual(observed.manifest, compatibilityManifest);
    assert.equal(observed.preparedCount, 0);
  });
}

test('committed inspection rejects when a pending journal decision cannot be recovered', async (t) => {
  const files = await fixture(t);
  const initial = await files.worldRepository.read();
  const coordinator = createCommitCoordinator({
    worldRepository: files.worldRepository,
    journalRepository: journalFailingCommits(files.journalRepository, 2)
  });

  await assert.rejects(
    coordinator.execute({
      command: command('inspection-recovery-rejected', initial.revision),
      transition: ({ facts }) => ({ facts: [...facts, { name: 'uncommitted' }] })
    }),
    (error) => error.code === 'EIO'
  );
  await assert.rejects(
    coordinator.inspectCommitted(() => {
      assert.fail('inspection must not project an unresolved prepared transaction');
    }),
    (error) => error.code === 'EIO'
  );
  const state = await files.journalRepository.readState();
  assert.equal(state.prepared.length, 1);
  assert.equal(state.receipts.length, 0);
});

test('seven completed local commits are visible while three independent calculations remain pending', async (t) => {
  const files = await fixture(t);
  const initialFacts = Array.from({ length: 10 }, (_, index) => ({
    thing: `Item ${index}`, situation: 'old', slot: [], strut: []
  }));
  await writeJsonAtomically(files.worldRepository.file, initialFacts);
  const initial = await files.worldRepository.read();
  const releases = [];
  let entered = 0;
  let allEntered;
  const ready = new Promise((resolve) => { allEntered = resolve; });
  const requests = initialFacts.map((_, index) => files.coordinator.execute({
    command: command(`ten-local-${index}`, initial.revision),
    baseFacts: initialFacts,
    transition: async ({ facts }) => {
      entered += 1;
      if (entered === 10) allEntered();
      await new Promise((resolve) => { releases[index] = resolve; });
      facts[index].situation = 'new';
      return {
        facts,
        changedPaths: [`Item ${index}`],
        result: completeLocalEffects()
      };
    }
  }));
  await ready;
  releases.slice(0, 7).forEach((release) => release());
  await Promise.all(requests.slice(0, 7));

  const partial = await files.coordinator.inspectCommitted();
  assert.deepEqual(partial.facts.map(({ situation }) => situation), [
    'new', 'new', 'new', 'new', 'new', 'new', 'new', 'old', 'old', 'old'
  ]);

  releases.slice(7).forEach((release) => release());
  await Promise.all(requests.slice(7));
});

test('a local commit is durable in the append log before full-world compaction', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-local-append-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const localCommitFile = path.join(directory, 'world-commits.jsonl');
  const beforeFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
  const afterFacts = structuredClone(beforeFacts);
  afterFacts[0].situation = 'new';
  await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
  const repository = createJsonWorldRepository({
    file: worldFile, worldId: 'primary', localCommitFile
  });
  const patch = createLocalWorldPatch({
    worldId: 'primary', beforeRevision: revisionOf(beforeFacts), afterRevision: revisionOf(afterFacts),
    beforeFacts, afterFacts, changedPaths: ['Root']
  });
  await repository.appendLocalCommit({
    commandId: 'bounded-local-record', expectedRevision: revisionOf(beforeFacts),
    nextSnapshot: { worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts }, patch
  });

  assert.deepEqual(JSON.parse(await fs.readFile(worldFile, 'utf8')), beforeFacts,
    'the complete baseline is not rewritten on the local acknowledgment path');
  const restarted = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
  assert.deepEqual((await restarted.read()).facts, afterFacts);
  await fs.appendFile(localCommitFile, '{"partial":', 'utf8');
  const afterTornTail = createJsonWorldRepository({
    file: worldFile, worldId: 'primary', localCommitFile,
    fileSystem: directorySyncCapableFileSystem(directory)
  });
  assert.deepEqual((await afterTornTail.read()).facts, afterFacts,
    'a trailing incomplete record is never published');

  await afterTornTail.compactCommittedState();
  assert.deepEqual(JSON.parse(await fs.readFile(worldFile, 'utf8')), afterFacts);
  const compactedLog = (await fs.readFile(localCommitFile, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(compactedLog, [{
    contract: 'atom.local-commit-watermark',
    version: 1,
    worldId: 'primary',
    revision: revisionOf(afterFacts),
    throughCommandId: 'bounded-local-record',
    throughBeforeRevision: revisionOf(beforeFacts)
  }]);
  const afterCompactionRestart = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
  assert.deepEqual((await afterCompactionRestart.read()).facts, afterFacts);
});

test('local commit visibility waits for log fsync and a failed sync cannot seed the next commit', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-local-fsync-visibility-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const localCommitFile = path.join(directory, 'world-commits.jsonl');
  const beforeFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
  const leakedFacts = [{ thing: 'Root', situation: 'leaked', slot: [], strut: [] }];
  const committedFacts = [{ thing: 'Root', situation: 'committed', slot: [], strut: [] }];
  await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
  let signalWritten;
  let releaseSync;
  const written = new Promise((resolve) => { signalWritten = resolve; });
  const syncGate = new Promise((resolve) => { releaseSync = resolve; });
  let failOnce = true;
  const fileSystem = {
    ...fs,
    async open(target, flags, ...args) {
      const handle = await fs.open(target, flags, ...args);
      if (path.resolve(target) !== path.resolve(localCommitFile)) return handle;
      return {
        truncate: (...truncateArgs) => handle.truncate(...truncateArgs),
        write: async (...writeArgs) => {
          const result = await handle.write(...writeArgs);
          signalWritten();
          return result;
        },
        sync: async () => {
          await syncGate;
          if (failOnce) {
            failOnce = false;
            throw Object.assign(new Error('disk rejected sync'), { code: 'EIO' });
          }
          return handle.sync();
        },
        close: (...closeArgs) => handle.close(...closeArgs)
      };
    }
  };
  const repository = createJsonWorldRepository({
    file: worldFile, worldId: 'primary', localCommitFile, fileSystem
  });
  const patchFor = (afterFacts) => createLocalWorldPatch({
    worldId: 'primary', beforeRevision: revisionOf(beforeFacts), afterRevision: revisionOf(afterFacts),
    beforeFacts, afterFacts, changedPaths: ['Root']
  });
  const interrupted = repository.appendLocalCommit({
    commandId: 'failed-before-fsync', expectedRevision: revisionOf(beforeFacts),
    nextSnapshot: { worldId: 'primary', revision: revisionOf(leakedFacts), facts: leakedFacts },
    patch: patchFor(leakedFacts)
  });
  await written;

  assert.deepEqual((await repository.read()).facts, beforeFacts,
    'a complete line is not committed while its fsync is pending');
  const concurrentReader = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
  assert.deepEqual((await concurrentReader.read()).facts, beforeFacts,
    'all repositories in the process share the same durable publication boundary');
  releaseSync();
  await assert.rejects(interrupted, { code: 'EIO' });
  assert.deepEqual((await repository.read()).facts, beforeFacts,
    'a failed fsync leaves the prior committed view published');

  await repository.appendLocalCommit({
    commandId: 'commit-after-failed-sync', expectedRevision: revisionOf(beforeFacts),
    nextSnapshot: { worldId: 'primary', revision: revisionOf(committedFacts), facts: committedFacts },
    patch: patchFor(committedFacts)
  });
  const restarted = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
  assert.deepEqual((await restarted.read()).facts, committedFacts);
  const records = (await fs.readFile(localCommitFile, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(({ commandId }) => commandId), ['commit-after-failed-sync']);
});

for (const writeFault of ['short-write', 'continuation-failure', 'sync-and-repair-failure']) {
  test(`local append handles ${writeFault} without splitting live and cold committed views`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `atom-local-${writeFault}-`));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const worldFile = path.join(directory, 'atom.json');
    const localCommitFile = path.join(directory, 'world-commits.jsonl');
    const beforeFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
    const afterFacts = [{ thing: 'Root', situation: 'new', slot: [], strut: [] }];
    await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
    let writes = 0;
    let syncFailed = false;
    const fileSystem = {
      ...fs,
      async open(target, flags, ...args) {
        const handle = await fs.open(target, flags, ...args);
        if (path.resolve(target) !== path.resolve(localCommitFile)) return handle;
        return {
          async truncate(length) {
            if (writeFault === 'sync-and-repair-failure' && syncFailed) {
              throw Object.assign(new Error('repair failed'), { code: 'EIO' });
            }
            return handle.truncate(length);
          },
          async write(buffer, offset, length, position) {
            writes += 1;
            const encoded = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, 'utf8');
            const sourceOffset = Buffer.isBuffer(buffer) ? offset : 0;
            const requestedLength = Buffer.isBuffer(buffer) ? length : encoded.length;
            const targetPosition = Buffer.isBuffer(buffer) ? position : offset;
            if (writes === 1 && ['short-write', 'continuation-failure'].includes(writeFault)) {
              const partial = Math.max(1, Math.floor(requestedLength / 2));
              return handle.write(encoded, sourceOffset, partial, targetPosition);
            }
            if (writeFault === 'continuation-failure') {
              throw Object.assign(new Error('continuation failed'), { code: 'EIO' });
            }
            return handle.write(encoded, sourceOffset, requestedLength, targetPosition);
          },
          async sync() {
            if (writeFault === 'sync-and-repair-failure' && !syncFailed) {
              syncFailed = true;
              throw Object.assign(new Error('sync failed'), { code: 'EIO' });
            }
            return handle.sync();
          },
          close: (...args) => handle.close(...args)
        };
      }
    };
    const repository = createJsonWorldRepository({
      file: worldFile, worldId: 'primary', localCommitFile, fileSystem
    });
    const committing = repository.appendLocalCommit({
      commandId: `write-${writeFault}`, expectedRevision: revisionOf(beforeFacts),
      nextSnapshot: { worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts },
      patch: createLocalWorldPatch({
        worldId: 'primary', beforeRevision: revisionOf(beforeFacts), afterRevision: revisionOf(afterFacts),
        beforeFacts, afterFacts, changedPaths: ['Root']
      })
    });
    if (writeFault === 'short-write') await committing;
    else await assert.rejects(committing, { code: 'EIO' });

    const expectedFacts = writeFault === 'short-write' ? afterFacts : beforeFacts;
    assert.deepEqual((await repository.read()).facts, expectedFacts);
    const coldModule = await import(`../src/atom-system/adapters/json-world-repository.mjs?cold=${crypto.randomUUID()}`);
    const cold = coldModule.createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
    assert.deepEqual((await cold.read()).facts, expectedFacts);
    if (writeFault === 'short-write') assert.ok(writes >= 2, 'the unwritten suffix is completed before fsync');
  });
}

test('a torn local-log tail is truncated before the next acknowledged append', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-local-torn-continuation-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const localCommitFile = path.join(directory, 'world-commits.jsonl');
  const initialFacts = [{ thing: 'Root', situation: 'zero', slot: [], strut: [] }];
  const firstFacts = [{ thing: 'Root', situation: 'one', slot: [], strut: [] }];
  const secondFacts = [{ thing: 'Root', situation: 'two', slot: [], strut: [] }];
  await fs.writeFile(worldFile, `${JSON.stringify(initialFacts)}\n`, 'utf8');
  const append = async (repository, commandId, beforeFacts, afterFacts) => repository.appendLocalCommit({
    commandId,
    expectedRevision: revisionOf(beforeFacts),
    nextSnapshot: { worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts },
    patch: createLocalWorldPatch({
      worldId: 'primary', beforeRevision: revisionOf(beforeFacts), afterRevision: revisionOf(afterFacts),
      beforeFacts, afterFacts, changedPaths: ['Root']
    })
  });
  await append(createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile }),
    'torn-first', initialFacts, firstFacts);
  await fs.appendFile(localCommitFile, '{"contract":"atom.local-commit","commandId":"torn-fragment"', 'utf8');
  const recovered = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
  assert.deepEqual((await recovered.read()).facts, firstFacts);
  await append(recovered, 'torn-second', firstFacts, secondFacts);

  const restarted = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
  assert.deepEqual((await restarted.read()).facts, secondFacts);
  const records = (await fs.readFile(localCommitFile, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(({ commandId }) => commandId), ['torn-first', 'torn-second']);
});

test('two repositories sharing one log validate the revision inside their shared append lock', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-shared-repository-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const localCommitFile = path.join(directory, 'world-commits.jsonl');
  const beforeFacts = [
    { thing: 'A', situation: 'old', slot: [], strut: [] },
    { thing: 'B', situation: 'old', slot: [], strut: [] }
  ];
  await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
  const leftFacts = structuredClone(beforeFacts);
  leftFacts[0].situation = 'left';
  const rightFacts = structuredClone(beforeFacts);
  rightFacts[1].situation = 'right';
  let entered = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const faultInjector = async (stage) => {
    if (stage !== 'before-local-append') return;
    entered += 1;
    if (entered === 2) release();
    await Promise.race([gate, new Promise((resolve) => setTimeout(() => {
      release();
      resolve();
    }, 25))]);
  };
  const left = createJsonWorldRepository({
    file: worldFile, worldId: 'primary', localCommitFile, faultInjector
  });
  const right = createJsonWorldRepository({
    file: worldFile, worldId: 'primary', localCommitFile, faultInjector
  });
  const append = (repository, commandId, afterFacts, changedPaths) => repository.appendLocalCommit({
    commandId, expectedRevision: revisionOf(beforeFacts),
    nextSnapshot: { worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts },
    patch: createLocalWorldPatch({
      worldId: 'primary', beforeRevision: revisionOf(beforeFacts), afterRevision: revisionOf(afterFacts),
      beforeFacts, afterFacts, changedPaths
    })
  });

  const outcomes = await Promise.allSettled([
    append(left, 'shared-left', leftFacts, ['A']),
    append(right, 'shared-right', rightFacts, ['B'])
  ]);
  assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(({ status }) => status === 'rejected')?.reason?.code, 'WORLD_REVISION_CONFLICT');
  const records = (await fs.readFile(localCommitFile, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(records.length, 1);
  const cold = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
  await assert.doesNotReject(() => cold.read());
});

test('a local append rejects a next snapshot from another world before writing a record', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-local-invalid-snapshot-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const localCommitFile = path.join(directory, 'world-commits.jsonl');
  const beforeFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
  const afterFacts = [{ thing: 'Root', situation: 'new', slot: [], strut: [] }];
  await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
  const repository = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
  const patch = createLocalWorldPatch({
    worldId: 'primary', beforeRevision: revisionOf(beforeFacts), afterRevision: revisionOf(afterFacts),
    beforeFacts, afterFacts, changedPaths: ['Root']
  });

  await assert.rejects(repository.appendLocalCommit({
    commandId: 'wrong-world', expectedRevision: revisionOf(beforeFacts),
    nextSnapshot: { worldId: 'other', revision: revisionOf(afterFacts), facts: afterFacts }, patch
  }), (error) => error.code === 'INVALID_WORLD_SNAPSHOT');
  await assert.rejects(fs.access(localCommitFile), { code: 'ENOENT' });
  assert.deepEqual((await repository.read()).facts, beforeFacts);
});

test('a read retries when compaction replaces the baseline before its log read', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-local-read-compaction-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const localCommitFile = path.join(directory, 'world-commits.jsonl');
  const beforeFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
  const afterFacts = [{ thing: 'Root', situation: 'new', slot: [], strut: [] }];
  await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
  const writer = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
  const patch = createLocalWorldPatch({
    worldId: 'primary', beforeRevision: revisionOf(beforeFacts), afterRevision: revisionOf(afterFacts),
    beforeFacts, afterFacts, changedPaths: ['Root']
  });
  await writer.appendLocalCommit({
    commandId: 'read-compaction-race', expectedRevision: revisionOf(beforeFacts),
    nextSnapshot: { worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts }, patch
  });
  let releaseLogRead;
  let signalLogRead;
  let paused = false;
  const logReadStarted = new Promise((resolve) => { signalLogRead = resolve; });
  const logReadGate = new Promise((resolve) => { releaseLogRead = resolve; });
  const fileSystem = {
    ...fs,
    async readFile(target, ...args) {
      if (!paused && path.resolve(target) === path.resolve(localCommitFile)) {
        paused = true;
        signalLogRead();
        await logReadGate;
      }
      return fs.readFile(target, ...args);
    }
  };
  const reader = createJsonWorldRepository({
    file: worldFile, worldId: 'primary', localCommitFile, fileSystem
  });

  const reading = reader.read();
  await logReadStarted;
  await writer.compactCommittedState();
  releaseLogRead();

  assert.deepEqual((await reading).facts, afterFacts);
  assert.deepEqual((await reader.read()).facts, afterFacts);
});

test('local record retention schedules compaction only when its configured threshold is reached', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-local-compaction-threshold-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const localCommitFile = path.join(directory, 'world-commits.jsonl');
  const initialFacts = [
    { thing: 'A', situation: 'old', slot: [], strut: [] },
    { thing: 'B', situation: 'old', slot: [], strut: [] }
  ];
  const firstFacts = structuredClone(initialFacts);
  firstFacts[0].situation = 'new-a';
  const secondFacts = structuredClone(firstFacts);
  secondFacts[1].situation = 'new-b';
  await fs.writeFile(worldFile, `${JSON.stringify(initialFacts)}\n`, 'utf8');
  const repository = createJsonWorldRepository({
    file: worldFile, worldId: 'primary', localCommitFile, autoCompact: 2,
    fileSystem: directorySyncCapableFileSystem(directory)
  });
  const append = async (commandId, beforeFacts, afterFacts, changedPaths) => {
    const patch = createLocalWorldPatch({
      worldId: 'primary',
      beforeRevision: revisionOf(beforeFacts),
      afterRevision: revisionOf(afterFacts),
      beforeFacts,
      afterFacts,
      changedPaths
    });
    await repository.appendLocalCommit({
      commandId,
      expectedRevision: revisionOf(beforeFacts),
      nextSnapshot: { worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts },
      patch
    });
  };

  await append('threshold-first', initialFacts, firstFacts, ['A']);
  assert.equal(repository.scheduleCompaction(), null);
  assert.deepEqual(JSON.parse(await fs.readFile(worldFile, 'utf8')), initialFacts);
  await append('threshold-second', firstFacts, secondFacts, ['B']);
  const compaction = repository.scheduleCompaction();
  assert.equal(typeof compaction?.then, 'function');
  await compaction;

  assert.deepEqual(JSON.parse(await fs.readFile(worldFile, 'utf8')), secondFacts);
  const [watermark] = (await fs.readFile(localCommitFile, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(watermark.revision, revisionOf(secondFacts));
  assert.equal(watermark.throughCommandId, 'threshold-second');
});

for (const crashPoint of [
  { stage: 'before-local-append', committed: false },
  { stage: 'after-local-append-sync', committed: true },
  { stage: 'before-memory-publication', committed: true }
]) {
  test(`restart exposes the complete ${crashPoint.committed ? 'new' : 'old'} value after ${crashPoint.stage}`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `atom-local-${crashPoint.stage}-`));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const worldFile = path.join(directory, 'atom.json');
    const localCommitFile = path.join(directory, 'world-commits.jsonl');
    const beforeFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
    const afterFacts = [{ thing: 'Root', situation: 'new', slot: [], strut: [] }];
    await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
    const patch = createLocalWorldPatch({
      worldId: 'primary', beforeRevision: revisionOf(beforeFacts), afterRevision: revisionOf(afterFacts),
      beforeFacts, afterFacts, changedPaths: ['Root']
    });
    const interrupted = createJsonWorldRepository({
      file: worldFile, worldId: 'primary', localCommitFile,
      faultInjector(stage) {
        if (stage === crashPoint.stage) {
          throw Object.assign(new Error('power loss'), { code: 'POWER_LOSS' });
        }
      }
    });

    await assert.rejects(interrupted.appendLocalCommit({
      commandId: `crash-${crashPoint.stage}`, expectedRevision: revisionOf(beforeFacts),
      nextSnapshot: { worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts }, patch
    }), { code: 'POWER_LOSS' });

    const restarted = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
    assert.deepEqual((await restarted.read()).facts, crashPoint.committed ? afterFacts : beforeFacts);
    const completeRecords = await fs.readFile(localCommitFile, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    assert.equal(completeRecords.split('\n').filter(Boolean).length, crashPoint.committed ? 1 : 0);
  });
}

for (const crashPoint of ['during-compaction-write', 'after-compaction-replace']) {
  test(`failed compaction at ${crashPoint} leaves one recoverable committed value`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `atom-local-${crashPoint}-`));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const worldFile = path.join(directory, 'atom.json');
    const localCommitFile = path.join(directory, 'world-commits.jsonl');
    const beforeFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
    const afterFacts = [{ thing: 'Root', situation: 'new', slot: [], strut: [] }];
    await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
    const patch = createLocalWorldPatch({
      worldId: 'primary', beforeRevision: revisionOf(beforeFacts), afterRevision: revisionOf(afterFacts),
      beforeFacts, afterFacts, changedPaths: ['Root']
    });
    const writer = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
    await writer.appendLocalCommit({
      commandId: `compact-${crashPoint}`, expectedRevision: revisionOf(beforeFacts),
      nextSnapshot: { worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts }, patch
    });
    const interrupted = createJsonWorldRepository({
      file: worldFile, worldId: 'primary', localCommitFile,
      faultInjector(stage) {
        if (stage === crashPoint) {
          throw Object.assign(new Error('power loss'), { code: 'POWER_LOSS' });
        }
      }
    });

    await assert.rejects(interrupted.compactCommittedState(), { code: 'POWER_LOSS' });
    const restarted = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
    assert.deepEqual((await restarted.read()).facts, afterFacts);
  });
}

for (const mode of ['local-compaction', 'full-world-fallback']) {
  test(`${mode} syncs and verifies the baseline directory before replacing replayable records`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `atom-durable-order-${mode}-`));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const worldFile = path.join(directory, 'atom.json');
    const localCommitFile = path.join(directory, 'world-commits.jsonl');
    const beforeFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
    const afterFacts = [{ thing: 'Root', situation: 'new', slot: [], strut: [] }];
    await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
    const events = [];
    const fileSystem = {
      ...fs,
      async open(target, flags, ...args) {
        if (path.resolve(target) === path.resolve(directory)) {
          return {
            async sync() { events.push('baseline-directory-sync'); },
            async close() {}
          };
        }
        const handle = await fs.open(target, flags, ...args);
        const baselineTemporary = String(target).startsWith(`${worldFile}.`) && String(target).endsWith('.tmp');
        return {
          writeFile: (...writeArgs) => handle.writeFile(...writeArgs),
          write: (...writeArgs) => handle.write(...writeArgs),
          truncate: (...truncateArgs) => handle.truncate(...truncateArgs),
          sync: async () => {
            if (baselineTemporary) events.push('baseline-temporary-sync');
            return handle.sync();
          },
          close: (...closeArgs) => handle.close(...closeArgs)
        };
      },
      async rename(source, target) {
        if (path.resolve(target) === path.resolve(worldFile)) events.push('baseline-rename');
        if (path.resolve(target) === path.resolve(localCommitFile)) events.push('log-rename');
        return fs.rename(source, target);
      }
    };
    const repository = createJsonWorldRepository({
      file: worldFile, worldId: 'primary', localCommitFile, fileSystem
    });
    if (mode === 'local-compaction') {
      await repository.appendLocalCommit({
        commandId: 'durable-order-local', expectedRevision: revisionOf(beforeFacts),
        nextSnapshot: { worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts },
        patch: createLocalWorldPatch({
          worldId: 'primary', beforeRevision: revisionOf(beforeFacts), afterRevision: revisionOf(afterFacts),
          beforeFacts, afterFacts, changedPaths: ['Root']
        })
      });
      events.length = 0;
      await repository.compactCommittedState();
    } else {
      await repository.compareAndSwap({
        commandId: 'durable-order-full', expectedRevision: revisionOf(beforeFacts),
        nextSnapshot: { worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts }
      });
    }

    assert.ok(events.indexOf('baseline-temporary-sync') >= 0, events.join(', '));
    assert.ok(events.indexOf('baseline-temporary-sync') < events.indexOf('baseline-rename'), events.join(', '));
    assert.ok(events.indexOf('baseline-rename') < events.indexOf('baseline-directory-sync'), events.join(', '));
    assert.ok(events.indexOf('baseline-directory-sync') < events.indexOf('log-rename'), events.join(', '));
    assert.equal(await repository.hasDurableCommit({
      commandId: mode === 'local-compaction' ? 'durable-order-local' : 'durable-order-full',
      beforeRevision: revisionOf(beforeFacts),
      afterRevision: revisionOf(afterFacts)
    }), true, 'the replacement watermark preserves exact recovery identity');
  });
}

for (const mode of ['local-compaction', 'full-world-fallback']) {
  test(`${mode} retains replayable records when baseline directory sync is unavailable`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `atom-durable-fallback-${mode}-`));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const worldFile = path.join(directory, 'atom.json');
    const localCommitFile = path.join(directory, 'world-commits.jsonl');
    const beforeFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
    const afterFacts = [{ thing: 'Root', situation: 'new', slot: [], strut: [] }];
    await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
    const fileSystem = {
      ...fs,
      async open(target, flags, ...args) {
        if (path.resolve(target) === path.resolve(directory)) {
          return {
            async sync() { throw Object.assign(new Error('directory sync unavailable'), { code: 'ENOTSUP' }); },
            async close() {}
          };
        }
        return fs.open(target, flags, ...args);
      }
    };
    const repository = createJsonWorldRepository({
      file: worldFile, worldId: 'primary', localCommitFile, fileSystem
    });
    if (mode === 'local-compaction') {
      await repository.appendLocalCommit({
        commandId: 'fallback-local', expectedRevision: revisionOf(beforeFacts),
        nextSnapshot: { worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts },
        patch: createLocalWorldPatch({
          worldId: 'primary', beforeRevision: revisionOf(beforeFacts), afterRevision: revisionOf(afterFacts),
          beforeFacts, afterFacts, changedPaths: ['Root']
        })
      });
      await repository.compactCommittedState();
    } else {
      await repository.compareAndSwap({
        commandId: 'fallback-full', expectedRevision: revisionOf(beforeFacts),
        nextSnapshot: { worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts }
      });
    }
    const records = (await fs.readFile(localCommitFile, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records.at(-1).contract, 'atom.local-commit');
    assert.equal(records.at(-1).commandId, mode === 'local-compaction' ? 'fallback-local' : 'fallback-full');
    const restarted = createJsonWorldRepository({ file: worldFile, worldId: 'primary', localCommitFile });
    assert.deepEqual((await restarted.read()).facts, afterFacts);
  });
}

test('Windows fallback prunes a proven prior replay generation across repeated thresholds', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-windows-fallback-generations-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const localCommitFile = path.join(directory, 'world-commits.jsonl');
  let failPrune = false;
  const fileSystem = {
    ...fs,
    async open(target, flags, ...args) {
      if (path.resolve(target) === path.resolve(directory)) {
        return {
          async sync() { throw Object.assign(new Error('Windows directory fsync'), { code: 'EPERM' }); },
          async close() {}
        };
      }
      return fs.open(target, flags, ...args);
    },
    async rename(source, target) {
      if (failPrune && path.resolve(target) === path.resolve(localCommitFile)) {
        failPrune = false;
        throw Object.assign(new Error('prune replace failed'), { code: 'EIO' });
      }
      return fs.rename(source, target);
    }
  };
  let facts = [{ thing: 'Root', situation: 'v0', slot: [], strut: [] }];
  await fs.writeFile(worldFile, `${JSON.stringify(facts)}\n`, 'utf8');
  let repositoryModule = { createJsonWorldRepository };
  let repository = repositoryModule.createJsonWorldRepository({
    file: worldFile, worldId: 'primary', localCommitFile, autoCompact: 2, fileSystem
  });
  for (let generation = 1; generation <= 3; generation += 1) {
    const priorBaseline = structuredClone(facts);
    for (let step = 1; step <= 2; step += 1) {
      const next = structuredClone(facts);
      next[0].situation = `v${generation * 2 - 2 + step}`;
      await repository.appendLocalCommit({
        commandId: `fallback-${generation}-${step}`, expectedRevision: revisionOf(facts),
        nextSnapshot: { worldId: 'primary', revision: revisionOf(next), facts: next },
        patch: createLocalWorldPatch({
          worldId: 'primary', beforeRevision: revisionOf(facts), afterRevision: revisionOf(next),
          beforeFacts: facts, afterFacts: next, changedPaths: ['Root']
        })
      });
      facts = next;
    }
    await repository.scheduleCompaction();
    assert.deepEqual(JSON.parse(await fs.readFile(worldFile, 'utf8')), facts);
    const sameRuntimeReader = repositoryModule.createJsonWorldRepository({
      file: worldFile, worldId: 'primary', localCommitFile, fileSystem
    });
    assert.deepEqual((await sameRuntimeReader.read()).facts, facts);
    assert.ok((await fs.readFile(localCommitFile, 'utf8')).trim().split('\n').length > 1,
      'a sibling repository in the writer runtime is not a cold-start durability proof');

    const recoveryWorld = path.join(directory, `old-${generation}.json`);
    const recoveryLog = path.join(directory, `old-${generation}.jsonl`);
    await fs.writeFile(recoveryWorld, `${JSON.stringify(priorBaseline)}\n`, 'utf8');
    await fs.copyFile(localCommitFile, recoveryLog);
    await fs.copyFile(`${localCommitFile}.head.json`, `${recoveryLog}.head.json`).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const oldBaselineRecovery = createJsonWorldRepository({
      file: recoveryWorld, worldId: 'primary', localCommitFile: recoveryLog
    });
    assert.deepEqual((await oldBaselineRecovery.read()).facts, facts,
      'the retained generation remains the only recovery source for an old baseline');

    if (generation === 2) failPrune = true;
    let coldModule = await import(`../src/atom-system/adapters/json-world-repository.mjs?fallback=${crypto.randomUUID()}`);
    let cold = coldModule.createJsonWorldRepository({
      file: worldFile, worldId: 'primary', localCommitFile, autoCompact: 2, fileSystem
    });
    assert.deepEqual((await cold.read()).facts, facts);
    if (generation === 2) {
      assert.ok((await fs.readFile(localCommitFile, 'utf8')).trim().split('\n').length > 1,
        'a failed prune keeps the replay generation');
      coldModule = await import(`../src/atom-system/adapters/json-world-repository.mjs?fallback=${crypto.randomUUID()}`);
      cold = coldModule.createJsonWorldRepository({
        file: worldFile, worldId: 'primary', localCommitFile, autoCompact: 2, fileSystem
      });
      assert.deepEqual((await cold.read()).facts, facts);
    }
    const retained = (await fs.readFile(localCommitFile, 'utf8')).trim().split('\n').filter(Boolean);
    assert.ok(retained.length <= 1, `generation ${generation} retained ${retained.length} records`);
    repositoryModule = coldModule;
    repository = cold;
  }
});

test('hung transition calculation does not block an independent candidate commit', async (t) => {
  const { coordinator, worldRepository } = await fixture(t);
  const initial = await worldRepository.read();
  let releaseHung;
  let notifyHungStarted;
  const hungStarted = new Promise((resolve) => { notifyHungStarted = resolve; });
  const hung = new Promise((resolve) => { releaseHung = resolve; });
  const slow = coordinator.execute({
    command: command('cmd-slow-candidate', initial.revision),
    transition: async ({ facts }) => {
      notifyHungStarted();
      await hung;
      return { facts: [...facts, { name: 'slow' }] };
    }
  });
  await hungStarted;

  const fast = coordinator.execute({
    command: command('cmd-fast-candidate', initial.revision),
    transition: ({ facts }) => ({ facts: [...facts, { name: 'fast' }] })
  });
  const fastReceipt = await Promise.race([
    fast,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('candidate calculation was held behind another transition')),
      150
    ))
  ]);

  assert.equal(fastReceipt.status, 'committed');
  assert.deepEqual((await worldRepository.read()).facts, [{ name: 'fast' }]);
  releaseHung();
  await assert.rejects(slow, (error) => error.code === 'WORLD_REVISION_CONFLICT');
});

test('a repeated command id is idempotent and returns the original receipt', async (t) => {
  const { coordinator, worldRepository, journalRepository } = await fixture(t);
  const initial = await worldRepository.read();
  let transitions = 0;
  const request = {
    command: command('cmd-repeat', initial.revision),
    transition: ({ facts }) => {
      transitions += 1;
      return { facts: [...facts, { name: 'once' }], result: { transitions } };
    }
  };

  const first = await coordinator.execute(request);
  const repeated = await coordinator.execute(request);

  assert.deepEqual(repeated, first);
  assert.equal(transitions, 1);
  assert.equal((await worldRepository.read()).facts.length, 1);
  assert.equal((await journalRepository.readState()).receipts.length, 1);
});

test('a prepared transition can skip cloning unused world and payload inputs', async (t) => {
  const { coordinator, worldRepository } = await fixture(t);
  const initial = await worldRepository.read();
  const nextFacts = [{ name: 'prepared' }];
  let receivedArguments = null;

  await coordinator.execute({
    command: command('cmd-prepared-transition', initial.revision),
    transitionReadsSnapshot: false,
    transition: (...args) => {
      receivedArguments = args;
      return { facts: nextFacts };
    }
  });

  assert.deepEqual(receivedArguments, []);
  assert.deepEqual((await worldRepository.read()).facts, nextFacts);
});

test('a trusted read-only transition reuses the repository snapshot by reference', async (t) => {
  const files = await fixture(t);
  const reads = [];
  let compareSnapshot = null;
  const worldRepository = {
    read: async () => {
      const snapshot = await files.worldRepository.read();
      reads.push(snapshot);
      return snapshot;
    },
    compareAndSwap: (request) => {
      compareSnapshot = request.currentSnapshot;
      return files.worldRepository.compareAndSwap(request);
    }
  };
  const coordinator = createCommitCoordinator({
    worldRepository,
    journalRepository: files.journalRepository
  });
  const initial = await files.worldRepository.read();
  let transitionSnapshot = null;

  await coordinator.execute({
    command: command('cmd-trusted-transition', initial.revision),
    transitionInputMode: 'trusted-readonly',
    transition: (snapshot) => {
      transitionSnapshot = snapshot;
      return { facts: [{ name: 'trusted' }] };
    }
  });

  assert.equal(transitionSnapshot, reads[0]);
  assert.equal(compareSnapshot, reads[1]);
  assert.equal(reads.length, 2);
});

test('transaction history appends compact events and content-addressed snapshots without rewriting legacy history', async (t) => {
  const { coordinator, worldRepository, journalRepository, journalFile } = await fixture(t);
  const initial = await worldRepository.read();
  const first = await coordinator.execute({
    command: command('cmd-first-compact', initial.revision),
    transition: ({ facts }) => ({ facts: [...facts, { name: 'first' }] })
  });
  const eventFile = path.join(`${journalFile}.d`, 'events.jsonl');
  const eventsAfterFirst = await fs.readFile(eventFile, 'utf8');
  await coordinator.execute({
    command: command('cmd-second-compact', first.afterRevision),
    transition: ({ facts }) => ({ facts: [...facts, { name: 'second' }] })
  });

  const history = await journalRepository.readState();
  assert.equal(history.receipts.length, 2);
  const eventsAfterSecond = await fs.readFile(eventFile, 'utf8');
  assert.equal(eventsAfterSecond.startsWith(eventsAfterFirst), true);
  assert.equal(eventsAfterSecond.length - eventsAfterFirst.length < 10_000, true);
  const objects = await fs.readdir(path.join(`${journalFile}.d`, 'objects'));
  assert.equal(objects.length, 3);
  assert.equal(objects.every((name) => name.endsWith('.json.gz')), true);
  await assert.rejects(fs.access(journalFile), { code: 'ENOENT' });
});

test('local transaction records exact patch history without complete-world snapshot objects', async (t) => {
  const { coordinator, worldRepository, journalRepository, journalFile } = await fixture(t);
  const initialFacts = [{ thing: 'Root', situation: '', slot: [
    { thing: 'Target', situation: 'before', slot: [], strut: [] },
    { thing: 'Unrelated', situation: 'unchanged', slot: [], strut: [] }
  ], strut: [] }];
  await writeJsonAtomically(worldRepository.file, initialFacts);
  const initial = await worldRepository.read();
  const nextFacts = structuredClone(initialFacts);
  nextFacts[0].slot[0].situation = 'after';

  const receipt = await coordinator.execute({
    command: command('cmd-local-patch', initial.revision),
    transition: () => ({
      facts: nextFacts,
      changedPaths: ['Root/Target'],
      result: completeLocalEffects({
        affectedAtoms: [{ path: 'Root/Target', axes: ['situation'] }]
      })
    })
  });

  assert.deepEqual(receipt.affectedAtoms, [
    { path: 'Root', axes: [] },
    { path: 'Root/Target', axes: ['situation'] }
  ]);
  const committed = await journalRepository.findCommitted('cmd-local-patch');
  assert.equal(committed.historyMode, 'local-patch');
  assert.equal(committed.before, undefined);
  assert.equal(committed.after, undefined);
  assert.deepEqual(committed.patch.changedPaths, ['Root/Target']);
  assert.deepEqual(committed.inversePatch.changedPaths, ['Root/Target']);
  await assert.rejects(fs.access(path.join(`${journalFile}.d`, 'objects')), { code: 'ENOENT' });
});

test('rollback applies the inverse local patch without restoring an unrelated world snapshot', async (t) => {
  const { coordinator, worldRepository } = await fixture(t);
  const initialFacts = [{ thing: 'Root', situation: '', slot: [
    { thing: 'Target', situation: 'before', slot: [], strut: [] },
    { thing: 'Unrelated', situation: 'keep', slot: [], strut: [] }
  ], strut: [] }];
  await writeJsonAtomically(worldRepository.file, initialFacts);
  const initial = await worldRepository.read();
  const nextFacts = structuredClone(initialFacts);
  nextFacts[0].slot[0].situation = 'after';
  const committed = await coordinator.execute({
    command: command('cmd-local-change', initial.revision),
    transition: () => ({
      facts: nextFacts,
      changedPaths: ['Root/Target'],
      result: {
        affectedAtoms: [{ path: 'Root/Target', axes: ['situation'] }],
        compatibilityManifest: { currentWorldRevision: 'after' },
        previousCompatibilityManifest: { currentWorldRevision: 'before' },
        ...completeLocalEffects()
      }
    })
  });

  const externalFacts = structuredClone((await worldRepository.read()).facts);
  externalFacts[0].slot[1].situation = 'still keep';
  await worldRepository.compactCommittedState();
  await writeJsonAtomically(worldRepository.file, externalFacts);
  const external = await worldRepository.read();
  await assert.rejects(
    coordinator.rollback({
      targetCommandId: 'cmd-local-change',
      command: command('cmd-local-rollback-stale', external.revision)
    }),
    (error) => error.code === 'ROLLBACK_WORLD_DIVERGED'
  );
  assert.equal((await worldRepository.read()).facts[0].slot[1].situation, 'still keep');

  await writeJsonAtomically(worldRepository.file, nextFacts);
  const rolledBack = await coordinator.rollback({
    targetCommandId: 'cmd-local-change',
    command: command('cmd-local-rollback', committed.afterRevision)
  });
  const restored = await worldRepository.read();
  assert.equal(restored.facts[0].slot[0].situation, 'before');
  assert.equal(restored.facts[0].slot[1].situation, 'keep');
  assert.deepEqual(rolledBack.result.compatibilityManifest, { currentWorldRevision: 'before' });
});

test('relation and shortcut side effects share the structural patch and inverse rollback', async (t) => {
  const { coordinator, worldRepository, journalRepository } = await fixture(t);
  const initialFacts = [
    { thing: 'Source', situation: '', slot: [], strut: [
      { 'if@current': true, then: [{ thing: 'Tree/Target' }] }
    ] },
    { thing: 'Tree', situation: '', slot: [
      { thing: 'Target', situation: 'before', slot: [], strut: [] }
    ], strut: [] },
    { 'thing@shortcut': 'Entry', situation: JSON.stringify({
      contract: 'atom.shortcut', version: 1, referenceId: 'local-reference',
      target: { state: 'linked', path: 'Tree/Target' }
    }), slot: [], strut: [] }
  ];
  const nextFacts = structuredClone(initialFacts);
  nextFacts[0].strut[0].then[0].thing = 'Target';
  nextFacts[1].slot[0].thing = 'Renamed';
  const shortcutRecord = JSON.parse(nextFacts[2].situation);
  shortcutRecord.target.path = 'Tree/Renamed';
  nextFacts[2].situation = JSON.stringify(shortcutRecord);
  await writeJsonAtomically(worldRepository.file, initialFacts);
  const initial = await worldRepository.read();

  const committed = await coordinator.execute({
    command: command('cmd-local-relation-shortcut', initial.revision),
    transition: () => ({
      facts: nextFacts,
      changedPaths: ['Tree/Target', 'Tree/Renamed', 'Source', 'Entry'],
      result: completeLocalEffects({
        relationEndpoints: ['Tree/Target', 'Tree/Renamed'],
        shortcutPaths: ['Entry']
      })
    })
  });
  const history = await journalRepository.findCommitted('cmd-local-relation-shortcut');
  assert.deepEqual(history.patch.changedPaths, ['Entry', 'Source', 'Tree/Renamed', 'Tree/Target']);
  assert.equal(history.patch.operations.some((operation) => operation.path === 'Source'), true);
  assert.equal(history.patch.operations.some((operation) => operation.path === 'Entry'), true);

  await coordinator.rollback({
    targetCommandId: committed.commandId,
    command: command('cmd-local-relation-shortcut-rollback', committed.afterRevision)
  });
  assert.deepEqual((await worldRepository.read()).facts, initialFacts);
});

test('incremental history reads legacy receipts without modifying the legacy journal', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-legacy-journal-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const journalFile = path.join(directory, 'transactions.json');
  const before = { contract: 'atom.world-snapshot', version: 1, worldId: 'primary', revision: revisionOf([]), facts: [] };
  const afterFacts = [{ name: 'legacy' }];
  const after = { contract: 'atom.world-snapshot', version: 1, worldId: 'primary', revision: revisionOf(afterFacts), facts: afterFacts };
  const receipt = {
    contract: 'atom.world-receipt', version: 1, commandId: 'legacy-command',
    correlationId: 'legacy-correlation', beforeRevision: before.revision,
    afterRevision: after.revision, status: 'committed', committedAt: new Date(0).toISOString(),
    source: 'legacy', affectedAtoms: [], result: null
  };
  const legacy = {
    schemaVersion: 1, historyMode: 'latest-rollback-snapshot', prepared: [],
    receipts: [{ commandId: 'legacy-command', correlationId: 'legacy-correlation', command: command('legacy-command', before.revision), before, after, receipt }]
  };
  const original = `${JSON.stringify(legacy, null, 2)}\n`;
  await fs.writeFile(journalFile, original, 'utf8');
  const repository = createJsonTransactionJournal({ file: journalFile });

  assert.deepEqual(await repository.findReceipt('legacy-command'), receipt);
  assert.deepEqual((await repository.findCommitted('legacy-command')).before.facts, []);
  assert.equal(await fs.readFile(journalFile, 'utf8'), original);
});

test('atomic JSON replacement retries a transient Windows rename refusal', async () => {
  let renameAttempts = 0;
  const fileSystem = {
    mkdir: async () => {},
    writeFile: async () => {},
    rename: async () => {
      renameAttempts += 1;
      if (renameAttempts < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' });
    },
    rm: async () => {}
  };

  await writeJsonAtomically('C:\\tmp\\world.json', [], {
    fileSystem,
    retryDelaysMs: [0, 0, 0]
  });

  assert.equal(renameAttempts, 3);
});

test('compare-and-swap returns the prepared snapshot without reading and cloning it again', async (t) => {
  const { worldRepository } = await fixture(t);
  const initial = await worldRepository.read();
  const facts = [{ name: 'prepared-once' }];
  const nextSnapshot = Object.freeze({
    contract: 'atom.world-snapshot',
    version: 1,
    worldId: 'primary',
    revision: revisionOf(facts),
    facts
  });

  const committed = await worldRepository.compareAndSwap({
    expectedRevision: initial.revision,
    nextSnapshot
  });

  assert.equal(committed, nextSnapshot);
  assert.deepEqual(JSON.parse(await fs.readFile(worldRepository.file, 'utf8')), facts);
});

test('repository read does not clone facts that JSON parsing already owns', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-world-read-owned-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const facts = [{ marker: 'owned-json-facts', slot: [{ value: 1 }] }];
  await fs.writeFile(worldFile, `${JSON.stringify(facts)}\n`, 'utf8');
  const worldRepository = createJsonWorldRepository({ file: worldFile, worldId: 'primary' });
  const originalStructuredClone = globalThis.structuredClone;
  let completeWorldCloneCount = 0;
  globalThis.structuredClone = (value, options) => {
    if (Array.isArray(value) && value[0]?.marker === 'owned-json-facts') {
      completeWorldCloneCount += 1;
    }
    return originalStructuredClone(value, options);
  };
  t.after(() => { globalThis.structuredClone = originalStructuredClone; });

  const snapshot = await worldRepository.read();

  assert.deepEqual(snapshot.facts, facts);
  assert.equal(completeWorldCloneCount, 0);
});

test('repository reuses one unchanged disk snapshot and invalidates it on external replacement', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-world-read-cache-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  await fs.writeFile(worldFile, `${JSON.stringify([{ marker: 'first' }])}\n`, 'utf8');
  const worldRepository = createJsonWorldRepository({ file: worldFile, worldId: 'primary' });

  const first = await worldRepository.read();
  const reused = await worldRepository.read();
  assert.equal(reused, first);
  assert.equal(Object.isFrozen(first.facts), true);

  await new Promise((resolve) => setTimeout(resolve, 2));
  await fs.writeFile(worldFile, `${JSON.stringify([{ marker: 'second-value' }])}\n`, 'utf8');
  const replaced = await worldRepository.read();

  assert.notEqual(replaced, first);
  assert.equal(replaced.facts[0].marker, 'second-value');
});

test('recovery completes a prepared transaction interrupted before the world write', async (t) => {
  let interrupted = true;
  const files = await fixture(t, {
    faultInjector: async (point) => {
      if (point === 'after-prepare' && interrupted) {
        interrupted = false;
        throw Object.assign(new Error('simulated interruption'), { code: 'SIMULATED_INTERRUPTION' });
      }
    }
  });
  const initial = await files.worldRepository.read();

  await assert.rejects(
    files.coordinator.execute({
      command: command('cmd-recover-before', initial.revision),
      transition: ({ facts }) => ({ facts: [...facts, { name: 'recovered' }], result: {} })
    }),
    (error) => error.code === 'SIMULATED_INTERRUPTION'
  );
  assert.equal((await files.worldRepository.read()).revision, initial.revision);

  const restarted = createCommitCoordinator({
    worldRepository: files.worldRepository,
    journalRepository: files.journalRepository
  });
  assert.deepEqual(await restarted.recover(), { recovered: 1 });
  assert.equal((await files.worldRepository.read()).facts[0].name, 'recovered');
  assert.equal((await files.journalRepository.readState()).prepared.length, 0);
  assert.equal((await files.journalRepository.readState()).receipts.length, 1);
});

test('local patch recovery completes an interrupted prepare without snapshot objects', async (t) => {
  let interrupted = true;
  const files = await fixture(t, {
    faultInjector: async (point) => {
      if (point === 'after-prepare' && interrupted) {
        interrupted = false;
        throw Object.assign(new Error('simulated interruption'), { code: 'SIMULATED_INTERRUPTION' });
      }
    }
  });
  const initialFacts = [{ thing: 'Root', situation: '', slot: [
    { thing: 'Target', situation: 'before', slot: [], strut: [] }
  ], strut: [] }];
  await writeJsonAtomically(files.worldFile, initialFacts);
  const initial = await files.worldRepository.read();
  const nextFacts = structuredClone(initialFacts);
  nextFacts[0].slot[0].situation = 'after';

  await assert.rejects(files.coordinator.execute({
    command: command('cmd-local-recover-before', initial.revision),
    transition: () => ({
      facts: nextFacts,
      changedPaths: ['Root/Target'],
      result: {
        affectedAtoms: [{ path: 'Root/Target', axes: ['situation'] }],
        affectedAtomsComplete: true,
        ...completeLocalEffects()
      }
    })
  }), (error) => error.code === 'SIMULATED_INTERRUPTION');

  const restarted = createCommitCoordinator({
    worldRepository: files.worldRepository,
    journalRepository: files.journalRepository
  });
  assert.deepEqual(await restarted.recover(), { recovered: 1 });
  assert.equal((await files.worldRepository.read()).facts[0].slot[0].situation, 'after');
  const committed = await files.journalRepository.findCommitted('cmd-local-recover-before');
  assert.equal(committed.historyMode, 'local-patch');
  await assert.rejects(fs.access(path.join(`${files.journalFile}.d`, 'objects')), { code: 'ENOENT' });
});

test('a torn transaction event tail is repaired before a durable abort append', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-journal-torn-abort-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const journalFile = path.join(directory, 'transactions.json');
  const repository = createJsonTransactionJournal({ file: journalFile });
  const before = {
    contract: 'atom.world-snapshot', version: 1, worldId: 'primary',
    revision: revisionOf([]), facts: []
  };
  const afterFacts = [{ name: 'prepared' }];
  const after = {
    contract: 'atom.world-snapshot', version: 1, worldId: 'primary',
    revision: revisionOf(afterFacts), facts: afterFacts
  };
  const prepared = {
    commandId: 'torn-abort', correlationId: 'torn-abort',
    command: command('torn-abort', before.revision), before, after,
    receipt: {
      contract: 'atom.world-receipt', version: 1,
      commandId: 'torn-abort', correlationId: 'torn-abort',
      beforeRevision: before.revision, afterRevision: after.revision,
      status: 'committed', committedAt: new Date(0).toISOString(),
      source: 'test', affectedAtoms: [], result: null
    }
  };
  await repository.prepare(prepared);
  await fs.appendFile(repository.eventFile, '{"schemaVersion":2,"type":"committed"', 'utf8');
  const restarted = createJsonTransactionJournal({ file: journalFile });
  assert.equal((await restarted.readState()).prepared.length, 1);
  assert.equal(await restarted.abort('torn-abort', { reason: 'displaced' }), true);

  const cold = createJsonTransactionJournal({ file: journalFile });
  const state = await cold.readState();
  assert.deepEqual(state.prepared, []);
  assert.deepEqual(state.receipts, []);
  assert.deepEqual(await cold.pendingProgramExecutions(), []);
  const events = (await fs.readFile(repository.eventFile, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map(({ type }) => type), ['prepared', 'aborted']);
});

for (const afterState of ['same-after-revision', 'different-after-revision']) {
  test(`an unresolved prepared command owns recovery before a ${afterState} command can commit`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `atom-recovery-identity-${afterState}-`));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const worldFile = path.join(directory, 'atom.json');
    const localCommitFile = path.join(directory, 'world-commits.jsonl');
    const journalFile = path.join(directory, 'transactions.json');
    const beforeFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
    const firstFacts = [{ thing: 'Root', situation: 'first', slot: [], strut: [] }];
    const secondFacts = afterState === 'same-after-revision'
      ? structuredClone(firstFacts)
      : [{ thing: 'Root', situation: 'second', slot: [], strut: [] }];
    await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
    let interruptFirst = true;
    const worldRepository = createJsonWorldRepository({
      file: worldFile, worldId: 'primary', localCommitFile,
      faultInjector(stage, record) {
        if (interruptFirst && stage === 'before-local-append' && record.commandId === 'identity-first') {
          interruptFirst = false;
          throw Object.assign(new Error('interrupted before append'), { code: 'EIO' });
        }
      }
    });
    const journalRepository = createJsonTransactionJournal({ file: journalFile });
    const coordinator = createCommitCoordinator({ worldRepository, journalRepository });
    const execute = (commandId, facts) => coordinator.execute({
      command: command(commandId, revisionOf(beforeFacts)),
      baseFacts: beforeFacts,
      transition: () => ({
        facts,
        changedPaths: ['Root'],
        result: completeLocalEffects({
          postCommitEvent: { binding: commandId, program: `program-${commandId}` }
        })
      })
    });

    await assert.rejects(execute('identity-first', firstFacts), { code: 'EIO' });
    await assert.rejects(execute('identity-second', secondFacts), { code: 'WORLD_REVISION_CONFLICT' });
    assert.deepEqual((await worldRepository.read()).facts, firstFacts);
    assert.deepEqual(await coordinator.recover(), { recovered: 0 });
    const state = await journalRepository.readState();
    assert.deepEqual(state.prepared, []);
    assert.deepEqual(state.receipts.map(({ commandId }) => commandId), ['identity-first']);
    assert.equal((await journalRepository.pendingProgramExecutions()).length, 1,
      'recovery exposes one Program source for the one durable command');
    const records = (await fs.readFile(localCommitFile, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.filter(({ contract }) => contract === 'atom.local-commit')
      .map(({ commandId }) => commandId), ['identity-first']);
  });
}

for (const afterState of ['same-after-revision', 'different-after-revision']) {
  test(`recovery rejects false ownership when another command already wrote a ${afterState}`, async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `atom-recovery-displaced-${afterState}-`));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const worldFile = path.join(directory, 'atom.json');
    const localCommitFile = path.join(directory, 'world-commits.jsonl');
    const journalFile = path.join(directory, 'transactions.json');
    const beforeFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
    const preparedFacts = [{ thing: 'Root', situation: 'prepared', slot: [], strut: [] }];
    const ownerFacts = afterState === 'same-after-revision'
      ? structuredClone(preparedFacts)
      : [{ thing: 'Root', situation: 'owner', slot: [], strut: [] }];
    await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
    let interruptPrepared = true;
    const worldRepository = createJsonWorldRepository({
      file: worldFile, worldId: 'primary', localCommitFile,
      faultInjector(stage, record) {
        if (interruptPrepared && stage === 'before-local-append' && record.commandId === 'displaced-prepared') {
          interruptPrepared = false;
          throw Object.assign(new Error('interrupted before append'), { code: 'EIO' });
        }
      }
    });
    const journalRepository = createJsonTransactionJournal({ file: journalFile });
    const coordinator = createCommitCoordinator({ worldRepository, journalRepository });
    await assert.rejects(coordinator.execute({
      command: command('displaced-prepared', revisionOf(beforeFacts)),
      transition: () => ({ facts: preparedFacts, changedPaths: ['Root'], result: completeLocalEffects({
        postCommitEvent: { binding: 'displaced-prepared', program: 'must-not-run' }
      }) })
    }), { code: 'EIO' });
    await worldRepository.appendLocalCommit({
      commandId: 'durable-owner', expectedRevision: revisionOf(beforeFacts),
      nextSnapshot: { worldId: 'primary', revision: revisionOf(ownerFacts), facts: ownerFacts },
      patch: createLocalWorldPatch({
        worldId: 'primary', beforeRevision: revisionOf(beforeFacts), afterRevision: revisionOf(ownerFacts),
        beforeFacts, afterFacts: ownerFacts, changedPaths: ['Root']
      })
    });

    assert.deepEqual(await coordinator.recover(), { recovered: 1 });
    assert.deepEqual(await coordinator.recover(), { recovered: 0 });
    const state = await journalRepository.readState();
    assert.deepEqual(state.prepared, []);
    assert.deepEqual(state.receipts, []);
    assert.deepEqual(await journalRepository.pendingProgramExecutions(), []);
    assert.deepEqual((await createJsonTransactionJournal({ file: journalFile }).readState()).prepared, [],
      'the durable abort event prevents a cold recovery conflict');
    assert.deepEqual((await worldRepository.read()).facts, ownerFacts);
    const records = (await fs.readFile(localCommitFile, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(records.map(({ commandId }) => commandId), ['durable-owner']);
  });
}

test('durable commit evidence matches exact command identity and revision order', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-durable-command-proof-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const worldFile = path.join(directory, 'atom.json');
  const localCommitFile = path.join(directory, 'world-commits.jsonl');
  const beforeFacts = [{ thing: 'Root', situation: 'old', slot: [], strut: [] }];
  const afterFacts = [{ thing: 'Root', situation: 'new', slot: [], strut: [] }];
  const beforeRevision = revisionOf(beforeFacts);
  const afterRevision = revisionOf(afterFacts);
  await fs.writeFile(worldFile, `${JSON.stringify(beforeFacts)}\n`, 'utf8');
  const repository = createJsonWorldRepository({
    file: worldFile, worldId: 'primary', localCommitFile,
    fileSystem: directorySyncCapableFileSystem(directory)
  });
  await repository.appendLocalCommit({
    commandId: 'proof-owner', expectedRevision: beforeRevision,
    nextSnapshot: { worldId: 'primary', revision: afterRevision, facts: afterFacts },
    patch: createLocalWorldPatch({
      worldId: 'primary', beforeRevision, afterRevision, beforeFacts, afterFacts, changedPaths: ['Root']
    })
  });

  assert.equal(await repository.hasDurableCommit({
    commandId: 'proof-owner', beforeRevision, afterRevision
  }), true);
  assert.equal(await repository.hasDurableCommit({
    commandId: 'same-content-impostor', beforeRevision, afterRevision
  }), false);
  assert.equal(await repository.hasDurableCommit({
    commandId: 'proof-owner', beforeRevision: afterRevision, afterRevision: beforeRevision
  }), false);
  await repository.compactCommittedState();
  assert.equal(JSON.parse(await fs.readFile(localCommitFile, 'utf8')).contract,
    'atom.local-commit-watermark');
  assert.equal(await repository.hasDurableCommit({
    commandId: 'proof-owner', beforeRevision, afterRevision
  }), true, 'the compacted watermark retains exact command and revision ownership');
  assert.equal(await repository.hasDurableCommit({
    commandId: 'same-content-impostor', beforeRevision, afterRevision
  }), false);
});

test('recovery finalizes history interrupted after the world write without applying twice', async (t) => {
  let interrupted = true;
  const files = await fixture(t, {
    faultInjector: async (point) => {
      if (point === 'after-world-write' && interrupted) {
        interrupted = false;
        throw Object.assign(new Error('simulated interruption'), { code: 'SIMULATED_INTERRUPTION' });
      }
    }
  });
  const initial = await files.worldRepository.read();

  await assert.rejects(
    files.coordinator.execute({
      command: command('cmd-recover-after', initial.revision),
      transition: ({ facts }) => ({ facts: [...facts, { name: 'one-write' }], result: {} })
    }),
    (error) => error.code === 'SIMULATED_INTERRUPTION'
  );
  assert.equal((await files.worldRepository.read()).facts.length, 1);

  const restarted = createCommitCoordinator({
    worldRepository: files.worldRepository,
    journalRepository: files.journalRepository
  });
  assert.deepEqual(await restarted.recover(), { recovered: 1 });
  assert.equal((await files.worldRepository.read()).facts.length, 1);
  assert.equal((await files.journalRepository.readState()).receipts.length, 1);
});

test('local patch recovery finalizes an interrupted committed world without applying twice', async (t) => {
  let interrupted = true;
  const files = await fixture(t, {
    faultInjector: async (point) => {
      if (point === 'after-world-write' && interrupted) {
        interrupted = false;
        throw Object.assign(new Error('simulated interruption'), { code: 'SIMULATED_INTERRUPTION' });
      }
    }
  });
  const initialFacts = [{ thing: 'Root', situation: '', slot: [
    { thing: 'Target', situation: 'before', slot: [], strut: [] }
  ], strut: [] }];
  await writeJsonAtomically(files.worldFile, initialFacts);
  const initial = await files.worldRepository.read();
  const nextFacts = structuredClone(initialFacts);
  nextFacts[0].slot[0].situation = 'after';

  await assert.rejects(files.coordinator.execute({
    command: command('cmd-local-recover-after', initial.revision),
    transition: () => ({
      facts: nextFacts,
      changedPaths: ['Root/Target'],
      result: {
        affectedAtoms: [{ path: 'Root/Target', axes: ['situation'] }],
        affectedAtomsComplete: true,
        ...completeLocalEffects()
      }
    })
  }), (error) => error.code === 'SIMULATED_INTERRUPTION');

  const restarted = createCommitCoordinator({
    worldRepository: files.worldRepository,
    journalRepository: files.journalRepository
  });
  assert.deepEqual(await restarted.recover(), { recovered: 1 });
  assert.equal((await files.worldRepository.read()).facts[0].slot[0].situation, 'after');
  assert.equal((await files.journalRepository.readState()).receipts.length, 1);
});

test('invalid or no-change transitions leave world and history untouched', async (t) => {
  const { coordinator, worldRepository, journalRepository } = await fixture(t);
  const initial = await worldRepository.read();

  await assert.rejects(
    coordinator.execute({
      command: command('cmd-invalid', initial.revision),
      transition: () => ({ facts: 'not-an-array' })
    }),
    (error) => error.code === 'INVALID_WORLD_TRANSITION'
  );
  await assert.rejects(
    coordinator.execute({
      command: command('cmd-no-change', initial.revision),
      transition: ({ facts }) => ({ facts })
    }),
    (error) => error.code === 'WORLD_TRANSITION_NO_CHANGE'
  );

  assert.equal((await worldRepository.read()).revision, revisionOf([]));
  assert.deepEqual(await journalRepository.readState(), { prepared: [], receipts: [] });
});

test('rollback restores the exact before snapshot as a new audited commit', async (t) => {
  const { coordinator, worldRepository, journalRepository } = await fixture(t);
  const initial = await worldRepository.read();
  const committed = await coordinator.execute({
    command: command('cmd-change', initial.revision),
    transition: ({ facts }) => ({ facts: [...facts, { name: 'temporary' }], result: {} })
  });

  const rolledBack = await coordinator.rollback({
    targetCommandId: 'cmd-change',
    command: command('cmd-rollback', committed.afterRevision)
  });

  assert.deepEqual((await worldRepository.read()).facts, []);
  assert.equal(rolledBack.beforeRevision, committed.afterRevision);
  assert.equal(rolledBack.afterRevision, initial.revision);
  const history = await journalRepository.readState();
  assert.equal(history.receipts.length, 2);
  assert.equal(history.receipts[1].commandId, 'cmd-rollback');
  assert.equal(history.receipts[1].receipt.result.restoredCommandId, 'cmd-change');
});

test('rollback refuses to erase a later committed world revision', async (t) => {
  const { coordinator, worldRepository } = await fixture(t);
  const initial = await worldRepository.read();
  const first = await coordinator.execute({
    command: command('cmd-first', initial.revision),
    transition: ({ facts }) => ({ facts: [...facts, { name: 'first' }] })
  });
  const second = await coordinator.execute({
    command: command('cmd-second', first.afterRevision),
    transition: ({ facts }) => ({ facts: [...facts, { name: 'second' }] })
  });

  await assert.rejects(
    coordinator.rollback({
      targetCommandId: 'cmd-first',
      command: command('cmd-unsafe-rollback', second.afterRevision)
    }),
    (error) => error.code === 'ROLLBACK_WORLD_DIVERGED'
  );
  assert.deepEqual((await worldRepository.read()).facts.map(({ name }) => name), ['first', 'second']);
});
