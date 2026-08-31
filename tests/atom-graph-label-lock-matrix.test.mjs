import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { createJsonProgramProjectionRepository } from '../src/atom-system/adapters/json-program-projection-repository.mjs';
import { createLegacyRuntimeComposition } from '../src/atom-system/adapters/legacy-runtime-composition.mjs';
import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

function pythonLiteral(value) {
  return JSON.stringify(value)
    .replaceAll(':true', ':True')
    .replaceAll(':false', ':False')
    .replaceAll(':null', ':None');
}

function findAtom(atoms, expectedPath, parentPath = []) {
  for (const current of atoms) {
    const thing = Object.entries(current).find(([key]) => key === 'thing' || key.startsWith('thing@'))?.[1];
    const currentPath = [...parentPath, thing];
    if (currentPath.join('/') === expectedPath) return current;
    const nested = findAtom(current.contain ?? [], expectedPath, currentPath);
    if (nested) return nested;
  }
  return null;
}

async function fixture(t, { kind, action, held }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `atom-${kind}-${action}-lock-`));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const label = `${kind}-${action}`;
  const lockedPath = kind === 'node' ? 'Root/Window/Target' : 'Root/Window/Area';
  const targetPath = kind === 'node' ? lockedPath : `${lockedPath}/Target`;
  const lockDeclaration = {
    targets: { paths: [lockedPath], scope: kind === 'node' ? 'exact' : 'subtree' },
    actions: [action],
    labels: [label]
  };
  const agentSource = `agent(${JSON.stringify({
    labels: held ? [label] : [],
    functions: { groups: [], names: ['explore', 'lock', 'transform'] }
  })})`;
  const target = atom('Target', 'classified');
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Window', agentSource, [
      ...(kind === 'node' ? [target] : [atom('Area', '', [target])]),
      atom('Lock Program', `lock(${pythonLiteral(lockDeclaration)})`, [], 'program')
    ], 'program')
  ])], null, 2));
  return { contextFile, projectionFile, targetPath };
}

async function execute({ files, action, id }) {
  return executeAtomLanguage({
    source: action === 'explore'
      ? `explore {"thing":${JSON.stringify(files.targetPath)},"situation$full":true}`
      : `transform {"thing":${JSON.stringify(files.targetPath)},"situation.rep.updated"}`,
    contextFile: files.contextFile,
    projectionFile: files.projectionFile,
    programScheduler: createProgramRuntimeScheduler(),
    interaction: { id, agent: { path: 'Root/Window' } }
  });
}

for (const kind of ['node', 'contain']) {
  for (const lockedAction of ['explore', 'transform']) {
    test(`${kind} ${lockedAction} label lock denies an unlabelled Agent before disclosure or mutation`, async (t) => {
      const files = await fixture(t, { kind, action: lockedAction, held: false });
      const result = await execute({ files, action: lockedAction, id: `${kind}-${lockedAction}-deny` });

      const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
      assert.equal(findAtom(stored, files.targetPath).situation, 'classified');
      if (lockedAction === 'explore') {
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.deepEqual(result.items.flatMap((item) => item.matches), []);
        assert.ok(result.warnings.some((warning) => warning.code === 'ATOM_READ_PROTECTED'), JSON.stringify(result));
        assert.equal(JSON.stringify(result).includes('classified'), false);
      } else {
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.ok(result.errors.some((error) => error.code === 'GRAPH_LOCK_DENIED'), JSON.stringify(result));
      }
    });

    test(`${kind} ${lockedAction} label lock permits an Agent holding the required label`, async (t) => {
      const files = await fixture(t, { kind, action: lockedAction, held: true });
      const result = await execute({ files, action: lockedAction, id: `${kind}-${lockedAction}-allow` });

      assert.equal(result.ok, true, JSON.stringify(result));
      if (lockedAction === 'explore') {
        assert.equal(JSON.stringify(result).includes('classified'), true);
      } else {
        const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
        assert.equal(findAtom(stored, files.targetPath).situation, 'updated');
      }
    });

    test(`${kind} ${lockedAction} label lock does not restrict the other Graph action`, async (t) => {
      const files = await fixture(t, { kind, action: lockedAction, held: false });
      const otherAction = lockedAction === 'explore' ? 'transform' : 'explore';
      const result = await execute({ files, action: otherAction, id: `${kind}-${lockedAction}-split` });

      assert.equal(result.ok, true, JSON.stringify(result));
      if (otherAction === 'explore') {
        assert.equal(JSON.stringify(result).includes('classified'), true);
      } else {
        const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
        assert.equal(findAtom(stored, files.targetPath).situation, 'updated');
      }
    });
  }
}

