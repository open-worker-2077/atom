function runtimeError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function evaluateExpr(expr) {
  if (expr.kind === 'thing') return undefined;
  if (expr.kind === 'and') {
    let hasDecision = false;
    for (const child of expr.children) {
      const decision = evaluateExpr(child);
      if (decision === undefined) continue;
      hasDecision = true;
      if (decision === false) return false;
    }
    return hasDecision ? true : undefined;
  }
  if (expr.kind === 'or') {
    let hasDecision = false;
    for (const child of expr.children) {
      const decision = evaluateExpr(child);
      if (decision === undefined) continue;
      hasDecision = true;
      if (decision === true) return true;
    }
    return hasDecision ? false : undefined;
  }
  throw runtimeError('INVALID_SUPPORT_EXPR', `未知规范 Expr：${expr.kind}`);
}

export function evaluateSupportClauses(parsedDocument, options = {}) {
  const changed = options.changedPaths ? new Set(options.changedPaths) : null;
  const selectedIds = changed
    ? new Set([...changed].flatMap((path) => parsedDocument.dependencyIndex.get(path) ?? []))
    : null;
  const results = new Map();
  for (const clause of parsedDocument.supportClauses) {
    if (selectedIds && !selectedIds.has(clause.id)) continue;
    const trace = [];
    try {
      const decision = evaluateExpr(clause.root) ?? true;
      results.set(clause.id, { status: decision ? 'true' : 'false', decision, trace });
    } catch (error) {
      results.set(clause.id, {
        status: 'failure',
        error: { code: error.code ?? 'SUPPORT_EVALUATION_FAILED', message: error.message },
        trace
      });
    }
  }
  return results;
}

async function evaluateExprWithPrograms(expr, evaluateProgram, trace) {
  if (expr.kind === 'thing') return undefined;
  if (expr.kind === 'program') {
    trace.push(expr.targetPath);
    const result = await evaluateProgram(expr.targetPath);
    if (typeof result !== 'boolean') {
      throw runtimeError('INVALID_PROGRAM_SUPPORT_RESULT', '推支判定 Program 必须严格返回 boolean');
    }
    return result;
  }
  if (expr.kind === 'and') {
    let hasDecision = false;
    for (const child of expr.children) {
      const decision = await evaluateExprWithPrograms(child, evaluateProgram, trace);
      if (decision === undefined) continue;
      hasDecision = true;
      if (decision === false) return false;
    }
    return hasDecision ? true : undefined;
  }
  if (expr.kind === 'or') {
    let hasDecision = false;
    for (const child of expr.children) {
      const decision = await evaluateExprWithPrograms(child, evaluateProgram, trace);
      if (decision === undefined) continue;
      hasDecision = true;
      if (decision === true) return true;
    }
    return hasDecision ? false : undefined;
  }
  throw runtimeError('INVALID_SUPPORT_EXPR', `未知规范 Expr：${expr.kind}`);
}

export async function evaluateSupportClausesWithPrograms(parsedDocument, options = {}) {
  const evaluateProgram = options.evaluateProgram ?? (() => {
    throw runtimeError('SUPPORT_PROGRAM_EVALUATOR_REQUIRED', 'Program 端点求值需要 Program runtime');
  });
  const changed = options.changedPaths ? new Set(options.changedPaths) : null;
  const selectedIds = changed
    ? new Set([...changed].flatMap((path) => parsedDocument.dependencyIndex.get(path) ?? []))
    : null;
  const results = new Map();
  for (const clause of parsedDocument.supportClauses) {
    if (selectedIds && !selectedIds.has(clause.id)) continue;
    const trace = [];
    try {
      const decision = (await evaluateExprWithPrograms(
        clause.root,
        (programPath) => evaluateProgram(programPath, { clause }),
        trace
      )) ?? true;
      results.set(clause.id, { status: decision ? 'true' : 'false', decision, trace });
    } catch (error) {
      results.set(clause.id, {
        status: 'failure',
        error: { code: error.code ?? 'SUPPORT_EVALUATION_FAILED', message: error.message },
        trace
      });
    }
  }
  return results;
}

export function buildSupportDeliveries(parsedDocument, options = {}) {
  const decisions = options.decisions ?? new Map();
  const revision = options.revision;
  if (typeof revision !== 'string' || !revision) {
    throw runtimeError('SUPPORT_DELIVERY_REVISION_REQUIRED', 'Support delivery requires one revision');
  }
  const deliveries = [];
  for (const clause of parsedDocument.supportClauses ?? []) {
    if (decisions.get(clause.id)?.decision !== true) continue;
    for (const target of clause.then ?? []) {
      deliveries.push(Object.freeze({
        mode: 'support',
        revision,
        clauseId: clause.id,
        decision: true,
        antecedentPaths: Object.freeze([...(clause.antecedentPaths ?? clause.dependencyPaths ?? [])]),
        consequentPath: target.targetPath,
        consequentOrdinal: target.thenOrdinal
      }));
    }
  }
  return Object.freeze(deliveries);
}

export function propagateSupportClauses(parsedDocument, options = {}) {
  const decisions = options.decisions ?? evaluateSupportClauses(parsedDocument, options);
  const queue = parsedDocument.supportClauses
    .filter((clause) => decisions.get(clause.id)?.decision === true)
    .map((clause) => clause.id);
  const visited = new Set();
  const edges = [];
  while (queue.length) {
    const clauseId = queue.shift();
    if (visited.has(clauseId)) continue;
    visited.add(clauseId);
    const clause = parsedDocument.supportClauses.find((candidate) => candidate.id === clauseId);
    if (!clause) continue;
    for (const sourcePath of clause.antecedentPaths ?? clause.dependencyPaths) {
      for (const target of clause.then) {
        const edgeId = `${clauseId}:${sourcePath}:${target.thenOrdinal}`;
        edges.push({ id: edgeId, clauseId, fromPath: sourcePath, toPath: target.targetPath });
        for (const dependent of parsedDocument.dependencyIndex.get(target.targetPath) ?? []) {
          if (!visited.has(dependent) && decisions.get(dependent)?.decision === true) queue.push(dependent);
        }
      }
    }
  }
  return { decisions, edges, visitedClauseIds: [...visited] };
}
