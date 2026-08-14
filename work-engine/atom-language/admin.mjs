import { parseAtomKey } from './key-parser.mjs';
import { readAtomContext } from './context-store.mjs';
import { issueAgentSession } from './world-laws/sessions.mjs';

function adminError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function field(atom, baseKey) {
  for (const [rawKey, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (parsed.baseKey === baseKey) return { parsed, value };
  }
  return null;
}

function windowsIn(atoms, parent = []) {
  const result = [];
  for (const atom of atoms) {
    const nameField = field(atom, 'name');
    if (typeof nameField?.value !== 'string') continue;
    const path = [...parent, nameField.value];
    if (nameField.parsed.types.some((type) => type.raw === 'agent')) {
      result.push({ name: nameField.value, path: path.join('/') });
    }
    const children = field(atom, 'children')?.value;
    if (Array.isArray(children)) result.push(...windowsIn(children, path));
  }
  return result;
}

export async function issueWorldAgentSession(options) {
  const atoms = await readAtomContext(options.contextFile, { create: false });
  const available = windowsIn(atoms);
  const resolved = [];
  for (const requested of options.windows ?? []) {
    const matches = available.filter((entry) => (
      requested.includes('/') ? entry.path === requested : entry.name === requested
    ));
    if (matches.length !== 1) {
      throw adminError(
        matches.length ? 'AMBIGUOUS_WINDOW_AGENT' : 'WINDOW_AGENT_NOT_FOUND',
        '只能派发当前世界中 exact 且唯一的 @agent 窗口'
      );
    }
    resolved.push(matches[0].path);
  }
  return issueAgentSession({
    sessionsDirectory: options.sessionsDirectory,
    signingKey: options.signingKey,
    windows: resolved,
    keys: options.keys ?? [],
    expiresAt: options.expiresAt
  });
}
