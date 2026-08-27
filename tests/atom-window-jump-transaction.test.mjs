import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createJsonProgramProjectionRepository } from '../src/atom-system/adapters/json-program-projection-repository.mjs';
import { createJsonRequestDrivenLockRepository } from '../src/atom-system/adapters/json-request-driven-lock-repository.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { resolveAgentContext } from '../work-engine/atom-language/cli.mjs';
import {
  executeAtomLanguage as executeAtomLanguageWithoutWorldService,
  executeProgramExplore
} from '../work-engine/atom-language/engine.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

const WINDOW_AGENT_SOURCE = 'agent({"labels":["^"],"functions":{"groups":[],"names":["explore","jump","lock","transform"]}})';

function windowAgent(thing, contain = []) {
  return atom(thing, WINDOW_AGENT_SOURCE, contain, 'program@agent');
}

async function fixture(t, atoms) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-window-jump-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');
  return { contextFile, projectionFile };
}

function jumpWorld(destination = 'Root/A/B') {
  return [atom('Root', '', [
    atom('A', '', [
      windowAgent('Window', [
        atom('When', 'def main(arguments):\n    return True', [], 'program'),
        atom('Where', `def main(arguments):\n    return explore({"thing":"${destination}"})[0]`, [], 'program'),
        atom('Registration', [
          'jump({',
          '  "when": explore({"thing":"Root/A/Window/When"})[0],',
          '  "where": explore({"thing":"Root/A/Window/Where"})[0]',
          '})'
        ].join('\n'), [], 'program')
      ]),
      atom('B')
    ])
  ])];
}

function fourAxisJumpWorld(when) {
  return [atom('Root', '', [
    windowAgent('Audit'),
    windowAgent('Window', [
      atom('When', `def main(arguments):\n    return ${when ? 'True' : 'False'}`, [], 'program'),
      atom('Where', 'def main(arguments):\n    return explore({"thing":"Root/B"})[0]', [], 'program'),
      atom('Registration', [
        'when_program = explore({"thing":"Root/Window/When"})[0]',
        'where_program = explore({"thing":"Root/Window/Where"})[0]',
        'jump({',
        '  "when": when_program,',
        '  "where": where_program',
        '})'
      ].join('\n'), [], 'program')
    ]),
    atom('B', '', [atom('Payload')])
  ])];
}

