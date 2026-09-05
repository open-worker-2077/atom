import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createJsonTransactionJournal, createJsonWorldRepository } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createInteractionRuntime } from '../src/atom-system/public/interaction-runtime.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';

import { executeAtomLanguage as executeAtomLanguageKernel } from '../work-engine/atom-language/engine.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(thing, situation = '', slot = [], strut = [], types = []) {
  return {
    [`thing${types.map((type) => `@${type}`).join('')}`]: thing,
    situation,
    slot,
    strut
  };
}

function nameOf(value) {
  return Object.entries(value).find(([key]) => key.split(/[@#]/u)[0] === 'thing')?.[1];
}

function find(atoms, selector) {
  let children = atoms;
  let current = null;
  for (const segment of selector.split('/')) {
    current = children.find((candidate) => nameOf(candidate) === segment);
    if (!current) return null;
    children = current.slot;
  }
  return current;
}

async function fixture(t, subscriberSource) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-postcommit-boundary-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Source', 'before', [], [{
      'if@current': true,
      if: [{ program: 'def main(context):\n    return True' }],
      then: [{ 'thing@program': 'Subscriber' }]
    }]),
    atom('Result', 'before'),
    atom('Subscriber', subscriberSource, [], [], ['program'])
  ], null, 2), 'utf8');
  return { contextFile, projectionFile };
}

test('a rejected multi-effect subscriber keeps its entire effects batch out of the committed source world', async (t) => {
  const runtime = await fixture(t, [
    'def receive(delivery):',
    '    transform({"thing":"Result","situation.rep.after":"before"})',
    '    transform({"thing":"Missing","situation.rep.after":"before"})',
    'trigger("strut", {}, receive)'
  ].join('\n'));

  const result = await executeAtomLanguage({
    ...runtime,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: `multi-effect-${crypto.randomUUID()}` }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'failed');
  assert.ok(result.subsequentExecution.errors.some(({ code }) => code === 'ATOM_NOT_FOUND'));
  assert.ok(result.warnings.some(({ code }) => code === 'ATOM_SUBSEQUENT_EXECUTION_FAILED'));
  const stored = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(find(stored, 'Source').situation, 'after');
  assert.equal(find(stored, 'Result').situation, 'before');
});

test('an ordinary transform trigger commits none of a Program multi-effect batch when one effect is invalid', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-postcommit-transform-trigger-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const subscriber = [
    'def receive():',
    '    transform({"thing":"Result","situation.rep.after":"before"})',
    '    transform({"thing":"Missing","situation.rep.after":"before"})',
    'trigger("transform", {"nodes":["Source"]}, receive)'
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Source', 'before'),
    atom('Result', 'before'),
    atom('Subscriber', subscriber, [], [], ['program'])
  ], null, 2), 'utf8');

  const result = await executeAtomLanguage({
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: `transform-trigger-effects-${crypto.randomUUID()}` }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'failed');
  assert.ok(result.subsequentExecution.errors.some(({ code }) => (
    code === 'PROGRAM_TRANSFORM_REJECTED' || code === 'ATOM_NOT_FOUND'
  )), JSON.stringify(result));
  const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(find(stored, 'Source').situation, 'after');
  assert.equal(find(stored, 'Result').situation, 'before');
});

test('onCommitted observes the source commit before a blocked subsequent worker finishes', async (t) => {
  const runtime = await fixture(t, [
    'def receive(delivery):',
    '    return {"received": True}',
    'trigger("strut", {}, receive)'
  ].join('\n'));
  const scheduler = createProgramRuntimeScheduler();
  const runProgram = scheduler.runProgram;
  let unblock;
  const blocked = new Promise((resolve) => { unblock = resolve; });
  scheduler.runProgram = async (request) => {
    if (request.program.path === 'Subscriber' && request.programArguments?.mode === 'strut') {
      await blocked;
    }
    return runProgram(request);
  };
  let notify;
  const notified = new Promise((resolve) => { notify = resolve; });
  let notificationCount = 0;
  const execution = executeAtomLanguage({
    ...runtime,
    programScheduler: scheduler,
    source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: `callback-order-${crypto.randomUUID()}` },
    onCommitted(result) {
      notificationCount += 1;
      notify(result);
    }
  });

  const sourceResult = await notified;
  assert.equal(sourceResult.ok, true, JSON.stringify(sourceResult));
  assert.equal(sourceResult.subsequentExecution.status, 'pending');
  assert.ok(sourceResult.warnings.some(({ code, correlationId }) => (
    code === 'ATOM_SUBSEQUENT_EXECUTION_PENDING'
      && correlationId === `${sourceResult.interactionId}:subsequent`
  )));
  assert.equal(find(JSON.parse(await fs.readFile(runtime.contextFile, 'utf8')), 'Source').situation, 'after');
  unblock();
  const result = await execution;
  assert.equal(result.subsequentExecution.status, 'completed', JSON.stringify(result));
  assert.equal(result.warnings.some(({ code }) => code === 'ATOM_SUBSEQUENT_EXECUTION_PENDING'), false);
  assert.equal(notificationCount, 1);
});

