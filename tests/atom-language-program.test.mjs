import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { compileProgramTransform } from '../work-engine/atom-language/engine.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import { TRANSFORM_COMMANDS } from '../work-engine/atom-language/transform-key-parser.mjs';
import { executeProgram } from '../work-engine/atom-language/program.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', contain = [], support = [], types = []) {
  const key = `thing${types.map((type) => `@${type}`).join('')}`;
  return { [key]: thing, situation, contain, support };
}

function capability(name, id) {
  return atom(name, id);
}

function legacyPartner(verb, object) {
  return { verb, object };
}

async function fixture(t, atoms) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'atom.graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');
  return { contextFile, projectionFile };
}

async function readAtoms(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function findAtom(atoms, name) {
  const queue = [...atoms];
  while (queue.length) {
    const candidate = queue.shift();
    const nameEntry = Object.entries(candidate).find(([key]) => (
      key === 'thing' || key.startsWith('thing@') || key.startsWith('thing#')
    ));
    if (nameEntry?.[1] === name) return candidate;
    const childrenEntry = Object.entries(candidate).find(([key]) => (
      key === 'contain' || key.startsWith('contain@') || key.startsWith('contain#')
    ));
    queue.push(...(childrenEntry?.[1] ?? []));
  }
  return null;
}

function replaceProgram() {
  return atom('标记完成', [
    'target = explore({"thing":"任务"})[0]',
    'transform({"thing":target.path,"situation.rep.完成":None})'
  ].join('\n'), [], [], ['program']);
}

function legacyDataflowProgram() {
  return atom('标记完成', '', [
    atom('读取任务', '', [], [
      legacyPartner('uses', '能力/读取正文'), legacyPartner('source', '任务')
    ]),
    atom('写入完成', '', [], [
      legacyPartner('uses', '能力/替换正文'), legacyPartner('target', '任务'),
      legacyPartner('value', '参数/完成值')
    ])
  ], [], ['program']);
}

function baseWorld(program = replaceProgram()) {
  return [
    atom('能力', '', [
      capability('读取正文', 'atom.engine/read-situation@1'),
      capability('非空判断', 'atom.engine/guard-non-empty@1'),
      capability('相等判断', 'atom.engine/guard-equals@1'),
      capability('沿关系取 Atom', 'atom.engine/follow-partner@1'),
      capability('替换正文', 'atom.engine/replace-situation@1'),
      capability('新建 child', 'atom.engine/create-child@1')
    ]),
    atom('参数', '', [atom('完成值', '完成')]),
    atom('任务', '待办'),
    program
  ];
}

test('Program adds one exact thing.run. Transform command', () => {
  assert.deepEqual([...TRANSFORM_COMMANDS], [
    'rep', 'sum', 'typ', 'ren', 'mov', 'cpy', 'dsc', 'rst', 'run'
  ]);
  const parsed = createAtomLanguageReceiver().receive(
    'transform {"thing.run.":"标记完成"}'
  );
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.deepEqual(parsed.items[0].fields[0].commands, [
    { name: 'run', parameter: '' }
  ]);
});

test('Program-only full detail replacement keeps dot-command markers opaque', () => {
  const replacement = '{"成果引用":"doc://e2e.rep.segment","说明":"保留 .sum. 文本"}';
  const compiled = compileProgramTransform({
    request: { thing: '任务', 'situation$replace': replacement }
  });

  assert.equal(compiled.ok, true, JSON.stringify(compiled.errors));
  const detail = compiled.item.fields.find((field) => field.baseKey === 'situation');
  assert.equal(detail.valuePresent, false);
  assert.deepEqual(detail.commands, [{ name: 'rep', parameter: replacement }]);
});

test('a valid Program is published immediately but never runs during write', async (t) => {
  const world = baseWorld();
  const program = world.pop();
  const files = await fixture(t, world);
  const validator = createProgramRuntimeScheduler();
  const validationOnlyScheduler = {
    deriveAgentSecurity: validator.deriveAgentSecurity.bind(validator),
    validateProgramSources: validator.validateProgramSources.bind(validator),
    async current() {
      return { messages: [], locks: [], records: [], transforms: [], failures: [] };
    },
    async refresh() {
      return { messages: [], locks: [], records: [], transforms: [], failures: [] };
    },
    createCandidateRuntime() {
      return {
        deriveAgentSecurity: validator.deriveAgentSecurity.bind(validator),
        validateProgramSources: validator.validateProgramSources.bind(validator),
        async refresh() {
          return { messages: [], locks: [], records: [], transforms: [], failures: [] };
        }
      };
    }
  };
  const result = await executeAtomLanguage({
    ...files,
    source: `transform new ${JSON.stringify(program)}`,
    programScheduler: validationOnlyScheduler
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(findAtom(await readAtoms(files.contextFile), '任务').situation, '待办');
  assert.ok(findAtom(await readAtoms(files.contextFile), '标记完成'));
});

test('Program uses the shared access evaluator for reads and writes', async () => {
  const world = baseWorld(legacyDataflowProgram());
  const programName = world.at(-1)['thing@program'];
  const result = await executeProgram({
    atoms: world,
    selector: programName,
    contextFile: 'atom.json',
    authorize: async (_match, operation) => ({
      decision: operation === 'write' ? 'deny' : 'allow'
    })
  });

  assert.equal(result.error.code, 'PROGRAM_ACCESS_DENIED');
});
