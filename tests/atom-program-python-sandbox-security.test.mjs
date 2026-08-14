import assert from 'node:assert/strict';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(name, detail = '', children = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners: [] };
}

async function rejectsAsSecurityViolation(source) {
  const scheduler = createProgramRuntimeScheduler();
  await assert.rejects(
    scheduler.refresh([atom('Sandbox Program', source, [], 'program')]),
    (error) => error?.code === 'ATOM_PROGRAM_FAILED'
      && error?.details?.type === 'ProgramSecurityError'
  );
}

test('Program sandbox rejects imports before execution', async () => {
  await rejectsAsSecurityViolation('import os');
});

test('Program sandbox rejects dangerous builtin calls before execution', async () => {
  for (const source of [
    "open('secret.txt').read()",
    "globals()['anything'] = 1",
    "eval('1 + 1')",
    "exec('value = 1')",
    "compile('1 + 1', '<program>', 'eval')",
    "__import__('os')",
  ]) {
    await rejectsAsSecurityViolation(source);
  }
});

test('Program sandbox rejects private and dunder attribute traversal before execution', async () => {
  for (const source of [
    'message({\'level\': \'info\', \'text\': str(current_atom()._record)})',
    'message({\'level\': \'info\', \'text\': str(current_atom().__class__)})',
    'message({\'level\': \'info\', \'text\': str((1).__class__.__base__.__subclasses__())})',
    'message({\'level\': \'info\', \'text\': str(plan_shards.__globals__)})',
    'message({\'level\': \'info\', \'text\': str(plan_form_flow.__globals__)})',
    'message({\'level\': \'info\', \'text\': str(plan_template_instance.__globals__)})',
  ]) {
    await rejectsAsSecurityViolation(source);
  }
});

test('Program sandbox preserves ordinary Python control flow and registered world functions', async () => {
  const program = [
    "items = explore({'name': 'Work', 'children$latitude-1': None})",
    'values = []',
    'for item in items:',
    "    if item.name.startswith('Score'):",
    '        values.append(int(item.detail))',
    'total = sum(values)',
    "if total >= 3:",
    "    lock({'targets': {'refs': [current_atom().ref]}, 'mode': 'write'})",
    "    transform({'name': 'Total', f'detail.rep.{total}': None})",
    "    message({'level': 'info', 'text': f'total={total}'})",
  ].join('\n');
  const world = [
    atom('Work', '', [atom('Score A', '1'), atom('Score B', '2')]),
    atom('Total', '0'),
    atom('Safe Program', program, [], 'program'),
  ];

  const result = await createProgramRuntimeScheduler().refresh(world);

  assert.equal(result.locks.length, 1);
  assert.equal(result.transforms.length, 1);
  assert.equal(result.messages[0].text, 'total=3');
});
