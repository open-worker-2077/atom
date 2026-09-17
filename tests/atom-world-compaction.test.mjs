import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJsonWorldRepository } from '../src/atom-system/adapters/json-world-repository.mjs';
import { createLocalWorldPatch } from '../src/atom-system/world-runtime/local-world-patch.mjs';
import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';

process.env.ATOM_RUNTIME_BACKUP_REPO = '';
const facts = (situation) => [{ thing: 'Root', situation, slot: [], strut: [] }];

async function fixture(t, { directorySync = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-compaction-proof-'));
  t.diagnostic(`Retained synthetic fixture: ${directory}`);
  const file = path.join(directory, 'atom.json');
  const localCommitFile = path.join(directory, 'world-commits.jsonl');
  const counts = { reads: 0, bytes: 0 };
  let failingSync = 0;
  let afterHeadPublication = null;
  let afterLogReplacement = null;
  let afterHeadStat = null;
  const injectionErrors = [];
  t.after(() => assert.deepEqual(injectionErrors, [], 'filesystem race injection must actually succeed'));
  const fileSystem = {
    ...fs,
    async stat(target, ...args) {
      const value = await fs.stat(target, ...args);
      if (path.resolve(target) === `${localCommitFile}.head.json` && afterHeadStat) {
        const callback = afterHeadStat;
        afterHeadStat = null;
        await callback();
      }
      return value;
    },
    async rename(source, target) {
      await fs.rename(source, target);
      const callback = path.resolve(target) === `${localCommitFile}.head.json`
        ? afterHeadPublication : path.resolve(target) === localCommitFile ? afterLogReplacement : null;
      if (callback) {
        if (path.resolve(target) === localCommitFile) afterLogReplacement = null;
        else afterHeadPublication = null;
        try { await callback(); }
        catch (error) { injectionErrors.push(error.code ?? error.message); throw error; }
      }
    },
    async readFile(target, ...args) {
      const value = await fs.readFile(target, ...args);
      if (path.resolve(target) === localCommitFile) {
        counts.reads += 1;
        counts.bytes += Buffer.byteLength(value);
      }
      return value;
    },
    async open(target, flags, ...args) {
      if (path.resolve(target) === directory) return {
        async sync() {
          if (!directorySync) throw Object.assign(new Error('directory sync unavailable'), { code: 'EPERM' });
        }, async close() {}
      };
      const handle = await fs.open(target, flags, ...args);
      if (path.resolve(target) !== localCommitFile) return handle;
      return new Proxy(handle, { get(object, property) {
        if (property === 'sync') return async () => {
          if (failingSync && --failingSync === 0) {
            throw Object.assign(new Error('injected log sync failure'), { code: 'EIO' });
          }
          return object.sync();
        };
        const value = Reflect.get(object, property);
        return typeof value === 'function' ? value.bind(object) : value;
      } });
    }
  };
  await fs.writeFile(file, JSON.stringify(facts('zero')));
  const options = { file, worldId: 'primary', localCommitFile, autoCompact: 2, fileSystem };
  return { ...options, directory, counts,
    repository: createJsonWorldRepository(options),
    resetCounts: () => { counts.reads = 0; counts.bytes = 0; },
    failProofSync: () => { failingSync = 2; },
    onNextHead: (callback) => { afterHeadPublication = callback; },
    onNextLogReplacement: (callback) => { afterLogReplacement = callback; },
    onNextHeadStat: (callback) => { afterHeadStat = callback; },
    async restart() {
      const module = await import(`../src/atom-system/adapters/json-world-repository.mjs?compaction=${crypto.randomUUID()}`);
      return module.createJsonWorldRepository(options);
    }
  };
}

async function append(repository, id, situation) {
  const current = await repository.read();
  const next = facts(situation);
  return repository.appendLocalCommit({ commandId: id, expectedRevision: current.revision,
    nextSnapshot: { worldId: 'primary', revision: revisionOfWorldFacts(next), facts: next },
    patch: createLocalWorldPatch({ worldId: 'primary', beforeRevision: current.revision,
      afterRevision: revisionOfWorldFacts(next), beforeFacts: current.facts,
      afterFacts: next, changedPaths: ['Root'] }) });
}

for (const directorySync of [true, false]) {
  test(`same-owner compaction reuses verified history with directory sync ${directorySync}`, async (t) => {
    const f = await fixture(t, { directorySync });
    await append(f.repository, 'first', 'one');
    const io = [];
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      f.resetCounts();
      await append(f.repository, `cycle-${cycle}-a`, `${cycle}-a`);
      await append(f.repository, `cycle-${cycle}-b`, `${cycle}-b`);
      await f.repository.scheduleCompaction();
      io.push({ ...f.counts });
    }
    t.diagnostic(`Steady append/compaction I/O: ${JSON.stringify(io)}`);
    assert.deepEqual(io, Array.from({ length: 3 }, () => ({ reads: 0, bytes: 0 })));
    const restarted = await f.restart();
    assert.deepEqual((await restarted.read()).facts, facts('3-b'));
  });
}

