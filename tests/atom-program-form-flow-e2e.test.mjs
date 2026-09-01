import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

test('a compiler Program materializes a standard into an idempotent form flow', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-form-flow-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const program = [
    "rows = explore({'thing': '任务流', 'slot$latitude-2': None, 'situation$full': None})",
    "standard = {'forms': [",
    "    {'thing': '定向', 'situation': '明确需求与边界', 'status': '未进入', 'fields': ['需求', '边界']},",
    "    {'thing': '调研', 'situation': '研究高价值素材', 'status': '未进入', 'fields': ['渠道', '结论']}",
    "]}",
    "plan = plan_form_flow(rows, '任务流', standard)",
    "if plan['slot']:",
    "    transform({'thing': '任务流', 'slot': plan['slot']})",
    "    message({'level': 'info', 'text': '已按标准生成表单流'})"
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('任务流'),
    atom('编标程序', program, [], 'program')
  ], null, 2));
  const scheduler = createProgramRuntimeScheduler();

  const first = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(first.ok, true);
  assert.equal(first.changed, true);
  assert.equal(first.messages[0].text, '已按标准生成表单流');

  const afterFirst = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const flow = afterFirst.find((entry) => entry.thing === '任务流');
  assert.deepEqual(flow.slot.map((entry) => entry.thing), ['定向', '调研']);
  assert.deepEqual(flow.slot[0].slot.map((entry) => entry.thing), ['状态', '需求', '边界']);

  const second = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  const afterSecond = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.deepEqual(afterSecond, afterFirst);
});
