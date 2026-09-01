const LOCK_FIELDS = new Set(['thing', 'situation', 'slot', 'strut', 'messages']);
const TYPE_PREDICATE_KEYS = new Set(['all', 'any', 'none']);

export function normalizeTypePredicate(value, {
  code = 'INVALID_PROGRAM_LOCK_TYPE_CONDITION',
  label = 'type condition'
} = {}) {
  const keys = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
    : [];
  if (keys.length === 0 || keys.some((key) => !TYPE_PREDICATE_KEYS.has(key))) {
    throw Object.assign(new Error(`${label} requires one or more of all, any, none`), { code });
  }
  const normalized = {};
  for (const key of keys) {
    const types = value[key];
    if (!Array.isArray(types) || types.length === 0
      || types.some((type) => typeof type !== 'string' || !type.trim())
      || new Set(types.map((type) => type.trim())).size !== types.length) {
      throw Object.assign(new Error(`${label}.${key} must slot unique non-empty Graph types`), { code });
    }
    normalized[key] = types.map((type) => type.trim());
  }
  const positive = new Set([...(normalized.all ?? []), ...(normalized.any ?? [])]);
  if ((normalized.none ?? []).some((type) => positive.has(type))) {
    throw Object.assign(new Error(`${label} cannot both require and exclude one Graph type`), { code });
  }
  return normalized;
}

export function matchesTypePredicate(types, predicate) {
  if (!predicate) return true;
  const available = new Set(Array.isArray(types) ? types : []);
  if (predicate.all?.some((type) => !available.has(type))) return false;
  if (predicate.any && !predicate.any.some((type) => available.has(type))) return false;
  if (predicate.none?.some((type) => available.has(type))) return false;
  return true;
}

export function buildProgramLockIndex({ revision, results = [], records = [] }) {
  const byPath = new Map();
  if (results.length === 0) return Object.freeze({ revision, byPath });
  const neededRefs = new Set(results.flatMap((result) => (
    Array.isArray(result.targets?.paths) ? [] : (result.targets?.refs ?? [])
  )));
  const known = new Map();
  if (neededRefs.size > 0) {
    for (const record of records) {
      if (!neededRefs.has(record.ref)) continue;
      known.set(record.ref, record);
      neededRefs.delete(record.ref);
      if (neededRefs.size === 0) break;
    }
  }
  for (const result of results) {
    const targetPaths = Array.isArray(result.targets?.paths)
      ? result.targets.paths
      : (result.targets?.refs ?? []).map((ref) => {
        const record = known.get(ref);
        if (!record) throw Object.assign(new Error('Program lock ref does not belong to this revision'), { code: 'INVALID_PROGRAM_LOCK_TARGET' });
        return record.path;
      });
    for (const targetPath of targetPaths) {
      const entry = byPath.get(targetPath) ?? { read: new Set(), write: new Set(), sources: [] };
      const sourceRead = new Set();
      const sourceWrite = new Set();
      for (const field of result.fields) {
        if (!LOCK_FIELDS.has(field)) throw Object.assign(new Error(`Unsupported lock field: ${field}`), { code: 'INVALID_PROGRAM_LOCK_FIELDS' });
        if (field === 'messages' && !result.protect.messages) continue;
        if (field !== 'messages' && !result.protect.atom) continue;
        entry.write.add(field);
        sourceWrite.add(field);
        if (result.mode === 'read_write') {
          entry.read.add(field);
          sourceRead.add(field);
        }
      }
      entry.sources.push({
        sourceProgramRef: result.sourceProgramRef,
        sourceProgramPath: result.sourceProgramPath,
        protect: result.protect,
        readFields: sourceRead,
        writeFields: sourceWrite,
        allowedWindows: result.allowed_windows?.paths ? [...result.allowed_windows.paths] : null,
        allowedWindowTypes: result.allowed_windows?.types
          ? structuredClone(result.allowed_windows.types)
          : null,
        allowedWindowRelation: result.allowed_windows?.relation ?? null,
        allowedPrograms: result.allowed_programs?.paths ? [...result.allowed_programs.paths] : null,
        targetScope: result.targets?.scope ?? 'exact',
        when: result.when ? structuredClone(result.when) : null,
        reason: result.reason && typeof result.reason === 'object'
          ? structuredClone(result.reason)
          : null
      });
      byPath.set(targetPath, entry);
    }
  }
  return Object.freeze({ revision, byPath });
}

