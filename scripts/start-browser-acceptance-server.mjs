#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';

function atom(thing, situation = '', contain = [], type = '', targets = []) {
  const support = targets.length
    ? [{ 'if@current': true, then: targets.map((target) => ({ thing: target })) }]
    : [];
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support };
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
