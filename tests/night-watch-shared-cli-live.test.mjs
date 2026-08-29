import assert from 'node:assert/strict';
import test from 'node:test';

const moduleUrl = new URL('../scripts/night-watch-shared-cli-live.mjs', import.meta.url);

test('shared night-watch accepts only the approved Agent and exact bounded run subtree', async () => {
  const { parseSharedNightWatchOptions } = await import(moduleUrl);
  const options = parseSharedNightWatchOptions([
    '--agent', '🧊manage',
    '--root', '🧊manage/工务/work/test/nw-20260829-001',
    '--evidence-dir', 'evidence'
  ]);

  assert.equal(options.agent, '🧊manage');
  assert.equal(options.rootPath, '🧊manage/工务/work/test/nw-20260829-001');
  assert.match(options.evidenceDir, /evidence$/u);
  assert.throws(
    () => parseSharedNightWatchOptions([
      '--agent', '🧊manage', '--root', '🧊manage/工务/work/test/../个务', '--evidence-dir', 'evidence'
    ]),
    (error) => error.code === 'NIGHT_WATCH_SHARED_SCOPE_INVALID'
  );
});

test('shared night-watch readiness follows the current atomProjection health field', async () => {
  const { assertSharedHealth } = await import(moduleUrl);
  assert.deepEqual(assertSharedHealth({
    ok: true,
    version: '0.3.0',
    atomProjection: { status: 'published', revision: 6898 }
  }), { version: '0.3.0', revision: 6898, projectionStatus: 'published' });
  assert.throws(
    () => assertSharedHealth({ ok: true, atomProjection: { status: 'recovering' } }),
    (error) => error.code === 'NIGHT_WATCH_SHARED_NOT_READY'
  );
});
