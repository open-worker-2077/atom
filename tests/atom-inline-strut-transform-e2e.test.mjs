import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

const atom = (thing, situation = '', strut = [], type = '') => ({
  [`thing${type ? `@${type}` : ''}`]: thing,
  situation,
  slot: [],
  strut
});

test('CLI Transform $click executes the Strut-owned predicate and delivers true without mutating facts', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-inline-strut-action-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const source = atom('Source', '42', [{
    'if@current': true,
    if: [{ program: [
      'def main(context):',
      "    return (context['antecedents'][0]['situation'] == '42'",
      "            and context['transform']['action'] == 'click')"
    ].join('\n') }],
    then: [{ thing: 'Result' }]
  }]);
  const subscriber = atom('Subscriber', [
    'def receive(delivery):',
    '    message({"level":"info","text":"true→" + delivery["consequentPath"]})',
    'trigger("strut", {"nodes":["Result"]}, receive)'
  ].join('\n'), [], 'program');
  const world = [source, atom('Result', 'locked'), subscriber];
  await fs.writeFile(contextFile, JSON.stringify(world, null, 2), 'utf8');

  const result = await executeAtomLanguage({
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing$click":"Source"}',
    interaction: { id: `inline-strut-${crypto.randomUUID()}` }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.changed, false);
  assert.deepEqual(result.messages.map(({ text }) => text), ['true→Result']);
  assert.deepEqual(JSON.parse(await fs.readFile(contextFile, 'utf8')), world);
});

test('a compound Strut receives every upstream fact and false produces no downstream delivery', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-compound-inline-strut-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const hub = atom('Hub', 'pending', [{
    if: [{ and: [
      { thing: 'Price' },
      { thing: 'Stock' },
      { program: [
        'def main(context):',
        "    values = [item['situation'] for item in context['antecedents']]",
        "    return values == ['101', '0']"
      ].join('\n') }
    ] }],
    'then@current': true
  }]);
  const subscriber = atom('Subscriber', [
    'def receive(delivery):',
    '    message({"level":"info","text":"unexpected"})',
    'trigger("strut", {"nodes":["Hub"]}, receive)'
  ].join('\n'), [], 'program');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Price', '100'), atom('Stock', '0'), hub, subscriber
  ], null, 2), 'utf8');

  const result = await executeAtomLanguage({
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing$click":"Price"}',
    interaction: { id: `compound-strut-${crypto.randomUUID()}` }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.messages, []);
});

test('an ordinary upstream Transform can make the inline predicate true and advance the downstream fact', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-inline-strut-progress-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const source = atom('阶段一', '🏃‍♀️', [{
    'if@current': true,
    if: [{ program: [
      'def main(context):',
      "    return context['antecedents'][0]['situation'] == '✅'"
    ].join('\n') }],
    then: [{ thing: '阶段二' }]
  }]);
  const subscriber = atom('总控', [
    'def receive(delivery):',
    "    transform({'thing':'阶段二','situation.rep.🏃‍♀️':None})",
    'trigger("strut", {"nodes":["阶段二"]}, receive)'
  ].join('\n'), [], 'program');
  await fs.writeFile(contextFile, JSON.stringify([
    source, atom('阶段二', '⌛️🔒'), subscriber
  ], null, 2), 'utf8');

  const result = await executeAtomLanguage({
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler(),
    source: 'transform {"thing":"阶段一","situation.rep.✅"}',
    interaction: { id: `inline-strut-progress-${crypto.randomUUID()}` }
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(stored.find((entry) => entry.thing === '阶段一').situation, '✅');
  assert.equal(stored.find((entry) => entry.thing === '阶段二').situation, '🏃‍♀️');
});
