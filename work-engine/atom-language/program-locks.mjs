const LOCK_FIELDS = new Set(['name', 'detail', 'children', 'partners', 'messages']);

export function buildProgramLockIndex({ revision, results = [], records = [] }) {
  const known = new Map(records.map((record) => [record.ref, record]));
  const byPath = new Map();
  for (const result of results) {
    for (const ref of result.targets.refs) {
      const record = known.get(ref);
      if (!record) throw Object.assign(new Error('Program lock ref does not belong to this revision'), { code: 'INVALID_PROGRAM_LOCK_TARGET' });
      const entry = byPath.get(record.path) ?? { read: new Set(), write: new Set(), sources: [] };
      for (const field of result.fields) {
        if (!LOCK_FIELDS.has(field)) throw Object.assign(new Error(`Unsupported lock field: ${field}`), { code: 'INVALID_PROGRAM_LOCK_FIELDS' });
        if (field === 'messages' && !result.protect.messages) continue;
        if (field !== 'messages' && !result.protect.atom) continue;
        entry.write.add(field);
        if (result.mode === 'read_write') entry.read.add(field);
      }
      entry.sources.push({
        sourceProgramRef: result.sourceProgramRef,
        sourceProgramPath: result.sourceProgramPath,
        protect: result.protect,
        reason: result.reason && typeof result.reason === 'object'
          ? structuredClone(result.reason)
          : null
      });
      byPath.set(record.path, entry);
    }
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
      locks: (decision?.matched ?? []).map((source) => ({
        sourceProgramPath: source.sourceProgramPath,
        reason: source.reason ?? null
      }))
    }
  };
}

export function authorizeProgramLock({ lockIndex, targetPath, operation, field }) {
  const entry = lockIndex?.byPath?.get(targetPath);
  if (!entry) return { decision: 'allow' };
  const fields = operation === 'read' ? entry.read : entry.write;
  if (field && !fields.has(field)) return { decision: 'allow' };
  if (!field && fields.size === 0) return { decision: 'allow' };
  return { decision: operation === 'read' ? 'truncate' : 'deny', matched: entry.sources };
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