async function v1Scheduler(agentPath, options = {}) {
  assert.equal(typeof agentPath, 'string');
  return createProgramRuntimeScheduler(options);
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
  const files = await fixture(t, jumpWorld('Root/A/B'));
  const scheduler = await v1Scheduler('Root/A/Window');
  const result = await executeAtomLanguage({
    source: 'atom', ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(childNames(stored[0].contain[0]), ['B']);
  assert.deepEqual(childNames(stored[0].contain[0].contain[0]), ['Window']);
  assert.equal(scheduler.agentSecurity.has('Root/A/Window'), false);
  assert.equal(scheduler.agentSecurity.has('Root/A/B/Window'), true);
});

test('the next public exact Explore after a jump enforces the remapped active self-lock', async (t) => {
  const initial = [atom('Root', '', [
    atom('A'),
    windowAgent('Window', [
      atom('When', 'def main(arguments):\n    return True', [], 'program'),
      atom('Where', 'def main(arguments):\n    return explore({"thing":"Root/B"})[0]', [], 'program'),
      atom('Registration', [
        'jump({',
        '  "when": explore({"thing":"Root/Window/When"})[0],',
        '  "where": explore({"thing":"Root/Window/Where"})[0]',
        '})'
      ].join('\n'), [], 'program')
    ]),
    atom('B'),
  ])];
  const files = await fixture(t, initial);
  const scheduler = await v1Scheduler('Root/Window');
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
    interaction: { agent: { ref: 'window-ref', path: 'Root/Window' } }
  });
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  assert.deepEqual(scheduler.agentSecurity.get('Root/B/Window'), {
    labels: ['^'],
    functionScopes: { groups: [], names: ['explore', 'jump', 'lock', 'transform'] },
    functions: ['explore', 'jump', 'lock', 'transform']
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
    const scheduler = contaminateInternalExploreSnapshot(await v1Scheduler('Root/Window'));
    const source = when
      ? 'explore {"thing":"Root/B/Window","contain$latitude-1":true}'
      : 'explore {"thing":"Root/Window","contain$latitude-1":true}';
    const result = await executeAtomLanguage({
      source, ...files, programScheduler: scheduler,
      interaction: { agent: { ref: 'window-ref', path: 'Root/Window' } }
    });
    assert.equal(result.ok, true, `${when ? 'when=true' : 'when=false'}: ${JSON.stringify(result.errors)}`);
    assert.equal(result.errors.some((error) => error.code === 'RETIRED_GRAPH_AXIS'), false);
  }

  const auditFiles = await fixture(t, fourAxisJumpWorld(false));
  const auditScheduler = contaminateInternalExploreSnapshot(await v1Scheduler('Root/Audit'));
  const audit = await executeAtomLanguage({
    source: 'explore {"thing":"Root/Audit","contain$latitude-1":true}',
    ...auditFiles,
    programMode: null,
    programScheduler: auditScheduler,
    interaction: { agent: { ref: 'audit-ref', path: 'Root/Audit' } }
  });
  assert.equal(audit.ok, true, JSON.stringify(audit.errors));
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
    windowAgent('Window', [
        atom('Control', '完成'),
        atom('When', [
          'def main(arguments):',
          '    control = explore({"thing":"./Control","situation$full":True})[0]',
          '    return control.situation == "完成"'
        ].join('\n'), [], 'program'),
        atom('Where', 'def main(arguments):\n    return explore({"thing":"Root/Job2"})[0]', [], 'program'),
        atom('Registration', [
          'when_program = explore({"thing":"Root/Window/When"})[0]',
          'where_program = explore({"thing":"Root/Window/Where"})[0]',
          'jump({',
          '  "when": when_program,',
          '  "where": where_program',
          '})'
        ].join('\n'), [], 'program')
      ]),
    atom('Job2')
  ])];
  const files = await fixture(t, initial);
  const scheduler = await v1Scheduler('Root/Window');
  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/Window/Registration"}',
    ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/Window' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(childNames(stored[0]), ['Job2']);
  assert.deepEqual(childNames(stored[0].contain[0]), ['Window']);
});

