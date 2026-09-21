import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as refs from '../work-engine/atom-language/program-reference-runtime.mjs';

const inspect = (source) => refs.inspectProgramReferenceSites({ source });
const bindingSet = (source, sites, target = () => 'target') => ({
  sourceHash: `sha256:${createHash('sha256').update(source).digest('hex')}`,
  sites: sites.map(s => ({ fingerprint: s.fingerprint, role: s.role, targetThingId: target(s) }))
});
const worker = fileURLToPath(new URL('../work-engine/atom-language/program-worker.py', import.meta.url));
function run(source, extra = {}) {
  const result = spawnSync('python', ['-I', '-X', 'utf8', worker], {
    input: JSON.stringify({ world: [], program: { ref: 'program', path: 'Program', detail: source }, ...extra }) + '\n',
    encoding: 'utf8', windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('only explicit 引述 markers bind ordinary consumer arguments', async () => {
  const source = [
    'message({"text":"World/Target"})',
    'explore({"thing":"World/Target"})',
    'use_program({"name":"World/Target", "arguments":{}})',
    'lock({"targets":{"paths":["World/Target"]}})',
    'trigger("transform", {"nodes":["World/Target"]}, main)',
    'explore({"thing":ref("World/Target")})'
  ].join('\n');
  assert.deepEqual((await inspect(source)).sites.map(s => [s.kind, s.role, s.selector]),
    [['ref', 'ref', 'World/Target']]);
});

test('dynamic, malformed, aliased and forged ref calls never bind', async () => {
  for (const source of [
    'ref(name)', 'ref("A", "B")', 'ref(path="A")', 'ref("A" + "B")',
    'ref(f"A")', 'alias = ref\nalias("A")', 'obj.ref("A")',
    'def ref(value):\n    return value\nref("A")',
    'ref = other\nref("A")', 'import fake as ref\nref("A")',
    'from fake import ref\nref("A")', 'from fake import *\nref("A")',
    'value = lambda ref: ref("A")',
    'def local(ref):\n    return ref("A")',
    'def local():\n    ref("A")\n    ref = other',
    '# ref("A")\ntext = \'ref("A")\''
  ]) assert.deepEqual((await inspect(source)).sites, [], source);
});

test('UTF-8 ranges and adjacent literal tokens preserve comments and independent lexical scopes', async () => {
  const source = 'text = "字😀"; ref("Tar" # 保留\r\n  "get")\r\nvalues = [ref("local") for ref in ref("Items")]';
  const { sites } = await inspect(source);
  assert.deepEqual(sites.map(s => s.selector), ['Target', 'Items']);
  assert.equal(Buffer.from(source).subarray(sites[0].startByte, sites[0].endByte).toString(), '"Tar" # 保留\r\n  "get"');
  assert.equal(sites[0].literalTokens.length, 2);
});

test('command path roles remain typed while creation and rename names remain text', async () => {
  const source = [
    'transform({"thing":"New", "situation":"", "slot":[], "strut":[]})',
    'transform({"thing.ren.New":"Target"})',
    ...['mov', 'cpy', 'lnk', 'run'].map(op => `transform({"thing.${op}.Destination":"Target"})`),
    'transform({"thing.dsc.":"Target"})', 'transform({"thing.rst.":"Target"})'
  ].join('\n');
  const { sites } = await inspect(source);
  assert.equal(sites.length, 11);
  assert.ok(sites.every(s => s.kind === 'command'));
  assert.deepEqual(sites.filter(s => s.role.endsWith('.parameter')).map(s => s.role),
    ['transform.mov.parameter', 'transform.cpy.parameter', 'transform.lnk.parameter', 'transform.run.parameter']);
});

test('execution projection uses bound identity, preserves Situation and needs no function grant', async () => {
  const source = 'message({"text":ref("World/Old")}) # keep ref("World/Old")';
  const { sites } = await inspect(source);
  assert.equal(typeof refs.compileProgramRefs, 'function');
  const bindings = bindingSet(source, sites, () => 'original-id');
  const compiled = await refs.compileProgramRefs({ source, bindings,
    pathByThingId: new Map([['original-id', 'World/New'], ['replacement-id', 'World/Old']]) });
  const result = run(compiled.source, { allowedFunctions: ['message'] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.messages[0].text, 'World/New');
  assert.equal(source, 'message({"text":ref("World/Old")}) # keep ref("World/Old")');
  assert.ok(compiled.source.endsWith('# keep ref("World/Old")'));
  assert.ok(!JSON.stringify(result).includes('original-id'));
});

test('missing bindings fail closed even when a matching path exists', async () => {
  assert.equal(typeof refs.compileProgramRefs, 'function');
  await assert.rejects(refs.compileProgramRefs({ source: 'ref("World/Old")',
    pathByThingId: new Map([['new-id', 'World/Old']]) }), { code: 'PROGRAM_REF_BINDING_MISSING' });
  assert.equal(run('ref("World/Old")').error.code, 'PROGRAM_REF_BINDING_MISSING');
});

test('static validation accepts ref without authorizing it as a function', () => {
  const result = run('def main():\n    return ref("World/Target")', { validateOnly: true, allowedFunctions: [] });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.referenceSites[0].kind, 'ref');
});

test('execution uses the same identity projection for nested Program invocations', async () => {
  const detail = 'def main(arguments):\n    return ref("World/Old")';
  const { sites } = await inspect(detail);
  const child = { ref: 'child', path: 'Child', name: 'Child', types: ['program'], detail,
    refBindings: bindingSet(detail, sites) };
  const result = run('message({"text": use_program({"name":"Child", "arguments":{}})})', {
    world: [child], pathByThingId: { target: 'World/New' }, allowedFunctions: ['message', 'use_program']
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.messages[0].text, 'World/New');
  assert.equal(child.detail, detail);
});

test('command projection changes every bound path while preserving operation names and concatenation comments', async () => {
  const source = 'transform({"thing.mov." # destination\r\n "OldDestination":"OldTarget"})';
  const { sites } = await inspect(source);
  const bindings = bindingSet(source, sites, s => s.selector === 'OldDestination' ? 'destination' : 'target');
  const result = await refs.compileProgramRefs({ source, bindings,
    pathByThingId: { destination: 'World/NewDestination', target: 'World/NewTarget' } });
  assert.equal(result.source, 'transform({"thing.mov.World/NewDestination" # destination\r\n "":"World/NewTarget"})');
});

test('missing target identity and stale source analysis never fall back to readable names', async () => {
  const source = 'ref("World/Target")';
  const { sites, sourceHash } = await inspect(source);
  const bindings = bindingSet(source, sites, () => 'missing');
  await assert.rejects(refs.compileProgramRefs({ source, bindings, pathByThingId: { other: 'World/Target' } }),
    { code: 'PROGRAM_REF_TARGET_MISSING' });
  await assert.rejects(refs.compileProgramRefs({ source: source + '\n', bindings, sourceHash, referenceSites: sites,
    pathByThingId: { missing: 'World/Target' } }), { code: 'PROGRAM_REF_SOURCE_MISMATCH' });
});

test('parenthesized marker names compile without corrupting their surrounding syntax', async () => {
  const source = 'message({"text": ((ref))("World/Old")})';
  const { sites } = await inspect(source);
  const result = await refs.compileProgramRefs({ source,
    bindings: bindingSet(source, sites),
    pathByThingId: { target: 'World/New' } });
  const executed = run(result.source);
  assert.equal(executed.ok, true, JSON.stringify(executed));
  assert.equal(executed.messages[0].text, 'World/New');
});

test('site fingerprints survive readable path normalization including repeated command roles', async () => {
  const source = 'transform({"thing.mov.A.mov.B":"Target"})\nref("Target")';
  const { sites, sourceHash } = await inspect(source);
  const normalized = refs.normalizeProgramReferences({ source, sourceHash, referenceSites: sites,
    worldBindings: [{ path: 'LongWorld/A', id: 'a' }, { path: 'LongWorld/B', id: 'b' }, { path: 'LongWorld/Target', id: 'target' }] });
  const next = await inspect(normalized.source);
  assert.equal(new Set(sites.map(s => s.fingerprint)).size, 4);
  assert.deepEqual(next.sites.map(s => s.fingerprint), sites.map(s => s.fingerprint));
});

test('a trailing comma in ref still yields a string in both compiler and worker', async () => {
  const source = 'message({"text":ref("Old", # keep this comment\r\n)})';
  const { sites } = await inspect(source);
  const bindings = bindingSet(source, sites);
  const compiled = await refs.compileProgramRefs({ source, bindings, pathByThingId: { target: 'World/New' } });
  const executed = run(compiled.source);
  assert.equal(executed.ok, true, JSON.stringify(executed));
  assert.equal(executed.messages[0].text, 'World/New');
  assert.ok(compiled.source.includes('# keep this comment\r\n'));
  const direct = run(source, { program: { ref: 'program', path: 'Program', detail: source, refBindings: bindings },
    pathByThingId: { target: 'World/New' } });
  assert.equal(direct.ok, true, JSON.stringify(direct));
  assert.equal(direct.messages[0].text, 'World/New');
});

test('worker projects bound command paths for both main and nested Programs', async () => {
  for (const nested of [false, true]) {
    const command = 'transform({"thing.mov.OldDestination":"OldTarget"})';
    const detail = nested ? `def main(arguments):\n    ${command}` : command;
    const { sites } = await inspect(detail);
    const program = { ref: 'command-child', path: 'Program', name: 'Program', types: ['program'], detail,
      refBindings: bindingSet(detail, sites, s => s.selector === 'OldDestination' ? 'destination' : 'target') };
    const result = nested
      ? run('use_program({"name":"Program", "arguments":{}})', { world: [program],
        pathByThingId: { target: 'World/NewTarget', destination: 'World/NewDestination' } })
      : run(detail, { program, pathByThingId: { target: 'World/NewTarget', destination: 'World/NewDestination' } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.transforms, [{ 'thing.mov.World/NewDestination': 'World/NewTarget' }]);
  }
});

test('command execution without its binding fails closed before producing effects', () => {
  const result = run('transform({"thing.mov.OldDestination":"OldTarget"})');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROGRAM_REF_BINDING_MISSING');
  assert.equal(result.transforms, undefined);
});

test('binding provenance is mandatory in both JS and worker, independent of analysis hash', async () => {
  const source = 'message({"text":ref("Old")})';
  const { sites, sourceHash } = await inspect(source);
  const unversioned = bindingSet(source, sites).sites;
  await assert.rejects(refs.compileProgramRefs({ source, bindings: unversioned, sourceHash, referenceSites: sites,
    pathByThingId: { target: 'World/New' } }), { code: 'PROGRAM_REF_SOURCE_MISMATCH' });
  const direct = run(source, { program: { ref: 'program', path: 'Program', detail: source, refBindings: unversioned },
    pathByThingId: { target: 'World/New' } });
  assert.equal(direct.ok, false);
  assert.equal(direct.error.code, 'PROGRAM_REF_SOURCE_MISMATCH');
});

test('old source bindings cannot be reused by a new ref at the same AST position', async () => {
  const source = 'message({"text":ref("Old")})';
  const { sites } = await inspect(source);
  const bindings = bindingSet(source, sites);
  const edited = 'message({"text":ref("Other")})';
  await assert.rejects(refs.compileProgramRefs({ source: edited, bindings,
    pathByThingId: { target: 'World/New' } }), { code: 'PROGRAM_REF_SOURCE_MISMATCH' });
  const direct = run(edited, { program: { ref: 'program', path: 'Program', detail: edited, refBindings: bindings },
    pathByThingId: { target: 'World/New' } });
  assert.equal(direct.ok, false);
  assert.equal(direct.error.code, 'PROGRAM_REF_SOURCE_MISMATCH');
});
