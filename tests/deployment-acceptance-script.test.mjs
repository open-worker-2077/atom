import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import deploymentAcceptanceWorld from './fixtures/deployment-acceptance-world.fixture.mjs';
import { createJsonTransactionJournal } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const script = path.join(projectRoot, 'scripts', 'accept-real-world-write-copy.mjs');
const temporaryPrefix = 'atom-real-write-acceptance-';

async function createContext(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-deployment-source-'));
  const contextFile = path.join(directory, 'atom.json');
  const source = `${JSON.stringify(deploymentAcceptanceWorld, null, 2)}\n`;
  await fs.writeFile(contextFile, source, 'utf8');
  return { contextFile, source };
}

test('deployment acceptance proves an ephemeral isolated world and preserves its copy', async (t) => {
  const { contextFile, source } = await createContext(t);
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    script,
    '--context', contextFile,
    '--agent', '部署验收窗口'
  ], { cwd: projectRoot, env: { ...process.env, ATOM_RUNTIME_BACKUP_REPO: '' } });
  const result = JSON.parse(stdout);

  assert.equal(result.ok, true);
  assert.equal(result.ephemeralPort, true);
  assert.notEqual(result.port, 4784);
  assert.equal(result.sourceContextUnchanged, true);
  assert.equal(await fs.readFile(contextFile, 'utf8'), source);
  assert.ok((await fs.stat(result.tempDirectory)).isDirectory());
  const stages = stderr.trim().split('\n').map((line) => JSON.parse(line));
  for (const name of ['copy', 'baseline', 'startup', 'interaction', 'flush', 'rollback', 'restart']) {
    assert.ok(stages.some(({ stage, status }) => stage === name && status === 'started'), name);
    assert.ok(stages.some(({ stage, status, elapsedMs }) => (
      stage === name && status === 'completed' && Number.isFinite(elapsedMs)
    )), name);
  }
});

test('deployment acceptance preserves its temporary copy when agent resolution fails', async (t) => {
  const { contextFile } = await createContext(t);
  const before = new Set((await fs.readdir(os.tmpdir())).filter((name) => name.startsWith(temporaryPrefix)));
  let error;
  try {
    await execFileAsync(process.execPath, [
      script,
      '--context', contextFile,
      '--agent', '__missing_deployment_acceptance_agent__'
    ], { cwd: projectRoot, env: { ...process.env, ATOM_RUNTIME_BACKUP_REPO: '' } });
  } catch (caught) {
    error = caught;
  }
  assert.match(error?.stderr ?? '', /AGENT_NOT_FOUND/);
  const after = (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith(temporaryPrefix));
  assert.equal(after.filter((name) => !before.has(name)).length, 1);
});

test('deployment acceptance measures the complete structural latency chain and rolls every copy commit back', async (t) => {
  const { contextFile, source } = await createContext(t);
  const { stdout } = await execFileAsync(process.execPath, [
    script,
    '--context', contextFile,
    '--agent', '部署验收窗口',
    '--structural-latency'
  ], { cwd: projectRoot, env: { ...process.env, ATOM_RUNTIME_BACKUP_REPO: '' } });
  const result = JSON.parse(stdout);

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.structuralTimingsMs), ['ren', 'mov', 'dsc', 'rst']);
  for (const [operation, elapsedMs] of Object.entries(result.structuralTimingsMs)) {
    assert.ok(elapsedMs < 5_000, `${operation} took ${elapsedMs}ms`);
  }
  assert.deepEqual(Object.keys(result.steadyTimingsMs), ['rep', 'explore']);
  for (const [operation, elapsedMs] of Object.entries(result.steadyTimingsMs)) {
    assert.ok(elapsedMs < 5_000, `${operation} took ${elapsedMs}ms`);
  }
  assert.equal(result.structuralReadbackOk, true);
  assert.ok(result.rollbackCount >= 6);
  assert.equal(result.sourceRevisionRestored, true);
  assert.equal(await fs.readFile(contextFile, 'utf8'), source);
  assert.ok((await fs.stat(result.tempDirectory)).isDirectory());
});

