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
  throw runtimeError('INVALID_STRUT_EXPR', `未知规范 Expr：${expr.kind}`);
}

export function evaluateStrutClauses(parsedDocument, options = {}) {
  const changed = options.changedPaths ? new Set(options.changedPaths) : null;
  const selectedIds = changed
    ? new Set([...changed].flatMap((path) => parsedDocument.dependencyIndex.get(path) ?? []))
    : null;
  const results = new Map();
  for (const clause of parsedDocument.strutClauses) {
    if (selectedIds && !selectedIds.has(clause.id)) continue;
    const trace = [];
    try {
      const decision = evaluateExpr(clause.root) ?? true;
      results.set(clause.id, { status: decision ? 'true' : 'false', decision, trace });
    } catch (error) {
      results.set(clause.id, {
        status: 'failure',
        error: { code: error.code ?? 'STRUT_EVALUATION_FAILED', message: error.message },
        trace
      });
    }
  }
  return results;
}

async function evaluateExprWithPrograms(expr, evaluateProgram, trace) {
  if (expr.kind === 'thing') return undefined;
  if (expr.kind === 'program') {
    trace.push(expr.predicateId);
    const result = await evaluateProgram(expr);
    if (typeof result !== 'boolean') {
      throw runtimeError('INVALID_PROGRAM_STRUT_RESULT', '推支判定 Program 必须严格返回 boolean');
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
  throw runtimeError('INVALID_STRUT_EXPR', `未知规范 Expr：${expr.kind}`);
}

export async function evaluateStrutClausesWithPrograms(parsedDocument, options = {}) {
  const evaluateProgram = options.evaluateProgram ?? (() => {
    throw runtimeError('STRUT_PROGRAM_EVALUATOR_REQUIRED', 'Program 端点求值需要 Program runtime');
  });
  const changed = options.changedPaths ? new Set(options.changedPaths) : null;
  const selectedIds = changed
    ? new Set([...changed].flatMap((path) => parsedDocument.dependencyIndex.get(path) ?? []))
    : null;
  const results = new Map();
  for (const clause of parsedDocument.strutClauses) {
    if (selectedIds && !selectedIds.has(clause.id)) continue;
    const trace = [];
    try {
      const decision = (await evaluateExprWithPrograms(
        clause.root,
        (predicate) => evaluateProgram(predicate, { clause }),
        trace
      )) ?? true;
      results.set(clause.id, { status: decision ? 'true' : 'false', decision, trace });
    } catch (error) {
      results.set(clause.id, {
        status: 'failure',
        error: { code: error.code ?? 'STRUT_EVALUATION_FAILED', message: error.message },
        trace
      });
    }
  }
  return results;
}

export function buildStrutDeliveries(parsedDocument, options = {}) {
  const decisions = options.decisions ?? new Map();
  const revision = options.revision;
  if (typeof revision !== 'string' || !revision) {
    throw runtimeError('STRUT_DELIVERY_REVISION_REQUIRED', 'Strut delivery requires one revision');
  }
  const deliveries = [];
  for (const clause of parsedDocument.strutClauses ?? []) {
    if (decisions.get(clause.id)?.decision !== true) continue;
    for (const target of clause.then ?? []) {
      deliveries.push(Object.freeze({
        mode: 'strut',
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

export function propagateStrutClauses(parsedDocument, options = {}) {
  const decisions = options.decisions ?? evaluateStrutClauses(parsedDocument, options);
  const queue = parsedDocument.strutClauses
    .filter((clause) => decisions.get(clause.id)?.decision === true)
    .map((clause) => clause.id);
  const visited = new Set();
  const edges = [];
  while (queue.length) {
    const clauseId = queue.shift();
    if (visited.has(clauseId)) continue;
    visited.add(clauseId);
    const clause = parsedDocument.strutClauses.find((candidate) => candidate.id === clauseId);
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
