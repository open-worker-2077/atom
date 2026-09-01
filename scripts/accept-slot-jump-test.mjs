import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

const worldService = createLegacyWorldService();

function atom(thing, situation = '', slot = [], strut = [], types = []) {
  return {
    [`thing${types.map((type) => `@${type}`).join('')}`]: thing,
    situation,
    slot,
    strut
  };
}

function thingOf(value) {
  return Object.entries(value).find(([key]) => key === 'thing' || key.startsWith('thing@'))?.[1];
}

function find(atoms, selector) {
  let current = null;
  let slot = atoms;
  for (const segment of selector.split('/')) {
    current = slot.find((candidate) => thingOf(candidate) === segment);
    if (!current) return null;
    slot = current.slot ?? [];
  }
  return current;
}

async function fixture(prefix, facts) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(facts, null, 2)}\n`, 'utf8');
  return { directory, contextFile, projectionFile };
}

function run(files, source, scheduler, agentPath, programMode = 'reconcile') {
  return worldService.executeLegacy({
    source,
    contextFile: files.contextFile,
    projectionFile: files.projectionFile,
    ...(programMode ? { programMode } : {}),
    programScheduler: scheduler,
    interaction: { agent: { ref: `agent:${agentPath}`, path: agentPath } }
  });
}

async function acceptSlotBody() {
  const facts = [atom('test', '', [
    atom('槽体跳窗验收', '', [
      atom('总控窗口', '', [], [], ['agent']),
      atom('事项槽体', '', [
        atom('候选流', '', [
          atom('原文', '待填写'),
          atom('结论', '待计算')
        ])
      ]),
      atom('封装', 'slot_body({"action":"seal","body":"test/槽体跳窗验收/事项槽体"})', [], [], ['program']),
      atom('打印', 'use_program({"name":"test/槽体跳窗验收/事项槽体/print","arguments":{"name":"正例001"}})', [], [], ['program'])
    ])
  ])];
  const files = await fixture('atom-slot-jump-slot-', facts);
  try {
    const scheduler = createProgramRuntimeScheduler();
    const agent = 'test/槽体跳窗验收/总控窗口';
    const sealed = await run(files, 'transform {"thing.run.":"test/槽体跳窗验收/封装"}', scheduler, agent);
    if (process.argv.includes('--debug')) process.stderr.write(`sealed=${JSON.stringify(sealed)}\n`);
    assert.equal(sealed.ok, true, JSON.stringify(sealed));
    const printed = await run(files, 'transform {"thing.run.":"test/槽体跳窗验收/打印"}', scheduler, agent);
    if (process.argv.includes('--debug')) process.stderr.write(`printed=${JSON.stringify(printed)}\n`);
    assert.equal(printed.ok, true, JSON.stringify(printed));
    const afterPrint = await fs.readFile(files.contextFile, 'utf8');
    const stored = JSON.parse(afterPrint);
    assert.ok(find(stored, 'test/槽体跳窗验收/事项槽体/槽例/正例001'));

    const duplicate = await run(files, 'transform {"thing.run.":"test/槽体跳窗验收/打印"}', scheduler, agent);
    assert.equal(duplicate.ok, false, JSON.stringify(duplicate));
    assert.ok(duplicate.errors.some((error) => error.code === 'SLOT_BODY_EXAMPLE_EXISTS'));
    assert.equal(await fs.readFile(files.contextFile, 'utf8'), afterPrint);
    return { positive: true, negative: 'SLOT_BODY_EXAMPLE_EXISTS', rollback: true };
  } finally {
    await fs.rm(files.directory, { recursive: true, force: true });
  }
}

async function acceptJump() {
  const facts = [atom('test', '', [
    atom('跳窗验收', '', [
      atom('工单1', '', [atom('执行窗口', '', [], [], ['agent'])]),
      atom('工单2'),
      atom('条件', 'def main(arguments):\n    return True', [], [], ['program']),
      atom('目的地', 'def main(arguments):\n    return explore({"thing":"test/跳窗验收/工单2"})[0]', [], [], ['program']),
      atom('调度', [
        'when_program = explore({"thing":"test/跳窗验收/条件"})[0]',
        'where_program = explore({"thing":"test/跳窗验收/目的地"})[0]',
        'destination = explore({"thing":"test/跳窗验收/工单2"})[0]',
        'jump({',
        '  "when": when_program,',
        '  "where": where_program,',
        '  "lock": {"read":{"allow":[',
        '    {"priority":2,"from":when_program},',
        '    {"priority":2,"from":where_program},',
        '    {"priority":2,"from":destination}',
        '  ]}}',
        '})'
      ].join('\n'), [], [], ['program'])
    ])
  ])];
  const files = await fixture('atom-slot-jump-window-', facts);
  try {
    const scheduler = createProgramRuntimeScheduler();
    const oldAgent = 'test/跳窗验收/工单1/执行窗口';
    const moved = await run(files, 'atom', scheduler, oldAgent);
    if (process.argv.includes('--debug')) {
      process.stderr.write(`moved=${JSON.stringify(moved)}\n`);
      process.stderr.write(`windowSelfLocks=${JSON.stringify([...scheduler.activeWindowSelfLocks])}\n`);
    }
    assert.equal(moved.ok, true, JSON.stringify(moved));
    const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
    assert.equal(find(stored, oldAgent), null);
    const newAgent = 'test/跳窗验收/工单2/执行窗口';
    assert.ok(find(stored, newAgent));

    const denied = await run(
      files,
      'explore {"thing":"test/跳窗验收/工单1","situation$full":true}',
      scheduler,
      newAgent,
      null
    );
    if (process.argv.includes('--debug')) process.stderr.write(`denied=${JSON.stringify(denied)}\n`);
    assert.equal(denied.ok, false, JSON.stringify(denied));
    assert.ok(denied.errors.some((error) => error.code === 'WINDOW_ACCESS_DENIED'));
    return { positive: true, negative: 'WINDOW_ACCESS_DENIED', movedTo: newAgent };
  } finally {
    await fs.rm(files.directory, { recursive: true, force: true });
  }
}

const jumpOnly = process.argv.includes('--jump-only');
const slotOnly = process.argv.includes('--slot-only');
assert.equal(jumpOnly && slotOnly, false, '--jump-only and --slot-only are mutually exclusive');

const slotBody = jumpOnly ? undefined : await acceptSlotBody();
const jump = slotOnly ? undefined : await acceptJump();
process.stdout.write(`${JSON.stringify({ ok: true, ...(slotBody && { slotBody }), ...(jump && { jump }) })}\n`);
