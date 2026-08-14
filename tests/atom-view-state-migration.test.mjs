import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createViewStateRepository } from '../src/atom-system/adapters/json-view-state-repository.mjs';
import {
  applyViewStateMigration,
  planViewStateMigration,
  reverseViewStateMigration
} from '../src/atom-system/operations/migrate-view-state.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-view-state-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const knowledgeFile = path.join(directory, 'knowledge.json');
  const viewFile = path.join(directory, 'view-state.json');
  const backupRoot = path.join(directory, 'backups');
  const knowledge = {
    schemaVersion: 1,
    revision: 7,
    nodes: [{ id: 'n1' }],
    edges: [],
    view: { path: 'root/a', mode: 'nested', camera: { distance: 4 } }
  };
  await fs.writeFile(knowledgeFile, `${JSON.stringify(knowledge, null, 2)}\n`, 'utf8');
  return { directory, knowledgeFile, viewFile, backupRoot, knowledge };
}

test('migration planning is read-only and reports exact source and target hashes', async (t) => {
  const files = await fixture(t);
  const before = await fs.readFile(files.knowledgeFile, 'utf8');
  const plan = await planViewStateMigration({
    knowledgeFile: files.knowledgeFile,
    viewFile: files.viewFile,
    backupRoot: files.backupRoot,
    worldId: 'primary'
  });

  assert.equal(await fs.readFile(files.knowledgeFile, 'utf8'), before);
  await assert.rejects(fs.access(files.viewFile));
  assert.equal(plan.worldId, 'primary');
  assert.equal(plan.nodeCount, 1);
  assert.match(plan.sourceHash, /^sha256:/u);
  assert.match(plan.projectedKnowledgeHash, /^sha256:/u);
  assert.match(plan.viewStateHash, /^sha256:/u);
  assert.notEqual(plan.sourceHash, plan.projectedKnowledgeHash);
});

test('apply requires explicit authority, preserves a backup, and separates view facts', async (t) => {
  const files = await fixture(t);
  const plan = await planViewStateMigration({
    knowledgeFile: files.knowledgeFile,
    viewFile: files.viewFile,
    backupRoot: files.backupRoot,
    worldId: 'primary'
  });
  await assert.rejects(applyViewStateMigration(plan), (error) => error.code === 'VIEW_MIGRATION_CONFIRMATION_REQUIRED');

  const result = await applyViewStateMigration(plan, { confirm: true, timestamp: '20260810-120000' });
  const knowledge = JSON.parse(await fs.readFile(files.knowledgeFile, 'utf8'));
  const viewState = await createViewStateRepository({ file: files.viewFile, worldId: 'primary' }).read();

  assert.equal(knowledge.view, null);
  assert.deepEqual(viewState.view, files.knowledge.view);
  assert.equal(result.knowledgeHash, plan.projectedKnowledgeHash);
  assert.equal(result.viewStateHash, plan.viewStateHash);
  assert.equal(JSON.parse(await fs.readFile(path.join(result.backupDirectory, 'knowledge.json'), 'utf8')).view.path, 'root/a');
});

test('conflicting existing view state blocks migration before source changes', async (t) => {
  const files = await fixture(t);
  await fs.writeFile(files.viewFile, JSON.stringify({ contract: 'other' }), 'utf8');
  const before = await fs.readFile(files.knowledgeFile, 'utf8');

  await assert.rejects(
    planViewStateMigration({
      knowledgeFile: files.knowledgeFile,
      viewFile: files.viewFile,
      backupRoot: files.backupRoot,
      worldId: 'primary'
    }),
    (error) => error.code === 'VIEW_STATE_TARGET_CONFLICT'
  );
  assert.equal(await fs.readFile(files.knowledgeFile, 'utf8'), before);
});

test('reverse migration restores the embedded view and soft-archives the separate file', async (t) => {
  const files = await fixture(t);
  const plan = await planViewStateMigration({
    knowledgeFile: files.knowledgeFile,
    viewFile: files.viewFile,
    backupRoot: files.backupRoot,
    worldId: 'primary'
  });
  await applyViewStateMigration(plan, { confirm: true, timestamp: '20260810-120000' });
  const reversed = await reverseViewStateMigration({
    knowledgeFile: files.knowledgeFile,
    viewFile: files.viewFile,
    backupRoot: files.backupRoot,
    confirm: true,
    timestamp: '20260810-130000'
  });

  const knowledge = JSON.parse(await fs.readFile(files.knowledgeFile, 'utf8'));
  assert.deepEqual(knowledge.view, files.knowledge.view);
  await assert.rejects(fs.access(files.viewFile));
  assert.equal(JSON.parse(await fs.readFile(reversed.archivedViewFile, 'utf8')).view.path, 'root/a');
});
