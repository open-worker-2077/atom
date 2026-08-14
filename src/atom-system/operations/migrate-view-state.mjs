import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createViewStateDocument, validateViewStateDocument } from '../spatial-experience/view-state-repository.mjs';

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function hash(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

async function exists(file) {
  try { await fs.access(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readJson(file, code) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw problem(code, `Cannot read ${file}`, { cause: error.code ?? error.name });
  }
}

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export async function planViewStateMigration({ knowledgeFile, viewFile, backupRoot, worldId }) {
  if (await exists(viewFile)) {
    throw problem('VIEW_STATE_TARGET_CONFLICT', 'Separate view-state target already exists', { viewFile });
  }
  const knowledge = await readJson(knowledgeFile, 'KNOWLEDGE_SOURCE_INVALID');
  if (!knowledge || typeof knowledge !== 'object' || Array.isArray(knowledge)) {
    throw problem('KNOWLEDGE_SOURCE_INVALID', 'Knowledge source must be an object');
  }
  const projectedKnowledge = { ...structuredClone(knowledge), view: null };
  const viewState = createViewStateDocument({
    worldId,
    revision: 1,
    view: knowledge.view && typeof knowledge.view === 'object' ? knowledge.view : null
  });
  return Object.freeze({
    contract: 'atom.view-state-migration-plan',
    version: 1,
    knowledgeFile: path.resolve(knowledgeFile),
    viewFile: path.resolve(viewFile),
    backupRoot: path.resolve(backupRoot),
    worldId,
    nodeCount: Array.isArray(knowledge.nodes) ? knowledge.nodes.length : 0,
    sourceHash: hash(knowledge),
    projectedKnowledgeHash: hash(projectedKnowledge),
    viewStateHash: hash(viewState),
    projectedKnowledge,
    viewState
  });
}

function requireConfirmation(confirm) {
  if (confirm !== true) {
    throw problem('VIEW_MIGRATION_CONFIRMATION_REQUIRED', 'View-state migration requires explicit confirmation');
  }
}

export async function applyViewStateMigration(plan, options = {}) {
  requireConfirmation(options.confirm);
  if (!plan || plan.contract !== 'atom.view-state-migration-plan' || plan.version !== 1) {
    throw problem('INVALID_VIEW_MIGRATION_PLAN', 'A valid migration plan is required');
  }
  const current = await readJson(plan.knowledgeFile, 'KNOWLEDGE_SOURCE_INVALID');
  if (hash(current) !== plan.sourceHash) {
    throw problem('VIEW_MIGRATION_SOURCE_CHANGED', 'Knowledge source changed after migration planning');
  }
  if (await exists(plan.viewFile)) {
    throw problem('VIEW_STATE_TARGET_CONFLICT', 'Separate view-state target already exists');
  }
  const timestamp = options.timestamp ?? new Date().toISOString().replace(/[:.]/gu, '-');
  const backupDirectory = path.join(plan.backupRoot, timestamp);
  await fs.mkdir(plan.backupRoot, { recursive: true });
  await fs.mkdir(backupDirectory, { recursive: false });
  await fs.copyFile(plan.knowledgeFile, path.join(backupDirectory, path.basename(plan.knowledgeFile)));

  await atomicWrite(plan.viewFile, plan.viewState);
  await atomicWrite(plan.knowledgeFile, plan.projectedKnowledge);
  const [knowledge, viewState] = await Promise.all([
    readJson(plan.knowledgeFile, 'KNOWLEDGE_SOURCE_INVALID'),
    readJson(plan.viewFile, 'INVALID_VIEW_STATE_DOCUMENT')
  ]);
  validateViewStateDocument(viewState, plan.worldId);
  const knowledgeHash = hash(knowledge);
  const viewStateHash = hash(viewState);
  if (knowledgeHash !== plan.projectedKnowledgeHash || viewStateHash !== plan.viewStateHash) {
    throw problem('VIEW_MIGRATION_VERIFICATION_FAILED', 'Migrated files do not match their planned hashes');
  }
  return Object.freeze({ backupDirectory, knowledgeHash, viewStateHash });
}

export async function reverseViewStateMigration({
  knowledgeFile,
  viewFile,
  backupRoot,
  confirm,
  timestamp = new Date().toISOString().replace(/[:.]/gu, '-')
}) {
  requireConfirmation(confirm);
  const [knowledge, viewState] = await Promise.all([
    readJson(knowledgeFile, 'KNOWLEDGE_SOURCE_INVALID'),
    readJson(viewFile, 'INVALID_VIEW_STATE_DOCUMENT')
  ]);
  validateViewStateDocument(viewState);
  const restored = { ...knowledge, view: structuredClone(viewState.view) };
  const reverseDirectory = path.join(path.resolve(backupRoot), `reverse-${timestamp}`);
  await fs.mkdir(path.resolve(backupRoot), { recursive: true });
  await fs.mkdir(reverseDirectory, { recursive: false });
  await fs.copyFile(knowledgeFile, path.join(reverseDirectory, path.basename(knowledgeFile)));
  const archivedViewFile = path.join(reverseDirectory, path.basename(viewFile));
  await fs.copyFile(viewFile, archivedViewFile);
  await atomicWrite(knowledgeFile, restored);
  await fs.rename(viewFile, `${archivedViewFile}.active-copy`);
  return Object.freeze({ reverseDirectory, archivedViewFile: `${archivedViewFile}.active-copy` });
}
