import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createDurableWorldWriter } from '../src/atom-system/adapters/durable-world-writer.mjs';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { executeAtomCommandEndpoint } from '../work-engine/atom-language/cli.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { createJsonProgramProjectionRepository } from '../src/atom-system/adapters/json-program-projection-repository.mjs';

// A copied world must never inherit the production runtime's private backup target.
process.env.ATOM_RUNTIME_BACKUP_REPO = '';
if (process.argv.includes('--trace')) process.env.ATOM_PERF_TRACE = '1';
const cleanupCopy = process.argv.includes('--cleanup');
const measureStructuralLatency = process.argv.includes('--structural-latency');
const createProgram = process.argv.includes('--program-create');
const memoryAuthoritative = process.argv.includes('--memory-authoritative');
const latencySamplesText = argument('--latency-samples');
const latencySamples = latencySamplesText === null ? 0 : Number(latencySamplesText);
if (latencySamplesText !== null
  && (!Number.isSafeInteger(latencySamples) || latencySamples < 2 || latencySamples > 20)) {
  throw new Error('--latency-samples must be an integer from 2 through 20');
}
if (latencySamples && createProgram) {
  throw new Error('--latency-samples cannot replace a --program-create source');
}
const stageTimeoutMs = Number(argument('--stage-timeout-ms') ?? 300_000);
if (!Number.isSafeInteger(stageTimeoutMs) || stageTimeoutMs <= 0) {
  throw new Error('--stage-timeout-ms must be a positive integer');
}

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
let activeStage = null;
function beginStage(name) {
  if (activeStage) throw new Error(`Stage ${activeStage.name} is still active`);
  process.stderr.write(`${JSON.stringify({ event: 'acceptance-stage', stage: name, status: 'started' })}\n`);
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    process.stderr.write(`${JSON.stringify({
      event: 'acceptance-stage', stage: name, status: 'timed-out',
      elapsedMs: Date.now() - startedAt, tempDirectory: directory
    })}\n`);
    // Do not await close() here: a stuck saver may be the operation being diagnosed.
    process.exit(124);
  }, stageTimeoutMs);
  activeStage = { name, startedAt, timer };
}
function endStage(status = 'completed') {
  if (!activeStage) return;
  const { name, startedAt, timer } = activeStage;
  clearTimeout(timer);
  activeStage = null;
  process.stderr.write(`${JSON.stringify({
    event: 'acceptance-stage', stage: name, status, elapsedMs: Date.now() - startedAt
  })}\n`);
}
async function stage(name, operation) {
  beginStage(name);
  try {
    const result = await operation();
    endStage();
    return result;
  } catch (error) {
    endStage('failed');
    throw error;
  }
}
function summarizeMs(samplesMs) {
  if (!samplesMs.length) return { count: 0, p50: null, p95: null, samplesMs: [] };
  const ordered = [...samplesMs].sort((left, right) => left - right);
  return {
    count: samplesMs.length,
    p50: ordered[Math.ceil(0.5 * ordered.length) - 1],
    p95: ordered[Math.ceil(0.95 * ordered.length) - 1],
    samplesMs
  };
}
const writerModuleUrl = new URL('../src/atom-system/adapters/durable-world-writer.mjs', import.meta.url).href;
async function inspectCopiedJournal(mode, baselineCount = 0) {
  const { stdout } = await promisify(execFile)(process.execPath, [
    '--eval',
    `void (async () => {
       const { createDurableWorldWriter } = await import(${JSON.stringify(writerModuleUrl)});
       const [contextFile, journalFile, mode, baselineText] = process.argv.slice(1);
       const writer = createDurableWorldWriter({ contextFile, journalFile });
       try {
         const { initialSnapshot, durableReceipts } = await writer.initialize();
         const result = mode === 'baseline'
           ? { receiptCount: durableReceipts.length, revision: initialSnapshot.revision }
           : { newCommits: durableReceipts.slice(Number(baselineText)).map(({ receipt }) => ({
               commandId: receipt.commandId, afterRevision: receipt.afterRevision
             })) };
         process.stdout.write(JSON.stringify(result));
       } finally {
         await writer.close();
       }
     })().catch((error) => { console.error(error); process.exitCode = 1; });`,
    contextFile, journalFile, mode, String(baselineCount)
  ], { maxBuffer: 1024 * 1024, env: { ...process.env, ATOM_RUNTIME_BACKUP_REPO: '' } });
  return JSON.parse(stdout);
}
const sourceContents = await stage('copy', async () => {
  const contents = await fs.readFile(sourceContext);
  await fs.copyFile(sourceContext, contextFile);
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
  return contents;
});
const { receiptCount: initialReceiptCount, revision: sourceRevision } = await stage(
  'baseline', () => inspectCopiedJournal('baseline')
);
if (!Number.isSafeInteger(initialReceiptCount) || initialReceiptCount < 0
  || typeof sourceRevision !== 'string' || !sourceRevision) {
  throw new Error('Cannot verify the copied committed-world baseline');
}