test('a proven Windows baseline supports generation compaction and full writes without historical reads', async (t) => {
  const f = await fixture(t, { directorySync: false });
  await append(f.repository, 'bootstrap-a', 'one');
  await append(f.repository, 'bootstrap-b', 'two');
  await f.repository.scheduleCompaction();
  const frozenBaseline = await fs.readFile(f.file, 'utf8');
  const owner = await f.restart();
  await owner.read();
  f.resetCounts();
  await append(owner, 'generation-a', 'three');
  await append(owner, 'generation-b', 'four');
  await owner.scheduleCompaction();
  const generationIO = { ...f.counts };
  f.resetCounts();
  const current = await owner.read();
  await owner.compareAndSwap({ commandId: 'full-final', expectedRevision: current.revision,
    nextSnapshot: { worldId: 'primary', revision: revisionOfWorldFacts(facts('five')), facts: facts('five') } });
  const fullIO = { ...f.counts };
  t.diagnostic(`Frozen-baseline I/O: ${JSON.stringify({ generationIO, fullIO })}`);
  assert.deepEqual(generationIO, { reads: 0, bytes: 0 });
  assert.deepEqual(fullIO, { reads: 0, bytes: 0 });
  assert.equal(await fs.readFile(f.file, 'utf8'), frozenBaseline);
  const generation = JSON.parse((await fs.readFile(f.localCommitFile, 'utf8')).split('\n')[0]);
  assert.equal(generation.contract, 'atom.local-commit-generation');
  assert.ok(generation.members.length <= 2);
  assert.equal(generation.members.at(-1).commandId, 'full-final');
  assert.deepEqual((await (await f.restart()).read()).facts, facts('five'));
});

test('same-size external log replacement invalidates the cached command identities', async (t) => {
  const f = await fixture(t);
  await append(f.repository, 'first', 'one');
  const original = await fs.readFile(f.localCommitFile, 'utf8');
  const [record, proof] = original.trim().split('\n').map(JSON.parse);
  record.commandId = 'other';
  const recordText = JSON.stringify(record);
  proof.recordDigest = `sha256:${crypto.createHash('sha256').update(recordText).digest('hex')}`;
  const replacement = `${recordText}\n${JSON.stringify(proof)}\n`;
  assert.equal(Buffer.byteLength(replacement), Buffer.byteLength(original));
  await fs.writeFile(`${f.localCommitFile}.external`, replacement);
  await fs.rename(`${f.localCommitFile}.external`, f.localCommitFile);
  f.resetCounts();
  await f.repository.compactCommittedState();
  t.diagnostic(`External same-size replacement I/O: ${JSON.stringify(f.counts)}`);
  assert.ok(f.counts.reads >= 1, 'changed file identity must be verified again');
  const watermark = JSON.parse((await fs.readFile(f.localCommitFile, 'utf8')).trim());
  assert.equal(watermark.throughCommandId, 'other');
  assert.deepEqual((await (await f.restart()).read()).facts, facts('one'));
});

