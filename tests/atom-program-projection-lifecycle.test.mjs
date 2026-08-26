import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from '../work-engine/atom-language/engine.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return {
    [`thing${type ? `@${type}` : ''}`]: thing,
    situation: situation,
    contain: contain,
    support: []
  };
}

function memoryProjectionRepository() {
  let stored = null;
  return {
    async load() {
      return stored ? structuredClone(stored) : null;
    },
    async save(projection) {
      stored = structuredClone(projection);
      return stored;
    },
    replace(projection) {
      stored = structuredClone(projection);
    }
  };
}

test('a query consumes the current Program projection without executing Programs', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-query-projection-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Agent', '', [], 'agent'),
    atom('Program', "message({'level':'info','text':'must-not-run'})", [], 'program')
  ]));
  let reads = 0;
  const scheduler = {
    current: async () => {
      reads += 1;
      return {
        fingerprint: 'projection', cached: true, records: [], locks: [],
        messages: [], transforms: [], failures: []
      };
    },
    refresh: async () => {
      throw new Error('ordinary query executed Programs');
    }
  };

  const result = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler,
    interaction: { id: 'query-1', agent: { ref: 'agent-ref', path: 'Agent' } }
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(reads, 1);
  assert.equal(result.changed, false);
});

test('a validated Program projection survives scheduler restart for the exact world revision', async () => {
  const repository = memoryProjectionRepository();
  const world = [atom('Program', '# projection', [], 'program')];
  let executions = 0;
  const first = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });

  const built = await first.refresh(world, { isolateFailures: true });
  assert.equal(built.cached, false);
  assert.equal(executions, 1);

  const restarted = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      throw new Error('restored projection must not execute a worker');
    }
  });
  const restored = await restarted.current(structuredClone(world), { isolateFailures: true });

  assert.equal(restored.cached, true);
  assert.deepEqual(restored.messages, []);
  assert.deepEqual(restored.transforms, []);
  assert.equal(executions, 1);
});

test('a persisted Program projection restores only versioned exact Explore read paths', async () => {
  const repository = memoryProjectionRepository();
  const world = [atom('Target'), atom('Program', '# reads target', [], 'program')];
  const first = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async ({ executeExplore }) => {
      await executeExplore({ thing: 'Target', 'contain$latitude-1': true });
      return { locks: [], messages: [], transforms: [] };
    }
  });
  await first.refresh(world, {
    isolateFailures: true,
    executeExplore: async () => [{ path: 'Target' }]
  });

  const stored = await repository.load();
  assert.equal(stored.readSetVersion, 1);
  assert.deepEqual(stored.exploreReadPaths, ['Target']);

  const restarted = createProgramRuntimeScheduler({ projectionRepository: repository });
  const restored = await restarted.current(structuredClone(world), { isolateFailures: true });
  assert.deepEqual(restored.exploreReadPaths, ['Target']);

});

test('an explicit selected Program run cannot replace the persisted full-world projection', async () => {
  const repository = memoryProjectionRepository();
  const world = [
    atom('Program A', '# selected', [], 'program'),
    atom('Program B', '# remains active', [], 'program')
  ];
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => ({ locks: [], messages: [], transforms: [] })
  });

  await scheduler.refresh(world, { isolateFailures: true });
  await scheduler.refresh(structuredClone(world), {
    isolateFailures: true,
    programSelector: 'Program A',
    force: true
  });

  const restarted = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      throw new Error('the preserved full-world projection must be restored');
    }
  });
  const restored = await restarted.current(structuredClone(world), {
    isolateFailures: true
  });

  assert.equal(restored.cached, true);
  assert.deepEqual(restored.failures, []);
});

test('a persisted Program projection cannot be reused for a different world revision', async () => {
  const repository = memoryProjectionRepository();
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => ({ locks: [], messages: [], transforms: [] })
  });
  await scheduler.refresh([atom('Fact', 'before'), atom('Program', '# projection', [], 'program')], {
    isolateFailures: true
  });
  const restarted = createProgramRuntimeScheduler({ projectionRepository: repository });

  await assert.rejects(
    restarted.current([atom('Fact', 'after'), atom('Program', '# projection', [], 'program')], {
      isolateFailures: true
    }),
    (error) => error.code === 'ATOM_PROGRAM_PROJECTION_MISSING'
  );
});

test('passive read preparation fails closed without a validated context-free projection', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });

  await assert.rejects(
    scheduler.refresh([atom('Program', '# must not execute', [], 'program')], {
      passive: true,
      agentOrigin: { path: 'Agent' }
    }),
    (error) => error.code === 'ATOM_PROGRAM_PROJECTION_MISSING'
  );
  assert.equal(executions, 0);
});

