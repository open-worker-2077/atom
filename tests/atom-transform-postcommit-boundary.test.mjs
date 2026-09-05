import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createLegacyWorldService } from '../src/atom-system/adapters/legacy-engine-adapter.mjs';
import { createTransactionalWorldPersistence } from '../src/atom-system/adapters/transactional-world-persistence.mjs';
import { createJsonTransactionJournal, createJsonWorldRepository } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createInteractionRuntime } from '../src/atom-system/public/interaction-runtime.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
import { createCommitCoordinator } from '../src/atom-system/world-runtime/commit-coordinator.mjs';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { executeAtomCommandEndpoint } from '../work-engine/atom-language/cli.mjs';

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

test('a terminal-only engine callback never reports a missing source notification callback as failure', async (t) => {
  const files = await fixture(t, 'def receive(delivery):\n    return True\ntrigger("strut", {}, receive)');
  const persistence = createTransactionalWorldPersistence(files);
  let notifications = 0;
  const result = await executeAtomLanguageKernel({ ...files,
    source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: 'terminal-only-callback' }, programMode: 'reconcile',
    programScheduler: createProgramRuntimeScheduler(), commitWorld: transition => persistence.commit(transition),
    onSubsequentSettled(value) { notifications += 1; assert.equal(value.subsequentExecution.status, 'completed'); }
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(notifications, 1);
  assert.equal(result.warnings.some(({ code }) => code === 'ATOM_COMMITTED_NOTIFICATION_FAILED'), false);
  assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Source').situation, 'after');
});

test('a worker runtime timeout is a final business failure and same-id reread never reruns it', async (t) => {
  const files = await fixture(t, 'def receive(delivery):\n    while True:\n        pass\ntrigger("strut", {}, receive)');
  const request = { ...files, source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: 'determined-worker-timeout' }, programMode: 'reconcile' };
  const first = await createLegacyWorldService().executeLegacy({ ...request,
    programScheduler: createProgramRuntimeScheduler({ timeoutMs: 500 }) });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.subsequentExecution.status, 'failed');
  assert.ok(first.subsequentExecution.errors.some(({ code }) => code === 'ATOM_PROGRAM_TIMEOUT'));
  const scheduler = createProgramRuntimeScheduler();
  scheduler.runProgram = () => { throw new Error('determined worker timeout must not replay'); };
  const repeated = await createLegacyWorldService().executeLegacy({ ...request, programScheduler: scheduler });
  assert.equal(repeated.subsequentExecution.status, 'failed');
  assert.equal(repeated.subsequentExecution.attemptId, first.subsequentExecution.attemptId);
});

