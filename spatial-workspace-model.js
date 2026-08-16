(function spatialWorkspaceModel(global) {
  "use strict";

  const MAX_QUERY_LENGTH = 80;
  const MAX_LABEL_LENGTH = 80;
  const MAX_DETAIL_LENGTH = 4000;

  function normalizedDetailMode(node) {
    if (node && node.surfaceVisible === true) {
      return "surface";
    }
    if (node && ["name", "surface", "floating"].includes(node.detailMode)) {
      return node.detailMode;
    }
    return "floating";
  }

  function safeText(value, fallback = "", maximum = MAX_DETAIL_LENGTH) {
    if (typeof value !== "string") return fallback;
    return value.replace(/\u0000/g, "").slice(0, maximum);
  }

  function normalizeQuery(value) {
    return safeText(value, "", MAX_QUERY_LENGTH).trim().toLocaleLowerCase("zh-CN");
  }

  function highlightSegments(text, query) {
    const source = safeText(text);
    const needle = normalizeQuery(query);
    if (!source || !needle) {
      return source ? [{ text: source, match: false }] : [];
    }
    const lower = source.toLocaleLowerCase("zh-CN");
    const segments = [];
    let cursor = 0;
    while (cursor < source.length) {
      const index = lower.indexOf(needle, cursor);
      if (index === -1) {
        segments.push({ text: source.slice(cursor), match: false });
        break;
      }
      if (index > cursor) {
        segments.push({ text: source.slice(cursor, index), match: false });
      }
      segments.push({ text: source.slice(index, index + needle.length), match: true });
      cursor = index + needle.length;
    }
    return segments;
  }

  function searchEntries(entries, query, limit = 24) {
    const needle = normalizeQuery(query);
    if (!needle || !Array.isArray(entries)) return [];
    return entries
      .map((entry) => {
        const label = safeText(entry && entry.label, "", MAX_LABEL_LENGTH);
        const pathLabels = Array.isArray(entry && entry.pathLabels)
          ? entry.pathLabels.map((item) => safeText(item, "", MAX_LABEL_LENGTH)).filter(Boolean)
          : [];
        const labelMatch = label.toLocaleLowerCase("zh-CN").includes(needle);
        const pathMatch = pathLabels.some((item) => item.toLocaleLowerCase("zh-CN").includes(needle));
        if (!labelMatch && !pathMatch) return null;
        return {
          path: safeText(entry.path, "root", 512),
          pathLabels,
          pathSegments: pathLabels.map((item) => highlightSegments(item, needle)),
          nodeId: safeText(entry.nodeId, "", 256),
          label,
          labelSegments: highlightSegments(label, needle),
          score: labelMatch ? 2 : 1
        };
      })
      .filter(Boolean)
      .sort((left, right) => (
        right.score - left.score
        || left.pathLabels.length - right.pathLabels.length
        || left.label.localeCompare(right.label, "zh-CN")
      ))
      .slice(0, Math.max(1, Math.min(64, Number(limit) || 24)));
  }

  function qualifiedEndpoint(path, node, pathLabels) {
    const safePath = safeText(path, "root", 512) || "root";
    const nodeId = safeText(node && node.id, "", 256);
    return {
      key: `${safePath}::${nodeId}`,
      atomPath: safeText(node && node.atomPath, "", 4000),
      path: safePath,
      nodeId,
      label: safeText(node && node.label, nodeId, MAX_LABEL_LENGTH),
      pathLabels: Array.isArray(pathLabels)
        ? pathLabels.map((item) => safeText(item, "", MAX_LABEL_LENGTH)).filter(Boolean)
        : []
    };
  }

  function persistedLandingNode(operation, knowledge) {
    if (!operation || operation.kind !== "node-land") return null;
    const targetPath = safeText(operation.target && operation.target.path, "", 512);
    const label = safeText(operation.draft && operation.draft.label, "", MAX_LABEL_LENGTH);
    if (!targetPath || !label) return null;
    return (Array.isArray(knowledge && knowledge.nodes) ? knowledge.nodes : [])
      .find((node) => node && node.path === targetPath && node.label === label) || null;
  }

  function nodeIdentity(node, fallbackPath = "") {
    if (!node || typeof node !== "object") return null;
    const path = safeText(node.path || node.workspacePath || fallbackPath, "", 512);
    const id = safeText(node.id || node.nodeId, "", 256);
    if (!path || !id) return null;
    return {
      key: safeText(node.key, "", 1024) || `${path}::${id}`,
      path,
      id
    };
  }

  function operationIdentityTransitions(operation, knowledge, previousKnowledge, persistedNode = null) {
    if (!operation || typeof operation !== "object") return [];
    const previousNodes = Array.isArray(previousKnowledge && previousKnowledge.nodes)
      ? previousKnowledge.nodes
      : [];
    const nextNodes = Array.isArray(knowledge && knowledge.nodes) ? knowledge.nodes : [];
    const transitions = [];
    const add = (fromNode, toNode, fallbackPath = "") => {
      const from = nodeIdentity(fromNode, fallbackPath);
      const to = nodeIdentity(toNode, fallbackPath);
      if (!from || !to || transitions.some((entry) => entry.from.key === from.key)) return;
      transitions.push({ from, to });
    };

    if (operation.kind === "node-create" && persistedNode) {
      add(operation.draft, persistedNode, operation.path);
      return transitions;
    }

    if (!["node-edit", "node-land"].includes(operation.kind)) return transitions;
    const operationNode = operation.node || operation.sourceNode || operation.draft || null;
    const requestedKey = operation.nodeKey || operation.oldKey || operation.source && operation.source.key;
    const priorRoot = previousNodes.find((node) => (
      node && (
        node.key === requestedKey
        || (operationNode && node.id === operationNode.id && node.path === (operationNode.path || operationNode.workspacePath))
        || (operationNode && operationNode.atomPath && node.atomPath === operationNode.atomPath)
      )
    )) || operationNode;
    const nextRoot = persistedNode || (operation.kind === "node-land"
      ? persistedLandingNode(operation, knowledge)
      : null);
    if (!priorRoot || !nextRoot) return transitions;

    const oldAtomPath = safeText(priorRoot.atomPath, "", 4000);
    const newAtomPath = safeText(nextRoot.atomPath, "", 4000);
    if (!oldAtomPath || !newAtomPath) {
      add(priorRoot, nextRoot, operation.path || operation.target && operation.target.path);
      return transitions;
    }
    const nextByAtomPath = new Map(nextNodes
      .filter((node) => node && typeof node.atomPath === "string")
      .map((node) => [node.atomPath, node]));
    previousNodes.forEach((node) => {
      if (!node || (node.atomPath !== oldAtomPath && !node.atomPath.startsWith(`${oldAtomPath}/`))) return;
      const suffix = node.atomPath.slice(oldAtomPath.length);
      const nextNode = nextByAtomPath.get(`${newAtomPath}${suffix}`);
      if (nextNode) add(node, nextNode);
    });
    if (!transitions.length) add(priorRoot, nextRoot, operation.path || operation.target && operation.target.path);
    return transitions;
  }

  function remapIdentity(identity, transitions = []) {
    if (!identity || !identity.path || !identity.id) return null;
    const key = `${identity.path}::${identity.id}`;
    const transition = transitions.find((entry) => entry && entry.from && entry.from.key === key);
    return transition
      ? { path: transition.to.path, id: transition.to.id }
      : { path: identity.path, id: identity.id };
  }

  function reconcileVisualItems(items, transitions, resolveNode) {
    if (!Array.isArray(items) || typeof resolveNode !== "function") return [];
    const presentationFields = [
      "semanticStage",
      "revealed",
      "peekOpen",
      "lensOpen",
      "lensOpenedAt",
      "surfaceOpenedAt",
      "pinned",
      "pinnedAt",
      "manualPosition",
      "layoutIdentity",
      "isPrimary",
      "depthIndex",
      "__clusterLevel"
    ];
    return items.flatMap((item) => {
      if (!item || item.kind !== "node" || !item.node || item.node.isWorkspaceNode !== true) return [item];
      const identity = remapIdentity({
        path: item.ownerPath || item.node.workspacePath,
        id: item.node.id
      }, transitions);
      const node = identity && resolveNode(identity);
      if (!node) return [];
      presentationFields.forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(item.node, field)) node[field] = item.node[field];
      });
      node.__clusterOwnerPath = identity.path;
      return [{ ...item, node, ownerPath: identity.path }];
    });
  }

  function edgeIdentity(edge) {
    if (!edge || !edge.from || !edge.to) return "";
    if (typeof edge.id === "string" && edge.id.trim()) return edge.id.trim();
    return `relation:${edge.from.key}->${edge.to.key}`;
  }

  function sanitizeAttachment(attachment) {
    if (!attachment || typeof attachment !== "object") return null;
    const name = safeText(attachment.name, "", 240).trim();
    if (!name) return null;
    return {
      name,
      type: safeText(attachment.type, "application/octet-stream", 160),
      size: Math.max(0, Number(attachment.size) || 0),
      url: typeof attachment.url === "string" ? attachment.url : ""
    };
  }

  function cleanPosition(position) {
    return {
      x: Number(position && position.x) || 0,
      y: Number(position && position.y) || 0,
      z: Number(position && position.z) || 0
    };
  }

  function sanitizeAliases(aliases, currentKey = "") {
    if (!Array.isArray(aliases)) return [];
    return [...new Set(aliases
      .map((alias) => safeText(alias, "", 1024).trim())
      .filter((alias) => alias && alias.includes("::") && alias !== currentKey))];
  }

  function sanitizeAtomTypes(types) {
    if (!Array.isArray(types)) return [];
    return [...new Set(types
      .map((type) => safeText(type, "", 80).trim())
      .filter((type) => type && !type.includes("@")))];
  }

  function sanitizeLockState(lockState) {
    if (!lockState || typeof lockState !== "object" || Array.isArray(lockState)) return null;
    const cleanFields = (value) => Array.isArray(value)
      ? [...new Set(value.map((field) => safeText(field, "", 32).trim()).filter(Boolean))]
      : [];
    const reasons = Array.isArray(lockState.reasons)
      ? lockState.reasons.map((reason) => ({
        code: safeText(reason && reason.code, "PROGRAM_LOCK", 80),
        message: safeText(reason && reason.message, "该内容已锁定", 400)
      }))
      : [];
    const sources = Array.isArray(lockState.sources)
      ? lockState.sources.map((source) => safeText(source, "", 512).trim()).filter(Boolean)
      : [];
    return {
      path: safeText(lockState.path, "", 1024),
      readFields: cleanFields(lockState.readFields),
      writeFields: cleanFields(lockState.writeFields),
      reasons,
      sources
    };
  }

  function createWorkspace() {
    const addedNodes = new Map();
    const nodePatches = new Map();
    const deletedNodes = new Set();
    const addedEdges = new Map();
    const removedEdges = new Set();
    const projectedViews = new Map();
    let active = null;
    let nodeSequence = 0;
    let authoritativeKnowledge = false;

    function nodeKey(path, id) {
      return `${path || "root"}::${id}`;
    }

    function findAddedNodeEntry(key) {
      for (const [currentKey, node] of addedNodes.entries()) {
        if (currentKey === key || sanitizeAliases(node.aliases, currentKey).includes(key)) {
          return { key: currentKey, node };
        }
      }
      return null;
    }

    function activeLandingEntry(key) {
      if (!active || active.kind !== "node-land" || !active.draft) return null;
      if (active.oldKey === key || active.newKey === key || active.draft.aliases.includes(key)) {
        return { key: active.newKey, node: active.draft, target: active.target };
      }
      return null;
    }

    function endpointEntry(key) {
      return activeLandingEntry(key) || findAddedNodeEntry(key);
    }

    function nodeSnapshot(node, endpoint) {
      const id = safeText(node && node.id, endpoint && endpoint.nodeId, 256);
      const sourcePath = safeText(endpoint && endpoint.path, "root", 512) || "root";
      const currentKey = nodeKey(sourcePath, id);
      const detailMode = normalizedDetailMode(node);
      return {
        id,
        nodeId: safeText(node && node.nodeId, id, 256) || id,
        bossId: safeText(node && node.bossId, "", 256) || null,
        leaderId: node && node.leaderId === null
          ? null
          : safeText(node && node.leaderId, "", 256) || null,
        label: safeText(node && node.label, endpoint && endpoint.label, MAX_LABEL_LENGTH) || "未命名节点",
        short: safeText(node && node.short, "", 32) || `K${id.slice(-4).toUpperCase()}`,
        description: safeText(node && (node.description ?? node.detail)),
        attachment: sanitizeAttachment(node && node.attachment),
        position: cleanPosition(node && (node.manualPosition || node.position)),
        clusterLocalPositionLocked: node && node.clusterLocalPositionLocked === true,
        radius: Math.max(0.4, Number(node && node.radius) || 0.82),
        hasChildren: node && node.hasChildren === true,
        surfaceVisible: detailMode === "surface",
        detailMode,
        visualLinks: [],
        satellites: [],
        aliases: sanitizeAliases(node && node.aliases, currentKey),
        atomTypes: sanitizeAtomTypes(node && node.atomTypes),
        lockState: sanitizeLockState(node && node.lockState),
        workspacePath: sourcePath,
        isWorkspaceNode: true
      };
    }

    function projectedNode(path, node) {
      if (!node) return null;
      const key = nodeKey(path, node.id);
      if (deletedNodes.has(key)) return null;
      if (active && active.kind === "node-land" && active.oldKey === key) return null;
      const relocated = endpointEntry(key);
      if (relocated && relocated.key !== key) return null;
      let patch = nodePatches.get(key) || null;
      if (active && active.nodeKey === key && active.status !== "delete") {
        patch = { ...(patch || {}), ...(active.draft || {}) };
      }
      if (!patch) return node;
      const view = projectedViews.get(key) || {};
      Object.assign(view, node, patch);
      projectedViews.set(key, view);
      return view;
    }

    function projectDomain(path, baseNodes) {
      const projected = (authoritativeKnowledge ? [] : Array.isArray(baseNodes) ? baseNodes : [])
        .filter((node) => !addedNodes.has(nodeKey(path, node && node.id)))
        .map((node) => projectedNode(path, node))
        .filter(Boolean);
      for (const [key, node] of addedNodes.entries()) {
        if (
          node.workspacePath === path
          && !deletedNodes.has(nodeKey(path, node.id))
          && !(active && active.kind === "node-land" && active.oldKey === key)
        ) {
          projected.push(projectedNode(path, node));
        }
      }
      if (active && active.kind === "node-create" && active.path === path) {
        projected.push(active.draft);
      }
      if (active && active.kind === "node-land" && active.target.path === path) {
        projected.push(active.draft);
      }
      return projected;
    }

    function beginNodeCreate(path, seed = {}) {
      if (active) return null;
      nodeSequence += 1;
      const id = `workspace-node-${nodeSequence}`;
      const detailMode = normalizedDetailMode(seed);
      const draft = {
        id,
        nodeId: safeText(seed.nodeId, id, 256) || id,
        bossId: safeText(seed.bossId, "", 256) || null,
        leaderId: seed.leaderId === null ? null : safeText(seed.leaderId, "", 256) || null,
        label: safeText(seed.label, "未命名节点", MAX_LABEL_LENGTH) || "未命名节点",
        short: `N${String(nodeSequence).padStart(2, "0")}`,
        description: safeText(seed.description, ""),
        atomTypes: sanitizeAtomTypes(seed.atomTypes),
        attachment: sanitizeAttachment(seed.attachment),
        position: {
          x: Number(seed.position && seed.position.x) || 0,
          y: Number(seed.position && seed.position.y) || 0,
          z: Number(seed.position && seed.position.z) || 0
        },
        clusterLocalPositionLocked: seed.clusterLocalPositionLocked === true,
        radius: Math.max(0.4, Number(seed.radius) || 0.82),
        hasChildren: false,
        surfaceVisible: detailMode === "surface",
        detailMode,
        visualLinks: [],
        satellites: [],
        workspacePath: path,
        isWorkspaceNode: true
      };
      active = {
        kind: "node-create",
        status: "update",
        path,
        nodeKey: nodeKey(path, id),
        draft
      };
      return draft;
    }

    function beginNodeEdit(path, node) {
      if (active || !node) return null;
      const key = nodeKey(path, node.id);
      const projected = projectedNode(path, node) || node;
      active = {
        kind: "node-edit",
        status: "update",
        atomTypesChanged: false,
        path,
        nodeKey: key,
        node,
        draft: {
          label: safeText(projected.label, "未命名节点", MAX_LABEL_LENGTH),
          description: safeText(projected.description),
          atomTypes: sanitizeAtomTypes(projected.atomTypes),
          attachment: sanitizeAttachment(projected.attachment)
        }
      };
      return active.draft;
    }

    function updateNodeDraft(patch) {
      if (!active || !["node-create", "node-edit"].includes(active.kind)) return false;
      const source = patch && typeof patch === "object" ? patch : {};
      if (Object.prototype.hasOwnProperty.call(source, "label")) {
        active.draft.label = safeText(source.label, "", MAX_LABEL_LENGTH);
      }
      if (Object.prototype.hasOwnProperty.call(source, "description")) {
        active.draft.description = safeText(source.description);
      }
      if (Object.prototype.hasOwnProperty.call(source, "atomTypes")) {
        active.draft.atomTypes = sanitizeAtomTypes(source.atomTypes).slice(0, 1);
        if (source.atomTypesChanged === true) active.atomTypesChanged = true;
      }
      if (Object.prototype.hasOwnProperty.call(source, "attachment")) {
        active.draft.attachment = sanitizeAttachment(source.attachment);
      }
      return true;
    }

    function beginEdgeCreate(source, sourceNode = null) {
      if (active || !source || !source.key) return null;
      active = {
        kind: "edge-create",
        status: "update",
        source: { ...source },
        sourceNode: nodeSnapshot(sourceNode, source),
        target: null
      };
      return active;
    }

    function setEdgeTarget(target) {
      if (!active || active.kind !== "edge-create" || !target || !target.key) return false;
      if (target.key === active.source.key) return false;
      active.target = { ...target };
      return true;
    }

    function setNodeLanding(target) {
      if (!active || active.kind !== "edge-create" || active.target || !target || !target.path) return false;
      const targetPath = safeText(target.path, "root", 512) || "root";
      const sourceEntry = findAddedNodeEntry(active.source.key);
      const oldKey = sourceEntry ? sourceEntry.key : active.source.key;
      const sourceNode = sourceEntry
        ? { ...sourceEntry.node, position: cleanPosition(sourceEntry.node.position) }
        : active.sourceNode;
      const newKey = nodeKey(targetPath, active.source.nodeId);
      const collision = findAddedNodeEntry(newKey);
      if (collision && collision.key !== oldKey) return false;
      const aliases = sanitizeAliases([
        ...(sourceNode.aliases || []),
        oldKey,
        active.source.key
      ], newKey);
      active = {
        ...active,
        kind: "node-land",
        oldKey,
        newKey,
        target: {
          path: targetPath,
          pathLabels: Array.isArray(target.pathLabels)
            ? target.pathLabels.map((item) => safeText(item, "", MAX_LABEL_LENGTH)).filter(Boolean)
            : [],
          position: cleanPosition(target.position)
        },
        draft: {
          ...sourceNode,
          position: cleanPosition(target.position),
          aliases,
          workspacePath: targetPath,
          isWorkspaceNode: true
        }
      };
      return true;
    }

    function beginEdgeEdit(edge) {
      if (active || !edge || !edge.from || !edge.to) return null;
      active = {
        kind: "edge-edit",
        status: "update",
        edge: {
          ...edge,
          id: edgeIdentity(edge),
          from: { ...edge.from },
          to: { ...edge.to }
        }
      };
      return active;
    }

    function updateEdgeDraft(patch) {
      if (!active || active.kind !== "edge-edit" || active.status === "delete") return false;
      const source = patch && typeof patch === "object" ? patch : {};
      if (Object.prototype.hasOwnProperty.call(source, "label")) {
        active.edge.label = safeText(source.label, "关联", MAX_LABEL_LENGTH) || "关联";
      }
      return true;
    }

    function markDelete() {
      if (!active || active.kind === "edge-create" || active.kind === "node-land") return false;
      active.status = "delete";
      return true;
    }

    function nodeVisualState(path, id) {
      const key = nodeKey(path, id);
      if (active && active.kind === "node-land" && active.newKey === key) return active.status;
      if (active && active.nodeKey === key) return active.status;
      return "idle";
    }

    function edgeMatchesActive(edge) {
      if (!active) return false;
      if (active.kind === "edge-edit") return edgeIdentity(active.edge) === edgeIdentity(edge);
      if (active.kind !== "edge-create" || !active.target) return false;
      return edgeIdentity({ from: active.source, to: active.target }) === edgeIdentity(edge);
    }

    function edgeVisualState(edge) {
      return edgeMatchesActive(edge) ? active.status : "idle";
    }

    function removeEdgesForNode(key) {
      for (const [id, edge] of addedEdges.entries()) {
        if (edge.from.key === key || edge.to.key === key) addedEdges.delete(id);
      }
    }

    function discardAddedNode(keyInput) {
      if (active) return false;
      const requestedKey = safeText(keyInput, "", 1024).trim();
      const entry = findAddedNodeEntry(requestedKey);
      if (!entry) return false;
      const ownedKeys = new Set([
        entry.key,
        ...sanitizeAliases(entry.node.aliases, entry.key)
      ]);
      addedNodes.delete(entry.key);
      ownedKeys.forEach((key) => {
        nodePatches.delete(key);
        projectedViews.delete(key);
        removeEdgesForNode(key);
      });
      return true;
    }

    function commit() {
      if (!active) return null;
      const operation = active;
      if (active.kind === "node-create") {
        if (active.status === "delete") {
          active = null;
          return { ...operation, cancelledCreate: true };
        }
        active.draft.label = active.draft.label.trim() || "未命名节点";
        addedNodes.set(active.nodeKey, active.draft);
      } else if (active.kind === "node-edit") {
        if (active.status === "delete") {
          deletedNodes.add(active.nodeKey);
          addedNodes.delete(active.nodeKey);
          nodePatches.delete(active.nodeKey);
          removeEdgesForNode(active.nodeKey);
        } else {
          active.draft.label = active.draft.label.trim() || "未命名节点";
          if (addedNodes.has(active.nodeKey)) {
            Object.assign(addedNodes.get(active.nodeKey), active.draft);
          } else {
            nodePatches.set(active.nodeKey, { ...active.draft });
          }
        }
      } else if (active.kind === "node-land") {
        const collision = findAddedNodeEntry(active.newKey);
        if (collision && collision.key !== active.oldKey) return null;
        addedNodes.delete(active.oldKey);
        nodePatches.delete(active.oldKey);
        deletedNodes.delete(active.oldKey);
        addedNodes.set(active.newKey, active.draft);
        active = null;
        return {
          ...operation,
          oldKey: operation.oldKey,
          newKey: operation.newKey,
          draft: operation.draft
        };
      } else if (active.kind === "edge-create" && active.target) {
        const edge = {
          from: { ...active.source },
          to: { ...active.target },
          label: "关联",
          crossDomain: active.source.path !== active.target.path
        };
        edge.id = edgeIdentity(edge);
        addedEdges.set(edge.id, edge);
      } else if (active.kind === "edge-edit" && active.status === "delete") {
        const id = edgeIdentity(active.edge);
        if (addedEdges.has(id)) addedEdges.delete(id);
        else removedEdges.add(id);
      } else if (active.kind === "edge-edit") {
        const id = edgeIdentity(active.edge);
        if (addedEdges.has(id)) {
          Object.assign(addedEdges.get(id), active.edge, { id });
        }
      } else if (active.kind === "edge-create") {
        return null;
      }
      active = null;
      return operation;
    }

    function cancel() {
      if (!active) return false;
      active = null;
      return true;
    }

    function isEdgeSuppressed(edge) {
      if (!edge) return false;
      return removedEdges.has(edgeIdentity(edge))
        || deletedNodes.has(edge.from && edge.from.key)
        || deletedNodes.has(edge.to && edge.to.key);
    }

    function edgesForPath(path) {
      return [...addedEdges.values()].filter((edge) => (
        !isEdgeSuppressed(edge)
        && (resolveEndpoint(edge.from).path === path || resolveEndpoint(edge.to).path === path)
      ));
    }

    function resolveEndpoint(endpoint) {
      if (!endpoint || !endpoint.key) return endpoint;
      const entry = endpointEntry(endpoint.key);
      if (!entry) return { ...endpoint };
      const currentPath = entry.node.workspacePath || entry.key.slice(0, entry.key.lastIndexOf("::"));
      return {
        ...endpoint,
        key: entry.key,
        path: currentPath,
        nodeId: entry.node.id,
        label: entry.node.label || endpoint.label,
        pathLabels: entry.target && entry.target.pathLabels.length
          ? [...entry.target.pathLabels]
          : endpoint.pathLabels
      };
    }

    function relationshipPairsForPath(path) {
      return [...addedEdges.values()]
        .map((edge) => ({ edge, from: resolveEndpoint(edge.from), to: resolveEndpoint(edge.to) }))
        .filter(({ edge, from, to }) => (
          !isEdgeSuppressed(edge)
          && from.path === path
          && to.path === path
        ))
        .map(({ edge, from, to }) => ({
          fromId: from.nodeId,
          toId: to.nodeId,
          kind: "association",
          label: edge.label || "关联"
        }));
    }

    function transaction() {
      return active;
    }

    function snapshot() {
      return {
        transaction: active,
        addedNodes: [...addedNodes.values()],
        editedNodeKeys: [...nodePatches.keys()],
        deletedNodeKeys: [...deletedNodes],
        edges: [...addedEdges.values()],
        removedEdgeIds: [...removedEdges]
      };
    }

    function exportKnowledge() {
      return {
        nodes: [...addedNodes.entries()].map(([key, node]) => {
          const path = node.workspacePath || key.slice(0, key.lastIndexOf("::"));
          return {
            id: safeText(node.id, "", 256),
            nodeId: safeText(node.nodeId, node.id, 256) || safeText(node.id, "", 256),
            bossId: safeText(node.bossId, "", 256) || null,
            leaderId: node.leaderId === null ? null : safeText(node.leaderId, "", 256) || null,
            key,
            path,
            atomPath: safeText(node.atomPath, "", 4000),
            label: safeText(node.label, "未命名节点", MAX_LABEL_LENGTH) || "未命名节点",
            short: safeText(node.short, "", 32),
            detail: safeText(node.description),
            attachment: sanitizeAttachment(node.attachment),
            position: {
              x: Number(node.position && node.position.x) || 0,
              y: Number(node.position && node.position.y) || 0,
              z: Number(node.position && node.position.z) || 0
            },
            clusterLocalPositionLocked: node.clusterLocalPositionLocked === true,
            radius: Math.max(0.4, Number(node.radius) || 0.82),
            carrier: "tunnel",
            hasChildren: node.hasChildren === true,
            surfaceVisible: normalizedDetailMode(node) === "surface",
            detailMode: normalizedDetailMode(node),
            aliases: sanitizeAliases(node.aliases, key),
            atomTypes: sanitizeAtomTypes(node.atomTypes),
            lockState: sanitizeLockState(node.lockState)
          };
        }),
        nodePatches: [...nodePatches.entries()].map(([key, patch]) => ({ key, patch: { ...patch } })),
        deletedNodeKeys: [...deletedNodes],
        edges: [...addedEdges.values()].map((edge) => ({
          ...edge,
          from: { ...edge.from },
          to: { ...edge.to }
        })),
        removedEdgeIds: [...removedEdges]
      };
    }

    function importKnowledge(knowledge) {
      if (active || !knowledge || typeof knowledge !== "object") return false;
      authoritativeKnowledge = true;
      addedNodes.clear();
      nodePatches.clear();
      deletedNodes.clear();
      addedEdges.clear();
      removedEdges.clear();
      projectedViews.clear();

      const nodes = Array.isArray(knowledge.nodes) ? knowledge.nodes : [];
      nodes.forEach((source) => {
        if (!source || typeof source !== "object") return;
        const path = safeText(source.path || source.workspacePath, "root", 512) || "root";
        const id = safeText(source.id, "", 256);
        if (!id) return;
        const key = nodeKey(path, id);
        const match = id.match(/^workspace-node-(\d+)$/);
        if (match) nodeSequence = Math.max(nodeSequence, Number(match[1]) || 0);
        const detailMode = normalizedDetailMode(source);
        addedNodes.set(key, {
          id,
          nodeId: safeText(source.nodeId, id, 256) || id,
          bossId: safeText(source.bossId, "", 256) || null,
          leaderId: source.leaderId === null ? null : safeText(source.leaderId, "", 256) || null,
          label: safeText(source.label, "未命名节点", MAX_LABEL_LENGTH) || "未命名节点",
          short: safeText(source.short, "", 32) || `K${id.slice(-4).toUpperCase()}`,
          description: safeText(source.detail ?? source.description),
          attachment: sanitizeAttachment(source.attachment),
          position: {
            x: Number(source.position && source.position.x) || 0,
            y: Number(source.position && source.position.y) || 0,
            z: Number(source.position && source.position.z) || 0
          },
          clusterLocalPositionLocked: source.clusterLocalPositionLocked === true,
          radius: Math.max(0.4, Number(source.radius) || 0.82),
          hasChildren: source.hasChildren === true,
          surfaceVisible: detailMode === "surface",
          detailMode,
          visualLinks: [],
          satellites: [],
          aliases: sanitizeAliases(source.aliases, key),
          atomTypes: sanitizeAtomTypes(source.atomTypes),
          atomPath: safeText(source.atomPath, "", 4000),
          lockState: sanitizeLockState(source.lockState),
          workspacePath: path,
          isWorkspaceNode: true
        });
      });

      const patches = Array.isArray(knowledge.nodePatches) ? knowledge.nodePatches : [];
      patches.forEach((entry) => {
        if (!entry || typeof entry.key !== "string" || !entry.patch) return;
        nodePatches.set(entry.key, {
          label: safeText(entry.patch.label, "", MAX_LABEL_LENGTH),
          description: safeText(entry.patch.description ?? entry.patch.detail),
          atomTypes: sanitizeAtomTypes(entry.patch.atomTypes),
          attachment: sanitizeAttachment(entry.patch.attachment)
        });
      });
      (Array.isArray(knowledge.deletedNodeKeys) ? knowledge.deletedNodeKeys : [])
        .filter((key) => typeof key === "string")
        .forEach((key) => deletedNodes.add(key));
      (Array.isArray(knowledge.edges) ? knowledge.edges : []).forEach((edge) => {
        if (!edge || !edge.from || !edge.to || !edge.from.key || !edge.to.key) return;
        const imported = {
          ...edge,
          from: { ...edge.from },
          to: { ...edge.to },
          crossDomain: edge.from.path !== edge.to.path
        };
        imported.id = edgeIdentity(imported);
        addedEdges.set(imported.id, imported);
      });
      (Array.isArray(knowledge.removedEdgeIds) ? knowledge.removedEdgeIds : [])
        .filter((id) => typeof id === "string")
        .forEach((id) => removedEdges.add(id));
      return true;
    }

    return Object.freeze({
      beginNodeCreate,
      beginNodeEdit,
      updateNodeDraft,
      beginEdgeCreate,
      setEdgeTarget,
      setNodeLanding,
      beginEdgeEdit,
      updateEdgeDraft,
      markDelete,
      discardAddedNode,
      commit,
      cancel,
      transaction,
      projectNode: projectedNode,
      projectDomain,
      nodeVisualState,
      edgeVisualState,
      isEdgeSuppressed,
      edgesForPath,
      resolveEndpoint,
      relationshipPairsForPath,
      snapshot,
      exportKnowledge,
      importKnowledge
    });
  }

  global.SpatialWorkspaceModel = Object.freeze({
    createWorkspace,
    edgeIdentity,
    highlightSegments,
    normalizeQuery,
    persistedLandingNode,
    operationIdentityTransitions,
    remapIdentity,
    reconcileVisualItems,
    qualifiedEndpoint,
    searchEntries
  });
})(window);
