import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
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

async function executeFixtureCli(files, source) {
  let stdout = '';
  let stderr = '';
  const code = await runAtomCli([
    '--context', files.contextFile,
    '--projection', files.projectionFile,
    source
  ], {
    execute: (request) => executeAtomLanguage({
      ...request,
      programScheduler: createProgramRuntimeScheduler()
    }),
    stdin: { isTTY: false },
    stdout: { isTTY: false, write(value) { stdout += value; } },
    stderr: { isTTY: false, write(value) { stderr += value; } }
  });
  return { code, stdout, stderr, bytes: await fs.readFile(files.contextFile, 'utf8') };
}

function slotReceiver(target, label) {
  return [
    'def receive():',
    '    signal()',
    `    transform({"thing":${JSON.stringify(target)},"situation.rep.delivered":None})`,
    `trigger("slot", {"from":"up","labels":[${JSON.stringify(label)}]}, receive)`
  ].join('\n');
}

function structuralSender(effect, label, ordinary) {
  if (!ordinary) return [effect, `slot({"to":"down","labels":[${JSON.stringify(label)}]})`].join('\n');
  return [
    'def send():',
    `    ${effect}`,
    `    slot({"to":"down","labels":[${JSON.stringify(label)}]})`,
    'trigger("transform", {"nodes":["Go"]}, send)'
  ].join('\n');
}

function injectSlotClaimedEffect(scheduler, field, effects) {
  const createCandidateRuntime = scheduler.createCandidateRuntime.bind(scheduler);
  scheduler.createCandidateRuntime = () => {
    const candidate = createCandidateRuntime();
    const refresh = candidate.refresh.bind(candidate);
    candidate.refresh = async (...args) => {
      const cycle = await refresh(...args);
      if ((cycle.slotSignalClaims?.length ?? 0) > 0) {
        cycle[field] = [...(cycle[field] ?? []), ...structuredClone(effects)];
      }
      return cycle;
    };
    return candidate;
  };
}

function observeSlotClaimLifecycle(scheduler) {
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
  return { confirmed, released };
}

function observeSlotInvocations(scheduler) {
  const invocations = [];
  const runProgram = scheduler.runProgram;
  scheduler.runProgram = async (request) => {
    if (request.programArguments?.mode === 'slot') {
      invocations.push({
        programPath: request.program.path,
        signal: structuredClone(request.programArguments)
      });
    }
    return runProgram(request);
  };
  return invocations;
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
    program('Observer', [
      'def observe():',
      '    transform({"thing":"ObservedTarget","situation.rep.observed":None})',
      'trigger("transform", {"nodes":["SenderTarget"]}, observe)'
    ].join('\n')),
    program('StrutObserver', [
      'def observe(delivery):',
      '    transform({"thing":"StrutObserved","situation.rep.observed":None})',
      'trigger("strut", {"nodes":["StrutResult"]}, observe)'
    ].join('\n')),
    {
      ...atom('SenderTarget', 'before'),
      strut: [{ 'if@current': true, then: [{ thing: 'StrutResult' }] }]
    },
    atom('ObservedTarget', 'before'),
    atom('StrutResult', 'before'),
    atom('StrutObserved', 'before'),
    atom('Target', 'before'),
    atom('UnmatchedTarget', 'before'),
    atom('GrandchildTarget', 'before')
  ];
  const files = await fixture(t, world);

  const { result, world: stored, scheduler } = await executeFixture(
    files,
    'transform {"thing.run.":"Parent"}'
  );

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(readSituation(stored, 'SenderTarget'), 'sender');
  assert.equal(readSituation(stored, 'ObservedTarget'), 'observed');
  assert.equal(readSituation(stored, 'StrutObserved'), 'observed');
  assert.equal(readSituation(stored, 'Target'), '交棒');
  assert.equal(readSituation(stored, 'UnmatchedTarget'), 'before');
  assert.equal(readSituation(stored, 'GrandchildTarget'), 'before');
  assert.deepEqual(result.messages.map(({ text }) => text), ['up:交棒']);
  assert.deepEqual(
    [...scheduler.strutDeliveryExecutions.values()].map(({ status }) => status),
    ['confirmed']
  );
  assert.deepEqual(
    [...scheduler.slotSignalExecutions.values()].map(({ status }) => status),
    ['confirmed']
  );
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