export function mergeProgramLockIndexes({
  revision,
  previous,
  next,
  replacedSources = new Set()
}) {
  const byPath = new Map();
  const addSource = (path, source) => {
    const entry = byPath.get(path) ?? { read: new Set(), write: new Set(), sources: [] };
    const cloned = {
      ...source,
      readFields: new Set(source.readFields),
      writeFields: new Set(source.writeFields),
      allowedWindows: source.allowedWindows ? [...source.allowedWindows] : null,
      allowedWindowTypes: source.allowedWindowTypes
        ? structuredClone(source.allowedWindowTypes)
        : null,
      allowedWindowRelation: source.allowedWindowRelation ?? null,
      allowedPrograms: source.allowedPrograms ? [...source.allowedPrograms] : null,
      targetScope: source.targetScope ?? 'exact',
      when: source.when ? structuredClone(source.when) : null,
      reason: source.reason && typeof source.reason === 'object'
        ? structuredClone(source.reason)
        : null
    };
    for (const field of cloned.readFields) entry.read.add(field);
    for (const field of cloned.writeFields) entry.write.add(field);
    entry.sources.push(cloned);
    byPath.set(path, entry);
  };

  for (const [path, entry] of previous?.byPath?.entries?.() ?? []) {
    for (const source of entry.sources) {
      if (!replacedSources.has(source.sourceProgramPath)) addSource(path, source);
    }
  }
  for (const [path, entry] of next?.byPath?.entries?.() ?? []) {
    for (const source of entry.sources) addSource(path, source);
  }

  return Object.freeze({ revision, byPath });
}

export function programLockDeniedDiagnostic(decision, field = null) {
  const reasons = (decision?.matched ?? [])
    .map((source) => source.reason)
    .filter((reason) => typeof reason?.message === 'string' && reason.message.trim());
  const reason = reasons[0]?.message?.trim();
  const message = [
    `当前${field ? ` ${field} 字段` : '内容'}已被锁定，修改未生效。`,
    ...(reason ? [`原因：${reason}。`] : []),
    '下一步：停止修改并联系人工处理解冻；若疑似异常或存在使用痛点，可用 submit 提交。'
  ].join('');
  return {
    code: 'PROGRAM_LOCK_DENIED',
    message,
    details: {
      ...(field ? { field } : {}),
      ...(decision?.agentPath ? { agentPath: decision.agentPath } : {}),
      locks: (decision?.matched ?? []).map((source) => ({
        sourceProgramPath: source.sourceProgramPath,
        allowedWindows: source.allowedWindows ?? null,
        allowedWindowTypes: source.allowedWindowTypes ?? null,
        allowedWindowRelation: source.allowedWindowRelation ?? null,
        allowedPrograms: source.allowedPrograms ?? null,
        when: source.when ?? null,
        reason: source.reason ?? null
      }))
    }
  };
}

export function authorizeProgramLock({
  lockIndex,
  targetPath,
  operation,
  field,
  agentPath = null,
  agentTypes = [],
  agentIdentity = false,
  programPath = null,
  targetTypes = [],
  action = operation === 'read' ? 'explore' : 'transform'
}) {
  const entries = [];
  const segments = targetPath.split('/');
  for (let length = segments.length; length > 0; length -= 1) {
    const lockedPath = segments.slice(0, length).join('/');
    const entry = lockIndex?.byPath?.get(lockedPath);
    if (entry) entries.push({ entry, exact: lockedPath === targetPath });
  }
  if (!entries.length) return { decision: 'allow' };
  const fieldKey = operation === 'read' ? 'readFields' : 'writeFields';
  const matched = entries.flatMap(({ entry, exact }) => entry.sources.filter((source) => {
    if (!exact && source.targetScope !== 'subtree') return false;
    if (source.when?.actions && !source.when.actions.includes(action)) return false;
    if (source.when?.target_types
      && !matchesTypePredicate(targetTypes, source.when.target_types)) return false;
    if (source.allowedPrograms?.includes(programPath)) return false;
    if (agentIdentity && source.allowedWindows?.includes(agentPath)) return false;
    if (agentIdentity && source.allowedWindowTypes
      && matchesTypePredicate(agentTypes, source.allowedWindowTypes)) return false;
    if (agentIdentity && source.allowedWindowRelation === 'target_within_window_parent' && agentPath) {
      const parentPath = agentPath.split('/').slice(0, -1).join('/');
      const withinParent = parentPath
        && (targetPath === parentPath || targetPath.startsWith(`${parentPath}/`));
      const selfStructuralWrite = operation === 'write'
        && targetPath === agentPath && ['thing', 'slot'].includes(field);
      if (withinParent && !selfStructuralWrite) return false;
    }
    const fields = source[fieldKey];
    return field ? fields.has(field) : fields.size > 0;
  }));
  if (!matched.length) return { decision: 'allow' };
  return { decision: operation === 'read' ? 'truncate' : 'deny', matched, agentPath };
}

export function programLockState(lockIndex, targetPath = null) {
  const entries = [...(lockIndex?.byPath?.entries?.() ?? [])]
    .filter(([path]) => targetPath === null || path === targetPath)
    .map(([path, entry]) => ({
      path,
      readFields: [...entry.read].sort(),
      writeFields: [...entry.write].sort(),
      reasons: entry.sources
        .map((source) => source.reason)
        .filter((reason) => reason && typeof reason === 'object'),
      sources: entry.sources.map((source) => source.sourceProgramPath).filter(Boolean)
    }));
  return targetPath === null ? entries : (entries[0] ?? null);
}