for (const businessStatus of ['completed', 'failed']) {
  test(`durable ${businessStatus} business outcome precedes deferred projection and survives its late abort`, async (t) => {
    const files = await fixture(t, businessStatus === 'completed'
      ? 'def receive(delivery):\n    return True\ntrigger("strut", {}, receive)'
      : 'def receive(delivery):\n    raise Exception("known business failure")\ntrigger("strut", {}, receive)');
    const scheduler = createProgramRuntimeScheduler();
    let entered, release;
    const projectionStarted = new Promise(resolve => { entered = resolve; });
    const projectionGate = new Promise(resolve => { release = resolve; });
    scheduler.rebaseContextFreeProjection = async () => {
      entered(); await projectionGate;
      throw Object.assign(new Error('late projection failure'), { code: 'PROJECTION_UNAVAILABLE' });
    };
    const refresh = scheduler.refresh.bind(scheduler);
    let projectionEntered = false;
    scheduler.refresh = async (...args) => {
      if (projectionEntered) throw Object.assign(new Error('projection aborted'), { code: 'PROJECTION_ABORTED' });
      return refresh(...args);
    };
    const controller = new AbortController();
    let notifications = 0, terminalNotifications = 0;
    const request = { ...files, source: 'transform {"thing":"Source","situation.rep.after":"before"}',
      interaction: { id: `projection-terminal-${businessStatus}` }, programMode: 'reconcile' };
    const service = createLegacyWorldService();
    const unused = async () => { throw new Error('unexpected capability'); };
    const runtime = createInteractionRuntime({
      world: { execute: value => service.executeLegacy({ ...request, programScheduler: scheduler, ...value }) },
      projections: { publish: unused, recover: unused }, feedback: { submit: unused },
      agents: { resolve: unused }, humanStatus: { translate: unused }
    });
    const operation = runtime.execute({ source: request.source, correlationId: request.interaction.id }, {
      publish: false, signal: controller.signal, onCommitted() { notifications += 1; },
      onSubsequentSettled(result) {
        assert.equal(result.subsequentExecution.status, businessStatus);
        terminalNotifications += 1;
        if (businessStatus === 'failed') return Promise.reject(new Error('terminal notification unavailable'));
      }
    });
    t.after(async () => { release(); await operation.catch(() => {}); });
    await projectionStarted;
    projectionEntered = true;
    controller.abort(Object.assign(new Error('HTTP deadline during projection'), { code: 'ATOM_INTERACTION_TIMEOUT' }));
    const durable = await createTransactionalWorldPersistence(files).programExecutionForInteraction(request.interaction.id);
    assert.equal(durable.outcome.status, businessStatus, 'terminal business outcome must be durable before optional projection begins');
    assert.equal(terminalNotifications, 1, 'public runtime must expose the independently settled business result');
    assert.equal(durable.childReceipt, null, 'message-only completion and known failure do not invent effects');
    const duplicate = await service.executeLegacy(request);
    assert.equal(duplicate.subsequentExecution.status, businessStatus);
    release();
    const result = await operation;
    assert.equal(result.ok, true);
    assert.equal(result.subsequentExecution.status, businessStatus);
    assert.equal(notifications, 1);
    assert.ok(result.warnings.some(({ code }) => code === 'PROGRAM_PROJECTION_RECOVERY_PENDING'));
    if (businessStatus === 'failed') assert.ok(result.warnings.some(({ code }) => code === 'ATOM_SUBSEQUENT_NOTIFICATION_FAILED'));
    assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Source').situation, 'after');
    const final = await createTransactionalWorldPersistence(files).programExecutionForInteraction(request.interaction.id);
    assert.equal(final.outcome.status, businessStatus);
    assert.equal(final.sourceReceipt.commandId, durable.sourceReceipt.commandId);
  });
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

async function waitForCopiedAcceptanceWorld(marker, child, existingDirectories) {
  const prefix = 'atom-real-write-acceptance-';
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    for (const name of await fs.readdir(os.tmpdir())) {
      if (!name.startsWith(prefix) || existingDirectories.has(name)) continue;
      const contextFile = path.join(os.tmpdir(), name, 'atom.json');
      try {
        if ((await fs.readFile(contextFile, 'utf8')).includes(marker)) return contextFile;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (child.exitCode !== null) throw new Error('acceptance process exited before its source copy was observed');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for the isolated acceptance copy');
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
  let release, notify, firstTerminal;
  const blocked = new Promise(resolve => { release = resolve; });
  const committed = new Promise(resolve => { notify = resolve; });
  const first = createLegacyWorldService().executeLegacy({ ...request, programScheduler: createProgramRuntimeScheduler(),
    async onCommitted(result) { notify(result); await blocked; },
    onSubsequentSettled(result) { firstTerminal = result; } });
  await committed;
  const second = await createLegacyWorldService().executeLegacy({ ...request, programScheduler: createProgramRuntimeScheduler() });
  assert.equal(second.subsequentExecution.status, 'pending');
  let joinedNotification, joinedTerminal;
  const joined = createLegacyWorldService().executeLegacy({ ...request, programScheduler: createProgramRuntimeScheduler(),
    onCommitted(result) { joinedNotification = result; },
    onSubsequentSettled(result) { joinedTerminal = result; return Promise.reject(new Error('joined listener unavailable')); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(joinedNotification?.subsequentExecution.status, 'pending');
  release();
  const final = await first;
  assert.equal(final.subsequentExecution.status, 'completed');
  assert.equal((await joined).subsequentExecution.status, 'completed', 'a joined HTTP lifecycle must not settle permanently on pending');
  assert.equal(joinedTerminal?.subsequentExecution.status, 'completed');
  assert.equal(firstTerminal.warnings.some(({ code }) => code === 'ATOM_SUBSEQUENT_NOTIFICATION_FAILED'), false);
  assert.ok(final.warnings.some(({ code, correlationId }) => code === 'ATOM_SUBSEQUENT_NOTIFICATION_FAILED'
    && correlationId === request.interaction.id));
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

for (const sameBinding of [false, true]) {
test(`central binding settles consecutive-revision candidates while the first receipt append is paused (same binding ${sameBinding})`, async (t) => {
  const files = await fixture(t, '');
  const hooks = [];
  const first = createTransactionalWorldPersistence({ ...files, publishLegacyProjection: false,
    onAuthoritativeWrite: () => hooks.push('first') });
  const second = createTransactionalWorldPersistence({ ...files, publishLegacyProjection: false,
    onAuthoritativeWrite: () => hooks.push('second') });
  const before = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  const after = structuredClone(before); after[0].situation = 'after';
  const later = structuredClone(after); later[1].situation = 'illegal';
  let entered, release;
  const paused = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    if (String(args[0]).startsWith(path.dirname(files.contextFile)) && args[1] === 'a') {
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async (data, ...rest) => {
        const event = JSON.parse(data);
        if (event.type === 'committed' && event.receipt?.result?.postCommitEvent?.binding === 'first') {
          entered(); await gate;
        }
        return write(data, ...rest);
      };
    }
    return handle;
  });
  const transition = (facts, prior, binding) => ({ correlationId: 'paused-collision', facts,
    expectedRevision: revisionOfWorldFacts(prior), nextRevision: revisionOfWorldFacts(facts),
    changedPaths: ['Source', 'Result'], postCommitEvent: { binding } });
  const committed = first.commit(transition(after, before, 'first'));
  await paused;
  const competing = second.commit(transition(later, after, sameBinding ? 'first' : 'second'));
  const settled = Promise.allSettled([committed, competing]);
  await new Promise(resolve => setTimeout(resolve, 30));
  release();
  const results = await settled;
  assert.equal(results[0].status, 'fulfilled');
  if (sameBinding) {
    assert.equal(results[1].status, 'fulfilled');
    assert.deepEqual(results[1].value, results[0].value);
  } else {
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.code, 'ATOM_INTERACTION_ID_CONFLICT');
  }
  assert.deepEqual(hooks, ['first'], 'reused receipt cannot publish candidate facts or invoke its facade hook');
  assert.deepEqual(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), after);
  const journal = createJsonTransactionJournal({ file: path.join(path.dirname(files.contextFile), 'atom.transactions.json') });
  assert.equal((await journal.readState()).receipts.length, 1);
});
}

test('final outcome append and later effects share the central serialized decision', async (t) => {
  const files = await fixture(t, '');
  const persistence = createTransactionalWorldPersistence({ ...files, publishLegacyProjection: false });
  const before = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  const source = structuredClone(before); source[0].situation = 'after';
  const receipt = await persistence.commit({ correlationId: 'final-race', facts: source,
    expectedRevision: revisionOfWorldFacts(before), nextRevision: revisionOfWorldFacts(source),
    changedPaths: ['Source'], postCommitEvent: { binding: 'final-owner' } });
  let entered, release;
  const paused = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    if (String(args[0]).startsWith(path.dirname(files.contextFile)) && args[1] === 'a') {
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async (data, ...rest) => {
        if (JSON.parse(data).programOutcome?.status === 'failed') { entered(); await gate; }
        return write(data, ...rest);
      };
    }
    return handle;
  });
  const outcome = persistence.recordProgramExecution({ sourceCommandId: receipt.commandId,
    outcome: { status: 'failed', attemptId: 'final-race-attempt', errors: [{ code: 'BUSINESS_FAILED' }] } });
  await paused;
  const effects = structuredClone(source); effects[1].situation = 'illegal';
  const candidate = persistence.commit({ correlationId: 'final-race:subsequent', facts: effects,
    expectedRevision: revisionOfWorldFacts(source), nextRevision: revisionOfWorldFacts(effects),
    changedPaths: ['Result'], subsequentOf: receipt.commandId });
  const settled = Promise.allSettled([outcome, candidate]);
  await new Promise(resolve => setTimeout(resolve, 30));
  release();
  const results = await settled;
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'PROGRAM_EXECUTION_FINAL');
  assert.deepEqual(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), source);
  assert.equal((await persistence.programExecution(receipt.commandId)).childReceipt, null);
});