test('a subsequent effects CAS conflict is not mistaken for this request committing identical facts', async (t) => {
  const runtime = await fixture(t, [
    'def receive(delivery):',
    '    transform({"thing":"Result","situation.rep.after":"before"})',
    'trigger("strut", {}, receive)'
  ].join('\n'));
  const result = await executeAtomLanguage({
    ...runtime,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: `effects-cas-${crypto.randomUUID()}` },
    async onCommitted() {
      const concurrent = await executeAtomLanguage({
        ...runtime,
        trustedMaintenance: true,
        source: 'transform {"thing":"Result","situation.rep.after":"before"}',
        interaction: { id: `concurrent-${crypto.randomUUID()}` }
      });
      assert.equal(concurrent.ok, true, JSON.stringify(concurrent));
    }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'failed');
  assert.ok(result.warnings.some(({ code }) => code === 'WORLD_REVISION_CONFLICT'));
  assert.equal(result.subsequentExecution.errors[0]?.code, 'DETAIL_FRAGMENT_NOT_FOUND', JSON.stringify(result));
  assert.equal(result.subsequentExecution.errors[0]?.program, 'Subscriber');
  const stored = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(find(stored, 'Source').situation, 'after');
  assert.equal(find(stored, 'Result').situation, 'after');
  assert.equal(result.revisionAfter, result.subsequentExecution.revisionAfter);
  assert.notEqual(result.revisionAfter, result.subsequentExecution.sourceRevision);
});

test('a changed batch source with a message-only subscriber confirms its delivery exactly once', async (t) => {
  const runtime = await fixture(t, [
    'def receive(delivery):',
    '    message({"level":"info","text":"batch delivered"})',
    'trigger("strut", {}, receive)'
  ].join('\n'));
  const initial = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  initial.push(atom('Second', 'before'));
  await fs.writeFile(runtime.contextFile, JSON.stringify(initial, null, 2), 'utf8');
  const scheduler = createProgramRuntimeScheduler();

  const first = await executeAtomLanguage({
    ...runtime, programScheduler: scheduler,
    source: `transform ${JSON.stringify([
      { thing: 'Source', 'situation.rep.after': 'before' },
      { thing: 'Second', 'situation.rep.after': 'before' }
    ])}`,
    interaction: { id: `batch-message-source-${crypto.randomUUID()}` }
  });
  const second = await executeAtomLanguage({
    ...runtime, programScheduler: scheduler,
    source: 'transform {"thing":"Source","situation.rep.after":"after"}',
    interaction: { id: `batch-message-retry-${crypto.randomUUID()}` }
  });

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.messages.map(({ text }) => text), ['batch delivered']);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(second.messages, []);
});

test('a changed source with a message-only subscriber confirms its delivery exactly once', async (t) => {
  const runtime = await fixture(t, [
    'def receive(delivery):',
    '    message({"level":"info","text":"delivered"})',
    'trigger("strut", {}, receive)'
  ].join('\n'));
  const scheduler = createProgramRuntimeScheduler();

  const first = await executeAtomLanguage({
    ...runtime, programScheduler: scheduler,
    source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: `message-source-${crypto.randomUUID()}` }
  });
  const second = await executeAtomLanguage({
    ...runtime, programScheduler: scheduler,
    source: 'transform {"thing":"Source","situation.rep.after":"after"}',
    interaction: { id: `message-retry-${crypto.randomUUID()}` }
  });

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.messages.map(({ text }) => text), ['delivered']);
  assert.equal(first.subsequentExecution.status, 'completed');
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(second.messages, []);
});

test('a directly throwing ordinary transform subscriber fails only subsequent execution', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-postcommit-worker-failure-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const subscriber = [
    'def receive():',
    '    return {"received": True}',
    'trigger("transform", {"nodes":["Source"]}, receive)'
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Source', 'before'), atom('Subscriber', subscriber, [], [], ['program'])
  ], null, 2), 'utf8');
  const scheduler = createProgramRuntimeScheduler();
  const runProgram = scheduler.runProgram;
  scheduler.runProgram = async (request) => {
    if (request.program.path === 'Subscriber' && request.triggered === true) {
      throw Object.assign(new Error('subscriber exploded'), { code: 'SUBSCRIBER_EXPLODED' });
    }
    return runProgram(request);
  };

  const result = await executeAtomLanguage({
    contextFile, projectionFile, programScheduler: scheduler,
    source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: `worker-failure-${crypto.randomUUID()}` }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'failed');
  assert.ok(result.subsequentExecution.errors.some(({ code }) => code === 'SUBSCRIBER_EXPLODED'));
  assert.equal(find(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'Source').situation, 'after');
});

