import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

function program(thing, situation, slot = []) {
  return atom(thing, situation, slot, 'program');
}

function findAtom(atoms, selector) {
  const parts = selector.split('/');
  let children = atoms;
  let current = null;
  for (const part of parts) {
    current = children.find((entry) => Object.entries(entry).some(([key, value]) => (
      (key === 'thing' || key.startsWith('thing@')) && value === part
    ))) ?? null;
    if (!current) return null;
    children = current.slot ?? [];
  }
  return current;
}

function readSituation(world, selector) {
  return findAtom(world, selector)?.situation ?? null;
}

async function fixture(t, world) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-slot-signal-e2e-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(world, null, 2)}\n`, 'utf8');
  return {
    contextFile,
    projectionFile,
    before: await fs.readFile(contextFile, 'utf8')
  };
}

async function executeFixture(files, source, scheduler = createProgramRuntimeScheduler()) {
  const result = await executeAtomLanguage({
    ...files,
    source,
    programScheduler: scheduler,
    interaction: { id: `slot-signal-${crypto.randomUUID()}` }
  });
  const bytes = await fs.readFile(files.contextFile, 'utf8');
  return { result, bytes, world: JSON.parse(bytes), scheduler };
}

test('down signal triggers only a matching direct child and atomically persists its effect', async (t) => {
  const world = [
    program('Parent', [
      'transform({"thing":"SenderTarget","situation.rep.sender":None})',
      'slot({"to":"down","labels":["交棒"]})'
    ].join('\n'), [
      program('Receiver', [
        'def receive():',
        '    notice = signal()',
        '    message({"level":"info","text":notice["from"] + ":" + ",".join(notice["labels"])})',
        '    transform({"thing":"Target","situation.rep." + notice["labels"][0]:None})',
        'trigger("slot", {"from":"up","labels":["交棒"]}, receive)'
      ].join('\n')),
      program('Unmatched', [
        'def receive():',
        '    transform({"thing":"UnmatchedTarget","situation.rep.ran":None})',
        'trigger("slot", {"from":"up","labels":["别的"]}, receive)'
      ].join('\n')),
      atom('Branch', '', [
        program('Grandchild', [
          'def receive():',
          '    transform({"thing":"GrandchildTarget","situation.rep.ran":None})',
          'trigger("slot", {"from":"up","labels":["交棒"]}, receive)'
        ].join('\n'))
      ])
    ]),
    atom('SenderTarget', 'before'),
    atom('Target', 'before'),
    atom('UnmatchedTarget', 'before'),
    atom('GrandchildTarget', 'before')
  ];
  const files = await fixture(t, world);

  const { result, world: stored } = await executeFixture(
    files,
    'transform {"thing.run.":"Parent"}'
  );

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(readSituation(stored, 'SenderTarget'), 'sender');
  assert.equal(readSituation(stored, 'Target'), '交棒');
  assert.equal(readSituation(stored, 'UnmatchedTarget'), 'before');
  assert.equal(readSituation(stored, 'GrandchildTarget'), 'before');
  assert.deepEqual(result.messages.map(({ text }) => text), ['up:交棒']);
});

test('up signal triggers only the matching direct parent and persists the receiver effect', async (t) => {
  const parentReceiver = [
    'def receive():',
    '    notice = signal()',
    '    transform({"thing":"Target","situation.rep." + notice["from"] + ":" + notice["labels"][0]:None})',
    'trigger("slot", {"from":"down","labels":["回报"]}, receive)'
  ].join('\n');
  const world = [
    program('Root', [
      'def receive():',
      '    transform({"thing":"RootTarget","situation.rep.ran":None})',
      'trigger("slot", {"from":"down","labels":["回报"]}, receive)'
    ].join('\n'), [
      program('Parent', parentReceiver, [
        program('Sender', 'slot({"to":"up","labels":["回报"]})'),
        program('Sibling', [
          'def receive():',
          '    transform({"thing":"SiblingTarget","situation.rep.ran":None})',
          'trigger("slot", {"from":"down","labels":["回报"]}, receive)'
        ].join('\n'))
      ])
    ]),
    atom('Target', 'before'),
    atom('RootTarget', 'before'),
    atom('SiblingTarget', 'before')
  ];
  const files = await fixture(t, world);

  const { result, world: stored } = await executeFixture(
    files,
    'transform {"thing.run.":"Root/Parent/Sender"}'
  );

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(readSituation(stored, 'Target'), 'down:回报');
  assert.equal(readSituation(stored, 'RootTarget'), 'before');
  assert.equal(readSituation(stored, 'SiblingTarget'), 'before');
});

test('signal-only delivery returns the original world bytes and revision', async (t) => {
  const world = [program('Parent', 'slot({"to":"down","labels":["通知"]})', [
    program('Receiver', [
      'def receive():',
      '    notice = signal()',
      '    message({"level":"info","text":notice["from"] + ":" + ",".join(notice["labels"])})',
      'trigger("slot", {"from":"up","labels":["通知"]}, receive)'
    ].join('\n'))
  ])];
  const files = await fixture(t, world);

  const { result, bytes } = await executeFixture(
    files,
    'transform {"thing.run.":"Parent"}'
  );

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.changed, false);
  assert.equal(result.revisionAfter, result.revisionBefore);
  assert.equal(bytes, files.before);
  assert.deepEqual(result.messages.map(({ text }) => text), ['up:通知']);
});

test('a denied receiver Transform rolls back the interaction and releases its signal claim', async (t) => {
  const receiver = [
    'def receive():',
    '    signal()',
    '    transform({"thing":"Outside","situation.rep.changed":None})',
    'trigger("slot", {"from":"up","labels":["越权"]}, receive)'
  ].join('\n');
  const world = [
    program('Parent', 'slot({"to":"down","labels":["越权"]})', [
      program('Receiver', receiver)
    ]),
    atom('Outside', 'before'),
    program('Guard', [
      'lock({"targets":{"paths":["Outside"],"scope":"exact"},',
      '      "actions":["transform"],"labels":["protected"]})'
    ].join('\n'))
  ];
  const files = await fixture(t, world);
  const scheduler = createProgramRuntimeScheduler();
  const runProgram = scheduler.runProgram;
  let receiverCalls = 0;
  scheduler.runProgram = async (request) => {
    if (request.program.path === 'Parent/Receiver'
      && request.programArguments?.mode === 'slot') receiverCalls += 1;
    return runProgram(request);
  };
  const confirmed = [];
  const released = [];
  const confirmSlotSignals = scheduler.confirmSlotSignals.bind(scheduler);
  const releaseSlotSignals = scheduler.releaseSlotSignals.bind(scheduler);
  scheduler.confirmSlotSignals = (keys) => {
    confirmed.push(...keys);
    return confirmSlotSignals(keys);
  };
  scheduler.releaseSlotSignals = (keys) => {
    released.push(...keys);
    return releaseSlotSignals(keys);
  };

  const first = await executeFixture(
    files,
    'transform {"thing.run.":"Parent"}',
    scheduler
  );
  assert.equal(first.result.ok, false, JSON.stringify(first.result));
  assert.ok(first.result.errors.some(({ code }) => code === 'GRAPH_LOCK_DENIED'));
  assert.equal(first.result.revisionAfter, first.result.revisionBefore);
  assert.equal(first.bytes, files.before);
  assert.deepEqual(confirmed, []);
  assert.equal(released.length, 1);
  assert.equal(scheduler.slotSignalExecutions.size, 0);

  const second = await executeFixture(
    files,
    'transform {"thing.run.":"Parent"}',
    scheduler
  );
  assert.equal(second.result.ok, false, JSON.stringify(second.result));
  assert.equal(second.bytes, files.before);
  assert.equal(receiverCalls, 2);
});
