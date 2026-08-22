import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function validate(value) {
  const supportedFields = new Set(['name', 'detail', 'children', 'partners', 'messages']);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== 1 || !Array.isArray(value.locks)
    || value.locks.some((lock) => !lock || typeof lock !== 'object' || Array.isArray(lock)
      || typeof lock.sourceProgramPath !== 'string' || !lock.sourceProgramPath
      || !Array.isArray(lock.targets?.paths) || lock.targets.paths.length === 0
      || lock.targets.paths.some((item) => typeof item !== 'string' || !item)
      || new Set(lock.targets.paths).size !== lock.targets.paths.length
      || !['write', 'read_write'].includes(lock.mode)
      || !Array.isArray(lock.fields) || lock.fields.length === 0
      || lock.fields.some((field) => !supportedFields.has(field))
      || !lock.protect || typeof lock.protect.atom !== 'boolean'
      || typeof lock.protect.messages !== 'boolean'
      || (lock.allowed_windows !== undefined
        && (!Array.isArray(lock.allowed_windows?.paths) || lock.allowed_windows.paths.length === 0
          || lock.allowed_windows.paths.some((item) => typeof item !== 'string' || !item.includes('/'))
          || new Set(lock.allowed_windows.paths).size !== lock.allowed_windows.paths.length))
      || lock.refresh?.policy !== 'on_request')) {
    throw problem('INVALID_REQUEST_DRIVEN_LOCK_SNAPSHOT', 'Stored request-driven lock snapshot is invalid');
  }
  return structuredClone(value);
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
        return validate(JSON.parse(await fs.readFile(snapshotFile, 'utf8')));
      } catch (error) {
        if (error.code === 'ENOENT') return { version: 1, locks: [] };
        throw error;
      }
    },
    async save(snapshot) {
      const value = validate(snapshot);
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
