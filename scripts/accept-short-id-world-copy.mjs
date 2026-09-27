import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveAtomRuntime } from '../work-engine/atom-language/runtime-config.mjs';

const runFile = promisify(execFile);
const operator = path.resolve('scripts/deploy-thing-identity-world.mjs');
const source = resolveAtomRuntime();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-short-id-acceptance-'));
const target = resolveAtomRuntime({ localAppData: tempRoot });
const environment = { ...process.env, LOCALAPPDATA: tempRoot, ATOM_RUNTIME_BACKUP_REPO: '' };
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function run(action, attempt) {
  const args = action === 'rollback'
    ? [operator, '--rollback', attempt]
    : [operator, `--${action}`, '--attempt', attempt];
  const { stdout } = await runFile(process.execPath, args, {
    env: environment, maxBuffer: 2 * 1024 * 1024, timeout: 300_000
  });
  return JSON.parse(stdout.trim());
}

try {
  await fs.mkdir(target.worldDirectory, { recursive: true });
  const sourceBytes = await fs.readFile(source.contextFile);
  const sourceHash = digest(sourceBytes);
  for (const name of ['atom.json', 'graph.json', 'knowledge.json',
    'atom.transactions.json', 'atom.transactions.json.d']) {
    const from = path.join(source.worldDirectory, name);
    const to = path.join(target.worldDirectory, name);
    try { await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (digest(await fs.readFile(target.contextFile)) !== sourceHash
    || digest(await fs.readFile(source.contextFile)) !== sourceHash) {
    throw new Error('Source world changed during cold-copy preparation');
  }

  const dry = await run('dry-run', 'copy-dry');
  const first = await run('apply', 'copy-first');
  const firstRestart = await run('dry-run', 'copy-first-restart');
  const rolledBack = await run('rollback', first.receiptFile);
  const rollbackRestart = await run('dry-run', 'copy-rollback-restart');
  const second = await run('apply', 'copy-second');
  const secondRestart = await run('dry-run', 'copy-second-restart');
  const sourceUnchanged = digest(await fs.readFile(source.contextFile)) === sourceHash;
  const ok = dry.changed && first.changed && !firstRestart.changed
    && rolledBack.ok && rollbackRestart.changed && second.changed
    && !secondRestart.changed && sourceUnchanged
    && dry.revisions.source === first.revisions.source
    && first.revisions.target === firstRestart.revisions.source
    && rollbackRestart.revisions.source === dry.revisions.source
    && second.revisions.target === secondRestart.revisions.source;
  console.log(JSON.stringify({
    ok, copyDirectory: tempRoot, sourceHash, sourceUnchanged,
    thingCount: dry.summary.thingCount,
    sourceRevision: dry.revisions.source,
    targetRevision: second.revisions.target,
    allocatorWatermark: second.summary.allocatorWatermark,
    firstReceiptFile: first.receiptFile,
    secondReceiptFile: second.receiptFile,
    firstRestartChanged: firstRestart.changed,
    rollbackOk: rolledBack.ok,
    rollbackRestartChanged: rollbackRestart.changed,
    secondRestartChanged: secondRestart.changed
  }));
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({
    ok: false, copyDirectory: tempRoot,
    code: error.code ?? error.name, message: error.message,
    stdout: error.stdout?.slice(-3000) ?? null,
    stderr: error.stderr?.slice(-3000) ?? null
  }));
  process.exitCode = 1;
}