test('external incomplete tail is verified and repaired before its prefix can be reused', async (t) => {
  const f = await fixture(t, { directorySync: false });
  await append(f.repository, 'first', 'one');
  await fs.appendFile(f.localCommitFile, '{"incomplete":');
  f.resetCounts();
  await f.repository.compactCommittedState();
  const repairIO = { ...f.counts };
  assert.ok(repairIO.reads >= 1);
  assert.ok(!(await fs.readFile(f.localCommitFile, 'utf8')).includes('incomplete'));
  f.resetCounts();
  await f.repository.compactCommittedState();
  t.diagnostic(`Tail repair I/O: ${JSON.stringify({ repairIO, reused: f.counts })}`);
  assert.deepEqual(f.counts, { reads: 0, bytes: 0 });
  assert.deepEqual((await (await f.restart()).read()).facts, facts('one'));
});

test('same-size invalid external publication head cannot reuse cached proof', async (t) => {
  const f = await fixture(t);
  await append(f.repository, 'first', 'one');
  const headFile = `${f.localCommitFile}.head.json`;
  const original = await fs.readFile(headFile, 'utf8');
  const invalid = original.replace('"version":1', '"version":2');
  assert.equal(Buffer.byteLength(invalid), Buffer.byteLength(original));
  assert.notEqual(invalid, original);
  await fs.writeFile(headFile, invalid);
  await assert.rejects(f.repository.compactCommittedState(), { code: 'INVALID_LOCAL_WORLD_COMMIT_HEAD' });
  assert.deepEqual(JSON.parse(await fs.readFile(f.file, 'utf8')), facts('zero'));
});

test('failed proof publication cannot enter later cached compaction metadata', async (t) => {
  const f = await fixture(t);
  await append(f.repository, 'first', 'one');
  f.failProofSync();
  await assert.rejects(append(f.repository, 'failed', 'two'), { code: 'EIO' });
  f.resetCounts();
  await f.repository.compactCommittedState();
  const recoveryIO = { ...f.counts };
  assert.ok(recoveryIO.reads >= 1);
  assert.equal((await f.repository.read()).facts[0].situation, 'one');
  f.resetCounts();
  await append(f.repository, 'third', 'three');
  await f.repository.compactCommittedState();
  t.diagnostic(`Failed-publication I/O: ${JSON.stringify({ recoveryIO, reused: f.counts })}`);
  assert.deepEqual(f.counts, { reads: 0, bytes: 0 });
  const watermark = JSON.parse((await fs.readFile(f.localCommitFile, 'utf8')).trim());
  assert.equal(watermark.throughCommandId, 'third');
  assert.deepEqual((await (await f.restart()).read()).facts, facts('three'));
});

test('external same-size rewrite during append cannot be blessed as the owned log', async (t) => {
  const f = await fixture(t);
  await append(f.repository, 'first', 'one');
  f.onNextHead(async () => {
    const original = await fs.readFile(f.localCommitFile, 'utf8');
    const lines = original.trim().split('\n');
    const record = JSON.parse(lines.at(-2));
    const proof = JSON.parse(lines.at(-1));
    record.commandId = 'others';
    lines[lines.length - 2] = JSON.stringify(record);
    proof.recordDigest = `sha256:${crypto.createHash('sha256').update(lines.at(-2)).digest('hex')}`;
    lines[lines.length - 1] = JSON.stringify(proof);
    const replacement = `${lines.join('\n')}\n`;
    assert.equal(Buffer.byteLength(replacement), Buffer.byteLength(original));
    // Windows prevents renaming over this still-open log. An in-place rewrite
    // exercises the same-size change while the owned handle remains open.
    await fs.writeFile(f.localCommitFile, replacement);
  });
  await append(f.repository, 'second', 'two');
  f.resetCounts();
  await f.repository.compactCommittedState();
  t.diagnostic(`Replacement during append verification I/O: ${JSON.stringify(f.counts)}`);
  assert.ok(f.counts.reads >= 1);
  assert.equal(JSON.parse((await fs.readFile(f.localCommitFile, 'utf8')).trim()).throughCommandId, 'others');
});

