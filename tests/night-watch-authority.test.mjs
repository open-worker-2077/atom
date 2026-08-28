import assert from 'node:assert/strict';
import test from 'node:test';

const authorityModuleUrl = new URL('../scripts/night-watch-authority.mjs', import.meta.url);

function receipt(overrides = {}) {
  return {
    contract: 'atom.night-watch-authority-receipt',
    version: 1,
    receiptId: 'ATOM-NIGHT-WATCH-20260829-01',
    agent: '🧊',
    testDomain: 'test',
    syntheticCleanup: { allowed: true, scope: 'unique-subtree' },
    restart: { allowed: true, deadlineSeconds: 60 },
    githubPublication: { allowed: false },
    expiresAt: '2026-08-30T00:00:00.000Z',
    unattended: false,
    ...overrides
  };
}

async function loadValidator() {
  return import(authorityModuleUrl);
}

test('night-watch authority receipt authorizes only its exact Agent and bounded test scope', async () => {
  const { validateNightWatchAuthorityReceipt } = await loadValidator();

  const validated = validateNightWatchAuthorityReceipt(receipt(), {
    agent: '🧊',
    now: '2026-08-29T00:00:00.000Z'
  });

  assert.equal(validated.testDomain, 'test');
  assert.equal(validated.githubPublication.allowed, false);
});

test('night-watch authority receipt rejects an Agent mismatch and an expired receipt', async () => {
  const { validateNightWatchAuthorityReceipt } = await loadValidator();

  assert.throws(
    () => validateNightWatchAuthorityReceipt(receipt(), {
      agent: 'not-🧊',
      now: '2026-08-29T00:00:00.000Z'
    }),
    (error) => error.code === 'NIGHT_WATCH_AUTHORITY_AGENT_MISMATCH'
  );
  assert.throws(
    () => validateNightWatchAuthorityReceipt(receipt({ expiresAt: '2026-08-28T00:00:00.000Z' }), {
      agent: '🧊',
      now: '2026-08-29T00:00:00.000Z'
    }),
    (error) => error.code === 'NIGHT_WATCH_AUTHORITY_EXPIRED'
  );
});

test('night-watch authority receipt rejects omitted live-action and unattended boundaries', async () => {
  const { validateNightWatchAuthorityReceipt } = await loadValidator();
  const invalid = receipt();
  delete invalid.restart;

  assert.throws(
    () => validateNightWatchAuthorityReceipt(invalid, {
      agent: '🧊',
      now: '2026-08-29T00:00:00.000Z'
    }),
    (error) => error.code === 'NIGHT_WATCH_AUTHORITY_RESTART_INVALID'
  );
  assert.throws(
    () => validateNightWatchAuthorityReceipt(receipt({ testDomain: 'business' }), {
      agent: '🧊',
      now: '2026-08-29T00:00:00.000Z'
    }),
    (error) => error.code === 'NIGHT_WATCH_AUTHORITY_TEST_DOMAIN_INVALID'
  );
});
