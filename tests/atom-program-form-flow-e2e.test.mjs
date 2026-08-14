import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(name, detail = '', children = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners: [] };
}

test('a compiler Program materializes a standard into an idempotent form flow', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-form-flow-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const program = [
    "rows = explore({'name': '任务流', 'children$latitude-2': None, 'detail$full': None})",
    "standard = {'forms': [",
    "    {'name': '定向', 'detail': '明确需求与边界', 'status': '未进入', 'fields': ['需求', '边界']},",
    "    {'name': '调研', 'detail': '研究高价值素材', 'status': '未进入', 'fields': ['渠道', '结论']}",
    "]}",
    "plan = plan_form_flow(rows, '任务流', standard)",
    "if plan['children']:",
    "    transform({'name': '任务流', 'children': plan['children']})",
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
  const flow = afterFirst.find((entry) => entry.name === '任务流');
  assert.deepEqual(flow.children.map((entry) => entry.name), ['定向', '调研']);
  assert.deepEqual(flow.children[0].children.map((entry) => entry.name), ['状态', '需求', '边界']);

  const second = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler
  });
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  const afterSecond = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.deepEqual(afterSecond, afterFirst);
});
