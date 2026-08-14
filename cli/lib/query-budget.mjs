import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export class QueryBudgetError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'QueryBudgetError';
    this.code = code;
    this.details = details;
  }
}

export function queryBudgetFile(storeFile) {
  return path.resolve(`${storeFile}.query-budget.json`);
}

function finiteInteger(value, fallback) {
  if (value === undefined) return fallback;
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : fallback;
}

function usage(value = {}) {
  return {
    nodes: finiteInteger(value.nodes, 0),
    characters: finiteInteger(value.characters, 0)
  };
}

function sum(entries) {
  return entries.reduce((total, entry) => ({
    nodes: total.nodes + entry.nodes,
    characters: total.characters + entry.characters
  }), { nodes: 0, characters: 0 });
}

function emptyLedger() {
  return { version: 1, entries: [], pending: {} };
}

function normalizeLedger(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    version: 1,
    entries: Array.isArray(input.entries)
      ? input.entries.filter((entry) => Number.isFinite(Number(entry?.at))).map((entry) => ({
        at: Number(entry.at),
        ...usage(entry)
      }))
      : [],
    pending: input.pending && typeof input.pending === 'object' ? { ...input.pending } : {}
  };
}

async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, 'utf8');
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await fs.copyFile(temporary, file);
    await fs.unlink(temporary);
  }
}

export function createQueryBudget(options = {}) {
  if (!options.file) throw new QueryBudgetError('INVALID_BUDGET_FILE', 'Query budget file is required');
  const file = path.resolve(options.file);
  const lockFile = `${file}.lock`;
  const windowMs = finiteInteger(options.windowMs, 10_000);
  const maxNodes = finiteInteger(options.maxNodes, 100);
  const maxCharacters = finiteInteger(options.maxCharacters, 100_000);
  const pendingMs = finiteInteger(options.pendingMs, 300_000);
  const lockStaleMs = finiteInteger(options.lockStaleMs, 30_000);
  const now = typeof options.now === 'function' ? options.now : Date.now;

  async function read() {
    try {
      return normalizeLedger(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return emptyLedger();
      if (error instanceof SyntaxError) {
        throw new QueryBudgetError('QUERY_BUDGET_CORRUPT', 'Query budget ledger cannot be parsed', { file });
      }
      throw error;
    }
  }

  function prune(ledger, timestamp) {
    const cutoff = timestamp - windowMs;
    ledger.entries = ledger.entries.filter((entry) => entry.at > cutoff);
    for (const [id, pending] of Object.entries(ledger.pending)) {
      if (!pending || Number(pending.expiresAt) <= timestamp) delete ledger.pending[id];
    }
    return ledger;
  }

  async function acquireLock() {
    await fs.mkdir(path.dirname(file), { recursive: true });
    for (let attempt = 0; attempt < 240; attempt += 1) {
      try {
        const handle = await fs.open(lockFile, 'wx');
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`, 'utf8');
        return async () => {
          await handle.close().catch(() => {});
          await fs.unlink(lockFile).catch(() => {});
        };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const stat = await fs.stat(lockFile);
          if (Date.now() - stat.mtimeMs > lockStaleMs) {
            await fs.unlink(lockFile).catch(() => {});
            continue;
          }
        } catch (statError) {
          if (statError.code !== 'ENOENT') throw statError;
        }
        await delay(4 + (attempt % 7));
      }
    }
    throw new QueryBudgetError('QUERY_BUDGET_LOCK_TIMEOUT', 'Query budget ledger is busy', { file });
  }

  async function locked(handler) {
    const release = await acquireLock();
    try {
      return await handler();
    } finally {
      await release();
    }
  }

  function totals(windowUsage, nextUsage) {
    return {
      window: windowUsage,
      next: nextUsage,
      projected: {
        nodes: windowUsage.nodes + nextUsage.nodes,
        characters: windowUsage.characters + nextUsage.characters
      },
      limits: { windowMs, nodes: maxNodes, characters: maxCharacters }
    };
  }

  async function gate(request = {}) {
    const nextUsage = usage(request);
    return locked(async () => {
      const timestamp = Number(now());
      const ledger = prune(await read(), timestamp);
      const windowUsage = sum(ledger.entries);
      const report = totals(windowUsage, nextUsage);
      const allowed = report.projected.nodes <= maxNodes && report.projected.characters <= maxCharacters;
      if (allowed) {
        ledger.entries.push({ at: timestamp, ...nextUsage });
        await atomicWrite(file, ledger);
        return { allowed: true, ...report };
      }
      const confirmationId = crypto.randomUUID();
      ledger.pending[confirmationId] = {
        createdAt: timestamp,
        expiresAt: timestamp + pendingMs,
        request: JSON.parse(JSON.stringify(request.request ?? null)),
        estimate: nextUsage
      };
      await atomicWrite(file, ledger);
      return { allowed: false, confirmationId, ...report };
    });
  }

  async function takePending(id, decision) {
    const normalized = String(decision || '').trim().toLocaleLowerCase('en-US');
    if (!['y', 'n'].includes(normalized)) {
      throw new QueryBudgetError(
        'INVALID_CONFIRMATION_DECISION',
        'Confirmation decision must be y or n',
        { decision }
      );
    }
    return locked(async () => {
      const ledger = prune(await read(), Number(now()));
      const pending = ledger.pending[id];
      if (!pending) {
        await atomicWrite(file, ledger);
        throw new QueryBudgetError('CONFIRMATION_NOT_FOUND', 'Confirmation is missing, expired, or already used', { id });
      }
      delete ledger.pending[id];
      await atomicWrite(file, ledger);
      return {
        confirmed: normalized === 'y',
        request: pending.request,
        estimate: usage(pending.estimate)
      };
    });
  }

  async function commitConfirmed(value) {
    const confirmedUsage = usage(value);
    return locked(async () => {
      const timestamp = Number(now());
      const ledger = prune(await read(), timestamp);
      ledger.entries.push({ at: timestamp, ...confirmedUsage });
      const windowUsage = sum(ledger.entries);
      await atomicWrite(file, ledger);
      return { committed: confirmedUsage, window: windowUsage };
    });
  }

  return Object.freeze({
    file,
    limits: Object.freeze({ windowMs, nodes: maxNodes, characters: maxCharacters }),
    gate,
    takePending,
    commitConfirmed
  });
}
