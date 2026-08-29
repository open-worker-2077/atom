import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { executeAtomCommandEndpoint } from '../work-engine/atom-language/cli.mjs';
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
    const thingKey = Object.keys(atom).find((key) => (
      key === 'thing' || key.startsWith('thing@') || key === 'name' || key.startsWith('name@')
    ));
    if (!thingKey || typeof atom[thingKey] !== 'string') continue;
    const current = [...parent, atom[thingKey]];
    if (thingKey.split('@').slice(1).includes('agent')) results.push(current.join('/'));
    const contain = atom.contain ?? atom.children;
    if (Array.isArray(contain)) results.push(...agentPaths(contain, current));
  }
  return results;
}

const sourceContext = path.resolve(argument('--context') ?? 'atom.json');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-real-write-acceptance-'));
const contextFile = path.join(directory, 'atom.json');
const graphFile = path.join(directory, 'graph.json');
const storeFile = path.join(directory, 'knowledge.json');
const journalFile = path.join(directory, 'atom.transactions.json');
const sourceContents = await fs.readFile(sourceContext, 'utf8');
await fs.copyFile(sourceContext, contextFile);
const sourceRevision = revisionOfWorldFacts(JSON.parse(sourceContents));
const sourceProgramProjection = path.join(path.dirname(sourceContext), 'program-projection.json');
try {
  await fs.copyFile(sourceProgramProjection, path.join(directory, 'program-projection.json'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
for (const name of ['atom.transactions.json', 'atom.transactions.json.d']) {
  try {
    await fs.cp(path.join(path.dirname(sourceContext), name), path.join(directory, name), {
      recursive: true
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

let running;
let monitor;
try {
  const copiedWorld = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const requestedAgent = argument('--agent');
  const agentPath = requestedAgent ?? agentPaths(copiedWorld)[0];
  if (!agentPath) throw new Error('The copied world has no @agent context');
  const interaction = { agentSelector: agentPath, agent: { path: agentPath } };
  running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  const endpoint = `${running.url}/__atom/api/command`;
  const port = running.port;
  const testName = `__write_acceptance_${Date.now()}`;
  const testPath = [argument('--parent'), testName].filter(Boolean).join('/');
  const delays = [];
  let expectedAt = Date.now() + 100;
  monitor = setInterval(() => {
    const now = Date.now();
    delays.push(Math.max(0, now - expectedAt));
    expectedAt = now + 100;
  }, 100);
  const startedAt = Date.now();
  const write = await executeAtomCommandEndpoint({
    source: `transform new {"thing":"${testPath}","situation":"acceptance","contain":[],"support":[]}`,
    interaction
  }, endpoint);
  const writeMs = Date.now() - startedAt;
  clearInterval(monitor);
  monitor = null;

  const readStartedAt = Date.now();
  const readback = await executeAtomCommandEndpoint({
    source: `explore {"thing":"${testPath}","situation$full":true}`,
    interaction
  }, endpoint);
  const readMs = Date.now() - readStartedAt;
  const healthResponse = await fetch(`${running.url}/__spatial/api/health`);
  const health = await healthResponse.json();
  const readbackFound = JSON.stringify(readback).includes(testName);
  const tempPathsOk = health.store === path.resolve(storeFile)
    && health.graphFile === path.resolve(graphFile);
  const programFailures = (write.warnings ?? []).filter((warning) => (
    warning.code?.startsWith('ATOM_PROGRAM_')
  )).length;

  const preRollback = {
    ok: write.ok === true
      && readback.ok === true
      && readbackFound
      && healthResponse.status === 200
      && health.ok === true
      && port !== 4784
      && tempPathsOk
      && programFailures === 0,
    port,
    ephemeralPort: port !== 4784,
    tempPathsOk,
    writeMs,
    readMs,
    maxEventLoopDelayMs: Math.max(0, ...delays),
    writeOk: write.ok === true,
    readbackOk: readback.ok === true,
    readbackFound,
    healthOk: healthResponse.status === 200 && health.ok === true,
    programFailures,
  };
  if (process.argv.includes('--trace')) {
    process.stderr.write(`${JSON.stringify({ event: 'acceptance-pre-rollback', ...preRollback, warnings: write.warnings ?? [] })}\n`);
  }
  await running.close();
  running = null;

  const journal = await createJsonTransactionJournal({ file: journalFile }).readState();
  const committed = journal.receipts.at(-1)?.receipt;
  if (!committed?.commandId || !committed.afterRevision) {
    throw new Error('Acceptance write did not produce a rollback-capable receipt');
  }
  const persistence = createTransactionalWorldPersistence({
    contextFile, projectionFile: graphFile, journalFile, publishLegacyProjection: false
  });
  const rollback = await persistence.rollback({
    targetCommandId: committed.commandId,
    correlationId: `deployment-acceptance-rollback-${Date.now()}`,
    expectedRevision: committed.afterRevision
  });
  const restoredRevision = revisionOfWorldFacts(JSON.parse(await fs.readFile(contextFile, 'utf8')));

  running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile
  });
  const restartPort = running.port;
  const restoredHealthResponse = await fetch(`${running.url}/__spatial/api/health`);
  const restoredHealth = await restoredHealthResponse.json();
  const sourceContextUnchanged = await fs.readFile(sourceContext, 'utf8') === sourceContents;
  const result = {
    ok: preRollback.ok
      && sourceRevision === restoredRevision
      && rollback.afterRevision === committed.beforeRevision
      && restoredHealthResponse.status === 200
      && restoredHealth.ok === true
      && restartPort !== 4784
      && sourceContextUnchanged,
    ...preRollback,
    restartPort,
    rollbackOk: rollback.afterRevision === committed.beforeRevision,
    sourceRevisionRestored: sourceRevision === restoredRevision,
    sourceContextUnchanged,
    restartHealthOk: restoredHealthResponse.status === 200 && restoredHealth.ok === true,
    ...(!cleanupCopy ? { tempDirectory: directory } : {})
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
} finally {
  if (monitor) clearInterval(monitor);
  try {
    await running?.close();
  } finally {
    if (cleanupCopy) await fs.rm(directory, { recursive: true, force: true });
  }
}