test('a shortcut-only subsequent effect outside the source subtree is committed', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-postcommit-shortcut-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const subscriber = [
    'def receive():',
    '    target = explore({"thing":"Target"})[0]',
    '    shortcut({"placement":"slot","thing":"Link","target":target})',
    'trigger("transform", {"nodes":["Source"]}, receive)'
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Source', 'before'), atom('Target'),
    atom('Subscriber', subscriber, [], [], ['program'])
  ], null, 2), 'utf8');

  const result = await executeAtomLanguage({
    contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: `shortcut-effect-${crypto.randomUUID()}` }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'completed');
  assert.ok(find(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'Subscriber/Link'));
  assert.notEqual(result.revisionAfter, result.subsequentExecution.sourceRevision);
});

test('an invalid source Transform commits nothing and dispatches no subscriber', async (t) => {
  const runtime = await fixture(t, [
    'def receive(delivery):',
    '    return {"received": True}',
    'trigger("strut", {}, receive)'
  ].join('\n'));
  const scheduler = createProgramRuntimeScheduler();
  const runProgram = scheduler.runProgram;
  let subscriberCalls = 0;
  scheduler.runProgram = async (request) => {
    if (request.program.path === 'Subscriber') subscriberCalls += 1;
    return runProgram(request);
  };

  const result = await executeAtomLanguage({
    ...runtime,
    programScheduler: scheduler,
    source: 'transform {"thing":"Source","unknown.rep.after":"before"}',
    interaction: { id: `invalid-source-${crypto.randomUUID()}` }
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(find(JSON.parse(await fs.readFile(runtime.contextFile, 'utf8')), 'Source').situation, 'before');
  assert.equal(subscriberCalls, 0);
});

test('a batch source commits all requested facts before its failing subscriber', async (t) => {
  const runtime = await fixture(t, [
    'def receive(delivery):',
    '    return delivery["missing"]',
    'trigger("strut", {}, receive)'
  ].join('\n'));
  const initial = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  initial.push(atom('Second', 'before'));
  await fs.writeFile(runtime.contextFile, JSON.stringify(initial, null, 2), 'utf8');

  const result = await executeAtomLanguage({
    ...runtime,
    programScheduler: createProgramRuntimeScheduler(),
    source: `transform ${JSON.stringify([
      { thing: 'Source', 'situation.rep.after': 'before' },
      { thing: 'Second', 'situation.rep.after': 'before' }
    ])}`,
    interaction: { id: `batch-source-${crypto.randomUUID()}` }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'failed');
  const stored = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(find(stored, 'Source').situation, 'after');
  assert.equal(find(stored, 'Second').situation, 'after');
});

test('creating a valid Program remains committed when onCommitted fails', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-postcommit-create-'));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root')], null, 2), 'utf8');
  const program = 'message({"level":"info","text":"created"})';

  const result = await executeAtomLanguage({
    contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler(),
    source: `transform new ${JSON.stringify({
      'thing@program': 'CreatedProgram', situation: program, slot: [], strut: []
    })}`,
    interaction: { id: `create-source-${crypto.randomUUID()}` },
    onCommitted() {
      throw Object.assign(new Error('callback failed'), { code: 'CALLBACK_FAILED' });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.subsequentExecution.status, 'completed');
  assert.ok(result.warnings.some(({ code }) => code === 'ATOM_COMMITTED_NOTIFICATION_FAILED'));
  assert.ok(find(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'CreatedProgram'));
});

for (const throughRuntime of [false, true]) {
 for (const failureMode of ['throw', 'reject']) {
  test(`a ${failureMode} committed notification preserves source and subsequent effects (${throughRuntime ? 'runtime' : 'service'})`, async (t) => {
    const files = await fixture(t, 'def receive(delivery):\n    transform({"thing":"Result","situation.rep.after":"before"})\ntrigger("strut", {}, receive)');
    const service = createLegacyWorldService();
    const scheduler = createProgramRuntimeScheduler();
    let notifications = 0;
    const onCommitted = () => {
      notifications += 1;
      if (failureMode === 'reject') return Promise.reject(new Error('notification unavailable'));
      throw new Error('notification unavailable');
    };
    const request = { ...files, programScheduler: scheduler, programMode: 'reconcile',
      source: 'transform {"thing":"Source","situation.rep.after":"before"}', interaction: { id: crypto.randomUUID() } };
    const unused = async () => { throw new Error('unexpected capability'); };
    const runtime = createInteractionRuntime({
      world: { execute: value => service.executeLegacy({ ...request, ...value }) },
      projections: { publish: unused, recover: unused }, feedback: { submit: unused },
      agents: { resolve: unused }, humanStatus: { translate: unused }
    });
    const result = throughRuntime
      ? await runtime.execute({ source: request.source, correlationId: request.interaction.id }, { publish: false, onCommitted })
      : await service.executeLegacy({ ...request, onCommitted });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.subsequentExecution.status, 'completed');
    assert.equal(notifications, 1);
    assert.ok(result.warnings.some(({ code }) => code === 'ATOM_COMMITTED_NOTIFICATION_FAILED'));
    assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Result').situation, 'after');
  });
 }
}