for (const outcomeStatus of ['failed', 'completed']) {
test(`outcome append EIO preserves source success and exposes recoverable outcome persistence (${outcomeStatus})`, async (t) => {
  const files = await fixture(t, outcomeStatus === 'failed'
    ? 'def receive(delivery):\n    raise Exception("business failed")\ntrigger("strut", {}, receive)'
    : 'def receive(delivery):\n    transform({"thing":"Result","situation.rep.after":"before"})\ntrigger("strut", {}, receive)');
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    if (String(args[0]).startsWith(path.dirname(files.contextFile)) && args[1] === 'a') {
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async (data, ...rest) => {
        if (JSON.parse(data).programOutcome?.status === outcomeStatus) throw Object.assign(new Error('outcome disk unavailable'), { code: 'EIO' });
        return write(data, ...rest);
      };
    }
    return handle;
  });
  let notified = 0, terminalNotified = 0;
  const request = { ...files, source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: 'outcome-eio' }, programMode: 'reconcile' };
  const result = await createLegacyWorldService().executeLegacy({ ...request,
    programScheduler: createProgramRuntimeScheduler(), onCommitted() { notified += 1; },
    onSubsequentSettled() { terminalNotified += 1; } });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(notified, 1);
  assert.equal(terminalNotified, 0, 'failed durable recording must not publish a terminal lifecycle notification');
  assert.equal(result.subsequentExecution.status, 'pending');
  assert.ok(result.warnings.some(({ code, cause }) => code === 'ATOM_PROGRAM_OUTCOME_PERSISTENCE_PENDING' && cause === 'EIO'));
  assert.equal(find(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), 'Source').situation, 'after');
  assert.equal((await createTransactionalWorldPersistence(files).programExecutionForInteraction(request.interaction.id)).outcome.status,
    outcomeStatus === 'completed' ? 'completed' : 'pending');
  t.mock.restoreAll();
  const scheduler = createProgramRuntimeScheduler();
  if (outcomeStatus === 'completed') scheduler.runProgram = () => { throw new Error('confirmed effects were replayed'); };
  const recovered = await createLegacyWorldService().executeLegacy({ ...request, programScheduler: scheduler });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.subsequentExecution.status, outcomeStatus);
});
}

