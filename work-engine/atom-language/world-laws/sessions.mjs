import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function sessionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function tokenFile(sessionsDirectory, token) {
  const digest = crypto.createHash('sha256').update(token).digest('hex');
  return path.join(sessionsDirectory, `${digest}.json`);
}

function canonicalRecord(record) {
  const { signature: _signature, ...unsigned } = record;
  return JSON.stringify(unsigned);
}

function signRecord(record, signingKey) {
  if (typeof signingKey !== 'string' || signingKey.length < 32) {
    throw sessionError('SESSION_SIGNING_KEY_REQUIRED', '维护入口缺少有效的会话签名密钥');
  }
  return crypto.createHmac('sha256', signingKey).update(canonicalRecord(record)).digest('base64url');
}

function validateRecord(record) {
  if (!record || record.version !== 1 || typeof record.id !== 'string'
    || !Array.isArray(record.windows) || !Array.isArray(record.keys)
    || typeof record.revoked !== 'boolean' || typeof record.issuedAt !== 'string'
    || typeof record.expiresAt !== 'string' || !Number.isFinite(Date.parse(record.expiresAt))
    || typeof record.signature !== 'string') {
    throw sessionError('INVALID_AGENT_SESSION', 'Agent session 无效；请联系派发方');
  }
}

function normalizeWindows(windows) {
  const normalized = [...new Set((windows ?? []).map((value) => value?.trim()).filter(Boolean))];
  if (!normalized.length) throw sessionError('SESSION_WINDOWS_REQUIRED', '会话至少需要一个 Agent 窗口');
  return normalized;
}

export async function issueAgentSession(options) {
  const token = crypto.randomBytes(32).toString('base64url');
  const record = {
    version: 1,
    id: crypto.randomUUID(),
    windows: normalizeWindows(options.windows),
    keys: structuredClone(options.keys ?? []),
    expiresAt: options.expiresAt ?? new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    revoked: false,
    issuedAt: new Date().toISOString()
  };
  if (!Number.isFinite(Date.parse(record.expiresAt))) {
    throw sessionError('INVALID_SESSION_EXPIRY', '会话到期时间无效');
  }
  record.signature = signRecord(record, options.signingKey);
  await fs.mkdir(options.sessionsDirectory, { recursive: true });
  await fs.writeFile(
    tokenFile(options.sessionsDirectory, token),
    `${JSON.stringify(record, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' }
  );
  return { token, session: record };
}

export async function loadAgentSession(options) {
  if (typeof options.token !== 'string' || !options.token) {
    throw sessionError('AGENT_SESSION_REQUIRED', '日常 Atom CLI 需要派发的 session');
  }
  let record;
  try {
    record = JSON.parse(await fs.readFile(
      tokenFile(options.sessionsDirectory, options.token),
      'utf8'
    ));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      throw sessionError('INVALID_AGENT_SESSION', 'Agent session 无效；请联系派发方');
    }
    throw error;
  }
  validateRecord(record);
  const expected = signRecord(record, options.signingKey);
  const actual = Buffer.from(record.signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !crypto.timingSafeEqual(actual, wanted)) {
    throw sessionError('INVALID_AGENT_SESSION', 'Agent session 无效；请联系派发方');
  }
  if (record.revoked || Date.parse(record.expiresAt) <= Date.now()) {
    throw sessionError('EXPIRED_AGENT_SESSION', 'Agent session 已失效；请联系派发方');
  }
  record.windows = normalizeWindows(record.windows);
  return record;
}

export function assertGrantedWindow(session, window) {
  if (typeof window !== 'string' || !window.trim()) {
    throw sessionError('AGENT_WINDOW_REQUIRED', '日常 Atom CLI 需要明确 Agent 窗口');
  }
  if (!session.windows.includes(window)) {
    throw sessionError('WINDOW_NOT_GRANTED', '该窗口未由派发方授予；请反馈派发方');
  }
  return window;
}
