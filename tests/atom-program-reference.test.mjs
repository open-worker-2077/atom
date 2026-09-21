import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectProgramReferenceSites,
  rewriteProgramReferenceBatch
} from '../work-engine/atom-language/program-reference-runtime.mjs';

test('Program reference inspection finds only explicit ref selectors', async () => {
  const source = [
    '# explore({"thing":"注释不是引用"})',
    'message({"level":"info","text":"目标"})',
    'ordinary = {"thing":"目标"}',
    'def later():',
    '    return explore({"thing":ref("域/目标")})',
    'dynamic = explore({"thing": ordinary["thing"]})'
  ].join('\n');

  const inspected = await inspectProgramReferenceSites({ source, programPath: '测试Program' });

  assert.match(inspected.sourceHash, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(inspected.sites.map(({ kind, fingerprint, callStartByte, callEndByte, callAstPath, markerTokens, ...site }) => site), [{
    role: 'ref',
    selector: '域/目标',
    line: 5,
    columnBytes: 32,
    endLine: 5,
    endColumnBytes: 44,
    startByte: Buffer.byteLength(source.split('\n').slice(0, 4).join('\n') + '\n') + 32,
    endByte: Buffer.byteLength(source.split('\n').slice(0, 4).join('\n') + '\n') + 44,
    astPath: 'module.body[2].body[0].value.args[0].values[0].args[0]'
  }]);
});

test('a locally shadowed explore name is not treated as a kernel reference', async () => {
  const source = [
    'def explore(value):',
    '    return value',
    'result = explore({"thing":"业务文字"})'
  ].join('\n');
  const inspected = await inspectProgramReferenceSites({ source });
  assert.deepEqual(inspected.sites, []);
});

test('Program reference rewrite changes kernel reference sites without touching business text', async () => {
  const source = [
    '# explore({"thing":"域/旧名"})',
    'message({"text":"域/旧名"})',
    'ordinary = {"thing":"域/旧名"}',
    'explore({"thing":ref("域/旧名")})',
    'trigger("transform", {"nodes":[ref("域/旧名")]}, main)',
    'use_program({"name":ref("域/旧名/执行"), "arguments":{}})',
    'lock({"targets":{"paths":[ref("域/旧名")]}})',
    'transform({"thing":"域/旧名", "situation.rep.新":"旧"})'
  ].join('\n');
  const [rewritten] = await rewriteProgramReferenceBatch({
    programs: [{ path: '测试Program', source }],
    aliases: [{
      sourcePath: '域/旧名', resultPath: '域/新名', rootSourcePath: '域/旧名'
    }],
    worldBindings: [
      { path: '域/旧名', id: 'permanent-target-id' },
      { path: '域/旧名/执行', id: 'permanent-program-id' }
    ]
  });

  assert.equal(rewritten.changedSites.length, 5);
  assert.equal(rewritten.changedSites[0].targetId, 'permanent-target-id');
  assert.equal(rewritten.source, [
    '# explore({"thing":"域/旧名"})',
    'message({"text":"域/旧名"})',
    'ordinary = {"thing":"域/旧名"}',
    'explore({"thing":ref("域/新名")})',
    'trigger("transform", {"nodes":[ref("域/新名")]}, main)',
    'use_program({"name":ref("域/新名/执行"), "arguments":{}})',
    'lock({"targets":{"paths":[ref("域/新名")]}})',
    'transform({"thing":"域/新名", "situation.rep.新":"旧"})'
  ].join('\n'));
});

test('an ambiguous semantic selector is not rebound to a different Thing identity', async () => {
  const source = 'explore({"thing":ref("目标")})';
  const [rewritten] = await rewriteProgramReferenceBatch({
    programs: [{ path: '测试Program', source }],
    aliases: [{ sourcePath: '目标', resultPath: '甲/新目标', rootSourcePath: '甲/目标' }],
    worldBindings: [
      { path: '甲/目标', id: 'first-id' },
      { path: '乙/目标', id: 'second-id' }
    ]
  });
  assert.equal(rewritten.source, source);
  assert.deepEqual(rewritten.changedSites, []);
});

test('reference relocation preserves operation keys, concatenation comments, and creation names', async () => {
  const source = [
    'transform({"thing.mov." "Domain/Old":"Domain/Target"})',
    'explore({"thing": ref("Domain/" # keep me\r\n    "Old")})',
    'transform({"thing":"Domain/Old","situation":"","slot":[],"strut":[]})',
    'transform({"thing.ren.Domain/Old":"Domain/Target"})'
  ].join('\n');
  const [rewritten] = await rewriteProgramReferenceBatch({
    programs: [{ path: 'Program', source }],
    aliases: [{ sourcePath: 'Domain/Old', resultPath: 'Domain/New', rootSourcePath: 'Domain/Old' }],
    worldBindings: [{ path: 'Domain/Old', id: 'destination-id' }, { path: 'Domain/Target', id: 'target-id' }]
  });
  assert.equal(rewritten.changedSites.length, 2);
  assert.match(rewritten.source, / # keep me\r\n    /u);
  assert.ok(rewritten.source.includes('"thing.mov.Domain/New"'));
  assert.ok(rewritten.source.includes('"thing":"Domain/Old","situation":"","slot":[],"strut":[]'));
  assert.ok(rewritten.source.includes('"thing.ren.Domain/Old"'));
  const inspected = await inspectProgramReferenceSites({ source: rewritten.source });
  assert.equal(inspected.sites.find((site) => site.role === 'transform.mov.parameter').selector, 'Domain/New');
});
