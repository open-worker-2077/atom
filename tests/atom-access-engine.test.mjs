import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';
import { readAtomContext, writeAtomGraphProjection } from '../work-engine/atom-language/context-store.mjs';

async function publishProjection(files) {
  await writeAtomGraphProjection(
    files.projectionFile,
    await readAtomContext(files.contextFile, { create: false }),
    { rootName: path.basename(files.contextFile) }
  );
}

function atom(name, detail = '', children = [], partners = [], type = '') {
  return {
    [`name${type ? `@${type}` : ''}`]: name,
    detail,
    children,
    partners
  };
}

function property(name, detail) {
  return atom(name, detail);
}

function fixture() {
  return [
    atom('Work Agent', '', [], [], 'agent'),
    atom('Work', '', [atom('Task', 'deliver')]),
    atom('Personal', '', [atom('Diary', 'secret')]),
    atom('Personal seal', '', [
      property('law', 'atom.lock.basic'),
      property('effect', 'seal'),
      property('actions', 'read,write'),
      property('scope', 'subtree'),
      property('grade', '0'),
      property('key_requirement', ''),
      property('enabled', 'true')
    ], [
      { verb: 'protects', object: 'Personal' },
      { verb: 'applies_to', object: 'Work Agent' }
    ], 'lock')
  ];
}

async function isolated(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-access-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(fixture(), null, 2)}\n`);
  return { contextFile, projectionFile };
}

function digest(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

const legacyAccess = { window: 'Work Agent', keys: [] };

test('explore truncates a sealed exact target without leaking its name or path', async (t) => {
  const files = await isolated(t);
  const result = await executeAtomLanguage({
    ...files, legacyAccess,
    source: 'explore {"name":"Diary","detail$full"}'
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, true);
  assert.deepEqual(result.items[0].matches, []);
  assert.equal(result.warnings.some((warning) => warning.code === 'WINDOW_SCOPE_TRUNCATED'), true);
  assert.equal(serialized.includes('Diary'), false);
  assert.equal(serialized.includes('Personal'), false);
  assert.equal(serialized.includes('secret'), false);
});

test('transform denial leaves context and projection revisions unchanged', async (t) => {
  const files = await isolated(t);
  await publishProjection(files);
  const beforeContext = await fs.readFile(files.contextFile, 'utf8');
  const beforeProjection = await fs.readFile(files.projectionFile, 'utf8');

  const result = await executeAtomLanguage({
    ...files, legacyAccess,
    source: 'transform {"name":"Diary","detail.rep.changed"}'
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'WINDOW_ACCESS_DENIED');
  assert.equal(JSON.stringify(result).includes('Diary'), false);
  assert.equal(digest(await fs.readFile(files.contextFile, 'utf8')), digest(beforeContext));
  assert.equal(digest(await fs.readFile(files.projectionFile, 'utf8')), digest(beforeProjection));
});

test('an allowed work target remains readable and writable through the same evaluator', async (t) => {
  const files = await isolated(t);
  let result = await executeAtomLanguage({
    ...files, legacyAccess,
    source: 'explore {"name":"Task","detail$full"}'
  });
  assert.equal(result.items[0].matches[0].detail, 'deliver');

  result = await executeAtomLanguage({
    ...files, legacyAccess,
    source: 'transform {"name":"Task","detail.rep.done"}'
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
});

test('move preflights the locked destination through the same evaluator', async (t) => {
  const files = await isolated(t);
  await publishProjection(files);
  const before = await fs.readFile(files.contextFile, 'utf8');
  const result = await executeAtomLanguage({
    ...files, legacyAccess,
    source: 'transform {"name.mov.Personal":"Task"}'
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'WINDOW_ACCESS_DENIED');
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
});

test('window entry reports only the visible Atom count and does not rewrite the global projection', async (t) => {
  const files = await isolated(t);
  await publishProjection(files);
  const beforeProjection = await fs.readFile(files.projectionFile, 'utf8');
  const result = await executeAtomLanguage({ ...files, legacyAccess, source: 'atom' });

  assert.equal(result.ok, true);
  assert.equal(result.atomCount, 11);
  assert.equal(await fs.readFile(files.projectionFile, 'utf8'), beforeProjection);
});

test('partner replacement cannot create a relation to a sealed target', async (t) => {
  const files = await isolated(t);
  const before = await fs.readFile(files.contextFile, 'utf8');
  const result = await executeAtomLanguage({
    ...files, legacyAccess,
    source: 'transform {"name":"Task","partners.rep.":[{"verb":"mentions","object":"Personal/Diary"}]}'
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'WINDOW_ACCESS_DENIED');
  assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
});
