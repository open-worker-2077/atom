import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { executeAtomCommandEndpoint } from '../work-engine/atom-language/cli.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

if (process.argv.includes('--trace')) process.env.ATOM_PERF_TRACE = '1';
const cleanupCopy = process.argv.includes('--cleanup');
const measureStructuralLatency = process.argv.includes('--structural-latency');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
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
const initialJournal = await createJsonTransactionJournal({ file: journalFile }).readState();
const initialReceiptCount = initialJournal.receipts.length;

let running;
let monitor;
try {
  const copiedWorld = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const programScheduler = createProgramRuntimeScheduler();
  const agentSecurity = await programScheduler.rebuildAgentSecurity(copiedWorld);
  const requestedAgent = argument('--agent');
  const agentPath = requestedAgent ?? agentSecurity.keys().next().value;
  if (!agentPath) throw new Error('The copied world has no declared Agent Program context');
  const interaction = { agentSelector: agentPath, agent: { path: agentPath } };
  running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile, programScheduler
  });
  const endpoint = `${running.url}/__atom/api/command`;
  const port = running.port;
  const testName = `__write_acceptance_${Date.now()}`;
  const acceptanceParent = argument('--parent') ?? agentPath;
  const testPath = [acceptanceParent, testName].filter(Boolean).join('/');
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
  let structuralTimingsMs = null;
  let steadyTimingsMs = null;
  let structuralReadbackOk = true;
  let structuralOperationsOk = true;
  const structuralWarnings = [];
  if (measureStructuralLatency) {
    const anchorName = `${testName}_structural`;
    const anchorPath = [acceptanceParent, anchorName].filter(Boolean).join('/');
    const sourcePath = `${anchorPath}/Source/Probe`;
    const renamedPath = `${anchorPath}/Source/ProbeRenamed`;
    const destinationPath = `${anchorPath}/Destination`;
    const movedPath = `${destinationPath}/ProbeRenamed`;
    const setup = await executeAtomCommandEndpoint({
      source: `transform new ${JSON.stringify({
        thing: anchorPath,
        situation: 'isolated structural latency acceptance',
        contain: [
          {
            thing: 'Source', situation: '', support: [], contain: [
              {
                thing: 'Probe', situation: 'preserve', support: [], contain: [
                  { thing: 'Child', situation: 'preserve child', contain: [], support: [] }
                ]
              }
            ]
          },
          { thing: 'Destination', situation: '', contain: [], support: [] }
        ],
        support: []
      })}`,
      interaction
    }, endpoint);
    structuralOperationsOk = setup.ok === true;
    structuralWarnings.push(...(setup.warnings ?? []));
    structuralTimingsMs = {};
    steadyTimingsMs = {};
    const runStructural = async (operation, source) => {
      const operationStartedAt = Date.now();
      const result = await executeAtomCommandEndpoint({ source, interaction }, endpoint);
      structuralTimingsMs[operation] = Date.now() - operationStartedAt;
      structuralOperationsOk &&= result.ok === true;
      structuralWarnings.push(...(result.warnings ?? []));
      return result;
    };
    if (structuralOperationsOk) {
      const replaceStartedAt = Date.now();
      const replaced = await executeAtomCommandEndpoint({
        source: `transform {"thing":${JSON.stringify(sourcePath)},"situation.rep.after"}`,
        interaction
      }, endpoint);
      steadyTimingsMs.rep = Date.now() - replaceStartedAt;
      structuralOperationsOk &&= replaced.ok === true;
      structuralWarnings.push(...(replaced.warnings ?? []));
      await runStructural('ren', `transform ${JSON.stringify({ 'thing.ren.ProbeRenamed': sourcePath })}`);
      await runStructural('mov', `transform ${JSON.stringify({ [`thing.mov.${destinationPath}`]: renamedPath })}`);
      await runStructural('dsc', `transform ${JSON.stringify({ 'thing.dsc.': movedPath })}`);
      await runStructural('rst', 'transform {"thing.rst.":"默认备份仓/ProbeRenamed"}');
      const exploreStartedAt = Date.now();
      const restored = await executeAtomCommandEndpoint({
        source: `explore ${JSON.stringify({ thing: movedPath })}`, interaction
      }, endpoint);
      steadyTimingsMs.explore = Date.now() - exploreStartedAt;
      const child = await executeAtomCommandEndpoint(
        { source: `explore ${JSON.stringify({ thing: `${movedPath}/Child` })}`, interaction },
        endpoint
      );
      structuralReadbackOk = restored.ok === true && child.ok === true
        && JSON.stringify(restored).includes(movedPath)
        && JSON.stringify(child).includes(`${movedPath}/Child`);
    } else {
      structuralReadbackOk = false;
    }
  }
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
  )).length + structuralWarnings.filter((warning) => warning.code?.startsWith('ATOM_PROGRAM_')).length;
  const structuralLatencyOk = structuralTimingsMs === null || (
    Object.keys(structuralTimingsMs).length === 4
    && Object.values(structuralTimingsMs).every((elapsedMs) => elapsedMs < 5_000)
    && Object.keys(steadyTimingsMs).length === 2
    && Object.values(steadyTimingsMs).every((elapsedMs) => elapsedMs < 5_000)
  );

  const preRollback = {
    ok: write.ok === true
      && readback.ok === true
      && readbackFound
      && healthResponse.status === 200
      && health.ok === true
      && port !== 4784
      && tempPathsOk
      && programFailures === 0
      && structuralOperationsOk
      && structuralReadbackOk
      && structuralLatencyOk,
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
    ...(structuralTimingsMs ? {
      structuralTimingsMs,
      steadyTimingsMs,
      structuralReadbackOk,
      structuralOperationsOk,
      structuralLatencyOk
    } : {}),
  };
  if (process.argv.includes('--trace')) {
    process.stderr.write(`${JSON.stringify({ event: 'acceptance-pre-rollback', ...preRollback, warnings: write.warnings ?? [] })}\n`);
  }
  await running.close();
  running = null;

  const journal = await createJsonTransactionJournal({ file: journalFile }).readState();
  const newCommits = journal.receipts.slice(initialReceiptCount).map((entry) => entry.receipt);
  const committed = newCommits.at(-1);
  if (!committed?.commandId || !committed.afterRevision) {
    throw new Error(`Acceptance write did not produce a rollback-capable receipt: ${JSON.stringify({
      writeOk: write.ok === true,
      writeErrorCodes: (write.errors ?? []).map(({ code }) => code),
      initialReceiptCount,
      journalReceiptCount: journal.receipts.length,
      preparedCount: journal.prepared.length
    })}`);
  }
  const persistence = createTransactionalWorldPersistence({
    contextFile, projectionFile: graphFile, journalFile, publishLegacyProjection: false
  });
  let rollback = null;
  let rollbackRevision = committed.afterRevision;
  let rollbackCount = 0;
  for (const target of [...newCommits].reverse()) {
    rollback = await persistence.rollback({
      targetCommandId: target.commandId,
      correlationId: `deployment-acceptance-rollback-${rollbackCount}-${Date.now()}`,
      expectedRevision: rollbackRevision
    });
    rollbackRevision = rollback.afterRevision;
    rollbackCount += 1;
  }
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
      && rollbackRevision === sourceRevision
      && restoredHealthResponse.status === 200
      && restoredHealth.ok === true
      && restartPort !== 4784
      && sourceContextUnchanged,
    ...preRollback,
    restartPort,
    rollbackOk: rollbackRevision === sourceRevision,
    rollbackCount,
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