test('ordinary Transform and explicit run both deliver after renaming a direct receiver', async (t) => {
  for (const ordinary of [false, true]) {
    await t.test(ordinary ? 'ordinary Transform trigger' : 'explicit run', async (t) => {
      const label = '改名后投递';
      const world = [
        program('Parent', structuralSender(
          'transform({"thing.ren.Receiver Renamed":"Parent/Receiver"})',
          label,
          ordinary
        ), [program('Receiver', slotReceiver('Rename Target', label))]),
        atom('Go', 'before'),
        atom('Rename Target', 'before')
      ];
      const files = await fixture(t, world);
      const { result, world: stored } = await executeFixture(
        files,
        ordinary
          ? 'transform {"thing":"Go","situation.rep.changed"}'
          : 'transform {"thing.run.":"Parent"}'
      );

      assert.equal(result.ok, true, JSON.stringify(result));
      assert.ok(findAtom(stored, 'Parent/Receiver Renamed'));
      assert.equal(readSituation(stored, 'Rename Target'), 'delivered');
    });
  }
});

test('ordinary Transform and explicit run both deliver after moving a receiver beside the sender', async (t) => {
  for (const ordinary of [false, true]) {
    await t.test(ordinary ? 'ordinary Transform trigger' : 'explicit run', async (t) => {
      const label = '移动后投递';
      const sender = structuralSender(
        'transform({"thing.mov.Parent/Sender":"Parent/Receiver"})',
        label,
        ordinary
      );
      const world = [
        program('Parent', '', [
          program('Sender', sender),
          program('Receiver', slotReceiver('Move Target', label))
        ]),
        atom('Go', 'before'),
        atom('Move Target', 'before')
      ];
      const files = await fixture(t, world);
      const { result, world: stored } = await executeFixture(
        files,
        ordinary
          ? 'transform {"thing":"Go","situation.rep.changed"}'
          : 'transform {"thing.run.":"Parent/Sender"}'
      );

      assert.equal(result.ok, true, JSON.stringify(result));
      assert.ok(findAtom(stored, 'Parent/Sender/Receiver'));
      assert.equal(readSituation(stored, 'Move Target'), 'delivered');
    });
  }
});

test('explicit run resolves Slot delivery after relocating the sender or its ancestor', async (t) => {
  const cases = [
    {
      name: 'sender rename',
      effect: 'transform({"thing.ren.Sender Final":"Parent/Sender"})',
      runPath: 'Parent/Sender',
      finalReceiverPath: 'Parent/Sender Final/Receiver'
    },
    {
      name: 'ancestor rename',
      effect: 'transform({"thing.ren.Parent Final":"Parent"})',
      runPath: 'Parent/Sender',
      finalReceiverPath: 'Parent Final/Sender/Receiver'
    }
  ];

  for (const entry of cases) {
    await t.test(entry.name, async (t) => {
      const label = `初始迁移-${entry.name}`;
      const world = [
        atom('Parent', '', [
          program('Sender', [
            entry.effect,
            `slot({"to":"down","labels":[${JSON.stringify(label)}]})`
          ].join('\n'), [
            program('Receiver', slotReceiver('Initial Relocation Target', label))
          ])
        ]),
        atom('Initial Relocation Target', 'before')
      ];
      const files = await fixture(t, world);
      const scheduler = createProgramRuntimeScheduler();
      const lifecycle = observeSlotClaimLifecycle(scheduler);
      const invocations = observeSlotInvocations(scheduler);

      const { result, world: stored } = await executeFixture(
        files,
        `transform {"thing.run.":${JSON.stringify(entry.runPath)}}`,
        scheduler
      );

      assert.equal(result.ok, true, JSON.stringify(result));
      assert.ok(findAtom(stored, entry.finalReceiverPath));
      assert.equal(readSituation(stored, 'Initial Relocation Target'), 'delivered');
      assert.deepEqual(invocations.map(({ programPath }) => programPath), [entry.finalReceiverPath]);
      assert.equal(invocations[0].signal.sourcePath, entry.finalReceiverPath.replace(/\/Receiver$/u, ''));
      assert.equal(invocations[0].signal.recipientPath, entry.finalReceiverPath);
      assert.equal(lifecycle.confirmed.length, 1);
      assert.deepEqual(lifecycle.released, []);
      assert.equal(scheduler.slotSignalExecutions.size, 1);
    });
  }
});