test('startup isolates Agent-bound jump failures into a restartable context-free passive projection', async () => {
  const repository = memoryProjectionRepository();
  const world = [
    atom('Stable Program', '# context-free lock', [], 'program'),
    atom('Jump Program', '# Agent-bound jump', [], 'program')
  ];
  const startup = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async ({ program }) => {
      if (program.path === 'Jump Program') {
        throw Object.assign(new Error('jump requires one active Agent window'), {
          code: 'WINDOW_JUMP_DESTINATION_INVALID'
        });
      }
      return { locks: [], messages: [], transforms: [] };
    }
  });

  const built = await startup.refresh(world, { isolateFailures: true });
  assert.deepEqual(built.failures, []);
  assert.equal(built.contextIncomplete, true);
  assert.ok(await repository.load(), 'startup must persist the validated context-free base');

  const agentCycle = await startup.refresh(structuredClone(world), {
    isolateFailures: true,
    force: true,
    agentOrigin: { ref: 'agent-ref', path: 'Root/Window' }
  });
  assert.deepEqual(agentCycle.failures.map(({ code }) => code), [
    'WINDOW_JUMP_DESTINATION_INVALID'
  ]);

  let restartedExecutions = 0;
  const restarted = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      restartedExecutions += 1;
      throw new Error('passive restore must not execute Programs');
    }
  });
  const restored = await restarted.refresh(structuredClone(world), {
    isolateFailures: true,
    passive: true,
    agentOrigin: { ref: 'agent-ref', path: 'Root/Window' }
  });

  assert.equal(restored.cached, true);
  assert.equal(restored.contextIncomplete, true);
  assert.equal(restartedExecutions, 0);
});

test('a legacy persisted failure is rejected and retried instead of becoming authoritative', async () => {
  const repository = memoryProjectionRepository();
  const world = [atom('Program', '# retry legacy failure', [], 'program')];
  let executions = 0;
  const first = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });
  await first.refresh(world, { isolateFailures: true });
  const stored = await repository.load();
  repository.replace({
    ...stored,
    failures: [{ code: 'ATOM_PROGRAM_TIMEOUT', message: 'legacy transient failure' }]
  });

  const restarted = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const rebuilt = await restarted.refresh(structuredClone(world), { isolateFailures: true });

  assert.equal(rebuilt.cached, false);
  assert.deepEqual(rebuilt.failures, []);
  assert.equal(executions, 2);
});

test('concurrent Programs share one cycle deadline', async () => {
  const budgets = [];
  const scheduler = createProgramRuntimeScheduler({
    timeoutMs: 12_345,
    maxWorkers: 1,
    runProgram: async ({ timeoutMs }) => {
      budgets.push(timeoutMs);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { locks: [], messages: [], transforms: [] };
    }
  });

  await scheduler.refresh([
    atom('Program A', '# a', [], 'program'),
    atom('Program B', '# b', [], 'program'),
    atom('Program C', '# c', [], 'program')
  ]);

  assert.equal(budgets.length, 3);
  assert.equal(budgets.every((budget) => budget > 12_000 && budget <= 12_345), true);
  assert.ok(budgets[1] < budgets[0]);
  assert.ok(budgets[2] < budgets[1]);
});

test('a Program that explores the current Agent cannot reuse another Agent projection', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ executeExplore }) => {
      executions += 1;
      await executeExplore({});
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const world = [
    atom('Agent A', '', [], 'agent'),
    atom('Agent B', '', [], 'agent'),
    atom('Program', '# contextual', [], 'program')
  ];

  await scheduler.refresh(world, {
    agentOrigin: { ref: 'agent-a-ref', path: 'Agent A' },
    executeExplore: async () => [{ path: 'Agent A' }]
  });
  await scheduler.refresh(structuredClone(world), {
    agentOrigin: { ref: 'agent-b-ref', path: 'Agent B' },
    executeExplore: async () => [{ path: 'Agent B' }]
  });
  await scheduler.refresh(structuredClone(world), {
    agentOrigin: { ref: 'agent-a-ref-2', path: 'Agent A' },
    executeExplore: async () => [{ path: 'Agent A' }]
  });

  assert.equal(executions, 2);
});