test('external append before metadata publication cannot be hidden or truncated by compaction', async (t) => {
  const f = await fixture(t);
  await append(f.repository, 'first', 'one');
  f.onNextHead(async () => {
    const record = { contract: 'atom.local-commit', version: 1, mode: 'full', worldId: 'primary',
      commandId: 'external', beforeRevision: revisionOfWorldFacts(facts('two')),
      afterRevision: revisionOfWorldFacts(facts('three')), facts: facts('three'), publicationId: crypto.randomUUID() };
    const serialized = JSON.stringify(record);
    const proof = { contract: 'atom.local-commit-publication', version: 1, worldId: 'primary',
      publicationId: record.publicationId,
      recordDigest: `sha256:${crypto.createHash('sha256').update(serialized).digest('hex')}` };
    await fs.appendFile(f.localCommitFile, `${serialized}\n${JSON.stringify(proof)}\n`);
  });
  await append(f.repository, 'second', 'two');
  await f.repository.compactCommittedState();
  assert.deepEqual((await f.repository.read()).facts, facts('three'));
  assert.deepEqual((await (await f.restart()).read()).facts, facts('three'));
});

test('external replacement of a just-written log is not adopted as verified compaction metadata', async (t) => {
  const f = await fixture(t);
  await append(f.repository, 'first', 'one');
  f.onNextLogReplacement(async () => {
    const original = await fs.readFile(f.localCommitFile, 'utf8');
    const corrupt = original.replace('"version":1', '"version":2');
    assert.equal(Buffer.byteLength(corrupt), Buffer.byteLength(original));
    await fs.writeFile(`${f.localCommitFile}.external`, corrupt);
    await fs.rename(`${f.localCommitFile}.external`, f.localCommitFile);
  });
  await f.repository.compactCommittedState();
  await assert.rejects(f.repository.read(), { code: 'INVALID_LOCAL_WORLD_COMMIT' });
});

test('cold Windows fallback proof reuses the records verified by the same read', async (t) => {
  const f = await fixture(t, { directorySync: false });
  await append(f.repository, 'bootstrap-a', 'one');
  await append(f.repository, 'bootstrap-b', 'two');
  await f.repository.scheduleCompaction();
  const priorBytes = (await fs.stat(f.localCommitFile)).size;
  const owner = await f.restart();
  f.resetCounts();
  assert.deepEqual((await owner.read()).facts, facts('two'));
  const watermarkBytes = (await fs.stat(f.localCommitFile)).size;
  t.diagnostic(`Cold fallback proof I/O: ${JSON.stringify({ ...f.counts, priorBytes, watermarkBytes })}`);
  assert.deepEqual(f.counts, { reads: 2, bytes: priorBytes + watermarkBytes },
    'scan the old log once, then read only the newly published watermark on retry');
});

test('compaction refuses a snapshot whose log changes before metadata verification', async (t) => {
  const f = await fixture(t);
  await append(f.repository, 'first', 'one');
  f.onNextHeadStat(async () => {
    const record = { contract: 'atom.local-commit', version: 1, mode: 'full', worldId: 'primary',
      commandId: 'external', beforeRevision: revisionOfWorldFacts(facts('one')),
      afterRevision: revisionOfWorldFacts(facts('two')), facts: facts('two'), publicationId: crypto.randomUUID() };
    const serialized = JSON.stringify(record);
    const proof = { contract: 'atom.local-commit-publication', version: 1, worldId: 'primary',
      publicationId: record.publicationId,
      recordDigest: `sha256:${crypto.createHash('sha256').update(serialized).digest('hex')}` };
    await fs.appendFile(f.localCommitFile, `${serialized}\n${JSON.stringify(proof)}\n`);
  });
  await assert.rejects(f.repository.compactCommittedState(), { code: 'LOCAL_WORLD_COMMIT_CHANGED' });
  assert.deepEqual((await (await f.restart()).read()).facts, facts('two'),
    'a stale compactor must not truncate the verified external successor');
});
