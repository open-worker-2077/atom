import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { materializeGraphJson, parseGraphJson } from './graph-json.mjs';

const FEEDBACK_TYPES = new Set(['bug', 'pain', 'requirement', 'optimization']);
const MAX_HISTORY_ITEMS = 50;
const MAX_HISTORY_BYTES = 256 * 1024;

function feedbackError(code, message) {
  return Object.assign(new Error(message), { code });
}

function parseFeedbackSource(source) {
  const match = String(source ?? '').trim().match(/^submit\s+([\s\S]+)$/u);
  if (!match) throw feedbackError('INVALID_FEEDBACK_COMMAND', 'submit 需要一个 Graph-JSON 对象');
  const value = materializeGraphJson(parseGraphJson(match[1]));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw feedbackError('INVALID_FEEDBACK_COMMAND', 'submit 根节点必须是 Graph-JSON 对象');
  }
  if (!FEEDBACK_TYPES.has(value.type)) {
    throw feedbackError('INVALID_FEEDBACK_TYPE', 'submit.type 必须是 bug、pain、requirement 或 optimization');
  }
  if (typeof value.detail !== 'string' || !value.detail.trim() || value.detail.length > 10_000) {
    throw feedbackError('INVALID_FEEDBACK_DETAIL', 'submit.detail 必须是 1 至 10000 字的说明');
  }
  return { type: value.type, detail: value.detail.trim() };
}

function boundedHistory(history) {
  const entries = Array.isArray(history) ? structuredClone(history.slice(-MAX_HISTORY_ITEMS)) : [];
  while (entries.length && Buffer.byteLength(JSON.stringify(entries), 'utf8') > MAX_HISTORY_BYTES) {
    entries.shift();
  }
  return entries;
}

export async function recordAtomFeedback(options = {}) {
  const { type, detail } = parseFeedbackSource(options.source);
  const agentPath = options.interaction?.agent?.path;
  if (typeof agentPath !== 'string' || !agentPath) {
    throw feedbackError('AGENT_REQUIRED', 'submit 需要当前已声明 Agent Program 上下文起点');
  }
  const record = {
    id: crypto.randomUUID(),
    submittedAt: (options.now?.() ?? new Date()).toISOString(),
    type,
    detail,
    agentPath,
    history: boundedHistory(options.history)
  };
  const logFile = path.join(path.dirname(options.contextFile), 'submissions.jsonl');
  await fs.appendFile(logFile, `${JSON.stringify(record)}\n`, 'utf8');
  return {
    ok: true,
    language: 'atom',
    command: 'submit',
    changed: false,
    submission: { id: record.id, type: record.type, submittedAt: record.submittedAt },
    warnings: [], errors: [], messages: []
  };
}
