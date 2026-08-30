import { childDomainPath } from './probe.mjs';
import { SpatialStoreError, nodeKey } from './store.mjs';
import { GRAPH_SCHEMA_VERSION } from '../../work-engine/atom-language/graph-schema.mjs';
import { parseAtomKey } from '../../work-engine/atom-language/key-parser.mjs';

export const GRAPH_JSON_SCHEMA_VERSION = GRAPH_SCHEMA_VERSION;
export const GRAPH_COLLECTION_ROOT_NAME = 'knowledge.json';

const DOCUMENT_FIELDS = new Set(['config', 'graph']);
const CONFIG_FIELDS = new Set(['schema_version']);
const CLAUSE_FIELDS = new Set(['if@current', 'if', 'then@current', 'then']);
const SELECTOR_FIELDS = new Set(['thing', 'thing@program']);
const EXPR_FIELDS = new Set(['thing', 'thing@program', 'and', 'or']);
const NODE_AXIS_FIELDS = new Set(['thing', 'situation', 'contain', 'support']);

function graphError(code, message, details = {}) {
  return new SpatialStoreError(code, message, details);
}

function object(value, code, message, details = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw graphError(code, message, details);
  }
  return value;
}

function onlyFields(value, allowed, code, kind, details = {}) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw graphError(code, `${kind}包含未知字段：${unexpected.join('、')}`, { ...details, unexpected });
  }
}

function requiredText(value, code, message, details = {}) {
  if (typeof value !== 'string' || !value.trim()) throw graphError(code, message, details);
  return value;
}

export function classifySupportCurrentEndpoints(value) {
  const currentAntecedent = Object.hasOwn(value, 'if@current');
  const currentConsequent = Object.hasOwn(value, 'then@current');
  if (currentAntecedent && currentConsequent) {
    throw graphError(
      'CURRENT_ENDPOINT_ON_BOTH_SIDES',
      'current 不得在同一 support rule 中同时属于 antecedent 与 consequent'
    );
  }
  if (!currentAntecedent && !currentConsequent) {
    throw graphError(
      'SUPPORT_OWNER_CURRENT_REQUIRED',
      '每条 support rule 必须且只能用 if@current:true 或 then@current:true 声明承载 Thing'
    );
  }
  return { currentAntecedent, currentConsequent };
}

