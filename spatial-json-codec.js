(function spatialJsonCodec(global) {
  "use strict";

  class JsonCodecError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "JsonCodecError";
      this.code = code;
      this.details = details;
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value ?? {}));
  }

  function hashText(value) {
    const input = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function childDomainPath(node) {
    return `${node.path || "root"}/${hashText(node.id).toString(36)}`;
  }

  function nodeKey(path, id) {
    return `${path || "root"}::${id}`;
  }

  function edgeIdentity(from, to) {
    return `relation:${from}->${to}`;
  }

  function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function pathKey(parts) {
    return JSON.stringify(parts);
  }

  function parse(source) {
    let raw;
    try {
      raw = typeof source === "string" ? JSON.parse(source.replace(/^\uFEFF/, "")) : clone(source);
    } catch (error) {
      throw new JsonCodecError("INVALID_JSON", "JSON 格式无效", { cause: error.message });
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new JsonCodecError("INVALID_DOCUMENT", "JSON 知识文件必须是对象");
    }
    if (raw.format !== "graph-4d") {
      throw new JsonCodecError("INVALID_FORMAT", "JSON 文件 format 必须是 graph-4d");
    }
    if (raw.version !== 1) {
      throw new JsonCodecError("UNSUPPORTED_VERSION", `暂不支持 JSON 版本：${raw.version}`);
    }
    if (!Array.isArray(raw.nodes) || !Array.isArray(raw.relations || [])) {
      throw new JsonCodecError("INVALID_DOCUMENT", "JSON 文件必须包含 nodes 与 relations 数组");
    }

    const endpointPaths = new Set();

    function parseNodes(items, parentPath) {
      const labels = new Set();
      return items.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new JsonCodecError("INVALID_NODE", "节点必须是对象", { path: parentPath, index });
        }
        const label = cleanText(item.name);
        const detail = cleanText(item.detail);
        const childrenInput = item.children === undefined ? [] : item.children;
        if (!label) {
          throw new JsonCodecError("MISSING_NAME", "节点名称不能为空", { path: parentPath, index });
        }
        if (labels.has(label)) {
          throw new JsonCodecError("DUPLICATE_NAME", `同一层出现重复名称：${label}`, { path: parentPath, label });
        }
        if (!Array.isArray(childrenInput)) {
          throw new JsonCodecError("INVALID_CHILDREN", `节点“${label}”的 children 必须是数组`);
        }
        labels.add(label);
        const visiblePath = [...parentPath, label];
        endpointPaths.add(pathKey(visiblePath));
        const children = parseNodes(childrenInput, visiblePath);
        if (!children.length && !detail) {
          throw new JsonCodecError("MISSING_DETAIL", `节点“${label}”缺少详情`, { path: visiblePath });
        }
        return {
          kind: children.length ? "group" : "node",
          label,
          detail,
          children,
          visiblePath
        };
      });
    }

    const roots = parseNodes(raw.nodes, []);
    const edges = (raw.relations || []).map((edge, index) => {
      if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
        throw new JsonCodecError("INVALID_RELATION", "关系必须是对象", { index });
      }
      const fromPath = Array.isArray(edge.from) ? edge.from.map(cleanText) : [];
      const toPath = Array.isArray(edge.to) ? edge.to.map(cleanText) : [];
      if (!fromPath.length || !toPath.length || fromPath.some((part) => !part) || toPath.some((part) => !part)) {
        throw new JsonCodecError("INVALID_RELATION", "关系端点必须是非空名称路径", { index });
      }
      if (!endpointPaths.has(pathKey(fromPath)) || !endpointPaths.has(pathKey(toPath))) {
        throw new JsonCodecError("UNKNOWN_ENDPOINT", `关系端点不存在：${fromPath.join("/")} → ${toPath.join("/")}`, {
          index,
          fromPath,
          toPath
        });
      }
      return {
        fromPath,
        toPath,
        label: cleanText(edge.name) || "关联"
      };
    });

    return { format: "graph-4d", version: 1, roots, edges };
  }

  function uniqueNodeId(nodes, path, label) {
    const base = `json-${hashText(`${path}\n${label}`).toString(36)}`;
    let candidate = base;
    let suffix = 2;
    while (nodes.some((node) => node.path === path && node.id === candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function createImportedNode(nodes, path, item, ordinal) {
    const id = uniqueNodeId(nodes, path, item.label);
    const angle = ordinal * 2.399963229728653;
    const radius = 1.5 + Math.sqrt(ordinal + 1) * 0.42;
    return {
      id,
      key: nodeKey(path, id),
      path,
      label: item.label,
      detail: item.detail || "",
      attachment: null,
      position: {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.72,
        z: ((ordinal % 5) - 2) * 0.18
      },
      radius: 0.82,
      carrier: "tunnel",
      hasChildren: item.children.length > 0,
      surfaceVisible: true,
      aliases: []
    };
  }

  function endpoint(node) {
    return {
      key: node.key,
      path: node.path,
      nodeId: node.id,
      label: node.label,
      pathLabels: []
    };
  }

  function synchronizeChildState(nodes) {
    const occupied = new Set(nodes.map((node) => node.path));
    for (const node of nodes) {
      node.hasChildren = occupied.has(childDomainPath(node)) || occupied.has(`${node.path}/${node.id}`);
    }
  }

  function planImport(knowledgeInput, document, targetInput) {
    if (!document || !Array.isArray(document.roots) || !Array.isArray(document.edges)) {
      throw new JsonCodecError("INVALID_DOCUMENT", "JSON 解析结果无效");
    }
    const target = targetInput && typeof targetInput === "object" ? targetInput : {};
    const targetPath = typeof target.path === "string" && target.path ? target.path : "root";
    const knowledge = clone(knowledgeInput);
    knowledge.nodes = Array.isArray(knowledge.nodes) ? knowledge.nodes : [];
    knowledge.edges = Array.isArray(knowledge.edges) ? knowledge.edges : [];
    knowledge.nodePatches = Array.isArray(knowledge.nodePatches) ? knowledge.nodePatches : [];
    knowledge.deletedNodeKeys = Array.isArray(knowledge.deletedNodeKeys) ? knowledge.deletedNodeKeys : [];
    knowledge.removedEdgeIds = Array.isArray(knowledge.removedEdgeIds) ? knowledge.removedEdgeIds : [];

    const resolved = new Map();
    const involvedKeys = new Set();
    let addedNodes = 0;
    let updatedNodes = 0;
    let maxDepth = 0;
    let ordinal = 0;

    function importItems(items, path, depth, parentVisiblePath) {
      maxDepth = Math.max(maxDepth, depth);
      for (const item of items) {
        let node = knowledge.nodes.find((candidate) => candidate.path === path && candidate.label === item.label);
        if (node) {
          updatedNodes += 1;
          if (!item.children.length || item.detail) node.detail = item.detail;
        } else {
          node = createImportedNode(knowledge.nodes, path, item, ordinal);
          ordinal += 1;
          knowledge.nodes.push(node);
          addedNodes += 1;
        }
        const visiblePath = [...parentVisiblePath, item.label];
        resolved.set(pathKey(visiblePath), node);
        involvedKeys.add(node.key);
        if (item.children.length) {
          importItems(item.children, childDomainPath(node), depth + 1, visiblePath);
        }
      }
    }

    importItems(document.roots, targetPath, 0, []);

    const retainedEdges = [];
    let removedEdges = 0;
    for (const edge of knowledge.edges) {
      if (involvedKeys.has(edge.from && edge.from.key) && involvedKeys.has(edge.to && edge.to.key)) {
        removedEdges += 1;
      } else {
        retainedEdges.push(edge);
      }
    }
    const importedEdges = document.edges.map((edge) => {
      const fromNode = resolved.get(pathKey(edge.fromPath));
      const toNode = resolved.get(pathKey(edge.toPath));
      if (!fromNode || !toNode) {
        throw new JsonCodecError("UNKNOWN_ENDPOINT", `关系端点不存在：${edge.fromPath.join("/")} → ${edge.toPath.join("/")}`, { edge });
      }
      return {
        id: edgeIdentity(fromNode.key, toNode.key),
        from: endpoint(fromNode),
        to: endpoint(toNode),
        label: edge.label || "关联",
        crossDomain: fromNode.path !== toNode.path
      };
    });
    knowledge.edges = [...new Map([...retainedEdges, ...importedEdges].map((edge) => [edge.id, edge])).values()];
    synchronizeChildState(knowledge.nodes);

    return {
      knowledge,
      summary: {
        target: target.parentLabel || "全局",
        addedNodes,
        updatedNodes,
        addedOrUpdatedEdges: importedEdges.length,
        removedEdges: Math.max(0, removedEdges - importedEdges.filter((edge) => (
          knowledgeInput?.edges?.some((candidate) => candidate.id === edge.id)
        )).length),
        maxDepth
      },
      warnings: target.parentKey ? [] : ["未选择母节点，确认后将从全局顶层导入"]
    };
  }

  function exportJson(knowledgeInput, selectionInput = {}) {
    const knowledge = knowledgeInput && typeof knowledgeInput === "object" ? knowledgeInput : {};
    const nodes = Array.isArray(knowledge.nodes) ? knowledge.nodes : [];
    const edges = Array.isArray(knowledge.edges) ? knowledge.edges : [];
    const selection = selectionInput && typeof selectionInput === "object" ? selectionInput : {};
    const selected = selection.key ? nodes.find((node) => node.key === selection.key) : null;
    if (selection.key && !selected) {
      throw new JsonCodecError("UNKNOWN_SELECTION", `找不到要导出的节点：${selection.key}`);
    }

    const nodesByPath = new Map();
    const nodesByIdentity = new Map();
    for (const node of nodes) {
      const path = node.path || "root";
      if (!nodesByPath.has(path)) nodesByPath.set(path, []);
      nodesByPath.get(path).push(node);
      nodesByIdentity.set(node.key || nodeKey(path, node.id), node);
      nodesByIdentity.set(nodeKey(path, node.id), node);
      for (const alias of node.aliases || []) nodesByIdentity.set(alias, node);
    }

    const included = new Set();
    const visiblePaths = new Map();

    function serializeNode(node, parentVisiblePath) {
      included.add(node.key);
      const visiblePath = [...parentVisiblePath, node.label];
      visiblePaths.set(node.key, visiblePath);
      const children = (nodesByPath.get(childDomainPath(node)) || []).map((child) => serializeNode(child, visiblePath));
      return {
        name: node.label,
        detail: node.detail || "",
        children
      };
    }

    const roots = selected ? [selected] : (nodesByPath.get("root") || []);
    const exportedNodes = roots.map((root) => serializeNode(root, []));
    const relations = [];
    for (const edge of edges) {
      const from = nodesByIdentity.get(edge.from && edge.from.key)
        || nodes.find((node) => node.path === edge.from?.path && node.id === edge.from?.nodeId);
      const to = nodesByIdentity.get(edge.to && edge.to.key)
        || nodes.find((node) => node.path === edge.to?.path && node.id === edge.to?.nodeId);
      if (!from || !to || !included.has(from.key) || !included.has(to.key)) continue;
      relations.push({
        from: visiblePaths.get(from.key),
        to: visiblePaths.get(to.key),
        name: edge.label || "关联"
      });
    }

    return `${JSON.stringify({
      format: "graph-4d",
      version: 1,
      nodes: exportedNodes,
      relations
    }, null, 2)}\n`;
  }

  global.SpatialJsonCodec = Object.freeze({
    JsonCodecError,
    parse,
    planImport,
    exportJson
  });
})(window);
