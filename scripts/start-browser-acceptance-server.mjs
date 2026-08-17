#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';

function atom(name, detail = '', children = [], type = '', partners = []) {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners };
}

const requestedPort = Number(process.argv[2] || 4796);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-browser-acceptance-'));
const contextFile = path.join(directory, 'atom.json');
const graphFile = path.join(directory, 'graph.json');
const storeFile = path.join(directory, 'knowledge.json');

await fs.writeFile(contextFile, JSON.stringify([
  atom('测试入口', '隔离的浏览器验收世界', [
    atom('第一节点', '用于检查视角稳定', [], '', [
      { verb: '驱动', object: '测试入口/第二节点' },
      { verb: '约束', object: '测试入口/第五节点' }
    ]),
    atom('第二节点', '用于检查编辑与移动', [], '', [
      { verb: '驱动', object: '测试入口/第三节点' },
      { verb: '约束', object: '测试入口/第六节点' }
    ]),
    atom('第三节点', '用于检查关系布局', [], '', [
      { verb: '驱动', object: '测试入口/第四节点' },
      { verb: '约束', object: '测试入口/第七节点' }
    ]),
    atom('第四节点', '用于检查关系布局', [], '', [
      { verb: '驱动', object: '测试入口/第五节点' },
      { verb: '约束', object: '测试入口/第八节点' }
    ]),
    atom('第五节点', '用于检查关系布局', [], '', [
      { verb: '驱动', object: '测试入口/第六节点' }
    ]),
    atom('第六节点', '用于检查关系布局', [], '', [
      { verb: '驱动', object: '测试入口/第七节点' }
    ]),
    atom('第七节点', '用于检查关系布局', [], '', [
      { verb: '驱动', object: '测试入口/第八节点' }
    ]),
    atom('第八节点', '用于检查关系布局')
  ], 'agent'),
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
