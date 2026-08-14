import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const RUNTIME_FILES = Object.freeze(['atom.json', 'graph.json', 'knowledge.json']);

function defaultLocalAppData() {
  return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
}

export function resolveAtomRuntime(options = {}) {
  const root = path.resolve(options.root ?? path.join(
    options.localAppData ?? defaultLocalAppData(),
    'AtomGraph'
  ));
  const worldDirectory = path.join(root, 'worlds', 'primary');
  return Object.freeze({
    root,
    worldDirectory,
    contextFile: path.join(worldDirectory, 'atom.json'),
    graphFile: path.join(worldDirectory, 'graph.json'),
    storeFile: path.join(worldDirectory, 'knowledge.json'),
    sessionsDirectory: path.join(worldDirectory, 'sessions'),
    adminKeyFile: path.join(root, 'admin-session.key'),
    configFile: path.join(root, 'config.json')
  });
}

export async function ensureRuntimeSigningKey(runtime) {
  await fs.mkdir(runtime.root, { recursive: true });
  try {
    return (await fs.readFile(runtime.adminKeyFile, 'utf8')).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const key = crypto.randomBytes(48).toString('base64url');
  try {
    await fs.writeFile(runtime.adminKeyFile, `${key}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return key;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return (await fs.readFile(runtime.adminKeyFile, 'utf8')).trim();
  }
}

export async function assertMaintenanceToken(runtime, token) {
  const expected = (await fs.readFile(runtime.adminKeyFile, 'utf8')).trim();
  const actualBuffer = Buffer.from(token ?? '');
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    const error = new Error('维护入口需要由人工或开发 Agent 显式提供维护令牌');
    error.code = 'ATOM_MAINTENANCE_TOKEN_REQUIRED';
    throw error;
  }
  return expected;
}

async function digest(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function copyVerified(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    const existing = await digest(target);
    const incoming = await digest(source);
    if (existing !== incoming) {
      const error = new Error(`目标已存在不同数据：${target}`);
      error.code = 'ATOM_RUNTIME_TARGET_CONFLICT';
      throw error;
    }
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  if (await digest(source) !== await digest(target)) {
    const error = new Error(`迁移校验失败：${target}`);
    error.code = 'ATOM_RUNTIME_COPY_MISMATCH';
    throw error;
  }
}

async function writeNewJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await fs.writeFile(file, text, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const current = JSON.parse(await fs.readFile(file, 'utf8'));
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      const conflict = new Error(`运行配置已存在且不一致：${file}`);
      conflict.code = 'ATOM_RUNTIME_CONFIG_CONFLICT';
      throw conflict;
    }
  }
}

export async function migrateAtomRuntimeData(options) {
  const runtime = resolveAtomRuntime(options);
  const sourceDirectory = path.resolve(options.sourceDirectory);
  const timestamp = options.timestamp ?? new Date().toISOString().replace(/[-:TZ.]/gu, '').slice(0, 14);
  const backupDirectory = path.join(path.dirname(sourceDirectory), 'archive', timestamp);
  for (const name of RUNTIME_FILES) {
    const source = path.join(sourceDirectory, name);
    await copyVerified(source, path.join(backupDirectory, name));
    await copyVerified(source, path.join(runtime.worldDirectory, name));
  }
  await fs.mkdir(runtime.sessionsDirectory, { recursive: true });
  await ensureRuntimeSigningKey(runtime);
  await writeNewJson(runtime.configFile, {
    schemaVersion: 1,
    world: 'primary',
    contextFile: runtime.contextFile,
    graphFile: runtime.graphFile,
    storeFile: runtime.storeFile,
    sessionsDirectory: runtime.sessionsDirectory
  });
  return { runtime, backupDirectory };
}