let running;
let monitor;
try {
  beginStage('startup');
  const saveRpcWallSamples = [];
  const acceptedSignals = [];
  const savedSignals = [];
  const measuredWorldService = memoryAuthoritative ? createLegacyWorldService({
    publishLegacyProjection: false,
    memoryAuthoritative: true,
    onAuthoritativeWrite: ({ revision }) => {
      acceptedSignals.push({ revision, atMs: performance.now() });
    },
    onSaved: ({ version, revision }) => {
      savedSignals.push({ version, revision, atMs: performance.now() });
    },
    writerFactory: (configuration) => {
      const writer = createDurableWorldWriter(configuration);
      return Object.freeze({
        initialize: () => writer.initialize(),
        findCommitted: (commandId) => writer.findCommitted(commandId),
        async save(batch) {
          const started = performance.now();
          try { return await writer.save(batch); }
          finally { saveRpcWallSamples.push(performance.now() - started); }
        },
        close: () => writer.close()
      });
    }
  }) : null;
  const copiedWorld = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const programScheduler = createProgramRuntimeScheduler({
    projectionRepository: createJsonProgramProjectionRepository({
      file: path.join(directory, 'program-projection.json')
    })
  });
  const agentSecurity = await programScheduler.rebuildAgentSecurity(copiedWorld);
  const requestedAgent = argument('--agent');
  const agentPath = requestedAgent ?? agentSecurity.keys().next().value;
  if (!agentPath) throw new Error('The copied world has no declared Agent Program context');
  const writeInteractionId = crypto.randomUUID();
  const interaction = { agentSelector: agentPath, agent: { path: agentPath } };
  running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile, programScheduler,
    memoryAuthoritative,
    ...(measuredWorldService ? { worldService: measuredWorldService } : {}),
    ...(process.argv.includes('--trace') ? { timingInteractionId: writeInteractionId } : {})
  });
  endStage();
  const endpoint = `${running.url}/__atom/api/command`;
  const port = running.port;
  const testName = `__write_acceptance_${Date.now()}`;
  const acceptanceParent = argument('--parent') ?? agentPath;
  const testPath = [acceptanceParent, testName].filter(Boolean).join('/');
  const interactionDelays = [];
  const saveDelays = [];
  let eventLoopPhase = 'interaction';
  let expectedAt = Date.now() + 100;
  monitor = setInterval(() => {
    const now = Date.now();
    (eventLoopPhase === 'interaction' ? interactionDelays : saveDelays)
      .push(Math.max(0, now - expectedAt));
    expectedAt = now + 100;
  }, 100);
  beginStage('interaction');
  const startedAt = Date.now();
  const write = await executeAtomCommandEndpoint({
    source: `transform new ${JSON.stringify({
      [createProgram ? 'thing@program' : 'thing']: testPath,
      situation: createProgram ? 'def main(arguments):\n    return True' : 'acceptance',
      slot: [], strut: []
    })}`,
    interaction: { ...interaction, id: writeInteractionId }
  }, endpoint);
  const writeMs = Date.now() - startedAt;
  const sampleWriteMs = [];
  const sampleReadMs = [];
  const sampleRevisions = [];
  let sampleReadbackOk = true;
  let sampleOperationsOk = true;
  let previousSituation = 'acceptance';
  for (let index = 0; index < latencySamples; index += 1) {
    const nextSituation = `acceptance-sample-${index}-${crypto.randomUUID()}`;
    const sampleWriteStarted = performance.now();
    const sampleWrite = await executeAtomCommandEndpoint({
      source: `transform ${JSON.stringify({
        thing: testPath, [`situation.rep.${nextSituation}`]: previousSituation
      })}`,
      interaction: { ...interaction, id: crypto.randomUUID() }
    }, endpoint);
    sampleWriteMs.push(performance.now() - sampleWriteStarted);
    const sampleReadStarted = performance.now();
    const sampleRead = await executeAtomCommandEndpoint({
      source: `explore ${JSON.stringify({ thing: testPath, 'situation$full': true })}`,
      interaction
    }, endpoint);
    sampleReadMs.push(performance.now() - sampleReadStarted);
    sampleOperationsOk &&= sampleWrite.ok === true && sampleRead.ok === true;
    sampleReadbackOk &&= sampleRead.items?.[0]?.matches?.[0]?.situation === nextSituation;
    if (measuredWorldService) {
      const status = await measuredWorldService.saveStatus({ contextFile, projectionFile: graphFile });
      sampleRevisions.push(status?.acceptedRevision);
    }
    previousSituation = nextSituation;
  }
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
        slot: [
          {
            thing: 'Source', situation: '', strut: [], slot: [
              {
                thing: 'Probe', situation: 'preserve', strut: [], slot: [
                  { thing: 'Child', situation: 'preserve child', slot: [], strut: [] }
                ]
              }
            ]
          },
          { thing: 'Destination', situation: '', slot: [], strut: [] }
        ],
        strut: []
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
  const uniqueAcceptedRevisions = measuredWorldService
    ? sampleRevisions.length === latencySamples
      && sampleRevisions.every((revision) => typeof revision === 'string' && revision)
      && new Set(sampleRevisions).size === latencySamples
    : null;

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
      && structuralLatencyOk
      && sampleOperationsOk
      && sampleReadbackOk
      && uniqueAcceptedRevisions !== false,
    port,
    ephemeralPort: port !== 4784,
    tempPathsOk,
    writeMs,
    readMs,
    maxEventLoopDelayMs: Math.max(0, ...interactionDelays),
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
  endStage();
  eventLoopPhase = 'save';
  let flushWaitMs = null;
  let closeWaitMs = null;
  let saveReadProbeCount = 0;
  let saveReadProbeOk = true;
  let saveWatermarkOk = null;
  let acceptedToDurableWatermarkLagMs = null;
  await stage('flush', async () => {
    if (latencySamples && measuredWorldService) {
      let status = await measuredWorldService.saveStatus({ contextFile, projectionFile: graphFile });
      while (status?.pending) {
        if (saveReadProbeCount < 20) {
          const probe = await executeAtomCommandEndpoint({
            source: `explore ${JSON.stringify({ thing: testPath, 'situation$full': true })}`,
            interaction
          }, endpoint);
          saveReadProbeCount += 1;
          saveReadProbeOk &&= probe.ok === true
            && probe.items?.[0]?.matches?.[0]?.situation === previousSituation;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
        status = await measuredWorldService.saveStatus({ contextFile, projectionFile: graphFile });
      }
      const flushStarted = performance.now();
      await measuredWorldService.flushSaves();
      flushWaitMs = performance.now() - flushStarted;
    }
    const closeStarted = performance.now();
    await running.close();
    closeWaitMs = performance.now() - closeStarted;
    if (latencySamples && measuredWorldService) {
      const status = await measuredWorldService.saveStatus({ contextFile, projectionFile: graphFile });
      const saved = savedSignals.filter(({ version, revision }) => (
        version === status?.acceptedVersion && revision === status?.acceptedRevision
      )).at(-1);
      const accepted = acceptedSignals.filter(({ revision }) => revision === status?.acceptedRevision).at(-1);
      saveWatermarkOk = status?.pending === false
        && status.acceptedVersion === status.savedVersion
        && status.acceptedRevision === status.savedRevision
        && status.failure === null
        && status.auxiliaryFailure === null
        && Boolean(saved && accepted);
      if (saveWatermarkOk) {
        acceptedToDurableWatermarkLagMs = Math.max(0, saved.atMs - accepted.atMs);
      }
    }
  });
  running = null;
  clearInterval(monitor);
  monitor = null;
  const latency = latencySamples ? {
    sampleCount: latencySamples,
    writeMs: summarizeMs(sampleWriteMs),
    readMs: summarizeMs(sampleReadMs),
    readbackOk: sampleReadbackOk && sampleOperationsOk,
    uniqueAcceptedRevisions,
    interactionMaxEventLoopDelayMs: Math.max(0, ...interactionDelays),
    saveMaxEventLoopDelayMs: Math.max(0, ...saveDelays),
    saveReadProbeCount,
    saveReadProbeOk,
    saveRpcWallMs: summarizeMs(saveRpcWallSamples),
    acceptedToDurableWatermarkLagMs,
    flushWaitMs,
    closeWaitMs,
    saveWatermarkOk
  } : null;

  beginStage('rollback');
  const { newCommits } = await inspectCopiedJournal('new-commits', initialReceiptCount);
  const committed = newCommits.at(-1);
  if (!committed?.commandId || !committed.afterRevision) {
    throw new Error(`Acceptance write did not produce a rollback-capable receipt: ${JSON.stringify({
      writeOk: write.ok === true,
      writeErrorCodes: (write.errors ?? []).map(({ code }) => code),
      initialReceiptCount,
      newCommitCount: newCommits.length
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
  const restoredRevision = (await persistence.readCommittedSnapshot()).revision;
  endStage();

  beginStage('restart');
  const restartWorldService = memoryAuthoritative ? createLegacyWorldService({
    memoryAuthoritative: true, publishLegacyProjection: false
  }) : null;
  running = await startAtomGraphServer({
    host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile,
    memoryAuthoritative,
    ...(restartWorldService ? { worldService: restartWorldService } : {})
  });
  const restartPort = running.port;
  const restoredHealthResponse = await fetch(`${running.url}/__spatial/api/health`);
  const restoredHealth = await restoredHealthResponse.json();
  const restartReadback = await executeAtomCommandEndpoint({
    source: `explore ${JSON.stringify({ thing: agentPath, 'situation$full': true })}`,
    interaction
  }, `${running.url}/__atom/api/command`);
  const restartReadbackOk = restartReadback.ok === true
    && JSON.stringify(restartReadback).includes(agentPath);
  const restartStatus = restartWorldService
    ? await restartWorldService.saveStatus({ contextFile, projectionFile: graphFile }) : null;
  const restartSaveStatusOk = restartStatus ? restartStatus.pending === false
    && restartStatus.acceptedVersion === restartStatus.savedVersion
    && restartStatus.acceptedRevision === sourceRevision
    && restartStatus.savedRevision === sourceRevision : null;
  const sourceContextUnchanged = (await fs.readFile(sourceContext)).equals(sourceContents);
  endStage();
  const result = {
    ...preRollback,
    maxEventLoopDelayMs: Math.max(0, ...interactionDelays, ...saveDelays),
    ...(latency ? { latency } : {}),
    restartPort,
    restartMode: memoryAuthoritative ? 'memory' : 'disk',
    restartReadbackOk,
    restartSaveStatusOk,
    rollbackOk: rollbackRevision === sourceRevision,
    rollbackCount,
    sourceRevisionRestored: sourceRevision === restoredRevision,
    sourceContextUnchanged,
    restartHealthOk: restoredHealthResponse.status === 200 && restoredHealth.ok === true,
    ...(!cleanupCopy ? { tempDirectory: directory } : {}),
    ok: preRollback.ok
      && sourceRevision === restoredRevision
      && rollbackRevision === sourceRevision
      && restoredHealthResponse.status === 200
      && restoredHealth.ok === true
      && restartPort !== 4784
      && restartReadbackOk
      && restartSaveStatusOk !== false
      && (!latency || (latency.readbackOk && latency.saveReadProbeOk
        && latency.saveWatermarkOk !== false))
      && sourceContextUnchanged
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
} finally {
  endStage('failed');
  if (monitor) clearInterval(monitor);
  try {
    if (running) await stage('final-close', () => running.close());
  } finally {
    if (cleanupCopy) await fs.rm(directory, { recursive: true, force: true });
  }
}
