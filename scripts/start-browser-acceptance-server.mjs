#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';

function atom(thing, situation = '', slot = [], type = '', targets = []) {
  const agentProgram = type === 'agent';
  const storedType = agentProgram ? 'program' : type;
  const storedSituation = agentProgram
    ? `LEGACY_AGENT_SITUATION = ${JSON.stringify(situation)}\nagent({"labels":[],"functions":{"groups":[],"names":["agent","explore","jump","lock","message","shortcut","slot_body","transform","use_program"]}})`
    : situation;
  const strut = targets.length
    ? [{ 'if@current': true, then: targets.map((target) => ({ thing: target })) }]
    : [];
  return { [`thing${storedType ? `@${storedType}` : ''}`]: thing, situation: storedSituation, slot, strut };
}

const requestedPort = Number(process.argv[2] || 4796);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-browser-acceptance-'));
const contextFile = path.join(directory, 'atom.json');
const graphFile = path.join(directory, 'graph.json');
const storeFile = path.join(directory, 'knowledge.json');

await fs.writeFile(contextFile, JSON.stringify([
  atom('测试入口', '隔离的浏览器验收世界', [
    atom('第一节点', '用于检查视角稳定', [], '', [
      '测试入口/第二节点',
      '测试入口/第五节点'
    ]),
    atom('第二节点', '用于检查编辑与移动', [], '', [
      '测试入口/第三节点',
      '测试入口/第六节点'
    ]),
    atom('第三节点', '用于检查关系布局', [], '', [
      '测试入口/第四节点',
      '测试入口/第七节点'
    ]),
    atom('第四节点', '用于检查关系布局', [], '', [
      '测试入口/第五节点',
      '测试入口/第八节点'
    ]),
    atom('第五节点', '用于检查关系布局', [], '', [
      '测试入口/第六节点'
    ]),
    atom('第六节点', '用于检查关系布局', [], '', [
      '测试入口/第七节点'
    ]),
    atom('第七节点', '用于检查关系布局', [], '', [
      '测试入口/第八节点'
    ]),
    atom('第八节点', '用于检查关系布局')
  ], 'agent'),
  atom('批量目标', '用于验证真实跨域批量移动', [atom('目标占位')]),
  atom('深层导航入口', '用于验证搜索进入深层可操作域', [
    atom('深层可点击目标', '搜索命中后必须进入此域')
  ]),
  atom('🧊manage', '脱敏同构管理域', [
    atom('工务', '', [
      atom('work', '待移动的 slot 子树', [atom('test', '子树守恒哨兵')]),
      atom('回滚work', '待验证权威失败回滚的 slot 子树', [atom('回滚test', '原子回滚守恒哨兵')])
    ]),
    atom('办包', '', [
      atom('究谋', '', [
        atom('个务', '', [
          atom('外务', '', [
            atom('推进', '目标父级', [atom('目标占位')])
          ])
        ])
      ])
    ])
  ]),
  atom('顶层参照', '用于检查顶层新增节点')
], null, 2));

const running = await startAtomGraphServer({
  host: '127.0.0.1',
  port: requestedPort,
  contextFile,
  graphFile,
  storeFile,
  backupRepository: ''
});

process.stdout.write(`${JSON.stringify({
  url: running.url,
  directory,
  contextFile,
  graphFile,
  storeFile
})}\n`);

async function close() {
  await running.close();
  process.exit(0);
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
await new Promise(() => {});
