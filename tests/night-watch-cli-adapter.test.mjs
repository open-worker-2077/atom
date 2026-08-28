import assert from 'node:assert/strict';
import test from 'node:test';

const adapterUrl = new URL('../scripts/night-watch-cli-adapter.mjs', import.meta.url);

test('night-watch CLI adapter validates Help, resolves its exact Agent, and sends the command through stdin', async () => {
  const { createAtomCliAdapter } = await import(adapterUrl);
  const calls = [];
  const adapter = createAtomCliAdapter({
    execute: async ({ args, stdin }) => {
      calls.push({ args, stdin });
      if (args[0] === '--help') return { stdout: 'Options:\n  --agent AGENT\n  --stdin\n' };
      if (stdin === 'atom\n') return { stdout: '{"agent~current":"🧊"}' };
      return { stdout: '{"ok":true}' };
    }
  });

  await adapter.validateHelp();
  await adapter.resolveExactAgent('🧊');
  const result = await adapter.executeStdin('🧊', 'explore {"thing":"test"}');

  assert.equal(result.stdout, '{"ok":true}');
  assert.deepEqual(calls, [
    { args: ['--help'], stdin: undefined },
    { args: ['--agent', '🧊', '--stdin'], stdin: 'atom\n' },
    { args: ['--agent', '🧊', '--stdin'], stdin: 'explore {"thing":"test"}\n' }
  ]);
});

test('night-watch CLI adapter requires a verified non-empty receipt before producing redacted evidence', async () => {
  const { createAtomCliAdapter } = await import(adapterUrl);
  const adapter = createAtomCliAdapter({
    execute: async () => ({ stdout: '{"thing@program~updated":"夜巡探针程序"}' })
  });
  const accepted = await adapter.executeVerified('🧊', 'transform {"thing.run.":"test/run/程序"}', {
    verifier: (stdout) => stdout.includes('夜巡探针程序'),
    evidenceId: 'program-run'
  });
  assert.deepEqual(accepted.evidence, {
    id: 'program-run', transport: 'public-cli-stdin', outcome: 'passed'
  });

  const missing = createAtomCliAdapter({ execute: async () => ({ stdout: '' }) });
  await assert.rejects(
    missing.executeVerified('🧊', 'transform {}', { verifier: () => true, evidenceId: 'missing' }),
    (error) => error.code === 'NIGHT_WATCH_CLI_EVIDENCE_MISSING'
  );
  await assert.rejects(
    adapter.executeVerified('🧊', 'transform {}', { verifier: () => false, evidenceId: 'mismatch' }),
    (error) => error.code === 'NIGHT_WATCH_CLI_EVIDENCE_MISMATCH'
  );
});

test('night-watch CLI adapter returns a nonzero Graph receipt so an exact absent read can remain an evidence-bearing outcome', async () => {
  const { createAtomCliAdapter } = await import(adapterUrl);
  const adapter = createAtomCliAdapter({
    execute: async () => {
      throw Object.assign(new Error('atom exited 4'), {
        stdout: '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}',
        stderr: '关联 test-correlation',
        exitCode: 4
      });
    }
  });

  const result = await adapter.executeStdin('🧊', 'explore {"thing":"世界之外/test/不存在"}');

  assert.equal(result.stdout, '{"ok":false,"errors":[{"code":"ATOM_NOT_FOUND"}]}');
  assert.equal(result.stderr, '关联 test-correlation');
  assert.equal(result.exitCode, 4);
});

test('night-watch CLI adapter normalizes the real stderr-only Graph denial into a receipt for exact read-back handling', async () => {
  const { createAtomCliAdapter } = await import(adapterUrl);
  const adapter = createAtomCliAdapter({
    execute: async () => {
      throw Object.assign(new Error('关联 test-correlation\n错误 ATOM_NOT_FOUND：不存在'), {
        stdout: '',
        stderr: '关联 test-correlation\n错误 ATOM_NOT_FOUND：不存在',
        exitCode: 4
      });
    }
  });

  const result = await adapter.executeStdin('🧊', 'explore {"thing":"世界之外/test/不存在"}');

  assert.match(result.stdout, /ATOM_NOT_FOUND/u);
  assert.equal(result.stderr, '关联 test-correlation\n错误 ATOM_NOT_FOUND：不存在');
  assert.equal(result.exitCode, 4);
});