test('deployment acceptance keeps two prior durable commits and restores their committed revision', async (t) => {
  const { contextFile, source } = await createContext(t);
  const directory = path.dirname(contextFile);
  const journalFile = path.join(directory, 'atom.transactions.json');
  const persistence = createTransactionalWorldPersistence({
    contextFile, projectionFile: path.join(directory, 'graph.json'), journalFile,
    publishLegacyProjection: false
  });
  let facts = structuredClone(deploymentAcceptanceWorld);
  for (const number of [1, 2]) {
    const nextFacts = [...facts, {
      thing: `Prior ${number}`, situation: `durable ${number}`, slot: [], strut: []
    }];
    await persistence.commit({
      correlationId: `prior-${number}`,
      expectedRevision: revisionOfWorldFacts(facts),
      nextRevision: revisionOfWorldFacts(nextFacts),
      facts: nextFacts,
      changedPaths: [`Prior ${number}`],
      affectedPathClosureComplete: true,
      relationEndpoints: [], lockPaths: [], shortcutPaths: [], referencePaths: []
    });
    facts = nextFacts;
  }
  const before = await persistence.readCommittedSnapshot();
  const prior = (await createJsonTransactionJournal({ file: journalFile }).readState()).receipts;
  assert.equal(prior.length, 2);
  assert.notEqual(before.revision, revisionOfWorldFacts(JSON.parse(source)), 'physical baseline is stale');
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    script, '--context', contextFile, '--agent', '部署验收窗口'
  ], { cwd: projectRoot, env: { ...process.env, ATOM_RUNTIME_BACKUP_REPO: '' } });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, stderr);
  assert.equal(result.rollbackCount, 1, stderr);
  assert.equal(result.sourceRevisionRestored, true, stderr);
  assert.equal(await fs.readFile(contextFile, 'utf8'), source);
  const copiedJournal = await createJsonTransactionJournal({
    file: path.join(result.tempDirectory, 'atom.transactions.json')
  }).readState();
  assert.deepEqual(copiedJournal.receipts.slice(0, 2).map(({ commandId }) => commandId),
    prior.map(({ commandId }) => commandId));
  const copiedSnapshot = await createTransactionalWorldPersistence({
    contextFile: path.join(result.tempDirectory, 'atom.json'),
    projectionFile: path.join(result.tempDirectory, 'graph.json'),
    journalFile: path.join(result.tempDirectory, 'atom.transactions.json'),
    publishLegacyProjection: false
  }).readCommittedSnapshot();
  assert.equal(copiedSnapshot.revision, before.revision);
});

test('deployment acceptance times out a stage with a content-free diagnostic and preserves the copy', async (t) => {
  const { contextFile } = await createContext(t);
  let error;
  try {
    await execFileAsync(process.execPath, [
      script, '--context', contextFile, '--agent', '部署验收窗口', '--stage-timeout-ms', '1'
    ], { cwd: projectRoot, env: { ...process.env, ATOM_RUNTIME_BACKUP_REPO: '' } });
  } catch (caught) {
    error = caught;
  }
  assert.equal(error?.code, 124);
  const stages = error.stderr.trim().split('\n').filter((line) => line.startsWith('{')).map(JSON.parse);
  const timedOut = stages.find(({ event, status }) => event === 'acceptance-stage' && status === 'timed-out');
  assert.ok(timedOut);
  assert.equal(typeof timedOut.elapsedMs, 'number');
  assert.ok(path.basename(timedOut.tempDirectory).startsWith(temporaryPrefix));
  assert.ok((await fs.stat(timedOut.tempDirectory)).isDirectory());
  assert.equal(error.stderr.includes(contextFile), false, 'diagnostics must not reveal source path');
});
