import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createJsonProgramProjectionRepository } from '../src/atom-system/adapters/json-program-projection-repository.mjs';
import { createJsonRequestDrivenLockRepository } from '../src/atom-system/adapters/json-request-driven-lock-repository.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeProgramExplore } from '../work-engine/atom-language/engine.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
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
    atom('Where', `def main(arguments):\n    return explore({"thing":"${destination}"})[0]`, [], 'program'),
    atom('Registration', [
      'target = explore({"thing":"Root"})[0]',
      'jump({',
      '  "when": explore({"thing":"Root/When"})[0],',
      '  "where": explore({"thing":"Root/Where"})[0],',
      '  "lock": {"read":{"allow":[{"priority":2,"from":target,"descendants":"all"}]}}',
      '})'
    ].join('\n'), [], 'program')
  ])];
}

function fourAxisJumpWorld(when) {
  return [atom('Root', '', [
    atom('Audit', '', [], 'agent'),
    atom('A', '', [atom('Window', '', [
      atom('When', `def main(arguments):\n    return ${when ? 'True' : 'False'}`, [], 'program'),
      atom('Where', 'def main(arguments):\n    return explore({"thing":"Root/B"})[0]', [], 'program'),
      atom('Registration', [
        'when_program = explore({"thing":"Root/A/Window/When"})[0]',
        'where_program = explore({"thing":"Root/A/Window/Where"})[0]',
        'destination = explore({"thing":"Root/B"})[0]',
        'jump({',
        '  "when": when_program,',
        '  "where": where_program,',
        '  "lock": {"read":{"allow":[',
        '    {"priority":2,"from":"current","descendants":"all"},',
        '    {"priority":2,"from":destination,"descendants":"all"}',
        '  ]}}',
        '})'
      ].join('\n'), [], 'program')
    ], 'agent')]),
    atom('B', '', [atom('Payload')])
  ])];
}

function contaminateInternalExploreSnapshot(scheduler) {
  for (const method of ['refresh', 'current']) {
    const original = scheduler[method].bind(scheduler);
    scheduler[method] = async (...arguments_) => {
      const cycle = await original(...arguments_);
      return {
        ...cycle,
        exploreRequests: [
          ...(cycle.exploreRequests ?? []),
          { thing: 'Root/B', children: true }
        ]
      };
    };
  }
  return scheduler;
}

function childNames(atomValue) {
  return (atomValue.contain ?? []).map((entry) => Object.entries(entry)
    .find(([key]) => key === 'thing' || key.startsWith('thing@'))?.[1]);
}

function nameOf(atomValue) {
  return Object.entries(atomValue).find(([key]) => key === 'thing' || key.startsWith('thing@'))?.[1];
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
  assert.deepEqual(childNames(stored[0].contain[0]), []);
  assert.deepEqual(childNames(stored[0].contain[1]), ['Window']);
  assert.equal(scheduler.activeWindowSelfLocks.has('Root/A/Window'), false);
  assert.equal(scheduler.activeWindowSelfLocks.has('Root/B/Window'), true);
});