test('queued Slot delivery follows one receiver through chained relocation without capturing its new neighbor', async (t) => {
  const label = '排队迁移';
  const world = [
    program('Parent', structuralSender(
      'transform({"thing":"Relocate","situation.rep.changed":None})',
      label,
      true
    ), [
      program('Receiver', slotReceiver('Relocated Receiver Target', label))
    ]),
    program('Relocator', [
      'def relocate():',
      '    transform({"thing.ren.Receiver Final":"Parent/Receiver"})',
      '    transform({"thing.mov.Destination":"Parent/Receiver Final"})',
      '    transform({"thing.mov.Parent":"Holding Final/Receiver Final"})',
      '    transform({"thing.mov.Parent":"Holding/Receiver"})',
      'trigger("transform", {"nodes":["Relocate"]}, relocate)'
    ].join('\n')),
    atom('Destination'),
    atom('Holding Final', '', [
      program('Receiver Final', slotReceiver('Intermediate Neighbor Target', label))
    ]),
    atom('Holding', '', [
      program('Receiver', slotReceiver('New Neighbor Target', label))
    ]),
    atom('Go', 'before'),
    atom('Relocate', 'before'),
    atom('Relocated Receiver Target', 'before'),
    atom('Intermediate Neighbor Target', 'before'),
    atom('New Neighbor Target', 'before')
  ];
  const files = await fixture(t, world);
  const scheduler = createProgramRuntimeScheduler();
  const lifecycle = observeSlotClaimLifecycle(scheduler);
  const invocations = observeSlotInvocations(scheduler);

  const { result, world: stored } = await executeFixture(
    files,
    'transform {"thing":"Go","situation.rep.changed"}',
    scheduler
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(findAtom(stored, 'Destination/Receiver Final'));
  assert.ok(findAtom(stored, 'Parent/Receiver Final'));
  assert.ok(findAtom(stored, 'Parent/Receiver'));
  assert.equal(readSituation(stored, 'Relocated Receiver Target'), 'delivered');
  assert.equal(readSituation(stored, 'Intermediate Neighbor Target'), 'before');
  assert.equal(readSituation(stored, 'New Neighbor Target'), 'before');
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].programPath, 'Destination/Receiver Final');
  assert.deepEqual(invocations[0].signal, {
    mode: 'slot',
    id: invocations[0].signal.id,
    revision: invocations[0].signal.revision,
    sourcePath: 'Parent',
    recipientPath: 'Destination/Receiver Final',
    from: 'up',
    labels: [label]
  });
  assert.ok(invocations[0].signal.id);
  assert.ok(invocations[0].signal.revision);
  assert.equal(lifecycle.confirmed.length, 1);
  assert.deepEqual(lifecycle.released, []);
  assert.equal(scheduler.slotSignalExecutions.size, 1);
  assert.deepEqual(
    [...scheduler.slotSignalExecutions.values()].map(({ status }) => status),
    ['confirmed']
  );
});

