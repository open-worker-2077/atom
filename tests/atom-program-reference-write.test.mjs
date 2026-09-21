import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import * as references from '../work-engine/atom-language/program-reference-runtime.mjs';
import { ensureThingIdentities } from '../work-engine/atom-language/slot-graph-semantics.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

const atom = (name, situation = '', slot = [], type = '') => ({
  [`thing${type ? `@${type}` : ''}`]: name, situation, slot, strut: []
});

const roles = [
  ['ref', 'explore({"thing":ref("目标")})', 'explore({"thing":ref("域/目标")})'],
  ['ref', 'def main():\n    pass\ntrigger("transform", {"nodes":[ref("目标")]}, main)', 'def main():\n    pass\ntrigger("transform", {"nodes":[ref("域/目标")]}, main)'],
  ['ref', 'use_program({"name":ref("目标"),"arguments":{}})', 'use_program({"name":ref("域/目标"),"arguments":{}})'],
  ['ref', 'lock({"targets":{"paths":[ref("目标")]}})', 'lock({"targets":{"paths":[ref("域/目标")]}})'],
  ['transform.thing', 'transform({"thing":"目标","situation.rep.完成":None})', 'transform({"thing":"域/目标","situation.rep.完成":None})']
];

test('complete four-axis Transform creation names are not references or rewritten suffixes', async (t) => {
  const source = 'def main():\n    transform({"thing":"New", "situation":"", "slot":[], "strut":[]})\n    transform({"thing@program":"Target", "situation":"pass", "slot":[], "strut":[]})';
  const files = await fixture(t, [atom('Domain', '', [atom('Target')])]);
  const result = await executeAtomLanguage({ ...files, source: `transform new ${JSON.stringify(atom('Creator', source, [], 'program'))}` });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const persisted = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(persisted.find((item) => Object.values(item).includes('Creator')).situation, source);
});

for (const operation of ['mov', 'cpy', 'lnk', 'run']) {
  test(`Transform .${operation}. binds its reference parameter and source selector`, async (t) => {
    const source = `transform({"thing.${operation}.Destination":"Target"})`;
    const [analysis] = await createProgramRuntimeScheduler().validateProgramSources([atom('Program', source, [], 'program')]);
    const normalized = references.normalizeProgramReferences({ source, ...analysis, worldBindings: [
      { path: 'Domain/Target', id: 'target-id' }, { path: 'Domain/Destination', id: 'destination-id' }
    ] });
    assert.equal(normalized.source, `transform({"thing.${operation}.Domain/Destination":"Domain/Target"})`);
    assert.ok(normalized.referenceSites.some((site) => site.role === `transform.${operation}.parameter` && site.targetThingId === 'destination-id'));
    assert.throws(() => references.normalizeProgramReferences({ source, ...analysis,
      worldBindings: [{ path: 'Domain/Target', id: 'target-id' }] }), { code: 'PROGRAM_REFERENCE_NOT_FOUND' });
    const files = await fixture(t, [atom('Domain', '', [atom('Target'), atom('Destination')])]);
    const programSource = `def main():\n    ${source}`;
    const result = await executeAtomLanguage({ ...files,
      source: `transform new ${JSON.stringify(atom('Program', programSource, [], 'program'))}` });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const persisted = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
    assert.equal(persisted.find((item) => Object.values(item).includes('Program')).situation,
      `def main():\n    transform({"thing.${operation}.Domain/Destination":"Domain/Target"})`);
  });
}

test('Transform .ren. keeps the new name as text while binding its source', async () => {
  const source = 'transform({"thing.ren.New":"Target"})';
  const [analysis] = await createProgramRuntimeScheduler().validateProgramSources([atom('Program', source, [], 'program')]);
  const normalized = references.normalizeProgramReferences({ source, ...analysis,
    worldBindings: [{ path: 'Domain/Target', id: 'target-id' }, { path: 'Domain/New', id: 'unrelated-id' }] });
  assert.equal(normalized.source, 'transform({"thing.ren.New":"Domain/Target"})');
  assert.equal(normalized.referenceSites.length, 1);
});

test('Transform .mov.世界之外 preserves the virtual destination and binds only its source Thing', async (t) => {
  const source = 'def main():\n    transform({"thing.mov.世界之外":"Target"})';
  const [analysis] = await createProgramRuntimeScheduler().validateProgramSources([atom('Program', source, [], 'program')]);
  const normalized = references.normalizeProgramReferences({ source, ...analysis,
    worldBindings: [{ path: 'Domain/Target', id: 'target-id' }] });
  assert.equal(normalized.source, 'def main():\n    transform({"thing.mov.世界之外":"Domain/Target"})');
  assert.deepEqual(normalized.referenceSites.map(({ role, targetThingId }) => ({ role, targetThingId })),
    [{ role: 'transform.thing', targetThingId: 'target-id' }]);
  assert.throws(() => references.normalizeProgramReferences({ source, ...analysis, worldBindings: [] }),
    { code: 'PROGRAM_REFERENCE_NOT_FOUND' });
  const files = await fixture(t, [atom('Domain', '', [atom('Target')])]);
  const written = await executeAtomLanguage({ ...files,
    source: `transform new ${JSON.stringify(atom('Program', source, [], 'program'))}` });
  assert.equal(written.ok, true, JSON.stringify(written.errors));
  const persisted = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.equal(persisted.find((item) => Object.values(item).includes('Program')).situation, normalized.source);
});

