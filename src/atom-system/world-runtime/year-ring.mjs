import crypto from 'node:crypto';

const GRAPH_AXES = Object.freeze(['contain', 'situation', 'thing', 'support']);
const GRAPH_AXIS_SET = new Set(GRAPH_AXES);

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function requireText(value, code, label) {
  if (typeof value !== 'string' || !value.trim()) throw problem(code, `${label} must be a non-empty string`);
  return value.trim();
}

function baseKey(key) {
  return String(key).split('@', 1)[0].split('#', 1)[0];
}

function fieldEntry(atom, axis) {
  return Object.entries(atom ?? {}).find(([key]) => baseKey(key) === axis) ?? null;
}

function atomName(atom) {
  return fieldEntry(atom, 'thing')?.[1];
}

function immediateChildren(atom) {
  const value = fieldEntry(atom, 'contain')?.[1];
  return Array.isArray(value) ? value : [];
}

function axisValue(atom, axis) {
  const entry = fieldEntry(atom, axis);
  if (!entry) return undefined;
  if (axis === 'contain') {
    return immediateChildren(atom).map((child) => fieldEntry(child, 'thing'));
  }
  return entry;
}

function flattenFacts(facts) {
  const rows = new Map();
  const visit = (atoms, parentPath = '') => {
    for (const atom of Array.isArray(atoms) ? atoms : []) {
      const name = atomName(atom);
      if (typeof name !== 'string' || !name) continue;
      const path = parentPath ? `${parentPath}/${name}` : name;
      rows.set(path, atom);
      visit(immediateChildren(atom), path);
    }
  };
  visit(facts);
  return rows;
}

export function normalizeAffectedAtoms(input) {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw problem('INVALID_AFFECTED_ATOMS', 'affectedAtoms must be an array');
  const merged = new Map();
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw problem('INVALID_AFFECTED_ATOM', 'Each affected Atom must be an object');
    }
    const path = typeof item.path === 'string' && item.path.trim() ? item.path.trim() : null;
    const ref = typeof item.ref === 'string' && item.ref.trim() ? item.ref.trim() : null;
    if (!path && !ref) throw problem('INVALID_AFFECTED_ATOM', 'Each affected Atom requires path or ref');
    if (!Array.isArray(item.axes) || item.axes.some((axis) => !GRAPH_AXIS_SET.has(axis))) {
      throw problem('INVALID_AFFECTED_AXES', 'affected Atom axes must use Graph axes');
    }
    const key = `${path ?? ''}\0${ref ?? ''}`;
    const existing = merged.get(key) ?? { ...(path ? { path } : {}), ...(ref ? { ref } : {}), axes: [] };
    existing.axes = [...new Set([...existing.axes, ...item.axes])].sort();
    merged.set(key, existing);
  }
  return [...merged.values()].sort((left, right) => (
    (left.path ?? left.ref).localeCompare(right.path ?? right.ref)
  ));
}

export function affectedAtomsBetween(beforeFacts, afterFacts) {
  const before = flattenFacts(beforeFacts);
  const after = flattenFacts(afterFacts);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const affected = [];
  for (const path of paths) {
    const previous = before.get(path);
    const next = after.get(path);
    const axes = GRAPH_AXES.filter((axis) => (
      JSON.stringify(axisValue(previous, axis)) !== JSON.stringify(axisValue(next, axis))
    ));
    if (axes.length) affected.push({ path, axes });
  }
  return normalizeAffectedAtoms(affected);
}

function sanitizeFailure(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const failure = {};
  if (typeof value.code === 'string' && value.code.trim()) failure.code = value.code.trim();
  if (typeof value.message === 'string' && value.message.trim()) failure.message = value.message.trim();
  return Object.keys(failure).length ? failure : undefined;
}

function diagnosticTime(value, now) {
  const recordedAt = value ?? new Date(now()).toISOString();
  if (typeof recordedAt !== 'string' || !Number.isFinite(Date.parse(recordedAt))) {
    throw problem('INVALID_DIAGNOSTIC_TIME', 'recordedAt must be an ISO timestamp');
  }
  return new Date(recordedAt).toISOString();
}