test('queued Slot delivery does not execute a receiver invalidated after relocation', async (t) => {
  const label = '迁移后失效';
  const world = [
    program('Parent', structuralSender(
      'transform({"thing":"Invalidate","situation.rep.changed":None})',
      label,
      true
    ), [
      program('Receiver', slotReceiver('Invalidated Receiver Target', label))
    ]),
    program('Invalidator', [
      'def invalidate():',
      '    transform({"thing.ren.Receiver Invalid":"Parent/Receiver"})',
      '    transform({"thing":"Parent/Receiver Invalid","situation.rep.pass":None})',
      'trigger("transform", {"nodes":["Invalidate"]}, invalidate)'
    ].join('\n')),
    atom('Go', 'before'),
    atom('Invalidate', 'before'),
    atom('Invalidated Receiver Target', 'before')
  ];
  const files = await fixture(t, world);
  const scheduler = createProgramRuntimeScheduler();
  const lifecycle = observeSlotClaimLifecycle(scheduler);
  const invocations = observeSlotInvocations(scheduler);

  const { result, world: stored } = await executeFixture(
    files,
    'transform {"thing":"Go","situation.rep.changed"}',
    scheduler
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(findAtom(stored, 'Parent/Receiver Invalid'));
  assert.equal(readSituation(stored, 'Invalidated Receiver Target'), 'before');
  assert.deepEqual(invocations, []);
  assert.deepEqual(lifecycle.confirmed, []);
  assert.deepEqual(lifecycle.released, []);
  assert.equal(scheduler.slotSignalExecutions.size, 0);
});

test('signal outside Slot invocation blocks an explicit run and returns a nonzero CLI status', async (t) => {
  const world = [program('Invalid Sender', 'signal()'), atom('Untouched', 'before')];
  const directFiles = await fixture(t, world);
  const direct = await executeFixture(directFiles, 'transform {"thing.run.":"Invalid Sender"}');

  assert.equal(direct.result.ok, false, JSON.stringify(direct.result));
  assert.ok(direct.result.errors.some(({ code }) => code === 'SLOT_SIGNAL_REQUIRED'));
  assert.equal(direct.result.revisionAfter, direct.result.revisionBefore);
  assert.equal(direct.bytes, directFiles.before);

  const cliFiles = await fixture(t, world);
  const cli = await executeFixtureCli(
    cliFiles,
    'transform {"thing.run.":"Invalid Sender"}'
  );
  assert.equal(cli.code, 4, cli.stderr);
  assert.match(cli.stderr, /SLOT_SIGNAL_REQUIRED/u);
  assert.equal(cli.bytes, cliFiles.before);
});

test('signal outside Slot invocation blocks and rolls back a Transform-triggered cycle', async (t) => {
  const world = [
    program('Invalid Listener', [
      'def receive():',
      '    signal()',
      'trigger("transform", {"nodes":["Go"]}, receive)'
    ].join('\n')),
    atom('Go', 'before')
  ];
  const files = await fixture(t, world);
  const { result, bytes } = await executeFixture(
    files,
    'transform {"thing":"Go","situation.rep.changed"}'
  );

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.errors.some(({ code }) => code === 'SLOT_SIGNAL_REQUIRED'));
  assert.equal(result.revisionAfter, result.revisionBefore);
  assert.equal(bytes, files.before);
});

