import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validateRequestDrivenLockSnapshot } from '../public/request-driven-lock-contract.mjs';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

export function createJsonRequestDrivenLockRepository({ file }) {
  if (typeof file !== 'string' || !file.trim()) {
    throw problem('INVALID_REQUEST_DRIVEN_LOCK_PATH', 'Request-driven lock repository requires one file path');
  }
  const snapshotFile = path.resolve(file);
  return Object.freeze({
    file: snapshotFile,
    async load() {
      try {
        return validateRequestDrivenLockSnapshot(JSON.parse(await fs.readFile(snapshotFile, 'utf8')));
      } catch (error) {
        if (error.code === 'ENOENT') return { version: 1, locks: [] };
        throw error;
      }
    },
    async save(snapshot) {
      const value = validateRequestDrivenLockSnapshot(snapshot);
      await fs.mkdir(path.dirname(snapshotFile), { recursive: true });
      const temporary = `${snapshotFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, 'wx');
        try {
          await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        try {
          await fs.rename(temporary, snapshotFile);
        } catch (error) {
          if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
          await fs.copyFile(temporary, snapshotFile);
          await fs.unlink(temporary);
        }
        return structuredClone(value);
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
    }
  });
}
