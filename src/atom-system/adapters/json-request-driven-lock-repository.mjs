import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function validTypePredicate(value) {
  const keys = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
    : [];
  if (keys.length === 0 || keys.some((key) => !['all', 'any', 'none'].includes(key))) return false;
  const positive = new Set();
  for (const key of keys) {
    const types = value[key];
    if (!Array.isArray(types) || types.length === 0
      || types.some((type) => typeof type !== 'string' || !type)
      || new Set(types).size !== types.length) return false;
    if (key !== 'none') types.forEach((type) => positive.add(type));
  }
  return !(value.none ?? []).some((type) => positive.has(type));
}

function validAllowedWindows(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1 || !['paths', 'types', 'relation'].includes(keys[0])) return false;
  if (keys[0] === 'types') return validTypePredicate(value.types);
  if (keys[0] === 'relation') return value.relation === 'target_within_window_parent';
  return Array.isArray(value.paths) && value.paths.length > 0
    && value.paths.every((item) => typeof item === 'string' && item.includes('/'))
    && new Set(value.paths).size === value.paths.length;
}

function validAllowedPrograms(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && Array.isArray(value.paths) && value.paths.length > 0
    && value.paths.every((item) => typeof item === 'string' && item.length > 0)
    && new Set(value.paths).size === value.paths.length;
}

function validWhen(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !['target_types', 'actions'].includes(key))) return false;
  if (value.target_types !== undefined && !validTypePredicate(value.target_types)) return false;
  return value.actions === undefined || (
    Array.isArray(value.actions) && value.actions.length > 0
    && value.actions.every((action) => ['explore', 'transform'].includes(action))
    && new Set(value.actions).size === value.actions.length
  );
}

function validWindowRule(rule) {
  return rule && typeof rule === 'object' && !Array.isArray(rule)
    && Number.isInteger(rule.priority) && rule.priority > 0
    && typeof rule.fromPath === 'string' && rule.fromPath.length > 0
    && (rule.parent === undefined || typeof rule.parent === 'boolean')
    && (rule.peers === undefined || typeof rule.peers === 'boolean')
    && (rule.descendants === undefined || rule.descendants === 'all'
      || (Number.isInteger(rule.descendants) && rule.descendants >= 0));
}

function validWindowPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)
    || Object.keys(policy).some((key) => !['read', 'write'].includes(key))) return false;
  return Object.values(policy).every((side) => side && typeof side === 'object'
    && !Array.isArray(side)
    && Object.keys(side).every((key) => ['allow', 'deny'].includes(key))
    && Object.values(side).every((rules) => Array.isArray(rules) && rules.every(validWindowRule)));
}

function validate(value) {
  const supportedFields = new Set(['thing', 'situation', 'contain', 'support', 'messages']);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.version !== 1 || !Array.isArray(value.locks)
    || (value.windowSelfLocks !== undefined && (!Array.isArray(value.windowSelfLocks)
      || value.windowSelfLocks.some((entry) => !entry || typeof entry !== 'object'
        || typeof entry.agentPath !== 'string' || !entry.agentPath
        || !validWindowPolicy(entry.policy))))
    || value.locks.some((lock) => !lock || typeof lock !== 'object' || Array.isArray(lock)
      || typeof lock.sourceProgramPath !== 'string' || !lock.sourceProgramPath
      || !Array.isArray(lock.targets?.paths) || lock.targets.paths.length === 0
      || lock.targets.paths.some((item) => typeof item !== 'string' || !item)
      || new Set(lock.targets.paths).size !== lock.targets.paths.length
      || (lock.targets.scope !== undefined && lock.targets.scope !== 'subtree')
      || !['write', 'read_write'].includes(lock.mode)
      || !Array.isArray(lock.fields) || lock.fields.length === 0
      || lock.fields.some((field) => !supportedFields.has(field))
      || !lock.protect || typeof lock.protect.atom !== 'boolean'
      || typeof lock.protect.messages !== 'boolean'
      || (lock.allowed_windows !== undefined && !validAllowedWindows(lock.allowed_windows))
      || (lock.allowed_programs !== undefined && !validAllowedPrograms(lock.allowed_programs))
      || (lock.when !== undefined && !validWhen(lock.when))
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