test('a persisted Agent-scoped projection is restored only for the same Agent path', async () => {
  const repository = memoryProjectionRepository();
  const world = [
    atom('Agent A', '', [], 'agent'),
    atom('Agent B', '', [], 'agent'),
    atom('Program', '# contextual', [], 'program')
  ];
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: repository,
    runProgram: async ({ executeExplore }) => {
      await executeExplore({});
      return { locks: [], messages: [], transforms: [] };
    }
  });
  await scheduler.refresh(world, {
    agentOrigin: { ref: 'agent-a-ref', path: 'Agent A' },
    executeExplore: async () => [{ path: 'Agent A' }]
  });

  const restarted = createProgramRuntimeScheduler({ projectionRepository: repository });
  await assert.rejects(
    restarted.current(structuredClone(world), {
      agentOrigin: { ref: 'agent-b-ref', path: 'Agent B' }
    }),
    (error) => error.code === 'ATOM_PROGRAM_PROJECTION_MISSING'
  );
  const restored = await restarted.current(structuredClone(world), {
    agentOrigin: { ref: 'agent-a-new-ref', path: 'Agent A' }
  });
  assert.equal(restored.cached, true);
});

test('replaceable projection persistence failure does not discard a valid in-memory Program cycle', async () => {
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: {
      async load() { return null; },
      async save() {
        throw Object.assign(new Error('projection file is busy'), { code: 'EPERM' });
      }
    },
    runProgram: async () => ({ locks: [], messages: [], transforms: [] })
  });

  const cycle = await scheduler.refresh([atom('Program', '# valid', [], 'program')]);

  assert.equal(cycle.cached, false);
  assert.equal(cycle.runtimeWarnings[0].code, 'PROGRAM_PROJECTION_PERSIST_FAILED');
  const current = await scheduler.current([atom('Program', '# valid', [], 'program')]);
  assert.equal(current.cached, true);
});

test('a transient Program failure is retried by an explicit Program refresh', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async () => {
      executions += 1;
      if (executions === 1) {
        throw Object.assign(new Error('worker timed out'), { code: 'ATOM_PROGRAM_TIMEOUT' });
      }
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const program = atom('Program', '# retryable', [], 'program');

  const failed = await scheduler.refresh([atom('Fact', 'before'), program], {
    isolateFailures: true
  });
  const recovered = await scheduler.refresh([
    atom('Fact', 'after'), structuredClone(program)
  ], { isolateFailures: true, force: true });

  assert.equal(failed.failures[0].code, 'ATOM_PROGRAM_TIMEOUT');
  assert.equal(executions, 2);
  assert.deepEqual(recovered.failures, []);
});

test('an isolated context-free startup failure stays dormant while Agent context is completed', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program }) => {
      executions += 1;
      if (program.path !== 'Broken Program') {
        return { locks: [], messages: [], transforms: [] };
      }
      throw Object.assign(new Error('unrelated persistent failure'), {
        code: 'ATOM_PROGRAM_FAILED'
      });
    }
  });
  const world = [
    atom('Agent', '', [], 'agent'),
    atom('Broken Program', '# fails without reading the Agent', [], 'program')
  ];

  const startup = await scheduler.refresh(world, { isolateFailures: true });
  const changedWorld = [
    ...structuredClone(world),
    atom('Unrelated New Program', '# added elsewhere', [], 'program')
  ];
  const agentProjection = await scheduler.refresh(changedWorld, {
    isolateFailures: true,
    agentOrigin: { ref: 'agent-ref', path: 'Agent' }
  });

  assert.equal(startup.failures.length, 1);
  assert.equal(executions, 2);
  assert.deepEqual(agentProjection.failures, []);
  assert.equal(agentProjection.cached, false);
});