for (const batch of [false, true]) {
  test(`unchanged source binds actual effects for cold reread without rerunning Program (batch ${batch})`, async (t) => {
    const files = await fixture(t, 'def receive(delivery):\n    transform({"thing":"Result","situation.rep.after":"before"})\ntrigger("strut", {}, receive)');
    const transform = { thing: 'Source', 'situation.rep.before': 'before' };
    const request = { ...files, source: `transform ${JSON.stringify(batch ? [transform] : transform)}`,
      interaction: { id: `no-source-effects-${batch}` }, programMode: 'reconcile' };
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { createLegacyWorldService } from ${JSON.stringify(new URL('../src/atom-system/adapters/legacy-engine-adapter.mjs', import.meta.url).href)};
      import { createProgramRuntimeScheduler } from ${JSON.stringify(new URL('../work-engine/atom-language/program-runtime.mjs', import.meta.url).href)};
      await createLegacyWorldService({ onAuthoritativeWrite() { process.exit(73); } }).executeLegacy({
        ...${JSON.stringify(request)}, programScheduler: createProgramRuntimeScheduler() });
    `], { encoding: 'utf8', timeout: 60000 });
    assert.equal(child.status, 73, child.stderr);
    const scheduler = createProgramRuntimeScheduler();
    let workerCalls = 0;
    const run = scheduler.runProgram.bind(scheduler);
    scheduler.runProgram = async input => { workerCalls += 1; return run(input); };
    const result = await createLegacyWorldService().executeLegacy({ ...request, programScheduler: scheduler });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.subsequentExecution.status, 'completed');
    assert.equal(workerCalls, 0, 'a confirmed effects receipt must prevent cold Program replay');
    const execution = await createTransactionalWorldPersistence(files).programExecutionForInteraction(request.interaction.id);
    assert.ok(execution);
    assert.equal(execution.childReceipt.commandId, execution.sourceReceipt.commandId);
    assert.equal(execution.event.sourceChanged, false);
    const journal = createJsonTransactionJournal({ file: path.join(path.dirname(files.contextFile), 'atom.transactions.json') });
    assert.equal((await journal.readState()).receipts.length, 1, 'only the real effects world transition exists');
    const facts = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
    assert.equal(find(facts, 'Source').situation, 'before');
    assert.equal(find(facts, 'Result').situation, 'after');
    await assert.rejects(createLegacyWorldService().executeLegacy({ ...request, source: 'explore Source' }), { code: 'ATOM_INTERACTION_ID_CONFLICT' });
  });
}

test('deployment-copy acceptance fails when its source changes after the private snapshot', async (t) => {
  const marker = `source-safety-${crypto.randomUUID()}`;
  const sourceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-postcommit-source-safety-'));
  const contextFile = path.join(sourceDirectory, 'atom.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Deployment Agent', [
      `marker = ${JSON.stringify(marker)}`,
      'agent({"labels":[],"functions":{"groups":[],"names":["explore","transform"]}})'
    ].join('\n'), [], [], ['program']),
    atom('默认备份仓', '', [], [], ['backup', 'default'])
  ], null, 2), 'utf8');
  t.after(() => fs.rm(sourceDirectory, { recursive: true, force: true }));

  const script = path.resolve(import.meta.dirname, '..', 'scripts', 'accept-real-world-write-copy.mjs');
  const existingAcceptanceDirectories = new Set((await fs.readdir(os.tmpdir())).filter((name) => (
    name.startsWith('atom-real-write-acceptance-')
  )));
  const child = spawn(process.execPath, [
    script, '--context', contextFile, '--agent', 'Deployment Agent', '--structural-latency'
  ], { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  await waitForCopiedAcceptanceWorld(marker, child, existingAcceptanceDirectories);
  await fs.appendFile(contextFile, '\n', 'utf8');
  const { code, signal } = await exited;
  assert.equal(signal, null, stderr);
  assert.equal(code, 1, stderr);
  const result = JSON.parse(stdout);
  assert.equal(result.sourceContextUnchanged, false);
  assert.equal(result.ok, false, JSON.stringify(result));
});

test('rename-copy acceptance rereads one stable interaction and proves Strut and shortcut conservation', async (t) => {
  const sourceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-postcommit-rename-source-'));
  const contextFile = path.join(sourceDirectory, 'atom.json');
  const target = 'Acceptance Agent/Parent/Old';
  const renamed = 'Acceptance Agent/Parent/Renamed';
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Acceptance Agent', [
      'agent({"labels":["^"],"functions":{"groups":[],"names":["explore","transform"]}})'
    ].join('\n'), [
      atom('Parent', '', [
        atom('Old', 'target body', [atom('Child', 'child body')], [{
          'if@current': true,
          then: [{ thing: 'Peer' }]
        }]),
        atom('Peer', 'peer body', [], [{
          'if@current': true,
          then: [{ thing: `${target}/Child` }]
        }])
      ]),
      atom('Reference Host', '', [{
        'thing@shortcut': 'Target Reference',
        situation: JSON.stringify({
          contract: 'atom.shortcut', version: 1, referenceId: 'acceptance-reference',
          target: { state: 'linked', path: `${target}/Child` }
        }),
        slot: [], strut: []
      }])
    ], [], ['program'])
  ], null, 2), 'utf8');
  t.after(() => fs.rm(sourceDirectory, { recursive: true, force: true }));

  const script = path.resolve(import.meta.dirname, '..', 'scripts', 'accept-rename-world-copy.mjs');
  const run = spawnSync(process.execPath, [
    script, '--context', contextFile, '--agent', 'Acceptance Agent', '--target', target, '--name', 'Renamed'
  ], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8', timeout: 60_000 });
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.write.ok, true);
  assert.equal(result.finalReceipt.ok, true);
  assert.equal(result.finalReceipt.interactionId, result.interactionId);
  assert.equal(result.finalReceipt.subsequentExecution.status, 'completed');
  assert.equal(result.immediateReadback.ok, true);
  assert.ok(JSON.stringify(result.immediateReadback).includes(renamed));
  assert.equal(result.thingConserved, true);
  assert.equal(result.situationConserved, true);
  assert.equal(result.slotConserved, true);
  assert.equal(result.strutConserved, true);
  assert.equal(result.shortcutReferencesConserved, true);
  assert.equal(result.fourAxesConserved, true);
  assert.equal(result.sourceUnchanged, true);
  assert.match(result.directory, /atom-rename-acceptance-/u);
});

test('public ordinary Agent keeps source success separate from failed and repaired subsequent events', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-postcommit-public-journey-'));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const failingProgram = [
    'def receive(delivery):',
    '    transform({"thing":"Public Agent/Missing","situation.rep.after":"before"})',
    'trigger("strut", {}, receive)'
  ].join('\n');
  const repairedProgram = [
    'def receive(delivery):',
    '    transform({"thing":"Public Agent/Result","situation.rep.after":"before"})',
    'trigger("strut", {}, receive)'
  ].join('\n');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Public Agent', 'agent({"labels":["^"],"functions":{"groups":[],"names":["explore","transform","trigger"]}})', [
      atom('Source', 'before', [], [{
        'if@current': true,
        if: [{ program: 'def main(context):\n    return True' }],
        then: [{ 'thing@program': 'Subscriber' }]
      }]),
      atom('Result', 'before'),
      atom('Subscriber', failingProgram, [], [], ['program'])
    ], [], ['program'])
  ], null, 2), 'utf8');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, contextFile, graphFile, storeFile });
  t.after(() => running.close());
  assert.notEqual(running.port, 4784);
  const endpoint = `${running.url}/__atom/api/command`;
  const command = (source, id = crypto.randomUUID()) => executeAtomCommandEndpoint({
    source,
    interaction: { id, agentSelector: 'Public Agent', agent: { path: 'Public Agent' } }
  }, endpoint);
  const finalReceipt = async (source, id) => {
    const deadline = Date.now() + 10_000;
    let receipt;
    do {
      receipt = await command(source, id);
      if (receipt.subsequentExecution?.status !== 'pending') return receipt;
      await new Promise((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    return receipt;
  };

  const source = 'transform {"thing":"Public Agent/Source","situation.rep.after":"before"}';
  const sourceInteraction = `public-source-${crypto.randomUUID()}`;
  const first = await command(source, sourceInteraction);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.ok(['pending', 'failed'].includes(first.subsequentExecution.status), JSON.stringify(first));
  const immediate = await command('explore {"thing":"Public Agent/Source","situation$full":true}');
  assert.equal(immediate.ok, true, JSON.stringify(immediate));
  assert.equal(immediate.items[0].matches[0].situation, 'after', JSON.stringify(immediate));
  const final = await finalReceipt(source, sourceInteraction);
  assert.equal(final.ok, true, JSON.stringify(final));
  assert.equal(final.subsequentExecution.status, 'failed', JSON.stringify(final));
  assert.ok(final.subsequentExecution.errors.some(({ code }) => code === 'ATOM_NOT_FOUND'), JSON.stringify(final));

  const repair = await command(`transform ${JSON.stringify({
    thing: 'Public Agent/Subscriber',
    [`situation.rep.${repairedProgram}`]: failingProgram
  })}`);
  assert.equal(repair.ok, true, JSON.stringify(repair));
  const nextSource = 'transform {"thing":"Public Agent/Source","situation.rep.final":"after"}';
  const nextInteraction = `public-next-${crypto.randomUUID()}`;
  const next = await command(nextSource, nextInteraction);
  assert.equal(next.ok, true, JSON.stringify(next));
  const nextFinal = await finalReceipt(nextSource, nextInteraction);
  assert.equal(nextFinal.subsequentExecution.status, 'completed', JSON.stringify(nextFinal));
  const result = await command('explore {"thing":"Public Agent/Result","situation$full":true}');
  assert.equal(result.items[0].matches[0].situation, 'after', JSON.stringify(result));
});