test('the next public exact Explore after a jump enforces the remapped active self-lock', async (t) => {
  const initial = [atom('Root', '', [
    atom('A', '', [atom('Window', '', [], 'agent')]),
    atom('B'),
    atom('When', 'def main(arguments):\n    return True', [], 'program'),
    atom('Where', 'def main(arguments):\n    return explore({"thing":"Root/B"})[0]', [], 'program'),
    atom('Registration', [
      'when_program = explore({"thing":"Root/When"})[0]',
      'where_program = explore({"thing":"Root/Where"})[0]',
      'destination = explore({"thing":"Root/B"})[0]',
      'jump({',
      '  "when": when_program,',
      '  "where": where_program,',
      '  "lock": {"read":{"allow":[',
      '    {"priority":2,"from":when_program},',
      '    {"priority":2,"from":where_program},',
      '    {"priority":2,"from":destination}',
      '  ]}}',
      '})'
    ].join('\n'), [], 'program')
  ])];
  const files = await fixture(t, initial);
  const scheduler = createProgramRuntimeScheduler();
  // Keep the public four-axis fixture executable on this pre-Graph AtomView branch.
  const legacyExploreRequest = (request) => Object.fromEntries(
    Object.entries(request).map(([key, value]) => [
      key.replace(/^thing(?=$|[.@$])/u, 'name')
        .replace(/^situation(?=$|[.@$])/u, 'detail')
        .replace(/^contain(?=$|[.@$])/u, 'children')
        .replace(/^support(?=$|[.@$])/u, 'partners'),
      value
    ])
  );
  let legacyRuntime = false;
  const refresh = scheduler.refresh.bind(scheduler);
  scheduler.refresh = async (atoms, options = {}) => {
    const cycle = await refresh(atoms, {
      ...options,
      executeExplore: async (request, context) => {
        try {
          return await options.executeExplore(request, context);
        } catch (error) {
          if (error?.code !== 'UNKNOWN_GRAPH_FIELD') throw error;
          legacyRuntime = true;
          return options.executeExplore(legacyExploreRequest(request), context);
        }
      }
    });
    return legacyRuntime
      ? { ...cycle, exploreRequests: cycle.exploreRequests.map(legacyExploreRequest) }
      : cycle;
  };

  const moved = await executeAtomLanguage({
    source: 'atom', ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
  });
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  assert.deepEqual(scheduler.activeWindowSelfLocks.get('Root/B/Window'), {
    read: {
      allow: [
        { priority: 2, fromPath: 'Root/When' },
        { priority: 2, fromPath: 'Root/Where' },
        { priority: 2, fromPath: 'Root/B' }
      ]
    }
  });

  const publicDeniedRequest = {
    source: 'explore {"thing":"Root/A","situation$full":true}', ...files,
    programMode: null,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/B/Window' } }
  };
  const publicDenied = await executeAtomLanguage(publicDeniedRequest);
  const denied = publicDenied.errors.some((error) => error.code === 'UNKNOWN_GRAPH_FIELD')
    ? await executeAtomLanguage({
        ...publicDeniedRequest,
        source: 'explore {"name":"Root/A","detail$full":true}'
      })
    : publicDenied;
  assert.equal(denied.ok, false, JSON.stringify(denied));
  assert.ok(denied.errors.some((error) => error.code === 'WINDOW_ACCESS_DENIED'));
  assert.equal(denied.items[0].ok, false);
});

test('public contain Explore is independent from stale internal projection axes around jump guards and moves', async (t) => {
  for (const when of [false, true]) {
    const files = await fixture(t, fourAxisJumpWorld(when));
    const scheduler = contaminateInternalExploreSnapshot(createProgramRuntimeScheduler());
    const source = when
      ? 'explore {"thing":"Root/B/Window","contain$latitude-1":true}'
      : 'explore {"thing":"Root/A/Window","contain$latitude-1":true}';
    const result = await executeAtomLanguage({
      source, ...files, programScheduler: scheduler,
      interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
    });
    assert.equal(result.ok, true, `${when ? 'when=true' : 'when=false'}: ${JSON.stringify(result.errors)}`);
    assert.equal(result.errors.some((error) => error.code === 'RETIRED_GRAPH_AXIS'), false);
  }

  const auditFiles = await fixture(t, fourAxisJumpWorld(false));
  const audit = await executeAtomLanguage({
    source: 'explore {"thing":"Root/Audit","contain$latitude-1":true}',
    ...auditFiles,
    programScheduler: contaminateInternalExploreSnapshot(createProgramRuntimeScheduler()),
    interaction: { agent: { ref: 'audit-ref', path: 'Root/Audit' } }
  });
  assert.equal(audit.ok, false, JSON.stringify(audit.errors));
  assert.ok(audit.errors.some((error) => error.code === 'WINDOW_JUMP_LOCK_DENIED'));
  assert.equal(audit.errors.some((error) => error.code === 'RETIRED_GRAPH_AXIS'), false);

  const legacy = await executeAtomLanguage({
    source: 'explore {"thing":"Root/Audit","children$latitude-1":true}',
    ...auditFiles,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: { agent: { ref: 'audit-ref', path: 'Root/Audit' } }
  });
  assert.equal(legacy.ok, false);
  assert.ok(legacy.errors.some((error) => error.code === 'RETIRED_GRAPH_AXIS'));
});

