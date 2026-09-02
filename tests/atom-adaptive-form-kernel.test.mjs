import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

async function runProgram(source) {
  const scheduler = createProgramRuntimeScheduler();
  return scheduler.refresh([atom('Form内核验收', source, [], 'program')]);
}

test('form evaluates required, unused optional, and disabled subtrees without application defaults', async () => {
  const cycle = await runProgram([
    'result = form({',
    '  "action": "evaluate",',
    '  "components": [',
    '    {"name": "定向", "activation": "required", "value": {"目标": "", "验收": {"条件": []}}, "requirements": [{"path": ["目标"]}, {"path": ["验收", "条件"]}], "components": []},',
    '    {"name": "调研", "activation": "optional", "value": {}, "requirements": [{"path": ["结论"]}], "components": []},',
    '    {"name": "分层", "activation": "disabled", "value": {}, "requirements": [], "components": [',
    '      {"name": "扩大样本", "activation": "required", "value": {}, "requirements": [{"path": ["通过条件"]}], "components": []}',
    '    ]}',
    '  ]',
    '})',
    'missing = ["/".join(item["component"]) + ":" + "/".join(item["path"]) for item in result["missing"]]',
    'message({"level": "info", "text": str(result["valid"]) + "|" + ",".join(result["required"]) + "|" + ",".join(result["optional"]) + "|" + ",".join(result["disabled"]) + "|" + ",".join(result["active"]) + "|" + ",".join(missing)})'
  ].join('\n'));

  assert.equal(cycle.messages[0].text, 'False|定向|调研|分层|定向|定向:目标,定向:验收/条件');
  assert.deepEqual(cycle.transforms, []);
  assert.deepEqual(cycle.locks, []);
});

test('form activates an optional subtree only when its own or descendant value is in use', async () => {
  const cycle = await runProgram([
    'result = form({"action": "evaluate", "components": [',
    '  {"name": "调研", "activation": "optional", "value": {}, "requirements": [], "components": [',
    '    {"name": "结论", "activation": "required", "value": {"草稿": "已形成"}, "requirements": [{"path": ["正式结论"]}], "components": []}',
    '  ]}',
    ']})',
    'item = result["missing"][0]',
    'message({"level": "info", "text": ",".join(result["active"]) + "|" + "/".join(item["component"]) + ":" + "/".join(item["path"])})'
  ].join('\n'));

  assert.equal(cycle.messages[0].text, '调研,调研/结论|调研/结论:正式结论');
  assert.equal(cycle.transforms.length, 0);
});

test('form accepts zero components and one required component without synthesizing workflow stages', async () => {
  const cycle = await runProgram([
    'empty = form({"action": "evaluate", "components": []})',
    'single = form({"action": "evaluate", "components": [',
    '  {"name": "直接操作", "activation": "required", "value": {"结果": "完成"}, "requirements": [{"path": ["结果"]}], "components": []}',
    ']})',
    'compiled = form({"thing": "极简单", "situation": "", "slot": [{"thing": "直接操作"}], "strut": []})',
    'message({"level": "info", "text": str(empty["valid"]) + "|" + ",".join(single["active"]) + "|" + ",".join([child["thing"] for child in compiled["slot"]])})'
  ].join('\n'));

  assert.equal(cycle.messages[0].text, 'True|直接操作|直接操作');
});

test('form rejects missing or unknown component activation instead of choosing for the caller', async () => {
  for (const component of [
    '{"name": "调研", "value": {}, "requirements": [], "components": []}',
    '{"name": "调研", "activation": "auto", "value": {}, "requirements": [], "components": []}'
  ]) {
    await assert.rejects(
      runProgram(`form({"action": "evaluate", "components": [${component}]})`),
      (error) => error?.code === 'ATOM_PROGRAM_FAILED'
        && /activation.*required.*optional.*disabled/i.test(error?.message ?? '')
    );
  }
});

test('form compilation rejects a Program used as a strut consequent fact', async () => {
  await assert.rejects(
    runProgram([
      'form({"thing":"非法推支","situation":"","slot":[],"strut":[',
      '  {"if@current":True,"then":[{"thing@program":"判定"}]}',
      ']})'
    ].join('\n')),
    (error) => error?.code === 'ATOM_PROGRAM_FAILED'
      && /STRUT_FACT_CONSEQUENT_REQUIRED/u.test(error?.message ?? '')
  );
});

test('form compilation does not count an inline decision Program as a fact antecedent in one-to-many strut', async () => {
  const cycle = await runProgram([
    'compiled = form({"thing":"前项","situation":"","slot":[],"strut":[',
    '  {"if@current":True,"if":[{"program":"def main(context):\\n    return True"}],"then":[{"thing":"后项甲"},{"thing":"后项乙"}]}',
    ']})',
    'message({"level":"info","text":str(len(compiled["strut"][0]["then"]))})'
  ].join('\n'));

  assert.equal(cycle.messages[0].text, '2');
});
