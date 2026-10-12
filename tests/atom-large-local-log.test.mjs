import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJsonWorldRepository } from '../src/atom-system/adapters/json-world-repository.mjs';

const revision = facts => `sha256:${crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex')}`;
test('cold recovery and durable evidence do not read the entire local log into one buffer', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-large-local-log-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'atom.json');
  const log = `${file}.local-commits.jsonl`;
  const facts = [{ thing: '中文跨块', situation: '正文'.repeat(40000) }];
  await fs.writeFile(file, '[]');
  const record = { contract: 'atom.local-commit', version: 1, worldId: 'primary',
    mode: 'full', commandId: 'large-commit', publicationId: 'publication',
    beforeRevision: revision([]), afterRevision: revision(facts), facts };
  const body = JSON.stringify(record);
  const proof = { contract: 'atom.local-commit-publication', version: 1, worldId: 'primary',
    publicationId: record.publicationId,
    recordDigest: `sha256:${crypto.createHash('sha256').update(body).digest('hex')}` };
  await fs.writeFile(log, `${body}\n${JSON.stringify(proof)}\n{"interrupted":`);
  let boundedReads = 0;
  const fileSystem = { ...fs, async readFile(target, ...args) {
    if (target === log) throw Object.assign(new Error('File size exceeds 2 GiB'), { code: 'ERR_FS_FILE_TOO_LARGE' });
    return fs.readFile(target, ...args);
  }, async open(target, ...args) {
    if (target === log) boundedReads++;
    return fs.open(target, ...args);
  } };
  const repository = createJsonWorldRepository({ file, worldId: 'primary', fileSystem });
  assert.deepEqual((await repository.read()).facts, facts);
  assert.equal((await repository.durableSuccessor(record.beforeRevision)).commandId, record.commandId);
  assert.equal(await repository.hasDurableCommit(record), true);
  assert.equal((await repository.recoverIndeterminateCommit(record)).status, 'committed');
  assert.ok(boundedReads > 0);
});