test('explicit jump commit persists a new passive base before later exact CLI requests', async (t) => {
  const initial = [atom('Root', '', [
    atom('Acceptance', '', [
      atom('Job1'),
      windowAgent('Window', [
          atom('When', 'def main(arguments):\n    return True', [], 'program'),
          atom('Where', 'def main(arguments):\n    return explore({"thing":"Root/Acceptance/Job2"})[0]', [], 'program'),
          atom('Registration', [
            'when_program = explore({"thing":"Root/Acceptance/Window/When"})[0]',
            'where_program = explore({"thing":"Root/Acceptance/Window/Where"})[0]',
            'jump({',
            '  "when": when_program,',
            '  "where": where_program',
            '})'
          ].join('\n'), [], 'program')
        ]),
      atom('Job2')
    ])
  ])];
  const files = await fixture(t, initial);
  const snapshotFile = path.join(path.dirname(files.contextFile), 'request-driven-locks.json');
  const programProjectionFile = path.join(path.dirname(files.contextFile), 'program-projection.json');
  const repository = createJsonRequestDrivenLockRepository({ file: snapshotFile });
  const projectionRepository = createJsonProgramProjectionRepository({ file: programProjectionFile });
  const scheduler = await v1Scheduler('Root/Acceptance/Window', {
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
    source: 'transform {"thing.run.":"Root/Acceptance/Window/Registration"}',
    ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/Acceptance/Window' } }
  });
  assert.equal(moved.ok, true, JSON.stringify(moved.errors));
  assert.deepEqual(await repository.load(), { version: 1, locks: [] });
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

test('cached Program reads cannot deny later default-lock Explore targets', async (t) => {
  const agentPath = 'Root/Acceptance/Job1/Window';
  const initial = [atom('Root', '', [
    atom('Acceptance', '', [
      atom('Job1', '', [
        windowAgent('Window', [atom('Control')]),
        atom('Window Peer')
      ]),
      atom('Job2')
    ]),
    atom('Other Branch')
  ])];
  const files = await fixture(t, initial);
  const cachedCycle = {
    cached: true,
    records: [],
    locks: [],
    choices: [],
    messages: [],
    transforms: [],
    slotBodies: [],
    jumps: [],
    failures: [],
    agentSecurity: {
      labels: ['^'], functions: ['explore', 'jump', 'lock', 'transform']
    },
    // This belongs to a previously evaluated Program and is not a read in this request.
    exploreReadPaths: ['Root/Acceptance/Job2']
  };
  const programScheduler = {
    current: async () => structuredClone(cachedCycle),
    refresh: async () => structuredClone(cachedCycle)
  };
  const request = (thing) => executeAtomLanguage({
    source: `explore {"thing":"${thing}","situation$full":true}`,
    ...files,
    programScheduler,
    interaction: { agent: { ref: 'window-ref', path: agentPath } }
  });

  for (const target of [
    'Window', agentPath,
    `${agentPath}/Control`,
    'Root/Acceptance/Job1',
    'Root/Acceptance/Job1/Window Peer'
  ]) {
    const allowed = await request(target);
    assert.equal(allowed.ok, true, `${target}: ${JSON.stringify(allowed.errors)}`);
  }
  for (const target of [
    'Root/Acceptance/Job2',
    'Root/Acceptance',
    'Root/Other Branch'
  ]) {
    const denied = await request(target);
    assert.equal(denied.ok, false, `${target}: ${JSON.stringify(denied)}`);
    assert.ok(denied.errors.some((error) => error.code === 'WINDOW_ACCESS_DENIED'), target);
    assert.equal(denied.errors.some((error) => error.code === 'WINDOW_JUMP_LOCK_DENIED'), false);
  }
});

test('a symbolic Agent security declaration survives scheduler reconstruction', async (t) => {
  const agentPath = 'Root/Acceptance/Job1/Window';
  const initial = [atom('Root', '', [atom('Acceptance', '', [
    atom('Job1', '', [windowAgent('Window')])
  ])])];
  const files = await fixture(t, initial);
  const interaction = { agent: { ref: 'window-ref', path: agentPath } };

  const restarted = createProgramRuntimeScheduler();
  const cycle = await restarted.current(initial, {
    agentOrigin: interaction.agent,
    allowWindowLockSnapshot: true
  });
  assert.deepEqual(cycle.agentSecurity, {
    labels: ['^'],
    functionScopes: { groups: [], names: ['explore', 'jump', 'lock', 'transform'] },
    functions: ['explore', 'jump', 'lock', 'transform']
  });
});

test('a persisted fixed Agent boundary applies to short and full exact selectors', async (t) => {
  const agentPath = 'Root/Acceptance/Job1/Window';
  const controlPath = `${agentPath}/Control`;
  const initial = [atom('Root', 'root-secret', [atom('Acceptance', 'ancestor-secret', [
    atom('Job1', 'parent-visible', [windowAgent('Window', [
      atom('Control', '待回单')
    ])]),
    atom('Job2')
  ])])];
  const files = await fixture(t, initial);
  const repository = createJsonRequestDrivenLockRepository({
    file: path.join(path.dirname(files.contextFile), 'request-driven-locks.json')
  });
  await v1Scheduler(agentPath, { requestDrivenLockRepository: repository });

  for (const selector of ['Window', agentPath]) {
    const restarted = createProgramRuntimeScheduler({ requestDrivenLockRepository: repository });
    const resolvedAgent = await resolveAgentContext(files.contextFile, selector);
    const request = (thing) => executeAtomLanguage({
      source: `explore {"thing":"${thing}","situation$full":true}`,
      ...files,
      programScheduler: restarted,
      interaction: { agent: resolvedAgent }
    });
    for (const target of [agentPath, controlPath, 'Root/Acceptance/Job1']) {
      const allowed = await request(target);
      assert.equal(allowed.ok, true, `${selector}/${target}: ${JSON.stringify(allowed.errors)}`);
    }
    for (const target of ['Root/Acceptance', 'Root']) {
      const denied = await request(target);
      assert.equal(denied.ok, false, `${selector}/${target}: ${JSON.stringify(denied)}`);
      assert.ok(denied.errors.some((error) => error.code === 'WINDOW_ACCESS_DENIED'));
      assert.equal(denied.items[0].matches?.[0]?.situation, undefined);
    }
  }
});

test('invalid destination rolls back the entire jump candidate with a stable error', async (t) => {
  const initial = jumpWorld('Root/Missing');
  const files = await fixture(t, initial);
  const scheduler = await v1Scheduler('Root/A/Window');
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

test('business Graph lock denial leaves the window in place', async (t) => {
  const initial = jumpWorld();
  const window = initial[0].contain[0].contain.find((entry) => nameOf(entry) === 'Window');
  window.contain.unshift(atom('Blocker',
    'lock({"targets":{"paths":["Root/A/B"]},"actions":["explore"],"labels":["blocked"]})',
    [], 'program'));
  const files = await fixture(t, initial);
  const scheduler = await v1Scheduler('Root/A/Window');
  const result = await executeAtomLanguage({
    source: 'atom', ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'WINDOW_JUMP_LOCK_DENIED'));
  assert.deepEqual(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), initial);
});

test('recycle true removes the active window without evaluating when or where', async (t) => {
  const initial = [atom('Root', '', [
    atom('A', '', [
      windowAgent('Window', [
        atom('Recycle', 'def main(arguments):\n    return True', [], 'program'),
        atom('Registration', 'jump({"recycle":explore({"thing":"Root/A/Window/Recycle"})[0]})', [], 'program')
      ])
    ])
  ])];
  const files = await fixture(t, initial);
  const scheduler = await v1Scheduler('Root/A/Window');
  const result = await executeAtomLanguage({
    source: 'atom', ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(childNames(stored[0].contain[0]), []);
  assert.equal(scheduler.agentSecurity.has('Root/A/Window'), false);
});

test('an explicit jump recycle is the only transform allowed to remove its active Agent', async (t) => {
  const initial = [atom('Root', '', [
    atom('A', '', [
      windowAgent('Window', [
        atom('Recycle', 'def main(arguments):\n    return True', [], 'program'),
        atom('Registration', 'jump({"recycle":explore({"thing":"Root/A/Window/Recycle"})[0]})', [], 'program')
      ])
    ])
  ])];
  const files = await fixture(t, initial);
  const scheduler = createProgramRuntimeScheduler();

  const result = await executeAtomLanguage({
    source: 'transform {"thing.run.":"Root/A/Window/Registration"}',
    ...files,
    programScheduler: scheduler,
    interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  assert.deepEqual(childNames(stored[0].contain[0]), []);
  assert.equal(scheduler.agentSecurity.has('Root/A/Window'), false);
});

test('a rejected recycle commit retains the Agent and its source-derived self-lock', async (t) => {
  const initial = [atom('Root', '', [
    atom('A', '', [
      windowAgent('Window', [
        atom('Recycle', 'def main(arguments):\n    return True', [], 'program'),
        atom('Registration', 'jump({"recycle":explore({"thing":"Root/A/Window/Recycle"})[0]})', [], 'program')
      ])
    ])
  ])];
  const files = await fixture(t, initial);
  const scheduler = createProgramRuntimeScheduler();

  await assert.rejects(
    executeAtomLanguageWithoutWorldService({
      source: 'transform {"thing.run.":"Root/A/Window/Registration"}',
      ...files,
      programMode: 'reconcile',
      programScheduler: scheduler,
      commitWorld: async () => {
        throw Object.assign(new Error('synthetic commit rejection'), {
          code: 'SYNTHETIC_COMMIT_REJECTION'
        });
      },
      interaction: { agent: { ref: 'window-ref', path: 'Root/A/Window' } }
    }),
    (error) => error.code === 'SYNTHETIC_COMMIT_REJECTION'
  );

  assert.deepEqual(JSON.parse(await fs.readFile(files.contextFile, 'utf8')), initial);
  const restarted = createProgramRuntimeScheduler();
  await restarted.rebuildAgentSecurity(initial);
  assert.equal(restarted.agentSecurity.has('Root/A/Window'), true);
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
    const scheduler = await v1Scheduler('Root/A/Window');
    const result = await executeAtomLanguage({
      source: 'atom', ...files,
      programScheduler: scheduler,
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
