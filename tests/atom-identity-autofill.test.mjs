import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(thing, situation = '', slot = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, slot, strut: [] };
}

test('a write adopts permanent identities for Things that were authored without one', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-identity-autofill-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  const watcher = [
    'def main():',
    "    transform({'thing':'Root/Target','situation.rep.fired':None})",
    "trigger('transform', {'nodes':['Root/Target']}, main)"
  ].join('\n');
  await fs.writeFile(contextFile, `${JSON.stringify([
    atom('Root', '', [
      atom('Target', 'before'),
      atom('Watcher', watcher, [], 'program')
    ])
  ], null, 2)}\n`, 'utf8');

  const result = await executeAtomLanguage({
    source: 'transform {"thing":"Root/Target","situation.rep.after"}',
    contextFile,
    projectionFile,
    programScheduler: createProgramRuntimeScheduler()
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const stored = JSON.parse(await fs.readFile(contextFile, 'utf8'));
  const target = stored[0].slot.find((entry) => Object.values(entry).includes('Target'));
  assert.match(Object.keys(target).find((key) => key.startsWith('thing')), /&id=[0-9A-Za-z]{3,}$/u);
  assert.equal(Object.values(target).includes('Target'), true);
});