test('normalization preserves comments and whitespace between concatenated string tokens', async () => {
  const source = 'explore({"thing": ref("Tar" # keep me\r\n    "get")})';
  const [analysis] = await createProgramRuntimeScheduler().validateProgramSources([atom('Program', source, [], 'program')]);
  const normalized = references.normalizeProgramReferences({ source, ...analysis,
    worldBindings: [{ path: 'Domain/Target', id: 'target-id' }] });
  assert.match(normalized.source, / # keep me\r\n    /u);
  const [revalidated] = await createProgramRuntimeScheduler().validateProgramSources([atom('Program', normalized.source, [], 'program')]);
  assert.equal(revalidated.referenceSites[0].selector, 'Domain/Target');
});

test('ordinary dictionary values remain text regardless of effective entries', async () => {
  const source = [
    'explore({"thing":"Missing", "thing":selector})',
    'explore({"thing":"Missing", **unknown})',
    'explore({"thing":"Missing", dynamic_key:selector})',
    'explore({**unknown, "thing":"Target"})',
    'explore({"thing":"Missing", **{"thing":"Target"}})',
    'lock({"targets":{"paths":["Missing"], "paths":dynamic_paths}})'
  ].join('\n');
  const [analysis] = await createProgramRuntimeScheduler().validateProgramSources([atom('Program', source, [], 'program')]);
  assert.deepEqual(analysis.referenceSites.map((site) => site.selector), []);
});

for (const [role, source, expected] of roles) {
  test(`write normalization binds ${role} to exact path and permanent identity`, async () => {
    const world = [atom('域', '', [atom('目标', 'def main(arguments):\n    return arguments', [], 'program')]), atom('程序', source, [], 'program')];
    const validations = await createProgramRuntimeScheduler().validateProgramSources(world);
    assert.equal(typeof references.normalizeProgramReferences, 'function');
    const binding = validations.find((item) => item.path === '程序');
    const result = references.normalizeProgramReferences({ source, ...binding,
      worldBindings: [{ path: '域/目标', id: 'permanent-target-id' }] });
    assert.equal(result.source, expected);
    assert.equal(result.referenceSites[0].targetThingId, 'permanent-target-id');
    assert.equal(result.referenceSites[0].exactPath, '域/目标');
  });
}

test('normalization preserves Unicode, CRLF, quotes, comments and dynamic references', async () => {
  const source = [
    '# explore({"thing":ref("不存在")})',
    'ordinary = {"thing":"不存在"}',
    'text = "Unicode separator: \u2028"',
    'def later():',
    '    text = "字😀"; explore({\'thing\':ref(\'目标\')})',
    '    explore({"thing":ordinary["thing"]})',
    'def local(explore):',
    '    return explore({"thing":"局部文字"})'
  ].join('\r\n');
  const [binding] = await createProgramRuntimeScheduler().validateProgramSources([atom('程序', source, [], 'program')]);
  assert.equal(binding.referenceSites.length, 1);
  const result = references.normalizeProgramReferences({ source, ...binding,
    worldBindings: [{ path: '域/目标', id: 'target-id' }] });
  assert.equal(result.source, source.replace("'目标'", "'域/目标'"));
});

async function fixture(t, world) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-reference-write-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const identifiedWorld = structuredClone(world);
  ensureThingIdentities(identifiedWorld);
  await fs.writeFile(contextFile, JSON.stringify(identifiedWorld));
  return { contextFile, projectionFile: path.join(directory, 'atom.graph.json'), programScheduler: createProgramRuntimeScheduler() };
}

test('creating a Program persists normalized Situation', async (t) => {
  const files = await fixture(t, [atom('域', '', [atom('目标')])]);
  const source = 'def main():\n    return explore({"thing":ref("目标")})';
  const result = await executeAtomLanguage({ ...files, source: `transform new ${JSON.stringify(atom('程序', source, [], 'program'))}` });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const persisted = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  const program = persisted.find((item) => Object.values(item).includes('程序'));
  assert.equal(program.situation, source.replace('"目标"', '"域/目标"'));
});