for (const crashAt of ['source', 'child', 'startup']) {
  test(`cold retry recovers ${crashAt} commit without repeating source or confirmed effects`, async (t) => {
    const files = await fixture(t, 'def receive(delivery):\n    transform({"thing":"Result","situation.rep.after":"before"})\ntrigger("strut", {}, receive)');
    const request = { ...files, source: 'transform {"thing":"Source","situation.rep.after":"before"}',
      interaction: { id: `cold-${crashAt}` }, programMode: 'reconcile' };
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { createLegacyWorldService } from ${JSON.stringify(new URL('../src/atom-system/adapters/legacy-engine-adapter.mjs', import.meta.url).href)};
      import { createProgramRuntimeScheduler } from ${JSON.stringify(new URL('../work-engine/atom-language/program-runtime.mjs', import.meta.url).href)};
      const service = createLegacyWorldService({ onAuthoritativeWrite({receipt}) {
        if (${JSON.stringify(crashAt)} === 'child' && receipt.result?.subsequentOf) process.exit(72);
      }});
      await service.executeLegacy({ ...${JSON.stringify(request)}, programScheduler: createProgramRuntimeScheduler(),
        onCommitted() { if (${JSON.stringify(crashAt)} !== 'child') process.exit(71); }
      });
    `], { encoding: 'utf8', timeout: 60000 });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, crashAt !== 'child' ? 71 : 72, child.stderr);
    const persistence = createTransactionalWorldPersistence(files);
    assert.equal(typeof persistence.programExecutionForInteraction, 'function');
    const execution = await persistence.programExecutionForInteraction(request.interaction.id);
    assert.equal(execution.event.mode, 'transform');
    assert.ok(execution.event.nodes.includes('Source'));
    assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Source').situation, 'after');
    const service = createLegacyWorldService();
    const scheduler = createProgramRuntimeScheduler();
    const run = scheduler.runProgram.bind(scheduler);
    let effectsRuns = 0;
    scheduler.runProgram = async value => {
      if (value.program.path === 'Subscriber' && value.programArguments?.mode === 'strut') effectsRuns += 1;
      return run(value);
    };
    if (crashAt === 'startup') {
      const server = await startAtomGraphServer({ contextFile: files.contextFile, graphFile: files.projectionFile,
        storeFile: path.join(path.dirname(files.contextFile), 'knowledge.json'),
        host: '127.0.0.1', port: 0, backupRepository: '', startupCorrelationId: 'cold-start-initialize',
        programScheduler: scheduler, worldService: service });
      t.after(() => server.close());
      assert.equal(server.initialization.ok, true, JSON.stringify(server.initialization));
      assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Result').situation, 'after',
        'startup must consume the pending event without replaying its source or interaction id');
      assert.equal(server.initialization.revisionAfter,
        revisionOfWorldFacts(JSON.parse(await fs.readFile(files.contextFile, 'utf8'))).replace(/^sha256:/u, ''));
      const publicRead = await (await fetch(`${server.url}/__spatial/api/state`)).json();
      assert.equal(publicRead.ok, true, JSON.stringify(publicRead));
      assert.equal(publicRead.knowledge.nodes.find(({ atomPath }) => atomPath === 'Result')?.detail, 'after', JSON.stringify(publicRead));
    }
    const recovered = await service.executeLegacy({ ...request, programScheduler: scheduler });
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(recovered.subsequentExecution.status, 'completed');
    assert.equal(effectsRuns, crashAt !== 'child' ? 1 : 0);
    const repeated = await service.executeLegacy({ ...request, programScheduler: createProgramRuntimeScheduler() });
    assert.equal(repeated.subsequentExecution.status, 'completed');
    const journal = createJsonTransactionJournal({ file: path.join(path.dirname(files.contextFile), 'atom.transactions.json') });
    const state = await journal.readState();
    assert.equal(state.receipts.filter(({ receipt }) => receipt.correlationId === request.interaction.id).length, 1);
    assert.equal(state.receipts.filter(({ receipt }) => receipt.result?.subsequentOf === execution.sourceReceipt.commandId).length, 1);
    assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Result').situation, 'after');
  });
}

test('an auxiliary mirror failure after subsequent facts commit preserves the committed revision', async (t) => {
  const inertSubscriber = 'def receive():\n    return True';
  const runtime = await fixture(t, [
    'def receive():',
    `    transform({"thing":"Subscriber",${JSON.stringify(`situation.rep.${inertSubscriber}`)}:None})`,
    '    transform({"thing.ren.Renamed Source":"Source"})',
    'trigger("transform", {"nodes":["Source"]}, receive)'
  ].join('\n'));
  const scheduler = createProgramRuntimeScheduler();
  const createCandidateRuntime = scheduler.createCandidateRuntime.bind(scheduler);
  scheduler.createCandidateRuntime = () => {
    const candidate = createCandidateRuntime();
    const refresh = candidate.refresh.bind(candidate);
    candidate.refresh = async (atoms, request) => {
      const refreshed = await refresh(atoms, request);
      if (find(atoms, 'Renamed Source')) {
        refreshed.locks.push({
          sourceProgramPath: 'Subscriber',
          targets: { paths: ['Renamed Source'], scope: 'exact' },
          actions: ['explore'], labels: ['postcommit'], fields: []
        });
      }
      return refreshed;
    };
    return candidate;
  };
  let writes = 0;
  const result = await executeAtomLanguageKernel({
    ...runtime,
    programScheduler: scheduler,
    source: 'transform {"thing":"Source","situation.rep.before":"before"}',
    interaction: { id: `mirror-after-effects-${crypto.randomUUID()}` },
    programMode: 'reconcile',
    async commitWorld({ facts, expectedRevision, nextRevision, affectedAtoms }) {
      writes += 1;
      await fs.writeFile(runtime.contextFile, JSON.stringify(facts, null, 2), 'utf8');
      const receipt = {
        beforeRevision: expectedRevision,
        afterRevision: nextRevision,
        result: { affectedAtoms }
      };
      if (writes === 1) {
        const concurrent = [...facts, atom('Concurrent', 'after')];
        await fs.writeFile(runtime.contextFile, JSON.stringify(concurrent, null, 2), 'utf8');
        throw Object.assign(new Error('mirror unavailable'), {
          code: 'MIRROR_UNAVAILABLE', details: { receipt }
        });
      }
      return receipt;
    }
  });

  const stored = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'completed', JSON.stringify(result));
  assert.deepEqual(result.subsequentExecution.errors, []);
  assert.equal(result.changed, true);
  assert.equal(result.result.thing, 'Renamed Source');
  assert.equal(find(stored, 'Renamed Source').situation, 'before');
  assert.equal(find(stored, 'Concurrent').situation, 'after');
  assert.ok(result.affectedPaths.includes('Source'));
  assert.ok(result.affectedPaths.includes('Renamed Source'));
  assert.ok(
    result.lockState.some(({ path }) => path === 'Renamed Source'),
    JSON.stringify(result.lockState)
  );
  assert.equal(result.revisionAfter, result.subsequentExecution.revisionAfter);
  const committedRevision = result.warnings.find(({ code }) => (
    code === 'MIRROR_UNAVAILABLE'
  ))?.receipt?.afterRevision?.replace(/^sha256:/u, '');
  assert.ok(committedRevision);
  assert.notEqual(result.revisionAfter, committedRevision);
});

test('an explicitly requested Program run still fails when that Program fails', async (t) => {
  const runtime = await fixture(t, [
    'transform({"thing":"Missing","situation.rep.after":"before"})'
  ].join('\n'));

  const result = await executeAtomLanguage({
    ...runtime,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing.run.":"Subscriber"}',
    interaction: { id: `explicit-run-${crypto.randomUUID()}` }
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.errors.some(({ code, cause, details }) => (
    code === 'PROGRAM_TRANSFORM_REJECTED'
      && (cause === 'ATOM_NOT_FOUND' || details?.cause === 'ATOM_NOT_FOUND')
  )));
  assert.equal(result.subsequentExecution, undefined);
});

test('outcome journal events preserve old-loader receipts, order and rollback while indexing cold results', async (t) => {
  const files = await fixture(t, 'def receive(delivery):\n    return True\ntrigger("strut", {}, receive)');
  const journalFile = path.join(path.dirname(files.contextFile), 'atom.transactions.json');
  const persistence = createTransactionalWorldPersistence(files);
  const before = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  const after = structuredClone(before);
  after[0].situation = 'after';
  const source = await persistence.commit({ correlationId: 'compat-source', facts: after,
    expectedRevision: revisionOfWorldFacts(before), nextRevision: revisionOfWorldFacts(after), changedPaths: ['Source'],
    postCommitEvent: { binding: 'compat-binding', mode: 'transform', nodes: ['Source'],
      affectedPaths: ['Source'], resultPaths: ['Source'], interaction: { id: 'compat-source', agent: null } } });
  const later = structuredClone(after);
  later[1].situation = 'unrelated';
  const other = await persistence.commit({ correlationId: 'compat-other', facts: later,
    expectedRevision: source.afterRevision, nextRevision: revisionOfWorldFacts(later), changedPaths: ['Result'] });
  const file = path.join(`${journalFile}.d`, 'events.jsonl');
  const originalEvents = (await fs.readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
  const originalSource = originalEvents.find(event => event.type === 'committed' && event.commandId === source.commandId);
  await persistence.recordProgramExecution({ sourceCommandId: source.commandId,
    outcome: { status: 'failed', attemptId: 'compat-attempt', errors: [{ code: 'PROGRAM_FAILED' }],
      sourceRevision: source.afterRevision, revisionAfter: other.afterRevision } });
  const appended = JSON.parse((await fs.readFile(file, 'utf8')).trim().split('\n').at(-1));
  assert.deepEqual(appended.record, originalSource.record);
  assert.deepEqual(appended.receipt, source);
  const forbiddenEffects = structuredClone(later);
  forbiddenEffects[1].situation = 'must-not-commit';
  await assert.rejects(persistence.commit({ correlationId: 'compat-source:subsequent', subsequentOf: source.commandId,
    facts: forbiddenEffects, expectedRevision: other.afterRevision, nextRevision: revisionOfWorldFacts(forbiddenEffects),
    changedPaths: ['Result'] }), { code: 'PROGRAM_EXECUTION_FINAL' });
  const cold = createJsonTransactionJournal({ file: journalFile });
  assert.equal((await cold.programExecutionForInteraction('compat-source')).outcome.status, 'failed');
  assert.equal((await cold.programExecutionForInteraction('compat-other')), null);
  assert.deepEqual(await cold.pendingProgramExecutions(), []);
  const oldCode = spawnSync('git', ['show', '802d902:src/atom-system/adapters/json-world-repository.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8'
  });
  assert.equal(oldCode.status, 0, oldCode.stderr);
  const compatibleCode = oldCode.stdout.replace("'../world-runtime/world-revision.mjs'",
    JSON.stringify(new URL('../src/atom-system/world-runtime/world-revision.mjs', import.meta.url).href));
  const { createJsonTransactionJournal: oldReader } = await import(`data:text/javascript;base64,${Buffer.from(compatibleCode).toString('base64')}`);
  const legacyJournal = oldReader({ file: journalFile });
  assert.deepEqual(await legacyJournal.findReceipt(source.commandId), source);
  assert.deepEqual((await legacyJournal.readState()).receipts.map(({ commandId }) => commandId), [source.commandId, other.commandId]);
  assert.deepEqual((await legacyJournal.findCommitted(source.commandId)).inversePatch, originalSource.record.inversePatch);
  const coordinator = createCommitCoordinator({ worldRepository: createJsonWorldRepository({ file: files.contextFile, worldId: 'primary' }), journalRepository: legacyJournal });
  const rollback = await coordinator.rollback({ targetCommandId: other.commandId, command: {
    contract: 'atom.world-command', version: 1, commandId: 'old-reader-rollback', correlationId: 'old-reader-rollback',
    expectedRevision: other.afterRevision, name: 'rollback', payload: {} } });
  assert.equal(rollback.afterRevision, source.afterRevision);
  await coordinator.rollback({ targetCommandId: source.commandId, command: {
    contract: 'atom.world-command', version: 1, commandId: 'old-reader-source-rollback', correlationId: 'old-reader-source-rollback',
    expectedRevision: source.afterRevision, name: 'rollback', payload: {} } });
  assert.deepEqual(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), before);
});

test('a final business failure is reread after Program repair and conflicting identities never disclose its receipt', async (t) => {
  const files = await fixture(t, 'def receive(delivery):\n    transform({"thing":"Missing","situation.rep.after":"before"})\ntrigger("strut", {}, receive)');
  const request = { ...files, source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: 'final-business-failure' }, programMode: 'reconcile' };
  const first = await createLegacyWorldService().executeLegacy({ ...request, programScheduler: createProgramRuntimeScheduler() });
  assert.equal(first.subsequentExecution.status, 'failed');
  const repair = await createLegacyWorldService().executeLegacy({ ...files, trustedMaintenance: true,
    programScheduler: createProgramRuntimeScheduler(), programMode: 'passive',
    interaction: { id: 'repair-program' },
    source: `transform ${JSON.stringify({ thing: 'Subscriber', 'situation.rep.def receive(delivery):\n    return True\ntrigger("strut", {}, receive)':
      'def receive(delivery):\n    transform({"thing":"Missing","situation.rep.after":"before"})\ntrigger("strut", {}, receive)' })}` });
  assert.equal(repair.ok, true, JSON.stringify(repair));
  const scheduler = createProgramRuntimeScheduler();
  scheduler.runProgram = async () => { throw new Error('final receipt must not execute workers'); };
  const service = createLegacyWorldService();
  assert.deepEqual(await service.executeLegacy({ ...request, programScheduler: scheduler }), first);
  await assert.rejects(service.executeLegacy({ ...request, source: 'transform {"thing":"Result","situation.rep.after":"before"}' }), { code: 'ATOM_INTERACTION_ID_CONFLICT' });
  await assert.rejects(service.executeLegacy({ ...request, interaction: { id: request.interaction.id, agent: { path: 'OtherAgent' } } }), { code: 'ATOM_INTERACTION_ID_CONFLICT' });
});

test('two services join a committed pending interaction and keep one source and one subscriber invocation', async (t) => {
  const files = await fixture(t, 'def receive(delivery):\n    transform({"thing":"Result","situation.rep.after":"before"})\ntrigger("strut", {}, receive)');
  const request = { ...files, source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: 'concurrent-service' }, programMode: 'reconcile' };
  let release, notify;
  const blocked = new Promise(resolve => { release = resolve; });
  const committed = new Promise(resolve => { notify = resolve; });
  const first = createLegacyWorldService().executeLegacy({ ...request, programScheduler: createProgramRuntimeScheduler(),
    async onCommitted(result) { notify(result); await blocked; } });
  await committed;
  const second = await createLegacyWorldService().executeLegacy({ ...request, programScheduler: createProgramRuntimeScheduler() });
  assert.equal(second.subsequentExecution.status, 'pending');
  let joinedNotification;
  const joined = createLegacyWorldService().executeLegacy({ ...request, programScheduler: createProgramRuntimeScheduler(),
    onCommitted(result) { joinedNotification = result; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(joinedNotification?.subsequentExecution.status, 'pending');
  release();
  const final = await first;
  assert.equal(final.subsequentExecution.status, 'completed');
  assert.equal((await joined).subsequentExecution.status, 'completed', 'a joined HTTP lifecycle must not settle permanently on pending');
  const journal = createJsonTransactionJournal({ file: path.join(path.dirname(files.contextFile), 'atom.transactions.json') });
  const state = await journal.readState();
  assert.equal(state.receipts.filter(({ receipt }) => receipt.correlationId === request.interaction.id).length, 1);
  assert.equal(state.receipts.filter(({ receipt }) => receipt.result?.subsequentOf).length, 1);
});

for (const change of ['source-missing', 'agent-missing', 'agent-revoked']) {
  test(`pending execution revalidates current ${change} without borrowing historical authority`, async (t) => {
    const files = await fixture(t, 'def receive(delivery):\n    transform({"thing":"Result","situation.rep.after":"before"})\ntrigger("strut", {}, receive)');
    const initial = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
    initial.push(atom('Agent', 'agent({"labels":["^"],"functions":{"groups":[],"names":["transform","trigger"]}})', [], [], ['program']));
    await fs.writeFile(files.contextFile, JSON.stringify(initial));
    const persistence = createTransactionalWorldPersistence(files);
    const source = 'transform {"thing":"Source","situation.rep.after":"before"}';
    const interaction = { id: change, agent: { path: 'Agent' } };
    const after = structuredClone(initial);
    after[0].situation = 'after';
    const receipt = await persistence.commit({ correlationId: interaction.id, source,
      facts: after, expectedRevision: revisionOfWorldFacts(initial), nextRevision: revisionOfWorldFacts(after), changedPaths: ['Source'],
      postCommitEvent: { mode: 'transform', nodes: ['Source'], affectedPaths: ['Source'], resultPaths: ['Source'], enabled: true,
        interaction, binding: crypto.createHash('sha256').update(JSON.stringify({ source, agentPath: 'Agent', history: [],
          trustedMaintenance: false, bypassProgramLocks: false })).digest('hex') } });
    const current = structuredClone(after);
    if (change === 'source-missing') current[0].thing = 'MovedSource';
    else if (change === 'agent-missing') current[3]['thing@program'] = 'MovedAgent';
    else current[3].situation = 'agent({"labels":[],"functions":{"groups":[],"names":["transform","trigger"]}})';
    await persistence.commit({ correlationId: `${change}-concurrent`, facts: current,
      expectedRevision: receipt.afterRevision, nextRevision: revisionOfWorldFacts(current),
      changedPaths: change === 'source-missing' ? ['Source', 'MovedSource'] : change === 'agent-missing' ? ['Agent', 'MovedAgent'] : ['Agent'] });
    const result = await createLegacyWorldService().executeLegacy({ ...files, source, interaction: {
      ...interaction, agent: { ...interaction.agent, labels: ['^'], scope: 'world' }
    }, programScheduler: createProgramRuntimeScheduler() });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.subsequentExecution.status, 'failed', JSON.stringify(result));
    const expected = change === 'source-missing' ? 'PROGRAM_SOURCE_PATH_NOT_FOUND'
      : change === 'agent-missing' ? 'PROGRAM_SOURCE_AGENT_NOT_FOUND' : 'WINDOW_ACCESS_DENIED';
    assert.equal(result.subsequentExecution.errors[0].code, expected, JSON.stringify(result));
    assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Result').situation, 'before');
  });
}

test('central persistence rejects a correlation identity collision across live facades and preserves each write hook', async (t) => {
  const files = await fixture(t, 'def receive(delivery):\n    return True\ntrigger("strut", {}, receive)');
  const hooks = [];
  const first = createTransactionalWorldPersistence({ ...files, onAuthoritativeWrite: () => hooks.push('first') });
  const second = createTransactionalWorldPersistence({ ...files, onAuthoritativeWrite: () => hooks.push('second') });
  const initial = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  const after = structuredClone(initial);
  after[0].situation = 'after';
  const transition = { correlationId: 'central-collision', facts: after, expectedRevision: revisionOfWorldFacts(initial),
    nextRevision: revisionOfWorldFacts(after), changedPaths: ['Source'] };
  const results = await Promise.allSettled([
    first.commit({ ...transition, postCommitEvent: { binding: 'owner-a' } }),
    second.commit({ ...transition, postCommitEvent: { binding: 'owner-b' } })
  ]);
  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(results.find(({ status }) => status === 'rejected').reason.code, 'ATOM_INTERACTION_ID_CONFLICT');
  const winner = results[0].status === 'fulfilled' ? 'first' : 'second';
  assert.deepEqual(hooks, [winner]);
  const later = structuredClone(after);
  later[1].situation = 'another';
  await second.commit({ correlationId: 'other-facade', facts: later, expectedRevision: revisionOfWorldFacts(after),
    nextRevision: revisionOfWorldFacts(later), changedPaths: ['Result'] });
  assert.deepEqual(hooks, [winner, 'second']);
  const original = await second.programExecutionForInteraction('central-collision');
  assert.equal(original.event.binding, winner === 'first' ? 'owner-a' : 'owner-b');
});

test('a no-change source without effects creates no world revision or durable source event', async (t) => {
  const files = await fixture(t, 'def receive(delivery):\n    return True\ntrigger("strut", {}, receive)');
  const result = await createLegacyWorldService().executeLegacy({ ...files, programScheduler: createProgramRuntimeScheduler(),
    programMode: 'reconcile', source: 'transform {"thing":"Source","situation.rep.before":"before"}',
    interaction: { id: 'no-change-event' } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.changed, false);
  assert.equal(result.revisionBefore, result.revisionAfter);
  const persistence = createTransactionalWorldPersistence(files);
  assert.equal(await persistence.programExecutionForInteraction('no-change-event'), null);
  const journal = createJsonTransactionJournal({ file: path.join(path.dirname(files.contextFile), 'atom.transactions.json') });
  assert.equal((await journal.readState()).receipts.length, 0);
});

test('cancellation after source acknowledgement leaves an unconfirmed attempt pending for recovery', async (t) => {
  const files = await fixture(t, 'def receive(delivery):\n    transform({"thing":"Result","situation.rep.after":"before"})\ntrigger("strut", {}, receive)');
  const request = { ...files, source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: 'cancel-after-source' }, programMode: 'reconcile' };
  const controller = new AbortController();
  const first = await createLegacyWorldService().executeLegacy({ ...request,
    programScheduler: createProgramRuntimeScheduler(), signal: controller.signal,
    onCommitted() { controller.abort(Object.assign(new Error('deadline'), { code: 'ABORT_ERR' })); } });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.subsequentExecution.status, 'pending');
  assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Source').situation, 'after');
  assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Result').situation, 'before');
  const withoutRuntime = await createLegacyWorldService().executeLegacy(request);
  assert.equal(withoutRuntime.subsequentExecution.status, 'pending', JSON.stringify(withoutRuntime));
  const recovered = await createLegacyWorldService().executeLegacy({ ...request, programScheduler: createProgramRuntimeScheduler() });
  assert.equal(recovered.subsequentExecution.status, 'completed', JSON.stringify(recovered));
  assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Result').situation, 'after');
});

test('a source auxiliary-write failure preserves its own receipt and continues subsequent business', async (t) => {
  const files = await fixture(t, 'def receive(delivery):\n    transform({"thing":"Result","situation.rep.after":"before"})\ntrigger("strut", {}, receive)');
  const service = createLegacyWorldService({ onAuthoritativeWrite({ receipt }) {
    if (receipt.result?.postCommitEvent) throw Object.assign(new Error('source mirror unavailable'), { code: 'SOURCE_MIRROR_FAILED' });
  } });
  const result = await service.executeLegacy({ ...files, programScheduler: createProgramRuntimeScheduler(), programMode: 'reconcile',
    source: 'transform {"thing":"Source","situation.rep.after":"before"}', interaction: { id: 'source-auxiliary' } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'completed');
  assert.ok(result.warnings.some(({ code }) => code === 'SOURCE_MIRROR_FAILED'));
  assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Result').situation, 'after');
  assert.equal((await createTransactionalWorldPersistence(files).programExecutionForInteraction('source-auxiliary')).outcome.status, 'completed');
});

test('the durable trigger envelope fingerprints request history without copying it into the scheduling event', async (t) => {
  const files = await fixture(t, 'def receive(delivery):\n    return True\ntrigger("strut", {}, receive)');
  const request = { ...files, source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: 'compact-trigger' }, programMode: 'reconcile', history: [{ receipt: { privateNote: 'do-not-store-history-in-trigger' } }] };
  await createLegacyWorldService().executeLegacy({ ...request, programScheduler: createProgramRuntimeScheduler() });
  const execution = await createTransactionalWorldPersistence(files).programExecutionForInteraction(request.interaction.id);
  assert.equal(JSON.stringify(execution.event).includes('do-not-store-history-in-trigger'), false);
  assert.match(execution.event.binding, /^[a-f0-9]{64}$/u);
  await assert.rejects(createLegacyWorldService().executeLegacy({ ...request, history: [] }), { code: 'ATOM_INTERACTION_ID_CONFLICT' });
});
