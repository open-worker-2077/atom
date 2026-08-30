function runtimeError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function evaluateExpr(expr, nodesByPath, trace) {
  if (expr.kind === 'thing') {
    trace.push(expr.targetPath);
    return nodesByPath.has(expr.targetPath);
  }
  if (expr.kind === 'and') {
    for (const child of expr.children) {
      if (evaluateExpr(child, nodesByPath, trace) === false) return false;
    }
    return true;
  }
  if (expr.kind === 'or') {
    for (const child of expr.children) {
      if (evaluateExpr(child, nodesByPath, trace) === true) return true;
    }
    return false;
  }
  throw runtimeError('INVALID_SUPPORT_EXPR', `未知规范 Expr：${expr.kind}`);
}

function nodeViews(graph) {
  const result = new Map();
  function visit(node, parent = []) {
    const thingKey = Object.keys(node).find((key) => key === 'thing' || key.startsWith('thing@'));
    const situationKey = Object.keys(node).find((key) => key === 'situation' || key.startsWith('situation@'));
    const containKey = Object.keys(node).find((key) => key === 'contain' || key.startsWith('contain@'));
    const path = [...parent, node[thingKey]].join('/');
    result.set(path, Object.freeze({
      thing: node[thingKey],
      situation: node[situationKey],
      contain: structuredClone(node[containKey] ?? []),
      support: structuredClone(node.support ?? []),
      path,
      types: thingKey.split('@').slice(1)
    }));
    for (const child of node[containKey] ?? []) visit(child, path.split('/'));
  }
  visit(graph);
  return result;
}

export function evaluateSupportClauses(parsedDocument, options = {}) {
  const nodes = options.nodesByPath ?? nodeViews(parsedDocument.graph);
  const changed = options.changedPaths ? new Set(options.changedPaths) : null;
  const selectedIds = changed
    ? new Set([...changed].flatMap((path) => parsedDocument.dependencyIndex.get(path) ?? []))
    : null;
  const results = new Map();
  for (const clause of parsedDocument.supportClauses) {
    if (selectedIds && !selectedIds.has(clause.id)) continue;
    const trace = [];
    try {
      const decision = evaluateExpr(clause.root, nodes, trace);
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
      const decision = (await evaluateExprWithPrograms(clause.root, evaluateProgram, trace)) ?? true;
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