test('a cold Agent Transform does not replay or report an unrelated startup failure', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-program-cold-agent-transform-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, JSON.stringify([
    atom('Agent', '', [], 'agent'),
    atom('Target', 'before'),
    atom('Broken Program', "raise ValueError('unrelated persistent failure')", [], 'program')
  ], null, 2));
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async () => {
      executions += 1;
      throw Object.assign(new Error('unrelated persistent failure'), {
        code: 'ATOM_PROGRAM_FAILED'
      });
    }
  });

  const startup = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler,
    programMode: 'project', interaction: { id: 'startup', agent: null }
  });
  const preparation = await executeAtomLanguage({
    source: 'atom', contextFile, projectionFile, programScheduler: scheduler,
    programMode: 'reconcile',
    interaction: { id: 'agent-preparation', agent: { ref: 'agent-ref', path: 'Agent' } }
  });
  const transformed = await executeAtomLanguage({
    source: 'transform {"thing":"Target","situation.rep.after"}',
    contextFile,
    projectionFile,
    programScheduler: scheduler,
    commitWorld: async () => {},
    interaction: { id: 'agent-transform', agent: { ref: 'agent-ref', path: 'Agent' } }
  });

  assert.equal(startup.ok, true, JSON.stringify(startup.errors));
  assert.equal(preparation.ok, true, JSON.stringify(preparation.errors));
  assert.equal(preparation.warnings.some((warning) => (
    warning.code === 'ATOM_PROGRAM_FAILED'
  )), false, JSON.stringify(preparation.warnings));
  assert.equal(transformed.ok, true, JSON.stringify(transformed.errors));
  assert.equal(transformed.changed, true, JSON.stringify(transformed));
  assert.equal(executions, 1);
  assert.equal(transformed.warnings.some((warning) => (
    warning.code === 'ATOM_PROGRAM_FAILED'
  )), false, JSON.stringify(transformed.warnings));
});

test('concurrent invalidated refreshes share the complete dependency-check and worker pipeline', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ executeExplore }) => {
      executions += 1;
        await executeExplore({ thing: 'Fact' });
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const program = atom('Program', '# dependent', [], 'program');
  const executeBefore = async () => [{ path: 'Fact' }];
  await scheduler.refresh([atom('Fact', 'before'), program], { executeExplore: executeBefore });

  const changed = [atom('Fact', 'after'), structuredClone(program)];
  const executeAfter = async () => [{ path: 'Fact' }];
  await Promise.all([
    scheduler.refresh(changed, { executeExplore: executeAfter }),
    scheduler.refresh(structuredClone(changed), { executeExplore: executeAfter })
  ]);

  assert.equal(executions, 2);
});

test('Program structural facts invalidate reusable effects even without explore calls', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const program = atom('Program', '# current_atom support', [], 'program');
  program.support = [];
  await scheduler.refresh([atom('Target'), program]);

  const changed = structuredClone(program);
  changed.support = [{ 'if@current': true, then: [{ thing: 'Target' }] }];
  await scheduler.refresh([atom('Target'), changed]);

  assert.equal(executions, 2);
});

test('changing one referenced Program invalidates callers that may use use_program', async () => {
  const executions = new Map();
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ program }) => {
      executions.set(program.path, (executions.get(program.path) ?? 0) + 1);
      return { locks: [], messages: [], transforms: [] };
    }
  });
  const caller = atom('Caller', "use_program({'name':'Library','arguments':{}})", [], 'program');
  const library = atom('Library', 'def main(arguments):\n    return 1', [], 'program');
  await scheduler.refresh([caller, library]);

  const changedLibrary = atom('Library', 'def main(arguments):\n    return 2', [], 'program');
  await scheduler.refresh([structuredClone(caller), changedLibrary]);

  assert.equal(executions.get('Caller'), 2);
  assert.equal(executions.get('Library'), 2);
});

test('a corrupt replaceable projection is ignored and rebuilt with a warning', async () => {
  let executions = 0;
  const scheduler = createProgramRuntimeScheduler({
    projectionRepository: {
      async load() {
        throw Object.assign(new Error('invalid projection JSON'), {
          code: 'INVALID_PROGRAM_PROJECTION'
        });
      },
      async save() {}
    },
    runProgram: async () => {
      executions += 1;
      return { locks: [], messages: [], transforms: [] };
    }
  });

  const cycle = await scheduler.refresh([atom('Program', '# rebuild', [], 'program')]);

  assert.equal(executions, 1);
  assert.equal(cycle.runtimeWarnings[0].code, 'PROGRAM_PROJECTION_LOAD_FAILED');
});

test('a context-free projection excludes Programs that resolve the current Agent implicitly', async () => {
  const scheduler = createProgramRuntimeScheduler({
    runProgram: async ({ executeExplore }) => {
      await executeExplore({});
      return {
        locks: [{ targets: { refs: ['agent-ref'] }, mode: 'write', fields: [] }],
        messages: [{ level: 'info', text: 'agent-only' }],
        transforms: [{ name: 'Agent', detail: 'agent-only' }]
      };
    }
  });
  const world = [atom('Agent', '', [], 'agent'), atom('Program', '# contextual', [], 'program')];

  const global = await scheduler.refresh(world, {
    executeExplore: async () => [{ path: 'Agent' }]
  });

  assert.deepEqual(global.locks, []);
  assert.deepEqual(global.messages, []);
  assert.deepEqual(global.transforms, []);
});