test('explicit run binds a window-relative jump guard while preserving its exact destination coordinate', async (t) => {
  const initial = [atom('Root', '', [
    atom('Job1', '', [
      atom('Window', '', [
        atom('Control', '完成'),
        atom('When', [
          'def main(arguments):',
          '    control = explore({"thing":"./Control","situation$full":True})[0]',
          '    return control.situation == "完成"'
        ].join('\n'), [], 'program'),
        atom('Where', 'def main(arguments):\n    return explore({"thing":"Root/Job2"})[0]', [], 'program'),
        atom('Registration', [
          'when_program = explore({"thing":"Root/Job1/Window/When"})[0]',
          'where_program = explore({"thing":"Root/Job1/Window/Where"})[0]',
          'destination = explore({"thing":"Root/Job2"})[0]',
          'jump({',
          '  "when": when_program,',
          '  "where": where_program,',
          '  "lock": {"read":{"allow":[',
          '    {"priority":2,"from":when_program},',
          '    {"priority":2,"from":where_program},',
          '    {"priority":2,"from":destination,"descendants":"all"}',
          '  ]}}',
          '})'
        ].join('\n'), [], 'program')
      ], 'agent')
    ]),
    atom('Job2')
  ])];
  const files = await fixture(t, initial);
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Job1/Window/Registration"}',
    ...files,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: { agent: { ref: 'window-ref', path: 'Root/Job1/Window' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(childNames(stored[0].contain[0]), []);
  assert.deepEqual(childNames(stored[0].contain[1]), ['Window']);
});

test('explicit jump commit persists a new passive base before later exact CLI requests', async (t) => {
  const initial = [atom('Root', '', [
    atom('Acceptance', '', [
      atom('Job1', '', [
        atom('Window', '', [
          atom('When', 'def main(arguments):\n    return True', [], 'program'),
          atom('Where', 'def main(arguments):\n    return explore({"thing":"Root/Acceptance/Job2"})[0]', [], 'program'),
          atom('Registration', [
            'when_program = explore({"thing":"Root/Acceptance/Job1/Window/When"})[0]',
            'where_program = explore({"thing":"Root/Acceptance/Job1/Window/Where"})[0]',
            'destination = explore({"thing":"Root/Acceptance/Job2"})[0]',
            'jump({',
            '  "when": when_program,',
            '  "where": where_program,',
            '  "lock": {"read":{"allow":[',
            '    {"priority":2,"from":destination,"descendants":"all"}',
            '  ]}}',
            '})'
          ].join('\n'), [], 'program')
        ], 'agent')
      ]),
      atom('Job2')
    ])
  ])];
  const files = await fixture(t, initial);
  const snapshotFile = path.join(path.dirname(files.contextFile), 'request-driven-locks.json');
  const programProjectionFile = path.join(path.dirname(files.contextFile), 'program-projection.json');
  const repository = createJsonRequestDrivenLockRepository({ file: snapshotFile });
  const projectionRepository = createJsonProgramProjectionRepository({ file: programProjectionFile });
  const scheduler = createProgramRuntimeScheduler({
    requestDrivenLockRepository: repository,
    projectionRepository
  });
  const movedPath = 'Root/Acceptance/Job2/Window';

  const initialized = await executeAtomLanguage({
    source: 'atom', ...files,
    programMode: 'project',
    programScheduler: scheduler,
    interaction: { id: 'startup-before-jump', agent: null }
  });
  assert.equal(initialized.ok, true, JSON.stringify(initialized.errors));
  const initialProjectionWorldKey = (await projectionRepository.load()).worldKey;

  const moved = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Acceptance/Job1/Window/Registration"}',
    ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/Acceptance/Job1/Window' } }
  });
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  assert.deepEqual((await repository.load()).windowSelfLocks.map((entry) => entry.agentPath), [movedPath]);
  assert.notEqual((await projectionRepository.load()).worldKey, initialProjectionWorldKey);

  let restartedExecutions = 0;
  const restarted = createProgramRuntimeScheduler({
    requestDrivenLockRepository: repository,
    projectionRepository,
    runProgram: async () => {
      restartedExecutions += 1;
      throw new Error('same-revision passive reads must not execute Programs');
    }
  });
  const interaction = { agent: { ref: 'window-ref', path: movedPath } };
  const prepared = await executeAtomLanguage({
    source: 'atom', ...files,
    programMode: 'passive',
    programScheduler: restarted,
    interaction
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
  assert.equal(prepared.revisionAfter, moved.revisionAfter);
  assert.equal(restartedExecutions, 0);

  const request = (source) => executeAtomLanguage({
    source,
    ...files,
    programMode: null,
    programScheduler: restarted,
    interaction
  });

  const parent = await request('explore {"thing":"Root/Acceptance/Job2","situation$full":true}');
  assert.equal(parent.ok, true, JSON.stringify(parent.errors));
  for (const target of ['Root/Acceptance/Job1', 'Root/Acceptance']) {
    const denied = await request(`explore {"thing":"${target}","situation$full":true}`);
    assert.equal(denied.ok, false, `${target}: ${JSON.stringify(denied)}`);
    assert.ok(denied.errors.some((error) => error.code === 'WINDOW_ACCESS_DENIED'), target);
  }
  assert.equal(restartedExecutions, 0);
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

test('startup projection remains readable when an existing jump registration is invalid', async (t) => {
  const initial = jumpWorld('Root/Missing');
  const files = await fixture(t, initial);
  const result = await executeAtomLanguage({
    source: 'atom', ...files,
    programMode: 'project',
    programScheduler: createProgramRuntimeScheduler(),
    interaction: { id: 'startup', agent: null }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.revisionAfter, result.revisionBefore);
  assert.deepEqual(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), initial);
});

test('default self-lock denial leaves the window in place', async (t) => {
  const initial = jumpWorld();
  const registration = initial[0].contain.find((entry) => nameOf(entry) === 'Registration');
  registration.situation = registration.situation.replace(
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
    atom('Registration', 'jump({"recycle":explore({"thing":"Root/A/Recycle"})[0]})', [], 'program')
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
  assert.deepEqual(childNames(stored[0].contain[0]), ['Recycle']);
  assert.equal(scheduler.activeWindowAgents.has('Root/A/Window'), false);
});

test('an explicit jump recycle is the only transform allowed to remove its active Agent', async (t) => {
  const initial = [atom('Root', '', [
    atom('A', '', [
      atom('Window', '', [], 'agent'),
      atom('Recycle', 'def main(arguments):\n    return True', [], 'program')
    ]),
    atom('Registration', 'jump({"recycle":explore({"thing":"Root/A/Recycle"})[0]})', [], 'program')
  ])];
  const files = await fixture(t, initial);
  const scheduler = createProgramRuntimeScheduler();

  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Registration"}',
    ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(childNames(stored[0].contain[0]), ['Recycle']);
  assert.equal(scheduler.activeWindowAgents.has('Root/A/Window'), false);
});

test('cyclic destination and downstream failure both roll back the moved window', async (t) => {
  for (const mode of ['cycle', 'downstream']) {
    const initial = mode === 'cycle'
      ? jumpWorld('Root/A/Window')
      : jumpWorld();
    if (mode === 'downstream') {
      initial[0].contain.push(atom(
        'BrokenEffect',
        'transform({"thing":"Missing","situation.rep.value":None})',
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
      'point = explore({"thing":"./Monitor"})[0]',
      'if changed([point]):',
      '    message({"level":"info","text":"hit"})'
    ].join('\n'), [], 'program')
  ])];
  world[0].contain[0].support = [{ 'if@current': true, then: [{ thing: './Monitor' }] }];
  const supportBefore = JSON.stringify(world[0].contain[0].support);
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
  assert.equal(JSON.stringify(world[0].contain[0].support), supportBefore);
});