for (const [label, world] of [
  ['missing', [atom('域')]],
  ['ambiguous', [atom('甲', '', [atom('目标')]), atom('乙', '', [atom('目标')])]]
]) {
  test(`${label} static target rejects the entire Program write`, async (t) => {
    const files = await fixture(t, world);
    const before = await fs.readFile(files.contextFile, 'utf8');
    const source = 'def main():\n    return explore({"thing":ref("目标")})';
    const result = await executeAtomLanguage({ ...files, source: `transform new ${JSON.stringify(atom('程序', source, [], 'program'))}` });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, 'INVALID_PROGRAM_SOURCE');
    assert.equal(result.revisionAfter, result.revisionBefore);
    assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
  });
}

test('write validation returns binding sites from its syntax-validation AST', async () => {
  const source = 'explore({"thing":ref("目标")})';
  const world = [atom('域', '', [atom('目标')]), atom('程序', source, [], 'program')];
  const validated = await createProgramRuntimeScheduler().validateProgramSources(world);
  assert.ok(Array.isArray(validated), 'validation must return changed Program AST binding results');
  assert.equal(validated.length, 1);
  assert.match(validated[0].sourceHash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(validated[0].referenceSites[0].selector, '目标');
  assert.equal(validated[0].referenceSites[0].role, 'ref');
  assert.ok(Number.isInteger(validated[0].referenceSites[0].startByte));
  assert.ok(Number.isInteger(validated[0].referenceSites[0].endByte));
  assert.ok(validated[0].referenceSites[0].astPath);
});

test('validation and reference recognition parse the same Program source once', () => {
  const source = 'explore({"thing":ref("目标")})';
  const worker = fileURLToPath(new URL('../work-engine/atom-language/program-worker.py', import.meta.url));
  const script = [
    'import ast, runpy, sys',
    'original = ast.parse',
    'count = 0',
    'def counted(source, *args, **kwargs):',
    '    global count',
    '    count += 1',
    '    return original(source, *args, **kwargs)',
    'ast.parse = counted',
    'try:',
    '    runpy.run_path(sys.argv[1], run_name="__main__")',
    'finally:',
    '    sys.stderr.write(str(count))'
  ].join('\n');
  const result = spawnSync('python', ['-I', '-X', 'utf8', '-c', script, worker], {
    input: JSON.stringify({ world: [], programs: [], program: { ref: 'program-id', path: '程序', detail: source }, validateOnly: true }) + '\n',
    encoding: 'utf8', windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.referenceSites.length, 1);
  assert.equal(result.stderr, '1');
});

test('frozen source analysis stays immutable and a stale source hash is rejected', async () => {
  const source = 'explore({"thing":ref("目标")})';
  const world = [atom('程序', source, [], 'program')];
  const freeze = (value) => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  freeze(world);
  const [analysis] = await createProgramRuntimeScheduler().validateProgramSources(world);
  freeze(analysis);
  const bindings = freeze([{ path: '域/目标', id: 'target-id' }]);
  assert.equal(references.normalizeProgramReferences({ source, ...analysis, worldBindings: bindings }).source,
    'explore({"thing":ref("域/目标")})');
  assert.equal(world[0].situation, source);
  assert.equal(analysis.referenceSites[0].selector, '目标');
  assert.throws(() => references.normalizeProgramReferences({ source: source + '\n', ...analysis, worldBindings: bindings }),
    { code: 'PROGRAM_REFERENCE_SOURCE_MISMATCH' });
});

test('comprehension target shadowing leaves its outermost iterable in the enclosing scope', async () => {
  const source = 'values = [ref("业务文字") for ref in ref("目标")]';
  const [analysis] = await createProgramRuntimeScheduler().validateProgramSources([atom('程序', source, [], 'program')]);
  assert.deepEqual(analysis.referenceSites.map((site) => site.selector), ['目标']);
});

test('editing a Program normalizes its Situation and invalid edits preserve the prior source and scheduler index', async (t) => {
  const source = 'def main():\n    pass';
  const files = await fixture(t, [atom('域', '', [atom('目标')]), atom('程序', source, [], 'program')]);
  const replacement = 'def main():\n    return explore({"thing":ref("目标")})';
  const result = await executeAtomLanguage({ ...files, source: `transform ${JSON.stringify({ thing: '程序', [`situation.rep.${replacement}`]: source })}` });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const persisted = await fs.readFile(files.contextFile, 'utf8');
  assert.ok(persisted.includes('域/目标'));
  const index = structuredClone([...files.programScheduler.triggerContracts]);
  const invalid = await executeAtomLanguage({ ...files, source: `transform ${JSON.stringify({ thing: '程序', 'situation.rep.explore({"thing":ref("不存在")})': replacement.replace('"目标"', '"域/目标"') })}` });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.revisionAfter, invalid.revisionBefore);
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), persisted);
  assert.deepEqual([...files.programScheduler.triggerContracts], index);
});
