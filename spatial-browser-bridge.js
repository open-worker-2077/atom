(function spatialBrowserBridge(global) {
  "use strict";

  const lab = global.spatialLab;
  const LOCAL_STORAGE_KEY = "spatial-kb:knowledge:v1";
  let localStorage = null;
  if (global.location.protocol === "file:" && lab) {
    try {
      localStorage = global.localStorage;
    } catch (error) {
      localStorage = null;
    }
  }
  const localFile = Boolean(localStorage);
  const supported = ["http:", "https:"].includes(global.location.protocol) && lab;
  document.body.dataset.spatialBridge = localFile ? "local" : supported ? "connecting" : "standalone";

  if (localFile) {
    function restoreLocalKnowledge() {
      try {
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (saved) lab.importKnowledge(JSON.parse(saved));
        document.body.dataset.spatialBridge = "local";
      } catch (error) {
        document.body.dataset.spatialBridge = "local-error";
      }
    }

    function saveLocalKnowledge(event) {
      if (!event || !event.detail || !event.detail.knowledge) return false;
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(event.detail.knowledge));
        document.body.dataset.spatialBridge = "local";
        return true;
      } catch (error) {
        document.body.dataset.spatialBridge = "local-error";
        return false;
      }
    }

    global.addEventListener("spatial-workspace-committed", saveLocalKnowledge);
    restoreLocalKnowledge();
    return;
  }

  if (!supported) return;

  const API = "/__spatial/api";
  const initialLoadProgress = { service: 0, data: 0, scene: 0 };
  let revision = -1;
  let pulling = false;
  let pullCompletion = Promise.resolve();
  let pushing = false;
  const queuedCommits = [];
  let bossMode = false;
  let atomWorkspace = false;
  let lastKnowledge = null;
  let pendingRemoteRevision = -1;
  let workspaceOperationEpoch = 0;
  const loadedPaths = new Set();
  const workspaceModel = global.SpatialWorkspaceModel;

  function setInitialLoadProgress(stage, value) {
    if (!(stage in initialLoadProgress)) return;
    initialLoadProgress[stage] = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    const stageName = stage[0].toUpperCase() + stage.slice(1);
    const progressElement = typeof document.getElementById === "function"
      ? document.getElementById(`spatialProgress${stageName}`)
      : null;
    const valueElement = typeof document.getElementById === "function"
      ? document.getElementById(`spatialProgress${stageName}Value`)
      : null;
    if (progressElement) progressElement.value = initialLoadProgress[stage];
    if (valueElement) valueElement.textContent = `${initialLoadProgress[stage]}%`;
    const overall = Math.round((
      initialLoadProgress.service + initialLoadProgress.data + initialLoadProgress.scene
    ) / 3);
    const overallProgress = typeof document.getElementById === "function"
      ? document.getElementById("spatialProgressOverall")
      : null;
    const overallValue = typeof document.getElementById === "function"
      ? document.getElementById("spatialProgressOverallValue")
      : null;
    if (overallProgress) overallProgress.value = overall;
    if (overallValue) overallValue.textContent = `${overall}%`;
  }

  function nextVisualFrame() {
    if (typeof global.requestAnimationFrame !== "function") return Promise.resolve();
    return new Promise((resolve) => global.requestAnimationFrame(resolve));
  }

  setInitialLoadProgress("service", 10);

  function itemIdentity(item, fallback) {
    if (!item || typeof item !== "object") return fallback;
    return item.key || item.id || fallback;
  }

  function mergeScopedKnowledge(previous, incoming) {
    if (!previous) return incoming;
    const mergeItems = (left, right) => [...new Map([
      ...(Array.isArray(left) ? left : []),
      ...(Array.isArray(right) ? right : [])
    ].map((item, index) => [itemIdentity(item, index), item])).values()];
    return {
      ...previous,
      ...incoming,
      nodes: mergeItems(previous.nodes, incoming.nodes),
      nodePatches: mergeItems(previous.nodePatches, incoming.nodePatches),
      deletedNodeKeys: [...new Set([
        ...(Array.isArray(previous.deletedNodeKeys) ? previous.deletedNodeKeys : []),
        ...(Array.isArray(incoming.deletedNodeKeys) ? incoming.deletedNodeKeys : [])
      ])],
      edges: mergeItems(previous.edges, incoming.edges),
      removedEdgeIds: [...new Set([
        ...(Array.isArray(previous.removedEdgeIds) ? previous.removedEdgeIds : []),
        ...(Array.isArray(incoming.removedEdgeIds) ? incoming.removedEdgeIds : [])
      ])]
    };
  }

  function hasQueuedWorkspaceCommit() {
    return queuedCommits.some((entry) => entry && entry.kind === "workspace");
  }

  function reconcileCreatedNode(operation, knowledge, previousKnowledge) {
    if (!operation || operation.kind !== "node-create" || !knowledge) return null;
    const priorKeys = new Set(((previousKnowledge && previousKnowledge.nodes) || [])
      .map((node) => node && node.key)
      .filter(Boolean));
    const label = operation.draft && operation.draft.label;
    const candidates = (Array.isArray(knowledge.nodes) ? knowledge.nodes : [])
      .filter((node) => node && node.label === label && !priorKeys.has(node.key));
    if (candidates.length !== 1) return null;
    const persistedNode = candidates[0];
    if (persistedNode.path === operation.path && operation.draft && operation.draft.position) {
      persistedNode.position = { ...operation.draft.position };
      persistedNode.clusterLocalPositionLocked = operation.draft.clusterLocalPositionLocked === true;
    }
    return persistedNode;
  }

  function reconcileEditedNode(operation, knowledge, previousKnowledge) {
    if (!operation || operation.kind !== "node-edit" || operation.status === "delete" || !knowledge) return null;
    const priorNodes = Array.isArray(previousKnowledge && previousKnowledge.nodes)
      ? previousKnowledge.nodes
      : [];
    const operationNode = operation.node && typeof operation.node === "object" ? operation.node : null;
    const priorNode = priorNodes.find((node) => (
      node && (
        node.key === operation.nodeKey
        || (operationNode && node.key === operationNode.key)
        || (operationNode && operationNode.atomPath && node.atomPath === operationNode.atomPath)
      )
    )) || operationNode;
    const label = operation.draft && operation.draft.label;
    const priorAtomPath = priorNode && priorNode.atomPath;
    const parentAtomPath = typeof priorAtomPath === "string" && priorAtomPath.includes("/")
      ? priorAtomPath.slice(0, priorAtomPath.lastIndexOf("/"))
      : "";
    const expectedAtomPath = label
      ? (parentAtomPath ? `${parentAtomPath}/${label}` : label)
      : "";
    const candidates = (Array.isArray(knowledge.nodes) ? knowledge.nodes : []).filter((node) => (
      node
      && node.label === label
      && (
        (expectedAtomPath && node.atomPath === expectedAtomPath)
        || (!expectedAtomPath && node.path === operation.path)
      )
    ));
    if (candidates.length !== 1) return null;
    const persistedNode = candidates[0];
    if (priorNode && priorNode.position) persistedNode.position = { ...priorNode.position };
    persistedNode.clusterLocalPositionLocked = priorNode && priorNode.clusterLocalPositionLocked === true;
    return persistedNode;
  }

  function importOperationKnowledge(knowledge, operation, previousKnowledge, persistedNode) {
    const identityTransitions = workspaceModel
      && typeof workspaceModel.operationIdentityTransitions === "function"
      ? workspaceModel.operationIdentityTransitions(
          operation,
          knowledge,
          previousKnowledge,
          persistedNode
        )
      : [];
    return lab.importKnowledge(knowledge, { identityTransitions });
  }

  function reportPersistence(type, detail = {}) {
    if (!Number.isFinite(Number(detail.persistenceId)) || typeof global.dispatchEvent !== "function") return;
    const EventConstructor = global.CustomEvent;
    if (typeof EventConstructor !== "function") return;
    global.dispatchEvent(new EventConstructor(type, { detail }));
  }

  function reportPendingProjection(payload, persistenceId, operation) {
    if (payload && payload.result && payload.result.projectionStatus === "pending") {
      document.body.dataset.spatialBridge = "degraded";
      reportPersistence("spatial-workspace-projection-pending", {
        persistenceId,
        operation,
        projectionRecovery: payload.result.projectionRecovery,
        projectionFailure: payload.result.projectionFailure
      });
      return true;
    }
    return false;
  }

  async function request(path, options) {
    const response = await global.fetch(`${API}${path}`, {
      cache: "no-store",
      headers: { "content-type": "application/json" },
      ...options
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error && payload.error.message || "Spatial bridge request failed");
      error.code = payload.error && payload.error.code;
      throw error;
    }
    return payload;
  }

  async function pullKnowledge(requestedPath = lab.state().path || "root", options = {}) {
    const allowDuringTransaction = options.allowDuringTransaction === true;
    if (pulling) {
      await pullCompletion;
      return pullKnowledge(requestedPath, options);
    }
    if (pushing || (lab.state().transactionActive && !allowDuringTransaction)) return false;
    let completePull;
    pullCompletion = new Promise((resolve) => { completePull = resolve; });
    pulling = true;
    const pullOperationEpoch = workspaceOperationEpoch;
    const initialLoad = document.body.dataset.spatialKnowledge !== "authoritative";
    try {
      const normalizedPath = typeof requestedPath === "string" && requestedPath.trim()
        ? requestedPath.trim()
        : "root";
      if (initialLoad) setInitialLoadProgress("data", 15);
      const payload = await request(`/state?path=${encodeURIComponent(normalizedPath)}`);
      if (initialLoad) {
        setInitialLoadProgress("service", 100);
        setInitialLoadProgress("data", 75);
      }
      const incoming = payload.knowledge;
      const scopedPath = payload.scope && payload.scope.path;
      if (
        pullOperationEpoch !== workspaceOperationEpoch
        || pushing
        || hasQueuedWorkspaceCommit()
        || (lab.state().transactionActive && !allowDuringTransaction)
      ) {
        return false;
      }
      const incomingRevision = Number(incoming && incoming.revision) || 0;
      const newerRevision = incomingRevision > revision;
      const unseenScope = scopedPath && !loadedPaths.has(scopedPath);
      if (incoming && (newerRevision || unseenScope || !lastKnowledge)) {
        if (newerRevision && scopedPath) {
          loadedPaths.clear();
          lastKnowledge = null;
        }
        const knowledge = scopedPath ? mergeScopedKnowledge(lastKnowledge, incoming) : incoming;
        if (!lab.importKnowledge(knowledge, {
          preserveTransaction: allowDuringTransaction && lab.state().transactionActive === true
        })) return false;
        if (
          unseenScope
          && scopedPath === (lab.state().path || "root")
          && typeof lab.refitCurrentDomain === "function"
        ) {
          lab.refitCurrentDomain({ path: scopedPath, reason: "scope-loaded" });
        } else if (unseenScope && typeof lab.refreshLoadedDomain === "function") {
          lab.refreshLoadedDomain({ path: scopedPath, reason: "scope-loaded" });
        }
        if (initialLoad) {
          setInitialLoadProgress("data", 100);
          setInitialLoadProgress("scene", 70);
        }
        revision = incomingRevision;
        lastKnowledge = knowledge;
        if (scopedPath) loadedPaths.add(scopedPath);
        document.body.dataset.spatialKnowledge = "authoritative";
      }
      if (initialLoad) {
        await nextVisualFrame();
        setInitialLoadProgress("scene", 100);
      }
      document.body.dataset.spatialBridge = "connected";
      return true;
    } catch (error) {
      document.body.dataset.spatialBridge = "offline";
      return false;
    } finally {
      pulling = false;
      completePull();
    }
  }

  function activeBossId() {
    const knowledge = lab.exportKnowledge();
    const nodes = Array.isArray(knowledge && knowledge.nodes) ? knowledge.nodes : [];
    const current = lab.state();
    const selected = current.selected
      ? nodes.find((node) => (node.nodeId || node.id) === current.selected)
      : null;
    if (selected && selected.bossId) return selected.bossId;
    const inPath = [...new Set(nodes
      .filter((node) => node.path === current.path && node.bossId)
      .map((node) => node.bossId))];
    return inPath.length === 1 ? inPath[0] : null;
  }

  function recursiveDeleteConfirmations(nextKnowledge) {
    if (!bossMode || !lastKnowledge) return [];
    const prior = Array.isArray(lastKnowledge.nodes) ? lastKnowledge.nodes : [];
    const nextIds = new Set((Array.isArray(nextKnowledge.nodes) ? nextKnowledge.nodes : [])
      .map((node) => `${node.bossId}::${node.nodeId || node.id}`));
    const confirmed = [];
    for (const node of prior) {
      if (nextIds.has(`${node.bossId}::${node.nodeId || node.id}`)) continue;
      const descendants = new Set();
      let frontier = [node.nodeId || node.id];
      while (frontier.length) {
        const leaders = new Set(frontier);
        frontier = prior
          .filter((candidate) => (
            candidate.bossId === node.bossId
            && leaders.has(candidate.leaderId)
            && !descendants.has(candidate.nodeId || candidate.id)
          ))
          .map((candidate) => {
            const id = candidate.nodeId || candidate.id;
            descendants.add(id);
            return id;
          });
      }
      if (!descendants.size) continue;
      const accepted = global.confirm(
        `该 Leader 仍有 ${descendants.size} 个下级节点。确认后将删除整条分支，并可用 Z 撤销。`
      );
      if (!accepted) return null;
      confirmed.push(node.nodeId || node.id);
    }
    return confirmed;
  }

  async function pushKnowledge(event) {
    const knowledge = event && event.detail && event.detail.knowledge;
    const operation = event && event.detail && event.detail.operation;
    const persistenceId = event && event.detail && event.detail.persistenceId;
    if (!knowledge) return false;
    if (typeof operation === "string") {
      document.body.dataset.spatialBridge = "connected";
      return true;
    }
    if (atomWorkspace && !operation) {
      document.body.dataset.spatialBridge = "connected";
      return false;
    }
    if (operation && typeof operation === "object") workspaceOperationEpoch += 1;
    if (pushing) {
      queuedCommits.push({ kind: "workspace", knowledge, operation, persistenceId });
      return true;
    }
    pushing = true;
    try {
      if (operation && operation.kind === "node-create") {
        const previousKnowledge = lastKnowledge;
        const response = await global.fetch('/__atom/api/workspace-edit', {
          method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operation })
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false || payload.result?.ok === false) {
          throw new Error(payload.error?.message || payload.result?.errors?.[0]?.message || 'Atom workspace edit failed');
        }
        if (reportPendingProjection(payload, persistenceId, operation)) return true;
        const persistedNode = reconcileCreatedNode(operation, payload.knowledge, previousKnowledge);
        if (payload.knowledge) {
          lastKnowledge = payload.knowledge;
          revision = Number(payload.knowledge.revision) || revision;
          if (!hasQueuedWorkspaceCommit()) {
            importOperationKnowledge(payload.knowledge, operation, previousKnowledge, persistedNode);
          }
        }
        document.body.dataset.spatialBridge = "connected";
        reportPersistence("spatial-workspace-persisted", {
          persistenceId, operation, knowledge: payload.knowledge, persistedNode
        });
        return true;
      }
      const previousByKey = new Map(((lastKnowledge && lastKnowledge.nodes) || [])
        .map((node) => [node.key, node]));
      const statusChanges = (Array.isArray(knowledge.nodes) ? knowledge.nodes : [])
        .filter((node) => {
          const previous = previousByKey.get(node.key);
          return node.label === "状态"
            && previous && previous.detail !== node.detail;
        });
      if (statusChanges.length) {
        let latest = null;
        for (const node of statusChanges) {
          const response = await global.fetch('/__atom/api/human-status', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: node.key, atomPath: node.atomPath, detail: node.detail })
          });
          latest = await response.json();
          if (!response.ok || latest.ok === false || latest.result?.ok === false) {
            throw new Error(latest.error?.message || latest.result?.errors?.[0]?.message || 'Atom status update failed');
          }
        }
        if (reportPendingProjection(latest, persistenceId, operation)) return true;
        if (latest && latest.knowledge) {
          lastKnowledge = latest.knowledge;
          revision = Number(latest.knowledge.revision) || revision;
          if (!hasQueuedWorkspaceCommit()) lab.importKnowledge(latest.knowledge);
        }
        document.body.dataset.spatialBridge = "connected";
        return true;
      }
      if (operation) {
        const previousKnowledge = lastKnowledge;
        const response = await global.fetch('/__atom/api/workspace-edit', {
          method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ operation })
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false || payload.result?.ok === false) {
          throw new Error(payload.error?.message || payload.result?.errors?.[0]?.message || 'Atom workspace edit failed');
        }
        if (reportPendingProjection(payload, persistenceId, operation)) return true;
        if (operation.kind === "node-land-batch") {
          const expected = Array.isArray(operation.landings) ? operation.landings.length : 0;
          const persistedBatch = workspaceModel
            && typeof workspaceModel.persistedBatchLandingNodes === "function"
            ? workspaceModel.persistedBatchLandingNodes(operation, payload.knowledge)
            : [];
          if (!expected || persistedBatch.length !== expected) {
            throw new Error(`整批移动未完成：目标仅确认 ${persistedBatch.length}/${expected} 个节点，已恢复保存前状态`);
          }
        }
        const persistedNode = operation.kind === "node-land"
          && workspaceModel
          && typeof workspaceModel.persistedLandingNode === "function"
          ? workspaceModel.persistedLandingNode(operation, payload.knowledge)
          : reconcileEditedNode(operation, payload.knowledge, previousKnowledge);
        if (payload.knowledge) {
          lastKnowledge = payload.knowledge;
          revision = Number(payload.knowledge.revision) || revision;
          if (!hasQueuedWorkspaceCommit()) {
            importOperationKnowledge(payload.knowledge, operation, previousKnowledge, persistedNode);
          }
        }
        document.body.dataset.spatialBridge = "connected";
        reportPersistence("spatial-workspace-persisted", {
          persistenceId, operation, knowledge: payload.knowledge, persistedNode
        });
        return true;
      }
      const confirmedRecursiveDeleteNodeIds = recursiveDeleteConfirmations(knowledge);
      if (confirmedRecursiveDeleteNodeIds === null) {
        if (lastKnowledge) lab.importKnowledge(lastKnowledge);
        document.body.dataset.spatialBridge = "connected";
        return false;
      }
      const payload = await request("/state", {
        method: "PUT",
        body: JSON.stringify({
          expectedRevision: Math.max(0, revision),
          knowledge,
          confirmedRecursiveDeleteNodeIds
        })
      });
      revision = Number(payload.result && payload.result.revision) || revision;
      const persisted = payload.result && payload.result.knowledge;
      if (persisted) {
        const beforeKeys = JSON.stringify((knowledge.nodes || []).map((node) => node.key));
        const afterKeys = JSON.stringify((persisted.nodes || []).map((node) => node.key));
        lastKnowledge = persisted;
        if (beforeKeys !== afterKeys) lab.importKnowledge(persisted);
      } else {
        lastKnowledge = knowledge;
      }
      document.body.dataset.spatialBridge = "connected";
      return true;
    } catch (error) {
      document.body.dataset.spatialBridge = error.code === "REVISION_CONFLICT" ? "conflict" : "offline";
      if (lastKnowledge && !queuedCommits.length) lab.importKnowledge(lastKnowledge);
      reportPersistence("spatial-workspace-persist-failed", {
        persistenceId,
        operation,
        message: error && error.message || "Atom edit failed"
      });
      return false;
    } finally {
      pushing = false;
      if (queuedCommits.length) {
        const nextCommit = queuedCommits.shift();
        if (nextCommit.kind === "view") void pushView({ detail: nextCommit });
        else void pushKnowledge({ detail: nextCommit });
      } else void drainRemoteChanges();
    }
  }

  async function drainRemoteChanges() {
    if (pendingRemoteRevision <= revision || pulling || pushing || lab.state().transactionActive) return false;
    const requestedRevision = pendingRemoteRevision;
    const refreshed = await pullKnowledge();
    if (refreshed && revision >= requestedRevision) pendingRemoteRevision = -1;
    return refreshed;
  }

  async function pushView(event) {
    const view = event?.detail?.view ?? lab.exportField();
    if (!view || document.hidden) return false;
    if (pulling) {
      await pullCompletion;
      return pushView(event);
    }
    if (pushing) {
      queuedCommits.push({ kind: "view", view });
      return true;
    }
    const requiredPaths = [...new Set([
      view.path,
      ...(Array.isArray(view.expandedPaths) ? view.expandedPaths : [])
    ].filter((path) => typeof path === "string" && path.trim()))];
    for (const path of requiredPaths) {
      if (!loadedPaths.has(path)) {
        await pullKnowledge(path, { allowDuringTransaction: true });
      }
    }
    pushing = true;
    try {
      await request("/view", {
        method: "PUT",
        body: JSON.stringify({ view, bossId: bossMode ? activeBossId() : null })
      });
      document.body.dataset.spatialBridge = "connected";
      return true;
    } catch (error) {
      document.body.dataset.spatialBridge = "offline";
      return false;
    } finally {
      pushing = false;
      if (queuedCommits.length) {
        const nextCommit = queuedCommits.shift();
        if (nextCommit.kind === "view") void pushView({ detail: nextCommit });
        else void pushKnowledge({ detail: nextCommit });
      } else void drainRemoteChanges();
    }
  }

  async function navigateBossHistory(direction) {
    const bossId = activeBossId();
    if (!bossId || pushing || pulling || lab.state().transactionActive) return false;
    pushing = true;
    try {
      const payload = await request(`/boss/${direction}`, {
        method: "POST",
        body: JSON.stringify({ bossId })
      });
      if (payload.knowledge) {
        lab.importKnowledge(payload.knowledge);
        lastKnowledge = payload.knowledge;
        revision = Number(payload.knowledge.revision) || revision;
      }
      document.body.dataset.spatialBridge = "connected";
      return true;
    } catch (error) {
      document.body.dataset.spatialBridge = error.code === "NOTHING_TO_UNDO" || error.code === "NOTHING_TO_REDO"
        ? "connected"
        : "offline";
      return false;
    } finally {
      pushing = false;
    }
  }

  global.addEventListener("keydown", (event) => {
    if (!bossMode || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!["KeyZ", "KeyX"].includes(event.code)) return;
    const target = event.target;
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    if (!activeBossId()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void navigateBossHistory(event.code === "KeyZ" ? "undo" : "redo");
  }, true);

  global.addEventListener("spatial-workspace-committed", pushKnowledge);
  global.addEventListener("spatial-view-committed", pushView);
  if (typeof global.EventSource === "function") {
    const changes = new global.EventSource(`${API}/events`);
    changes.onopen = () => {
      if (document.body.dataset.spatialBridge === "offline") void pullKnowledge();
    };
    changes.onmessage = (event) => {
      try {
        const notice = JSON.parse(event.data);
        pendingRemoteRevision = Math.max(pendingRemoteRevision, Number(notice.revision) || -1);
        void drainRemoteChanges();
      } catch {
        document.body.dataset.spatialBridge = "offline";
      }
    };
  }
  request("/health")
    .then((payload) => {
      setInitialLoadProgress("service", 100);
      bossMode = payload.mode === "boss";
      atomWorkspace = payload.atomWorkspace === true;
      document.body.dataset.spatialStore = bossMode ? "boss" : "single";
    })
    .catch(() => {})
    .then(pullKnowledge);
})(window);