test('a referenced Program emits a Slot signal from its own adjacent position', async (t) => {
  const label = '引用投递';
  const world = [
    program('Caller', 'use_program({"name":"Library/Sender","arguments":{}})'),
    atom('Library', '', [
      program('Sender', [
        'def main(arguments):',
        `    slot({"to":"down","labels":[${JSON.stringify(label)}]})`,
        '    return {}'
      ].join('\n'), [
        program('Receiver', slotReceiver('Referenced Target', label))
      ])
    ]),
    atom('Referenced Target', 'before')
  ];
  const files = await fixture(t, world);
  const { result, world: stored } = await executeFixture(
    files,
    'transform {"thing.run.":"Caller"}'
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(readSituation(stored, 'Referenced Target'), 'delivered');
});

test('a later denied receiver Transform rolls back an earlier sender effect and releases its signal claim', async (t) => {
  const receiver = [
    'def receive():',
    '    signal()',
    '    transform({"thing":"Outside","situation.rep.changed":None})',
    'trigger("slot", {"from":"up","labels":["越权"]}, receive)'
  ].join('\n');
  const world = [
    program('Parent', [
      'transform({"thing":"Earlier","situation.rep.changed":None})',
      'slot({"to":"down","labels":["越权"]})'
    ].join('\n'), [
      program('Receiver', receiver)
    ]),
    atom('Earlier', 'before'),
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

test('a Slot receiver jump authorization failure rolls back and leaves its claim retryable', async (t) => {
  const world = [program('Parent', 'slot({"to":"down","labels":["签发失败"]})', [
    program('Receiver', [
      'def receive():',
      '    signal()',
      'trigger("slot", {"from":"up","labels":["签发失败"]}, receive)'
    ].join('\n'))
  ])];
  const files = await fixture(t, world);
  const scheduler = createProgramRuntimeScheduler();
  injectSlotClaimedEffect(scheduler, 'jumpAuthorizations', [
    {
      windowPath: 'MissingWindow',
      sourcePath: 'Parent/Receiver',
      destinationPath: 'MissingDestinationA',
      issuerProgramPath: 'Parent/Receiver'
    },
    {
      windowPath: 'MissingWindow',
      sourcePath: 'Parent/Receiver',
      destinationPath: 'MissingDestinationB',
      issuerProgramPath: 'Parent/Receiver'
    }
  ]);
  const lifecycle = observeSlotClaimLifecycle(scheduler);

  const first = await executeFixture(files, 'transform {"thing.run.":"Parent"}', scheduler);
  assert.equal(first.result.ok, false, JSON.stringify(first.result));
  assert.ok(first.result.errors.some(({ code }) => (
    code === 'WINDOW_JUMP_AUTHORIZATION_CONFLICT'
  )));
  assert.equal(first.result.revisionAfter, first.result.revisionBefore);
  assert.equal(first.bytes, files.before);
  assert.deepEqual(lifecycle.confirmed, []);
  assert.equal(lifecycle.released.length, 1);
  assert.equal(scheduler.slotSignalExecutions.size, 0);

  const second = await executeFixture(files, 'transform {"thing.run.":"Parent"}', scheduler);
  assert.equal(second.result.ok, false, JSON.stringify(second.result));
  assert.equal(second.bytes, files.before);
  assert.equal(lifecycle.released.length, 2);
});

test('a Slot receiver jump failure rolls back and leaves its claim retryable', async (t) => {
  const world = [program('Parent', 'slot({"to":"down","labels":["迁窗失败"]})', [
    program('Receiver', [
      'def receive():',
      '    signal()',
      'trigger("slot", {"from":"up","labels":["迁窗失败"]}, receive)'
    ].join('\n'))
  ])];
  const files = await fixture(t, world);
  const scheduler = createProgramRuntimeScheduler();
  injectSlotClaimedEffect(scheduler, 'jumps', [{
    action: 'move',
    destinationPath: 'MissingDestination',
    sourceProgramPath: 'Parent/Receiver'
  }]);
  const lifecycle = observeSlotClaimLifecycle(scheduler);

  const first = await executeFixture(files, 'transform {"thing.run.":"Parent"}', scheduler);
  assert.equal(first.result.ok, false, JSON.stringify(first.result));
  assert.ok(first.result.errors.some(({ code }) => code === 'WINDOW_JUMP_AGENT_REQUIRED'));
  assert.equal(first.result.revisionAfter, first.result.revisionBefore);
  assert.equal(first.bytes, files.before);
  assert.deepEqual(lifecycle.confirmed, []);
  assert.equal(lifecycle.released.length, 1);
  assert.equal(scheduler.slotSignalExecutions.size, 0);

  const second = await executeFixture(files, 'transform {"thing.run.":"Parent"}', scheduler);
  assert.equal(second.result.ok, false, JSON.stringify(second.result));
  assert.equal(second.bytes, files.before);
  assert.equal(lifecycle.released.length, 2);
});
