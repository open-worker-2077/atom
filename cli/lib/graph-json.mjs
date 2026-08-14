import { childDomainPath } from './probe.mjs';
import { SpatialStoreError, nodeKey } from './store.mjs';

export const GRAPH_JSON_SCHEMA_VERSION = '1.0.0';
export const GRAPH_COLLECTION_ROOT_NAME = 'knowledge.json';
const DOCUMENT_FIELDS = new Set(['config', 'graph']);
const CONFIG_FIELDS = new Set(['schema_version']);
const NODE_FIELDS = new Set(['name', 'detail', 'children', 'partners']);
const PARTNER_FIELDS = new Set(['verb', 'object']);

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
    throw graphError(code, `${kind}包含未知字段：${unexpected.join('、')}`, {
      ...details,
      unexpected
    });
  }
}

function requiredText(value, code, message, details = {}) {
  if (typeof value !== 'string' || !value.trim()) throw graphError(code, message, details);
  return value;
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
  const nodesByName = new Map();
  const pendingPartners = [];

  function parseNode(value, parentPath, siblingNames) {
    const node = object(value, 'INVALID_GRAPH_NODE', 'Graph 节点必须是对象', { parent: parentPath.join('/') });
    onlyFields(node, NODE_FIELDS, 'UNKNOWN_GRAPH_FIELD', 'Graph 节点', { parent: parentPath.join('/') });
    if (
      typeof node.detail !== 'string'
      || !Array.isArray(node.children)
      || !Array.isArray(node.partners)
    ) {
      throw graphError(
        'INVALID_GRAPH_NODE_FIELDS',
        'Graph 节点必须完整包含字符串 name、字符串 detail、数组 children 和数组 partners',
        { parent: parentPath.join('/') }
      );
    }

    const name = requiredText(node.name, 'INVALID_GRAPH_NAME', '节点 name 不能为空', {
      parent: parentPath.join('/')
    });
    if (name.includes('/')) {
      throw graphError('RESERVED_GRAPH_NAME', `节点 name 不能包含“/”：${name}`, { name });
    }
    if (siblingNames.has(name)) {
      throw graphError('DUPLICATE_GRAPH_NAME', `同一层 children 不得重名：${name}`, {
        parent: parentPath.join('/'),
        name
      });
    }
    siblingNames.add(name);

    const visiblePath = [...parentPath, name];
    const normalized = {
      name,
      detail: node.detail,
      children: [],
      partners: []
    };
    nodesByPath.set(visiblePath.join('/'), { path: visiblePath, node: normalized });
    if (!nodesByName.has(name)) nodesByName.set(name, []);
    nodesByName.get(name).push({ path: visiblePath, node: normalized });
    pendingPartners.push({ sourcePath: visiblePath, source: normalized, values: node.partners });
    const childNames = new Set();
    normalized.children = node.children.map((child) => parseNode(child, visiblePath, childNames));
    return normalized;
  }

  const graph = parseNode(source.graph, [], new Set());
  for (const pending of pendingPartners) {
    pending.source.partners = pending.values.map((value, index) => {
      const partner = object(value, 'INVALID_GRAPH_PARTNER', 'partners 项必须是对象', {
        source: pending.sourcePath.join('/'),
        index
      });
      onlyFields(partner, PARTNER_FIELDS, 'UNKNOWN_GRAPH_PARTNER_FIELD', 'partner', {
        source: pending.sourcePath.join('/'),
        index
      });
      const verb = requiredText(partner.verb, 'INVALID_GRAPH_VERB', 'partner.verb 不能为空');
      const target = requiredText(partner.object, 'INVALID_GRAPH_OBJECT', 'partner.object 不能为空');
      if (target.startsWith('/') || target.endsWith('/') || target.includes('//')) {
        throw graphError('INVALID_GRAPH_OBJECT', `partner.object 路径无效：${target}`);
      }

      let match;
      if (target.includes('/')) {
        match = nodesByPath.get(target);
      } else {
        const siblingPath = [...pending.sourcePath.slice(0, -1), target].join('/');
        match = nodesByPath.get(siblingPath);
        if (!match) {
          for (let depth = pending.sourcePath.length - 2; depth >= 1 && !match; depth -= 1) {
            const scope = pending.sourcePath.slice(0, depth);
            const scoped = (nodesByName.get(target) || []).filter((candidate) => (
              scope.every((part, index) => candidate.path[index] === part)
            ));
            if (scoped.length === 1) [match] = scoped;
            if (scoped.length > 1) {
              throw graphError('AMBIGUOUS_GRAPH_OBJECT', `partner.object 名称不唯一：${target}`, {
                source: pending.sourcePath.join('/'),
                scope: scope.join('/'),
                candidates: scoped.map((candidate) => candidate.path.join('/'))
              });
            }
          }
        }
        if (!match) {
          const candidates = nodesByName.get(target) || [];
          if (candidates.length === 1) [match] = candidates;
          if (candidates.length > 1) {
            throw graphError('AMBIGUOUS_GRAPH_OBJECT', `partner.object 名称不唯一：${target}`, {
              source: pending.sourcePath.join('/'),
              candidates: candidates.map((candidate) => candidate.path.join('/'))
            });
          }
        }
      }
      if (!match) {
        throw graphError('UNKNOWN_GRAPH_OBJECT', `partner.object 指向不存在的节点：${target}`, {
          source: pending.sourcePath.join('/')
        });
      }
      return { verb, object: target };
    });
  }

  return {
    config: {
      schema_version: GRAPH_JSON_SCHEMA_VERSION
    },
    graph
  };
}

