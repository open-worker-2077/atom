(function spatialMermaidCodec(global) {
  "use strict";

  class MermaidCodecError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = "MermaidCodecError";
      this.code = code;
      this.details = details;
    }
  }

  function decodeEntities(value) {
    return String(value || "")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&");
  }

  function visibleText(value) {
    return decodeEntities(String(value || "").replace(/<br\s*\/?\s*>/gi, "\n"));
  }

  function labelParts(value) {
    const parts = visibleText(value).split(/\r?\n/);
    return {
      label: (parts.shift() || "").trim(),
      detail: parts.join("\n").trim()
    };
  }

  function sourceBody(source) {
    const text = String(source || "").replace(/^\uFEFF/, "");
    const fenced = text.match(/```\s*mermaid\s*\r?\n([\s\S]*?)```/i);
    return fenced ? fenced[1] : text;
  }

  function groupDeclaration(line) {
    const match = line.match(/^subgraph\s+([A-Za-z_][\w.-]*)(?:\s*\[\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|([^\]]+))\s*\]|\s+(.+))?\s*;?$/i);
    if (!match) return null;
    return {
      ref: match[1],
      ...labelParts(match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[1])
    };
  }

  function nodeDeclaration(line) {
    const match = line.match(/^([A-Za-z_][\w.-]*)\s*(?:\[\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|([^\]]+))\s*\]|\{\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|([^}]+))\s*\}|\(\(\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|([^)]*?))\s*\)\)|\(\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|([^)]*?))\s*\))\s*;?$/);
    if (!match) return null;
    const raw = match.slice(2).find((value) => value !== undefined) || "";
    return { ref: match[1], ...labelParts(raw) };
  }

  function edgeDeclaration(line) {
    const match = line.match(/^([A-Za-z_][\w.-]*)\s*(?:--\s*"([^"]*)"\s*-->|--\s*'([^']*)'\s*-->|-->\s*\|([^|]*)\||-->)\s*([A-Za-z_][\w.-]*)\s*;?$/);
    if (!match) return null;
    return {
      from: match[1],
      to: match[5],
      label: visibleText(match[2] ?? match[3] ?? match[4] ?? "").trim()
    };
  }

  function parse(source) {
    const lines = sourceBody(source).split(/\r?\n/);
    const document = { direction: "LR", roots: [], edges: [] };
    const scopes = [{ children: document.roots, labels: new Set(), ref: null }];
    const references = new Map();
    let headerSeen = false;

    function addReference(item, lineNumber) {
      if (!item.ref || references.has(item.ref)) {
        throw new MermaidCodecError("DUPLICATE_ID", `Mermaid 标识重复：${item.ref}`, { line: lineNumber, ref: item.ref });
      }
      const scope = scopes[scopes.length - 1];
      if (!item.label) {
        throw new MermaidCodecError("MISSING_NAME", "节点或分组名称不能为空", { line: lineNumber, ref: item.ref });
      }
      if (scope.labels.has(item.label)) {
        throw new MermaidCodecError("DUPLICATE_NAME", `同一层出现重复名称：${item.label}`, { line: lineNumber, label: item.label });
      }
      scope.labels.add(item.label);
      scope.children.push(item);
      references.set(item.ref, item);
    }

    lines.forEach((rawLine, index) => {
      const lineNumber = index + 1;
      const line = rawLine.replace(/%%.*$/, "").trim();
      if (!line) return;
      const header = line.match(/^(?:flowchart|graph)\s+(TB|TD|BT|RL|LR)\s*;?$/i);
      if (header) {
        document.direction = header[1].toUpperCase() === "TD" ? "TB" : header[1].toUpperCase();
        headerSeen = true;
        return;
      }
      if (/^direction\s+(TB|TD|BT|RL|LR)\s*;?$/i.test(line)) return;
      if (/^end\s*;?$/i.test(line)) {
        if (scopes.length === 1) {
          throw new MermaidCodecError("UNEXPECTED_END", "出现了没有对应 subgraph 的 end", { line: lineNumber });
        }
        scopes.pop();
        return;
      }
      const group = groupDeclaration(line);
      if (group) {
        const item = { kind: "group", ref: group.ref, label: group.label, detail: group.detail, children: [] };
        addReference(item, lineNumber);
        scopes.push({ children: item.children, labels: new Set(), ref: item.ref });
        return;
      }
      const edge = edgeDeclaration(line);
      if (edge) {
        document.edges.push(edge);
        return;
      }
      const node = nodeDeclaration(line);
      if (node) {
        if (!node.detail) {
          throw new MermaidCodecError("MISSING_DETAIL", `节点“${node.label}”缺少详情`, { line: lineNumber, ref: node.ref, label: node.label });
        }
        addReference({ kind: "node", ...node }, lineNumber);
        return;
      }
      throw new MermaidCodecError("UNSUPPORTED_SYNTAX", `无法识别第 ${lineNumber} 行 Mermaid 语法`, { line: lineNumber, source: line });
    });

    if (!headerSeen) throw new MermaidCodecError("MISSING_HEADER", "Mermaid 必须以 flowchart 或 graph 开头");
    if (scopes.length !== 1) throw new MermaidCodecError("UNCLOSED_SUBGRAPH", "存在未闭合的 subgraph");
    for (const edge of document.edges) {
      if (!references.has(edge.from) || !references.has(edge.to)) {
        throw new MermaidCodecError("UNKNOWN_ENDPOINT", `关系端点不存在：${edge.from} --> ${edge.to}`, { edge });
      }
    }
    document.references = Object.fromEntries(references);
    return document;
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

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function nodeKey(path, id) {
    return `${path || "root"}::${id}`;
  }

  function edgeIdentity(from, to) {
    return `relation:${from}->${to}`;
  }

  function uniqueNodeId(nodes, path, label) {
    const base = `mermaid-${hashText(`${path}\n${label}`).toString(36)}`;
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
      hasChildren: item.kind === "group" && item.children.length > 0,
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
      throw new MermaidCodecError("INVALID_DOCUMENT", "Mermaid 解析结果无效");
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

    function importItems(items, path, depth) {
      maxDepth = Math.max(maxDepth, depth);
      for (const item of items) {
        let node = knowledge.nodes.find((candidate) => candidate.path === path && candidate.label === item.label);
        if (node) {
          updatedNodes += 1;
          if (item.kind === "node" || item.detail) node.detail = item.detail;
        } else {
          node = createImportedNode(knowledge.nodes, path, item, ordinal);
          ordinal += 1;
          knowledge.nodes.push(node);
          addedNodes += 1;
        }
        resolved.set(item.ref, node);
        involvedKeys.add(node.key);
        if (item.kind === "group") importItems(item.children, childDomainPath(node), depth + 1);
      }
    }

    importItems(document.roots, targetPath, 0);

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
      const fromNode = resolved.get(edge.from);
      const toNode = resolved.get(edge.to);
      if (!fromNode || !toNode) {
        throw new MermaidCodecError("UNKNOWN_ENDPOINT", `关系端点不存在：${edge.from} --> ${edge.to}`, { edge });
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
      warnings: target.parentKey ? [] : ["未选择母节点，确认后将导入全局顶层"]
    };
  }

  function encodeText(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function mermaidLabel(node) {
    const parts = [encodeText(node.label)];
    if (node.detail) {
      parts.push(...String(node.detail).split(/\r?\n/).map(encodeText));
    }
    return parts.join("<br/>");
  }

  function exportMermaid(knowledgeInput, selectionInput = {}) {
    const knowledge = knowledgeInput && typeof knowledgeInput === "object" ? knowledgeInput : {};
    const nodes = Array.isArray(knowledge.nodes) ? knowledge.nodes : [];
    const edges = Array.isArray(knowledge.edges) ? knowledge.edges : [];
    const selection = selectionInput && typeof selectionInput === "object" ? selectionInput : {};
    const selected = selection.key ? nodes.find((node) => node.key === selection.key) : null;
    if (selection.key && !selected) {
      throw new MermaidCodecError("UNKNOWN_SELECTION", `找不到要导出的节点：${selection.key}`);
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
    const references = new Map();
    const usedReferences = new Set();

    function referenceFor(node) {
      if (references.has(node.key)) return references.get(node.key);
      const prefix = (nodesByPath.get(childDomainPath(node)) || []).length ? "M" : "N";
      const base = `${prefix}${hashText(node.key || nodeKey(node.path, node.id)).toString(36)}`;
      let ref = base;
      let suffix = 2;
      while (usedReferences.has(ref)) {
        ref = `${base}_${suffix}`;
        suffix += 1;
      }
      usedReferences.add(ref);
      references.set(node.key, ref);
      return ref;
    }

    function collect(node) {
      if (included.has(node.key)) return;
      included.add(node.key);
      referenceFor(node);
      for (const child of nodesByPath.get(childDomainPath(node)) || []) collect(child);
    }

    const roots = selected ? [selected] : (nodesByPath.get("root") || []);
    for (const root of roots) collect(root);

    const lines = ["flowchart LR"];
    function renderNode(node, depth) {
      const indent = "  ".repeat(depth);
      const ref = referenceFor(node);
      const children = (nodesByPath.get(childDomainPath(node)) || []).filter((child) => included.has(child.key));
      if (children.length) {
        lines.push(`${indent}subgraph ${ref}["${mermaidLabel(node)}"]`);
        lines.push(`${indent}  direction ${depth % 2 === 1 ? "TB" : "LR"}`);
        for (const child of children) renderNode(child, depth + 1);
        lines.push(`${indent}end`);
        return;
      }
      lines.push(`${indent}${ref}["${mermaidLabel(node)}"]`);
    }
    for (const root of roots) renderNode(root, 1);

    for (const edge of edges) {
      const from = nodesByIdentity.get(edge.from && edge.from.key)
        || nodes.find((node) => node.path === edge.from?.path && node.id === edge.from?.nodeId);
      const to = nodesByIdentity.get(edge.to && edge.to.key)
        || nodes.find((node) => node.path === edge.to?.path && node.id === edge.to?.nodeId);
      if (!from || !to || !included.has(from.key) || !included.has(to.key)) continue;
      const label = encodeText(edge.label || "关联");
      lines.push(`  ${referenceFor(from)} -- "${label}" --> ${referenceFor(to)}`);
    }

    return `${lines.join("\n")}\n`;
  }

  global.SpatialMermaidCodec = Object.freeze({
    MermaidCodecError,
    parse,
    planImport,
    exportMermaid
  });
})(window);
