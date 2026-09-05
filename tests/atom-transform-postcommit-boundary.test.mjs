import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
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
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
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
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
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
