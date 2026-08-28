import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { writeAtomGraphProjection } from '../work-engine/atom-language/context-store.mjs';
import { executeProgramExplore } from '../work-engine/atom-language/query-capability.mjs';
import { createAtomLanguageReceiver } from '../work-engine/atom-language/receiver.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(thing, situation = '', contain = [], type = '') {
  return { [`thing${type ? `@${type}` : ''}`]: thing, situation, contain, support: [] };
}

async function filesFor(t, atoms, prefix = 'atom-boundary-preview-') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');
  await writeAtomGraphProjection(projectionFile, atoms, { rootName: 'atom.json' });
  return { contextFile, projectionFile };
}

function routeFixture() {
  return [atom('Root', 'r', [
    atom('Left', 'll'),
    atom('Center', 'ccc', [
      atom('Child', 'cc', [
        atom('Deep', 'ddd'),
        atom('Runner', 'pass', [], 'program')
      ])
    ]),
    atom('Right', 'rrrr'),
    atom('FarRight', 'f')
  ])];
}

async function runCli(files, source) {
  let stdout = '';
  let stderr = '';
  const code = await runAtomCli([
    '--context', files.contextFile,
    '--projection', files.projectionFile,
    'explore', source
  ], {
    execute: executeAtomLanguage,
    stdin: { isTTY: false },
    stdout: { isTTY: false, write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } }
  });
  return { code, stdout, stderr };
}

test('ordinary Explore reports unreturned coordinate nodes and readable characters', async (t) => {
  const files = await filesFor(t, routeFixture());
  const result = await executeAtomLanguage({
    ...files,
    source: 'explore {"thing":"Center","situation$full":true,"contain$latitude-1":true,"contain$longitude+1":true}'
  });

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.items[0].boundary.down, {
    state: 'complete', hasMore: true, nodes: 2, characters: 13
  });
  assert.deepEqual(result.items[0].boundary.left, {
    state: 'complete', hasMore: true, nodes: 1, characters: 6
  });
  assert.deepEqual(result.items[0].boundary.right, {
    state: 'complete', hasMore: true, nodes: 1, characters: 9
  });
});

test('ordinary Explore recalculates the boundary after re-anchoring along the route', async (t) => {
  const files = await filesFor(t, routeFixture());
  const center = await executeAtomLanguage({
    ...files,
    source: 'explore {"thing":"Center","contain$latitude-1":true}'
  });
  const child = await executeAtomLanguage({
    ...files,
    source: 'explore {"thing":"Center/Child","contain$latitude-1":true}'
  });

  assert.equal(center.items[0].boundary.down.nodes, 2);
  assert.deepEqual(child.items[0].boundary.down, {
    state: 'complete', hasMore: false, nodes: 0, characters: 0
  });
  assert.equal(child.items[0].boundary.up.nodes, 3);
});

test('protected continuation is explicit without leaking names, content, or exact counts', async (t) => {
  const property = (name, detail) => atom(name, detail);
  const files = await filesFor(t, [
    atom('Work Agent', '', [], 'agent'),
    atom('Root', '', [atom('Center', '', [atom('Public', 'shown'), atom('Secret', 'hidden')])]),
    {
      'thing@lock': 'Secret seal',
      situation: '',
      contain: [
        property('law', 'atom.lock.basic'),
        property('effect', 'seal'),
        property('actions', 'read,write'),
        property('scope', 'subtree'),
        property('grade', '0'),
        property('key_requirement', ''),
        property('protects', 'Root/Center/Secret'),
        property('applies_to', 'Work Agent'),
        property('enabled', 'true')
      ],
      support: []
    }
  ], 'atom-protected-boundary-');
  const result = await executeAtomLanguage({
    ...files,
    legacyAccess: { window: 'Work Agent', keys: [] },
    source: 'explore {"thing":"Center"}'
  });
  const serialized = JSON.stringify(result.items[0].boundary);

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.items[0].boundary.down, {
    state: 'protected', hasMore: true
  });
  assert.equal(serialized.includes('Secret'), false);
  assert.equal(serialized.includes('hidden'), false);
  assert.equal(Object.hasOwn(result.items[0].boundary.down, 'nodes'), false);
  assert.equal(Object.hasOwn(result.items[0].boundary.down, 'characters'), false);
});

test('CLI projects the query boundary beside the anchor as Graph-JSON', async (t) => {
  const files = await filesFor(t, routeFixture());
  const result = await runCli(files, '{"thing":"Center","contain$latitude-1":true}');

  assert.equal(result.code, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt['boundary~preview'].down, {
    state: 'complete', hasMore: true, nodes: 2, characters: 13
  });
  assert.equal(receipt.thing, 'Center');
  assert.deepEqual(receipt.contain.map((child) => child.thing), ['Child']);
});

test('Program Explore remains a list containing only real Atom matches', async () => {
  const program = await executeProgramExplore({
    atoms: routeFixture(),
    request: { thing: 'Center', 'contain$latitude-1': true },
    receiver: createAtomLanguageReceiver()
  });

  assert.equal(Array.isArray(program), true);
  assert.deepEqual(program.map(({ path }) => path), ['Root/Center', 'Root/Center/Child']);
  assert.equal(program.every((row) => typeof row.path === 'string'), true);
});
