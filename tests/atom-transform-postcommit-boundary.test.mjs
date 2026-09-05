import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
  assert.equal(result.subsequentExecution.status, 'completed');
  assert.equal(result.warnings.some(({ code }) => code === 'ATOM_SUBSEQUENT_EXECUTION_PENDING'), false);
  assert.equal(notificationCount, 1);
});

test('a subsequent effects CAS conflict preserves the source and reports the actual latest world', async (t) => {
  const runtime = await fixture(t, [
    'def receive(delivery):',
    '    transform({"thing":"Result","situation.rep.after":"before"})',
    'trigger("strut", {}, receive)'
  ].join('\n'));
  const initial = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  initial.push(atom('Other', 'before'));
  await fs.writeFile(runtime.contextFile, JSON.stringify(initial, null, 2), 'utf8');

  const result = await executeAtomLanguage({
    ...runtime,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: `effects-cas-${crypto.randomUUID()}` },
    async onCommitted() {
      const concurrent = await executeAtomLanguage({
        ...runtime,
        trustedMaintenance: true,
        source: 'transform {"thing":"Other","situation.rep.after":"before"}',
        interaction: { id: `concurrent-${crypto.randomUUID()}` }
      });
      assert.equal(concurrent.ok, true, JSON.stringify(concurrent));
    }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'failed');
  assert.ok(result.subsequentExecution.errors.some(({ code }) => code === 'WORLD_REVISION_CONFLICT'));
  const stored = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(find(stored, 'Source').situation, 'after');
  assert.equal(find(stored, 'Other').situation, 'after');
  assert.equal(find(stored, 'Result').situation, 'before');
  assert.equal(result.revisionAfter, result.subsequentExecution.revisionAfter);
  assert.notEqual(result.revisionAfter, result.subsequentExecution.sourceRevision);
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

  await assert.rejects(executeAtomLanguage({
    contextFile, projectionFile, programScheduler: createProgramRuntimeScheduler(),
    source: `transform new ${JSON.stringify({
      'thing@program': 'CreatedProgram', situation: program, slot: [], strut: []
    })}`,
    interaction: { id: `create-source-${crypto.randomUUID()}` },
    onCommitted() {
      throw Object.assign(new Error('callback failed'), { code: 'CALLBACK_FAILED' });
    }
  }), { code: 'CALLBACK_FAILED' });

  assert.ok(find(JSON.parse(await fs.readFile(contextFile, 'utf8')), 'CreatedProgram'));
});

test('an auxiliary mirror failure after subsequent facts commit preserves the committed revision', async (t) => {
  const runtime = await fixture(t, [
    'def receive(delivery):',
    '    transform({"thing":"Result","situation.rep.after":"before"})',
    'trigger("strut", {}, receive)'
  ].join('\n'));
  let writes = 0;
  const result = await executeAtomLanguageKernel({
    ...runtime,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing":"Source","situation.rep.after":"before"}',
    interaction: { id: `mirror-after-effects-${crypto.randomUUID()}` },
    programMode: 'reconcile',
    async commitWorld({ facts, expectedRevision, nextRevision }) {
      writes += 1;
      await fs.writeFile(runtime.contextFile, JSON.stringify(facts, null, 2), 'utf8');
      const receipt = {
        beforeRevision: expectedRevision,
        afterRevision: nextRevision,
        result: {}
      };
      if (writes === 2) {
        throw Object.assign(new Error('mirror unavailable'), {
          code: 'MIRROR_UNAVAILABLE', details: { receipt }
        });
      }
      return receipt;
    }
  });

  const stored = JSON.parse(await fs.readFile(runtime.contextFile, 'utf8'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.subsequentExecution.status, 'completed');
  assert.deepEqual(result.subsequentExecution.errors, []);
  assert.equal(find(stored, 'Source').situation, 'after');
  assert.equal(find(stored, 'Result').situation, 'after');
  assert.equal(result.revisionAfter, result.subsequentExecution.revisionAfter);
  assert.equal(result.revisionAfter, result.warnings.find(({ code }) => (
    code === 'MIRROR_UNAVAILABLE'
  ))?.receipt?.afterRevision?.replace(/^sha256:/u, ''));
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