export function parseGraphDocument(input) {
  const source = object(input, 'INVALID_GRAPH_DOCUMENT', 'Graph JSON 必须是对象');
  onlyFields(source, DOCUMENT_FIELDS, 'UNKNOWN_GRAPH_DOCUMENT_FIELD', 'Graph JSON');
  const config = object(source.config, 'MISSING_GRAPH_CONFIG', 'Graph JSON 必须包含 config 对象');
  onlyFields(config, CONFIG_FIELDS, 'UNKNOWN_GRAPH_CONFIG_FIELD', 'config');
  if (config.schema_version !== GRAPH_JSON_SCHEMA_VERSION) {
    throw graphError('UNSUPPORTED_GRAPH_SCHEMA', `不支持 Graph JSON 版本：${config.schema_version || '未提供'}`, {
      supported: GRAPH_JSON_SCHEMA_VERSION
    });
  }

  const nodesByPath = new Map();
  const nodesByThing = new Map();
  const pendingClauses = [];
  const supportClauses = [];
  const dependencyIndex = new Map();
  const endpointIndex = new Map();
  const signatures = new Set();

  function parseNode(value, parentPath, siblingThings) {
    const node = object(value, 'INVALID_GRAPH_NODE', 'Graph 节点必须是对象', { parent: parentPath.join('/') });
    const fields = new Map();
    for (const [rawKey, fieldValue] of Object.entries(node)) {
      const parsed = NODE_AXIS_FIELDS.has(rawKey)
        ? { baseKey: rawKey, types: [], errors: [] }
        : parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
      if (parsed.errors.length) {
        const [error] = parsed.errors;
        throw graphError(error.code, error.message, { ...error.details, parent: parentPath.join('/') });
      }
      if (fields.has(parsed.baseKey)) {
        throw graphError('DUPLICATE_GRAPH_AXIS', `Graph 轴重复：${parsed.baseKey}`, {
          parent: parentPath.join('/'), baseKey: parsed.baseKey
        });
      }
      fields.set(parsed.baseKey, { rawKey, parsed, value: fieldValue });
    }
    for (const axis of ['thing', 'situation', 'contain', 'support']) {
      if (!fields.has(axis)) {
        throw graphError('INVALID_GRAPH_NODE_FIELDS', `Graph 节点必须恰好包含一个 ${axis} 字段`, {
          parent: parentPath.join('/'), baseKey: axis, count: 0
        });
      }
    }
    const thingField = fields.get('thing');
    const situationField = fields.get('situation');
    const containField = fields.get('contain');
    const supportField = fields.get('support');
    const thing = requiredText(thingField.value, 'INVALID_GRAPH_THING', '节点 thing 不能为空', {
      parent: parentPath.join('/')
    });
    if (thing.includes('/')) throw graphError('RESERVED_GRAPH_THING', `节点 thing 不能包含“/”：${thing}`);
    if (typeof situationField.value !== 'string' || !Array.isArray(containField.value)
      || !Array.isArray(supportField.value)) {
      throw graphError('INVALID_GRAPH_NODE_FIELDS', 'Graph 节点必须包含字符串 thing/situation 与数组 contain/support', {
        parent: parentPath.join('/')
      });
    }
    if (siblingThings.has(thing)) {
      throw graphError('DUPLICATE_GRAPH_THING', `同一层 contain 不得重名：${thing}`, {
        parent: parentPath.join('/'), thing
      });
    }
    siblingThings.add(thing);

    const path = [...parentPath, thing];
    const normalized = {
      [thingField.rawKey]: thing,
      [situationField.rawKey]: situationField.value,
      [containField.rawKey]: [],
      support: []
    };
    const entry = {
      path, node: normalized, thing, situation: situationField.value,
      isProgram: thingField.parsed.types.some((type) => type.raw === 'program')
    };
    nodesByPath.set(path.join('/'), entry);
    if (!nodesByThing.has(thing)) nodesByThing.set(thing, []);
    nodesByThing.get(thing).push(entry);
    pendingClauses.push({ source: entry, values: supportField.value });
    const childThings = new Set();
    normalized[containField.rawKey] = containField.value.map((child) => parseNode(child, path, childThings));
    return normalized;
  }

  const graph = parseNode(source.graph, [], new Set());

  function resolveSelector(rawSelector, sourceEntry, details) {
    const selector = requiredText(rawSelector, 'INVALID_SUPPORT_SELECTOR', 'thing selector 不能为空', details);
    if (selector.startsWith('/') || selector.endsWith('/') || selector.includes('//')) {
      throw graphError('INVALID_SUPPORT_SELECTOR', `thing selector 路径无效：${selector}`, details);
    }
    if (selector === '.') return sourceEntry;
    if (selector.startsWith('./')) {
      const relative = selector.slice(2);
      const scopedPath = [...sourceEntry.path.slice(0, -1), ...relative.split('/')].join('/');
      const match = nodesByPath.get(scopedPath);
      if (!match) {
        const outside = [...nodesByPath.values()].filter((candidate) => candidate.path.at(-1) === relative.split('/').at(-1));
        throw graphError(
          outside.length ? 'SUPPORT_SELECTOR_OUT_OF_DOMAIN' : 'SUPPORT_SELECTOR_NOT_FOUND',
          outside.length ? '相对 selector 超出当前域' : '相对 selector 在当前域不存在',
          { ...details, selector, domain: sourceEntry.path.slice(0, -1).join('/') }
        );
      }
      return match;
    }
    if (selector.includes('/')) {
      const match = nodesByPath.get(selector)
        ?? nodesByPath.get(`${sourceEntry.path[0]}/${selector}`);
      if (!match) throw graphError('SUPPORT_SELECTOR_NOT_FOUND', `selector 指向不存在的节点：${selector}`, details);
      return match;
    }
    const sibling = nodesByPath.get([...sourceEntry.path.slice(0, -1), selector].join('/'));
    if (sibling) return sibling;
    const candidates = nodesByThing.get(selector) ?? [];
    if (!candidates.length) throw graphError('SUPPORT_SELECTOR_NOT_FOUND', `selector 指向不存在的节点：${selector}`, details);
    for (let depth = sourceEntry.path.length - 2; depth >= 0; depth -= 1) {
      const domain = sourceEntry.path.slice(0, depth + 1);
      const scoped = candidates.filter((candidate) => domain.every((part, index) => candidate.path[index] === part));
      if (scoped.length === 1) return scoped[0];
      if (scoped.length > 1) {
        throw graphError('AMBIGUOUS_SUPPORT_SELECTOR', `selector 在最近当前域内名称不唯一：${selector}`, {
          ...details, domain: domain.join('/'), candidates: scoped.map((candidate) => candidate.path.join('/'))
        });
      }
    }
    if (candidates.length > 1) {
      throw graphError('AMBIGUOUS_SUPPORT_SELECTOR', `selector 名称不唯一：${selector}`, {
        ...details, candidates: candidates.map((candidate) => candidate.path.join('/'))
      });
    }
    return candidates[0];
  }

  function parseSelector(value, sourceEntry, details) {
    const selector = object(value, 'INVALID_SUPPORT_SELECTOR', 'thing selector 必须是对象', details);
    onlyFields(selector, SELECTOR_FIELDS, 'UNKNOWN_SUPPORT_SELECTOR_FIELD', 'thing selector', details);
    const keys = Object.keys(selector);
    if (keys.length !== 1 || !SELECTOR_FIELDS.has(keys[0])) {
      throw graphError('INVALID_SUPPORT_SELECTOR', '端点必须恰好包含 thing 或 thing@program', details);
    }
    const [kind] = keys;
    const raw = requiredText(selector[kind], 'INVALID_SUPPORT_SELECTOR', 'thing selector 不能为空', details);
    if (kind === 'thing@program' && /(?:satisfies\s*\(|lambda\b|def\s+main\b|\r|\n)/u.test(raw)) {
      throw graphError(
        'SUPPORT_INLINE_PROGRAM_UNSUPPORTED',
        'thing@program RHS 只能是 Program selector；源码只允许位于目标节点 situation',
        details
      );
    }
    const target = resolveSelector(raw, sourceEntry, details);
    if (kind === 'thing@program' && !target.isProgram) {
      throw graphError(
        'SUPPORT_PROGRAM_ENDPOINT_TYPE_MISMATCH',
        `thing@program selector 未指向 Program 节点：${raw}`,
        details
      );
    }
    return { raw: { [kind]: raw }, targetPath: target.path.join('/'), kind, isProgram: target.isProgram };
  }

  function parseExpr(value, sourceEntry, clauseOrdinal, exprPath = []) {
    const details = { source: sourceEntry.path.join('/'), clauseOrdinal, exprPath };
    const expr = object(value, 'INVALID_SUPPORT_EXPR', 'support Expr 必须是对象', details);
    if (Object.hasOwn(expr, 'satisfies')) {
      throw graphError(
        'SUPPORT_INLINE_PROGRAM_UNSUPPORTED',
        'support 不支持 satisfies/线载源码；请引用显式 thing@program 节点',
        details
      );
    }
    onlyFields(expr, EXPR_FIELDS, 'UNKNOWN_SUPPORT_EXPR_FIELD', 'support Expr', details);
    const keys = Object.keys(expr);
    if (keys.length !== 1) throw graphError('INVALID_SUPPORT_EXPR', 'support Expr 必须恰好包含一个根 key', details);
    const [kind] = keys;
    if (kind === 'thing' || kind === 'thing@program') {
      const leaf = parseSelector(expr, sourceEntry, details);
      if (leaf.targetPath === sourceEntry.path.join('/')) {
        throw graphError('CURRENT_ENDPOINT_REQUIRES_MODIFIER', 'current endpoint 必须使用对应 @current:true modifier', details);
      }
      return {
        kind: kind === 'thing@program' ? 'program' : 'thing',
        selector: leaf.raw[kind], targetPath: leaf.targetPath, exprPath
      };
    }
    if (!Array.isArray(expr[kind]) || expr[kind].length < 2) {
      throw graphError('INVALID_SUPPORT_COMPOSITE', `${kind} 必须至少包含两个有序 Expr`, details);
    }
    return {
      kind, exprPath,
      children: expr[kind].map((child, index) => parseExpr(
        child, sourceEntry, clauseOrdinal, [...exprPath, index]
      ))
    };
  }

  function dependencies(expr) {
    if (expr.kind === 'thing' || expr.kind === 'program') return [expr.targetPath];
    return expr.children.flatMap(dependencies);
  }

  function antecedents(expr) {
    if (expr.kind === 'thing' || expr.kind === 'program') {
      return [{ kind: expr.kind, targetPath: expr.targetPath }];
    }
    return expr.children.flatMap(antecedents);
  }

  function relationAntecedentPaths(expr) {
    const candidates = antecedents(expr);
    const ordinary = candidates.filter(({ kind }) => kind === 'thing');
    return [...new Set(ordinary.map(({ targetPath }) => targetPath))];
  }

  function expressionSignature(expr) {
    if (expr.kind === 'thing') return ['thing', expr.targetPath];
    if (expr.kind === 'program') return ['program', expr.targetPath];
    return [expr.kind, expr.children.map(expressionSignature)];
  }

  function indexEndpoint(path, ruleId, side) {
    if (!endpointIndex.has(path)) endpointIndex.set(path, []);
    endpointIndex.get(path).push({ ruleId, side });
  }

  for (const pending of pendingClauses) {
    pending.source.node.support = pending.values.map((value, clauseOrdinal) => {
      const details = { source: pending.source.path.join('/'), clauseOrdinal };
      const clause = object(value, 'INVALID_SUPPORT_CLAUSE', 'support clause 必须是对象', details);
      const current = classifySupportCurrentEndpoints(clause);
      onlyFields(clause, CLAUSE_FIELDS, 'UNKNOWN_SUPPORT_CLAUSE_FIELD', 'support clause', details);
      if (pending.source.isProgram) {
        throw graphError(
          'SUPPORT_DECISION_PROGRAM_MUST_BE_INDEPENDENT',
          '推支判定 Program 必须独立于普通事实端点；thing@program 不能用 @current 成为本条 support 的前项或后项',
          details
        );
      }
      for (const marker of ['if@current', 'then@current']) {
        if (Object.hasOwn(clause, marker) && clause[marker] !== true) {
          throw graphError('INVALID_CURRENT_MODIFIER', `${marker} 必须严格等于 boolean true`, details);
        }
      }
      const antecedentValues = clause.if ?? [];
      const consequentValues = clause.then ?? [];
      if (!Array.isArray(antecedentValues) || antecedentValues.length > 1) {
        throw graphError('INVALID_SUPPORT_IF', 'if 必须缺省、为空或恰好包含一个根 Expr', details);
      }
      if (!Array.isArray(consequentValues)) {
        throw graphError('INVALID_SUPPORT_THEN', 'then 必须是 consequent thing 引用数组', details);
      }
      if (!current.currentAntecedent && antecedentValues.length === 0) {
        throw graphError('MISSING_SUPPORT_ANTECEDENT', 'support rule 的 antecedent 不能为空', details);
      }
      if (!current.currentConsequent && consequentValues.length === 0) {
        throw graphError('MISSING_SUPPORT_CONSEQUENT', 'support rule 的 consequent 不能为空', details);
      }
      const ownerPath = pending.source.path.join('/');
      let root;
      if (current.currentAntecedent) {
        const implicitCurrent = {
          kind: pending.source.isProgram ? 'program' : 'thing',
          selector: '.', targetPath: ownerPath, exprPath: [0], implicit: true
        };
        root = antecedentValues.length === 0
          ? implicitCurrent
          : {
            kind: 'and', exprPath: [], implicitCurrent: true,
            children: [implicitCurrent, parseExpr(antecedentValues[0], pending.source, clauseOrdinal, [1])]
          };
      } else {
        root = parseExpr(antecedentValues[0], pending.source, clauseOrdinal, []);
      }
      const then = [];
      if (current.currentConsequent) {
        then.push({
          raw: null, targetPath: ownerPath, thenOrdinal: 0, implicit: true,
          kind: pending.source.isProgram ? 'thing@program' : 'thing'
        });
      }
      for (const item of consequentValues) {
        const parsed = parseSelector(item, pending.source, { ...details, thenOrdinal: then.length });
        if (parsed.isProgram) {
          throw graphError(
            'SUPPORT_FACT_CONSEQUENT_REQUIRED',
            'support 后项必须是普通事实 Thing；thing@program 只可作为 if 内的独立判定依赖',
            { ...details, thenOrdinal: then.length }
          );
        }
        if (parsed.targetPath === ownerPath) {
          throw graphError('CURRENT_ENDPOINT_REQUIRES_MODIFIER', 'current consequent 必须使用 then@current:true', details);
        }
        then.push({ ...parsed, thenOrdinal: then.length });
      }
      const clauseId = `support:${pending.source.path.join('/')}:${clauseOrdinal}`;
      const dependencyPaths = [...new Set(dependencies(root))];
      const antecedentPaths = relationAntecedentPaths(root);
      if (antecedentPaths.length === 0) {
        throw graphError(
          'SUPPORT_FACT_ANTECEDENT_REQUIRED',
          'support 必须包含至少一个普通事实前项；thing@program 只可作为独立判定依赖',
          details
        );
      }
      if (antecedentPaths.length > 1 && then.length > 1) {
        throw graphError(
          'NATIVE_MANY_TO_MANY_SUPPORT_UNSUPPORTED',
          '禁止原生 N→M support；请建立真实枢纽 Thing H，并拆为 N→H 与 H→M 两条规则',
          { ...details, antecedentCount: antecedentPaths.length, consequentCount: then.length }
        );
      }
      const signature = JSON.stringify([
        expressionSignature(root),
        then.map((target) => target.targetPath)
      ]);
      if (signatures.has(signature)) {
        throw graphError('DUPLICATE_SUPPORT_RULE', '同一 support rule 只能持久声明一次', details);
      }
      signatures.add(signature);
      const normalized = {
        id: clauseId, sourcePath: ownerPath,
        currentSide: current.currentAntecedent ? 'antecedent'
          : current.currentConsequent ? 'consequent' : null,
        clauseOrdinal, root, then, antecedentPaths, dependencyPaths, signature
      };
      supportClauses.push(normalized);
      for (const dependencyPath of dependencyPaths) {
        if (!dependencyIndex.has(dependencyPath)) dependencyIndex.set(dependencyPath, []);
        dependencyIndex.get(dependencyPath).push(clauseId);
        indexEndpoint(dependencyPath, clauseId, 'antecedent');
      }
      for (const target of then) indexEndpoint(target.targetPath, clauseId, 'consequent');
      return structuredClone(clause);
    });
  }

  const supportRelations = supportClauses.flatMap((clause) => clause.antecedentPaths.flatMap((sourcePath, inputOrdinal) => (
    clause.then.map((target) => ({
      sourcePath,
      targetPath: target.targetPath,
      clauseId: clause.id,
      clauseOrdinal: clause.clauseOrdinal,
      inputOrdinal,
      thenOrdinal: target.thenOrdinal,
      currentSide: clause.currentSide
    }))
  )));

  return {
    config: { schema_version: GRAPH_JSON_SCHEMA_VERSION },
    graph,
    supportClauses,
    supportRelations,
    dependencyIndex,
    endpointIndex
  };
}

function identity(node) {
  return node.key || nodeKey(node.path || 'root', node.id);
}

function childPaths(node) {
  return [...new Set([childDomainPath(node), `${node.path || 'root'}/${node.id}`])];
}

export function exportGraphDocument(knowledgeInput, options = {}) {
  const knowledge = knowledgeInput && typeof knowledgeInput === 'object' ? knowledgeInput : {};
  const nodes = Array.isArray(knowledge.nodes) ? knowledge.nodes : [];
  const edges = Array.isArray(knowledge.edges) ? knowledge.edges : [];
  const roots = nodes.filter((node) => (node.path || 'root') === 'root');
  const collection = options.collection === true;
  const requestedRoot = typeof options.root === 'string' ? options.root.trim() : '';
  let root = null;
  if (!collection) {
    const candidates = requestedRoot ? roots.filter((node) => node.label === requestedRoot) : roots;
    if (!candidates.length) throw graphError('GRAPH_ROOT_NOT_FOUND', '找不到可导出的顶层节点');
    if (candidates.length > 1) throw graphError('GRAPH_ROOT_REQUIRED', '存在多个顶层节点，请指定 root');
    [root] = candidates;
  }

  const nodesByPath = new Map();
  const nodesByIdentity = new Map();
  for (const node of nodes) {
    const domainPath = node.path || 'root';
    if (!nodesByPath.has(domainPath)) nodesByPath.set(domainPath, []);
    nodesByPath.get(domainPath).push(node);
    nodesByIdentity.set(identity(node), node);
    nodesByIdentity.set(nodeKey(domainPath, node.id), node);
    for (const alias of node.aliases || []) nodesByIdentity.set(alias, node);
  }

  const included = new Set();
  const serializedByNode = new Map();
  const visiblePathByNode = new Map();
  const active = new Set();
  function serializeNode(node, parentPath) {
    if (active.has(node)) throw graphError('GRAPH_HIERARCHY_CYCLE', `节点包含关系出现循环：${node.label}`);
    active.add(node);
    included.add(node);
    const thing = requiredText(node.label, 'GRAPH_THING_REQUIRED', 'thing 不能为空');
    if (thing.includes('/')) throw graphError('GRAPH_THING_RESERVED', `thing 不能包含“/”：${thing}`);
    const path = [...parentPath, thing];
    visiblePathByNode.set(node, path);
    const children = childPaths(node).flatMap((childPath) => nodesByPath.get(childPath) || []);
    const uniqueChildren = [...new Map(children.map((child) => [identity(child), child])).values()];
    const serialized = {
      thing,
      situation: typeof node.detail === 'string' ? node.detail : '',
      contain: uniqueChildren.map((child) => serializeNode(child, path)),
      support: []
    };
    serializedByNode.set(node, serialized);
    active.delete(node);
    return serialized;
  }

  let graph;
  if (collection) {
    graph = {
      thing: GRAPH_COLLECTION_ROOT_NAME,
      situation: '',
      contain: roots.map((candidate) => serializeNode(candidate, [GRAPH_COLLECTION_ROOT_NAME])),
      support: []
    };
  } else graph = serializeNode(root, []);

  const nameCounts = new Map();
  for (const node of included) nameCounts.set(node.label, (nameCounts.get(node.label) || 0) + 1);
  const selectorFor = (node) => nameCounts.get(node.label) === 1 ? node.label : visiblePathByNode.get(node).join('/');
  for (const edge of edges) {
    const from = nodesByIdentity.get(edge.from?.key)
      || nodesByIdentity.get(nodeKey(edge.from?.path || 'root', edge.from?.nodeId));
    const to = nodesByIdentity.get(edge.to?.key)
      || nodesByIdentity.get(nodeKey(edge.to?.path || 'root', edge.to?.nodeId));
    if (!from || !to || !included.has(from) || !included.has(to)) continue;
    serializedByNode.get(from).support.push({
      'if@current': true,
      then: [{ thing: selectorFor(to) }]
    });
  }
  return { config: { schema_version: GRAPH_JSON_SCHEMA_VERSION }, graph };
}

export function exportGraphCollectionDocument(knowledgeInput) {
  return exportGraphDocument(knowledgeInput, { collection: true });
}
