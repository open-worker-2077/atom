import path from 'node:path';

const FUNCTION_NAMES = Object.freeze([
  'agent', 'current_atom', 'explore', 'jump', 'lock', 'message',
  'json_parse', 'shortcut', 'slot_body', 'transform', 'trigger', 'use_program', 'work_order'
]);

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

function agentSource(labels) {
  return `agent(${JSON.stringify({
    labels,
    functions: { groups: [], names: [...FUNCTION_NAMES] }
  })})`;
}

function exactLockSource(targetPath) {
  return `lock(${JSON.stringify({
    targets: { paths: [`世界之外/${targetPath}`], scope: 'exact' },
    actions: ['transform'], labels: ['^']
  })})`;
}

/**
 * Creates a disposable world fixture. Bootstrap is only a seed registrar; the
 * ^ Agent under test is registered by a public CLI Program run.
 */
export function createNightWatchCliFixture(directory) {
  const testPath = 'test';
  const bootstrapPath = `${testPath}/Bootstrap`;
  const syntheticPath = `${bootstrapPath}/🧊`;
  const syntheticTargetPath = `${syntheticPath}/受锁结果`;
  const syntheticLockPath = `${syntheticPath}/路径锁`;
  const journeyPath = `${testPath}/旅程`;
  const journeyTargetPath = `${journeyPath}/受锁结果`;
  const journeyLockPath = `${journeyPath}/路径锁`;
  const noLabelPath = `${testPath}/无标签`;
  const noLabelTargetPath = `${noLabelPath}/受锁结果`;
  const overreachPath = `${syntheticPath}/越级`;
  const syntheticAgentSource = agentSource(['^']);
  const overreachAgentSource = agentSource(['^^']);
  const world = [atom(testPath, 'night-watch disposable domain', [
    atom('Bootstrap', agentSource(['^^']), [], 'program'),
    atom('旅程', agentSource(['^']), [], 'program'),
    atom('目的地', 'jump destination'),
    atom('无标签', agentSource([]), [
      atom('受锁结果', 'unchanged'),
      atom('路径锁', exactLockSource(noLabelTargetPath), [], 'program')
    ], 'program')
  ])];

  return Object.freeze({
    contextFile: path.join(directory, 'atom.json'),
    graphFile: path.join(directory, 'graph.json'),
    storeFile: path.join(directory, 'knowledge.json'),
    bootstrapPath,
    syntheticPath,
    syntheticTargetPath,
    syntheticLockPath,
    journeyPath,
    journeyTargetPath,
    journeyLockPath,
    noLabelPath,
    noLabelTargetPath,
    overreachPath,
    syntheticAgentSource,
    overreachAgentSource,
    createSyntheticTarget: () => ({
      thing: syntheticTargetPath, situation: 'unchanged', slot: [], strut: []
    }),
    createSyntheticLock: () => ({
      'thing@program': syntheticLockPath,
      situation: exactLockSource(syntheticTargetPath), slot: [], strut: []
    }),
    createJourneyTarget: () => ({
      thing: journeyTargetPath, situation: 'unchanged', slot: [], strut: []
    }),
    createJourneyLock: () => ({
      'thing@program': journeyLockPath,
      situation: exactLockSource(journeyTargetPath), slot: [], strut: []
    }),
    world
  });
}