function sanitizeDiagnostic(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw problem('INVALID_RUNTIME_DIAGNOSTIC', 'Runtime diagnostic must be an object');
  }
  const id = requireText(input.id, 'INVALID_DIAGNOSTIC_ID', 'diagnostic id');
  if (!['read', 'program', 'transform'].includes(input.type)) {
    throw problem('INVALID_DIAGNOSTIC_TYPE', 'diagnostic type must be read, program or transform');
  }
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
    throw problem('INVALID_DIAGNOSTIC_DURATION', 'durationMs must be a non-negative number');
  }
  if (!['success', 'failure', 'timeout'].includes(input.outcome)) {
    throw problem('INVALID_DIAGNOSTIC_OUTCOME', 'outcome must be success, failure, or timeout');
  }
  if (input.type === 'transform') {
    if (input.command !== 'transform' || input.outcome !== 'failure') {
      throw problem('INVALID_TRANSFORM_DIAGNOSTIC', 'Transform diagnostic must record one failed transform');
    }
    const errorCode = requireText(input.errorCode, 'INVALID_TRANSFORM_DIAGNOSTIC', 'transform error code');
    const output = {
      id,
      type: 'transform',
      recordedAt: diagnosticTime(input.recordedAt, now),
      durationMs: Math.round(input.durationMs * 1000) / 1000,
      outcome: 'failure',
      command: 'transform',
      errorCode
    };
    if (typeof input.programFingerprint === 'string' && input.programFingerprint.trim()) {
      output.programFingerprint = input.programFingerprint.trim();
    }
    return Object.freeze(output);
  }
  const output = {
    id,
    type: input.type,
    recordedAt: diagnosticTime(input.recordedAt, now),
    durationMs: Math.round(input.durationMs * 1000) / 1000,
    outcome: input.outcome,
    affectedAtoms: normalizeAffectedAtoms(input.affectedAtoms ?? [])
  };
  if (input.type === 'program') {
    if (!input.program || typeof input.program !== 'object' || Array.isArray(input.program)) {
      throw problem('INVALID_PROGRAM_DIAGNOSTIC', 'Program diagnostic requires program identity');
    }
    output.program = {
      path: requireText(input.program.path, 'INVALID_PROGRAM_PATH', 'program path'),
      ref: requireText(input.program.ref, 'INVALID_PROGRAM_REF', 'program ref'),
      fingerprint: requireText(
        input.program.fingerprint, 'INVALID_PROGRAM_FINGERPRINT', 'program fingerprint'
      )
    };
  }
  const failure = sanitizeFailure(input.failure);
  if (failure) output.failure = failure;
  return Object.freeze(output);
}

export function createRuntimeDiagnosticStore({
  repository = null,
  retentionMs = 7 * 24 * 60 * 60 * 1000,
  maxEntries = 1_000,
  now = () => Date.now()
} = {}) {
  if (!Number.isFinite(retentionMs) || retentionMs < 1) {
    throw problem('INVALID_DIAGNOSTIC_RETENTION', 'retentionMs must be positive');
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw problem('INVALID_DIAGNOSTIC_CAPACITY', 'maxEntries must be a positive integer');
  }
  if (repository && (typeof repository.read !== 'function' || typeof repository.write !== 'function')) {
    throw problem('INVALID_DIAGNOSTIC_REPOSITORY', 'diagnostic repository requires read and write');
  }
  let loaded = false;
  let entries = [];
  let tail = Promise.resolve();

  async function load() {
    if (loaded) return;
    const state = repository ? await repository.read() : { version: 1, diagnostics: [] };
    if (state?.version !== 1 || !Array.isArray(state.diagnostics)) {
      throw problem('INVALID_DIAGNOSTIC_REPOSITORY', 'diagnostic repository has invalid state');
    }
    entries = state.diagnostics.map((item) => sanitizeDiagnostic(item, now));
    loaded = true;
  }

  function pruned() {
    const cutoff = now() - retentionMs;
    return entries
      .filter((item) => Date.parse(item.recordedAt) >= cutoff)
      .sort((left, right) => (
        left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id)
      ))
      .slice(-maxEntries);
  }

  async function persist() {
    if (repository) await repository.write({ version: 1, diagnostics: entries });
  }

  function serialize(operation) {
    const running = tail.then(operation, operation);
    tail = running.catch(() => {});
    return running;
  }

  function record(input) {
    return serialize(async () => {
      await load();
      const item = sanitizeDiagnostic(input, now);
      entries = [...entries.filter((entry) => entry.id !== item.id), item];
      entries = pruned();
      await persist();
      return structuredClone(item);
    });
  }

  function list() {
    return serialize(async () => {
      await load();
      const next = pruned();
      const changed = JSON.stringify(next) !== JSON.stringify(entries);
      entries = next;
      if (changed) await persist();
      return structuredClone(entries);
    });
  }

  function findByInteractionId(interactionId) {
    return serialize(async () => {
      await load();
      const id = requireText(interactionId, 'INVALID_INTERACTION_ID', 'interaction id');
      return structuredClone(entries.find((entry) => entry.id === `${id}:transform`) ?? null);
    });
  }

  return Object.freeze({ record, list, findByInteractionId });
}