function identity(node) {
  return node.key || nodeKey(node.path || 'root', node.id);
}

function childPaths(node) {
  return [...new Set([
    childDomainPath(node),
    `${node.path || 'root'}/${node.id}`
  ])];
}

export function exportGraphDocument(knowledgeInput, options = {}) {
  const knowledge = knowledgeInput && typeof knowledgeInput === 'object' ? knowledgeInput : {};
  const nodes = Array.isArray(knowledge.nodes) ? knowledge.nodes : [];
  const edges = Array.isArray(knowledge.edges) ? knowledge.edges : [];
  const roots = nodes.filter((node) => (node.path || 'root') === 'root');
  const collection = options.collection === true;
  const requestedRoot = typeof options.root === 'string' ? options.root.trim() : '';
  let root;

  if (collection) {
    root = null;
  } else if (requestedRoot) {
    const matches = roots.filter((node) => node.label === requestedRoot);
    if (!matches.length) {
      throw graphError('GRAPH_ROOT_NOT_FOUND', `找不到顶层节点：${requestedRoot}`, {
        root: requestedRoot,
        roots: roots.map((node) => node.label)
      });
    }
    if (matches.length > 1) {
      throw graphError('GRAPH_ROOT_AMBIGUOUS', `顶层节点名称不唯一：${requestedRoot}`, {
        root: requestedRoot,
        matches: matches.length
      });
    }
    [root] = matches;
  } else {
    if (!roots.length) throw graphError('EMPTY_GRAPH', '没有可导出的顶层节点');
    if (roots.length > 1) {
      throw graphError('GRAPH_ROOT_REQUIRED', '存在多个顶层节点，请使用 root 参数选择一个', {
        roots: roots.map((node) => node.label)
      });
    }
    [root] = roots;
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

  function serializeNode(node, parentVisiblePath) {
    if (active.has(node)) {
      throw graphError('GRAPH_HIERARCHY_CYCLE', `节点包含关系出现循环：${node.label}`);
    }
    active.add(node);
    included.add(node);

    const name = typeof node.label === 'string' ? node.label.trim() : '';
    if (!name) throw graphError('GRAPH_NODE_NAME_REQUIRED', '节点名称不能为空');
    if (name.includes('/')) {
      throw graphError('GRAPH_NODE_NAME_RESERVED', `节点名称不能包含“/”：${name}`, { name });
    }

    const visiblePath = [...parentVisiblePath, name];
    visiblePathByNode.set(node, visiblePath);
    const children = childPaths(node)
      .flatMap((domainPath) => nodesByPath.get(domainPath) || []);
    const uniqueChildren = [...new Map(children.map((child) => [identity(child), child])).values()];
    const siblingNames = new Set();
    for (const child of uniqueChildren) {
      const childName = typeof child.label === 'string' ? child.label.trim() : '';
      if (siblingNames.has(childName)) {
        throw graphError('DUPLICATE_CHILD_NAME', `同一层 children 不得重名：${childName}`, {
          parent: visiblePath.join('/'),
          name: childName
        });
      }
      siblingNames.add(childName);
    }

    const serialized = {
      name,
      detail: typeof node.detail === 'string' ? node.detail : '',
      children: uniqueChildren.map((child) => serializeNode(child, visiblePath)),
      partners: []
    };
    serializedByNode.set(node, serialized);
    active.delete(node);
    return serialized;
  }

  let graph;
  if (collection) {
    const rootNames = new Set();
    for (const candidate of roots) {
      const name = typeof candidate.label === 'string' ? candidate.label.trim() : '';
      if (rootNames.has(name)) {
        throw graphError('DUPLICATE_CHILD_NAME', `同一层 children 不得重名：${name}`, {
          parent: GRAPH_COLLECTION_ROOT_NAME,
          name
        });
      }
      rootNames.add(name);
    }
    graph = {
      name: GRAPH_COLLECTION_ROOT_NAME,
      detail: '',
      children: roots.map((candidate) => serializeNode(candidate, [GRAPH_COLLECTION_ROOT_NAME])),
      partners: []
    };
  } else {
    graph = serializeNode(root, []);
  }
  const includedEdges = [];
  for (const edge of edges) {
    const from = nodesByIdentity.get(edge.from?.key)
      || nodesByIdentity.get(nodeKey(edge.from?.path || 'root', edge.from?.nodeId));
    const to = nodesByIdentity.get(edge.to?.key)
      || nodesByIdentity.get(nodeKey(edge.to?.path || 'root', edge.to?.nodeId));
    if (from && to && included.has(from) && included.has(to)) {
      includedEdges.push({ edge, from, to });
    }
  }

  const nameCounts = new Map();
  for (const node of included) {
    const name = typeof node.label === 'string' ? node.label.trim() : '';
    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }
  for (const { edge, from, to } of includedEdges) {
    serializedByNode.get(from).partners.push({
      verb: typeof edge.label === 'string' && edge.label.trim() ? edge.label.trim() : '关联',
      object: nameCounts.get(to.label?.trim()) === 1
        ? to.label.trim()
        : visiblePathByNode.get(to).join('/')
    });
  }

  return {
    config: {
      schema_version: GRAPH_JSON_SCHEMA_VERSION
    },
    graph
  };
}

export function exportGraphCollectionDocument(knowledgeInput) {
  return exportGraphDocument(knowledgeInput, { collection: true });
}
