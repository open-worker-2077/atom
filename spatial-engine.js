(function spatialLaboratory(global) {
  "use strict";

  const canvas = document.getElementById("spaceCanvas");
  const context = canvas.getContext("2d", { alpha: true });
  const input = global.SpatialInputConfig;
  const visualModel = global.SpatialVisualModel;
  const gestureArbiter = global.SpatialGestureArbiter;
  const middleFrameTarget = global.SpatialMiddleFrameTarget;
  const registry = global.SpatialEntityRegistry;
  const grammar = global.SpatialViewGrammar;
  const workspaceModel = global.SpatialWorkspaceModel;
  const clusterField = global.SpatialClusterField;
  const viewModeModel = global.SpatialViewModeModel;
  const helpPageModel = global.SpatialHelpPageModel;
  const demoModel = global.SpatialDemoModel;
  const demoGeometry = global.SpatialDemoGeometry;
  const detailMagnifierModel = global.SpatialDetailMagnifierModel;
  const sceneAdapter = global.AtomSpatialScene;

  if (!context || !input || !visualModel || !gestureArbiter || !middleFrameTarget || !registry || !grammar || !workspaceModel || !clusterField || !viewModeModel || !helpPageModel || !demoModel || !demoGeometry || !detailMagnifierModel || !sceneAdapter) {
    document.body.dataset.spatialUnavailable = "true";
    return;
  }

  const ui = {
    path: document.getElementById("fieldPath"),
    selectionLabel: document.getElementById("selectionLabel"),
    selectionCopy: document.getElementById("selectionCopy"),
    selectionCaps: document.getElementById("selectionCaps"),
    metricDepth: document.getElementById("metricDepth"),
    metricVisible: document.getElementById("metricVisible"),
    metricScale: document.getElementById("metricScale"),
    metricPhase: document.getElementById("metricPhase"),
    hint: document.getElementById("fieldHint"),
    mappingPanel: document.getElementById("mappingPanel"),
    helpPanel: document.getElementById("helpPanel"),
    mermaidPanel: document.getElementById("mermaidPanel"),
    searchPanel: document.getElementById("searchPanel"),
    spatialSearch: document.getElementById("spatialSearch"),
    searchResults: document.getElementById("searchResults"),
    nodeNameEditorWrap: document.getElementById("nodeNameEditorWrap"),
    nodeNameEditor: document.getElementById("nodeNameEditor"),
    nodeTypeEditor: document.getElementById("nodeTypeEditor"),
    edgeNameEditorWrap: document.getElementById("edgeNameEditorWrap"),
    edgeNameEditor: document.getElementById("edgeNameEditor"),
    lensEditor: document.getElementById("lensEditor"),
    nodeDetailEditor: document.getElementById("nodeDetailEditor"),
    nodeDetailEditorMount: document.getElementById("nodeDetailEditorMount"),
    nodeDetailPreview: document.getElementById("nodeDetailPreview"),
    nodeDetailModeToggle: document.getElementById("nodeDetailModeToggle"),
    nodeDetailLineBreak: document.getElementById("nodeDetailLineBreak"),
    surfaceMarkdownLayer: document.getElementById("surfaceMarkdownLayer"),
    detailMagnifier: document.getElementById("detailMagnifier"),
    detailMagnifierTitle: document.getElementById("detailMagnifierTitle"),
    detailMagnifierContent: document.getElementById("detailMagnifierContent"),
    detailMagnifierCursor: document.getElementById("detailMagnifierCursor"),
    attachmentInput: document.getElementById("attachmentInput"),
    attachmentMeta: document.getElementById("attachmentMeta"),
    editStatus: document.getElementById("editStatus"),
    bindingList: document.getElementById("bindingList"),
    demoIdleSeconds: document.getElementById("demoIdleSeconds"),
    helpStartupToggle: document.getElementById("helpStartupToggle"),
    zoomSpeed: document.getElementById("zoomSpeed"),
    zoomSpeedValue: document.getElementById("zoomSpeedValue"),
    relationshipLineWidth: document.getElementById("relationshipLineWidth"),
    relationshipLineWidthValue: document.getElementById("relationshipLineWidthValue"),
    relationshipBrightness: document.getElementById("relationshipBrightness"),
    relationshipBrightnessValue: document.getElementById("relationshipBrightnessValue"),
    middleLabelDepth: document.getElementById("middleLabelDepth"),
    middleLabelDepthValue: document.getElementById("middleLabelDepthValue"),
    highlightedLabelBrightness: document.getElementById("highlightedLabelBrightness"),
    highlightedLabelBrightnessValue: document.getElementById("highlightedLabelBrightnessValue"),
    otherLabelBrightness: document.getElementById("otherLabelBrightness"),
    otherLabelBrightnessValue: document.getElementById("otherLabelBrightnessValue"),
    middleDetailDepth: document.getElementById("middleDetailDepth"),
    middleDetailDepthValue: document.getElementById("middleDetailDepthValue"),
    highlightedDetailBrightness: document.getElementById("highlightedDetailBrightness"),
    highlightedDetailBrightnessValue: document.getElementById("highlightedDetailBrightnessValue"),
    otherDetailBrightness: document.getElementById("otherDetailBrightness"),
    otherDetailBrightnessValue: document.getElementById("otherDetailBrightnessValue"),
    floatingDetailBackdropOpacity: document.getElementById("floatingDetailBackdropOpacity"),
    floatingDetailBackdropOpacityValue: document.getElementById("floatingDetailBackdropOpacityValue"),
    nestedCompactness: document.getElementById("nestedCompactness"),
    nestedCompactnessValue: document.getElementById("nestedCompactnessValue"),
    peripheralDepthShrink: document.getElementById("peripheralDepthShrink"),
    peripheralDepthShrinkValue: document.getElementById("peripheralDepthShrinkValue"),
    nestedTunnelStrength: document.getElementById("nestedTunnelStrength"),
    nestedTunnelStrengthValue: document.getElementById("nestedTunnelStrengthValue"),
    nestedTunnelInteriorStrength: document.getElementById("nestedTunnelInteriorStrength"),
    nestedTunnelInteriorStrengthValue: document.getElementById("nestedTunnelInteriorStrengthValue"),
    demoTheme: document.getElementById("demoTheme"),
    demoThemeIndex: document.getElementById("demoThemeIndex"),
    demoThemeLabel: document.getElementById("demoThemeLabel"),
    demoCue: document.getElementById("demoCue"),
    demoCueKey: document.getElementById("demoCueKey"),
    demoCueLabel: document.getElementById("demoCueLabel"),
    ariaLive: document.getElementById("ariaLive"),
    viewBackAction: document.getElementById("viewBackAction"),
    viewForwardAction: document.getElementById("viewForwardAction"),
    exitAction: document.getElementById("exitAction"),
    worldLensAction: document.getElementById("worldLensAction")
  };

  const DEMO_SETTINGS_KEY = "graph-4d.presentation-settings.v2";
  const LEGACY_DEMO_SETTINGS_KEY = "graph-4d.presentation-settings.v1";

  function atomDisplayName(node, fallback = "") {
    const label = String(node && node.label || fallback || "");
    const types = Array.isArray(node && node.atomTypes) ? node.atomTypes : [];
    return types.length ? `${label} ${types.map((type) => `@${type}`).join(" ")}` : label;
  }

  function loadDemoSettings() {
    try {
      const raw = global.localStorage.getItem(DEMO_SETTINGS_KEY);
      if (raw) return demoModel.normalizeSettings(JSON.parse(raw));
      const legacyRaw = global.localStorage.getItem(LEGACY_DEMO_SETTINGS_KEY);
      if (!legacyRaw) return demoModel.normalizeSettings(null);
      return demoModel.normalizeSettings({ ...JSON.parse(legacyRaw), idleSeconds: null });
    } catch (_error) {
      return demoModel.normalizeSettings(null);
    }
  }

  function saveDemoSettings(settings) {
    try {
      global.localStorage.setItem(DEMO_SETTINGS_KEY, JSON.stringify(settings));
    } catch (_error) {
      // Presentation preferences are optional; the graph remains usable without storage.
    }
  }

  const initialDemoSettings = loadDemoSettings();

  const intentNames = {
    cycleViewMode: "视角模式",
    cycleVisibleDetails: "信息密度",
    applyViewMode: "应用视角",
    expandToLeaves: "展开至最细级",
    activate: "使用",
    summonMenu: "命令星环",
    enter: "进入球域",
    exit: "退出球域",
    reveal: "展开卫星",
    peek: "兼容窥域",
    inspect: "球镜观察",
    grab: "抓取移动",
    orbit: "环绕视角",
    dolly: "远近缩放",
    backView: "返回视角",
    forwardView: "恢复视角",
    toggleChildren: "展开或收起子球",
    toggleFieldChildren: "当前域全部展收",
    clearFocus: "解除聚焦",
    toggleSurface: "切换球面",
    toggleFieldSurfaces: "切换全域球面",
    toggleWorldLens: "域径图",
    toggleClusterField: "多球团视野",
    toggleDemo: "自动演示",
    search: "空间搜索",
    createNode: "新增节点",
    editNode: "编辑节点",
    editEdge: "编辑关系",
    confirmEdit: "提交编辑",
    cancelEdit: "取消编辑",
    deleteEdit: "删除预警",
    cancel: "取消临时态",
    returnOverview: "返回全域"
  };

  const rootStyles = getComputedStyle(document.documentElement);
  const theme = {};
  let staticBackdropCache = null;
  [
    "space-0",
    "space-1",
    "space-2",
    "surface",
    "ink",
    "ink-2",
    "muted",
    "rule",
    "rule-2",
    "accent",
    "accent-2",
    "sphere",
    "sphere-edge",
    "sphere-core",
    "nebula-blue",
    "ghost",
    "star",
    "update",
    "delete"
  ].forEach((name) => {
    theme[name] = rootStyles.getPropertyValue(`--color-${name}`).trim();
  });
  theme.fontBody = rootStyles.getPropertyValue("--font-body").trim();
  theme.fontDisplay = rootStyles.getPropertyValue("--font-display").trim();
  theme.fontMono = rootStyles.getPropertyValue("--font-mono").trim();

  const V = {
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
    scale: (a, amount) => ({ x: a.x * amount, y: a.y * amount, z: a.z * amount }),
    dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
    cross: (a, b) => ({
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    }),
    length: (a) => Math.hypot(a.x, a.y, a.z),
    normalize(a) {
      const length = Math.max(0.0001, V.length(a));
      return V.scale(a, 1 / length);
    },
    lerp: (a, b, amount) => ({
      x: a.x + (b.x - a.x) * amount,
      y: a.y + (b.y - a.y) * amount,
      z: a.z + (b.z - a.z) * amount
    })
  };

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  const visualIntentSet = new Set([
    ...Object.values(input.intents),
    "exitToDepth"
  ]);
  const EDGE_DRAFT_NAVIGATION_INTENTS = new Set([
    input.intents.enter,
    input.intents.exit,
    input.intents.backView,
    input.intents.forwardView,
    input.intents.returnOverview
  ]);
  const transactionGuardedIntents = new Set([
    "focus",
    "clearFocus",
    "enter",
    "exit",
    "exitToDepth",
    "backView",
    "forwardView",
    "toggleClusterField",
    "cycleViewMode",
    "applyViewMode",
    "applyParentView",
    "collapseHoveredCluster",
    "expandHoveredCluster",
    "toggleFieldChildren",
    "returnOverview",
    "expandToLeaves",
    "resetView",
    "nextFocus",
    "previousFocus"
  ]);
  const workspace = workspaceModel.createWorkspace();

  function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function randomFactory(seed) {
    let value = seed >>> 0;
    return function random() {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  function currentParadigms() {
    const roots = registry.rootDefinitions();
    return roots.length ? roots : registry.list();
  }

  if (!currentParadigms().length) {
    document.body.dataset.spatialUnavailable = "true";
    return;
  }

  const domainCache = new Map();
  const surfaceImageCache = new Map();
  const DOMAIN_CACHE_LIMIT = 24;
  const SURFACE_IMAGE_CACHE_LIMIT = 24;
  const MARKDOWN_SURFACE_RADIUS = 90;
  const MAX_MARKDOWN_SURFACES = 2;
  const VISUAL_SNAPSHOT_NODE_LIMIT = 64;
  const NORMAL_FIELD_DISTANCE = 17.2;
  const MIN_CAMERA_DISTANCE = 0.04;
  const MIN_PROJECTABLE_DEPTH = 0.01;
  const MAX_CAMERA_DISTANCE = 25200;
  const REDUCED_TRAVEL_STAGE_DURATION = 72;
  const RIPPLE_LAYER_DELAY = 92;
  const RIPPLE_LAYER_DURATION = 520;
  const RIPPLE_LAYER_SPACING = 0.12;
  const RIPPLE_LAYER_TRAVEL = 0.082;
  const RIPPLE_COUNT_WIDTH_STEP = 0.18;
  const RIPPLE_COUNT_ALPHA_STEP = 0.045;
  const RIPPLE_COUNT_TRAVEL_STEP = 0.018;
  const TUNNEL_BOUNDARY_CONTOURS = 7;
  const DOMAIN_TUNNEL_DEPTH_LAYERS = 13;
  const DOMAIN_TUNNEL_FRAGMENTS = 4;
  const labelNouns = ["检索", "项目", "片段", "关系", "证据", "视图", "记录", "草图", "路径", "分支", "约束", "档案"];
  const labelQualifiers = ["近域", "并行", "待核", "活动", "深层", "临时", "主线", "外缘", "回声", "局部", "归档", "共享"];

  function generatedCarrierDescription(hasChildren, depth, satellite) {
    if (hasChildren) {
      return satellite
        ? "隧洞卫星载体；可同层展开子节点，或沉浸进入下一球域。"
        : `第 ${depth} 层的隧洞载体；可同层展开、观察或沉浸进入下一球域。`;
    }
    return satellite
      ? "空隧洞卫星；当前没有子节点，但仍可进入并在内部新增节点。"
      : `第 ${depth} 层的空隧洞；当前没有子节点，但仍可进入并在内部新增节点。`;
  }

  function createNode(definition, position, index, path, random) {
    return {
      id: `${path}:sphere-${index}`,
      definitionId: definition.id || null,
      label: definition.label,
      short: definition.short,
      description: definition.description,
      preview: definition.preview,
      preferredIntent: definition.preferredIntent,
      capabilities: definition.capabilities,
      visualBudget: definition.visualBudget,
      hasChildren: Boolean(definition.hasChildren),
      visualLinks: [],
      position: { ...position },
      radius: path === "root" ? definition.radius : 0.72 + random() * 0.38,
      depthIndex: index,
      parent: null,
      satellites: [],
      revealed: false,
      peekOpen: false,
      lensOpen: false,
      lensOpenedAt: 0,
      surfaceVisible: false,
      detailMode: "floating",
      surfaceOpenedAt: 0,
      pinned: false,
      pinnedAt: 0,
      manualPosition: null,
      isPrimary: true,
      semanticStage: 0
    };
  }

  function findOpenPosition(existing, random) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const candidate = {
        x: (random() - 0.5) * 12,
        y: (random() - 0.5) * 8,
        z: (random() - 0.45) * 7
      };
      if (V.length(candidate) < 2.1) {
        continue;
      }
      if (existing.every((node) => V.length(V.sub(node.position, candidate)) > 2.25)) {
        return candidate;
      }
    }
    return {
      x: (random() - 0.5) * 10,
      y: (random() - 0.5) * 7,
      z: (random() - 0.5) * 6
    };
  }

  function connectVisualComponents(nodes) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const components = new Map(nodes.map((node) => [node.id, node.id]));
    const find = (id) => {
      let root = id;
      while (components.get(root) !== root) {
        root = components.get(root);
      }
      let current = id;
      while (components.get(current) !== current) {
        const next = components.get(current);
        components.set(current, root);
        current = next;
      }
      return root;
    };
    const union = (leftId, rightId) => {
      const leftRoot = find(leftId);
      const rightRoot = find(rightId);
      if (leftRoot !== rightRoot) components.set(rightRoot, leftRoot);
    };

    nodes.forEach((node) => {
      node.visualLinks.forEach((targetId) => {
        if (byId.has(targetId)) union(node.id, targetId);
      });
    });
    for (let index = 0; index < nodes.length - 1; index += 1) {
      const current = nodes[index];
      const next = nodes[index + 1];
      if (find(current.id) === find(next.id)) continue;
      if (!current.visualLinks.includes(next.id)) current.visualLinks.push(next.id);
      union(current.id, next.id);
    }
    return nodes;
  }

  function createDomain(path, depth) {
    if (domainCache.has(path)) {
      return domainCache.get(path);
    }

    const random = randomFactory(hashText(path));
    const activeParadigms = currentParadigms();
    const count = depth === 0 ? activeParadigms.length : 6 + Math.floor(random() * 3);
    const nodes = [];

    for (let index = 0; index < count; index += 1) {
      const paradigm = activeParadigms[(index + depth) % activeParadigms.length];
      const definition = depth === 0
        ? paradigm
        : {
          ...paradigm,
          label: `${labelQualifiers[Math.floor(random() * labelQualifiers.length)]}${labelNouns[Math.floor(random() * labelNouns.length)]}`,
          short: `D${String(depth).padStart(2, "0")}.${String(index + 1).padStart(2, "0")}`,
          hasChildren: index % 3 !== 1,
          description: generatedCarrierDescription(index % 3 !== 1, depth, false)
        };
      const position = depth === 0 ? paradigm.position : findOpenPosition(nodes, random);
      nodes.push(createNode(definition, position, index, path, random));
    }

    if (depth === 0) {
      const nodeIdByDefinitionId = new Map(nodes.map((node) => [node.definitionId, node.id]));
      for (const node of nodes) {
        const definition = registry.get(node.definitionId);
        node.visualLinks = definition
          ? definition.visualLinks.map((key) => nodeIdByDefinitionId.get(key)).filter(Boolean)
          : [];
      }
    }
    connectVisualComponents(nodes);

    domainCache.set(path, nodes);
    if (domainCache.size > DOMAIN_CACHE_LIMIT) {
      for (const cachedPath of domainCache.keys()) {
        if (cachedPath !== "root" && cachedPath !== path) {
          domainCache.delete(cachedPath);
          break;
        }
      }
    }
    return nodes;
  }

  function childPathFor(node, parentPath) {
    return `${parentPath || state.currentPath}/${hashText(node.id).toString(36)}`;
  }

  function createChildDomainNodes(node, path, depth) {
    if (node && node.isWorkspaceNode === true) {
      domainCache.set(path, []);
      return domainCache.get(path);
    }
    if (domainCache.has(path)) {
      return domainCache.get(path);
    }
    const nodes = node.hasChildren === true ? createDomain(path, depth) : [];
    if (node.hasChildren !== true) {
      domainCache.set(path, []);
    }
    return nodes;
  }

  function prefetchChildDomain(node, ownerPath = nodeOwnerPath(node)) {
    if (!node) {
      return null;
    }
    const path = childPathFor(node, ownerPath);
    const depth = clusterDepthForPath(ownerPath) + 1;
    if (state.prefetchedDomain && state.prefetchedDomain.path === path) {
      return state.prefetchedDomain;
    }
    state.prefetchedDomain = {
      nodeId: node.id,
      path,
      depth,
      nodes: createChildDomainNodes(node, path, depth)
    };
    return state.prefetchedDomain;
  }

  function createSatellites(parent) {
    if (
      !parent
      || parent.hasChildren !== true
      || !parent.capabilities
      || !parent.capabilities.satellites
    ) {
      return [];
    }
    if (parent.satellites.length) {
      return parent.satellites;
    }
    const random = randomFactory(hashText(`${parent.id}:satellites`));
    const requestedCount = 4 + Math.floor(random() * 3);
    const budgetCount = Number.isFinite(parent.visualBudget && parent.visualBudget.maxSatellites)
      ? parent.visualBudget.maxSatellites
      : 6;
    const count = Math.max(0, Math.min(requestedCount, budgetCount));
    const activeParadigms = currentParadigms();
    const sharedOrbitSpeed = 0.026 + random() * 0.012;
    for (let index = 0; index < count; index += 1) {
      const paradigm = activeParadigms[(parent.depthIndex + index + 1) % activeParadigms.length];
      parent.satellites.push({
        id: `${parent.id}:sat-${index}`,
        label: `${labelNouns[(index + parent.depthIndex) % labelNouns.length]}节点`,
        short: `S${String(index + 1).padStart(2, "0")}`,
        description: generatedCarrierDescription(index % 3 !== 1, parent.depthIndex + 1, true),
        preview: paradigm.preview,
        preferredIntent: index % 4 === 1 ? "inspect" : "reveal",
        capabilities: paradigm.capabilities,
        visualBudget: paradigm.visualBudget,
        hasChildren: index % 3 !== 1,
        visualLinks: [],
        position: { x: 0, y: 0, z: 0 },
        radius: 0.23 + random() * 0.16,
        depthIndex: parent.depthIndex * 10 + index,
        parent,
        orbit: {
          radiusX: parent.radius * (0.72 + random() * 0.16),
          radiusY: parent.radius * (0.54 + random() * 0.18),
          tilt: (random() - 0.5) * 0.8,
          phase: index / Math.max(1, count) * Math.PI * 2 + (random() - 0.5) * 0.05,
          speed: sharedOrbitSpeed
        },
        satellites: [],
        revealed: false,
        peekOpen: false,
        lensOpen: false,
        lensOpenedAt: 0,
        surfaceVisible: false,
        detailMode: "floating",
        surfaceOpenedAt: 0,
        pinned: false,
        pinnedAt: 0,
        manualPosition: null,
        isPrimary: false,
        semanticStage: 0
      });
    }
    for (let index = 0; index < parent.satellites.length - 1; index += 1) {
      parent.satellites[index].visualLinks = [parent.satellites[index + 1].id];
    }
    return parent.satellites;
  }

  function hydrateNodePath(nodes, id, revealAncestors = false) {
    return visualModel.hydrateNodePath(
      nodes,
      id,
      createSatellites,
      { revealAncestors }
    );
  }

  function restoreRevealedNodes(nodes, revealedIds) {
    return visualModel.restoreRevealedNodes(
      nodes,
      revealedIds,
      createSatellites,
      VISUAL_SNAPSHOT_NODE_LIMIT
    );
  }

  function resetSnapshotNodeState(nodes) {
    return visualModel.resetSnapshotNodeState(nodes);
  }

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    time: 0,
    currentPath: "root",
    crumbs: ["全域"],
    depth: 0,
    nodes: createDomain("root", 0),
    domainStack: [],
    domainRoutes: new Map([["root", []]]),
    viewHistory: grammar.createViewHistory ? grammar.createViewHistory(36) : new grammar.ViewHistory(36),
    selected: null,
    focused: null,
    hovered: null,
    middleLabelFocus: null,
    middleDetailFocus: null,
    batchFloatingDetails: false,
    semanticScene: null,
    menuFor: null,
    prefetchedDomain: null,
    worldLens: {
      open: false,
      scope: "root"
    },
    clusterFieldOpen: false,
    viewMode: "nested",
    appliedViewMode: "hierarchy",
    expandedClusterDomains: new Map(),
    clusterScene: { clusters: [], corridors: [], bounds: { center: { x: 0, y: 0, z: 0 }, radius: 0 } },
    clusterConnectionEdges: [],
    interactionPhase: grammar.interactionPhases.idle,
    commitPulseUntil: 0,
    confirmationRipples: new Map(),
    wandGlowUntil: new Map(),
    batchSelectionKeys: new Set(),
    batchToggleKey: null,
    wand: {
      shiftHeld: false,
      highEnergy: false,
      lastTapAt: 0,
      tapCount: 0,
      peerBatchArmed: false,
      peerBatchMode: null,
      active: false,
      pointerId: null,
      points: [],
      pendingKeys: [],
      closed: false
    },
    demo: {
      settings: initialDemoSettings,
      active: false,
      lastInputAt: performance.now(),
      session: null,
      currentTask: null,
      themeTimer: null,
      stepTimer: null,
      cueTimer: null,
      frameTimer: null,
      wandTimer: null,
      wandPreviousEnergy: false
    },
    ambiguity: [],
    rendered: [],
    hitRegions: [],
    relationHitRegions: [],
    clusterHitRegions: [],
    clusterScreenOffsets: new Map(),
    clusterDetailCandidates: [],
    floatingDetailBoxes: [],
    renderedFloatingDetailBoxes: [],
    floatingDetailKeys: new Set(),
    floatingNodeDetailCount: 0,
    floatingClusterDetailCount: 0,
    floatingDetailHiddenCount: 0,
    pointerPosition: { x: 0, y: 0 },
    detailMagnifier: {
      ...detailMagnifierModel.createState(),
      targetKey: "",
      layoutKey: "",
      targetKind: "",
      targetNodeKey: "",
      targetEdgeId: ""
    },
    searchMatches: [],
    locatedNodeId: null,
    locatedUntil: 0,
    attachmentUrl: "",
    nodeEditorFallback: null,
    nodeEditorAnchor: null,
    editShiftLineBreakUntil: 0,
    bindingCaptureIntent: null,
    drag: null,
    latestInteractionAnchor: null,
    latestInteractionKey: null,
    pointerCandidate: null,
    wheelGestureActive: false,
    wheelHistoryTimer: null,
    wheelNavigationPoint: null,
    wheelNavigationAnchor: null,
    cameraTween: null,
    transitionLocked: false,
    transitionFieldReady: false,
    transitionOrigin: null,
    reducedMotion: global.matchMedia("(prefers-reduced-motion: reduce)").matches,
    starField: [],
    frameCount: 0
  };

  const camera = {
    target: { x: 0, y: 0, z: 0 },
    yaw: -0.16,
    pitch: 0.12,
    distance: NORMAL_FIELD_DISTANCE,
    fov: Math.PI / 3.15
  };

  const markdownEditor = global.SpatialMarkdownEditor
    ? global.SpatialMarkdownEditor.create({
      textarea: ui.nodeDetailEditor,
      mount: ui.nodeDetailEditorMount,
      preview: ui.nodeDetailPreview,
      toggle: ui.nodeDetailModeToggle,
      onSubmit() {
        dispatchIntent("confirmEdit");
      },
      onCancel() {
        dispatchIntent("cancelEdit");
      }
    })
    : null;
  const markdownSurfaceElements = new Map();

  function cameraSnapshot() {
    return {
      target: { ...camera.target },
      yaw: camera.yaw,
      pitch: camera.pitch,
      distance: camera.distance
    };
  }

  function cloneDomainStack(stack) {
    return stack.map((entry) => ({
      path: entry.path,
      crumbs: [...entry.crumbs],
      depth: entry.depth,
      camera: {
        ...entry.camera,
        target: { ...entry.camera.target }
      },
      entryDirection: { ...entry.entryDirection },
      entryNearDistance: entry.entryNearDistance,
      childFarDistance: entry.childFarDistance,
      nodeId: entry.nodeId,
      nodeLabel: entry.nodeLabel
    }));
  }

  function rememberDomainRoute(path, stack) {
    state.domainRoutes.delete(path);
    state.domainRoutes.set(path, cloneDomainStack(stack));
    if (state.domainRoutes.size > 48) {
      for (const cachedPath of state.domainRoutes.keys()) {
        if (cachedPath !== "root" && cachedPath !== path && cachedPath !== state.currentPath) {
          state.domainRoutes.delete(cachedPath);
          break;
        }
      }
    }
  }

  function existingNodes(nodes) {
    const collected = [];
    const walk = (items) => {
      for (const node of items) {
        collected.push(node);
        if (node.satellites.length) {
          walk(node.satellites);
        }
      }
    };
    walk(nodes);
    return collected;
  }

  function projectDomainNodes(path, nodes) {
    const projected = workspace.projectDomain(path, nodes);
    projected.forEach((node) => {
      if (!node || !node.isWorkspaceNode || node.capabilities || node.__spatialPreparing) return;
      node.__spatialPreparing = true;
      try {
        prepareWorkspaceNode(node, path);
      } finally {
        delete node.__spatialPreparing;
      }
    });
    return projected;
  }

  function currentDomainNodes() {
    const projected = workspace.projectDomain(state.currentPath, state.nodes);
    projected.forEach((node) => {
      if (!node || !node.isWorkspaceNode || node.capabilities || node.__spatialPreparing) return;
      node.__spatialPreparing = true;
      try {
        prepareWorkspaceNode(node, state.currentPath);
      } finally {
        delete node.__spatialPreparing;
      }
    });
    return projected;
  }

  function nodeOwnerPath(node, fallback = state.currentPath) {
    return node && (node.__clusterOwnerPath || node.workspacePath) || fallback;
  }

  function topLevelDomainNodesForPath(path) {
    const resolvedPath = path || state.currentPath;
    const expanded = state.expandedClusterDomains.get(resolvedPath);
    const baseNodes = resolvedPath === state.currentPath
      ? state.nodes
      : expanded && expanded.nodes || domainCache.get(resolvedPath) || [];
    return projectDomainNodes(resolvedPath, baseNodes);
  }

  function domainNodesForPath(path) {
    return existingNodes(topLevelDomainNodesForPath(path));
  }

  function nodeByIdInPath(path, id) {
    if (!id) return null;
    const node = domainNodesForPath(path).find((candidate) => candidate.id === id) || null;
    if (node) node.__clusterOwnerPath = path;
    return node;
  }

  function pathContains(ancestorPath, candidatePath) {
    return Boolean(
      ancestorPath
      && candidatePath
      && (candidatePath === ancestorPath || candidatePath.startsWith(`${ancestorPath}/`))
    );
  }

  function transactionBlocksViewChange() {
    const transaction = workspace.transaction();
    return Boolean(
      transaction
      && !(transaction.kind === "edge-create" && !transaction.target)
    );
  }

  function currentNodeById(id) {
    if (!id) return null;
    return existingNodes(currentDomainNodes()).find((node) => node.id === id) || null;
  }

  function sameNode(left, right) {
    if (!left || !right || left.id !== right.id) return false;
    const leftPath = left.__clusterOwnerPath || left.workspacePath || null;
    const rightPath = right.__clusterOwnerPath || right.workspacePath || null;
    return !leftPath || !rightPath || leftPath === rightPath;
  }

  function findExistingNode(nodes, id) {
    if (!id) {
      return null;
    }
    return existingNodes(nodes).find((node) => node.id === id) || null;
  }

  function clusterBranchSnapshot() {
    return [...state.expandedClusterDomains.values()].map((descriptor) => ({
      path: descriptor.path,
      depth: descriptor.depth,
      label: descriptor.label,
      pathLabels: [...(descriptor.pathLabels || [])],
      parentPath: descriptor.parentPath,
      parentNodeId: descriptor.parentNodeId,
      projectionMode: descriptor.projectionMode || "hierarchy"
    }));
  }

  function restoreClusterBranches(entries) {
    sceneAdapter.commitViewIntent(state, { type: "clear-views" });
    [...entries]
      .sort((left, right) => left.depth - right.depth)
      .forEach((descriptor) => {
        const parentNode = nodeByIdInPath(descriptor.parentPath, descriptor.parentNodeId);
        if (!parentNode) return;
        const restoredDescriptor = {
          path: descriptor.path,
          depth: descriptor.depth,
          label: descriptor.label,
          pathLabels: [...(descriptor.pathLabels || [])],
          parentPath: descriptor.parentPath,
          parentNodeId: descriptor.parentNodeId,
          projectionMode: descriptor.projectionMode || "hierarchy",
          nodes: createChildDomainNodes(parentNode, descriptor.path, descriptor.depth)
        };
        sceneAdapter.commitViewIntent(state, {
          type: "append-view",
          targetId: descriptor.path,
          mode: restoredDescriptor.projectionMode,
          descriptor: restoredDescriptor
        });
      });
  }

  function visualSnapshot() {
    const snapshotNodes = existingNodes(currentDomainNodes()).slice(0, VISUAL_SNAPSHOT_NODE_LIMIT);
    const revealedIds = snapshotNodes
      .filter((node) => node.revealed)
      .map((node) => node.id);
    const detailLensIds = snapshotNodes
      .filter((node) => node.lensOpen)
      .sort((a, b) => b.lensOpenedAt - a.lensOpenedAt)
      .slice(0, 2)
      .map((node) => node.id);
    const surfaceIds = snapshotNodes
      .filter((node) => node.surfaceVisible)
      .map((node) => node.id);
    const detailModes = snapshotNodes
      .filter((node) => visualModel.detailModeFor(node) !== "name")
      .map((node) => ({ id: node.id, mode: visualModel.detailModeFor(node) }));
    return {
      path: state.currentPath,
      depth: state.depth,
      crumbs: [...state.crumbs],
      selectedId: state.selected ? state.selected.id : null,
      focusedId: state.focused ? state.focused.id : null,
      worldLens: { ...state.worldLens },
      clusterFieldOpen: state.clusterFieldOpen,
      viewMode: state.viewMode,
      appliedViewMode: state.appliedViewMode,
      expandedClusters: clusterBranchSnapshot(),
      revealedIds,
      detailLensIds,
      surfaceIds,
      detailModes
    };
  }

  function recordCurrentView(options) {
    const snapshot = state.viewHistory.push(visualSnapshot(), options);
    updateNavigationUI();
    global.dispatchEvent(new CustomEvent("spatial-view-committed", {
      detail: Object.freeze({ view: exportFieldProjection() })
    }));
    return snapshot;
  }

  function beginDomainTransition(transitionOrigin = null) {
    primaryClickArbiter.cancel();
    secondaryClickArbiter.cancel();
    if (state.wheelHistoryTimer) {
      global.clearTimeout(state.wheelHistoryTimer);
    }
    state.wheelHistoryTimer = null;
    state.wheelGestureActive = false;
    state.transitionLocked = true;
    state.transitionFieldReady = false;
    state.transitionOrigin = transitionOrigin;
  }

  function transitionBlocksIntent(intent) {
    if (intent === "backView" || intent === "forwardView") return false;
    if (!state.transitionLocked) return false;
    return !(
      state.transitionFieldReady
      && ["createNode", "editNode", "editEdge"].includes(intent)
    );
  }

  function transitionBlocksPointerEdit(event) {
    if (!state.transitionLocked) return false;
    return !(
      state.transitionFieldReady
      && event
      && event.ctrlKey === true
      && (event.button === 0 || event.button === 2)
    );
  }

  function restoreVisualSnapshot(snapshot) {
    if (!snapshot || state.transitionLocked) {
      return false;
    }
    state.currentPath = snapshot.path;
    state.depth = snapshot.depth;
    state.crumbs = [...snapshot.crumbs];
    state.nodes = createDomain(snapshot.path, snapshot.depth);
    state.transitionFieldReady = true;
    state.domainStack = cloneDomainStack(state.domainRoutes.get(snapshot.path) || []);
    const snapshotNodes = currentDomainNodes();
    resetSnapshotNodeState(snapshotNodes);
    restoreRevealedNodes(snapshotNodes, snapshot.revealedIds || []);
    [
      snapshot.selectedId,
      snapshot.focusedId,
      ...(snapshot.detailLensIds || []),
      ...(snapshot.surfaceIds || []),
      ...(snapshot.detailModes || []).map((entry) => entry.id)
    ].forEach((id) => hydrateNodePath(snapshotNodes, id));
    state.selected = findExistingNode(snapshotNodes, snapshot.selectedId);
    state.focused = findExistingNode(snapshotNodes, snapshot.focusedId);
    state.hovered = null;
    state.menuFor = null;
    state.middleLabelFocus = null;
    state.prefetchedDomain = null;
    state.worldLens = { ...snapshot.worldLens };
    state.clusterFieldOpen = snapshot.clusterFieldOpen === true;
    state.viewMode = snapshot.viewMode || "nested";
    state.appliedViewMode = snapshot.appliedViewMode || "hierarchy";
    restoreClusterBranches(snapshot.expandedClusters || []);
    if (state.clusterFieldOpen) buildClusterScene();
    updateSelectionUI();
    updateMetrics();
    const detailLensIds = new Set(snapshot.detailLensIds || []);
    const surfaceIds = new Set(snapshot.surfaceIds || []);
    const detailModes = new Map((snapshot.detailModes || []).map((entry) => [entry.id, entry.mode]));
    const surfaceOpenedAt = performance.now();
    for (const node of existingNodes(snapshotNodes)) {
      node.lensOpen = detailLensIds.has(node.id);
      node.surfaceVisible = surfaceIds.has(node.id);
      node.detailMode = detailModes.get(node.id) || (node.surfaceVisible ? "surface" : "floating");
      node.surfaceOpenedAt = node.surfaceVisible ? surfaceOpenedAt : 0;
    }
    updateSelectionUI();
    updateNavigationUI();
    announce(`已恢复第 ${state.depth} 层浏览`);
    return true;
  }

  function cameraBasis() {
    const cosPitch = Math.cos(camera.pitch);
    const offset = {
      x: camera.distance * cosPitch * Math.sin(camera.yaw),
      y: camera.distance * Math.sin(camera.pitch),
      z: camera.distance * cosPitch * Math.cos(camera.yaw)
    };
    const position = V.add(camera.target, offset);
    const forward = V.normalize(V.sub(camera.target, position));
    const right = V.normalize(V.cross(forward, { x: 0, y: 1, z: 0 }));
    const up = V.normalize(V.cross(right, forward));
    return { position, forward, right, up };
  }

  function projectUnclipped(position, radius, basis) {
    const relative = V.sub(position, basis.position);
    const depth = V.dot(relative, basis.forward);
    if (depth <= MIN_PROJECTABLE_DEPTH) {
      return null;
    }
    const projectionSpan = Math.min(state.height, state.width * 1.25);
    const focal = projectionSpan / (2 * Math.tan(camera.fov / 2));
    const x = state.width / 2 + V.dot(relative, basis.right) * focal / depth;
    const y = state.height / 2 - V.dot(relative, basis.up) * focal / depth;
    const projectedRadius = Math.max(1.2, radius * focal / depth);
    return { x, y, radius: projectedRadius, depth };
  }

  function project(position, radius, basis) {
    const projected = projectUnclipped(position, radius, basis);
    if (!projected) {
      return null;
    }
    const { x, y, radius: projectedRadius } = projected;
    if (x < -projectedRadius * 2 || x > state.width + projectedRadius * 2 || y < -projectedRadius * 2 || y > state.height + projectedRadius * 2) {
      return null;
    }
    return projected;
  }

  function unprojectScreen(x, y, depth, basis) {
    const projectionSpan = Math.min(state.height, state.width * 1.25);
    const focal = projectionSpan / (2 * Math.tan(camera.fov / 2));
    const horizontal = (x - state.width / 2) * depth / Math.max(1, focal);
    const vertical = (state.height / 2 - y) * depth / Math.max(1, focal);
    return V.add(
      basis.position,
      V.add(
        V.scale(basis.forward, depth),
        V.add(V.scale(basis.right, horizontal), V.scale(basis.up, vertical))
      )
    );
  }

  function worldRadiusForPixels(pixelRadius, depth) {
    const projectionSpan = Math.min(state.height, state.width * 1.25);
    const focal = projectionSpan / (2 * Math.tan(camera.fov / 2));
    return pixelRadius * depth / Math.max(1, focal);
  }

  function exactProjectedRadius(worldRadius, depth) {
    const projectionSpan = Math.min(state.height, state.width * 1.25);
    const focal = projectionSpan / (2 * Math.tan(camera.fov / 2));
    const compressionMultiplier = Math.max(
      1,
      Number(state.clusterScene && state.clusterScene.compressionMultiplier) || 1
    );
    return Math.max(
      0.18 / compressionMultiplier,
      Number(worldRadius) * focal / Math.max(MIN_PROJECTABLE_DEPTH, depth)
    );
  }

  function resolveNodePosition(node, time) {
    if (node.manualPosition) {
      return node.manualPosition;
    }
    if (!node.parent) {
      return node.position;
    }
    const parentPosition = resolveNodePosition(node.parent, time);
    const frozenTime = node.parent.pinned || state.reducedMotion ? node.parent.pinnedAt : time;
    const phase = node.orbit.phase + frozenTime * node.orbit.speed;
    const local = {
      x: Math.cos(phase) * node.orbit.radiusX,
      y: Math.sin(phase) * node.orbit.radiusY,
      z: Math.sin(phase * 0.77 + node.orbit.tilt) * node.orbit.radiusX * 0.38
    };
    const localLength = V.length(local);
    const localLimit = node.parent.radius * 0.92;
    const boundedLocal = localLength > localLimit
      ? V.scale(local, localLimit / localLength)
      : local;
    return V.add(parentPosition, boundedLocal);
  }

  function nodeContains(ancestor, candidate) {
    let current = candidate && candidate.parent;
    while (current) {
      if (current === ancestor) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  function focusRelation(node) {
    const focus = state.focused;
    if (!focus) {
      return grammar.focusRelations.distant;
    }
    if (node === focus) {
      return grammar.focusRelations.focused;
    }
    if (node.parent === focus || focus.parent === node) {
      return grammar.focusRelations.direct;
    }
    if (nodeContains(node, focus) || nodeContains(focus, node)) {
      return grammar.focusRelations.ancestor;
    }
    if (node.parent && node.parent === focus.parent) {
      return grammar.focusRelations.sibling;
    }
    return grammar.focusRelations.distant;
  }

  function collectNodes(time) {
    const candidates = [];
    const walk = (nodes, level) => {
      for (const node of nodes) {
        if (candidates.length >= 180) {
          return;
        }
        const focusContext = grammar.resolveFocusContext(
          focusRelation(node),
          Boolean(state.focused)
        );
        candidates.push({
          kind: "node",
          node,
          position: resolveNodePosition(node, time),
          radius: node.radius,
          level,
          focusContext
        });
        if (node.revealed && level < 3) {
          walk(node.satellites, level + 1);
        }
      }
    };
    walk(currentDomainNodes(), 0);
    const visibleCandidates = candidates
      .sort((a, b) => {
        const selectedDelta = Number(sameNode(b.node, state.selected)) - Number(sameNode(a.node, state.selected));
        if (selectedDelta) {
          return selectedDelta;
        }
        const focusDelta = b.focusContext.hitPriority - a.focusContext.hitPriority;
        if (focusDelta) {
          return focusDelta;
        }
        const primaryDelta = Number(b.node.isPrimary) - Number(a.node.isPrimary);
        if (primaryDelta) {
          return primaryDelta;
        }
        return a.level - b.level;
      })
      .slice(0, 44);
    const baseRelationships = visualModel.relationshipPairs(existingNodes(currentDomainNodes()))
      .filter((relationship) => {
        const edge = {
          id: `base:${state.currentPath}:${[relationship.fromId, relationship.toId].sort().join("<->")}`,
          from: { key: `${state.currentPath}::${relationship.fromId}` },
          to: { key: `${state.currentPath}::${relationship.toId}` }
        };
        return !workspace.isEdgeSuppressed(edge);
      });
    const workspaceRelationships = workspace.relationshipPairsForPath(state.currentPath);
    const portalCandidates = visibleCandidates.map(({ node }) => ({
      nodeId: node.id,
      childPath: childPathFor(node, state.currentPath)
    }));
    const visiblePortalRelationships = workspace.edgesForPath(state.currentPath)
      .map((edge) => ({
        from: workspace.resolveEndpoint(edge.from),
        to: workspace.resolveEndpoint(edge.to),
        label: edge.label
      }))
      .filter(({ from, to }) => from.path !== to.path)
      .map((edge) => visualModel.visiblePortalRelationship(
        state.currentPath,
        edge,
        portalCandidates
      ))
      .filter(Boolean);
    const visibleRelationships = [...baseRelationships, ...workspaceRelationships, ...visiblePortalRelationships];
    const relaxedPositions = visualModel.relaxRelationshipLayout(
      visibleCandidates.map(({ node, position, radius }) => ({
        id: node.id,
        position,
        radius,
        labelSpan: Math.min(6, String(node.label || "").length * 0.12),
        fixed: Boolean(node.manualPosition),
        parentId: node.parent ? node.parent.id : null,
        containerRadius: node.parent ? node.parent.radius : null
      })),
      visibleRelationships,
      {
        iterations: 32,
        baseGap: 1.08,
        radiusScale: 1.64,
        repulsionRangeScale: 2.2,
        repulsionStrength: 0.72,
        fieldRepulsionStrength: 0.38,
        nodeEdgeRepulsionStrength: 0.54,
        linkStrength: 0.14,
        anchorStrength: 0.006,
        maxStep: 0.56,
        maxFieldRadius: 16.8,
        planarRepulsion: true
      }
    );
    visibleCandidates.forEach((candidate) => {
      if (relaxedPositions[candidate.node.id]) {
        candidate.position = relaxedPositions[candidate.node.id];
      }
    });
    return visibleCandidates;
  }

  function visibleClusterDomains() {
    const descriptors = new Map(
      [...state.expandedClusterDomains]
        .filter(([path]) => path === state.currentPath || path.startsWith(`${state.currentPath}/`))
    );
    descriptors.set(state.currentPath, {
      ...(descriptors.get(state.currentPath) || {}),
      path: state.currentPath,
      depth: state.depth,
      projectionMode: state.appliedViewMode,
      label: state.crumbs.at(-1) || (state.depth ? `第 ${state.depth} 域` : "全域"),
      parentPath: null,
      parentNodeId: null,
      active: true
    });
    return [...descriptors.values()]
      .map((descriptor) => {
        const baseNodes = descriptor.path === state.currentPath
          ? state.nodes
          : descriptor.nodes || domainCache.get(descriptor.path) || createDomain(descriptor.path, descriptor.depth);
        const projected = projectDomainNodes(descriptor.path, baseNodes);
        const visible = [];
        const directOnly = descriptor.projectionMode === "nested";
        const walk = (nodes, level = 0) => {
          for (const node of nodes) {
            node.__clusterLevel = level;
            visible.push({
              ...node,
              sourceNode: node,
              position: resolveNodePosition(node, state.time)
            });
            if (!directOnly && node.revealed && level < 2) {
              walk(node.satellites || [], level + 1);
            }
          }
        };
        walk(projected);
        const domainRelationships = [
          ...visualModel.relationshipPairs(existingNodes(projected)),
          ...workspace.relationshipPairsForPath(descriptor.path)
        ];
        const relaxedPositions = visualModel.relaxRelationshipLayout(
          visible.map((node) => ({
            id: node.id,
            position: node.position,
            radius: node.radius,
            labelSpan: Math.min(6, String(node.label || "").length * 0.12),
            fixed: Boolean(node.manualPosition),
            parentId: node.parent ? node.parent.id : null,
            containerRadius: node.parent ? node.parent.radius : null
          })),
          domainRelationships,
          {
            iterations: 32,
            baseGap: 1.08,
            radiusScale: 1.64,
            repulsionRangeScale: 2.35,
            repulsionStrength: 0.78,
            fieldRepulsionStrength: 0.42,
            nodeEdgeRepulsionStrength: 0.58,
            linkStrength: 0.13,
            anchorStrength: 0.004,
            maxStep: 0.62,
            maxFieldRadius: 64,
            planarRepulsion: true
          }
        );
        visible.forEach((node) => {
          if (relaxedPositions[node.id]) node.position = relaxedPositions[node.id];
        });
        return {
          ...descriptor,
          active: descriptor.path === state.currentPath,
          nodes: visible
        };
      });
  }

  function buildClusterScene() {
    const routeDomains = visibleClusterDomains();
    const scene = clusterField.buildScene(routeDomains, {
      maxDetailedClusters: 9,
      compact: routeDomains.some((domain) => domain.projectionMode === "nested"),
      compactPercent: state.demo.settings.nestedCompactnessPercent * 10,
      peripheralDepthShrinkPercent: state.demo.settings.peripheralDepthShrinkPercent
    });
    state.clusterScene = scene;
    state.clusterConnectionEdges = (workspace.exportKnowledge().edges || []).map((edge) => ({
      edge,
      fromEndpoint: workspace.resolveEndpoint(edge.from),
      toEndpoint: workspace.resolveEndpoint(edge.to)
    }));
    return { routeDomains, scene };
  }

  function collectClusterNodes() {
    const scene = state.clusterScene;
    const compressionMultiplier = Math.max(
      1,
      Number(scene.compressionMultiplier) || 1
    );
    const minimumClusterNodeRadius = 0.001 / compressionMultiplier;
    const visibleNodes = scene.clusters.flatMap((cluster) => cluster.nodes.slice(0, 24).map((clusterNode) => {
      const node = clusterNode.sourceNode || clusterNode;
      node.__clusterOwnerPath = cluster.path;
      return {
        kind: "node",
        node,
        ownerPath: cluster.path,
        position: clusterNode.position,
        radius: Math.max(
          minimumClusterNodeRadius,
          Number(clusterNode.__clusterRadius) || minimumClusterNodeRadius
        ),
        level: Number(node.__clusterLevel) || 0,
        focusContext: grammar.resolveFocusContext(
          sameNode(node, state.selected) ? grammar.focusRelations.focused : grammar.focusRelations.distant,
          Boolean(state.selected)
        )
      };
    }));
    const shellProxies = scene.clusters
      .filter((cluster) => cluster.projectionMode === "nested" && cluster.parentCarrierNode)
      .map((cluster) => {
        const node = cluster.parentCarrierNode;
        node.__clusterOwnerPath = cluster.parentPath;
        return {
          kind: "node",
          node,
          ownerPath: cluster.parentPath,
          position: cluster.center,
          radius: cluster.radius,
          level: 0,
          clusterShellProxy: true,
          focusContext: grammar.resolveFocusContext(
            sameNode(node, state.selected) ? grammar.focusRelations.focused : grammar.focusRelations.distant,
            Boolean(state.selected)
          )
        };
      });
    return [...visibleNodes, ...shellProxies];
  }

  function addSpatialTools(items, basis, time) {
    const detailItems = items
      .filter((item) => item.kind === "node" && item.node.lensOpen)
      .sort((a, b) => b.node.lensOpenedAt - a.node.lensOpenedAt)
      .slice(0, 2);

    detailItems.forEach((sourceItem, index) => {
      const node = sourceItem.node;
      const sourcePosition = sourceItem.position;
      const sourceRadius = sourceItem.radius;
      const direction = index % 2 ? -1 : 1;
      const side = V.scale(basis.right, direction * (sourceRadius * 2.95 + 0.95));
      const lift = V.scale(basis.up, sourceRadius * (0.52 + index * 0.28));
      items.push({
        kind: "lens",
        node,
        ownerPath: sourceItem.ownerPath,
        label: `${node.label} · 球镜`,
        position: V.add(sourcePosition, V.add(side, lift)),
        radius: Math.max(0.88, sourceRadius * 1.04),
        sourcePosition,
        focusContext: grammar.resolveFocusContext(grammar.focusRelations.tool, true)
      });
    });

    const menuSource = state.menuFor
      ? items.find((item) => item.kind === "node" && sameNode(item.node, state.menuFor))
      : null;
    if (menuSource) {
      const menuNode = menuSource.node;
      const centre = menuSource.position;
      const menuRadius = menuSource.radius;
      const menuCommands = registry.commandsFor(menuNode);
      const orbitRadius = menuRadius * 2.35 + 0.65;
      menuCommands.forEach((command, index) => {
        const distributedAngle = -Math.PI * 0.82
          + index * (Math.PI * 1.64 / Math.max(1, menuCommands.length - 1));
        const angle = Number.isFinite(command.preferredAngle)
          ? command.preferredAngle
          : distributedAngle;
        const position = V.add(
          centre,
          V.add(
            V.scale(basis.right, Math.cos(angle) * orbitRadius),
            V.scale(basis.up, Math.sin(angle) * orbitRadius)
          )
        );
        items.push({
          kind: "command",
          node: menuNode,
          ownerPath: menuSource.ownerPath,
          commandIntent: command.intent,
          commandId: command.id,
          label: command.label,
          position,
          radius: Math.max(0.18, menuRadius * command.radiusScale),
          focusContext: grammar.resolveFocusContext(grammar.focusRelations.tool, true)
        });
      });
    }

    if (state.depth > 0 || state.worldLens.open) {
      const pathEntries = [
        { label: "全域", targetDepth: 0 },
        ...state.domainStack.map((entry, index) => ({
          label: entry.nodeLabel,
          targetDepth: index + 1
        }))
      ];
      const pathDepth = 6.4;
      const compact = state.width < 640;
      const pathX = state.width - (state.worldLens.open ? (compact ? 56 : 96) : (compact ? 34 : 56));
      const pathStartY = compact ? 104 : 116;
      const desiredPathGap = state.worldLens.open ? (compact ? 34 : 43) : 30;
      const pathEndY = Math.max(pathStartY + 1, state.height - (compact ? 88 : 104));
      const availablePathSpan = pathEndY - pathStartY;
      const pathGap = pathEntries.length > 1
        ? Math.min(desiredPathGap, availablePathSpan / (pathEntries.length - 1))
        : desiredPathGap;
      pathEntries.forEach((entry, index) => {
        const isCurrent = entry.targetDepth === state.depth;
        const stepRadius = isCurrent
          ? clamp(pathGap * 0.28, 4, 12)
          : clamp(pathGap * 0.2, 3, 8);
        items.push({
          kind: "pathStep",
          node: null,
          id: `path-step-${entry.targetDepth}`,
          label: entry.label,
          targetDepth: entry.targetDepth,
          isCurrent,
          position: unprojectScreen(pathX, pathStartY + index * pathGap, pathDepth, basis),
          radius: worldRadiusForPixels(stepRadius, pathDepth),
          focusContext: grammar.resolveFocusContext(grammar.focusRelations.tool, true)
        });
      });
    }
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    if (rect.width === state.width && rect.height === state.height && dpr === state.dpr) {
      return;
    }
    state.width = Math.max(1, rect.width);
    state.height = Math.max(1, rect.height);
    state.dpr = dpr;
    canvas.width = Math.round(state.width * dpr);
    canvas.height = Math.round(state.height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStars();
  }

  function buildStars() {
    const random = randomFactory(928371);
    const areaFactor = clamp((state.width * state.height) / 1000000, 0.55, 1.35);
    const count = Math.round(150 * areaFactor);
    state.starField = Array.from({ length: count }, () => ({
      x: random() * state.width,
      y: random() * state.height,
      radius: 0.28 + Math.pow(random(), 4) * 1.25,
      alpha: 0.18 + random() * 0.58
    }));
  }

  function drawStars(renderContext = context) {
    const context = renderContext;
    context.save();
    context.fillStyle = theme.star;
    for (const star of state.starField) {
      context.globalAlpha = star.alpha;
      context.beginPath();
      context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function drawDomainBackdrop(renderContext = context) {
    const context = renderContext;
    if (state.depth === 0) {
      return;
    }
    const entry = state.domainStack.at(-1);
    if (!entry) {
      return;
    }
    const centreX = state.width * 0.54;
    const centreY = state.height * 0.49;
    const reach = Math.max(state.width, state.height) * 0.78;
    const seed = hashText(`${entry.nodeId || entry.nodeLabel}:domain-backdrop`);

    context.save();
    const field = context.createRadialGradient(
      centreX + reach * 0.025,
      centreY - reach * 0.018,
      Math.max(12, reach * 0.035),
      centreX,
      centreY,
      reach
    );
    field.addColorStop(0, theme["space-0"]);
    field.addColorStop(0.18, theme["space-0"]);
    field.addColorStop(0.48, theme["sphere-core"]);
    field.addColorStop(0.76, theme["space-2"]);
    field.addColorStop(1, "transparent");
    context.globalAlpha = 0.5;
    context.fillStyle = field;
    context.fillRect(0, 0, state.width, state.height);

    context.lineCap = "round";
    context.globalCompositeOperation = "source-over";
    context.setLineDash([]);
    for (let layer = 0; layer < DOMAIN_TUNNEL_DEPTH_LAYERS; layer += 1) {
      const depth = layer / Math.max(1, DOMAIN_TUNNEL_DEPTH_LAYERS - 1);
      const layerSeed = hashText(`${seed}:${layer}`);
      const factor = 0.13 + Math.pow(depth, 1.38) * 0.95;
      const radiusX = reach * factor;
      const radiusY = radiusX * (0.5 + ((layerSeed >>> 5) % 17) * 0.007);
      const driftX = ((((layerSeed >>> 9) % 31) - 15) / 15) * reach * 0.018 * depth;
      const driftY = ((((layerSeed >>> 14) % 29) - 14) / 14) * reach * 0.014 * depth;
      const rotation = -0.2 + (((layerSeed >>> 19) % 37) - 18) * 0.006;

      context.strokeStyle = layer % 3 === 1 ? theme["accent-2"] : theme["sphere-edge"];
      context.globalAlpha = 0.005 + depth * 0.012;
      context.lineWidth = Math.max(2, reach * (0.008 + depth * 0.014));
      context.shadowColor = layer % 3 === 1 ? theme["accent-2"] : theme["sphere-edge"];
      context.shadowBlur = 17 + depth * 28;

      for (let fragment = 0; fragment < DOMAIN_TUNNEL_FRAGMENTS; fragment += 1) {
        const fragmentSeed = hashText(`${layerSeed}:${fragment}`);
        const fragmentStart = fragment / DOMAIN_TUNNEL_FRAGMENTS * Math.PI * 2
          + (fragmentSeed % 41) * 0.009;
        const fragmentEnd = fragmentStart + 0.74 + ((fragmentSeed >>> 6) % 43) * 0.014;
        context.beginPath();
        context.ellipse(
          centreX + driftX + Math.sin(fragmentSeed) * reach * 0.004,
          centreY + driftY + Math.cos(fragmentSeed) * reach * 0.003,
          radiusX * (0.97 + ((fragmentSeed >>> 11) % 9) * 0.006),
          radiusY * (0.96 + ((fragmentSeed >>> 15) % 11) * 0.007),
          rotation + ((fragmentSeed >>> 20) % 9) * 0.004,
          fragmentStart,
          fragmentEnd
        );
        context.stroke();
      }
    }

    for (let strand = 0; strand < 9; strand += 1) {
      const strandSeed = hashText(`${seed}:strand:${strand}`);
      const startAngle = strand / 9 * Math.PI * 2 + (strandSeed % 29) * 0.008;
      const curl = 0.82 + ((strandSeed >>> 6) % 23) * 0.018;
      context.beginPath();
      for (let point = 0; point <= 28; point += 1) {
        const spiralProgress = point / 28;
        const spiralRadius = reach * (1.06 - spiralProgress * 0.91);
        const spiralAngle = startAngle + spiralProgress * curl * Math.PI;
        const taper = 0.54 + Math.sin(spiralProgress * Math.PI) * 0.035;
        const spiralX = centreX + Math.cos(spiralAngle) * spiralRadius;
        const spiralY = centreY + Math.sin(spiralAngle) * spiralRadius * taper;
        if (point === 0) {
          context.moveTo(spiralX, spiralY);
        } else {
          context.lineTo(spiralX, spiralY);
        }
      }
      context.globalAlpha = 0.004 + (strand % 3) * 0.002;
      context.strokeStyle = strand % 4 === 0 ? theme["accent-2"] : theme["sphere-edge"];
      context.lineWidth = Math.max(2, reach * (0.006 + (strand % 3) * 0.002));
      context.shadowColor = context.strokeStyle;
      context.shadowBlur = 22 + (strand % 4) * 5;
      context.stroke();
    }
    context.setLineDash([]);
    context.shadowBlur = 0;

    const labelSize = clamp(state.width * 0.071, 38, 104);
    context.globalAlpha = 0.075;
    context.fillStyle = theme.ink;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = `500 ${labelSize}px ${theme.fontDisplay}`;
    context.fillText(entry.nodeLabel, centreX, centreY + labelSize * 0.08);
    context.restore();
  }

  function drawStaticBackdrop() {
    const entry = state.domainStack.at(-1);
    const key = [
      state.width,
      state.height,
      state.dpr,
      state.depth,
      entry && (entry.nodeId || entry.nodeLabel),
      theme.star,
      theme["space-0"],
      theme["space-2"],
      theme["sphere-core"],
      theme["sphere-edge"],
      theme["accent-2"],
      theme.ink
    ].join("|");
    if (!staticBackdropCache || staticBackdropCache.key !== key) {
      const layer = document.createElement("canvas");
      layer.width = canvas.width;
      layer.height = canvas.height;
      const layerContext = layer.getContext("2d", { alpha: true });
      layerContext.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      drawStars(layerContext);
      drawDomainBackdrop(layerContext);
      staticBackdropCache = { key, layer };
    }
    context.drawImage(staticBackdropCache.layer, 0, 0, state.width, state.height);
  }

  function drawLine(from, to, color, alpha, width) {
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
  }

  function drawClusterVoid() {
    context.save();
    context.globalAlpha = 1;
    context.fillStyle = "#000";
    context.fillRect(0, 0, state.width, state.height);
    context.restore();
  }

  function drawClusterTunnelInterior(cluster, screen) {
    const seed = hashText(`${cluster.path}:cluster-tunnel`);
    const interiorStrength = cluster.projectionMode === "nested"
      ? state.demo.settings.nestedTunnelInteriorPercent / 100
      : 1;
    context.save();
    context.beginPath();
    context.arc(screen.x, screen.y, screen.radius * 0.98, 0, Math.PI * 2);
    context.clip();

    const well = context.createRadialGradient(
      screen.x - screen.radius * 0.09,
      screen.y - screen.radius * 0.11,
      Math.max(2, screen.radius * 0.035),
      screen.x,
      screen.y,
      screen.radius
    );
    well.addColorStop(0, "rgb(0 4 11 / 22%)");
    well.addColorStop(0.42, "rgb(5 18 31 / 26%)");
    well.addColorStop(0.78, "rgb(10 25 46 / 18%)");
    well.addColorStop(1, "rgb(5 10 23 / 8%)");
    context.fillStyle = well;
    context.globalAlpha = interiorStrength;
    context.fillRect(
      screen.x - screen.radius,
      screen.y - screen.radius,
      screen.radius * 2,
      screen.radius * 2
    );

    context.lineCap = "round";
    context.globalCompositeOperation = "screen";
    for (let layer = 0; layer < 11; layer += 1) {
      const progress = layer / 10;
      const layerSeed = hashText(`${seed}:${layer}`);
      const radiusX = screen.radius * (0.12 + Math.pow(progress, 1.28) * 0.84);
      const radiusY = radiusX * (0.5 + ((layerSeed >>> 4) % 19) * 0.009);
      const rotation = -0.28 + ((layerSeed >>> 11) % 37) * 0.013;
      context.strokeStyle = layer % 3 === 1 ? theme["accent-2"] : theme["sphere-edge"];
      context.globalAlpha = (0.006 + progress * 0.014) * interiorStrength;
      context.lineWidth = Math.max(1.2, screen.radius * (0.01 + progress * 0.012));
      context.shadowColor = context.strokeStyle;
      context.shadowBlur = 9 + progress * 16;
      for (let fragment = 0; fragment < 4; fragment += 1) {
        const fragmentSeed = hashText(`${layerSeed}:${fragment}`);
        const start = fragment / 4 * Math.PI * 2 + (fragmentSeed % 31) * 0.014;
        const end = start + 0.62 + ((fragmentSeed >>> 5) % 29) * 0.018;
        context.beginPath();
        context.ellipse(
          screen.x + ((((fragmentSeed >>> 9) % 11) - 5) / 5) * screen.radius * 0.018,
          screen.y + ((((fragmentSeed >>> 14) % 11) - 5) / 5) * screen.radius * 0.014,
          radiusX,
          radiusY,
          rotation,
          start,
          end
        );
        context.stroke();
      }
    }
    context.restore();
  }

  function drawClusterField(scene, basis) {
    state.clusterHitRegions = [];
    state.clusterDetailCandidates = [];
    if (!scene || !scene.clusters.length) return;
    const clusterLabelBoxes = [];
    const labelRingOffsets = [0, 18, 36, 54, 72];
    context.save();
    context.lineCap = "round";
    for (const corridor of scene.corridors) {
      const from = project(corridor.from, 0.01, basis);
      const to = project(corridor.to, 0.01, basis);
      if (!from || !to) continue;
      const fromOffset = state.clusterScreenOffsets.get(corridor.fromPath) || { x: 0, y: 0 };
      const toOffset = state.clusterScreenOffsets.get(corridor.toPath) || { x: 0, y: 0 };
      from.x += fromOffset.x;
      from.y += fromOffset.y;
      to.x += toOffset.x;
      to.y += toOffset.y;
      const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
      gradient.addColorStop(0, "rgb(82 186 255 / 3%)");
      gradient.addColorStop(0.5, "rgb(135 118 255 / 8%)");
      gradient.addColorStop(1, "rgb(82 186 255 / 3%)");
      context.strokeStyle = gradient;
      context.lineWidth = 8;
      context.shadowColor = theme["accent-2"];
      context.shadowBlur = 20;
      context.beginPath();
      context.moveTo(from.x, from.y);
      const bend = Math.min(56, Math.abs(to.x - from.x) * 0.14);
      context.bezierCurveTo(from.x + bend, from.y - bend * 0.3, to.x - bend, to.y + bend * 0.3, to.x, to.y);
      context.stroke();
    }
    for (const cluster of scene.clusters) {
      const screen = project(cluster.center, cluster.radius, basis);
      if (!screen) continue;
      const screenOffset = state.clusterScreenOffsets.get(cluster.path) || { x: 0, y: 0 };
      screen.x += screenOffset.x;
      screen.y += screenOffset.y;
      screen.radius = exactProjectedRadius(cluster.radius, screen.depth);
      state.clusterHitRegions.push({
        path: cluster.path,
        depth: cluster.depth,
        x: screen.x,
        y: screen.y,
        radius: screen.radius,
        worldRadius: cluster.radius,
        screenDepth: screen.depth,
        center: { ...cluster.center },
        nodeScale: cluster.nodeScale,
        pathLabels: pathLabelsForPath(cluster.path),
        magnifierNode: cluster.detailNode || null,
        detail: clusterDetailText(cluster)
      });
      drawClusterTunnelInterior(cluster, screen);
      const nestedTunnelStrength = state.demo.settings.nestedTunnelPercent / 100;
      const interiorStrength = cluster.projectionMode === "nested"
        ? state.demo.settings.nestedTunnelInteriorPercent / 100
        : 1;
      const glow = context.createRadialGradient(
        screen.x - screen.radius * 0.13,
        screen.y - screen.radius * 0.16,
        screen.radius * 0.08,
        screen.x,
        screen.y,
        screen.radius * 1.14
      );
      const coreAlpha = (cluster.active ? 0.034 : 0.022) * interiorStrength;
      glow.addColorStop(0, `rgb(112 192 255 / ${coreAlpha * 0.36})`);
      glow.addColorStop(0.58, `rgb(74 153 224 / ${coreAlpha})`);
      glow.addColorStop(0.86, `rgb(119 103 244 / ${coreAlpha * 0.72})`);
      glow.addColorStop(1, "transparent");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(screen.x, screen.y, screen.radius * 1.14, 0, Math.PI * 2);
      context.fill();

      context.strokeStyle = cluster.projectionMode === "nested"
        ? `rgb(156 225 255 / ${0.58 * nestedTunnelStrength})`
        : cluster.active
          ? "rgb(138 218 255 / 10%)"
          : "rgb(106 171 229 / 5%)";
      context.lineWidth = cluster.projectionMode === "nested"
        ? 1
        : Math.max(8, screen.radius * 0.09);
      context.shadowColor = cluster.active ? theme.accent : theme["accent-2"];
      context.shadowBlur = cluster.projectionMode === "nested"
        ? 4 * nestedTunnelStrength
        : cluster.active ? 22 : 14;
      context.beginPath();
      context.arc(screen.x, screen.y, screen.radius * 0.98, 0, Math.PI * 2);
      context.stroke();
      if (cluster.parentCarrierNode) {
        drawConfirmationRipples(screen, cluster.parentCarrierNode);
      }

      context.shadowBlur = 8;
      const clusterHierarchyHighlighted = Boolean(
        state.semanticScene
        && state.semanticScene.byId(sceneAdapter.sceneEntityIdForItem({
          kind: "domain",
          path: cluster.path,
          ownerPath: cluster.parentPath
        }))?.emphasis.label
      );
      const clusterLabelAlpha = state.middleLabelFocus
        ? (
          clusterHierarchyHighlighted
            ? state.demo.settings.highlightedLabelBrightnessPercent
            : state.demo.settings.otherLabelBrightnessPercent
        ) / 100
        : cluster.active ? 0.82 : 0.54;
      context.fillStyle = clusterHierarchyHighlighted ? theme.ink : cluster.active ? theme.ink : theme.muted;
      context.globalAlpha = clusterLabelAlpha;
      context.font = `500 12px ${theme.fontMono}`;
      context.textAlign = "center";
      context.textBaseline = "bottom";
      const clusterLabel = `${String(cluster.depth).padStart(2, "0")} · ${cluster.label}${cluster.lightweight ? ` · ${cluster.nodeCount}` : ""}`;
      const labelWidth = Math.ceil(context.measureText(clusterLabel).width) + 8;
      const labelCandidates = labelRingOffsets.flatMap((offset) => ([
        { x: screen.x, y: screen.y - screen.radius - 10 - offset },
        { x: screen.x, y: screen.y + screen.radius + 22 + offset },
        { x: screen.x - screen.radius - 12 - offset - labelWidth / 2, y: screen.y },
        { x: screen.x + screen.radius + 12 + offset + labelWidth / 2, y: screen.y }
      ])).map((candidate) => {
        const box = {
          left: candidate.x - labelWidth / 2,
          top: candidate.y - 14,
          right: candidate.x + labelWidth / 2,
          bottom: candidate.y + 2
        };
        const collision = clusterLabelBoxes.reduce((sum, other) => sum + overlapArea(box, other), 0);
        const overflow = Math.max(0, 12 - box.left)
          + Math.max(0, box.right - state.width + 12)
          + Math.max(0, 12 - box.top)
          + Math.max(0, box.bottom - state.height + 12);
        return { ...candidate, box, score: collision * 20 + overflow * 40 + Math.abs(candidate.y - screen.y) * 0.02 };
      });
      const labelPlacement = labelCandidates.reduce((best, candidate) => (
        !best || candidate.score < best.score ? candidate : best
      ), null);
      if (clusterLabelAlpha > 0.001) {
        clusterLabelBoxes.push(labelPlacement.box);
        state.floatingDetailBoxes.push(labelPlacement.box);
        context.fillText(clusterLabel, labelPlacement.x, labelPlacement.y);
      }
      if (
        cluster.detailNode
        && detailModeFor(cluster.detailNode) === "floating"
        && clusterDetailText(cluster)
      ) {
        state.clusterDetailCandidates.push({
          kind: "domain",
          path: cluster.path,
          cluster,
          node: cluster.detailNode,
          key: `${cluster.parentPath || ""}::${cluster.detailNode.id}`,
          ownerPath: cluster.parentPath,
          screen,
          x: labelPlacement.x,
          y: labelPlacement.y + 10,
          textAlign: "center"
        });
      }
      context.globalAlpha = 1;
    }
    context.restore();
  }

  function resolveClusterScreenLayout(rendered, basis) {
    state.clusterScreenOffsets.clear();
    if (!state.clusterFieldOpen) return;
    const projectionModes = new Set(
      state.clusterScene.clusters.map((cluster) => cluster.projectionMode)
    );
    if (projectionModes.has("peripheral")) {
      const clusterScreens = state.clusterScene.clusters.map((cluster) => {
        const screen = project(cluster.center, cluster.radius, basis);
        if (screen) screen.radius = exactProjectedRadius(cluster.radius, screen.depth);
        return screen ? { cluster, screen, anchor: { x: screen.x, y: screen.y } } : null;
      }).filter(Boolean);
      const safetyGap = 3;
      for (let iteration = 0; iteration < 640; iteration += 1) {
        let maximumPenetration = 0;
        for (let leftIndex = 0; leftIndex < clusterScreens.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < clusterScreens.length; rightIndex += 1) {
            const left = clusterScreens[leftIndex];
            const right = clusterScreens[rightIndex];
            const dx = right.screen.x - left.screen.x;
            const dy = right.screen.y - left.screen.y;
            const distance = Math.hypot(dx, dy);
            const penetration = left.screen.radius + right.screen.radius + safetyGap - distance;
            if (!(penetration > 0.01)) continue;
            const seed = hashText(`${left.cluster.path}|${right.cluster.path}`);
            const angle = seed / 4294967296 * Math.PI * 2;
            const direction = distance > 0.001
              ? { x: dx / distance, y: dy / distance }
              : { x: Math.cos(angle), y: Math.sin(angle) };
            const correction = penetration * 0.505;
            left.screen.x -= direction.x * correction;
            left.screen.y -= direction.y * correction;
            right.screen.x += direction.x * correction;
            right.screen.y += direction.y * correction;
            maximumPenetration = Math.max(maximumPenetration, penetration);
          }
        }
        if (maximumPenetration <= 0.01) break;
      }
      for (const entry of clusterScreens) {
        state.clusterScreenOffsets.set(entry.cluster.path, {
          x: entry.screen.x - entry.anchor.x,
          y: entry.screen.y - entry.anchor.y
        });
      }
      for (const item of rendered) {
        if (!item.screen || !item.ownerPath) continue;
        const offset = state.clusterScreenOffsets.get(item.ownerPath);
        if (!offset) continue;
        item.screen.x += offset.x;
        item.screen.y += offset.y;
      }
    }
    if (!projectionModes.has("nested")) return;
    const nodes = rendered.filter((item) => (
      item.kind === "node"
      && item.node
      && !item.clusterShellProxy
      && item.screen
      && item.ownerPath
    ));
    if (nodes.length < 2) return;
    const clusterScreens = new Map(state.clusterScene.clusters.map((cluster) => {
      const screen = project(cluster.center, cluster.radius, basis);
      if (screen) screen.radius = exactProjectedRadius(cluster.radius, screen.depth);
      return [cluster.path, screen];
    }).filter((entry) => Boolean(entry[1])));
    const anchors = new Map(nodes.map((item) => [item, { x: item.screen.x, y: item.screen.y }]));
    const compressionMultiplier = Math.max(
      1,
      Number(state.clusterScene.compressionMultiplier) || 1
    );
    const safetyGap = 0.65 / compressionMultiplier;
    const shellMargin = 0.1 / compressionMultiplier;

    for (let iteration = 0; iteration < 96; iteration += 1) {
      let maximumPenetration = 0;
      for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
          const left = nodes[leftIndex];
          const right = nodes[rightIndex];
          const dx = right.screen.x - left.screen.x;
          const dy = right.screen.y - left.screen.y;
          const distance = Math.hypot(dx, dy);
          const penetration = left.screen.radius + right.screen.radius + safetyGap - distance;
          if (!(penetration > 0.01)) continue;
          const seed = hashText(`${left.ownerPath}:${left.node.id}|${right.ownerPath}:${right.node.id}`);
          const angle = seed / 4294967296 * Math.PI * 2;
          const direction = distance > 0.001
            ? { x: dx / distance, y: dy / distance }
            : { x: Math.cos(angle), y: Math.sin(angle) };
          const correction = penetration * 0.505;
          left.screen.x -= direction.x * correction;
          left.screen.y -= direction.y * correction;
          right.screen.x += direction.x * correction;
          right.screen.y += direction.y * correction;
          maximumPenetration = Math.max(maximumPenetration, penetration);
        }
      }

      for (const item of nodes) {
        const shell = clusterScreens.get(item.ownerPath);
        if (!shell) continue;
        const dx = item.screen.x - shell.x;
        const dy = item.screen.y - shell.y;
        const distance = Math.hypot(dx, dy);
        const boundary = Math.max(0, shell.radius - item.screen.radius - shellMargin);
        if (distance > boundary && distance > 0.001) {
          item.screen.x = shell.x + dx / distance * boundary;
          item.screen.y = shell.y + dy / distance * boundary;
        }
        const anchor = anchors.get(item);
        item.screen.x += (anchor.x - item.screen.x) * 0.002;
        item.screen.y += (anchor.y - item.screen.y) * 0.002;
      }
      if (maximumPenetration <= 0.01) break;
    }
  }

  function drawInsertionVortex(point, carrierRadius, angle) {
    const radius = visualModel.insertionVortexRadius(carrierRadius);
    if (!(radius > 0)) return;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(angle || 0);
    context.fillStyle = theme["space-0"];
    context.globalAlpha = 0.96;
    context.beginPath();
    context.arc(0, 0, radius * 0.82, 0, Math.PI * 2);
    context.fill();
    context.globalCompositeOperation = "screen";
    for (let ring = 0; ring < 4; ring += 1) {
      const ringRadius = radius * (0.38 + ring * 0.2);
      context.globalAlpha = 0.88 - ring * 0.11;
      context.strokeStyle = ring % 2 === 0 ? theme.accent : theme["accent-2"];
      context.lineWidth = Math.max(0.7, radius * (0.14 - ring * 0.014));
      context.shadowColor = context.strokeStyle;
      context.shadowBlur = radius * (0.66 - ring * 0.07);
      context.beginPath();
      context.ellipse(
        0,
        0,
        ringRadius,
        ringRadius * (0.44 + ring * 0.06),
        ring * 0.46,
        -Math.PI * (0.72 - ring * 0.04),
        Math.PI * (0.76 + ring * 0.07)
      );
      context.stroke();
    }
    context.shadowBlur = 0;
    context.globalAlpha = 0.74;
    context.fillStyle = theme["accent-2"];
    context.beginPath();
    context.arc(0, 0, Math.max(0.65, radius * 0.1), 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawTopologyLink(from, to, relationship) {
    const deltaX = to.screen.x - from.screen.x;
    const deltaY = to.screen.y - from.screen.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 1) {
      return;
    }

    const directionX = deltaX / distance;
    const directionY = deltaY / distance;
    const normalX = -directionY;
    const normalY = directionX;
    const startInset = Math.min(from.screen.radius * 0.94, distance * 0.28);
    const endInset = Math.min(to.screen.radius * 0.94, distance * 0.28);
    const start = {
      x: from.screen.x + directionX * startInset,
      y: from.screen.y + directionY * startInset
    };
    const end = {
      x: to.screen.x - directionX * endInset,
      y: to.screen.y - directionY * endInset
    };
    const bendSeed = hashText(`${relationship.fromId}:${relationship.toId}`);
    const bendDirection = bendSeed % 2 === 0 ? 1 : -1;
    const bend = distance * (0.065 + ((bendSeed >>> 2) % 6) * 0.009) * bendDirection;
    const controlOne = {
      x: start.x + (end.x - start.x) * 0.32 + normalX * bend,
      y: start.y + (end.y - start.y) * 0.32 + normalY * bend
    };
    const controlTwo = {
      x: start.x + (end.x - start.x) * 0.7 + normalX * bend * 0.72,
      y: start.y + (end.y - start.y) * 0.7 + normalY * bend * 0.72
    };
    const contextWeight = Math.min(
      from.focusContext ? from.focusContext.connectionAlpha : 1,
      to.focusContext ? to.focusContext.connectionAlpha : 1
    );
    const effectiveContextWeight = Math.max(0.5, contextWeight);
    const depthFade = clamp(1.04 - (from.screen.depth + to.screen.depth) / 64, 0.24, 0.88);
    const focus = state.focused || state.selected;
    const localFocus = Boolean(focus && (from.node === focus || to.node === focus));
    const hierarchy = relationship.kind === "hierarchy";
    const hierarchyHighlighted = isMiddleRelationshipHighlighted(from, to);
    const relationshipBrightness = state.middleLabelFocus
      ? relationshipHierarchyBrightnessPercent(from, to) / 100
      : null;
    const pending = relationship.pending === true;
    const edgeId = relationship.edge ? workspaceModel.edgeIdentity(relationship.edge) : "";
    const magnifierHighlighted = state.detailMagnifier.enabled
      && state.detailMagnifier.targetKind === "relationship"
      && state.detailMagnifier.targetEdgeId === edgeId;
    const magnifierFocusActive = state.detailMagnifier.enabled
      && Boolean(state.detailMagnifier.targetKey);
    const editState = relationship.edge ? workspace.edgeVisualState(relationship.edge) : "idle";
    const editColor = editState === "delete"
      ? theme.delete
      : editState === "update"
        ? theme.update
        : theme["nebula-blue"];
    const visibilityFloor = hierarchy ? 0.12 : 0.16;
    const weightedAlpha = (hierarchy ? 0.22 : 0.28) * depthFade * effectiveContextWeight;
    const alpha = Math.max(visibilityFloor, weightedAlpha) + (localFocus ? 0.12 : 0);
    const baseRelationshipAlpha = relationshipBrightness === null
      ? clamp(alpha, visibilityFloor, hierarchy ? 0.42 : 0.46)
      : relationshipBrightness;
    const relationshipStyle = demoModel.relationshipVisualStyle(state.demo.settings, {
      baseWidth: hierarchy ? 0.9 : 1.35,
      baseAlpha: baseRelationshipAlpha
    });

    context.save();
    context.globalAlpha = magnifierHighlighted ? 1 : magnifierFocusActive
      ? 0.055
      : relationshipStyle.alpha;
    context.strokeStyle = editColor;
    context.lineWidth = relationshipStyle.lineWidth;
    if (relationshipStyle.glowStrength > 0) {
      context.shadowColor = editColor;
      context.shadowBlur = 7 * relationshipStyle.glowStrength;
    }
    if (magnifierHighlighted) {
      context.lineWidth = Math.max(3.2, context.lineWidth * 2.4);
      context.shadowColor = theme.accent;
      context.shadowBlur = 14;
    }
    if (editState !== "idle") {
      context.lineWidth = Math.max(
        relationshipStyle.lineWidth,
        (editState === "delete" ? 2.4 : 2) * relationshipStyle.glyphScale
      );
    }
    context.lineCap = "round";
    context.setLineDash(pending ? [8, 7] : hierarchy ? [3, 6] : []);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.bezierCurveTo(
      controlOne.x,
      controlOne.y,
      controlTwo.x,
      controlTwo.y,
      end.x,
      end.y
    );
    context.stroke();
    context.setLineDash([]);

    if (!hierarchy && !pending) {
      context.lineJoin = "round";

      const tangentX = end.x - controlTwo.x;
      const tangentY = end.y - controlTwo.y;
      const tangentLength = Math.hypot(tangentX, tangentY);
      if (tangentLength > 0.5) {
        const arrowAngle = Math.atan2(tangentY, tangentX);
        const arrowSize = clamp(distance * 0.034, 4, 10) * relationshipStyle.glyphScale;
        const spread = 0.4;
        context.beginPath();
        context.moveTo(
          end.x - Math.cos(arrowAngle - spread) * arrowSize,
          end.y - Math.sin(arrowAngle - spread) * arrowSize
        );
        context.lineTo(end.x, end.y);
        context.lineTo(
          end.x - Math.cos(arrowAngle + spread) * arrowSize,
          end.y - Math.sin(arrowAngle + spread) * arrowSize
        );
        context.strokeStyle = editColor;
        context.lineWidth = relationshipStyle.lineWidth;
        context.stroke();
      }

      const originTangentX = controlOne.x - start.x;
      const originTangentY = controlOne.y - start.y;
      const originTangentLength = Math.hypot(originTangentX, originTangentY);
      if (originTangentLength > 0.5) {
        const originAngle = Math.atan2(originTangentY, originTangentX);
        const tailDepth = clamp(distance * 0.034, 5, 11) * relationshipStyle.glyphScale;
        const tailWidth = clamp(distance * 0.026, 4, 8) * relationshipStyle.glyphScale;
        const forwardX = Math.cos(originAngle);
        const forwardY = Math.sin(originAngle);
        const sideX = -forwardY;
        const sideY = forwardX;
        const backX = start.x - forwardX * tailDepth;
        const backY = start.y - forwardY * tailDepth;
        const notchX = start.x - forwardX * tailDepth * 0.42;
        const notchY = start.y - forwardY * tailDepth * 0.42;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(backX + sideX * tailWidth, backY + sideY * tailWidth);
        context.lineTo(notchX, notchY);
        context.lineTo(backX - sideX * tailWidth, backY - sideY * tailWidth);
        context.closePath();
        context.strokeStyle = editColor;
        context.lineWidth = relationshipStyle.lineWidth;
        context.stroke();
      }
    }

    const linkAngle = Math.atan2(deltaY, deltaX);
    if (relationship.fromInsertion) {
      drawInsertionVortex(start, from.screen.radius, linkAngle + Math.PI);
    }
    if (relationship.toInsertion) {
      drawInsertionVortex(end, to.screen.radius, linkAngle);
    }

    const labelDistanceFloor = hierarchy ? 86 : 96;
    if (relationship.showLabel !== false && distance >= labelDistanceFloor) {
      const labelX = (start.x + end.x) * 0.5 + normalX * bend * 0.58;
      const labelY = (start.y + end.y) * 0.5 + normalY * bend * 0.58;
      const relationshipLabelStyle = demoModel.relationshipVisualStyle(state.demo.settings, {
        baseWidth: 1,
        baseAlpha: relationshipBrightness === null
          ? hierarchy ? 0.5 : 0.62
          : relationshipBrightness
      });
      context.globalAlpha = relationshipLabelStyle.alpha;
      context.fillStyle = editColor;
      context.font = `italic 500 11px ${theme.fontBody}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.shadowColor = theme["space-0"];
      context.shadowBlur = 5;
      context.fillText(relationship.label, labelX, labelY);
    }
    if (relationship.edge) {
      for (const sample of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const inverse = 1 - sample;
        const hitX = inverse ** 3 * start.x
          + 3 * inverse ** 2 * sample * controlOne.x
          + 3 * inverse * sample ** 2 * controlTwo.x
          + sample ** 3 * end.x;
        const hitY = inverse ** 3 * start.y
          + 3 * inverse ** 2 * sample * controlOne.y
          + 3 * inverse * sample ** 2 * controlTwo.y
          + sample ** 3 * end.y;
        state.relationHitRegions.push({
          item: { kind: "relationship", edge: relationship.edge, node: null, label: relationship.label },
          x: hitX,
          y: hitY,
          radius: Math.max(14, Math.min(30, distance * 0.09)),
          priority: 64
        });
      }
    }
    context.restore();
  }

  function drawConnections(rendered) {
    state.relationHitRegions = [];
    const renderedNodes = new Map(
      rendered
        .filter((item) => item.kind === "node" && item.node)
        .map((item) => [item.node.id, item])
    );
    const relationships = visualModel.relationshipPairs(existingNodes(state.nodes));
    const labelledHierarchyParents = new Set();
    const labelledAssociationSources = new Set();
    let associationLabelCount = 0;
    for (const relationship of relationships) {
      const from = renderedNodes.get(relationship.fromId);
      const to = renderedNodes.get(relationship.toId);
      if (from && to) {
        const edge = {
          id: `base:${state.currentPath}:${[relationship.fromId, relationship.toId].sort().join("<->")}`,
          from: workspaceModel.qualifiedEndpoint(state.currentPath, from.node, state.crumbs),
          to: workspaceModel.qualifiedEndpoint(state.currentPath, to.node, state.crumbs),
          crossDomain: false,
          kind: relationship.kind
        };
        if (workspace.isEdgeSuppressed(edge)) continue;
        let showLabel = false;
        if (relationship.kind === "hierarchy") {
          showLabel = !labelledHierarchyParents.has(relationship.fromId);
          labelledHierarchyParents.add(relationship.fromId);
        } else if (!labelledAssociationSources.has(relationship.fromId) && associationLabelCount < 6) {
          showLabel = true;
          labelledAssociationSources.add(relationship.fromId);
          associationLabelCount += 1;
        }
        drawTopologyLink(from, to, { ...relationship, edge, showLabel });
      }
    }

    function boundaryItem(endpoint, side) {
      const seed = hashText(endpoint.key);
      const x = side === "source" ? 72 : state.width - 72;
      const y = clamp(state.height * 0.34 + (seed % 290), 132, state.height - 132);
      return { screen: { x, y, radius: 7, depth: 6.4 }, node: null, focusContext: null };
    }

    function descendantPortalItem(endpoint) {
      const portalId = visualModel.descendantPortalId(
        state.currentPath,
        endpoint && endpoint.path,
        [...renderedNodes.values()].map((item) => ({
          nodeId: item.node.id,
          childPath: childPathFor(item.node, state.currentPath)
        }))
      );
      const portal = portalId ? renderedNodes.get(portalId) || null : null;
      return portal ? { ...portal, insertionVortex: true } : null;
    }

    function drawWorkspaceEdge(edge, pending = false) {
      const resolvedFrom = workspace.resolveEndpoint(edge.from);
      const resolvedTo = workspace.resolveEndpoint(edge.to);
      const crossDomain = resolvedFrom.path !== resolvedTo.path;
      let from = resolvedFrom.path === state.currentPath ? renderedNodes.get(resolvedFrom.nodeId) : null;
      let to = resolvedTo.path === state.currentPath ? renderedNodes.get(resolvedTo.nodeId) : null;
      if (!from && !to) return;
      if (!from) from = descendantPortalItem(resolvedFrom) || boundaryItem(resolvedFrom, "source");
      if (!to) to = descendantPortalItem(resolvedTo) || boundaryItem(resolvedTo, "target");
      drawTopologyLink(from, to, {
        fromId: resolvedFrom.nodeId,
        toId: resolvedTo.nodeId,
        kind: crossDomain ? "cross-domain" : "association",
        label: crossDomain ? `跨域 · ${edge.from.label} / ${edge.to.label}` : (edge.label || "关联"),
        showLabel: true,
        fromInsertion: from.insertionVortex === true,
        toInsertion: to.insertionVortex === true,
        edge,
        pending: pending
      });
      if (pending) {
        context.save();
        context.globalAlpha = 0.72;
        context.fillStyle = theme.update;
        context.font = `500 11px ${theme.fontMono}`;
        context.textAlign = "center";
        context.fillText("ENTER 提交", (from.screen.x + to.screen.x) * 0.5, (from.screen.y + to.screen.y) * 0.5 - 16);
        context.restore();
      }
    }

    workspace.edgesForPath(state.currentPath).forEach((edge) => drawWorkspaceEdge(edge));

    const transaction = workspace.transaction();
    if (transaction && transaction.kind === "edge-create") {
      if (transaction.target) {
        const pendingEdge = {
          id: workspaceModel.edgeIdentity({ from: transaction.source, to: transaction.target }),
          from: transaction.source,
          to: transaction.target,
          label: "关联",
          crossDomain: transaction.source.path !== transaction.target.path
        };
        drawWorkspaceEdge(pendingEdge, true);
      } else {
        const source = transaction.source.path === state.currentPath
          ? renderedNodes.get(transaction.source.nodeId)
          : boundaryItem(transaction.source, "source");
        if (source) {
          drawLine(source.screen, state.pointerPosition, theme.update, 0.74, 1.7);
          context.save();
          context.globalAlpha = 0.76;
          context.fillStyle = theme.update;
          context.font = `500 11px ${theme.fontMono}`;
          context.fillText(`起点 · ${transaction.source.label}`, source.screen.x + 10, source.screen.y - 14);
          context.restore();
        }
      }
    }

    for (const item of rendered) {
      if (item.kind === "lens" && item.sourceScreen) {
        drawLine(item.sourceScreen, item.screen, theme.accent, 0.34, 0.8);
      }
      if (item.kind === "command") {
        const source = rendered.find((candidate) => candidate.kind === "node" && candidate.node === item.node);
        if (source) {
          drawLine(source.screen, item.screen, theme.accent, 0.25, 0.7);
        }
      }
    }

    const detailLenses = rendered.filter((item) => item.kind === "lens");
    if (detailLenses.length === 2) {
      drawLine(detailLenses[0].screen, detailLenses[1].screen, theme["accent-2"], 0.18, 0.7);
    }

  }

  function spherePath(screen) {
    context.beginPath();
    context.arc(screen.x, screen.y, screen.radius, 0, Math.PI * 2);
  }

  function drawMiniTopology(screen, nodes, options = {}) {
    const radius = screen.radius;
    const positions = nodes.slice(0, 9).map((node, index) => {
      const source = options.positionFor ? options.positionFor(node, index) : node.position;
      const position = source || { x: 0, y: 0, z: 0 };
      const depthShift = clamp(position.z / 9, -0.3, 0.3);
      return {
        node,
        x: screen.x + position.x / 8 * radius * 0.72 + depthShift * radius * 0.1 + (options.parallaxX || 0),
        y: screen.y - position.y / 5.5 * radius * 0.58 + depthShift * radius * 0.06 + (options.parallaxY || 0),
        depth: position.z,
        index
      };
    });

    const ordered = [...positions].sort((a, b) => a.depth - b.depth);
    const links = positions.length > 5
      ? [[0, 2], [2, 4], [4, 1], [1, 3], [3, 5], [5, 0]]
      : positions.map((_, index) => [index, (index + 1) % Math.max(1, positions.length)]);
    links.forEach(([fromIndex, toIndex]) => {
      const from = positions[fromIndex];
      const to = positions[toIndex];
      if (from && to && from !== to) {
        drawLine(from, to, theme["sphere-edge"], options.lineAlpha || 0.16, Math.max(0.45, radius * 0.008));
      }
    });

    for (const point of ordered) {
      const highlighted = point.node.id === options.highlightId;
      context.globalAlpha = highlighted ? 0.92 : 0.34 + point.index * 0.035;
      context.fillStyle = highlighted || point.index % 4 === 0 ? theme.accent : theme["sphere-edge"];
      context.beginPath();
      context.arc(
        point.x,
        point.y,
        Math.max(0.9, radius * (highlighted ? 0.048 : 0.025)),
        0,
        Math.PI * 2
      );
      context.fill();
    }
    return positions;
  }

  function drawSurfaceLayer(screen, node) {
    const radius = screen.radius;
    const seed = hashText(`${node.id}:${node.preview || "surface"}`);
    const random = randomFactory(seed);
    const distanceFade = clamp(1.04 - screen.depth / 34, 0.2, 0.72);

    context.save();
    spherePath(screen);
    context.clip();

    const mirrorField = context.createRadialGradient(
      screen.x - radius * 0.28,
      screen.y - radius * 0.32,
      Math.max(1, radius * 0.04),
      screen.x + radius * 0.12,
      screen.y + radius * 0.08,
      radius * 1.08
    );
    mirrorField.addColorStop(0, theme["sphere-edge"]);
    mirrorField.addColorStop(0.34, theme["space-1"]);
    mirrorField.addColorStop(0.72, theme.sphere);
    mirrorField.addColorStop(1, theme["space-0"]);
    context.globalAlpha = 0.72 * clamp(distanceFade + 0.28, 0.5, 1);
    context.fillStyle = mirrorField;
    context.fillRect(screen.x - radius, screen.y - radius, radius * 2, radius * 2);

    const wash = context.createLinearGradient(
      screen.x - radius,
      screen.y + radius * 0.58,
      screen.x + radius,
      screen.y - radius * 0.44
    );
    wash.addColorStop(0, "transparent");
    wash.addColorStop(0.48, theme.sphere);
    wash.addColorStop(1, "transparent");
    context.globalAlpha = 0.46 * clamp(distanceFade + 0.2, 0.44, 0.92);
    context.fillStyle = wash;
    context.fillRect(screen.x - radius, screen.y - radius, radius * 2, radius * 2);

    const bandCount = 1 + seed % 2;
    for (let band = 0; band < bandCount; band += 1) {
      const rotation = -0.72 + random() * 1.28;
      const startAngle = -1.4 + random() * 0.8;
      const sweep = Math.PI * (0.92 + random() * 0.38);
      context.globalAlpha = (0.2 - band * 0.045) * distanceFade;
      context.strokeStyle = band === 0 ? theme["sphere-edge"] : theme["accent-2"];
      context.lineWidth = Math.max(1.1, radius * (0.065 - band * 0.016));
      context.lineCap = "round";
      context.beginPath();
      context.ellipse(
        screen.x + (random() - 0.5) * radius * 0.24,
        screen.y + (random() - 0.5) * radius * 0.2,
        radius * (0.76 + random() * 0.16),
        radius * (0.3 + random() * 0.2),
        rotation,
        startAngle,
        startAngle + sweep
      );
      context.stroke();
    }

    if (radius > 15) {
      const markCount = 2 + (seed >>> 4) % 3;
      context.strokeStyle = theme["sphere-edge"];
      context.lineWidth = Math.max(0.55, radius * 0.009);
      for (let mark = 0; mark < markCount; mark += 1) {
        const angle = random() * Math.PI * 2;
        const reach = radius * (0.2 + random() * 0.38);
        const x = screen.x + Math.cos(angle) * reach;
        const y = screen.y + Math.sin(angle) * reach * 0.72;
        const length = Math.max(2, radius * (0.035 + random() * 0.035));
        context.globalAlpha = (0.28 - mark * 0.025) * distanceFade;
        context.beginPath();
        context.moveTo(x - Math.sin(angle) * length, y + Math.cos(angle) * length);
        context.lineTo(x + Math.sin(angle) * length, y - Math.cos(angle) * length);
        context.stroke();
      }
    }
    context.restore();
  }

  function wrapSurfaceText(text, maxWidth, maxLines) {
    const characters = Array.from(String(text || "").replace(/\s+/g, " ").trim());
    const lines = [];
    let line = "";
    for (const character of characters) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line.trim());
        line = character.trimStart();
        if (lines.length >= maxLines) break;
      } else {
        line = candidate;
      }
    }
    if (lines.length < maxLines && line.trim()) lines.push(line.trim());
    if (lines.length === maxLines && characters.join("").length > lines.join("").length) {
      const lastIndex = lines.length - 1;
      lines[lastIndex] = `${lines[lastIndex].replace(/[.。…\s]+$/, "")}…`;
    }
    return lines;
  }

  function surfaceImageFor(attachment) {
    if (
      !attachment
      || typeof attachment.url !== "string"
      || !attachment.url
      || typeof global.Image !== "function"
    ) return null;
    if (surfaceImageCache.has(attachment.url)) return surfaceImageCache.get(attachment.url);
    const image = new global.Image();
    const record = { image, status: "loading" };
    image.addEventListener("load", () => { record.status = "ready"; }, { once: true });
    image.addEventListener("error", () => { record.status = "error"; }, { once: true });
    image.src = attachment.url;
    surfaceImageCache.set(attachment.url, record);
    if (surfaceImageCache.size > SURFACE_IMAGE_CACHE_LIMIT) {
      surfaceImageCache.delete(surfaceImageCache.keys().next().value);
    }
    return record;
  }

  function shouldRenderMarkdownSurface(screen, node) {
    const transaction = workspace.transaction();
    const editingNodeId = transaction && (
      transaction.draft && transaction.draft.id
      || transaction.node && transaction.node.id
    );
    return Boolean(
      markdownEditor
      && ui.surfaceMarkdownLayer
      && node
      && node.id !== editingNodeId
      && screen
      && screen.radius >= MARKDOWN_SURFACE_RADIUS
      && typeof node.description === "string"
      && node.description.trim()
    );
  }

  function maximizedNodeContentProgress(screen) {
    const viewportRadius = Math.max(1, Math.min(state.width, state.height) * 0.5);
    return smoothstep((screen.radius / viewportRadius - 0.42) / 0.22);
  }

  function syncMarkdownSurfaceOverlays() {
    if (!markdownEditor || !ui.surfaceMarkdownLayer) return;
    const candidates = state.rendered
      .filter((item) => (
        item.kind === "node"
        && item.node
        && !item.clusterShellProxy
        && shouldRenderMarkdownSurface(item.screen, item.node)
      ))
      .sort((left, right) => right.screen.radius - left.screen.radius)
      .slice(0, MAX_MARKDOWN_SURFACES);
    const visibleKeys = new Set();

    candidates.forEach((item) => {
      const key = `${item.ownerPath || nodeOwnerPath(item.node)}::${item.node.id}`;
      visibleKeys.add(key);
      let element = markdownSurfaceElements.get(key);
      if (!element) {
        element = document.createElement("article");
        element.className = "surface-markdown";
        ui.surfaceMarkdownLayer.appendChild(element);
        markdownSurfaceElements.set(key, element);
      }
      const source = item.node.description.trim();
      if (element.dataset.source !== source) {
        element.innerHTML = markdownEditor.renderMarkdown(source);
        element.dataset.source = source;
      }
      const maximized = maximizedNodeContentProgress(item.screen);
      const size = item.screen.radius * (1.42 + maximized * 0.36);
      element.style.left = `${item.screen.x}px`;
      element.style.top = `${item.screen.y}px`;
      element.style.width = `${size}px`;
      element.style.height = `${size}px`;
      element.style.padding = `${Math.max(18, size * (0.146 - maximized * 0.005))}px`;
      element.style.fontSize = `${clamp(item.screen.radius * 0.055, 11, 16)}px`;
    });

    markdownSurfaceElements.forEach((element, key) => {
      if (visibleKeys.has(key)) return;
      element.remove();
      markdownSurfaceElements.delete(key);
    });
  }

  function drawSurfaceContent(screen, node) {
    const descriptionSource = typeof node.description === "string" ? node.description.trim() : "";
    const description = markdownEditor
      ? markdownEditor.toPlainText(descriptionSource)
      : descriptionSource;
    const attachment = node.attachment && typeof node.attachment === "object" ? node.attachment : null;
    if (!description && !attachment) return;

    const radius = screen.radius;
    const contentRadius = radius * (0.76 + maximizedNodeContentProgress(screen) * 0.12);
    context.save();
    spherePath(screen);
    context.clip();
    context.globalAlpha = 0.62;
    context.fillStyle = theme["space-0"];
    context.beginPath();
    context.arc(screen.x, screen.y, contentRadius, 0, Math.PI * 2);
    context.fill();

    if (attachment) {
      const isImage = typeof attachment.type === "string" && attachment.type.startsWith("image/");
      const imageRecord = isImage ? surfaceImageFor(attachment) : null;
      if (
        imageRecord
        && imageRecord.status === "ready"
        && imageRecord.image.naturalWidth > 0
        && imageRecord.image.naturalHeight > 0
      ) {
        const sourceSize = Math.min(imageRecord.image.naturalWidth, imageRecord.image.naturalHeight);
        const sourceX = (imageRecord.image.naturalWidth - sourceSize) * 0.5;
        const sourceY = (imageRecord.image.naturalHeight - sourceSize) * 0.5;
        const diameter = contentRadius * 2;
        context.globalAlpha = 0.78;
        context.drawImage(
          imageRecord.image,
          sourceX,
          sourceY,
          sourceSize,
          sourceSize,
          screen.x - contentRadius,
          screen.y - contentRadius,
          diameter,
          diameter
        );
      } else {
        const extension = attachment.name.includes(".")
          ? attachment.name.split(".").pop().slice(0, 5).toUpperCase()
          : "FILE";
        context.globalAlpha = 0.9;
        context.fillStyle = theme["sphere-edge"];
        context.font = `600 ${clamp(radius * 0.22, 9, 15)}px ${theme.fontMono}`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(extension, screen.x, screen.y - radius * 0.18);
      }

      const sizeLabel = `${Math.max(1, Math.round((Number(attachment.size) || 0) / 1024))} KB`;
      context.globalAlpha = 0.88;
      context.fillStyle = theme.ink;
      context.font = `500 ${clamp(radius * 0.14, 8, 11)}px ${theme.fontBody}`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      const nameLines = wrapSurfaceText(attachment.name, contentRadius * 1.55, 2);
      const nameStartY = screen.y + radius * 0.2 - (nameLines.length - 1) * radius * 0.08;
      nameLines.forEach((line, index) => {
        context.fillText(line, screen.x, nameStartY + index * radius * 0.17);
      });
      context.globalAlpha = 0.7;
      context.fillStyle = theme["ink-2"];
      context.font = `500 ${clamp(radius * 0.115, 7, 9)}px ${theme.fontMono}`;
      context.fillText(sizeLabel, screen.x, screen.y + radius * 0.56);
      context.restore();
      return;
    }

    context.globalAlpha = 0.68;
    context.strokeStyle = theme["sphere-edge"];
    context.lineWidth = Math.max(0.7, radius * 0.014);
    context.beginPath();
    context.moveTo(screen.x - contentRadius * 0.48, screen.y - contentRadius * 0.54);
    context.lineTo(screen.x + contentRadius * 0.18, screen.y - contentRadius * 0.54);
    context.stroke();
    context.globalAlpha = 0.9;
    context.fillStyle = theme.ink;
    context.font = `500 ${clamp(radius * 0.145, 8, 12)}px ${theme.fontBody}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const lineHeight = clamp(radius * 0.23, 10, 16);
    const descriptionWidth = contentRadius * 1.58;
    const descriptionHeight = contentRadius;
    const maxDescriptionLines = Math.max(
      3,
      Math.floor(descriptionHeight / lineHeight)
    );
    const lines = wrapSurfaceText(description, descriptionWidth, maxDescriptionLines);
    const startY = screen.y - (lines.length - 1) * lineHeight * 0.5 + radius * 0.05;
    lines.forEach((line, index) => {
      context.fillText(line, screen.x, startY + index * lineHeight);
    });
    context.restore();
  }

  function drawTunnelInterior(screen, node, distanceFade, contextAlpha) {
    const radius = screen.radius;
    const seed = hashText(`${node.id}:tunnel`);
    const parallaxX = Math.sin(camera.yaw + (seed % 31) * 0.07) * radius * 0.038;
    const parallaxY = Math.sin(camera.pitch - (seed % 19) * 0.05) * radius * 0.03;
    const wellX = screen.x + radius * 0.25 + parallaxX;
    const wellY = screen.y - radius * 0.08 + parallaxY;

    context.save();
    spherePath(screen);
    context.clip();

    const well = context.createRadialGradient(
      wellX,
      wellY,
      radius * 0.018,
      screen.x,
      screen.y,
      radius * 0.98
    );
    well.addColorStop(0, theme["space-0"]);
    well.addColorStop(0.26, theme["sphere-core"]);
    well.addColorStop(0.68, theme["sphere"]);
    well.addColorStop(1, theme["space-2"]);
    context.globalAlpha = 0.92 * distanceFade * contextAlpha;
    context.fillStyle = well;
    context.fillRect(screen.x - radius, screen.y - radius, radius * 2, radius * 2);

    const contourCount = 6;
    for (let contour = 0; contour < contourCount; contour += 1) {
      const factor = 0.82 - contour * 0.112;
      context.globalAlpha = (0.105 + contour * 0.03) * distanceFade * contextAlpha;
      context.strokeStyle = contour % 2 === 0 ? theme.accent : theme["accent-2"];
      context.lineWidth = Math.max(0.55, radius * 0.012);
      context.beginPath();
      context.ellipse(
        screen.x + radius * (0.025 + contour * 0.039) + parallaxX,
        screen.y - radius * (0.008 + contour * 0.014) + parallaxY,
        radius * factor,
        radius * factor * 0.8,
        -0.18,
        0,
        Math.PI * 2
      );
      context.stroke();
    }
    context.restore();
  }

  function drawStructuralBoundary(screen, selected, hovered, distanceFade, contextAlpha, surfaceVisible) {
    const radius = screen.radius;
    const maximized = maximizedNodeContentProgress(screen);
    const boundaryScale = 1 - maximized * 0.45;
    context.save();
    context.lineCap = "round";
    if (surfaceVisible) {
      context.globalCompositeOperation = "source-over";
      context.strokeStyle = theme["space-0"];
      context.shadowBlur = 0;
      context.globalAlpha = 0.82 * distanceFade * contextAlpha;
      context.lineWidth = Math.max(2.4, radius * 0.072 * boundaryScale);
      context.beginPath();
      context.arc(screen.x, screen.y, radius * 0.915, 0, Math.PI * 2);
      context.stroke();

      context.globalCompositeOperation = "lighter";
      for (let braid = 0; braid < 4; braid += 1) {
        const braidColor = braid % 2 === 0 ? theme["sphere-edge"] : theme["accent-2"];
        const start = -1.82 + braid * 1.47;
        const sweep = 0.92 + (braid % 3) * 0.34;
        context.globalAlpha = (0.34 - braid * 0.035) * distanceFade * contextAlpha;
        context.strokeStyle = braidColor;
        context.shadowColor = braidColor;
        context.shadowBlur = Math.max(5, radius * (0.13 - braid * 0.012));
        context.lineWidth = Math.max(0.72, radius * (0.018 - braid * 0.0018) * boundaryScale);
        context.beginPath();
        context.arc(
          screen.x + Math.sin(braid * 1.31) * radius * 0.012,
          screen.y + Math.cos(braid * 1.17) * radius * 0.012,
          radius * (0.94 - braid * 0.012),
          start,
          start + sweep
        );
        context.stroke();
      }
    }

    context.globalCompositeOperation = "lighter";
    context.strokeStyle = selected ? theme.accent : theme["sphere-edge"];
    context.shadowColor = selected ? theme.accent : theme["sphere-edge"];
    context.shadowBlur = Math.max(4, radius * 0.12);
    context.globalAlpha = (
      selected ? 0.46 : hovered ? 0.4 : surfaceVisible ? 0.34 : 0.24
    ) * distanceFade * contextAlpha;
    context.lineWidth = surfaceVisible
      ? Math.max(0.72, radius * 0.014)
      : Math.max(0.48, radius * 0.009);
    spherePath(screen);
    context.stroke();

    for (let contour = 0; contour < TUNNEL_BOUNDARY_CONTOURS; contour += 1) {
      const inset = contour * Math.max(0.9, radius * 0.021 * (1 - maximized * 0.34));
      const sweepOffset = contour * 0.53;
      const contourColor = contour % 3 === 1 ? theme["accent-2"] : theme["sphere-edge"];
      context.globalAlpha = (
        (surfaceVisible ? 0.33 : 0.24) - contour * (surfaceVisible ? 0.021 : 0.018)
      ) * distanceFade * contextAlpha;
      context.strokeStyle = contourColor;
      context.shadowColor = contourColor;
      context.shadowBlur = Math.max(2.5, radius * (0.105 - contour * 0.008));
      context.lineWidth = surfaceVisible
        ? Math.max(0.48, radius * (0.012 - contour * 0.00072) * boundaryScale)
        : Math.max(0.34, radius * (0.0085 - contour * 0.00065) * boundaryScale);
      context.setLineDash([
        Math.max(1.4, radius * (0.028 + contour * 0.003)),
        Math.max(2.5, radius * (0.062 + contour * 0.004))
      ]);
      context.beginPath();
      context.ellipse(
        screen.x + Math.sin(contour * 1.7) * radius * 0.018,
        screen.y + Math.cos(contour * 1.3) * radius * 0.012,
        Math.max(1, radius - inset),
        Math.max(1, radius - inset * (0.72 + contour * 0.025)),
        -0.18 + contour * 0.035,
        -1.68 + sweepOffset,
        1.18 + sweepOffset
      );
      context.stroke();
    }
    context.setLineDash([]);
    context.restore();
  }

  function drawCardEdge(screen, distanceFade, contextAlpha) {
    context.save();
    context.globalCompositeOperation = "source-over";
    context.shadowBlur = 0;
    context.strokeStyle = theme.ink;
    context.globalAlpha = 0.55 * distanceFade * contextAlpha;
    context.lineWidth = Math.max(1, screen.radius * 0.032);
    spherePath(screen);
    context.stroke();
    context.restore();
  }

  function startConfirmationRipples(node, count) {
    if (!node) return;
    state.confirmationRipples.set(node.id, {
      count: clamp(Math.trunc(count), 1, 3),
      startedAt: performance.now()
    });
  }

  function drawConfirmationRipples(screen, node) {
    const ripple = node ? state.confirmationRipples.get(node.id) : null;
    if (!ripple) return;
    const now = performance.now();
    const count = clamp(ripple.count, 1, 3);
    const countStrength = count - 1;
    const layerSpacing = RIPPLE_LAYER_SPACING + countStrength * 0.008;
    const travel = RIPPLE_LAYER_TRAVEL + countStrength * RIPPLE_COUNT_TRAVEL_STEP;
    const totalDuration = RIPPLE_LAYER_DURATION + (count - 1) * RIPPLE_LAYER_DELAY;
    if (now - ripple.startedAt >= totalDuration) {
      state.confirmationRipples.delete(node.id);
      return;
    }

    context.save();
    context.strokeStyle = theme.ink;
    context.lineCap = "round";
    for (let layer = 0; layer < count; layer += 1) {
      const elapsed = now - ripple.startedAt - layer * RIPPLE_LAYER_DELAY;
      if (elapsed < 0) continue;
      const progress = clamp(elapsed / RIPPLE_LAYER_DURATION, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      const radius = screen.radius * (
        1.02 + layer * layerSpacing + eased * travel
      );
      context.globalAlpha = Math.pow(1 - progress, 1.55)
        * (0.86 + countStrength * RIPPLE_COUNT_ALPHA_STEP - layer * 0.055);
      context.lineWidth = Math.max(0.95, screen.radius * 0.016)
        * (1 + countStrength * RIPPLE_COUNT_WIDTH_STEP)
        * (1 - progress * 0.28);
      context.beginPath();
      context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  function drawLensInterior(screen, node) {
    context.save();
    spherePath(screen);
    context.clip();
    context.globalAlpha = 0.26;
    context.fillStyle = theme["space-1"];
    context.fillRect(screen.x - screen.radius, screen.y - screen.radius, screen.radius * 2, screen.radius * 2);

    drawSurfaceLayer(screen, node);
    context.globalAlpha = 0.38;
    context.strokeStyle = theme["sphere-edge"];
    context.lineWidth = Math.max(0.6, screen.radius * 0.015);
    context.beginPath();
    context.arc(screen.x - screen.radius * 0.05, screen.y, screen.radius * 0.73, -1.22, 1.17);
    context.stroke();
    context.restore();
  }

  function drawDomainPathMap(rendered) {
    const pathSteps = rendered
      .filter((item) => item.kind === "pathStep")
      .sort((a, b) => a.targetDepth - b.targetDepth);
    if (!pathSteps.length) {
      return;
    }
    const first = pathSteps[0].screen;
    const last = pathSteps.at(-1).screen;
    const isExpanded = state.worldLens.open;
    const current = pathSteps.find((item) => item.isCurrent) || pathSteps.at(-1);
    const topWidth = isExpanded ? 42 : 25;
    const bottomWidth = isExpanded ? 20 : 12;

    context.save();
    const corridor = context.createLinearGradient(first.x, first.y, last.x, last.y + 24);
    corridor.addColorStop(0, theme["accent-2"]);
    corridor.addColorStop(0.5, theme["sphere-core"]);
    corridor.addColorStop(1, theme.accent);
    context.globalAlpha = 0.105;
    context.fillStyle = corridor;
    context.beginPath();
    context.moveTo(first.x - topWidth, first.y - 19);
    context.bezierCurveTo(
      first.x - topWidth * 0.78,
      first.y + (last.y - first.y) * 0.34,
      last.x - bottomWidth * 1.24,
      last.y - 18,
      last.x - bottomWidth,
      last.y + 20
    );
    context.lineTo(last.x + bottomWidth, last.y + 20);
    context.bezierCurveTo(
      last.x + bottomWidth * 1.24,
      last.y - 18,
      first.x + topWidth * 0.78,
      first.y + (last.y - first.y) * 0.34,
      first.x + topWidth,
      first.y - 19
    );
    context.closePath();
    context.fill();

    context.globalAlpha = 0.42;
    context.strokeStyle = theme["sphere-edge"];
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (let index = 1; index < pathSteps.length; index += 1) {
      const previous = pathSteps[index - 1].screen;
      const step = pathSteps[index].screen;
      context.bezierCurveTo(previous.x + 8, previous.y + 13, step.x - 8, step.y - 13, step.x, step.y);
    }
    context.stroke();

    context.globalAlpha = 0.78;
    context.fillStyle = theme["ink-2"];
    context.font = `500 12px ${theme.fontMono}`;
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.shadowColor = theme["space-0"];
    context.shadowBlur = 4;
    context.fillText(isExpanded ? "域径 / PATH" : "域径", first.x, first.y - 27);

    context.globalAlpha = 0.12;
    context.strokeStyle = theme.accent;
    context.lineWidth = 1;
    context.beginPath();
    context.ellipse(current.screen.x, current.screen.y, 27, 12, -0.16, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  function drawPathStep(item) {
    const { screen } = item;
    context.save();
    context.strokeStyle = item.isCurrent ? theme.accent : theme["sphere-edge"];
    context.fillStyle = theme["space-0"];
    context.globalAlpha = item.isCurrent ? 0.92 : 0.62;
    context.beginPath();
    context.ellipse(screen.x, screen.y, screen.radius, screen.radius * 0.58, -0.16, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = item.isCurrent ? 1.35 : 0.8;
    context.stroke();
    for (let ring = 1; ring <= 2; ring += 1) {
      context.globalAlpha = item.isCurrent ? 0.34 - ring * 0.07 : 0.2 - ring * 0.05;
      context.beginPath();
      context.ellipse(
        screen.x + ring * 1.4,
        screen.y - ring * 0.5,
        screen.radius * (1 - ring * 0.22),
        screen.radius * (0.58 - ring * 0.11),
        -0.16,
        0,
        Math.PI * 2
      );
      context.stroke();
    }
    context.restore();
  }

  function drawSphere(item) {
    if (item.clusterShellProxy) return;
    if (item.kind === "pathStep") {
      drawPathStep(item);
      return;
    }
    const { screen } = item;
    const node = item.node;
    const selected = node && sameNode(state.selected, node);
    const magnifierHighlighted = Boolean(
      node
      && state.detailMagnifier.enabled
      && state.detailMagnifier.targetKind === "node"
      && state.detailMagnifier.targetNodeKey === visualNodeKey(node, item.ownerPath || nodeOwnerPath(node))
    );
    const magnifierFocusActive = state.detailMagnifier.enabled
      && Boolean(state.detailMagnifier.targetKey);
    const hovered = node && sameNode(state.hovered, node);
    const isCommand = item.kind === "command";
    const isLens = item.kind === "lens";
    const distanceFade = clamp(1.15 - screen.depth / 35, 0.34, 1);
    const baseContextAlpha = item.focusContext ? item.focusContext.sphereAlpha : 1;
    const contextAlpha = magnifierFocusActive && !magnifierHighlighted
      ? baseContextAlpha * 0.16
      : baseContextAlpha;
    const editState = item.kind === "node" && node
      ? workspace.nodeVisualState(item.ownerPath || nodeOwnerPath(node), node.id)
      : "idle";
    const editColor = editState === "delete" ? theme.delete : editState === "update" ? theme.update : null;

    context.save();
    if (selected || magnifierHighlighted) {
      const fieldRadius = screen.radius * (node.peekOpen ? 3.35 : 2.45);
      const field = context.createRadialGradient(
        screen.x - screen.radius * 0.18,
        screen.y - screen.radius * 0.14,
        screen.radius * 0.42,
        screen.x,
        screen.y,
        fieldRadius
      );
      field.addColorStop(0, theme.accent);
      field.addColorStop(0.3, theme["accent-2"]);
      field.addColorStop(1, "transparent");
      context.globalAlpha = magnifierHighlighted ? 0.22 : node.peekOpen ? 0.13 : 0.075;
      context.fillStyle = field;
      context.beginPath();
      context.arc(screen.x, screen.y, fieldRadius, 0, Math.PI * 2);
      context.fill();
    }
    const gradient = context.createRadialGradient(
      screen.x - screen.radius * 0.34,
      screen.y - screen.radius * 0.4,
      Math.max(0.5, screen.radius * 0.03),
      screen.x,
      screen.y,
      screen.radius
    );
    gradient.addColorStop(0, editColor || theme["sphere-edge"]);
    gradient.addColorStop(0.42, isCommand ? theme.accent : theme.sphere);
    gradient.addColorStop(1, theme["sphere-core"]);
    context.globalAlpha = (isCommand ? 0.54 : 0.39) * distanceFade * contextAlpha;
    context.fillStyle = gradient;
    spherePath(screen);
    context.fill();

    if (item.kind === "node") {
      drawTunnelInterior(screen, node, distanceFade, contextAlpha);
      if (node.surfaceVisible) {
        drawSurfaceLayer(screen, node);
        drawSurfaceContent(screen, node);
      }
      drawStructuralBoundary(
        screen,
        selected,
        hovered,
        distanceFade,
        contextAlpha,
        node.surfaceVisible
      );
      drawCardEdge(screen, distanceFade, contextAlpha);
    }

    if (item.kind !== "node") {
      context.globalAlpha = (selected ? 0.96 : hovered ? 0.76 : isCommand ? 0.65 : 0.46) * distanceFade * contextAlpha;
      context.strokeStyle = selected || isCommand ? theme.accent : theme["sphere-edge"];
      context.lineWidth = selected ? Math.max(1.3, screen.radius * 0.022) : Math.max(0.55, screen.radius * 0.012);
      spherePath(screen);
      context.stroke();
    }

    if (selected) {
      context.globalAlpha = 0.4;
      context.strokeStyle = theme.accent;
      context.lineWidth = 0.8;
      context.setLineDash([2, 5]);
      context.beginPath();
      context.arc(screen.x, screen.y, screen.radius + 7, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }
    if (magnifierHighlighted) {
      context.globalAlpha = 0.92;
      context.strokeStyle = theme.accent;
      context.lineWidth = Math.max(2.4, screen.radius * 0.035);
      context.shadowColor = theme.accent;
      context.shadowBlur = 16;
      context.beginPath();
      context.arc(screen.x, screen.y, screen.radius + 11, 0, Math.PI * 2);
      context.stroke();
    }
    if (editColor) {
      const pulse = state.reducedMotion ? 0.5 : 0.5 + Math.sin(state.time * 4.4) * 0.18;
      context.globalAlpha = pulse;
      context.strokeStyle = editColor;
      context.lineWidth = editState === "delete" ? 2.6 : 1.8;
      context.setLineDash(editState === "delete" ? [5, 5] : []);
      context.beginPath();
      context.arc(screen.x, screen.y, screen.radius + 10, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }
    if (node && node.id === state.locatedNodeId && performance.now() < state.locatedUntil) {
      context.globalAlpha = 0.68;
      context.strokeStyle = theme.update;
      context.lineWidth = 1.4;
      context.beginPath();
      context.arc(screen.x, screen.y, screen.radius + 16, 0, Math.PI * 2);
      context.stroke();
    }
    if (item.kind === "node") {
      drawConfirmationRipples(screen, node);
      drawWandGlow(screen, item);
    }
    context.restore();

    if (isLens) {
      drawLensInterior(screen, node);
    }
  }

  function overlapArea(first, second) {
    const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
    const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
    return width * height;
  }

  function placeReadableLabels(rendered) {
    const placements = new Map();
    const occupied = [];
    const labelRingOffsets = [0, 18, 36, 54, 72];
    const labelItems = rendered
      .filter((item) => item.kind === "node" && item.node && !item.clusterShellProxy)
      .sort((left, right) => (
        Number(sameNode(right.node, state.selected)) - Number(sameNode(left.node, state.selected))
        || left.level - right.level
        || left.screen.depth - right.screen.depth
      ));

    context.save();
    context.font = `400 12px ${theme.fontBody}`;
    for (const item of labelItems) {
      const label = item.label || item.node.label;
      const width = Math.ceil(context.measureText(label).width) + 4;
      const height = item.level === 0 ? 16 : 14;
      const radius = Math.max(3, item.screen.radius);
      const gap = radius < 12 ? 10 : 8;
      const x = item.screen.x;
      const y = item.screen.y;
      const candidates = labelRingOffsets.flatMap((offset) => ([
        { x: x + radius + gap + offset, y, textAlign: "left", left: x + radius + gap + offset, top: y - height / 2 },
        { x: x - radius - gap - offset, y, textAlign: "right", left: x - radius - gap - offset - width, top: y - height / 2 },
        { x, y: y - radius - gap - offset, textAlign: "center", left: x - width / 2, top: y - radius - gap - offset - height / 2 },
        { x, y: y + radius + gap + offset, textAlign: "center", left: x - width / 2, top: y + radius + gap + offset - height / 2 }
      ])).map((candidate) => {
        const box = {
          left: candidate.left,
          top: candidate.top,
          right: candidate.left + width,
          bottom: candidate.top + height
        };
        const collision = occupied.reduce((sum, other) => sum + overlapArea(box, other), 0);
        const overflow = Math.max(0, 12 - box.left)
          + Math.max(0, box.right - state.width + 12)
          + Math.max(0, 12 - box.top)
          + Math.max(0, box.bottom - state.height + 12);
        return { ...candidate, box, score: collision * 12 + overflow * 40 };
      });
      const minimumScore = Math.min(...candidates.map((candidate) => candidate.score));
      const placement = candidates.find((candidate) => candidate.score === minimumScore) || candidates[0];
      occupied.push(placement.box);
      placements.set(item, placement);
    }
    context.restore();
    return placements;
  }

  function drawLabel(item, placement) {
    if (item.clusterShellProxy) return false;
    const { screen } = item;
    const node = item.node;
    const selected = node && sameNode(state.selected, node);
    const hovered = node && sameNode(state.hovered, node);
    const hierarchyHighlighted = isMiddleLabelHighlighted(item);
    const editState = item.kind === "node" && node
      ? workspace.nodeVisualState(item.ownerPath || nodeOwnerPath(node), node.id)
      : "idle";
    if (editState !== "idle") return false;
    const semanticIndex = item.semanticProfile ? item.semanticProfile.index : 3;
    const persistentOverviewLabel = item.kind === "node" && item.level === 0;
    const showNodeLabel = item.kind === "node"
      && (
        persistentOverviewLabel
        || selected
        || hovered
        || (semanticIndex >= 3 && screen.radius >= 22)
      );
    const showOtherLabel = item.kind === "command"
      || item.kind === "lens"
      || item.kind === "pathStep";
    if (!showNodeLabel && !showOtherLabel) {
      return false;
    }

    const baseLabel = item.kind === "lens"
      ? (item.label || "细节镜")
      : atomDisplayName(node, item.label || node.label);
    const label = node && node.lockState ? `🔒 ${baseLabel}` : baseLabel;
    const labelOnLeft = item.kind === "pathStep";
    const x = placement
      ? placement.x
      : labelOnLeft ? screen.x - screen.radius - 8 : screen.x + screen.radius + 8;
    const y = placement ? placement.y : screen.y - Math.max(0, screen.radius * 0.1);
    const emphasizedLabel = selected || item.kind === "command" || hierarchyHighlighted;
    const highlightedLabelAlpha = state.demo.settings.highlightedLabelBrightnessPercent / 100;
    const ordinaryLabelAlpha = state.demo.settings.otherLabelBrightnessPercent / 100;
    const labelAlphaFloor = hierarchyHighlighted
      ? highlightedLabelAlpha
      : emphasizedLabel ? 0.94 : ordinaryLabelAlpha;
    const labelWeight = item.focusContext ? item.focusContext.labelWeight : 1;
    const labelAlpha = (
      hierarchyHighlighted
        ? highlightedLabelAlpha
        : emphasizedLabel ? 0.98 : ordinaryLabelAlpha
    ) * labelWeight;
    const renderedLabelAlpha = Math.max(labelAlphaFloor, labelAlpha);
    if (renderedLabelAlpha <= 0.001) return false;
    context.save();
    context.globalAlpha = renderedLabelAlpha;
    context.fillStyle = selected || item.kind === "command" || hierarchyHighlighted ? theme.ink : theme["ink-2"];
    context.font = `${hierarchyHighlighted ? 600 : item.kind === "command" ? 500 : 400} 12px ${theme.fontBody}`;
    context.textBaseline = "middle";
    context.textAlign = placement ? placement.textAlign : labelOnLeft ? "right" : "left";
    context.shadowColor = theme["space-0"];
    context.shadowBlur = 3;
    if (hierarchyHighlighted) {
      context.shadowColor = theme.accent;
      context.shadowBlur = 7;
    }
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 1;
    if (placement && item.kind === "node" && screen.radius < 12) {
      const angle = Math.atan2(y - screen.y, x - screen.x);
      context.globalAlpha = Math.max(0.34, labelAlpha * 0.62);
      context.strokeStyle = selected ? theme.ink : theme["sphere-edge"];
      context.lineWidth = 0.75;
      context.beginPath();
      context.moveTo(
        screen.x + Math.cos(angle) * Math.max(2, screen.radius),
        screen.y + Math.sin(angle) * Math.max(2, screen.radius)
      );
      context.lineTo(
        screen.x + Math.cos(angle) * (Math.max(3, screen.radius) + 6),
        screen.y + Math.sin(angle) * (Math.max(3, screen.radius) + 6)
      );
      context.stroke();
      context.globalAlpha = Math.max(labelAlphaFloor, labelAlpha);
    }
    context.fillText(label, x, y);

    if (item.kind === "node" && item.level === 0 && semanticIndex >= 2) {
      context.globalAlpha = Math.max(
        labelAlphaFloor,
        (
          hierarchyHighlighted
            ? highlightedLabelAlpha
            : emphasizedLabel ? 0.84 : ordinaryLabelAlpha
        ) * labelWeight
      );
      context.fillStyle = theme["ink-2"];
      context.font = `400 12px ${theme.fontMono}`;
      context.fillText(node.short, x, y + 17);
    }
    context.restore();
    return true;
  }

  function isMiddleLabelHighlighted(item) {
    if (!item || item.kind !== "node" || !item.node) return false;
    return isMiddleItemLabelHighlighted(item);
  }

  function isMiddleItemLabelHighlighted(item) {
    if (!state.middleLabelFocus || !state.semanticScene) return false;
    const id = sceneAdapter.sceneEntityIdForItem(item);
    return Boolean(id && state.semanticScene.byId(id)?.emphasis.label);
  }

  function isMiddleRelationshipHighlighted(from, to) {
    return isMiddleLabelHighlighted(from) || isMiddleLabelHighlighted(to);
  }

  function relationshipHierarchyBrightnessPercent(from, to) {
    const levels = [from, to]
      .map((item) => state.semanticScene?.byId(sceneAdapter.sceneEntityIdForItem(item))?.hierarchyLevel)
      .filter((level) => level !== null && level !== undefined);
    if (!levels.length) return state.demo.settings.otherLabelBrightnessPercent;
    const level = Math.min(...levels);
    const depth = Math.max(1, state.demo.settings.middleLabelDepth);
    const ratio = Math.min(1, Math.max(0, (level - 1) / depth));
    return state.demo.settings.highlightedLabelBrightnessPercent
      + (state.demo.settings.otherLabelBrightnessPercent
        - state.demo.settings.highlightedLabelBrightnessPercent) * ratio;
  }

  function detailModeFor(node) {
    return visualModel.detailModeFor(node);
  }

  function effectiveDetailFocus() {
    const focus = state.middleDetailFocus || state.middleLabelFocus;
    if (!focus) return { kind: "domain", path: state.currentPath };
    if (focus.kind === "domain") {
      const paths = state.clusterFieldOpen
        ? state.clusterScene.clusters.map((cluster) => cluster.path)
        : [state.currentPath];
      if (paths.some((path) => path === focus.path || path.startsWith(`${focus.path}/`))) {
        return focus;
      }
    }
    if (focus.kind === "node") {
      const anchorVisible = state.rendered.some((item) => (
        item.kind === "node"
        && item.node
        && visualNodeKey(item.node, item.ownerPath || nodeOwnerPath(item.node)) === focus.anchorKey
      ));
      if (anchorVisible) return focus;
    }
    return { kind: "domain", path: state.currentPath };
  }

  function middleDetailLevel(item) {
    const id = sceneAdapter.sceneEntityIdForItem(item);
    return id && state.semanticScene ? state.semanticScene.byId(id)?.hierarchyLevel ?? null : null;
  }

  function isMiddleDetailHighlighted(item) {
    const id = sceneAdapter.sceneEntityIdForItem(item);
    return Boolean(id && state.semanticScene && state.semanticScene.byId(id)?.emphasis.detail);
  }

  function areAllFocusedNamesHidden() {
    return (
      state.demo.settings.highlightedLabelBrightnessPercent <= 0
      && state.demo.settings.otherLabelBrightnessPercent <= 0
    );
  }

  function focusedNameBrightnessPercent(item) {
    return isMiddleItemLabelHighlighted(item)
      ? state.demo.settings.highlightedLabelBrightnessPercent
      : state.demo.settings.otherLabelBrightnessPercent;
  }

  function floatingDetailAlpha(item) {
    if (areAllFocusedNamesHidden()) return 0;
    if (focusedNameBrightnessPercent(item) <= 0) return 0;
    if (state.batchFloatingDetails) {
      return state.demo.settings.highlightedDetailBrightnessPercent / 100;
    }
    return (
      isMiddleDetailHighlighted(item)
        ? state.demo.settings.highlightedDetailBrightnessPercent
        : state.demo.settings.otherDetailBrightnessPercent
    ) / 100;
  }

  function clusterDetailText(cluster) {
    if (!cluster || !cluster.detailNode) return "";
    return String(
      cluster.description
      || cluster.detailNode.description
      || cluster.detailNode.detail
      || ""
    ).trim();
  }

  function detailCandidateBox(left, top, width, height) {
    return { left, top, right: left + width, bottom: top + height };
  }

  function drawFloatingDetail(node, x, y, textAlign, alphaInput = 1, metadata = {}) {
    const detail = String(metadata.detail || node && (node.description || node.detail) || "").trim();
    const alpha = clamp(Number(alphaInput) || 0, 0, 1);
    if (!detail || alpha <= 0.001) return false;
    const key = metadata.key || `${metadata.ownerPath || nodeOwnerPath(node)}::${node && node.id || detail}`;
    if (state.floatingDetailKeys.has(key)) return false;
    context.save();
    context.font = `400 12px ${theme.fontBody}`;
    const maxWidth = Math.min(320, Math.max(132, state.width * 0.24));
    const words = [...detail];
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line + word;
      if (line && context.measureText(candidate).width > maxWidth - 24) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
      if (lines.length >= 4) break;
    }
    if (line && lines.length < 5) lines.push(line);
    const contentWidth = Math.min(
      maxWidth,
      Math.max(132, ...lines.map((entry) => context.measureText(entry).width + 24))
    );
    const height = lines.length * 18 + 20;
    const alignedLeft = textAlign === "right"
      ? x - contentWidth
      : textAlign === "center"
        ? x - contentWidth / 2
        : x;
    const placements = [];
    for (const offset of [0, 18, 38, 68, 106, 152, 210, 280, 360]) {
      placements.push(
        { left: alignedLeft, top: y + offset },
        { left: alignedLeft, top: y - height - 18 - offset },
        { left: x + 18 + offset, top: y - height / 2 },
        { left: x - contentWidth - 18 - offset, top: y - height / 2 }
      );
    }
    const placement = placements
      .map((candidate) => {
        const box = detailCandidateBox(candidate.left, candidate.top, contentWidth, height);
        const collision = state.floatingDetailBoxes.reduce(
          (sum, other) => sum + overlapArea(box, other),
          0
        );
        const overflow = Math.max(0, 8 - box.left)
          + Math.max(0, box.right - state.width + 8)
          + Math.max(0, 8 - box.top)
          + Math.max(0, box.bottom - state.height + 8);
        return { ...candidate, box, collision, overflow };
      })
      .filter((candidate) => candidate.collision <= 0.01 && candidate.overflow <= 0.01)
      .sort((left, right) => (
        Math.hypot(left.left - alignedLeft, left.top - y)
        - Math.hypot(right.left - alignedLeft, right.top - y)
      ))[0];
    if (!placement) {
      state.floatingDetailHiddenCount += 1;
      context.restore();
      return false;
    }
    state.floatingDetailKeys.add(key);
    state.floatingDetailBoxes.push(placement.box);
    state.renderedFloatingDetailBoxes.push({
      ...placement.box,
      node,
      detail,
      key
    });
    if (metadata.kind === "domain") state.floatingClusterDetailCount += 1;
    else state.floatingNodeDetailCount += 1;
    const backdropOpacity = state.demo.settings.floatingDetailBackdropOpacityPercent / 100;
    context.globalAlpha = backdropOpacity * alpha;
    context.fillStyle = "rgb(3 12 23)";
    context.strokeStyle = "rgb(117 205 242 / 30%)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.roundRect(placement.left, placement.top, contentWidth, height, 7);
    context.fill();
    context.stroke();
    context.globalAlpha = 0.9 * alpha;
    context.fillStyle = theme["ink-2"];
    context.textAlign = "left";
    context.textBaseline = "top";
    lines.forEach((entry, index) => context.fillText(
      entry,
      placement.left + 12,
      placement.top + 10 + index * 18
    ));
    context.restore();
    return true;
  }

  function drawFloatingDetails(rendered, labelPlacements) {
    const nodeCandidates = rendered
      .filter((item) => (
        item.kind === "node"
        && item.node
        && !item.clusterShellProxy
        && detailModeFor(item.node) === "floating"
        && String(item.node.description || item.node.detail || "").trim()
      ))
      .map((item) => {
        const placement = labelPlacements.get(item);
        return {
          ...item,
          key: `${item.ownerPath || nodeOwnerPath(item.node)}::${item.node.id}`,
          x: placement ? placement.x : item.screen.x + item.screen.radius + 8,
          y: (placement ? placement.y : item.screen.y) + 24,
          textAlign: placement ? placement.textAlign : "left"
        };
      });
    const candidates = [...state.clusterDetailCandidates, ...nodeCandidates]
      .map((item) => ({
        ...item,
        detailLevel: middleDetailLevel(item),
        detailAlpha: floatingDetailAlpha(item),
        selected: item.kind === "node" && sameNode(item.node, state.selected)
      }))
      .filter((item) => item.detailAlpha > 0.001)
      .sort((left, right) => (
        Number(right.detailLevel !== null) - Number(left.detailLevel !== null)
        || (left.detailLevel ?? 99) - (right.detailLevel ?? 99)
        || Number(right.selected) - Number(left.selected)
        || left.screen.depth - right.screen.depth
      ));
    for (const item of candidates) {
      drawFloatingDetail(
        item.node,
        item.x,
        item.y,
        item.textAlign,
        item.detailAlpha,
        {
          kind: item.kind,
          key: item.key,
          ownerPath: item.ownerPath,
          detail: item.kind === "domain" ? clusterDetailText(item.cluster) : ""
        }
      );
    }
  }

  function drawAmbiguityCandidates() {
    if (state.ambiguity.length < 2) {
      return;
    }
    context.save();
    context.strokeStyle = theme["accent-2"];
    context.lineWidth = 0.8;
    context.setLineDash([2, 4]);
    state.ambiguity.forEach((region, index) => {
      context.globalAlpha = 0.46 - index * 0.1;
      context.beginPath();
      context.arc(region.x, region.y, region.radius + 5 + index * 2, 0, Math.PI * 2);
      context.stroke();
    });
    context.restore();
  }

  function renderScene() {
    context.clearRect(0, 0, state.width, state.height);
    state.floatingDetailBoxes = [];
    state.renderedFloatingDetailBoxes = [];
    state.clusterDetailCandidates = [];
    state.floatingDetailKeys.clear();
    state.floatingNodeDetailCount = 0;
    state.floatingClusterDetailCount = 0;
    state.floatingDetailHiddenCount = 0;
    if (state.clusterFieldOpen) {
      drawClusterVoid();
    } else {
      drawStaticBackdrop();
    }

    const basis = cameraBasis();
    const sceneTime = state.drag && state.drag.type === "orbit"
      ? state.drag.sceneTime
      : state.time;
    const items = state.clusterFieldOpen ? collectClusterNodes() : collectNodes(sceneTime);
    addSpatialTools(items, basis, sceneTime);

    const rendered = [];
    for (const item of items) {
      const screen = project(item.position, item.radius, basis);
      if (!screen) {
        continue;
      }
      if (state.clusterFieldOpen && item.kind === "node" && !item.clusterShellProxy) {
        screen.radius = exactProjectedRadius(item.radius, screen.depth);
      }
      const renderedItem = { ...item, screen: { ...screen } };
      if (item.kind === "node" && item.node && !item.clusterShellProxy) {
        const editState = workspace.nodeVisualState(
          item.ownerPath || nodeOwnerPath(item.node),
          item.node.id
        );
        if (editState !== "idle") {
          renderedItem.screen.radius = Math.max(renderedItem.screen.radius, 36);
        }
        if (item.node.peekOpen) {
          const minimumPeekRadius = state.width < 640 ? 48 : 58;
          const maximumPeekRadius = state.width < 640 ? 72 : 112;
          renderedItem.screen.radius = clamp(
            Math.max(screen.radius * 1.42, minimumPeekRadius),
            screen.radius,
            maximumPeekRadius
          );
        }
        const semanticRadius = item.node.peekOpen
          ? Math.max(renderedItem.screen.radius, grammar.semanticThresholds.interior + grammar.semanticThresholds.hysteresis)
          : renderedItem.screen.radius + (sameNode(item.node, state.focused) ? 7 : sameNode(item.node, state.selected) ? 4 : sameNode(item.node, state.hovered) ? 2 : 0);
        renderedItem.semanticProfile = grammar.resolveSemanticProfile(
          semanticRadius,
          item.node.semanticStage
        );
        item.node.semanticStage = renderedItem.semanticProfile.stage;
      }
      if (item.kind === "lens") {
        renderedItem.sourceScreen = project(item.sourcePosition, 0.01, basis);
      }
      rendered.push(renderedItem);
    }
    resolveClusterScreenLayout(rendered, basis);
    rendered.sort((a, b) => b.screen.depth - a.screen.depth);
    state.rendered = rendered;
    state.semanticScene = sceneAdapter.createLegacySceneSnapshot({
      rendered,
      clusters: state.clusterFieldOpen ? state.clusterScene.clusters : [],
      focus: state.middleLabelFocus,
      settings: state.demo.settings,
      selected: state.selected,
      focused: state.focused,
      viewMode: state.viewMode
    });
    if (state.clusterFieldOpen) {
      drawClusterField(state.clusterScene, basis);
      drawClusterConnections(rendered);
    } else {
      drawConnections(rendered);
    }
    drawDomainPathMap(rendered);
    for (const item of rendered) {
      drawSphere(item);
    }
    const labelPlacements = placeReadableLabels(rendered);
    for (const item of rendered) {
      const placement = labelPlacements.get(item);
      if (drawLabel(item, placement) && placement && placement.box) {
        state.floatingDetailBoxes.push(placement.box);
      }
    }
    drawFloatingDetails(rendered, labelPlacements);
    drawAmbiguityCandidates();
    drawWandTrail();
    drawViewModeCursor();

    state.hitRegions = rendered
      .filter((item) => !item.clusterShellProxy || Boolean(item.node))
      .map((item) => ({
        item,
        x: item.screen.x,
        y: item.screen.y,
        radius: Math.max(item.kind === "command" ? 19 : item.kind === "pathStep" ? 18 : 16, item.screen.radius),
        priority: item.focusContext ? item.focusContext.hitPriority : 50
      }))
      .sort((a, b) => b.priority - a.priority || a.item.screen.depth - b.item.screen.depth);
    syncMarkdownSurfaceOverlays();
    syncEditorOverlays();
  }

  function findHit(clientX, clientY, options) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const hitOptions = options || {};
    const domainContext = findClusterDomainContext(x, y);
    const blankSensitive = Boolean(hitOptions.blankSensitive && domainContext);
    const semanticEdit = hitOptions.semanticEdit === true;
    const candidates = state.hitRegions
      .filter((region) => (
        (!semanticEdit || !region.item.clusterShellProxy)
        && (
          !blankSensitive
          || region.item.kind !== "node"
          || nodeOwnerPath(region.item.node) === domainContext.path
        )
      ))
      .map((region) => {
        const distance = Math.hypot(x - region.x, y - region.y);
        const hitRadius = blankSensitive && region.item.kind === "node"
          ? Math.max(6, region.item.screen.radius + 3)
          : Math.max(1, region.radius);
        const normalizedDistance = distance / hitRadius;
        const hoveredBonus = region.item.node && sameNode(region.item.node, state.hovered) ? 12 : 0;
        return {
          region,
          normalizedDistance,
          score: region.priority + hoveredBonus - normalizedDistance * 72 - region.item.screen.depth * 0.18
        };
      })
      .filter((candidate) => candidate.normalizedDistance <= 1.14)
      .sort((a, b) => b.score - a.score);
    state.ambiguity = candidates.length > 1 && candidates[0].score - candidates[1].score < 9
      ? candidates.slice(0, 3).map((candidate) => candidate.region)
      : [];
    if (candidates.length) return candidates[0].region;
    const relation = state.relationHitRegions
      .map((region) => ({
        region,
        normalizedDistance: Math.hypot(x - region.x, y - region.y) / Math.max(1, region.radius)
      }))
      .filter((candidate) => candidate.normalizedDistance <= 1)
      .sort((left, right) => left.normalizedDistance - right.normalizedDistance)[0];
    if (relation) {
      return { ...relation.region, item: { ...relation.region.item, kind: "relationship" } };
    }
    return domainContext ? { item: null, domainContext } : null;
  }

  function findMiddleFrameHit(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const domainContext = findClusterDomainContext(x, y);
    const region = middleFrameTarget.chooseMostSpecificTarget(state.hitRegions, x, y);
    return region
      ? { ...region, domainContext }
      : domainContext
        ? { item: null, domainContext }
        : null;
  }

  function findClusterDomainContext(x, y) {
    if (!state.clusterFieldOpen) return null;
    const match = state.clusterHitRegions
      .map((region) => ({
        region,
        normalizedDistance: Math.hypot(x - region.x, y - region.y) / Math.max(1, region.radius)
      }))
      .filter((candidate) => candidate.normalizedDistance <= 0.96)
      .sort((left, right) => (
        right.region.depth - left.region.depth
        || left.normalizedDistance - right.normalizedDistance
      ))[0];
    return match ? match.region : null;
  }

  function startCameraTween(destination, duration, onComplete) {
    const from = cameraSnapshot();
    const to = {
      target: destination.target ? { ...destination.target } : { ...from.target },
      yaw: destination.yaw ?? from.yaw,
      pitch: destination.pitch ?? from.pitch,
      distance: destination.distance ?? from.distance
    };
    state.cameraTween = {
      from,
      to,
      startedAt: performance.now(),
      duration: state.reducedMotion ? Math.min(150, duration) : duration,
      onComplete
    };
  }

  function travelStageDuration(fullDuration) {
    return state.reducedMotion ? REDUCED_TRAVEL_STAGE_DURATION : fullDuration;
  }

  function updateCameraTween(now) {
    if (!state.cameraTween) {
      return;
    }
    const tween = state.cameraTween;
    const progress = clamp((now - tween.startedAt) / Math.max(1, tween.duration), 0, 1);
    const eased = 1 - Math.pow(1 - progress, 4);
    camera.target = V.lerp(tween.from.target, tween.to.target, eased);
    camera.yaw = tween.from.yaw + (tween.to.yaw - tween.from.yaw) * eased;
    camera.pitch = tween.from.pitch + (tween.to.pitch - tween.from.pitch) * eased;
    camera.distance = tween.from.distance + (tween.to.distance - tween.from.distance) * eased;
    if (progress >= 1) {
      state.cameraTween = null;
      if (typeof tween.onComplete === "function") {
        tween.onComplete();
      }
    }
  }

  function announce(message) {
    ui.ariaLive.textContent = "";
    global.requestAnimationFrame(() => {
      ui.ariaLive.textContent = message;
    });
  }

  function hideDetailMagnifierPanel() {
    state.detailMagnifier.targetKey = "";
    state.detailMagnifier.layoutKey = "";
    state.detailMagnifier.targetKind = "";
    state.detailMagnifier.targetNodeKey = "";
    state.detailMagnifier.targetEdgeId = "";
    ui.detailMagnifier.hidden = true;
  }

  function setDetailMagnifierEnabled(enabled) {
    state.detailMagnifier.enabled = enabled === true;
    ui.detailMagnifierCursor.hidden = true;
    canvas.dataset.detailMagnifier = state.detailMagnifier.enabled ? "on" : "off";
    canvas.style.cursor = state.detailMagnifier.enabled ? "" : "default";
    if (state.detailMagnifier.enabled) {
      updateDetailMagnifier(state.pointerPosition, state.hovered);
    } else {
      hideDetailMagnifierPanel();
    }
    announce(state.detailMagnifier.enabled
      ? "全文放大镜已开启；悬停球镜或详情框阅读 Markdown 全文"
      : "全文放大镜已关闭");
  }

  function currentMagnifierNode(point) {
    const match = state.hitRegions
      .filter((region) => (
        region.item
        && region.item.node
        && !region.item.clusterShellProxy
      ))
      .map((region) => ({
        region,
        distance: Math.hypot(point.x - region.x, point.y - region.y),
        radius: Math.max(1, region.radius)
      }))
      .filter((entry) => entry.distance <= entry.radius * 1.14)
      .sort((left, right) => (
        left.distance / left.radius - right.distance / right.radius
        || left.radius - right.radius
      ))[0];
    return match ? {
      node: match.region.item.node,
      ownerPath: match.region.item.ownerPath || nodeOwnerPath(match.region.item.node),
      normalizedDistance: match.distance / match.radius
    } : null;
  }

  function currentMagnifierRelation(point) {
    const match = state.relationHitRegions
      .map((region) => ({
        ...region,
        distance: Math.hypot(point.x - region.x, point.y - region.y),
        normalizedDistance: Math.hypot(point.x - region.x, point.y - region.y) / Math.max(1, region.radius)
      }))
      .filter((region) => region.item && region.item.edge && region.distance <= Math.max(1, region.radius))
      .sort((left, right) => (
        left.distance / Math.max(1, left.radius) - right.distance / Math.max(1, right.radius)
      ))[0];
    return match || null;
  }

  function updateDetailMagnifier(point, _node) {
    if (!state.detailMagnifier.enabled) return;
    const nodeHit = currentMagnifierNode(point);
    const relationHit = currentMagnifierRelation(point);
    const preferNode = nodeHit && (!relationHit || nodeHit.normalizedDistance <= 0.72);
    const node = preferNode ? nodeHit.node : null;
    const relation = preferNode ? null : relationHit;
    const target = detailMagnifierModel.targetAt({
      node,
      nodeOwnerPath: nodeHit ? nodeHit.ownerPath : "",
      relations: relation ? [{ ...relation, edge: relation.item.edge, label: relation.item.label }] : [],
      boxes: state.renderedFloatingDetailBoxes,
      regions: state.clusterHitRegions.map((region) => ({
        ...region,
        node: region.magnifierNode
      })),
      x: point.x,
      y: point.y
    });
    if (!target) {
      hideDetailMagnifierPanel();
      return;
    }
    const detail = String(target.detail || "").trim() || "暂无详情";
    const relationship = target.kind === "relationship";
    const targetNodeKey = relationship ? "" : visualNodeKey(
      target.node,
      target.ownerPath || nodeHit?.ownerPath || nodeOwnerPath(target.node)
    );
    const targetEdgeId = relationship ? workspaceModel.edgeIdentity(target.edge) : "";
    state.detailMagnifier.targetKind = target.kind;
    state.detailMagnifier.targetNodeKey = targetNodeKey;
    state.detailMagnifier.targetEdgeId = targetEdgeId;
    const key = relationship
      ? `relationship:${targetEdgeId}:${detail}`
      : `node:${targetNodeKey}:${detail}`;
    if (state.detailMagnifier.targetKey !== key) {
      state.detailMagnifier.targetKey = key;
      ui.detailMagnifierTitle.textContent = relationship
        ? `关系｜${target.label || target.edge.label || "关系"}`
        : String(target.node.label || target.node.name || "全文");
      if (markdownEditor) {
        ui.detailMagnifierContent.innerHTML = markdownEditor.renderMarkdown(detail);
      } else {
        ui.detailMagnifierContent.textContent = detail;
      }
      ui.detailMagnifier.scrollTop = 0;
    }
    const layoutKey = `${key}:${state.width}:${state.height}`;
    if (state.detailMagnifier.layoutKey !== layoutKey) {
      state.detailMagnifier.layoutKey = layoutKey;
      const layout = detailMagnifierModel.panelLayout({
        x: point.x,
        y: point.y,
        viewportWidth: state.width,
        viewportHeight: state.height
      });
      ui.detailMagnifier.style.left = `${layout.left}px`;
      ui.detailMagnifier.style.top = `${layout.top}px`;
      ui.detailMagnifier.style.width = `${layout.width}px`;
      ui.detailMagnifier.style.maxHeight = `${layout.maxHeight}px`;
    }
    ui.detailMagnifier.hidden = false;
  }

  function currentInteractionPhase() {
    let desiredPhase;
    if (state.drag) {
      desiredPhase = grammar.interactionPhases.manipulate;
    } else if (state.pointerCandidate) {
      desiredPhase = grammar.interactionPhases.aim;
    } else if (
      state.transitionLocked
      || state.commitPulseUntil > performance.now()
      || state.confirmationRipples.size > 0
    ) {
      desiredPhase = grammar.interactionPhases.commit;
    } else if (state.selected && state.selected.peekOpen) {
      desiredPhase = grammar.interactionPhases.preview;
    } else if (state.focused || state.selected) {
      desiredPhase = grammar.interactionPhases.focus;
    } else if (state.hovered) {
      desiredPhase = grammar.interactionPhases.aim;
    } else {
      desiredPhase = grammar.interactionPhases.idle;
    }

    if (desiredPhase !== state.interactionPhase) {
      if (grammar.canTransitionInteraction(state.interactionPhase, desiredPhase)) {
        state.interactionPhase = desiredPhase;
      } else if (
        grammar.canTransitionInteraction(state.interactionPhase, grammar.interactionPhases.idle)
        && grammar.canTransitionInteraction(grammar.interactionPhases.idle, desiredPhase)
      ) {
        state.interactionPhase = desiredPhase;
      }
    }
    return state.interactionPhase;
  }

  function pathLabelsForPath(path) {
    if (path === state.currentPath) return [...state.crumbs];
    if (path === "root") return ["全域"];
    const route = state.domainRoutes.get(path);
    if (route && route.length) {
      const entry = route.at(-1);
      return [...entry.crumbs, entry.nodeLabel];
    }
    return ["全域", ...path.split("/").slice(1).map((part) => `域 ${part.slice(0, 5)}`)];
  }

  function buildSearchEntries() {
    const entries = [];
    for (const [path, nodes] of domainCache.entries()) {
      if (path !== "root" && path !== state.currentPath && !state.domainRoutes.has(path)) continue;
      const pathLabels = pathLabelsForPath(path);
      for (const node of existingNodes(workspace.projectDomain(path, nodes))) {
        entries.push({ path, pathLabels, nodeId: node.id, label: node.label });
      }
    }
    return entries;
  }

  function appendHighlightedSegments(container, segments) {
    for (const segment of segments) {
      const part = document.createElement(segment.match ? "mark" : "span");
      part.textContent = segment.text;
      container.append(part);
    }
  }

  function renderSearchResults() {
    const query = ui.spatialSearch.value;
    const results = workspaceModel.searchEntries(buildSearchEntries(), query);
    state.searchMatches = results;
    ui.searchResults.replaceChildren();
    results.forEach((result, resultIndex) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const pathLabel = document.createElement("span");
      const name = document.createElement("span");
      button.type = "button";
      button.className = "search-result";
      button.dataset.searchIndex = String(resultIndex);
      pathLabel.className = "search-result__path";
      name.className = "search-result__name";
      result.pathSegments.forEach((segments, index) => {
        if (index) pathLabel.append(document.createTextNode("  /  "));
        appendHighlightedSegments(pathLabel, segments);
      });
      appendHighlightedSegments(name, result.labelSegments);
      button.append(pathLabel, name);
      button.addEventListener("click", () => jumpToSearchResult(result));
      item.append(button);
      ui.searchResults.append(item);
    });
    if (query.trim() && !results.length) {
      const empty = document.createElement("li");
      empty.className = "search-result__empty";
      empty.textContent = "已访问空间中没有匹配节点";
      ui.searchResults.append(empty);
    }
  }

  function openSearch() {
    ui.mappingPanel.hidden = true;
    ui.helpPanel.hidden = true;
    ui.searchPanel.hidden = false;
    renderSearchResults();
    ui.spatialSearch.focus({ preventScroll: true });
    ui.spatialSearch.select();
  }

  function closeSearch() {
    ui.searchPanel.hidden = true;
    canvas.focus({ preventScroll: true });
  }

  function locateNodeWithoutZoom(nodeId) {
    hydrateNodePath(state.nodes, nodeId, true);
    const node = currentNodeById(nodeId);
    if (!node) return false;
    state.selected = node;
    state.focused = null;
    state.locatedNodeId = node.id;
    state.locatedUntil = performance.now() + (state.reducedMotion ? 150 : 920);
    updateSelectionUI();
    announce(`已定位 ${node.label}`);
    return true;
  }

  function jumpToSearchResult(result) {
    if (!result) return false;
    if (result.path === state.currentPath) {
      closeSearch();
      return locateNodeWithoutZoom(result.nodeId);
    }
    const route = state.domainRoutes.get(result.path);
    if (!route) {
      announce("该结果没有可返回的已访问域径");
      return false;
    }
    recordCurrentView();
    state.currentPath = result.path;
    state.domainStack = cloneDomainStack(route);
    state.depth = route.length;
    state.crumbs = [...result.pathLabels];
    state.nodes = createDomain(result.path, state.depth);
    state.selected = null;
    state.focused = null;
    state.hovered = null;
    state.menuFor = null;
    closeSearch();
    const located = locateNodeWithoutZoom(result.nodeId);
    recordCurrentView();
    return located;
  }

  function setEditVisualState(status) {
    const stateName = status === "delete" ? "delete" : "update";
    ui.nodeNameEditorWrap.dataset.editState = stateName;
    ui.lensEditor.dataset.editState = stateName;
    ui.editStatus.dataset.editState = stateName;
    ui.editStatus.textContent = stateName === "delete"
      ? "删除预警 · Enter 确认丢失 · Esc 取消"
      : "待提交更新 · Enter 确认 · Shift+Enter 换行 · Esc 取消";
  }

  function closeNodeEditor() {
    state.nodeEditorFallback = null;
    state.nodeEditorAnchor = null;
    if (markdownEditor) markdownEditor.resetMode();
    ui.nodeNameEditorWrap.hidden = true;
    ui.edgeNameEditorWrap.hidden = true;
    ui.lensEditor.hidden = true;
    ui.editStatus.hidden = true;
    ui.attachmentInput.value = "";
  }

  function openNodeEditor(node, path = state.currentPath) {
    const transaction = workspace.transaction();
    if (!transaction || !["node-create", "node-edit"].includes(transaction.kind)) return;
    const draft = transaction.draft;
    state.selected = workspace.projectNode(path, node) || node;
    ui.nodeNameEditor.value = draft.label || "";
    ui.nodeTypeEditor.value = Array.isArray(draft.atomTypes) ? draft.atomTypes[0] || "" : "";
    ui.nodeDetailEditor.value = draft.description || "";
    if (markdownEditor) markdownEditor.setValue(draft.description || "");
    ui.attachmentMeta.textContent = draft.attachment ? draft.attachment.name : "纯文本";
    ui.nodeNameEditorWrap.hidden = false;
    ui.lensEditor.hidden = false;
    ui.editStatus.hidden = false;
    setEditVisualState(transaction.status);
    updateSelectionUI();
    global.requestAnimationFrame(() => {
      ui.nodeNameEditor.focus({ preventScroll: true });
      ui.nodeNameEditor.select();
    });
  }

  function prepareWorkspaceNode(node, path = state.currentPath) {
    const detailMode = visualModel.detailModeFor(node);
    Object.assign(node, {
      definitionId: null,
      preview: "lens",
      preferredIntent: "activate",
      capabilities: registry.defaultCapabilities,
      visualBudget: registry.defaultVisualBudget,
      depthIndex: existingNodes(workspace.projectDomain(path, domainCache.get(path) || [])).length,
      parent: null,
      satellites: node.satellites || [],
      revealed: false,
      peekOpen: false,
      lensOpen: false,
      lensOpenedAt: 0,
      surfaceVisible: detailMode === "surface",
      detailMode,
      surfaceOpenedAt: detailMode === "surface" ? performance.now() : 0,
      pinned: false,
      pinnedAt: 0,
      manualPosition: node.clusterLocalPositionLocked ? { ...node.position } : null,
      layoutIdentity: node.layoutIdentity || node.id,
      isPrimary: true,
      semanticStage: 0
    });
    return node;
  }

  function clusterLocalPosition(point, domainContext = null) {
    const basis = cameraBasis();
    if (state.clusterFieldOpen && domainContext) {
      const world = unprojectScreen(point.x, point.y, domainContext.screenDepth, basis);
      const scale = Math.max(0.0001, Number(domainContext.nodeScale) || 1);
      return V.scale(V.sub(world, domainContext.center), 1 / scale);
    }
    const depth = clamp(camera.distance * 0.68, 4.8, 10.5);
    return unprojectScreen(point.x, point.y, depth, basis);
  }

  function beginNodeCreateAt(point, domainContext = null) {
    if (workspace.transaction()) {
      announce("请先用 Enter 或 Esc 结束当前编辑");
      return false;
    }
    if (state.clusterFieldOpen && !domainContext) {
      announce("请在一个球团的空白区域内新增节点");
      return false;
    }
    if (state.clusterFieldOpen) {
      state.cameraTween = null;
    }
    const path = domainContext ? domainContext.path : state.currentPath;
    const position = clusterLocalPosition(point, domainContext);
    const node = workspace.beginNodeCreate(path, {
      label: "未命名节点",
      description: "",
      position,
      radius: 0.82,
      clusterLocalPositionLocked: true
    });
    if (!node) return false;
    prepareWorkspaceNode(node, path);
    node.clusterLocalPositionLocked = true;
    node.__clusterOwnerPath = path;
    state.nodeEditorFallback = {
      x: point.x,
      y: point.y,
      radius: 36
    };
    state.nodeEditorAnchor = {
      node,
      path,
      screen: { ...state.nodeEditorFallback }
    };
    openNodeEditor(node, path);
    announce("新节点已出现，输入名称后按 Enter 提交");
    return true;
  }

  function beginNodeEdit(node, hitItem = null) {
    if (!node || workspace.transaction()) {
      if (workspace.transaction()) announce("请先用 Enter 或 Esc 结束当前编辑");
      return false;
    }
    const path = node.__clusterOwnerPath || node.workspacePath || state.currentPath;
    const resolvedNode = nodeByIdInPath(path, node.id) || node;
    if (!workspace.beginNodeEdit(path, resolvedNode)) return false;
    const renderedHit = hitItem && hitItem.node === node
      ? hitItem
      : state.rendered.find((item) => item.kind === "node" && item.node === node) || null;
    state.nodeEditorAnchor = {
      node,
      path,
      screen: renderedHit && renderedHit.screen ? { ...renderedHit.screen } : null
    };
    state.nodeEditorFallback = state.nodeEditorAnchor.screen;
    openNodeEditor(resolvedNode, path);
    announce(`正在编辑 ${resolvedNode.label}`);
    return true;
  }

  function beginNodeLandingAt(point, domainContext = null) {
    const transaction = workspace.transaction();
    if (!transaction || transaction.kind !== "edge-create" || transaction.target) return false;
    if (state.clusterFieldOpen && !domainContext) {
      announce("请在目标球团的空白区域内落脚");
      return false;
    }
    const targetPath = domainContext ? domainContext.path : state.currentPath;
    const targetNodes = domainCache.get(targetPath) || (targetPath === state.currentPath ? state.nodes : []);
    const collision = existingNodes(projectDomainNodes(targetPath, targetNodes))
      .find((node) => node.id === transaction.source.nodeId);
    if (collision && transaction.source.path !== targetPath) {
      announce("目标域中已有同一节点，未执行落脚");
      return false;
    }
    const position = clusterLocalPosition(point, domainContext);
    if (!workspace.setNodeLanding({
      path: targetPath,
      pathLabels: domainContext ? [...domainContext.pathLabels] : [...state.crumbs],
      position
    })) {
      announce("节点无法落到当前位置");
      return false;
    }
    const preview = existingNodes(projectDomainNodes(targetPath, targetNodes))
      .find((node) => node.id === transaction.source.nodeId) || null;
    if (preview) preview.__clusterOwnerPath = targetPath;
    state.selected = preview;
    state.focused = null;
    updateSelectionUI();
    ui.editStatus.hidden = false;
    setEditVisualState("update");
    ui.editStatus.textContent = "节点落脚待提交 · Enter 确认 · Esc 取消";
    const targetLabel = pathLabelsForPath(targetPath).at(-1) || "目标域";
    announce(`${transaction.source.label} 已落到 ${targetLabel}，按 Enter 提交`);
    return true;
  }

  function beginEdgeGesture(node, item, point = state.pointerPosition, domainContext = null) {
    const active = workspace.transaction();
    if (item && item.kind === "relationship") {
      if (active) {
        announce("请先用 Enter 或 Esc 结束当前关系编辑");
        return false;
      }
      workspace.beginEdgeEdit(item.edge);
      ui.edgeNameEditor.value = item.edge.label || item.label || "关联";
      ui.edgeNameEditorWrap.hidden = false;
      ui.edgeNameEditorWrap.style.setProperty("--editor-x", `${point.x}px`);
      ui.edgeNameEditorWrap.style.setProperty("--editor-y", `${point.y}px`);
      ui.edgeNameEditorWrap.style.setProperty("--editor-offset-x", "1.5rem");
      ui.editStatus.hidden = false;
      setEditVisualState("update");
      ui.editStatus.textContent = "修改关系名称 · Enter 确认 · Delete 删除 · Esc 取消";
      global.requestAnimationFrame(() => {
        ui.edgeNameEditor.focus({ preventScroll: true });
        ui.edgeNameEditor.select();
      });
      announce("关系线已选中");
      return true;
    }
    if (!node) {
      if (active && active.kind === "edge-create" && !active.target) {
        return beginNodeLandingAt(point, domainContext);
      }
      return false;
    }
    const endpointPath = node.__clusterOwnerPath || node.workspacePath || state.currentPath;
    const endpoint = workspaceModel.qualifiedEndpoint(endpointPath, node, pathLabelsForPath(endpointPath));
    if (!active) {
      const transaction = workspace.beginEdgeCreate(endpoint, node);
      const clickedKey = visualNodeKey(node, endpointPath);
      if (transaction && state.batchSelectionKeys.size > 1 && state.batchSelectionKeys.has(clickedKey)) {
        transaction.batchEntries = [...state.batchSelectionKeys]
          .map((key) => visualEntryForKey(key))
          .filter(Boolean)
          .map((entry) => ({
            source: workspaceModel.qualifiedEndpoint(
              entry.ownerPath,
              entry.node,
              pathLabelsForPath(entry.ownerPath)
            ),
            sourceNode: entry.node
          }));
      }
      state.selected = node;
      updateSelectionUI();
      ui.editStatus.hidden = false;
      setEditVisualState("update");
      ui.editStatus.textContent = `连接起点 · ${node.label} · Ctrl + 右键选择落脚`;
      announce(`已选择关系起点 ${node.label}`);
      return true;
    }
    if (active.kind === "edge-create" && !active.target) {
      if (!workspace.setEdgeTarget(endpoint)) {
        announce("起点与落脚不能是同一节点");
        return false;
      }
      state.selected = node;
      updateSelectionUI();
      ui.editStatus.textContent = "关系待提交 · Enter 确认 · Esc 取消";
      announce(`已选择关系落脚 ${node.label}`);
      return true;
    }
    announce("当前编辑事务尚未结束");
    return false;
  }

  function syncEditorOverlays() {
    const transaction = workspace.transaction();
    if (!transaction || !["node-create", "node-edit"].includes(transaction.kind)) return;
    workspace.updateNodeDraft({
      label: ui.nodeNameEditor.value,
      atomTypes: ui.nodeTypeEditor.value.trim() ? [ui.nodeTypeEditor.value.trim().replace(/^@+/u, "")] : [],
      description: markdownEditor ? markdownEditor.getValue() : ui.nodeDetailEditor.value,
      attachment: transaction.draft.attachment
    });
    const nodeId = transaction.draft.id || (transaction.node && transaction.node.id);
    const anchor = state.nodeEditorAnchor || {
      node: transaction.node || transaction.draft,
      path: transaction.path || state.currentPath,
      screen: state.nodeEditorFallback
    };
    const rendered = state.rendered.find((item) => item.kind === "node" && item.node === anchor.node)
      || state.rendered.find((item) => (
        item.kind === "node"
        && item.node.id === nodeId
        && nodeOwnerPath(item.node) === anchor.path
      ));
    const editorScreen = rendered ? rendered.screen : anchor.screen || state.nodeEditorFallback;
    if (!editorScreen) {
      ui.nodeNameEditorWrap.hidden = true;
      ui.lensEditor.hidden = true;
      return;
    }
    ui.nodeNameEditorWrap.hidden = false;
    ui.lensEditor.hidden = false;
    const lensSize = clamp(editorScreen.radius * 2.18, 220, 620);
    ui.nodeNameEditorWrap.dataset.side = "inside";
    ui.lensEditor.style.setProperty("--lens-x", `${editorScreen.x}px`);
    ui.lensEditor.style.setProperty("--lens-y", `${editorScreen.y}px`);
    ui.lensEditor.style.setProperty("--lens-size", `${lensSize}px`);
    ui.lensEditor.style.setProperty("--lens-padding", `${clamp(lensSize * 0.16, 32, 92)}px`);
  }

  let workspacePersistenceSequence = 0;

  function persistWorkspaceSnapshot(operation) {
    const persistenceId = operation && typeof operation === "object"
      ? ++workspacePersistenceSequence
      : null;
    global.dispatchEvent(new CustomEvent("spatial-workspace-committed", {
      detail: Object.freeze({
        knowledge: workspace.exportKnowledge(),
        path: state.currentPath,
        operation,
        persistenceId
      })
    }));
    return persistenceId;
  }

  global.addEventListener("spatial-workspace-persisted", (event) => {
    if (!event.detail || !Number.isFinite(Number(event.detail.persistenceId))) return;
    const operation = event.detail.operation;
    const kind = operation && operation.kind || "";
    if (kind === "node-land-batch") {
      const movedCount = Array.isArray(operation.landings) ? operation.landings.length : 0;
      state.focused = null;
      updateSelectionUI();
      announce(`${movedCount} 个节点已移动并保存`);
      return;
    }
    if (kind === "node-land") {
      const persisted = workspaceModel.persistedLandingNode(operation, event.detail.knowledge);
      if (persisted) {
        if (state.expandedClusterDomains.has(persisted.path)) buildClusterScene();
        state.selected = nodeByIdInPath(persisted.path, persisted.id || persisted.nodeId);
        state.focused = null;
        updateSelectionUI();
        announce("节点已移动并保存");
        return;
      }
    }
    if (["node-create", "node-edit"].includes(kind) && event.detail.persistedNode) {
      const persisted = event.detail.persistedNode;
      if (persisted.path === state.currentPath) {
        state.selected = nodeByIdInPath(persisted.path, persisted.id || persisted.nodeId);
        state.focused = null;
      }
      if (state.selected) {
        updateSelectionUI();
        announce(kind === "node-create" ? "节点已创建并保存" : "节点已更新并保存");
        return;
      }
    }
    announce(kind.startsWith("edge-") ? "关系已保存" : "节点已保存");
  });

  global.addEventListener("spatial-workspace-persist-failed", (event) => {
    if (!event.detail || !Number.isFinite(Number(event.detail.persistenceId))) return;
    const message = String(event.detail.message || "服务未确认本次编辑");
    announce(`保存失败，已恢复保存前内容：${message}`);
  });

  function drawClusterConnections(rendered) {
    state.relationHitRegions = [];
    const renderedNodes = new Map(rendered
      .filter((item) => item.kind === "node" && item.node && item.ownerPath)
      .map((item) => [`${item.ownerPath}::${item.node.id}`, item]));

    for (const cluster of state.clusterScene.clusters) {
      let labels = 0;
      const nodes = cluster.nodes.map((clusterNode) => clusterNode.sourceNode || clusterNode);
      for (const relationship of visualModel.relationshipPairs(nodes)) {
        const from = renderedNodes.get(`${cluster.path}::${relationship.fromId}`);
        const to = renderedNodes.get(`${cluster.path}::${relationship.toId}`);
        if (!from || !to) continue;
        drawTopologyLink(from, to, {
          ...relationship,
          label: relationship.label || "关联",
          showLabel: labels++ < 3
        });
      }
    }

    for (const { edge, fromEndpoint, toEndpoint } of state.clusterConnectionEdges) {
      const from = renderedNodes.get(`${fromEndpoint.path}::${fromEndpoint.nodeId}`);
      const to = renderedNodes.get(`${toEndpoint.path}::${toEndpoint.nodeId}`);
      if (!from || !to) continue;
      drawTopologyLink(from, to, {
        fromId: fromEndpoint.nodeId,
        toId: toEndpoint.nodeId,
        kind: fromEndpoint.path === toEndpoint.path ? "association" : "cross-domain",
        label: edge.label || "关联",
        showLabel: true,
        edge
      });
    }

    const transaction = workspace.transaction();
    if (transaction && transaction.kind === "edge-create" && transaction.target) {
      const fromEndpoint = workspace.resolveEndpoint(transaction.source);
      const toEndpoint = workspace.resolveEndpoint(transaction.target);
      const from = renderedNodes.get(`${fromEndpoint.path}::${fromEndpoint.nodeId}`);
      const to = renderedNodes.get(`${toEndpoint.path}::${toEndpoint.nodeId}`);
      if (from && to) {
        const pendingEdge = {
          id: workspaceModel.edgeIdentity({ from: transaction.source, to: transaction.target }),
          from: transaction.source,
          to: transaction.target,
          label: "关联",
          crossDomain: fromEndpoint.path !== toEndpoint.path
        };
        drawTopologyLink(from, to, {
          fromId: fromEndpoint.nodeId,
          toId: toEndpoint.nodeId,
          kind: pendingEdge.crossDomain ? "cross-domain" : "association",
          label: "关联 · ENTER 提交",
          showLabel: true,
          edge: pendingEdge,
          pending: true
        });
      }
    }
  }

  function commitWorkspaceEdit() {
    const transaction = workspace.transaction();
    if (!transaction) return false;
    if (["node-create", "node-edit"].includes(transaction.kind)) syncEditorOverlays();
    if (transaction.kind === "edge-edit" && transaction.status !== "delete") {
      workspace.updateEdgeDraft({ label: ui.edgeNameEditor.value });
    }
    let operation = workspace.commit();
    if (!operation) {
      announce("请先选择关系落脚节点");
      return false;
    }
    operation = workspaceModel.batchLandingOperation(operation, operation.batchEntries);
    closeNodeEditor();
    if (operation.kind === "node-edit" && operation.status === "delete") {
      state.selected = null;
      announce("节点已从当前视觉图中移除");
    } else if (operation.kind === "node-create" && operation.cancelledCreate) {
      state.selected = null;
      announce("未提交的新节点已移除");
    } else if (operation.kind === "edge-edit" && operation.status === "delete") {
      announce("关系线已移除");
    } else if (operation.kind === "edge-create") {
      state.selected = operation.target
        ? nodeByIdInPath(operation.target.path, operation.target.nodeId)
        : null;
      announce("关系已提交");
    } else if (operation.kind === "node-land" || operation.kind === "node-land-batch") {
      state.selected = operation.target
        ? nodeByIdInPath(operation.target.path, operation.draft && operation.draft.id)
        : null;
      const targetLabel = operation.target
        ? pathLabelsForPath(operation.target.path).at(-1) || "目标域"
        : "目标域";
      const movedCount = operation.kind === "node-land-batch" ? operation.landings.length : 1;
      announce(`${movedCount} 个节点已落到 ${targetLabel}，旧关系保留为跨域长尾`);
    } else {
      const nodeId = operation.draft && operation.draft.id
        ? operation.draft.id
        : operation.node && operation.node.id;
      const operationPath = operation.path || nodeOwnerPath(operation.node, state.currentPath);
      state.selected = nodeId ? nodeByIdInPath(operationPath, nodeId) : state.selected;
      announce(operation.kind.startsWith("edge-") ? "关系已提交" : "节点更新已提交");
    }
    updateSelectionUI();
    renderSearchResults();
    announce("正在保存，等待 Atom 确认");
    persistWorkspaceSnapshot(operation);
    canvas.focus({ preventScroll: true });
    return true;
  }

  function cancelWorkspaceEdit() {
    const transaction = workspace.transaction();
    if (!transaction) return false;
    const landing = transaction.kind === "node-land";
    const nodeId = landing
      ? transaction.source && transaction.source.nodeId
      : transaction.node && transaction.node.id;
    const sourcePath = landing
      ? transaction.source && transaction.source.path
      : transaction.path || nodeOwnerPath(transaction.node, state.currentPath);
    workspace.cancel();
    closeNodeEditor();
    state.selected = nodeId && sourcePath ? nodeByIdInPath(sourcePath, nodeId) : null;
    updateSelectionUI();
    announce("编辑已取消，原状态已恢复");
    canvas.focus({ preventScroll: true });
    return true;
  }

  function markWorkspaceDelete() {
    const transaction = workspace.transaction();
    if (!transaction) return false;
    if (!workspace.markDelete()) {
      announce("未提交的新关系请按 Esc 取消");
      return false;
    }
    setEditVisualState("delete");
    announce(transaction.kind.startsWith("edge-") ? "关系进入删除预警" : "节点进入删除预警");
    return true;
  }

  function updateNavigationUI() {
    if (ui.viewBackAction) {
      ui.viewBackAction.disabled = !state.viewHistory.canBack || state.transitionLocked;
    }
    if (ui.viewForwardAction) {
      ui.viewForwardAction.disabled = !state.viewHistory.canForward || state.transitionLocked;
    }
    if (ui.exitAction) {
      ui.exitAction.disabled = state.depth === 0 || state.transitionLocked;
    }
    if (ui.worldLensAction) {
      ui.worldLensAction.setAttribute("aria-pressed", String(state.worldLens.open));
    }
  }

  function updateSelectionUI() {
    if (!state.selected) {
      const viewLabel = viewModeModel.modeLabels[state.viewMode] || state.viewMode;
      ui.selectionLabel.textContent = state.clusterFieldOpen
        ? `${state.clusterScene.clusters.length} 域 · ${viewLabel}视角`
        : state.depth ? `第 ${state.depth} 层球域` : "无中心多球系";
      ui.selectionCopy.textContent = state.clusterFieldOpen
        ? "已展开的空间结果保持原投影；切换模式只改变下一次右键动作。"
        : "所有球体都是隧洞；有子内容可同层展收，空隧洞也可进入并在内部新增节点。";
      ui.selectionCaps.textContent = state.clusterFieldOpen
        ? `A内包 · S外围 · D层级 · F沉浸 · 当前 ${viewLabel} · Shift 魔杖`
        : `当前 ${viewLabel} · 右键应用 · 中键单击聚焦／拖动旋转`;
      return;
    }
    const selectionPath = state.selected.__clusterOwnerPath || state.selected.workspacePath || state.currentPath;
    const selected = workspace.projectNode(selectionPath, state.selected) || state.selected;
    ui.selectionLabel.textContent = atomDisplayName(selected);
    ui.selectionCopy.textContent = selected.description;
    const carrierMode = visualModel.deriveCarrierMode(state.selected);
    const active = [
      carrierMode === "tunnel" && selected.hasChildren === true ? "隧洞载体" : "空隧洞",
      selected.surfaceVisible ? "球面开启" : "球面静默",
      state.wand.highEnergy ? "玉杖递归" : null
    ];
    ui.selectionCaps.textContent = active.filter(Boolean).join(" · ");
  }

  function updateMetrics() {
    const visibleNodeCount = state.clusterFieldOpen
      ? state.clusterScene.clusters.reduce((count, cluster) => count + cluster.nodes.length, 0)
      : state.rendered.filter((item) => item.kind === "node").length;
    ui.metricDepth.textContent = String(state.depth).padStart(2, "0");
    ui.metricVisible.textContent = String(visibleNodeCount).padStart(2, "0");
    const worldRangeScale = camera.distance / MIN_CAMERA_DISTANCE;
    const scalePrecision = worldRangeScale < 10 ? 2 : worldRangeScale < 100 ? 1 : 0;
    ui.metricScale.textContent = Number(worldRangeScale.toFixed(scalePrecision)).toLocaleString();
    ui.metricPhase.textContent = grammar.interactionPhaseLabel(currentInteractionPhase());
    ui.path.textContent = state.crumbs.join("  /  ");
    canvas.dataset.viewMode = state.viewMode;
    canvas.dataset.wand = state.wand.highEnergy ? "jade" : "wood";
    canvas.dataset.clusterCount = String(state.clusterFieldOpen ? state.clusterScene.clusters.length : 1);
    canvas.dataset.clusterCompressionMultiplier = String(
      state.clusterFieldOpen ? state.clusterScene.compressionMultiplier || 1 : 1
    );
    canvas.dataset.clusterSceneRadius = String(
      state.clusterFieldOpen ? state.clusterScene.bounds.radius || 0 : 0
    );
    canvas.dataset.clusterShellOverlapCount = String(
      state.clusterFieldOpen ? state.clusterScene.shellOverlapCount || 0 : 0
    );
    const detailFocus = effectiveDetailFocus();
    canvas.dataset.middleDetailFocusKind = detailFocus.kind || "";
    canvas.dataset.middleDetailFocusPath = detailFocus.path || detailFocus.descendantPath || "";
    canvas.dataset.middleDetailFocusAnchor = detailFocus.anchorKey || "";
    canvas.dataset.middleDetailDepth = String(state.demo.settings.middleDetailDepth);
    canvas.dataset.highlightedDetailBrightness = String(
      state.demo.settings.highlightedDetailBrightnessPercent
    );
    canvas.dataset.otherDetailBrightness = String(
      state.demo.settings.otherDetailBrightnessPercent
    );
    canvas.dataset.cameraDistance = camera.distance.toFixed(4);
    canvas.dataset.cameraYaw = camera.yaw.toFixed(5);
    canvas.dataset.cameraPitch = camera.pitch.toFixed(5);
    canvas.dataset.cameraTarget = [camera.target.x, camera.target.y, camera.target.z]
      .map((value) => value.toFixed(4))
      .join(",");
    const renderedNodeRegions = state.clusterFieldOpen
      ? state.rendered.filter((item) => item.kind === "node" && !item.clusterShellProxy && item.screen)
      : [];
    let renderedNodeOverlapCount = 0;
    const renderedNodeOverlapPairs = [];
    for (let leftIndex = 0; leftIndex < renderedNodeRegions.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < renderedNodeRegions.length; rightIndex += 1) {
        const left = renderedNodeRegions[leftIndex].screen;
        const right = renderedNodeRegions[rightIndex].screen;
        const screenPenetration = left.radius + right.radius
          - Math.hypot(right.x - left.x, right.y - left.y);
        if (screenPenetration > 0.01) {
          renderedNodeOverlapCount += 1;
          if (renderedNodeOverlapPairs.length < 12) {
            renderedNodeOverlapPairs.push(
              `${renderedNodeRegions[leftIndex].ownerPath}::${renderedNodeRegions[leftIndex].node.id}`
                + `~${renderedNodeRegions[rightIndex].ownerPath}::${renderedNodeRegions[rightIndex].node.id}`
                + `@${screenPenetration.toFixed(2)}`
            );
          }
        }
      }
    }
    let siblingClusterOverlapCount = 0;
    for (let leftIndex = 0; leftIndex < state.clusterHitRegions.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < state.clusterHitRegions.length; rightIndex += 1) {
        const left = state.clusterHitRegions[leftIndex];
        const right = state.clusterHitRegions[rightIndex];
        const ancestorPair = left.path === right.path
          || left.path.startsWith(`${right.path}/`)
          || right.path.startsWith(`${left.path}/`);
        if (ancestorPair) continue;
        if (Math.hypot(right.x - left.x, right.y - left.y) + 0.01 < left.radius + right.radius) {
          siblingClusterOverlapCount += 1;
        }
      }
    }
    let floatingDetailOverlapCount = 0;
    for (let leftIndex = 0; leftIndex < state.renderedFloatingDetailBoxes.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < state.renderedFloatingDetailBoxes.length;
        rightIndex += 1
      ) {
        if (
          overlapArea(
            state.renderedFloatingDetailBoxes[leftIndex],
            state.renderedFloatingDetailBoxes[rightIndex]
          ) > 0.01
        ) {
          floatingDetailOverlapCount += 1;
        }
      }
    }
    canvas.dataset.clusterNodeOverlapCount = String(renderedNodeOverlapCount);
    canvas.dataset.clusterNodeOverlapPairs = renderedNodeOverlapPairs.join("|");
    canvas.dataset.clusterSiblingOverlapCount = String(siblingClusterOverlapCount);
    canvas.dataset.floatingDetailCount = String(
      state.floatingNodeDetailCount + state.floatingClusterDetailCount
    );
    canvas.dataset.floatingNodeDetailCount = String(state.floatingNodeDetailCount);
    canvas.dataset.floatingClusterDetailCount = String(state.floatingClusterDetailCount);
    canvas.dataset.floatingDetailOverlapCount = String(floatingDetailOverlapCount);
    canvas.dataset.floatingDetailHiddenCount = String(state.floatingDetailHiddenCount);
    updateNavigationUI();
  }

  function selectNode(node) {
    state.selected = node;
    if (state.menuFor && state.menuFor !== node) {
      state.menuFor = null;
    }
    updateSelectionUI();
    announce(`已聚焦 ${node.label}`);
  }

  function visibleDetailNodes() {
    const nodes = [];
    const seen = new Set();
    for (const item of state.rendered) {
      if (item.kind !== "node" || !item.node || item.clusterShellProxy) continue;
      const key = `${item.ownerPath || nodeOwnerPath(item.node)}:${item.node.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push(item.node);
    }
    if (state.clusterFieldOpen) {
      for (const cluster of state.clusterScene.clusters) {
        if (!cluster.detailNode) continue;
        const key = `${cluster.parentPath || ""}:${cluster.detailNode.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        nodes.push(cluster.detailNode);
      }
    }
    return nodes.length ? nodes : currentDomainNodes();
  }

  function setVisibleDetailMode(mode) {
    if (!["name", "surface", "floating"].includes(mode)) return false;
    const nodes = visibleDetailNodes();
    state.batchFloatingDetails = mode === "floating";
    const openedAt = mode === "surface" ? performance.now() : 0;
    for (const node of nodes) {
      node.detailMode = mode;
      node.surfaceVisible = mode === "surface";
      node.surfaceOpenedAt = openedAt;
    }
    state.commitPulseUntil = performance.now() + 320;
    recordCurrentView();
    persistWorkspaceSnapshot(`detail-mode-${mode}`);
    updateSelectionUI();
    announce(
      mode === "name"
        ? "仅显示节点名称"
        : mode === "surface"
        ? "节点已切换为镜面详情；团已关闭悬浮详情"
        : "节点与团已切换为悬浮详情"
    );
    return true;
  }

  function cycleVisibleDetailMode() {
    const nodes = visibleDetailNodes();
    const current = nodes.length ? detailModeFor(nodes[0]) : "floating";
    const order = ["floating", "name", "surface"];
    return setVisibleDetailMode(order[(order.indexOf(current) + 1) % order.length]);
  }

  function clearFocus() {
    recordCurrentView();
    state.selected = null;
    state.focused = null;
    state.menuFor = null;
    state.middleLabelFocus = null;
    updateSelectionUI();
    if (state.clusterFieldOpen) {
      buildClusterScene();
    } else {
      startCameraTween({
        target: { x: 0, y: 0, z: 0 },
        distance: NORMAL_FIELD_DISTANCE
      }, 520, () => recordCurrentView());
    }
    announce("已解除当前聚焦");
  }

  function focusNode(node) {
    if (!node || !node.capabilities || !node.capabilities.focusField) {
      return;
    }
    recordCurrentView();
    selectNode(node);
    if (state.clusterFieldOpen) {
      announce(`已选择 ${node.label}，保持多球团全景`);
      return;
    }
    state.focused = node;
    const position = resolveNodePosition(node, state.time);
    startCameraTween({
      target: position,
      distance: clamp(node.radius * 6.2, 4.8, 8.5)
    }, 520, () => {
      recordCurrentView();
      updateSelectionUI();
    });
  }

  function revealNode(node, optionsInput) {
    const options = optionsInput || {};
    if (
      !node
      || node.hasChildren !== true
      || !node.capabilities
      || !node.capabilities.satellites
    ) {
      return;
    }
    selectNode(node);
    node.revealed = !node.revealed;
    state.commitPulseUntil = performance.now() + 380;
    if (node.revealed) {
      createSatellites(node);
      announce(`${node.label} 已显露 ${node.satellites.length} 个卫星节点`);
    } else {
      announce(`${node.label} 的卫星已收起`);
    }
    updateSelectionUI();
    if (options.record !== false) recordCurrentView();
  }

  function toggleFieldChildren(result, path = state.currentPath) {
    const domainLabel = pathLabelsForPath(path).at(-1) || "当前域";
    if (!result.nodes.length) {
      announce(`${domainLabel} 没有可展收的节点`);
      return;
    }
    if (result.revealed) {
      result.nodes.forEach((node) => createSatellites(node));
    }
    state.commitPulseUntil = performance.now() + 380;
    updateSelectionUI();
    recordCurrentView();
    announce(`${domainLabel} 的子球体已${result.revealed ? "展开" : "收起"}`);
  }

  function peekNode(node) {
    if (
      !node
      || !node.capabilities
      || !node.capabilities.portal
    ) {
      return;
    }
    selectNode(node);
    state.focused = node;
    const willOpen = !node.peekOpen;
    const ownerPath = nodeOwnerPath(node);
    for (const candidate of domainNodesForPath(ownerPath)) {
      if (candidate !== node) {
        candidate.peekOpen = false;
      }
    }
    node.peekOpen = willOpen;
    state.commitPulseUntil = performance.now() + 320;
    if (willOpen) {
      prefetchChildDomain(node, ownerPath);
      announce(`${node.label} 的隧洞纵深提示已显露`);
    } else {
      state.prefetchedDomain = null;
      announce(`${node.label} 的子域预览已收起`);
    }
    updateSelectionUI();
  }

  function inspectNode(node) {
    if (!node || !node.capabilities || !node.capabilities.lens) {
      return;
    }
    selectNode(node);
    node.lensOpen = !node.lensOpen;
    node.lensOpenedAt = node.lensOpen ? performance.now() : 0;
    if (node.lensOpen) {
      const openLenses = domainNodesForPath(nodeOwnerPath(node))
        .filter((candidate) => candidate.lensOpen)
        .sort((a, b) => b.lensOpenedAt - a.lensOpenedAt);
      openLenses.slice(2).forEach((candidate) => {
        candidate.lensOpen = false;
        candidate.lensOpenedAt = 0;
      });
    }
    state.commitPulseUntil = performance.now() + 320;
    announce(node.lensOpen ? `${node.label} 的球镜已开启` : `${node.label} 的球镜已关闭`);
    updateSelectionUI();
    recordCurrentView();
  }

  function toggleMenu(node) {
    if (!node || !node.capabilities || !node.capabilities.halo) {
      return;
    }
    selectNode(node);
    state.menuFor = state.menuFor === node ? null : node;
    announce(state.menuFor ? `${node.label} 的命令星环已展开` : "命令星环已收起");
  }

  function pinNode(node) {
    if (!node || !node.capabilities || !node.capabilities.grabbable) {
      return;
    }
    node.pinned = !node.pinned;
    node.pinnedAt = state.time;
    state.commitPulseUntil = performance.now() + 320;
    announce(node.pinned ? `${node.label} 的局部轨道已固定` : `${node.label} 的局部轨道已释放`);
    updateSelectionUI();
  }

  function collapseNode(node) {
    if (!node || !node.capabilities || !node.capabilities.body) {
      return;
    }
    node.revealed = false;
    node.peekOpen = false;
    node.lensOpen = false;
    node.lensOpenedAt = 0;
    if (state.menuFor === node) {
      state.menuFor = null;
    }
    announce(`${node.label} 已恢复为基础球体`);
    updateSelectionUI();
    recordCurrentView();
  }

  function buildDirectDomainRoute(node, parentCamera) {
    const lineage = visualModel.nodeLineage(node);
    const targetDepth = state.depth + lineage.length;
    const entries = [];
    let path = state.currentPath;
    let depth = state.depth;
    let crumbs = [...state.crumbs];

    lineage.forEach((lineageNode, index) => {
      const entryNearDistance = clamp(
        Math.min(parentCamera.distance - 0.35, lineageNode.radius * 1.55),
        1.25,
        2.8
      );
      const childFarDistance = clamp(
        NORMAL_FIELD_DISTANCE + lineageNode.radius * 2.4,
        17.8,
        21.5
      );
      entries.push({
        path,
        crumbs: [...crumbs],
        depth,
        camera: index === 0
          ? { ...parentCamera, target: { ...parentCamera.target } }
          : {
              target: { x: 0, y: 0, z: 0 },
              yaw: parentCamera.yaw,
              pitch: parentCamera.pitch,
              distance: NORMAL_FIELD_DISTANCE
            },
        entryDirection: { yaw: parentCamera.yaw, pitch: parentCamera.pitch },
        entryNearDistance,
        childFarDistance,
        nodeId: lineageNode.id,
        nodeLabel: lineageNode.label
      });
      path = childPathFor(lineageNode, path);
      depth += 1;
      crumbs = [...crumbs, lineageNode.label];
    });

    return { entries, path, depth: targetDepth, crumbs, lineage };
  }

  function clusterDepthForPath(path) {
    if (path === state.currentPath) return state.depth;
    const expanded = state.expandedClusterDomains.get(path);
    if (expanded) return expanded.depth;
    const route = state.domainRoutes.get(path);
    return route ? route.length : Math.max(0, path.split("/").length - 1);
  }

  function collapseClusterDomainWithOptions(path, optionsInput) {
    const options = optionsInput || {};
    const targetPath = typeof path === "string" ? path : "";
    const descriptor = state.expandedClusterDomains.get(targetPath);
    if (!descriptor) return false;
    sceneAdapter.commitViewIntent(state, { type: "remove-view", targetId: targetPath });
    const selectedPath = nodeOwnerPath(state.selected, null);
    if (pathContains(targetPath, selectedPath)) {
      state.selected = null;
      state.focused = null;
      state.hovered = null;
      state.menuFor = null;
    }
    const detailFocusPath = state.middleLabelFocus && (
      state.middleLabelFocus.kind === "domain"
        ? state.middleLabelFocus.path
        : state.middleLabelFocus.descendantPath
    );
    if (pathContains(targetPath, detailFocusPath)) state.middleLabelFocus = null;
    if (options.render !== false) buildClusterScene();
    if (options.updateSelection !== false) updateSelectionUI();
    if (options.announce !== false) announce(`已收起 ${descriptor.label} 的子域团`);
    return true;
  }

  function toggleClusterChildDomain(node, ownerPath = state.currentPath, projectionMode = "hierarchy") {
    const childPath = childPathFor(node, ownerPath);
    if (transactionBlocksViewChange()) {
      announce("请先用 Enter 或 Esc 结束当前编辑");
      return false;
    }
    if (state.expandedClusterDomains.has(childPath)) {
      collapseClusterDomain(childPath);
      return false;
    }

    const changed = openClusterChildDomain(node, ownerPath, projectionMode);
    if (!changed) return false;
    buildClusterScene();
    frameClusterDomain(childPath);
    updateSelectionUI();
    announce(`已展开 ${node.label} 的下一层子域团`);
    return true;
  }

  function openClusterChildDomain(node, ownerPath = state.currentPath, projectionMode = "hierarchy") {
    const childPath = childPathFor(node, ownerPath);
    if (state.expandedClusterDomains.has(childPath)) return false;
    const parentDepth = clusterDepthForPath(ownerPath);
    const depth = parentDepth + 1;
    const parentLabels = pathLabelsForPath(ownerPath);
    const nodes = createChildDomainNodes(node, childPath, depth);
    const descriptor = {
      path: childPath,
      depth,
      label: node.label,
      pathLabels: [...parentLabels, node.label],
      parentPath: ownerPath,
      parentNodeId: node.id,
      projectionMode: ["peripheral", "nested"].includes(projectionMode)
        ? projectionMode
        : "hierarchy",
      nodes
    };
    sceneAdapter.commitViewIntent(state, {
      type: "append-view",
      targetId: childPath,
      mode: descriptor.projectionMode,
      descriptor
    });

    const ownerRoute = ownerPath === state.currentPath
      ? cloneDomainStack(state.domainStack)
      : cloneDomainStack(state.domainRoutes.get(ownerPath) || []);
    const parentCamera = cameraSnapshot();
    ownerRoute.push({
      path: ownerPath,
      crumbs: parentLabels,
      depth: parentDepth,
      camera: { ...parentCamera, target: { ...parentCamera.target } },
      entryDirection: { yaw: parentCamera.yaw, pitch: parentCamera.pitch },
      entryNearDistance: clamp(node.radius * 1.55, 1.25, 2.8),
      childFarDistance: NORMAL_FIELD_DISTANCE,
      nodeId: node.id,
      nodeLabel: node.label
    });
    rememberDomainRoute(childPath, ownerRoute);
    return true;
  }

  function currentDomainSceneFrame() {
    const finalSceneNodes = collectNodes(state.time)
      .filter((item) => item.kind === "node" && item.node)
      .map((item) => ({
        position: item.position,
        radius: item.radius
      }));
    return viewModeModel.immersiveDomainFrame(finalSceneNodes, {
      fov: camera.fov,
      aspect: state.width / Math.max(1, state.height),
      minimumDistance: MIN_CAMERA_DISTANCE,
      maximumDistance: MAX_CAMERA_DISTANCE,
      fallbackDistance: NORMAL_FIELD_DISTANCE
    });
  }

  function enterNode(node, forceImmersive = false) {
    if (
      !node
      || !node.capabilities
      || !node.capabilities.portal
      || state.transitionLocked
    ) {
      return;
    }
    if (state.clusterFieldOpen && !forceImmersive) {
      recordCurrentView();
      const ownerPath = node.__clusterOwnerPath || node.workspacePath || state.currentPath;
      toggleClusterChildDomain(node, ownerPath);
      return;
    }
    if (forceImmersive) state.clusterFieldOpen = false;
    recordCurrentView();
    const parentCamera = cameraSnapshot();
    const route = buildDirectDomainRoute(node, parentCamera);
    const prefetched = route.entries.length === 1 ? prefetchChildDomain(node) : null;
    const nextPath = route.path;
    state.menuFor = null;
    node.peekOpen = false;
    state.domainStack.push(...route.entries);
    state.depth = route.depth;
    state.currentPath = nextPath;
    state.crumbs = route.crumbs;
    state.nodes = prefetched && prefetched.path === nextPath
      ? prefetched.nodes
      : createChildDomainNodes(node, state.currentPath, state.depth);
    rememberDomainRoute(state.currentPath, state.domainStack);
    state.selected = null;
    state.focused = null;
    state.hovered = null;
    state.middleLabelFocus = null;
    state.prefetchedDomain = null;
    const immersiveFrame = currentDomainSceneFrame();
    updateSelectionUI();
    startCameraTween(immersiveFrame, 420, recordCurrentView);
    announce(`已进入 ${node.label}，当前深度 ${state.depth}`);
    return true;
  }

  function returnClusterToDepth(targetDepth, previous) {
    if (options.record !== false) recordCurrentView();
    state.domainStack = state.domainStack.slice(0, targetDepth);
    state.currentPath = previous.path;
    state.depth = previous.depth;
    state.crumbs = [...previous.crumbs];
    state.nodes = createDomain(previous.path, previous.depth);
    hydrateNodePath(state.nodes, previous.nodeId, true);
    state.selected = findExistingNode(state.nodes, previous.nodeId);
    state.focused = null;
    state.hovered = null;
    state.menuFor = null;
    state.middleLabelFocus = null;
    state.prefetchedDomain = null;
    buildClusterScene();
    updateSelectionUI();
    announce(`已收回最深球团，当前保留 ${state.depth + 1} 个域`);
  }

  function returnToDepth(targetDepth) {
    if (targetDepth < 0 || targetDepth >= state.depth || state.transitionLocked) {
      return;
    }
    const previous = state.domainStack[targetDepth];
    const currentEntry = state.domainStack[state.depth - 1];
    if (!previous || !currentEntry) {
      return;
    }
    if (state.clusterFieldOpen) return returnClusterToDepth(targetDepth, previous);
    recordCurrentView();
    state.domainStack = state.domainStack.slice(0, targetDepth);
    state.currentPath = previous.path;
    state.depth = previous.depth;
    state.crumbs = previous.crumbs;
    state.nodes = createDomain(previous.path, previous.depth);
    hydrateNodePath(state.nodes, previous.nodeId, true);
    const entryNode = findExistingNode(state.nodes, previous.nodeId);
    state.selected = entryNode || null;
    state.focused = entryNode || null;
    state.menuFor = null;
    state.middleLabelFocus = null;
    state.prefetchedDomain = null;
    if (entryNode) entryNode.peekOpen = false;
    const immersiveFrame = currentDomainSceneFrame();
    updateSelectionUI();
    startCameraTween(immersiveFrame, 420, recordCurrentView);
    announce(`已返回 ${previous.crumbs.at(-1)}`);
    return true;
  }

  function exitDomain(domainContext = null) {
    if (
      state.clusterFieldOpen
      && domainContext
      && domainContext.path !== state.currentPath
      && state.expandedClusterDomains.has(domainContext.path)
    ) {
      recordCurrentView();
      return collapseClusterDomain(domainContext.path);
    }
    returnToDepth(state.depth - 1);
  }

  function returnOverview() {
    prepareViewHistoryNavigation();
    primaryClickArbiter.cancel();
    secondaryClickArbiter.cancel();
    recordCurrentView();
    sceneAdapter.commitViewIntent(state, { type: "clear-views" });
    state.clusterFieldOpen = false;
    state.domainStack.length = 0;
    state.currentPath = "root";
    state.crumbs = ["全域"];
    state.depth = 0;
    state.nodes = createDomain("root", 0);
    state.selected = null;
    state.focused = null;
    state.hovered = null;
    state.menuFor = null;
    state.middleLabelFocus = null;
    state.prefetchedDomain = null;
    startCameraTween({
      target: { x: 0, y: 0, z: 0 },
      distance: NORMAL_FIELD_DISTANCE,
      yaw: -0.16,
      pitch: 0.12
    }, 620, () => {
      recordCurrentView();
      announce("已收束至顶层 Boss");
    });
    updateSelectionUI();
  }

  function expandToLeaves() {
    if (transactionBlocksViewChange()) {
      announce("请先用 Enter 或 Esc 结束当前编辑");
      return false;
    }
    if (state.viewMode === "immersive") return false;
    prepareViewHistoryNavigation();
    primaryClickArbiter.cancel();
    secondaryClickArbiter.cancel();
    recordCurrentView();
    sceneAdapter.commitViewIntent(state, { type: "clear-views" });
    state.clusterFieldOpen = false;
    state.domainStack.length = 0;
    state.currentPath = "root";
    state.crumbs = ["全域"];
    state.depth = 0;
    state.nodes = createDomain("root", 0);
    state.selected = null;
    state.focused = null;
    state.hovered = null;
    state.menuFor = null;
    state.middleLabelFocus = null;
    state.prefetchedDomain = null;

    const roots = topLevelDomainNodesForPath("root").map((node) => ({
      key: visualNodeKey(node, "root"),
      ownerPath: "root",
      node
    }));
    const entries = recursiveVisualEntries(roots, { forceDomainTraversal: true });
    const options = { projectionMode: state.viewMode };
    for (const entry of entries) {
      if (entry.node.hasChildren !== true) continue;
      openClusterChildDomain(entry.node, entry.ownerPath, options.projectionMode);
    }
    state.clusterFieldOpen = state.expandedClusterDomains.size > 0;
    if (state.clusterFieldOpen) buildClusterScene();
    recordCurrentView();
    updateSelectionUI();
    announce("已从顶层 Boss 展开至最细级");
    return true;
  }

  function prepareViewHistoryNavigation() {
    if (!state.transitionLocked) return null;
    const transitionOrigin = state.transitionOrigin;
    state.cameraTween = null;
    state.transitionLocked = false;
    state.transitionFieldReady = false;
    state.transitionOrigin = null;
    return transitionOrigin;
  }

  function backView() {
    const transitionOrigin = prepareViewHistoryNavigation();
    if (transitionOrigin) {
      restoreVisualSnapshot(transitionOrigin);
      return;
    }
    const snapshot = state.viewHistory.back();
    if (!snapshot) {
      announce("没有更早的视角");
      return;
    }
    restoreVisualSnapshot(snapshot);
  }

  function forwardView() {
    prepareViewHistoryNavigation();
    const snapshot = state.viewHistory.forward();
    if (!snapshot) {
      announce("没有可恢复的视角");
      return;
    }
    restoreVisualSnapshot(snapshot);
  }

  function toggleWorldLens() {
    state.worldLens.open = !state.worldLens.open;
    state.commitPulseUntil = performance.now() + 320;
    recordCurrentView();
    announce(state.worldLens.open ? "域径图已展开" : "域径图已收拢");
  }

  function toggleClusterField() {
    if (transactionBlocksViewChange()) {
      announce("请先用 Enter 或 Esc 结束当前编辑");
      return state.clusterFieldOpen;
    }
    state.cameraTween = null;
    state.clusterFieldOpen = !state.clusterFieldOpen;
    state.focused = null;
    state.menuFor = null;
    state.middleLabelFocus = null;
    if (state.clusterFieldOpen) {
      buildClusterScene();
      announce(`多球团视野已开启，当前显示 ${state.clusterScene.clusters.length} 个域`);
    } else {
      if (nodeOwnerPath(state.selected, state.currentPath) !== state.currentPath) {
        state.selected = null;
        state.hovered = null;
      }
      announce("已返回当前活动域的沉浸视野");
    }
    updateSelectionUI();
    return state.clusterFieldOpen;
  }

  function setViewMode(mode) {
    if (!viewModeModel.modes.includes(mode)) return false;
    sceneAdapter.commitViewIntent(state, { type: "set-view-mode", mode });
    const label = viewModeModel.modeLabels[state.viewMode] || state.viewMode;
    updateSelectionUI();
    announce(`视角模式：${label}；只影响之后的右键动作`);
    return state.viewMode;
  }

  function applyParentView(domainContext) {
    const path = (domainContext && domainContext.path) || state.currentPath;
    if (!path || path === "root") return false;
    if (state.expandedClusterDomains.has(path)) {
      const changed = collapseClusterDomain(path);
      if (changed) recordCurrentView();
      return changed;
    }
    if (path === state.currentPath || state.currentPath.startsWith(`${path}/`)) {
      exitDomain(domainContext);
      return true;
    }
    return false;
  }

  function applyViewMode(node, optionsInput) {
    const options = optionsInput || {};
    const mode = viewModeModel.modes.includes(options.mode) ? options.mode : state.viewMode;
    if (!node || !node.capabilities || !node.capabilities.portal) return false;
    const clickedKey = visualNodeKey(node, nodeOwnerPath(node));
    const targetKeys = viewModeModel.planViewTargets(mode, clickedKey, state.batchSelectionKeys);
    if (mode === "immersive") {
      enterNode(node, true);
      return true;
    }
    if (options.skipBatch !== true && targetKeys.length > 1) {
      const batch = applyBatchViewMode(mode, targetKeys);
      if (batch) return batch.changed;
    }
    const ownerPath = nodeOwnerPath(node);
    const childPath = childPathFor(node, ownerPath);
    const shouldRecord = options.record !== false;
    if (state.expandedClusterDomains.has(childPath)) {
      const changed = collapseClusterDomain(childPath);
      if (changed && shouldRecord) recordCurrentView();
      return changed;
    }
    state.appliedViewMode = mode;
    if (mode === "peripheral") {
      revealNode(node, { record: shouldRecord });
      return true;
    }
    state.clusterFieldOpen = true;
    const changed = toggleClusterChildDomain(node, ownerPath, mode);
    if (changed && shouldRecord) recordCurrentView();
    return changed;
  }

  function nearestClusterDomainNode(path, x, y) {
    let best = null;
    let bestDistance = Infinity;
    for (const region of state.hitRegions) {
      const candidate = region.item && region.item.node;
      if (!candidate || nodeOwnerPath(candidate) !== path) continue;
      const distance = Math.hypot(x - region.x, y - region.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  function expandHoveredClusterLevel() {
    if (state.viewMode === "immersive" || transactionBlocksViewChange()) return false;
    state.appliedViewMode = state.viewMode;
    const entries = visibleClusterDomains().flatMap((domain) => domain.nodes.map((projected) => {
      const node = projected.sourceNode || projected;
      return {
        key: visualNodeKey(node, domain.path),
        childPath: childPathFor(node, domain.path),
        ownerPath: domain.path,
        node,
        portal: Boolean(node.capabilities && node.capabilities.portal)
      };
    }));
    const keys = viewModeModel.planContextLevelExpansion(
      entries,
      [...state.expandedClusterDomains.keys()],
      state.viewMode
    );
    if (!keys.length) return false;
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    state.clusterFieldOpen = true;
    let changed = false;
    for (const key of keys) {
      const entry = byKey.get(key);
      if (entry && openClusterChildDomain(entry.node, entry.ownerPath, state.viewMode)) changed = true;
    }
    if (!changed) return false;
    buildClusterScene();
    recenterLatestInteraction();
    updateSelectionUI();
    recordCurrentView();
    announce("当前视图已全部展开一层");
    return true;
  }

  function frameClusterDomain(path) {
    const cluster = state.clusterScene.clusters.find((candidate) => candidate.path === path);
    if (!cluster) return false;
    const frame = viewModeModel.clusterDomainFrame(cluster, {
      fov: camera.fov,
      aspect: state.width / Math.max(1, state.height),
      minimumDistance: focusMinimumDistance(),
      maximumDistance: MAX_CAMERA_DISTANCE
    });
    startCameraTween(frame, 420, recordCurrentView);
    return true;
  }

  function collapseClusterDomain(path) {
    const descriptor = state.expandedClusterDomains.get(path);
    const changed = collapseClusterDomainWithOptions(path, {
      render: false,
      updateSelection: false,
      announce: false
    });
    if (!changed) return false;
    buildClusterScene();
    recenterLatestInteraction();
    updateSelectionUI();
    announce(`已收起 ${descriptor.label} 的子域团`);
    return true;
  }

  function collapseHoveredClusterLevel() {
    if (state.viewMode === "immersive" || transactionBlocksViewChange()) return false;
    const paths = viewModeModel.planContextLevelCollapse(
      [...state.expandedClusterDomains.keys()],
      state.currentPath,
      state.viewMode
    );
    if (!paths.length) return false;
    let changed = false;
    for (const path of paths) {
      if (collapseClusterDomainWithOptions(path, {
        render: false,
        updateSelection: false,
        announce: false
      })) changed = true;
    }
    if (!changed) return false;
    buildClusterScene();
    recenterLatestInteraction();
    updateSelectionUI();
    recordCurrentView();
    announce("当前视图已全部收缩一层");
    return true;
  }

  function visualNodeKey(node, ownerPath = nodeOwnerPath(node)) {
    return node && ownerPath ? `${ownerPath}::${node.id}` : "";
  }

  function visualEntryForKey(key) {
    const separator = typeof key === "string" ? key.lastIndexOf("::") : -1;
    if (separator <= 0) return null;
    const ownerPath = key.slice(0, separator);
    const node = nodeByIdInPath(ownerPath, key.slice(separator + 2));
    return node ? { key, ownerPath, node } : null;
  }

  function visibleWandRegions() {
    return state.hitRegions
      .filter((region) => region.item && region.item.kind === "node" && region.item.node)
      .map((region) => ({
        key: visualNodeKey(region.item.node, region.item.ownerPath || nodeOwnerPath(region.item.node)),
        x: region.x,
        y: region.y,
        radius: Math.max(3, region.item.screen.radius)
      }));
  }

  function rememberLatestInteraction(item) {
    if (!item || !item.node || !item.position) return false;
    state.latestInteractionAnchor = { ...item.position };
    state.latestInteractionKey = visualNodeKey(item.node, item.ownerPath || nodeOwnerPath(item.node));
    return true;
  }

  function rememberLatestInteractionKey(key) {
    if (!key) return false;
    const region = [...state.hitRegions].reverse().find((candidate) => {
      const item = candidate && candidate.item;
      return item
        && item.node
        && visualNodeKey(item.node, item.ownerPath || nodeOwnerPath(item.node)) === key;
    });
    return rememberLatestInteraction(region && region.item);
  }

  function recenterLatestInteraction() {
    if (state.latestInteractionKey) rememberLatestInteractionKey(state.latestInteractionKey);
    return adoptLatestInteractionAnchor();
  }

  function handleShiftTap(now = performance.now()) {
    const next = viewModeModel.resolveShiftTap({
      highEnergy: state.wand.highEnergy,
      lastTapAt: state.wand.lastTapAt,
      tapCount: state.wand.tapCount
    }, now);
    state.wand.highEnergy = next.highEnergy;
    state.wand.lastTapAt = next.lastTapAt;
    state.wand.tapCount = next.tapCount;
    state.wand.shiftHeld = true;
    if (next.toggled) {
      state.wand.peerBatchArmed = false;
      state.wand.peerBatchMode = null;
      canvas.style.cursor = next.highEnergy ? "none" : "default";
      updateSelectionUI();
      announce(next.highEnergy ? "玉杖递归已开启" : "已恢复木杖普通模式");
    }
    if (!next.toggled && next.tapCount === 2) establishPeerSelection();
    return next;
  }

  function establishPeerSelection() {
    const regions = peerViewBatchRegions();
    const anchor = regions.find((region) => region.key === state.latestInteractionKey)
      || regions.find((region) => state.hovered && region.key === visualNodeKey(state.hovered, nodeOwnerPath(state.hovered)));
    state.batchSelectionKeys = new Set(viewModeModel.planPeerBatch(regions, anchor, state.currentPath));
    if (!state.batchSelectionKeys.size) return false;
    state.batchToggleKey = anchor ? anchor.key : null;
    updateSelectionUI();
    announce(`已选择同层同团 ${state.batchSelectionKeys.size} 个节点`);
    return state.batchSelectionKeys.size > 0;
  }

  function toggleBatchSelectionAtHit(hit) {
    if (!state.wand.shiftHeld || !state.batchSelectionKeys.size) return false;
    const item = hit && hit.item;
    const key = item && item.node
      ? visualNodeKey(item.node, item.ownerPath || nodeOwnerPath(item.node))
      : null;
    if (!key) {
      state.batchToggleKey = null;
      return false;
    }
    if (key === state.batchToggleKey) return false;
    state.batchSelectionKeys = new Set(viewModeModel.toggleSelectionKey(state.batchSelectionKeys, key));
    state.batchToggleKey = key;
    updateSelectionUI();
    return true;
  }

  function applyBatchViewMode(mode, keysInput) {
    const keys = Array.isArray(keysInput) ? keysInput : [...state.batchSelectionKeys];
    if (!keys.length) return null;
    return {
      handled: true,
      changed: executeWandTargets(keys, { recursive: false, viewMode: mode, skipBatch: true })
    };
  }

  function armPeerViewBatch() {
    state.wand.peerBatchArmed = true;
    state.wand.peerBatchMode = state.viewMode;
    canvas.style.cursor = "none";
    return true;
  }

  function syncCanvasCursor(hit = null) {
    canvas.style.cursor = state.detailMagnifier.enabled
      ? ""
      : state.wand.highEnergy || state.wand.peerBatchArmed
      ? "none"
      : hit
      ? "pointer"
      : "default";
  }

  function peerViewBatchRegions() {
    return state.hitRegions
      .filter((region) => region.item && region.item.kind === "node" && region.item.node)
      .map((region) => ({
        key: visualNodeKey(region.item.node, region.item.ownerPath || nodeOwnerPath(region.item.node)),
        ownerPath: region.item.ownerPath || nodeOwnerPath(region.item.node),
        level: Number(region.item.level) || 0,
        x: region.x,
        y: region.y,
        radius: Math.max(3, region.item.screen.radius),
        portal: Boolean(region.item.node.capabilities && region.item.node.capabilities.portal),
        clusterShellProxy: Boolean(region.item.clusterShellProxy)
      }));
  }

  function consumePeerViewBatch(node) {
    if (!state.wand.peerBatchArmed) return null;
    const batchMode = state.wand.peerBatchMode;
    state.wand.peerBatchArmed = false;
    state.wand.peerBatchMode = null;
    state.wand.lastTapAt = 0;
    state.wand.tapCount = 0;
    syncCanvasCursor(node);
    if (batchMode === "immersive") return { handled: true, changed: false };
    const regions = peerViewBatchRegions();
    const targetKey = visualNodeKey(node, nodeOwnerPath(node));
    const target = regions.find((region) => region.key === targetKey);
    if (!target) return { handled: true, changed: false };
    const keys = viewModeModel.planPeerBatch(regions, target);
    return {
      handled: true,
      changed: executeWandTargets(keys, { recursive: false, viewMode: batchMode })
    };
  }

  function beginWandStroke(pointerId, point) {
    state.wand.active = true;
    state.wand.pointerId = pointerId;
    state.wand.points = [{ x: point.x, y: point.y }];
    state.pointerPosition = { ...point };
    canvas.style.cursor = "none";
  }

  function extendWandStroke(point) {
    if (!state.wand.active) return false;
    const previous = state.wand.points.at(-1);
    state.pointerPosition = { ...point };
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 2.4) {
      state.wand.points.push({ x: point.x, y: point.y });
    }
    return true;
  }

  function finishWandStroke(point) {
    if (!state.wand.active) return null;
    extendWandStroke(point);
    const gesture = viewModeModel.classifyStrokeGesture(state.wand.points, { closeDistance: 18 });
    let result = viewModeModel.resolveStrokeTargets(
      state.wand.points,
      visibleWandRegions(),
      { closeDistance: 18, hitPadding: 4 }
    );
    if (gesture.kind === "star") {
      const domainHit = state.clusterHitRegions
        .map((region) => ({
          region,
          distance: Math.hypot(point.x - region.x, point.y - region.y)
        }))
        .filter((candidate) => candidate.distance <= candidate.region.radius * 0.96)
        .sort((left, right) => left.region.radius - right.region.radius)[0];
      const starPath = domainHit
        ? domainHit.region.path
        : state.clusterFieldOpen ? null : state.currentPath;
      if (starPath) {
        const keys = topLevelDomainNodesForPath(starPath)
          .map((node) => visualNodeKey(node, starPath));
        result = Object.freeze({
          closed: true,
          keys: Object.freeze(keys),
          glowDurationMs: 500,
          star: true
        });
      }
    }
    for (const key of result.keys) {
      if (!state.wand.pendingKeys.includes(key)) state.wand.pendingKeys.push(key);
      state.wandGlowUntil.set(key, performance.now() + 650);
    }
    rememberLatestInteractionKey(result.keys.at(-1));
    state.wand.closed = state.wand.closed || result.closed;
    state.wand.active = false;
    state.wand.pointerId = null;
    state.wand.points = [];
    return result;
  }

  function recursiveVisualEntries(entries, optionsInput) {
    const options = optionsInput || {};
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    const childrenFor = (key) => {
      const entry = byKey.get(key);
      if (!entry || entry.node.hasChildren !== true) return [];
      if (
        !options.forceDomainTraversal
        && state.viewMode === "peripheral"
        && entry.node.isWorkspaceNode !== true
      ) {
        createSatellites(entry.node);
        return (entry.node.satellites || []).map((node) => {
          const child = {
            key: visualNodeKey(node, entry.ownerPath),
            ownerPath: entry.ownerPath,
            node
          };
          byKey.set(child.key, child);
          return child.key;
        });
      }
      const childPath = childPathFor(entry.node, entry.ownerPath);
      const childDepth = clusterDepthForPath(entry.ownerPath) + 1;
      createChildDomainNodes(entry.node, childPath, childDepth);
      return topLevelDomainNodesForPath(childPath).map((node) => {
        node.__clusterOwnerPath = childPath;
        const child = { key: visualNodeKey(node, childPath), ownerPath: childPath, node };
        byKey.set(child.key, child);
        return child.key;
      });
    };
    const keys = viewModeModel.planRecursiveTargets(entries.map((entry) => entry.key), childrenFor);
    return keys.map((key) => byKey.get(key)).filter(Boolean);
  }

  function expandRecursively(entriesInput) {
    const entries = recursiveVisualEntries(entriesInput);
    const projectionMode = state.viewMode === "nested" ? "nested" : "hierarchy";
    let openedChildDomain = false;
    for (const entry of entries) {
      if (entry.node.hasChildren !== true) continue;
      if (state.viewMode === "peripheral" && entry.node.isWorkspaceNode !== true) {
        if (!entry.node.revealed) {
          entry.node.revealed = true;
          createSatellites(entry.node);
        }
        continue;
      }
      if (openClusterChildDomain(entry.node, entry.ownerPath, projectionMode)) {
        openedChildDomain = true;
      }
    }
    if (openedChildDomain || state.expandedClusterDomains.size) {
      state.clusterFieldOpen = true;
      buildClusterScene();
    }
    return entries.length;
  }

  function executeWandTargets(keysInput, optionsInput) {
    const options = optionsInput || {};
    const keys = Array.isArray(keysInput) ? keysInput : [];
    const entries = keys.map(visualEntryForKey).filter(Boolean);
    if (!entries.length) return false;
    const glowDurationMs = Math.max(0, Number(options.glowDurationMs) || 0);
    const viewMode = viewModeModel.modes.includes(options.viewMode) ? options.viewMode : state.viewMode;
    const perform = () => {
      if (state.wand.highEnergy && options.recursive !== false) {
        expandRecursively(entries);
      } else if (viewMode === "immersive") {
        applyViewMode(entries[0].node, { record: false, mode: viewMode });
      } else {
        for (const entry of entries) applyViewMode(entry.node, { record: false, mode: viewMode, skipBatch: true });
      }
      recordCurrentView();
      updateSelectionUI();
    };
    if (glowDurationMs > 0) global.setTimeout(perform, glowDurationMs);
    else perform();
    return true;
  }

  function releaseWandBatch() {
    const keys = [...state.wand.pendingKeys];
    const glowDurationMs = state.wand.closed ? 500 : 0;
    state.wand.pendingKeys = [];
    state.wand.closed = false;
    if (!keys.length) return false;
    return executeWandTargets(keys, { glowDurationMs });
  }

  function drawWandGlow(screen, item) {
    if (!item || item.kind !== "node" || !item.node) return;
    const key = visualNodeKey(item.node, item.ownerPath || nodeOwnerPath(item.node));
    const batchSelected = state.batchSelectionKeys.has(key);
    const until = batchSelected ? Infinity : state.wandGlowUntil.get(key) || 0;
    const now = performance.now();
    if (until <= now) {
      state.wandGlowUntil.delete(key);
      return;
    }
    const progress = batchSelected ? 1 : clamp((until - now) / 650, 0, 1);
    const pulse = state.reducedMotion ? 0.6 : 0.62 + Math.sin(state.time * 17) * 0.18;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.strokeStyle = theme.ink;
    context.shadowColor = theme.accent;
    context.shadowBlur = 14;
    context.globalAlpha = progress * pulse;
    context.lineWidth = Math.max(0.8, screen.radius * 0.018);
    for (let ray = 0; ray < 6; ray += 1) {
      const angle = ray / 6 * Math.PI * 2 + state.time * 0.7;
      const inner = screen.radius * 1.08;
      const outer = screen.radius * (1.2 + (ray % 2) * 0.1);
      context.beginPath();
      context.moveTo(screen.x + Math.cos(angle) * inner, screen.y + Math.sin(angle) * inner);
      context.lineTo(screen.x + Math.cos(angle) * outer, screen.y + Math.sin(angle) * outer);
      context.stroke();
    }
    context.restore();
  }

  function drawWandTrail() {
    if (!state.wand.shiftHeld && !state.wand.active && !state.wand.highEnergy && !state.wand.peerBatchArmed) return;
    const points = state.wand.points;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    if (points.length > 1) {
      const gradient = context.createLinearGradient(
        points[0].x,
        points[0].y,
        points.at(-1).x,
        points.at(-1).y
      );
      gradient.addColorStop(0, "rgb(115 149 170 / 4%)");
      gradient.addColorStop(0.72, "rgb(151 205 229 / 46%)");
      gradient.addColorStop(1, "rgb(227 246 255 / 84%)");
      context.strokeStyle = gradient;
      context.shadowColor = theme.accent;
      context.shadowBlur = 9;
      context.lineWidth = 1.6;
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) {
        context.lineTo(points[index].x, points[index].y);
      }
      context.stroke();
    }
    const tip = state.pointerPosition;
    const jade = state.wand.highEnergy;
    context.translate(tip.x, tip.y);
    context.rotate(-0.72);
    context.strokeStyle = jade ? "#a9e6db" : "#56616b";
    context.shadowColor = jade ? "#76d9df" : "#a9bed0";
    context.shadowBlur = jade ? 10 : 3;
    context.globalAlpha = 0.9;
    context.lineWidth = jade ? 3.2 : 3.8;
    context.beginPath();
    context.moveTo(-2, 2);
    context.lineTo(-23, 23);
    context.stroke();
    context.fillStyle = jade ? "#d7fff2" : "#d9e6ee";
    context.beginPath();
    context.arc(0, 0, jade ? 2.8 : 1.8, 0, Math.PI * 2);
    context.fill();
    if (jade) {
      context.globalAlpha = 0.56;
      context.lineWidth = 1;
      context.beginPath();
      context.ellipse(0, 0, 9, 4, state.time * 1.6, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.ellipse(0, 0, 6, 2.5, -state.time * 2.1, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  function drawViewModeCursor() {
    if (state.wand.shiftHeld || state.wand.active || state.wand.highEnergy || state.wand.peerBatchArmed) return;
    const point = state.pointerPosition;
    const size = 10;
    context.save();
    context.translate(point.x + 18, point.y + 18);
    context.strokeStyle = theme.accent;
    context.globalAlpha = 0.38;
    context.lineWidth = 1.1;
    if (state.viewMode === "immersive") {
      context.beginPath();
      context.arc(0, 0, 7, 0, Math.PI * 2);
      context.stroke();
    } else {
      const inward = state.viewMode === "nested";
      const hierarchy = state.viewMode === "hierarchy";
      const directions = hierarchy
        ? [[-0.72, 0.7], [0, 1], [0.72, 0.7]]
        : [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dx, dy] of directions) {
        const start = inward ? size * 0.9 : size * 0.3;
        const end = inward ? size * 0.3 : size * 0.9;
        context.beginPath();
        context.moveTo(dx * start, dy * start);
        context.lineTo(dx * end, dy * end);
        context.stroke();
        const angle = Math.atan2(dy, dx) + (inward ? Math.PI : 0);
        context.beginPath();
        context.moveTo(dx * end, dy * end);
        context.lineTo(dx * end - Math.cos(angle - 0.55) * 3, dy * end - Math.sin(angle - 0.55) * 3);
        context.moveTo(dx * end, dy * end);
        context.lineTo(dx * end - Math.cos(angle + 0.55) * 3, dy * end - Math.sin(angle + 0.55) * 3);
        context.stroke();
      }
    }
    context.restore();
  }

  function adoptLatestInteractionAnchor() {
    if (!state.latestInteractionAnchor) return false;
    state.cameraTween = null;
    camera.target = { ...state.latestInteractionAnchor };
    return true;
  }

  function cancelTemporaryState() {
    let changed = false;
    if (state.batchSelectionKeys.size) {
      state.batchSelectionKeys.clear();
      state.batchToggleKey = null;
      changed = true;
    }
    if (primaryClickArbiter.pending) {
      primaryClickArbiter.cancel();
      changed = true;
    }
    if (secondaryClickArbiter.pending) {
      secondaryClickArbiter.cancel();
      changed = true;
    }
    if (state.menuFor) {
      state.menuFor = null;
      changed = true;
    }
    if (state.selected && state.selected.peekOpen) {
      state.selected.peekOpen = false;
      state.prefetchedDomain = null;
      changed = true;
    }
    if (state.drag) {
      state.drag = null;
      changed = true;
    }
    if (state.pointerCandidate) {
      if (canvas.hasPointerCapture(state.pointerCandidate.pointerId)) {
        canvas.releasePointerCapture(state.pointerCandidate.pointerId);
      }
      state.pointerCandidate = null;
      changed = true;
    }
    if (changed) {
      updateSelectionUI();
      announce("临时空间状态已取消");
    } else {
      announce("当前没有可取消的临时状态");
    }
  }

  function cycleFocus(direction) {
    const visible = state.rendered
      .filter((item) => item.kind === "node")
      .map((item) => item.node);
    if (!visible.length) {
      return;
    }
    const currentIndex = state.selected ? visible.indexOf(state.selected) : -1;
    const nextIndex = (currentIndex + direction + visible.length) % visible.length;
    state.focused = visible[nextIndex];
    selectNode(visible[nextIndex]);
  }

  function broadcastIntent(intent, visualMetaInput, target) {
    canvas.dataset.lastIntent = intent;
    canvas.dataset.lastDomainPath = visualMetaInput && visualMetaInput.domainContext
      ? visualMetaInput.domainContext.path || ""
      : "";
    const visualMeta = grammar.sanitizeVisualMeta(intent, visualMetaInput);
    global.dispatchEvent(new CustomEvent("spatial-visual-intent", {
      detail: Object.freeze({
        intent,
        targetId: target ? target.id : null,
        depth: state.depth,
        path: state.currentPath,
        phase: currentInteractionPhase(),
        sourceProfile: input.activePreset,
        visualMeta
      })
    }));
  }

  function dispatchIntent(intent, visualMeta = {}, explicitTarget = null) {
    if (!visualIntentSet.has(intent)) {
      return false;
    }
    if (transitionBlocksIntent(intent)) {
      return false;
    }
    if (transactionGuardedIntents.has(intent) && transactionBlocksViewChange()) {
      announce("请先用 Enter 或 Esc 结束当前编辑");
      return false;
    }
    const target = arguments.length >= 3 ? explicitTarget : state.selected;
    broadcastIntent(intent, visualMeta, target);

    switch (intent) {
      case "search":
        openSearch();
        break;
      case "createNode":
        beginNodeCreateAt(visualMeta.point || state.pointerPosition, visualMeta.domainContext || null);
        break;
      case "editNode":
        beginNodeEdit(target, visualMeta.item || null);
        break;
      case "editEdge":
        beginEdgeGesture(
          target,
          visualMeta.item || null,
          visualMeta.point || state.pointerPosition,
          visualMeta.domainContext || null
        );
        break;
      case "confirmEdit":
        commitWorkspaceEdit();
        break;
      case "cancelEdit":
        cancelWorkspaceEdit();
        break;
      case "deleteEdit":
        markWorkspaceDelete();
        break;
      case "activate":
        if (!target) {
          return;
        }
        state.commitPulseUntil = performance.now() + 320;
        announce(`${target.label} 已触发使用`);
        break;
      case "alternateActivate":
        inspectNode(target);
        break;
      case "focus":
        focusNode(target);
        break;
      case "clearFocus":
        clearFocus();
        break;
      case "toggleChildren":
        if (!target) {
          break;
        }
        if (target.hasChildren === true) {
          revealNode(target);
        } else {
          announce(`${target.label} 是实体端点，没有可展开的子域`);
        }
        break;
      case "toggleFieldChildren":
        recordCurrentView();
        {
          const path = visualMeta.domainContext
            ? visualMeta.domainContext.path
            : state.currentPath;
          const nodes = topLevelDomainNodesForPath(path);
          toggleFieldChildren(visualModel.toggleFieldChildren(nodes), path);
        }
        break;
      case "toggleSurface": {
        if (!target) {
          break;
        }
        const visible = visualModel.toggleNodeSurface(target);
        target.surfaceOpenedAt = visible ? performance.now() : 0;
        selectNode(target);
        state.commitPulseUntil = performance.now() + 320;
        recordCurrentView();
        persistWorkspaceSnapshot("surface-toggle");
        announce(`${target.label} 的球面已${visible ? "显示" : "隐藏"}`);
        break;
      }
      case "cycleDetailMode": {
        if (!target) break;
        const mode = visualModel.cycleNodeDetailMode(target);
        target.surfaceOpenedAt = mode === "surface" ? performance.now() : 0;
        state.commitPulseUntil = performance.now() + 320;
        recordCurrentView();
        persistWorkspaceSnapshot("detail-mode-cycle");
        updateSelectionUI();
        announce(`${target.label} 详情模式：${mode}`);
        break;
      }
      case "setSurfaceDetails":
        setVisibleDetailMode("surface");
        break;
      case "setFloatingDetails":
        setVisibleDetailMode("floating");
        break;
      case "cycleVisibleDetails":
        cycleVisibleDetailMode();
        break;
      case "toggleFieldSurfaces": {
        const path = visualMeta.domainContext
          ? visualMeta.domainContext.path
          : state.currentPath;
        const nodes = domainNodesForPath(path);
        const domainLabel = pathLabelsForPath(path).at(-1) || "当前域";
        if (!nodes.length) {
          announce(`${domainLabel} 没有可切换球面的节点`);
          break;
        }
        const visible = visualModel.toggleFieldSurfaces(nodes);
        const openedAt = visible ? performance.now() : 0;
        nodes.forEach((node) => {
          node.surfaceOpenedAt = openedAt;
        });
        state.commitPulseUntil = performance.now() + 320;
        updateSelectionUI();
        recordCurrentView();
        persistWorkspaceSnapshot("field-surfaces-toggle");
        announce(`${domainLabel} 全部球面已${visible ? "显示" : "隐藏"}`);
        break;
      }
      case "reveal":
        revealNode(target);
        break;
      case "peek":
        peekNode(target);
        break;
      case "collapse":
        collapseNode(target);
        break;
      case "inspect":
        inspectNode(target);
        break;
      case "summonMenu":
        toggleMenu(target);
        break;
      case "pin":
        pinNode(target);
        break;
      case "enter":
        enterNode(target);
        break;
      case "exit":
        exitDomain(visualMeta.domainContext || null);
        break;
      case "exitToDepth":
        returnToDepth(Number(visualMeta.targetDepth));
        break;
      case "backView":
        backView();
        break;
      case "forwardView":
        forwardView();
        break;
      case "toggleWorldLens":
        toggleWorldLens();
        break;
      case "toggleHelp":
        toggleHelpPanel();
        break;
      case "toggleClusterField":
        toggleClusterField();
        break;
      case "setPeripheralView":
        setViewMode("peripheral");
        break;
      case "setNestedView":
        setViewMode("nested");
        break;
      case "setHierarchyView":
        setViewMode("hierarchy");
        break;
      case "setImmersiveView":
        setViewMode("immersive");
        break;
      case "cycleViewMode":
        setViewMode(viewModeModel.nextMode(state.viewMode));
        break;
      case "applyViewMode":
        applyViewMode(target);
        break;
      case "applyParentView":
        applyParentView(visualMeta.domainContext || null);
        break;
      case "collapseHoveredCluster":
        collapseHoveredClusterLevel();
        break;
      case "expandHoveredCluster":
        expandHoveredClusterLevel();
        break;
      case "expandToLeaves":
        expandToLeaves();
        break;
      case "toggleDemo":
        toggleDemoMode();
        break;
      case "cancel":
        cancelTemporaryState();
        break;
      case "returnOverview":
        returnOverview();
        break;
      case "resetView":
        recordCurrentView();
        startCameraTween({ target: { x: 0, y: 0, z: 0 }, distance: NORMAL_FIELD_DISTANCE, yaw: -0.16, pitch: 0.12 }, 420, () => recordCurrentView());
        break;
      case "nextFocus":
        cycleFocus(1);
        break;
      case "previousFocus":
        cycleFocus(-1);
        break;
      case "orbit":
        state.cameraTween = null;
        camera.yaw -= visualMeta.dx * 0.006;
        camera.pitch = clamp(camera.pitch + visualMeta.dy * 0.005, -1.12, 1.12);
        break;
      case "dolly":
        state.cameraTween = null;
        {
          camera.distance = clamp(
            camera.distance * Math.exp(
              visualMeta.delta * 0.00115 * state.demo.settings.zoomSpeedPercent / 100
            ),
            MIN_CAMERA_DISTANCE,
            MAX_CAMERA_DISTANCE
          );
          if (visualMeta.anchor) {
            camera.target = visualMeta.anchor;
          }
        }
        break;
      default:
        break;
    }
    return true;
  }

  const primaryClickArbiter = gestureArbiter.createPrimaryClickArbiter({
    delay: 280,
    setTimer: global.setTimeout.bind(global),
    clearTimer: global.clearTimeout.bind(global),
    commit(action) {
      if (action && action.target && action.visualMeta && action.visualMeta.confirmationCount) {
        startConfirmationRipples(action.target, action.visualMeta.confirmationCount);
      }
      dispatchIntent(action.intent, action.visualMeta, action.target);
    }
  });

  const secondaryClickArbiter = gestureArbiter.createSecondaryClickArbiter({
    delay: 620,
    setTimer: global.setTimeout.bind(global),
    clearTimer: global.clearTimeout.bind(global),
    commitSingle(action) {
      if (action && action.intent) {
        dispatchIntent(action.intent, action.visualMeta, action.target);
      }
    },
    commitDouble(action) {
      if (action && action.intent) {
        dispatchIntent(action.intent, action.visualMeta, action.target);
      }
    }
  });

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function directPointerIntent(item) {
    if (!item) {
      return null;
    }
    if (item.kind === "command") {
      return { intent: item.commandIntent, visualMeta: {}, target: item.node };
    }
    if (item.kind === "pathStep") {
      return item.isCurrent
        ? null
        : { intent: "exitToDepth", visualMeta: { targetDepth: item.targetDepth }, target: null };
    }
    if (item.kind === "lens") {
      return { intent: "inspect", visualMeta: {}, target: item.node };
    }
    return null;
  }

  function contextualizeAction(action, candidate, extraVisualMeta = {}) {
    if (!action) return null;
    return {
      ...action,
      visualMeta: {
        ...(action.visualMeta || {}),
        ...extraVisualMeta,
        domainContext: candidate && candidate.domainContext || null
      }
    };
  }

  function candidateArbiterKey(candidate) {
    if (candidate.node) {
      return `node:${nodeOwnerPath(candidate.node)}:${candidate.node.id}`;
    }
    if (candidate.domainContext) {
      return `field:${candidate.domainContext.path}`;
    }
    return "field";
  }

  function focusMinimumDistance() {
    const compressionMultiplier = state.clusterFieldOpen
      ? Math.max(1, Number(state.clusterScene && state.clusterScene.compressionMultiplier) || 1)
      : 1;
    return MIN_CAMERA_DISTANCE / compressionMultiplier;
  }

  function quickFrameMiddleTarget(candidate) {
    if (!candidate || candidate.button !== 1) return false;
    let target = null;
    let radius = 0;
    let label = "";
    if (candidate.node) {
      const ownerPath = candidate.item && candidate.item.ownerPath
        || nodeOwnerPath(candidate.node);
      const isClusterShell = Boolean(candidate.item && candidate.item.clusterShellProxy);
      const clickedGroupPath = isClusterShell && candidate.domainContext
        ? candidate.domainContext.path
        : ownerPath;
      const middleFocus = isClusterShell
        ? {
            kind: "domain",
            path: clickedGroupPath
          }
        : {
            kind: "node",
            anchorKey: visualNodeKey(candidate.node, ownerPath),
            descendantPath: childPathFor(candidate.node, ownerPath)
          };
      state.middleLabelFocus = middleFocus;
      state.middleDetailFocus = middleFocus;
      target = isClusterShell && candidate.domainContext
        ? { ...candidate.domainContext.center }
        : candidate.item && candidate.item.position
          ? { ...candidate.item.position }
        : resolveNodePosition(candidate.node, state.time);
      radius = Math.max(
        0.001 / Math.max(1, Number(state.clusterScene && state.clusterScene.compressionMultiplier) || 1),
        isClusterShell && candidate.domainContext
          ? Number(candidate.domainContext.worldRadius) || 0
          : Number(candidate.item && candidate.item.radius) || 0.82
      );
      label = isClusterShell
        ? `${candidate.node.label || "节点"} 节点团`
        : candidate.node.label || "节点";
      selectNode(candidate.node);
    } else if (candidate.domainContext) {
      const middleFocus = {
        kind: "domain",
        path: candidate.domainContext.path
      };
      state.middleLabelFocus = middleFocus;
      state.middleDetailFocus = middleFocus;
      target = { ...candidate.domainContext.center };
      radius = Math.max(
        0.001 / Math.max(1, Number(state.clusterScene && state.clusterScene.compressionMultiplier) || 1),
        Number(candidate.domainContext.worldRadius) || 1
      );
      label = candidate.domainContext.pathLabels.at(-1) || "节点团";
    } else {
      return false;
    }
    recordCurrentView();
    state.cameraTween = null;
    const distance = clamp(
      radius / (Math.max(0.08, Math.tan(camera.fov / 2)) * 0.88),
      focusMinimumDistance(),
      MAX_CAMERA_DISTANCE
    );
    startCameraTween({ target, distance }, 420, () => {
      recordCurrentView();
      updateSelectionUI();
    });
    announce(`快速聚焦：${label}`);
    return true;
  }

  function commitPointerCandidate(candidate) {
    if (candidate && ["createNode", "editNode", "editEdge"].includes(candidate.intent)) {
      primaryClickArbiter.cancel();
      secondaryClickArbiter.cancel();
      dispatchIntent(
        candidate.intent,
        { point: candidate.start, item: candidate.item, domainContext: candidate.domainContext },
        candidate.node || null
      );
      return;
    }
    if (candidate && candidate.button === 1 && quickFrameMiddleTarget(candidate)) {
      primaryClickArbiter.cancel();
      secondaryClickArbiter.cancel();
      return;
    }
    if (candidate && candidate.direct) {
      primaryClickArbiter.cancel();
      secondaryClickArbiter.cancel();
      const directAction = gestureArbiter.classifyTap(candidate);
      if (directAction) {
        dispatchIntent(directAction.intent, directAction.visualMeta, directAction.target);
      }
      return;
    }
    const action = gestureArbiter.classifyTap(candidate);
    if (!action) {
      return;
    }
    if (candidate.button === 0) {
      const onNode = Boolean(candidate.node);
      const doubleIntent = input.resolvePointer(
        { button: 0 },
        { onNode, gesture: "double" }
      );
      const tripleIntent = input.resolvePointer(
        { button: 0 },
        { onNode, gesture: "triple" }
      );
      const singleAction = onNode
        ? contextualizeAction(
          { intent: action.intent, visualMeta: action.visualMeta, target: candidate.node },
          candidate,
          { confirmationCount: 1 }
        )
        : contextualizeAction(action, candidate);
      const doubleAction = doubleIntent
        ? contextualizeAction(
          { intent: doubleIntent, visualMeta: {}, target: candidate.node || null },
          candidate,
          { confirmationCount: 2 }
        )
        : null;
      const tripleAction = tripleIntent
        ? contextualizeAction(
          { intent: tripleIntent, visualMeta: {}, target: candidate.node || null },
          candidate,
          { confirmationCount: 3 }
        )
        : null;
      primaryClickArbiter.submit(
        singleAction,
        doubleAction,
        tripleAction,
        candidateArbiterKey(candidate)
      );
      return;
    }
    if (candidate.button === 2) {
      const contextualAction = contextualizeAction(action, candidate);
      dispatchIntent(contextualAction.intent, contextualAction.visualMeta, contextualAction.target);
      return;
    }
    const contextualAction = contextualizeAction(action, candidate);
    dispatchIntent(contextualAction.intent, contextualAction.visualMeta, contextualAction.target);
  }

  function beginDragFromCandidate(candidate) {
    if (!candidate || candidate.cancelled) {
      return false;
    }
    if (
      candidate.dragIntent === "grab"
      && candidate.node
      && candidate.node.capabilities
      && candidate.node.capabilities.grabbable
    ) {
      selectNode(candidate.node);
      state.drag = {
        type: "node",
        pointerId: candidate.pointerId,
        node: candidate.node,
        last: candidate.start,
        position: resolveNodePosition(candidate.node, state.time)
      };
      broadcastIntent("grab", { phase: "start" }, candidate.node);
      return true;
    }
    if (candidate.dragIntent === "orbit") {
      recordCurrentView();
      adoptLatestInteractionAnchor();
      state.drag = {
        type: "orbit",
        pointerId: candidate.pointerId,
        last: candidate.start,
        sceneTime: state.time,
        totalDx: 0,
        totalDy: 0,
        axisLock: null
      };
      return true;
    }
    candidate.cancelled = true;
    return false;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (transitionBlocksPointerEdit(event)) {
      return;
    }
    const point = canvasPoint(event);
    state.pointerPosition = point;
    if (event.button === 2 && event.shiftKey && !event.ctrlKey) {
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
      beginWandStroke(event.pointerId, point);
      return;
    }
    const blankSensitive = event.button === 2
      || (state.clusterFieldOpen && event.ctrlKey && event.button === 0);
    const semanticEdit = event.ctrlKey && (event.button === 0 || event.button === 2);
    const hit = event.button === 1
      ? findMiddleFrameHit(event.clientX, event.clientY)
      : findHit(event.clientX, event.clientY, { blankSensitive, semanticEdit });
    const item = hit ? hit.item : null;
    const node = item && item.node ? item.node : null;
    if (node && (event.button === 0 || event.button === 1 || event.button === 2)) rememberLatestInteraction(item);
    const onEdge = Boolean(item && item.kind === "relationship");
    const transaction = workspace.transaction();
    const edgeDraft = Boolean(transaction && transaction.kind === "edge-create" && !transaction.target);
    const mappingEvent = {
      button: event.button,
      detail: 1,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    };
    const intent = input.resolvePointer(mappingEvent, { onNode: Boolean(node), onEdge, edgeDraft, gesture: "tap" });
    if (state.clusterFieldOpen && intent === "createNode") {
      state.cameraTween = null;
    }
    const dragIntent = input.resolvePointer(mappingEvent, { onNode: Boolean(node), onEdge, edgeDraft, gesture: "drag" });
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    state.pointerCandidate = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "mouse",
      button: event.button,
      start: point,
      node,
      item,
      domainContext: hit ? hit.domainContext || null : null,
      intent,
      dragIntent,
      direct: directPointerIntent(item),
      threshold: event.pointerType === "touch" ? 10 : 6,
      cancelled: false
    };
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = canvasPoint(event);
    state.pointerPosition = point;
    if (state.wand.active && state.wand.pointerId === event.pointerId) {
      extendWandStroke(point);
      return;
    }
    if (state.pointerCandidate && state.pointerCandidate.pointerId === event.pointerId) {
      const candidate = state.pointerCandidate;
      const distance = Math.hypot(point.x - candidate.start.x, point.y - candidate.start.y);
      if (distance >= candidate.threshold) {
        primaryClickArbiter.cancel();
        secondaryClickArbiter.cancel();
        state.pointerCandidate = null;
        beginDragFromCandidate(candidate);
      } else {
        state.hovered = candidate.node || null;
        syncCanvasCursor(candidate.node || candidate.direct);
        return;
      }
    }
    if (state.drag && state.drag.pointerId === event.pointerId) {
      const dx = point.x - state.drag.last.x;
      const dy = point.y - state.drag.last.y;
      state.drag.last = point;
      if (state.drag.type === "orbit") {
        state.drag.totalDx += dx;
        state.drag.totalDy += dy;
        const orbitDelta = grammar.resolveOrbitDragDelta({
          dx,
          dy,
          totalDx: state.drag.totalDx,
          totalDy: state.drag.totalDy,
          axisLock: state.drag.axisLock
        });
        state.drag.axisLock = orbitDelta.axisLock;
        dispatchIntent("orbit", orbitDelta);
      } else if (state.drag.type === "node") {
        const basis = cameraBasis();
        const worldPerPixel = camera.distance * Math.tan(camera.fov / 2) * 2 / Math.max(1, state.height);
        const movement = V.add(
          V.scale(basis.right, dx * worldPerPixel),
          V.scale(basis.up, -dy * worldPerPixel)
        );
        state.drag.position = V.add(state.drag.position, movement);
        state.drag.node.manualPosition = { ...state.drag.position };
        broadcastIntent("grab", { phase: "move" }, state.drag.node);
      }
      return;
    }
    const hit = findHit(event.clientX, event.clientY);
    if (toggleBatchSelectionAtHit(hit)) return;
    const nextHovered = hit && hit.item && hit.item.node ? hit.item.node : null;
    if (nextHovered !== state.hovered) {
      state.hovered = nextHovered;
    }
    syncCanvasCursor(hit);
  });

  function releasePointer(event, cancelled = false) {
    if (state.wand.active && state.wand.pointerId === event.pointerId) {
      if (cancelled) {
        state.wand.active = false;
        state.wand.pointerId = null;
        state.wand.points = [];
      } else {
        finishWandStroke(canvasPoint(event));
      }
    } else if (state.pointerCandidate && state.pointerCandidate.pointerId === event.pointerId) {
      const candidate = state.pointerCandidate;
      state.pointerCandidate = null;
      if (!cancelled) {
        if (candidate.button === 1) {
          const releaseHit = findMiddleFrameHit(event.clientX, event.clientY);
          candidate.start = canvasPoint(event);
          candidate.item = releaseHit ? releaseHit.item || null : null;
          candidate.node = candidate.item && candidate.item.node ? candidate.item.node : null;
          candidate.domainContext = releaseHit ? releaseHit.domainContext || null : null;
        }
        commitPointerCandidate(candidate);
      }
    } else if (state.drag && state.drag.pointerId === event.pointerId) {
      if (state.drag.type === "node") {
        broadcastIntent("release", { phase: cancelled ? "cancel" : "end" }, state.drag.node);
        if (!cancelled) {
          announce(`${state.drag.node.label} 已移动到当前工作区位置`);
        }
      } else if (state.drag.type === "orbit") {
        recordCurrentView();
      }
      state.drag = null;
    }
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", (event) => {
    primaryClickArbiter.cancel();
    secondaryClickArbiter.cancel();
    releasePointer(event, true);
  });
  global.addEventListener("blur", () => {
    primaryClickArbiter.cancel();
    secondaryClickArbiter.cancel();
    state.wand.shiftHeld = false;
    state.wand.active = false;
    state.wand.points = [];
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (state.transitionLocked) {
      return;
    }
    if (!state.wheelGestureActive) {
      recordCurrentView();
      state.wheelGestureActive = true;
    }
    if (state.wheelHistoryTimer) {
      global.clearTimeout(state.wheelHistoryTimer);
    }
    const intent = input.resolvePointer(event, { onNode: false, gesture: "wheel" });
    const point = canvasPoint(event);
    const navigationPointMoved = !state.wheelNavigationPoint
      || Math.hypot(
        point.x - state.wheelNavigationPoint.x,
        point.y - state.wheelNavigationPoint.y
      ) > 0.5;
    if (navigationPointMoved || !state.wheelNavigationAnchor) {
      const navigationHit = findHit(event.clientX, event.clientY);
      const anchorDepth = navigationHit
        && navigationHit.item
        && navigationHit.item.screen
        ? navigationHit.item.screen.depth
        : camera.distance;
      state.wheelNavigationPoint = point;
      state.wheelNavigationAnchor = unprojectScreen(
        point.x,
        point.y,
        anchorDepth,
        cameraBasis()
      );
    }
    const anchor = state.wheelNavigationAnchor;
    dispatchIntent(intent, { delta: event.deltaY, anchor });
    state.wheelHistoryTimer = global.setTimeout(() => {
      state.wheelGestureActive = false;
      state.wheelHistoryTimer = null;
      recordCurrentView();
    }, 180);
  }, { passive: false });

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  function insertTextareaLineBreak(textarea) {
    const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
    const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
    textarea.setRangeText("\n", start, end, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function isShiftEnterEvent(event) {
    const enter = event.key === "Enter" || event.code === "Enter" || event.keyCode === 13;
    const shifted = event.shiftKey === true
      || (typeof event.getModifierState === "function" && event.getModifierState("Shift"))
      || state.wand.shiftHeld
      || performance.now() <= state.editShiftLineBreakUntil;
    return enter && shifted;
  }

  function handleEditTransactionKey(event) {
    if (!workspace.transaction() || event.isComposing) return;
    const intent = event.key === "Escape"
      ? "cancelEdit"
      : (event.key === "Enter" || event.code === "Enter") && !isShiftEnterEvent(event)
        ? "confirmEdit"
        : null;
    if (!intent) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dispatchIntent(intent);
  }

  document.addEventListener("keydown", handleEditTransactionKey, { capture: true });

  document.addEventListener("keydown", (event) => {
    if (viewModeModel.isShiftKeyEvent(event) && !event.repeat) {
      if (workspace.transaction()) {
        state.editShiftLineBreakUntil = performance.now() + 900;
        state.wand.shiftHeld = true;
        return;
      }
      handleShiftTap(performance.now());
      return;
    }
    if (
      event.code === "CapsLock"
      && !event.repeat
      && !workspace.transaction()
      && !state.bindingCaptureIntent
    ) {
      const gesture = detailMagnifierModel.registerCapsLock(
        state.detailMagnifier,
        performance.now()
      );
      state.detailMagnifier.presses = gesture.state.presses;
      if (gesture.toggled) setDetailMagnifierEnabled(gesture.state.enabled);
      if (!state.bindingCaptureIntent) return;
    }
    if (event.key === "Escape" && state.detailMagnifier.enabled) {
      event.preventDefault();
      setDetailMagnifierEnabled(false);
      return;
    }
    if (state.clusterFieldOpen && event.key === "Control") {
      state.cameraTween = null;
    }
    if (state.bindingCaptureIntent) {
      event.preventDefault();
      if (event.code === "Escape") {
        state.bindingCaptureIntent = null;
        renderBindings();
        return;
      }
      const chord = input.chordFromEvent(event);
      if (input.setKeyboardBinding(state.bindingCaptureIntent, chord)) {
        state.bindingCaptureIntent = null;
        announce(`输入映射已改为 ${chord}`);
      }
      return;
    }
    const transaction = workspace.transaction();
    const editing = Boolean(transaction);
    let intent = input.resolveKeyboard(event, { editing });
    if (editing && intent) {
      event.preventDefault();
      dispatchIntent(intent);
      return;
    }
    if (event.key === "Escape" && !ui.searchPanel.hidden) {
      event.preventDefault();
      closeSearch();
      return;
    }
    if (event.key === "Enter" && event.target === ui.spatialSearch && state.searchMatches.length) {
      event.preventDefault();
      jumpToSearchResult(state.searchMatches[0]);
      return;
    }
    if (event.key === "Escape" && (!ui.mappingPanel.hidden || !ui.helpPanel.hidden)) {
      ui.mappingPanel.hidden = true;
      ui.helpPanel.hidden = true;
      canvas.focus({ preventScroll: true });
      return;
    }
    const targetIsFormControl = (
      event.target instanceof HTMLButtonElement
      || event.target instanceof HTMLInputElement
      || event.target instanceof HTMLTextAreaElement
    );
    if (targetIsFormControl) {
      return;
    }
    if (transaction && transaction.kind.startsWith("edge-") && !intent) {
      const navigationIntent = input.resolveKeyboard(event, { editing: false });
      if (EDGE_DRAFT_NAVIGATION_INTENTS.has(navigationIntent)) {
        intent = navigationIntent;
      }
    }
    if (!intent) {
      return;
    }
    event.preventDefault();
    dispatchIntent(intent);
  });

  function handleShiftEnterLineBreak(event) {
    if (!isShiftEnterEvent(event) || !workspace.transaction()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.editShiftLineBreakUntil = 0;
    if (markdownEditor) {
      markdownEditor.insertLineBreak();
      markdownEditor.focus();
    } else {
      insertTextareaLineBreak(ui.nodeDetailEditor);
      ui.nodeDetailEditor.focus();
    }
  }

  document.addEventListener("keydown", handleShiftEnterLineBreak, { capture: true });

  ui.nodeDetailLineBreak.addEventListener("click", () => {
    if (!workspace.transaction()) return;
    state.editShiftLineBreakUntil = 0;
    if (markdownEditor) {
      markdownEditor.insertLineBreak();
      markdownEditor.focus();
    } else {
      insertTextareaLineBreak(ui.nodeDetailEditor);
      ui.nodeDetailEditor.focus();
    }
  });

  document.addEventListener("keyup", (event) => {
    if (
      event.code === "CapsLock"
      && !event.repeat
      && !workspace.transaction()
      && !state.bindingCaptureIntent
    ) {
      if (
        event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement
      ) return;
      const intent = input.resolveKeyboard(event, { editing: false, viewMode: state.viewMode });
      if (intent) {
        event.preventDefault();
        dispatchIntent(intent);
      }
      return;
    }
    if (!viewModeModel.isShiftKeyEvent(event)) return;
    state.wand.shiftHeld = false;
    if (state.wand.active) finishWandStroke(state.pointerPosition);
    releaseWandBatch();
    syncCanvasCursor();
  });

  document.querySelectorAll("[data-intent]").forEach((button) => {
    button.addEventListener("click", () => dispatchIntent(button.dataset.intent));
  });

  function closePanels(except) {
    ui.mappingPanel.hidden = except === "mapping" ? ui.mappingPanel.hidden : true;
    ui.helpPanel.hidden = except === "help" ? ui.helpPanel.hidden : true;
    ui.searchPanel.hidden = except === "search" ? ui.searchPanel.hidden : true;
    ui.mermaidPanel.hidden = except === "mermaid" ? ui.mermaidPanel.hidden : true;
  }

  function compactnessLabel(percentInput) {
    const percent = Number(percentInput) || 0;
    if (percent <= 100) return `${percent}%`;
    const multiplier = percent / 100;
    return `${Number.isInteger(multiplier) ? multiplier.toFixed(0) : multiplier.toFixed(1)}×`;
  }

  function syncPresentationControls() {
    ui.demoIdleSeconds.value = state.demo.settings.idleSeconds === null
      ? ""
      : String(state.demo.settings.idleSeconds);
    ui.helpStartupToggle.checked = state.demo.settings.helpVisible;
    ui.zoomSpeed.value = String(state.demo.settings.zoomSpeedPercent);
    ui.zoomSpeedValue.textContent = `${state.demo.settings.zoomSpeedPercent}%`;
    ui.relationshipLineWidth.value = String(state.demo.settings.relationshipLineWidthPercent);
    ui.relationshipLineWidthValue.textContent = `${state.demo.settings.relationshipLineWidthPercent}%`;
    ui.relationshipBrightness.value = String(state.demo.settings.relationshipBrightnessPercent);
    ui.relationshipBrightnessValue.textContent = `${state.demo.settings.relationshipBrightnessPercent}%`;
    ui.middleLabelDepth.value = String(state.demo.settings.middleLabelDepth);
    ui.middleLabelDepthValue.textContent = `${state.demo.settings.middleLabelDepth} 层`;
    ui.highlightedLabelBrightness.value = String(state.demo.settings.highlightedLabelBrightnessPercent);
    ui.highlightedLabelBrightnessValue.textContent = `${state.demo.settings.highlightedLabelBrightnessPercent}%`;
    ui.otherLabelBrightness.value = String(state.demo.settings.otherLabelBrightnessPercent);
    ui.otherLabelBrightnessValue.textContent = `${state.demo.settings.otherLabelBrightnessPercent}%`;
    ui.middleDetailDepth.value = String(state.demo.settings.middleDetailDepth);
    ui.middleDetailDepthValue.textContent = `${state.demo.settings.middleDetailDepth} 层`;
    ui.highlightedDetailBrightness.value = String(
      state.demo.settings.highlightedDetailBrightnessPercent
    );
    ui.highlightedDetailBrightnessValue.textContent =
      `${state.demo.settings.highlightedDetailBrightnessPercent}%`;
    ui.otherDetailBrightness.value = String(state.demo.settings.otherDetailBrightnessPercent);
    ui.otherDetailBrightnessValue.textContent = `${state.demo.settings.otherDetailBrightnessPercent}%`;
    ui.floatingDetailBackdropOpacity.value = String(
      state.demo.settings.floatingDetailBackdropOpacityPercent
    );
    ui.floatingDetailBackdropOpacityValue.textContent =
      `${state.demo.settings.floatingDetailBackdropOpacityPercent}%`;
    ui.nestedCompactness.value = String(state.demo.settings.nestedCompactnessPercent);
    ui.nestedCompactnessValue.textContent = compactnessLabel(
      state.demo.settings.nestedCompactnessPercent
    );
    ui.peripheralDepthShrink.value = String(state.demo.settings.peripheralDepthShrinkPercent);
    ui.peripheralDepthShrinkValue.textContent = `${state.demo.settings.peripheralDepthShrinkPercent}%`;
    ui.nestedTunnelStrength.value = String(state.demo.settings.nestedTunnelPercent);
    ui.nestedTunnelStrengthValue.textContent = `${state.demo.settings.nestedTunnelPercent}%`;
    ui.nestedTunnelInteriorStrength.value = String(state.demo.settings.nestedTunnelInteriorPercent);
    ui.nestedTunnelInteriorStrengthValue.textContent = `${state.demo.settings.nestedTunnelInteriorPercent}%`;
    document.body.dataset.demoEnabled = String(state.demo.settings.idleSeconds !== null);
  }

  function updateDemoSettings(nextSettings) {
    state.demo.settings = demoModel.normalizeSettings(nextSettings);
    saveDemoSettings(state.demo.settings);
    syncPresentationControls();
  }

  function setHelpPanelVisible(visible, persist = true) {
    ui.helpPanel.hidden = !visible;
    ui.helpPanel.dataset.state = visible ? "open" : "closed";
    if (persist) {
      updateDemoSettings({ ...state.demo.settings, helpVisible: visible });
    }
  }

  let activeHelpPage = helpPageModel.defaultPage({
    coarsePointer: Boolean(global.matchMedia && global.matchMedia("(hover: none) and (pointer: coarse)").matches)
  });

  function setHelpPage(requestedPage) {
    activeHelpPage = helpPageModel.selectPage(activeHelpPage, requestedPage);
    document.querySelectorAll("[data-help-tab]").forEach((button) => {
      const selected = button.dataset.helpTab === activeHelpPage;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll("[data-help-page]").forEach((page) => {
      page.hidden = page.dataset.helpPage !== activeHelpPage;
    });
  }

  function clearDemoTimers() {
    ["themeTimer", "stepTimer", "cueTimer", "frameTimer", "wandTimer"].forEach((key) => {
      if (state.demo[key]) global.clearTimeout(state.demo[key]);
      state.demo[key] = null;
    });
  }

  function clearDemoWandPresentation() {
    if (state.demo.wandTimer) global.clearTimeout(state.demo.wandTimer);
    state.demo.wandTimer = null;
    state.wand.points = [];
    state.wand.active = false;
    state.wand.pointerId = null;
    state.wand.pendingKeys = [];
    state.wand.closed = false;
    state.wand.shiftHeld = false;
    state.wand.highEnergy = state.demo.wandPreviousEnergy === true;
    canvas.style.cursor = state.wand.highEnergy ? "none" : "default";
  }

  function hideDemoOverlays() {
    ui.demoTheme.classList.remove("is-active");
    ui.demoTheme.hidden = true;
    ui.demoCue.classList.remove("is-active");
    ui.demoCue.hidden = true;
  }

  function restoreDemoCamera(snapshot, animate = true) {
    if (!snapshot) return false;
    state.cameraTween = null;
    if (animate) {
      startCameraTween(snapshot, 520);
    } else {
      camera.target = { ...snapshot.target };
      camera.yaw = snapshot.yaw;
      camera.pitch = snapshot.pitch;
      camera.distance = snapshot.distance;
    }
    return true;
  }

  function cleanupOrphanedDemoKnowledge() {
    const markerPattern = /^【演示·\d{8}-\d{6}】(?:\s|$)/u;
    const knowledge = workspace.exportKnowledge();
    const demoNodes = knowledge.nodes.filter((node) => (
      markerPattern.test(String(node.label || ""))
      || markerPattern.test(String(node.detail || node.description || ""))
    ));
    const demoKeys = new Set(demoNodes.map((node) => `${node.path || "root"}::${node.id}`));
    const demoEdges = knowledge.edges.filter((edge) => (
      markerPattern.test(String(edge.label || ""))
      || demoKeys.has(edge.from && edge.from.key)
      || demoKeys.has(edge.to && edge.to.key)
    ));
    let changed = false;
    demoEdges.forEach((edge) => {
      if (!workspace.beginEdgeEdit(edge)) return;
      workspace.markDelete();
      if (workspace.commit()) changed = true;
    });
    demoNodes.forEach((node) => {
      if (workspace.discardAddedNode(`${node.path || "root"}::${node.id}`)) changed = true;
    });
    if (changed) persistWorkspaceSnapshot("demo-orphan-cleanup");
    return changed;
  }

  function cleanupDemoKnowledge(session) {
    if (!session || !session.knowledgeDirty || !session.marker) return false;
    if (workspace.transaction()) workspace.cancel();
    const knowledge = workspace.exportKnowledge();
    const marker = session.marker;
    const demoEdges = knowledge.edges.filter((edge) => (
      edge.id === session.demoEdgeId
      || String(edge.label || "").includes(marker)
      || (session.demoNodeKey && (
        edge.from && edge.from.key === session.demoNodeKey
        || edge.to && edge.to.key === session.demoNodeKey
      ))
    ));
    const demoNodes = knowledge.nodes.filter((node) => (
      `${node.path || "root"}::${node.id}` === session.demoNodeKey
      || String(node.label || "").includes(marker)
      || String(node.detail || node.description || "").includes(marker)
    ));
    let changed = false;
    demoEdges.forEach((edge) => {
      if (!workspace.beginEdgeEdit(edge)) return;
      workspace.markDelete();
      if (workspace.commit()) changed = true;
    });
    demoNodes.forEach((node) => {
      const path = node.path || node.workspacePath || "root";
      if (workspace.discardAddedNode(`${path}::${node.id}`)) changed = true;
    });
    if (changed) {
      currentDomainNodes();
      persistWorkspaceSnapshot("demo-cleanup");
    }
    return changed;
  }

  function cleanupDemoSession(reason = "complete", optionsInput) {
    const options = optionsInput || {};
    const session = state.demo.session;
    clearDemoTimers();
    clearDemoWandPresentation();
    hideDemoOverlays();
    state.demo.currentTask = null;
    if (workspace.transaction()) {
      workspace.cancel();
      closeNodeEditor();
    }
    if (session && session.knowledgeDirty) cleanupDemoKnowledge(session);
    if (session && session.visualBaseline && !state.transitionLocked) {
      restoreVisualSnapshot(session.visualBaseline);
    }
    if (session && session.cameraBaseline) {
      restoreDemoCamera(session.cameraBaseline, options.animateCamera !== false);
    }
    state.demo.session = null;
    if (options.keepActive !== true) {
      state.demo.active = false;
      document.body.dataset.demoActive = "false";
    }
    return reason;
  }

  function stopDemoPresentation(optionsInput) {
    const options = optionsInput || {};
    if (options.skipCleanup !== true) {
      cleanupDemoSession(options.reason || "stopped", {
        animateCamera: options.animateCamera
      });
    } else {
      clearDemoTimers();
      clearDemoWandPresentation();
      hideDemoOverlays();
      state.demo.session = null;
    }
    state.demo.active = false;
    state.demo.currentTask = null;
    document.body.dataset.demoActive = "false";
  }

  function toggleDemoMode() {
    stopDemoPresentation({ reason: "toggle" });
    updateDemoSettings(demoModel.toggleDemo(state.demo.settings));
    state.demo.lastInputAt = performance.now();
    announce(state.demo.settings.idleSeconds === null ? "自动演示已关闭" : `自动演示将在空闲 ${state.demo.settings.idleSeconds} 秒后开始`);
    return state.demo.settings.idleSeconds !== null;
  }

  function demoVisibleNodes() {
    const visible = state.hitRegions
      .map((region) => region.item && region.item.kind === "node" ? region.item.node : null)
      .filter(Boolean);
    const fallback = existingNodes(currentDomainNodes());
    return [...new Map([...visible, ...fallback].map((node) => [
      visualNodeKey(node, nodeOwnerPath(node)),
      node
    ])).values()];
  }

  function demoTargetNode(requirement = "portal") {
    const nodes = demoVisibleNodes();
    if (requirement === "detail") {
      return nodes.find((node) => Boolean(node.description || node.attachment))
        || nodes[0]
        || null;
    }
    if (requirement === "workspace") {
      return nodes.find((node) => node.isWorkspaceNode)
        || nodes[0]
        || null;
    }
    return nodes.find((node) => (
      node.capabilities
      && node.capabilities.portal
      && node.hasChildren === true
    ))
      || nodes.find((node) => node.capabilities && node.capabilities.portal)
      || nodes[0]
      || null;
  }

  function scanDemoGraph() {
    const nodes = demoVisibleNodes();
    const portals = nodes.filter((node) => (
      node.capabilities
      && node.capabilities.portal
      && node.hasChildren === true
    ));
    const details = nodes.filter((node) => Boolean(node.description || node.attachment));
    const session = state.demo.session;
    const demoReference = demoNodeReference(session);
    const wandRegions = visibleWandRegions();
    return Object.freeze({
      depth: state.depth,
      atRoot: state.currentPath === "root" && state.depth === 0,
      portalCount: portals.length,
      detailCount: details.length,
      maxDescent: portals.length ? 3 : 0,
      canBack: state.viewHistory.canBack,
      canForward: state.viewHistory.canForward,
      clusterOpen: state.clusterFieldOpen || state.expandedClusterDomains.size > 0,
      worldLensOpen: state.worldLens.open,
      batchCount: wandRegions.length,
      canCreate: !workspace.transaction() && !demoReference,
      canUpdate: !workspace.transaction() && Boolean(demoReference),
      canRelate: !workspace.transaction() && Boolean(demoReference),
      canLand: !workspace.transaction() && Boolean(demoReference)
    });
  }

  function beginDemoSession() {
    state.demo.session = {
      marker: demoModel.formatSessionMarker(new Date()),
      completedIds: new Set(),
      currentTheme: null,
      knowledgeDirty: false,
      visualBaseline: visualSnapshot(),
      cameraBaseline: cameraSnapshot(),
      demoNodeKey: null,
      demoRelationTargetKey: null,
      demoEdgeId: null
    };
    state.demo.wandPreviousEnergy = state.wand.highEnergy;
    return state.demo.session;
  }

  function demoSourceRegions() {
    const basis = cameraBasis();
    if (state.clusterFieldOpen) {
      return state.clusterScene.clusters.map((cluster) => (
        projectUnclipped(cluster.center, cluster.radius, basis)
      )).filter(Boolean);
    }
    return collectNodes(state.time)
      .filter((item) => item.kind === "node" && item.node)
      .map((item) => projectUnclipped(item.position, item.radius, basis))
      .filter(Boolean);
  }

  function demoSceneBounds() {
    const regions = [
      ...demoSourceRegions(),
      ...state.wand.points.map((point) => ({ x: point.x, y: point.y, radius: 5 }))
    ].filter((region) => Number.isFinite(region.x) && Number.isFinite(region.y));
    if (!regions.length) {
      return {
        minX: state.width * 0.5 - 80,
        maxX: state.width * 0.5 + 80,
        minY: state.height * 0.5 - 60,
        maxY: state.height * 0.5 + 60
      };
    }
    return regions.reduce((bounds, region) => {
      const radius = Math.max(3, Number(region.radius) || 0);
      bounds.minX = Math.min(bounds.minX, region.x - radius);
      bounds.maxX = Math.max(bounds.maxX, region.x + radius);
      bounds.minY = Math.min(bounds.minY, region.y - radius);
      bounds.maxY = Math.max(bounds.maxY, region.y + radius);
      return bounds;
    }, {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY
    });
  }

  function fitDemoCamera(step) {
    state.cameraTween = null;
    const plan = demoGeometry.planAdaptiveFrame(
      demoSceneBounds(),
      { width: state.width, height: state.height },
      {
        currentDistance: camera.distance,
        minDistance: MIN_CAMERA_DISTANCE,
        maxDistance: MAX_CAMERA_DISTANCE,
        paddingRatio: step && step.kind === "batch" ? 0.18 : 0.15
      }
    );
    const basis = cameraBasis();
    const projectionSpan = Math.min(state.height, state.width * 1.25);
    const focal = projectionSpan / (2 * Math.tan(camera.fov / 2));
    const worldPerPixel = camera.distance / Math.max(1, focal);
    const target = V.add(camera.target, V.add(
      V.scale(basis.right, plan.screenOffset.x * worldPerPixel),
      V.scale(basis.up, -plan.screenOffset.y * worldPerPixel)
    ));
    startCameraTween({
      target,
      yaw: camera.yaw,
      pitch: camera.pitch,
      distance: plan.distance
    }, 620);
  }

  function setDemoDetailMode(node, desiredMode) {
    if (!node) return false;
    for (let index = 0; index < 3 && visualModel.detailModeFor(node) !== desiredMode; index += 1) {
      visualModel.cycleNodeDetailMode(node);
    }
    node.surfaceOpenedAt = desiredMode === "surface" ? performance.now() : 0;
    state.commitPulseUntil = performance.now() + 320;
    updateSelectionUI();
    return true;
  }

  function executeDemoCameraAction(action) {
    const destination = cameraSnapshot();
    if (action === "orbit") {
      destination.yaw += 0.58;
      destination.pitch = clamp(destination.pitch + 0.12, -1.15, 1.15);
    } else if (action === "pan") {
      const basis = cameraBasis();
      destination.target = V.add(destination.target, V.add(
        V.scale(basis.right, camera.distance * 0.13),
        V.scale(basis.up, camera.distance * 0.07)
      ));
    } else if (action === "far") {
      destination.distance = clamp(camera.distance * 1.55, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
    } else if (action === "near") {
      destination.distance = clamp(camera.distance * 0.58, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
    } else {
      return false;
    }
    startCameraTween(destination, 780);
    return true;
  }

  function executeDemoBatch(action) {
    const regions = visibleWandRegions();
    const plan = demoGeometry.planWandPath(regions, {
      viewport: { width: state.width, height: state.height },
      maxWaypoints: action === "recursive" ? 10 : 14
    });
    const keys = plan.targetKeys.filter(Boolean);
    if (!keys.length || !plan.points.length) return false;
    if (state.demo.wandTimer) global.clearTimeout(state.demo.wandTimer);
    state.wand.highEnergy = action === "recursive";
    state.wand.shiftHeld = true;
    state.wand.active = true;
    state.wand.points = [{ ...plan.points[0] }];
    state.pointerPosition = { ...plan.points[0] };
    canvas.style.cursor = "none";
    let pointIndex = 1;

    const advance = () => {
      state.demo.wandTimer = null;
      if (!state.demo.active) {
        clearDemoWandPresentation();
        return;
      }
      if (pointIndex < plan.points.length) {
        const point = plan.points[pointIndex];
        state.wand.points.push({ ...point });
        state.pointerPosition = { ...point };
        pointIndex += 1;
        state.demo.wandTimer = global.setTimeout(advance, 38);
        return;
      }
      state.wand.active = false;
      const glowUntil = performance.now() + 650;
      keys.forEach((key) => state.wandGlowUntil.set(key, glowUntil));
      state.demo.wandTimer = global.setTimeout(() => {
        state.demo.wandTimer = null;
        if (!state.demo.active) {
          clearDemoWandPresentation();
          return;
        }
        executeWandTargets(keys, { glowDurationMs: 0 });
        state.demo.wandTimer = global.setTimeout(() => {
          state.demo.wandTimer = null;
          clearDemoWandPresentation();
        }, 1400);
      }, 340);
    };

    state.demo.wandTimer = global.setTimeout(advance, 38);
    return true;
  }

  function demoNodeReference(session) {
    if (!session || !session.demoNodeKey) return null;
    const separator = session.demoNodeKey.lastIndexOf("::");
    if (separator <= 0) return null;
    const path = session.demoNodeKey.slice(0, separator);
    const id = session.demoNodeKey.slice(separator + 2);
    const node = nodeByIdInPath(path, id);
    return node ? { path, node } : null;
  }

  function executeDemoEditing(action) {
    const session = state.demo.session;
    if (!session || workspace.transaction()) return false;
    const marker = session.marker;
    if (action === "create") {
      const node = workspace.beginNodeCreate(state.currentPath, {
        label: `${marker} 演示节点`,
        description: `${marker} 由自适应导览临时创建`,
        position: { x: 0.35, y: -0.25, z: 0.2 },
        radius: 0.82
      });
      if (!node) return false;
      prepareWorkspaceNode(node, state.currentPath);
      const operation = workspace.commit();
      if (!operation) return false;
      session.demoNodeKey = `${state.currentPath}::${node.id}`;
      session.knowledgeDirty = true;
      currentDomainNodes();
      persistWorkspaceSnapshot("demo-node-create");
      return true;
    }
    const reference = demoNodeReference(session);
    if (!reference) return false;
    if (action === "update") {
      if (!workspace.beginNodeEdit(reference.path, reference.node)) return false;
      workspace.updateNodeDraft({
        label: `${marker} 演示节点`,
        description: `${marker} 已演示创建、命名与详情更新`
      });
      if (!workspace.commit()) return false;
      session.knowledgeDirty = true;
      currentDomainNodes();
      persistWorkspaceSnapshot("demo-node-update");
      return true;
    }
    if (action === "relation") {
      const target = workspace.beginNodeCreate(reference.path, {
        label: `${marker} 关联端点`,
        description: `${marker} 用于演示节点关系`,
        position: { x: -0.58, y: 0.34, z: -0.14 },
        radius: 0.76
      });
      if (!target) return false;
      prepareWorkspaceNode(target, reference.path);
      if (!workspace.commit()) return false;
      session.demoRelationTargetKey = `${reference.path}::${target.id}`;
      const labels = pathLabelsForPath(reference.path);
      const sourceEndpoint = workspaceModel.qualifiedEndpoint(reference.path, reference.node, labels);
      const targetEndpoint = workspaceModel.qualifiedEndpoint(reference.path, target, labels);
      if (!workspace.beginEdgeCreate(sourceEndpoint, reference.node)) return false;
      if (!workspace.setEdgeTarget(targetEndpoint) || !workspace.commit()) {
        workspace.cancel();
        return false;
      }
      const edge = workspace.exportKnowledge().edges
        .find((candidate) => (
          candidate.from.key === sourceEndpoint.key
          && candidate.to.key === targetEndpoint.key
        ));
      if (edge && workspace.beginEdgeEdit(edge)) {
        workspace.updateEdgeDraft({ label: `${marker} 演示关系` });
        workspace.commit();
        session.demoEdgeId = edge.id;
      }
      session.knowledgeDirty = true;
      persistWorkspaceSnapshot("demo-edge-create");
      return true;
    }
    if (action === "land") {
      let anchor = null;
      if (session.demoRelationTargetKey) {
        const separator = session.demoRelationTargetKey.lastIndexOf("::");
        const anchorPath = session.demoRelationTargetKey.slice(0, separator);
        const anchorId = session.demoRelationTargetKey.slice(separator + 2);
        if (anchorPath === reference.path) {
          anchor = nodeByIdInPath(anchorPath, anchorId);
        }
      }
      if (!anchor) {
        anchor = workspace.beginNodeCreate(reference.path, {
          label: `${marker} 新域入口`,
          description: `${marker} 用于演示节点跨域落脚`,
          position: { x: -0.62, y: 0.36, z: -0.18 },
          radius: 0.9
        });
        if (!anchor) return false;
        prepareWorkspaceNode(anchor, reference.path);
        if (!workspace.commit()) return false;
      }
      const targetPath = childPathFor(anchor, reference.path);
      const labels = pathLabelsForPath(reference.path);
      const sourceEndpoint = workspaceModel.qualifiedEndpoint(
        reference.path,
        reference.node,
        labels
      );
      if (!workspace.beginEdgeCreate(sourceEndpoint, reference.node)) return false;
      if (!workspace.setNodeLanding({
        path: targetPath,
        pathLabels: [...labels, anchor.label],
        position: { x: 0, y: 0, z: 0 }
      })) {
        workspace.cancel();
        return false;
      }
      const operation = workspace.commit();
      if (!operation || operation.kind !== "node-land") return false;
      session.demoNodeKey = operation.newKey;
      session.knowledgeDirty = true;
      createChildDomainNodes(anchor, targetPath, clusterDepthForPath(reference.path) + 1);
      persistWorkspaceSnapshot("demo-node-land");
      locateKnowledgeNode(operation.newKey);
      return true;
    }
    return false;
  }

  function executeDemoStep(step) {
    if (!state.demo.active || !step) return false;
    const node = demoTargetNode(step.kind === "detail" ? "detail" : "portal");
    if (step.kind === "mode") {
      const ownerPath = nodeOwnerPath(node);
      const childPath = node ? childPathFor(node, ownerPath) : "";
      if (childPath && state.expandedClusterDomains.has(childPath)) {
        collapseClusterDomain(childPath);
      }
      setViewMode(step.mode);
      return node ? applyViewMode(node) : false;
    }
    if (step.kind === "detail") {
      return setDemoDetailMode(node, step.detailMode || "surface");
    }
    if (step.kind === "worldLens") {
      if (state.worldLens.open) return false;
      toggleWorldLens();
      return state.worldLens.open;
    }
    if (step.kind === "descend") {
      if (!node || node.hasChildren !== true) return false;
      setViewMode("immersive");
      enterNode(node, true);
      return true;
    }
    if (step.kind === "retreat") {
      if (state.depth <= 0) return false;
      returnToDepth(state.depth - 1);
      return true;
    }
    if (step.kind === "overview") {
      if (state.depth <= 0 && !state.clusterFieldOpen && !state.expandedClusterDomains.size) {
        return false;
      }
      returnOverview();
      return true;
    }
    if (step.kind === "camera") {
      return executeDemoCameraAction(step.cameraAction);
    }
    if (step.kind === "batch") {
      return executeDemoBatch(step.batchAction);
    }
    if (step.kind === "editing") {
      return executeDemoEditing(step.editAction);
    }
    return false;
  }

  function showDemoTheme(step, onComplete) {
    const session = state.demo.session;
    if (!session || session.currentTheme === step.theme) {
      onComplete();
      return;
    }
    session.currentTheme = step.theme;
    ui.demoThemeIndex.textContent = step.themeIndex;
    ui.demoThemeLabel.textContent = step.themeLabel;
    ui.demoTheme.hidden = false;
    global.requestAnimationFrame(() => ui.demoTheme.classList.add("is-active"));
    state.demo.themeTimer = global.setTimeout(() => {
      state.demo.themeTimer = null;
      ui.demoTheme.classList.remove("is-active");
      state.demo.stepTimer = global.setTimeout(() => {
        state.demo.stepTimer = null;
        ui.demoTheme.hidden = true;
        onComplete();
      }, 320);
    }, 1080);
  }

  function finishDemoCycle() {
    cleanupDemoSession("cycle-complete", { keepActive: true });
    state.demo.stepTimer = global.setTimeout(() => {
      state.demo.stepTimer = null;
      if (!state.demo.active || document.hidden) return;
      beginDemoSession();
      runNextDemoStep();
    }, 1650);
  }

  function runNextDemoStep() {
    if (!state.demo.active || document.hidden) return;
    const session = state.demo.session || beginDemoSession();
    const step = demoModel.nextTourTask(scanDemoGraph(), [...session.completedIds]);
    if (!step) {
      finishDemoCycle();
      return;
    }
    state.demo.currentTask = step;
    const cueAndExecute = () => {
      if (!state.demo.active || state.demo.currentTask !== step) return;
      ui.demoCueKey.textContent = step.key;
      ui.demoCueLabel.textContent = step.label;
      ui.demoCue.hidden = false;
      global.requestAnimationFrame(() => ui.demoCue.classList.add("is-active"));
      fitDemoCamera(step);
      state.demo.cueTimer = global.setTimeout(() => {
        state.demo.cueTimer = null;
        if (!state.demo.active || state.demo.currentTask !== step) return;
        const succeeded = executeDemoStep(step);
        session.completedIds.add(step.id);
        if (succeeded) {
          state.demo.frameTimer = global.setTimeout(() => {
            state.demo.frameTimer = null;
            if (state.demo.active && state.demo.currentTask === step) fitDemoCamera(step);
          }, 90);
        }
        ui.demoCue.classList.remove("is-active");
        const stepDwellMs = step.kind === "batch"
          ? 2300
          : step.kind === "editing"
            ? 2200
            : 1450;
        state.demo.stepTimer = global.setTimeout(() => {
          state.demo.stepTimer = null;
          ui.demoCue.hidden = true;
          state.demo.currentTask = null;
          runNextDemoStep();
        }, stepDwellMs);
      }, 900);
    };
    showDemoTheme(step, cueAndExecute);
  }

  function startDemoPresentation() {
    if (
      state.demo.active
      || state.demo.settings.idleSeconds === null
      || document.hidden
      || workspace.transaction()
    ) {
      return false;
    }
    cleanupOrphanedDemoKnowledge();
    state.demo.active = true;
    beginDemoSession();
    document.body.dataset.demoActive = "true";
    runNextDemoStep();
    return true;
  }

  function registerHumanInput(event) {
    if (!event) return;
    if (state.demo.active) {
      cleanupDemoSession("human-input", { animateCamera: false });
      stopDemoPresentation({ skipCleanup: true });
      state.cameraTween = null;
    }
    state.demo.lastInputAt = performance.now();
  }

  function toggleHelpPanel() {
    const willOpen = ui.helpPanel.hidden;
    closePanels(willOpen ? "help" : null);
    setHelpPanelVisible(willOpen);
    canvas.focus({ preventScroll: true });
  }

  document.querySelectorAll("[data-ui]").forEach((button) => {
    button.addEventListener("click", () => {
      const panelName = button.dataset.ui;
      if (panelName === "search") {
        if (ui.searchPanel.hidden) openSearch();
        else closeSearch();
        return;
      }
      if (panelName === "help") {
        toggleHelpPanel();
        return;
      }
      const panel = panelName === "mapping"
        ? ui.mappingPanel
        : panelName === "mermaid"
          ? ui.mermaidPanel
          : ui.helpPanel;
      const willOpen = panel.hidden;
      closePanels(panelName);
      panel.hidden = !willOpen;
      if (willOpen) {
        const firstButton = panel.querySelector("button");
        if (firstButton) {
          firstButton.focus({ preventScroll: true });
        }
      } else {
        canvas.focus({ preventScroll: true });
      }
    });
  });

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = button.dataset.close === "mapping"
        ? ui.mappingPanel
        : button.dataset.close === "search"
          ? ui.searchPanel
          : button.dataset.close === "mermaid"
            ? ui.mermaidPanel
            : ui.helpPanel;
      if (button.dataset.close === "help") setHelpPanelVisible(false);
      else panel.hidden = true;
      canvas.focus({ preventScroll: true });
    });
  });

  document.querySelectorAll("[data-help-tab]").forEach((button) => {
    button.addEventListener("click", () => setHelpPage(button.dataset.helpTab));
  });

  document.querySelectorAll("[data-open-help-page]").forEach((button) => {
    button.addEventListener("click", () => {
      closePanels("help");
      setHelpPage(button.dataset.openHelpPage);
      setHelpPanelVisible(true);
    });
  });

  ui.demoIdleSeconds.addEventListener("input", () => {
    stopDemoPresentation();
    updateDemoSettings(demoModel.withIdleInput(state.demo.settings, ui.demoIdleSeconds.value.trim()));
    state.demo.lastInputAt = performance.now();
  });

  ui.helpStartupToggle.addEventListener("change", () => {
    const visible = ui.helpStartupToggle.checked;
    if (visible) closePanels("help");
    setHelpPanelVisible(visible);
  });

  ui.zoomSpeed.addEventListener("input", () => {
    updateDemoSettings(demoModel.withZoomSpeedInput(
      state.demo.settings,
      ui.zoomSpeed.value
    ));
  });

  ui.middleLabelDepth.addEventListener("input", () => {
    updateDemoSettings(demoModel.withMiddleLabelDepthInput(
      state.demo.settings,
      ui.middleLabelDepth.value
    ));
  });

  ui.otherLabelBrightness.addEventListener("input", () => {
    updateDemoSettings(demoModel.withOtherLabelBrightnessInput(
      state.demo.settings,
      ui.otherLabelBrightness.value
    ));
  });

  ui.highlightedLabelBrightness.addEventListener("input", () => {
    updateDemoSettings(demoModel.withHighlightedLabelBrightnessInput(
      state.demo.settings,
      ui.highlightedLabelBrightness.value
    ));
  });

  ui.relationshipLineWidth.addEventListener("input", () => {
    updateDemoSettings(demoModel.withRelationshipLineWidthInput(
      state.demo.settings,
      ui.relationshipLineWidth.value
    ));
  });

  ui.relationshipBrightness.addEventListener("input", () => {
    updateDemoSettings(demoModel.withRelationshipBrightnessInput(
      state.demo.settings,
      ui.relationshipBrightness.value
    ));
  });

  ui.middleDetailDepth.addEventListener("input", () => {
    updateDemoSettings(demoModel.withMiddleDetailDepthInput(
      state.demo.settings,
      ui.middleDetailDepth.value
    ));
  });

  ui.otherDetailBrightness.addEventListener("input", () => {
    updateDemoSettings(demoModel.withOtherDetailBrightnessInput(
      state.demo.settings,
      ui.otherDetailBrightness.value
    ));
  });

  ui.highlightedDetailBrightness.addEventListener("input", () => {
    updateDemoSettings(demoModel.withHighlightedDetailBrightnessInput(
      state.demo.settings,
      ui.highlightedDetailBrightness.value
    ));
  });

  ui.floatingDetailBackdropOpacity.addEventListener("input", () => {
    updateDemoSettings(demoModel.withFloatingDetailBackdropOpacityInput(
      state.demo.settings,
      ui.floatingDetailBackdropOpacity.value
    ));
  });

  ui.nestedCompactness.addEventListener("input", () => {
    updateDemoSettings(demoModel.withNestedCompactnessInput(
      state.demo.settings,
      ui.nestedCompactness.value
    ));
  });

  ui.peripheralDepthShrink.addEventListener("input", () => {
    updateDemoSettings(demoModel.withPeripheralDepthShrinkInput(
      state.demo.settings,
      ui.peripheralDepthShrink.value
    ));
  });

  ui.nestedTunnelStrength.addEventListener("input", () => {
    updateDemoSettings(demoModel.withNestedTunnelInput(
      state.demo.settings,
      ui.nestedTunnelStrength.value
    ));
  });

  ui.nestedTunnelInteriorStrength.addEventListener("input", () => {
    updateDemoSettings(demoModel.withNestedTunnelInteriorInput(
      state.demo.settings,
      ui.nestedTunnelInteriorStrength.value
    ));
  });

  document.addEventListener("pointerdown", registerHumanInput, true);
  document.addEventListener("pointermove", registerHumanInput, true);
  document.addEventListener("wheel", registerHumanInput, { capture: true, passive: true });
  document.addEventListener("keydown", registerHumanInput, true);
  document.addEventListener("visibilitychange", () => {
    stopDemoPresentation();
    state.demo.lastInputAt = performance.now();
  });

  ui.spatialSearch.addEventListener("input", renderSearchResults);
  ui.nodeTypeEditor.addEventListener("input", () => {
    const transaction = workspace.transaction();
    if (!transaction || !["node-create", "node-edit"].includes(transaction.kind)) return;
    workspace.updateNodeDraft({
      atomTypes: ui.nodeTypeEditor.value.trim()
        ? [ui.nodeTypeEditor.value.trim().replace(/^@+/u, "")]
        : [],
      atomTypesChanged: true
    });
  });
  ui.attachmentInput.addEventListener("change", () => {
    const file = ui.attachmentInput.files && ui.attachmentInput.files[0];
    const transaction = workspace.transaction();
    if (!file || !transaction || !["node-create", "node-edit"].includes(transaction.kind)) return;
    if (state.attachmentUrl && global.URL && typeof global.URL.revokeObjectURL === "function") {
      global.URL.revokeObjectURL(state.attachmentUrl);
    }
    state.attachmentUrl = global.URL && typeof global.URL.createObjectURL === "function"
      ? global.URL.createObjectURL(file)
      : "";
    const attachment = { name: file.name, type: file.type, size: file.size, url: state.attachmentUrl };
    workspace.updateNodeDraft({ attachment });
    ui.attachmentMeta.textContent = `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB`;
    announce(`已附加 ${file.name}，按 Enter 提交`);
  });

  function renderBindings() {
    ui.bindingList.replaceChildren();
    input.describeGroups().forEach((group, groupIndex) => {
      const section = document.createElement("details");
      const summary = document.createElement("summary");
      const items = document.createElement("div");
      section.className = "binding-group";
      section.open = groupIndex === 0 || group.id === "node-edit" || group.id === "edge-edit";
      summary.textContent = group.label;
      items.className = "binding-group__items";
      group.items.forEach((item) => {
        const row = document.createElement("div");
        const name = document.createElement("span");
        const value = document.createElement("button");
        row.className = "binding-row";
        name.className = "binding-row__name";
        value.className = "binding-row__value";
        value.type = "button";
        value.dataset.editable = String(item.editable);
        name.textContent = item.label || intentNames[item.intent] || item.intent;
        value.textContent = item.binding || "未映射";
        value.disabled = !item.editable;
        if (item.editable) {
          value.addEventListener("click", () => {
            state.bindingCaptureIntent = item.intent;
            value.textContent = "按下新键位";
            value.dataset.capturing = "true";
          });
        }
        row.append(name, value);
        items.append(row);
      });
      section.append(summary, items);
      ui.bindingList.append(section);
    });
    document.querySelectorAll("[data-preset]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.preset === input.activePreset));
    });
    const preset = input.current();
    ui.hint.textContent = preset.hint;
  }

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => input.setPreset(button.dataset.preset));
  });
  global.addEventListener("spatial-input-config-changed", renderBindings);

  const reducedMotionQuery = global.matchMedia("(prefers-reduced-motion: reduce)");
  reducedMotionQuery.addEventListener("change", (event) => {
    state.reducedMotion = event.matches;
  });

  function frame(now) {
    resizeCanvas();
    state.time = now / 1000;
    updateCameraTween(now);
    renderScene();
    updateDetailMagnifier(state.pointerPosition, state.hovered);
    if (state.frameCount % 12 === 0) {
      updateMetrics();
      if (
        !state.demo.active
        && demoModel.shouldStart({
          idleSeconds: state.demo.settings.idleSeconds,
          lastInputAt: state.demo.lastInputAt,
          now: performance.now()
        })
      ) {
        startDemoPresentation();
      }
    }
    state.frameCount += 1;
    global.requestAnimationFrame(frame);
  }

  syncPresentationControls();
  setHelpPage(activeHelpPage);
  setHelpPanelVisible(state.demo.settings.helpVisible, false);
  renderBindings();
  updateSelectionUI();
  updateMetrics();
  state.viewHistory.reset(visualSnapshot());
  updateNavigationUI();
  global.requestAnimationFrame(frame);

  function requestVisualIntent(intent, visualMeta = {}) {
    if (!visualIntentSet.has(intent)) {
      return false;
    }
    return dispatchIntent(intent, grammar.sanitizeVisualMeta(intent, visualMeta) || {});
  }

  function refreshVisualRegistry() {
    if (
      state.transitionLocked
      || state.pointerCandidate
      || state.drag
      || state.cameraTween
      || state.wheelGestureActive
      || state.wheelHistoryTimer
      || primaryClickArbiter.pending
      || secondaryClickArbiter.pending
    ) {
      announce("视觉交互仍在进行，稳定后再刷新注册表");
      return false;
    }
    const snapshot = visualSnapshot();
    domainCache.clear();
    const refreshedRoot = createDomain("root", 0);
    state.nodes = state.currentPath === "root"
      ? refreshedRoot
      : createDomain(state.currentPath, state.depth);
    resetSnapshotNodeState(state.nodes);
    restoreRevealedNodes(state.nodes, snapshot.revealedIds || []);
    [
      snapshot.selectedId,
      snapshot.focusedId,
      ...(snapshot.detailLensIds || []),
      ...(snapshot.surfaceIds || []),
      ...(snapshot.detailModes || []).map((entry) => entry.id)
    ].forEach((id) => hydrateNodePath(state.nodes, id));
    state.selected = findExistingNode(state.nodes, snapshot.selectedId);
    state.focused = findExistingNode(state.nodes, snapshot.focusedId);
    state.hovered = null;
    state.menuFor = null;
    state.prefetchedDomain = null;
    state.worldLens = { ...snapshot.worldLens };
    const detailLensIds = new Set(snapshot.detailLensIds || []);
    const surfaceIds = new Set(snapshot.surfaceIds || []);
    const detailModes = new Map((snapshot.detailModes || []).map((entry) => [entry.id, entry.mode]));
    const surfaceOpenedAt = performance.now();
    for (const node of existingNodes(state.nodes)) {
      node.lensOpen = detailLensIds.has(node.id);
      node.surfaceVisible = surfaceIds.has(node.id);
      node.detailMode = detailModes.get(node.id) || (node.surfaceVisible ? "surface" : "floating");
      node.surfaceOpenedAt = node.surfaceVisible ? surfaceOpenedAt : 0;
    }
    state.rendered = [];
    state.hitRegions = [];
    state.ambiguity = [];
    state.viewHistory.reset(visualSnapshot());
    updateSelectionUI();
    updateNavigationUI();
    announce(`视觉注册表已刷新，共 ${registry.list().length} 个实体定义`);
    return true;
  }

  function visualVerificationState() {
    const nodes = existingNodes(state.nodes);
    const visibleNodes = Array.from(new Map(
      state.rendered
        .filter((item) => item.kind === "node" && item.node)
        .map((item) => [item.node.id, item.node])
    ).values()).slice(0, 32);
    return {
      surfaceVisible: nodes.filter((node) => node.surfaceVisible).length,
      revealed: nodes.filter((node) => node.revealed).map((node) => node.id),
      visibleNodeDescriptors: visibleNodes.map((node) => ({
        id: node.id,
        label: node.label,
        ownerPath: node.__clusterOwnerPath || node.workspacePath || state.currentPath,
        hasChildren: node.hasChildren === true,
        surfaceVisible: node.surfaceVisible === true
      }))
    };
  }

  function exportFieldProjection() {
    const nodes = existingNodes(currentDomainNodes()).map((node) => ({
      key: `${state.currentPath}::${node.id}`,
      id: node.id,
      path: state.currentPath,
      label: node.label,
      detail: node.description || "",
      carrier: "tunnel",
      hasSeededChildren: node.hasChildren === true,
      surfaceVisible: node.surfaceVisible === true,
      revealed: node.revealed === true,
      isWorkspaceNode: node.isWorkspaceNode === true
    }));
    return {
      path: state.currentPath,
      pathLabels: [...state.crumbs],
      depth: state.depth,
      selection: state.selected ? `${state.currentPath}::${state.selected.id}` : null,
      camera: cameraSnapshot(),
      phase: currentInteractionPhase(),
      nodes,
      edges: workspace.edgesForPath(state.currentPath)
    };
  }

  function importKnowledge(knowledge, options) {
    options = options && typeof options === "object" ? options : {};
    const identityTransitions = Array.isArray(options.identityTransitions)
      ? options.identityTransitions
      : [];
    const selectedPath = state.selected ? nodeOwnerPath(state.selected) : "";
    const selectedId = state.selected && state.selected.id;
    const focusedPath = state.focused ? nodeOwnerPath(state.focused) : "";
    const focusedId = state.focused && state.focused.id;
    const middleLabelFocus = state.middleLabelFocus;
    const middleDetailFocus = state.middleDetailFocus;
    const selectedIdentity = workspaceModel.remapIdentity(
      { path: selectedPath, id: selectedId },
      identityTransitions
    );
    const focusedIdentity = workspaceModel.remapIdentity(
      { path: focusedPath, id: focusedId },
      identityTransitions
    );
    if (!workspace.importKnowledge(knowledge)) return false;
    cleanupOrphanedDemoKnowledge();
    state.hovered = null;
    currentDomainNodes();
    const resolveImportedNode = ({ path, id }) => nodeByIdInPath(path, id);
    state.rendered = workspaceModel.reconcileVisualItems(
      state.rendered,
      identityTransitions,
      resolveImportedNode
    );
    state.hitRegions = workspaceModel.reconcileVisualItems(
      state.hitRegions,
      identityTransitions,
      resolveImportedNode
    );
    state.relationHitRegions = [];
    state.selected = selectedIdentity ? resolveImportedNode(selectedIdentity) : null;
    state.focused = focusedIdentity ? resolveImportedNode(focusedIdentity) : null;
    const focusSurvives = (focus) => Boolean(
      focus
      && (focus.kind !== "node" || visualEntryForKey(focus.anchorKey))
    );
    state.middleLabelFocus = focusSurvives(middleLabelFocus) ? middleLabelFocus : null;
    state.middleDetailFocus = focusSurvives(middleDetailFocus) ? middleDetailFocus : null;
    renderSearchResults();
    updateSelectionUI();
    return true;
  }

  function mermaidTarget() {
    if (!state.selected) {
      return Object.freeze({
        path: "root",
        parentKey: null,
        parentLabel: "全局顶层",
        selectedKey: null,
        requiresConfirmation: true
      });
    }
    const parentPath = nodeOwnerPath(state.selected, state.currentPath || "root");
    return Object.freeze({
      path: childPathFor(state.selected, parentPath),
      parentKey: `${parentPath}::${state.selected.id}`,
      parentLabel: state.selected.label,
      selectedKey: state.selected.isWorkspaceNode ? `${parentPath}::${state.selected.id}` : null,
      requiresConfirmation: false
    });
  }

  function knowledgeRouteForPath(targetPath) {
    if (targetPath === "root") return { entries: [], labels: ["全域"] };
    const nodes = workspace.exportKnowledge().nodes;
    const lineage = [];
    let path = targetPath;
    while (path !== "root") {
      const parent = nodes.find((node) => childPathFor(node, node.path) === path);
      if (!parent || lineage.length > 64) return null;
      lineage.unshift(parent);
      path = parent.path;
    }
    const labels = ["全域"];
    const entries = lineage.map((node, depth) => {
      const entry = {
        path: node.path,
        crumbs: [...labels],
        depth,
        camera: {
          target: { x: 0, y: 0, z: 0 },
          yaw: camera.yaw,
          pitch: camera.pitch,
          distance: NORMAL_FIELD_DISTANCE
        },
        entryDirection: { yaw: camera.yaw, pitch: camera.pitch },
        entryNearDistance: 1.25,
        childFarDistance: NORMAL_FIELD_DISTANCE,
        nodeId: node.id,
        nodeLabel: node.label
      };
      labels.push(node.label);
      return entry;
    });
    return { entries, labels };
  }

  function locateKnowledgeNode(key) {
    const separator = typeof key === "string" ? key.lastIndexOf("::") : -1;
    if (separator <= 0) return false;
    const path = key.slice(0, separator);
    const id = key.slice(separator + 2);
    if (path !== state.currentPath) {
      const route = knowledgeRouteForPath(path);
      if (!route) return false;
      recordCurrentView();
      state.currentPath = path;
      state.domainStack = cloneDomainStack(route.entries);
      state.depth = route.entries.length;
      state.crumbs = [...route.labels];
      domainCache.set(path, []);
      state.nodes = domainCache.get(path);
      state.selected = null;
      state.focused = null;
      state.hovered = null;
      state.menuFor = null;
      rememberDomainRoute(path, state.domainStack);
      if (state.clusterFieldOpen) buildClusterScene();
    }
    const node = nodeByIdInPath(path, id);
    if (!node) return false;
    node.__clusterOwnerPath = path;
    selectNode(node);
    state.focused = null;
    state.locatedNodeId = node.id;
    state.locatedUntil = performance.now() + (state.reducedMotion ? 150 : 1400);
    updateSelectionUI();
    return true;
  }

  function replaceKnowledge(knowledge) {
    if (!importKnowledge(knowledge)) return false;
    persistWorkspaceSnapshot("mermaid-import");
    announce("Mermaid 已载入当前视图，未写入 Atom 事实");
    return true;
  }

  global.spatialLab = Object.freeze({
    dispatch: requestVisualIntent,
    requestVisualIntent,
    state: () => ({
      depth: state.depth,
      path: state.currentPath,
      selected: state.selected ? state.selected.id : null,
      focused: state.focused ? state.focused.id : null,
      visibleNodes: state.rendered.filter((item) => item.kind === "node").length,
      inputPreset: input.activePreset,
      phase: currentInteractionPhase(),
      transactionActive: Boolean(workspace.transaction()),
      semanticStage: state.selected ? state.selected.semanticStage : null,
      worldLensOpen: state.worldLens.open,
      clusterFieldOpen: state.clusterFieldOpen,
      viewMode: state.viewMode,
      wandHighEnergy: state.wand.highEnergy,
      wandPendingTargets: state.wand.pendingKeys.length,
      clusterCount: state.clusterFieldOpen ? state.clusterScene.clusters.length : 1,
      activeClusterPath: state.currentPath,
      clusterPaths: state.clusterFieldOpen ? state.clusterScene.clusters.map((cluster) => cluster.path) : [state.currentPath],
      clusterTargets: state.clusterFieldOpen
        ? state.rendered.filter((item) => item.kind === "node" && item.ownerPath).slice(0, 96).map((item) => ({
          path: item.ownerPath,
          id: item.node.id,
          label: item.node.label,
          x: item.screen.x,
          y: item.screen.y,
          radius: item.screen.radius
        }))
        : [],
      viewHistory: {
        size: state.viewHistory.size,
        cursor: state.viewHistory.cursor,
        canBack: state.viewHistory.canBack,
        canForward: state.viewHistory.canForward
      },
      domainCacheSize: domainCache.size,
      registry: {
        definitions: registry.list().length,
        rootDefinitions: registry.rootDefinitions().length,
        commands: registry.listCommands().length
      },
      camera: cameraSnapshot(),
      ...visualVerificationState()
    }),
    selectByLabel(label) {
      const node = existingNodes(currentDomainNodes())
        .find((candidate) => candidate.label === label);
      if (node) {
        selectNode(node);
      }
      return Boolean(node);
    },
    exportField: exportFieldProjection,
    exportKnowledge: () => workspace.exportKnowledge(),
    importKnowledge,
    mermaidTarget,
    locateKnowledgeNode,
    replaceKnowledge,
    refreshVisualRegistry,
    registry,
    input
  });
})(window);
