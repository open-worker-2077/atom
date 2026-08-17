import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { executeAtomCommandEndpoint, resolveAgentContext } from '../work-engine/atom-language/cli.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';

if (process.argv.includes('--trace')) process.env.ATOM_PERF_TRACE = '1';
const cleanupCopy = process.argv.includes('--cleanup');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function agentPaths(atoms, parent = []) {
  const results = [];
  for (const atom of atoms) {
    if (!atom || typeof atom !== 'object' || Array.isArray(atom)) continue;
    const nameKey = Object.keys(atom).find((key) => key === 'name' || key.startsWith('name@'));
    if (!nameKey || typeof atom[nameKey] !== 'string') continue;
    const current = [...parent, atom[nameKey]];
    if (nameKey.split('@').slice(1).includes('agent')) results.push(current.join('/'));
    if (Array.isArray(atom.children)) results.push(...agentPaths(atom.children, current));
  }
  return results;
}

const sourceContext = path.resolve(argument('--context') ?? 'atom.json');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-real-write-acceptance-'));
const contextFile = path.join(directory, 'atom.json');
const graphFile = path.join(directory, 'graph.json');
const storeFile = path.join(directory, 'knowledge.json');
await fs.copyFile(sourceContext, contextFile);
const sourceProgramProjection = path.join(path.dirname(sourceContext), 'program-projection.json');
try {
  await fs.copyFile(sourceProgramProjection, path.join(directory, 'program-projection.json'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

let running;
try {
  const copiedWorld = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const requestedAgent = argument('--agent');
  const agentPath = requestedAgent ?? agentPaths(copiedWorld)[0];
  if (!agentPath) throw new Error('The copied world has no @agent context');
  const agent = await resolveAgentContext(contextFile, agentPath);
  running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  const endpoint = `${running.url}/__atom/api/command`;
  const testName = `__write_acceptance_${Date.now()}`;
  const delays = [];
  let expectedAt = Date.now() + 100;
  const monitor = setInterval(() => {
    const now = Date.now();
    delays.push(Math.max(0, now - expectedAt));
    expectedAt = now + 100;
  }, 100);
  const startedAt = Date.now();
  const write = await executeAtomCommandEndpoint({
    source: `transform new {"name":"${testName}","detail":"acceptance","children":[],"partners":[]}`,
    interaction: { agent }
  }, endpoint);
  const writeMs = Date.now() - startedAt;
  clearInterval(monitor);

  const readStartedAt = Date.now();
  const readback = await executeAtomCommandEndpoint({
    source: `explore {"name":"${testName}","detail$full"}`,
    interaction: { agent }
  }, endpoint);
  const readMs = Date.now() - readStartedAt;
  const healthResponse = await fetch(`${running.url}/__spatial/api/health`);
  const health = await healthResponse.json();
  const readbackFound = JSON.stringify(readback).includes(testName);

  const result = {
    ok: write.ok === true
      && readback.ok === true
      && readbackFound
      && healthResponse.status === 200
      && health.ok === true,
    writeMs,
    readMs,
    maxEventLoopDelayMs: Math.max(0, ...delays),
    writeOk: write.ok === true,
    readbackOk: readback.ok === true,
    readbackFound,
    healthOk: healthResponse.status === 200 && health.ok === true,
    programFailures: (write.warnings ?? []).filter((warning) => (
      warning.code?.startsWith('ATOM_PROGRAM_')
    )).length,
    ...(!cleanupCopy ? { tempDirectory: directory } : {})
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
} finally {
  await running?.close();
  if (cleanupCopy) await fs.rm(directory, { recursive: true, force: true });
}
