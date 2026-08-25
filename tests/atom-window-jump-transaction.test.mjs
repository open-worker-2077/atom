import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeProgramExplore } from '../work-engine/atom-language/engine.mjs';

function atom(name, detail = '', children = [], type = '') {
  return { [`name${type ? `@${type}` : ''}`]: name, detail, children, partners: [] };
}

async function fixture(t, atoms) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-window-jump-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');
  return { contextFile, projectionFile };
}

function jumpWorld(destination = 'Root/B') {
  return [atom('Root', '', [
    atom('A', '', [atom('Window', '', [], 'agent')]),
    atom('B'),
    atom('When', 'def main(arguments):\n    return True', [], 'program'),
    atom('Where', `def main(arguments):\n    return explore({"name":"${destination}"})[0]`, [], 'program'),
    atom('Registration', [
      'target = explore({"name":"Root"})[0]',
      'jump({',
      '  "when": explore({"name":"Root/When"})[0],',
      '  "where": explore({"name":"Root/Where"})[0],',
      '  "lock": {"read":{"allow":[{"priority":2,"from":target,"descendants":"all"}]}}',
      '})'
    ].join('\n'), [], 'program')
  ])];
}

function childNames(atomValue) {
  return (atomValue.children ?? []).map((entry) => Object.entries(entry)
    .find(([key]) => key === 'name' || key.startsWith('name@'))?.[1]);
}

function nameOf(atomValue) {
  return Object.entries(atomValue).find(([key]) => key === 'name' || key.startsWith('name@'))?.[1];
}

test('successful jump moves the active Agent in the same authoritative commit', async (t) => {
  const files = await fixture(t, jumpWorld());
  const scheduler = createProgramRuntimeScheduler();
  const result = await executeAtomLanguage({
    source: 'atom', ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(childNames(stored[0].children[0]), []);
  assert.deepEqual(childNames(stored[0].children[1]), ['Window']);
  assert.equal(scheduler.activeWindowSelfLocks.has('Root/A/Window'), false);
  assert.equal(scheduler.activeWindowSelfLocks.has('Root/B/Window'), true);
});

test('invalid destination rolls back the entire jump candidate with a stable error', async (t) => {
  const initial = jumpWorld('Root/Missing');
  const files = await fixture(t, initial);
  const scheduler = createProgramRuntimeScheduler();
  const result = await executeAtomLanguage({
    source: 'atom', ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'WINDOW_JUMP_DESTINATION_INVALID'));
  assert.deepEqual(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), initial);
});

test('default self-lock denial leaves the window in place', async (t) => {
  const initial = jumpWorld();
  const registration = initial[0].children.find((entry) => nameOf(entry) === 'Registration');
  registration.detail = registration.detail.replace(
    ',\n  "lock": {"read":{"allow":[{"priority":2,"from":target,"descendants":"all"}]}}', ''
  );
  const files = await fixture(t, initial);
  const result = await executeAtomLanguage({
    source: 'atom', ...files,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'WINDOW_JUMP_LOCK_DENIED'));
  assert.deepEqual(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), initial);
});

test('recycle true removes the active window without evaluating when or where', async (t) => {
  const initial = [atom('Root', '', [
    atom('A', '', [
      atom('Window', '', [], 'agent'),
      atom('Recycle', 'def main(arguments):\n    return True', [], 'program')
    ]),
    atom('Registration', 'jump({"recycle":explore({"name":"Root/A/Recycle"})[0]})', [], 'program')
  ])];
  const files = await fixture(t, initial);
  const scheduler = createProgramRuntimeScheduler();
  const result = await executeAtomLanguage({
    source: 'atom', ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(childNames(stored[0].children[0]), ['Recycle']);
  assert.equal(scheduler.activeWindowAgents.has('Root/A/Window'), false);
});

test('cyclic destination and downstream failure both roll back the moved window', async (t) => {
  for (const mode of ['cycle', 'downstream']) {
    const initial = mode === 'cycle'
      ? jumpWorld('Root/A/Window')
      : jumpWorld();
    if (mode === 'downstream') {
      initial[0].children.push(atom(
        'BrokenEffect',
        'transform({"name":"Missing","detail.rep.value":None})',
        [], 'program'
      ));
    }
    const files = await fixture(t, initial);
    const result = await executeAtomLanguage({
      source: 'atom', ...files,
      programScheduler: createProgramRuntimeScheduler(),
      interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
    });
    assert.equal(result.ok, false, mode);
    assert.deepEqual(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), initial);
  }
});

test('rebinding a scoped changed probe removes instance A and triggers only instance B without rewriting template support', async () => {
  const world = [atom('Root', '', [
    atom('Template', '', [], ''),
    atom('A', '', [atom('Monitor')]),
    atom('B', '', [atom('Monitor')]),
    atom('Probe', [
      'point = explore({"name":"./Monitor"})[0]',
      'if changed([point]):',
      '    message({"level":"info","text":"hit"})'
    ].join('\n'), [], 'program')
  ])];
  world[0].children[0].partners = [{ verb: 'support', object: './Monitor' }];
  const supportBefore = JSON.stringify(world[0].children[0].partners);
  const scheduler = createProgramRuntimeScheduler();
  const scopedExplore = (request, context = {}) => executeProgramExplore({
    atoms: world, request, scopeRoot: context.scopeRoot ?? null
  });
  await scheduler.refresh(world, {
    programSelector: 'Root/Probe', force: true, slotScopeRoot: 'Root/A',
    agentOrigin: { path: 'Root/A/Window' }, executeExplore: scopedExplore
  });
  assert.equal(scheduler.triggerIndex.has('transform\0Root/A/Monitor'), true);

  await scheduler.refresh(world, {
    programSelector: 'Root/Probe', force: true, slotScopeRoot: 'Root/B',
    agentOrigin: { path: 'Root/B/Window' }, executeExplore: scopedExplore
  });
  assert.equal(scheduler.triggerIndex.has('transform\0Root/A/Monitor'), false);
  assert.equal(scheduler.triggerIndex.has('transform\0Root/B/Monitor'), true);

  const miss = await scheduler.refresh(world, {
    triggerEvent: { mode: 'transform', nodes: ['Root/A/Monitor'] },
    slotScopeRoot: 'Root/B', agentOrigin: { path: 'Root/B/Window' },
    executeExplore: scopedExplore
  });
  assert.deepEqual(miss.messages, []);
  const hit = await scheduler.refresh(world, {
    triggerEvent: { mode: 'transform', nodes: ['Root/B/Monitor'] },
    slotScopeRoot: 'Root/B', agentOrigin: { path: 'Root/B/Window' },
    executeExplore: scopedExplore
  });
  assert.deepEqual(hit.messages.map((entry) => entry.text), ['hit']);
  assert.equal(JSON.stringify(world[0].children[0].partners), supportBefore);
});