test('a successful action-split Transform publishes a current Program projection for the next locked Transform', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-node-lock-next-transform-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const graphFile = path.join(directory, 'graph.json');
  const storeFile = path.join(directory, 'knowledge.json');
  const programProjectionFile = path.join(directory, 'program-projection.json');
  const unlabelledPath = 'Root/Holder/Unlabelled';
  const nodeExplorePath = `${unlabelledPath}/NodeExplore`;
  const nodeTransformPath = `${unlabelledPath}/NodeTransform`;
  const holderSource = 'agent({"labels":["node-explore","node-transform"],"functions":{"groups":[],"names":["explore","lock","transform"]}})';
  const unlabelledSource = 'agent({"labels":[],"functions":{"groups":[],"names":["explore","transform"]}})';
  await fs.writeFile(contextFile, JSON.stringify([atom('Root', '', [
    atom('Holder', holderSource, [
      atom('Unlabelled', unlabelledSource, [
        atom('NodeExplore', 'classified'),
        atom('NodeTransform', 'classified')
      ], 'program'),
      atom('Locks', '', [
        atom('NodeExplore Lock', `lock(${pythonLiteral({
          targets: { paths: [nodeExplorePath], scope: 'exact' },
          actions: ['explore'], labels: ['node-explore']
        })})`, [], 'program'),
        atom('NodeTransform Lock', `lock(${pythonLiteral({
          targets: { paths: [nodeTransformPath], scope: 'exact' },
          actions: ['transform'], labels: ['node-transform']
        })})`, [], 'program')
      ])
    ], 'program')
  ])]), 'utf8');

  const storedProjectionRepository = createJsonProgramProjectionRepository({ file: programProjectionFile });
  let failNextProjectionSave = false;
  const projectionRepository = {
    load: () => storedProjectionRepository.load(),
    save: async (projection) => {
      if (failNextProjectionSave) {
        failNextProjectionSave = false;
        throw Object.assign(new Error('synthetic first settlement write failure'), {
          code: 'SYNTHETIC_PROGRAM_PROJECTION_WRITE_FAILED'
        });
      }
      return storedProjectionRepository.save(projection);
    }
  };
  const programScheduler = createProgramRuntimeScheduler({ projectionRepository });
  const runtime = createLegacyRuntimeComposition({
    contextFile,
    graphFile,
    storeFile,
    programScheduler
  });
  await runtime.initialize({ correlationId: 'node-lock-startup' });
  const initialProjection = await projectionRepository.load();
  failNextProjectionSave = true;
  const first = await runtime.execute({
    source: `transform {"thing":${JSON.stringify(nodeExplorePath)},"situation.rep.updated"}`,
    correlationId: 'node-explore-action-split',
    agentPath: unlabelledPath
  });
  assert.equal(first.ok, true, JSON.stringify(first));
  const persistedAfterFirst = await projectionRepository.load();
  assert.notEqual(persistedAfterFirst.worldKey, initialProjection.worldKey);
  assert.equal(persistedAfterFirst.contextDependent, false);
  assert.deepEqual(persistedAfterFirst.failures, []);

  const restarted = createLegacyRuntimeComposition({
    contextFile,
    graphFile,
    storeFile,
    programScheduler: createProgramRuntimeScheduler({
      projectionRepository: storedProjectionRepository
    })
  });

  const denied = await restarted.execute({
    source: `transform {"thing":${JSON.stringify(nodeTransformPath)},"situation.rep.denied"}`,
    correlationId: 'node-transform-unlabelled',
    agentPath: unlabelledPath
  });
  assert.equal(denied.ok, false, JSON.stringify(denied));
  assert.ok(denied.errors.some((error) => error.code === 'GRAPH_LOCK_DENIED'), JSON.stringify(denied));
  assert.equal(denied.errors.some((error) => error.code === 'ATOM_PROGRAM_PROJECTION_MISSING'), false);

  const allowed = await restarted.execute({
    source: `transform {"thing":${JSON.stringify(nodeTransformPath)},"situation.rep.updated"}`,
    correlationId: 'node-transform-holder',
    agentPath: 'Root/Holder'
  });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  const world = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  assert.equal(findAtom(world, nodeExplorePath).situation, 'updated');
  assert.equal(findAtom(world, nodeTransformPath).situation, 'updated');
});
