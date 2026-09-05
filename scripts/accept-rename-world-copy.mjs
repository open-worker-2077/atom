import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { executeAtomCommandEndpoint } from '../work-engine/atom-language/cli.mjs';
import { walkAtoms } from '../work-engine/atom-language/query-capability.mjs';
import { rewriteProgramSourcePathLiterals } from '../work-engine/atom-language/transform-executor.mjs';

const arg = (key) => process.argv[process.argv.indexOf(key) + 1];
for (const key of ['--context', '--agent', '--target', '--name']) {
  if (!process.argv.includes(key)) throw new Error(`Required ${key}`);
}
const source = path.resolve(arg('--context'));
const agent = arg('--agent');
const target = arg('--target');
const renamed = `${target.slice(0, target.lastIndexOf('/'))}/${arg('--name')}`;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-rename-acceptance-'));
const files = { contextFile: path.join(dir, 'atom.json'), graphFile: path.join(dir, 'graph.json'), storeFile: path.join(dir, 'knowledge.json') };
const original = await fs.readFile(source);
await fs.writeFile(files.contextFile, original);
try { await fs.copyFile(path.join(path.dirname(source), 'program-projection.json'), path.join(dir, 'program-projection.json')); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const entries = (atoms) => new Map(walkAtoms(atoms).map((m) => [m.path.join('/'), m.atom]));
const before = entries(JSON.parse(original));
const relocate = (p) => p === target || p.startsWith(`${target}/`) ? renamed + p.slice(target.length) : p;
const report = { directory: dir, sourceHash: hash(original), target, renamed };
let running;
try {
  running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, ...files });
  assert.notEqual(running.port, 4784);
  const command = async (source) => executeAtomCommandEndpoint({ source, interaction: { agentSelector: agent, agent: { path: agent } } }, `${running.url}/__atom/api/command`);
  const t0 = performance.now();
  const write = await command(`transform ${JSON.stringify({ [`thing.ren.${arg('--name')}`]: target })}`);
  report.writeMs = Math.round(performance.now() - t0);
  report.write = write;
  await fs.writeFile(path.join(dir, 'receipt.json'), JSON.stringify(write, null, 2));
  assert.equal(write.ok, true, JSON.stringify(write.errors));
  const after = entries(JSON.parse(await fs.readFile(files.contextFile, 'utf8')));
  assert.equal(after.size, before.size);
  assert.equal(after.has(target), false);
  let programsRewritten = 0;
  for (const [p, a] of before) {
    const b = after.get(relocate(p));
    assert.ok(b, `Missing ${p}`);
    const oldThing = Object.keys(a).find((k) => /^thing(?:[@#]|$)/u.test(k));
    assert.equal(Object.keys(b).find((k) => /^thing(?:[@#]|$)/u.test(k)), oldThing, `Types changed ${p}`);
    assert.equal(b[oldThing], p === target ? arg('--name') : a[oldThing]);
    for (const key of Object.keys(a).filter((k) => k.startsWith('situation'))) {
      const expected = oldThing.split(/[@#]/u).includes('program')
        ? rewriteProgramSourcePathLiterals(a[key], [{ sourcePath: target, resultPath: renamed }]) : a[key];
      assert.equal(b[key], expected, `Unexpected Situation change ${p}`);
      if (expected !== a[key]) programsRewritten++;
    }
    // Compare direct child names in order; descendants must keep their topology.
    const childNames = (n) => (n.slot ?? []).map((child) => child[Object.keys(child).find((k) => /^thing(?:[@#]|$)/u.test(k))]);
    const oldNames = childNames(a);
    const expectedNames = p === target.slice(0, target.lastIndexOf('/'))
      ? oldNames.map((n) => n === target.split('/').at(-1) ? arg('--name') : n) : oldNames;
    assert.deepEqual(childNames(b), expectedNames, `Topology changed ${p}`);
  }
  report.nodes = before.size;
  report.programsRewritten = programsRewritten;
  const read = await command(`explore ${JSON.stringify({ thing: renamed, 'slot$latitude-1': true })}`);
  assert.equal(read.ok, true, JSON.stringify(read.errors));
  report.readback = read.ok;
  await running.close();
  running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, ...files });
  const cold = await command(`explore ${JSON.stringify({ thing: renamed, 'slot$latitude-1': true })}`);
  assert.equal(cold.ok, true, JSON.stringify(cold.errors));
  report.coldReadback = cold.ok;
  report.sourceUnchanged = hash(await fs.readFile(source)) === hash(original);
  assert.equal(report.sourceUnchanged, true, 'Live source changed during acceptance; inspect concurrent activity');
  report.ok = true;
} catch (e) {
  report.ok = false;
  report.error = { message: e.message, stack: e.stack };
  process.exitCode = 1;
} finally {
  if (running) await running.close();
  await fs.writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, write: report.write && { ok: report.write.ok, errors: report.write.errors, warnings: report.write.warnings } }, null, 2));
}