function appendEvent(byAtom, affected, event) {
  for (const atom of affected) {
    for (const key of [atom.path ? `path:${atom.path}` : null, atom.ref ? `ref:${atom.ref}` : null]) {
      if (!key) continue;
      const events = byAtom[key] ?? [];
      const existing = events.find((candidate) => (
        candidate.kind === event.kind && candidate.id === event.id
      ));
      if (existing) {
        existing.atom = {
          ...(existing.atom.path || atom.path ? { path: existing.atom.path ?? atom.path } : {}),
          ...(existing.atom.ref || atom.ref ? { ref: existing.atom.ref ?? atom.ref } : {}),
          axes: [...new Set([...existing.atom.axes, ...atom.axes])].sort()
        };
      } else {
        events.push({ ...event, atom: structuredClone(atom) });
      }
      byAtom[key] = events;
    }
  }
}

export function rebuildYearRingIndex({ journal, diagnostics = [] }) {
  if (!journal || !Array.isArray(journal.receipts)) {
    throw problem('INVALID_TRANSACTION_JOURNAL', 'year-ring rebuild requires journal receipts');
  }
  if (!Array.isArray(diagnostics)) {
    throw problem('INVALID_RUNTIME_DIAGNOSTICS', 'year-ring diagnostics must be an array');
  }
  const byAtom = {};
  for (const entry of journal.receipts) {
    const receipt = entry?.receipt ?? entry;
    const affected = normalizeAffectedAtoms(receipt?.affectedAtoms ?? []);
    appendEvent(byAtom, affected, {
      kind: 'receipt',
      id: receipt.commandId,
      at: receipt.committedAt ?? '',
      correlationId: receipt.correlationId,
      beforeRevision: receipt.beforeRevision,
      afterRevision: receipt.afterRevision,
      outcome: receipt.status,
      source: receipt.source,
      ...(receipt.rollbackOf ? { rollbackOf: receipt.rollbackOf } : {})
    });
  }
  for (const raw of diagnostics) {
    const diagnostic = sanitizeDiagnostic(raw, () => Date.now());
    appendEvent(byAtom, diagnostic.affectedAtoms, {
      kind: 'diagnostic',
      id: diagnostic.id,
      at: diagnostic.recordedAt,
      type: diagnostic.type,
      durationMs: diagnostic.durationMs,
      outcome: diagnostic.outcome,
      ...(diagnostic.program ? { program: diagnostic.program } : {}),
      ...(diagnostic.failure ? { failure: diagnostic.failure } : {})
    });
  }
  for (const events of Object.values(byAtom)) {
    events.sort((left, right) => (
      left.at.localeCompare(right.at)
        || left.id.localeCompare(right.id)
        || left.kind.localeCompare(right.kind)
    ));
  }
  return Object.freeze({ version: 1, rebuiltAt: null, byAtom });
}

export function queryYearRing(index, selector) {
  requireText(selector, 'INVALID_YEAR_RING_SELECTOR', 'year-ring selector');
  if (index?.version !== 1 || !index.byAtom || typeof index.byAtom !== 'object') {
    throw problem('INVALID_YEAR_RING_INDEX', 'year-ring index has invalid shape');
  }
  return structuredClone([
    ...(index.byAtom[`path:${selector}`] ?? []),
    ...(index.byAtom[`ref:${selector}`] ?? [])
  ]).sort((left, right) => (
    left.at.localeCompare(right.at)
      || left.id.localeCompare(right.id)
      || left.kind.localeCompare(right.kind)
  ));
}

export function programDiagnosticIdentity(program) {
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    path: program.path,
    detail: program.detail,
    types: program.types
  })).digest('hex');
  return Object.freeze({
    path: program.path,
    ref: program.ref,
    fingerprint: `sha256:${fingerprint}`
  });
}
