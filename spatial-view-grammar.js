(function spatialViewGrammar(global) {
  "use strict";

  const SEMANTIC_STAGES = Object.freeze({
    beacon: "beacon",
    identity: "identity",
    preview: "preview",
    interior: "interior"
  });

  const SEMANTIC_STAGE_ORDER = Object.freeze([
    SEMANTIC_STAGES.beacon,
    SEMANTIC_STAGES.identity,
    SEMANTIC_STAGES.preview,
    SEMANTIC_STAGES.interior
  ]);

  const DEFAULT_SEMANTIC_THRESHOLDS = Object.freeze({
    identity: 12,
    preview: 28,
    interior: 72,
    hysteresis: 3
  });

  const INTERACTION_PHASES = Object.freeze({
    idle: "idle",
    aim: "aim",
    focus: "focus",
    preview: "preview",
    commit: "commit",
    manipulate: "manipulate"
  });

  const INTERACTION_PHASE_LABELS = Object.freeze({
    [INTERACTION_PHASES.idle]: "待机",
    [INTERACTION_PHASES.aim]: "指向",
    [INTERACTION_PHASES.focus]: "聚焦",
    [INTERACTION_PHASES.preview]: "预览",
    [INTERACTION_PHASES.commit]: "确认",
    [INTERACTION_PHASES.manipulate]: "操纵"
  });

  const INTERACTION_TRANSITIONS = Object.freeze({
    [INTERACTION_PHASES.idle]: Object.freeze([
      INTERACTION_PHASES.aim,
      INTERACTION_PHASES.focus,
      INTERACTION_PHASES.commit
    ]),
    [INTERACTION_PHASES.aim]: Object.freeze([
      INTERACTION_PHASES.idle,
      INTERACTION_PHASES.focus,
      INTERACTION_PHASES.preview,
      INTERACTION_PHASES.commit,
      INTERACTION_PHASES.manipulate
    ]),
    [INTERACTION_PHASES.focus]: Object.freeze([
      INTERACTION_PHASES.idle,
      INTERACTION_PHASES.aim,
      INTERACTION_PHASES.preview,
      INTERACTION_PHASES.commit,
      INTERACTION_PHASES.manipulate
    ]),
    [INTERACTION_PHASES.preview]: Object.freeze([
      INTERACTION_PHASES.idle,
      INTERACTION_PHASES.aim,
      INTERACTION_PHASES.focus,
      INTERACTION_PHASES.commit,
      INTERACTION_PHASES.manipulate
    ]),
    [INTERACTION_PHASES.commit]: Object.freeze([
      INTERACTION_PHASES.idle,
      INTERACTION_PHASES.aim,
      INTERACTION_PHASES.focus,
      INTERACTION_PHASES.preview
    ]),
    [INTERACTION_PHASES.manipulate]: Object.freeze([
      INTERACTION_PHASES.idle,
      INTERACTION_PHASES.focus,
      INTERACTION_PHASES.preview
    ])
  });

  const FOCUS_RELATIONS = Object.freeze({
    focused: "focused",
    direct: "direct",
    ancestor: "ancestor",
    sibling: "sibling",
    distant: "distant",
    tool: "tool"
  });

  const FOCUS_CONTEXT_WEIGHTS = Object.freeze({
    [FOCUS_RELATIONS.focused]: 1,
    [FOCUS_RELATIONS.direct]: 0.82,
    [FOCUS_RELATIONS.ancestor]: 0.7,
    [FOCUS_RELATIONS.sibling]: 0.6,
    [FOCUS_RELATIONS.distant]: 0.32,
    [FOCUS_RELATIONS.tool]: 0.92
  });

  const VISUAL_SNAPSHOT_KEYS = Object.freeze([
    "path",
    "depth",
    "crumbs",
    "camera",
    "selectedId",
    "focusedId",
    "worldLens",
    "clusterFieldOpen",
    "viewMode",
    "expandedClusters",
    "revealedIds",
    "detailLensIds",
    "surfaceIds"
  ]);
  const VIEW_MODES = Object.freeze(["immersive", "peripheral", "nested", "hierarchy"]);
  const VISUAL_GESTURE_PHASES = Object.freeze(["start", "move", "end", "cancel"]);

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function finiteVisualNumber(value, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return null;
    }
    return clamp(number, minimum, maximum);
  }

  function sanitizeVisualMeta(intent, visualMetaInput) {
    const source = visualMetaInput && typeof visualMetaInput === "object" ? visualMetaInput : {};
    const visualMeta = {};
    if (
      Number.isInteger(source.confirmationCount)
      && source.confirmationCount >= 1
      && source.confirmationCount <= 3
    ) {
      visualMeta.confirmationCount = source.confirmationCount;
    }
    if (intent === "orbit") {
      const dx = finiteVisualNumber(source.dx, -4096, 4096);
      const dy = finiteVisualNumber(source.dy, -4096, 4096);
      if (dx !== null) visualMeta.dx = dx;
      if (dy !== null) visualMeta.dy = dy;
    } else if (intent === "dolly") {
      const delta = finiteVisualNumber(source.delta, -4096, 4096);
      if (delta !== null) visualMeta.delta = delta;
    } else if (intent === "exitToDepth") {
      const targetDepth = finiteVisualNumber(source.targetDepth, 0, 1024);
      if (targetDepth !== null) visualMeta.targetDepth = Math.trunc(targetDepth);
    } else if (
      (intent === "grab" || intent === "release")
      && VISUAL_GESTURE_PHASES.includes(source.phase)
    ) {
      visualMeta.phase = source.phase;
    }
    return Object.keys(visualMeta).length ? Object.freeze(visualMeta) : null;
  }

  function resolveOrbitDragDelta(input) {
    const source = input && typeof input === "object" ? input : {};
    const dx = finiteVisualNumber(source.dx, -4096, 4096) ?? 0;
    const dy = finiteVisualNumber(source.dy, -4096, 4096) ?? 0;
    const totalDx = finiteVisualNumber(source.totalDx, -16384, 16384) ?? dx;
    const totalDy = finiteVisualNumber(source.totalDy, -16384, 16384) ?? dy;
    let axisLock = source.axisLock === "horizontal" || source.axisLock === "vertical"
      ? source.axisLock
      : null;

    if (!axisLock && Math.hypot(totalDx, totalDy) >= 12) {
      const horizontalTravel = Math.abs(totalDx);
      const verticalTravel = Math.abs(totalDy);
      if (horizontalTravel >= verticalTravel * 1.6) {
        axisLock = "horizontal";
      } else if (verticalTravel >= horizontalTravel * 1.6) {
        axisLock = "vertical";
      }
    }

    return Object.freeze({
      dx: axisLock === "vertical" ? 0 : dx,
      dy: axisLock === "horizontal" ? 0 : dy,
      axisLock
    });
  }

  function smoothstep(value) {
    const amount = clamp(value, 0, 1);
    return amount * amount * (3 - 2 * amount);
  }

  function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function normalizeThresholds(options) {
    const source = options || {};
    const identity = Math.max(0, finiteNumber(source.identity, DEFAULT_SEMANTIC_THRESHOLDS.identity));
    const preview = Math.max(identity + 1, finiteNumber(source.preview, DEFAULT_SEMANTIC_THRESHOLDS.preview));
    const interior = Math.max(preview + 1, finiteNumber(source.interior, DEFAULT_SEMANTIC_THRESHOLDS.interior));
    const maximumHysteresis = Math.max(0, Math.min((preview - identity) / 2, (interior - preview) / 2));
    const hysteresis = clamp(
      finiteNumber(source.hysteresis, DEFAULT_SEMANTIC_THRESHOLDS.hysteresis),
      0,
      maximumHysteresis
    );
    return { identity, preview, interior, hysteresis };
  }

  function isSemanticStage(stage) {
    return SEMANTIC_STAGE_ORDER.includes(stage);
  }

  function rawSemanticStage(projectedRadius, thresholds) {
    if (projectedRadius >= thresholds.interior) {
      return SEMANTIC_STAGES.interior;
    }
    if (projectedRadius >= thresholds.preview) {
      return SEMANTIC_STAGES.preview;
    }
    if (projectedRadius >= thresholds.identity) {
      return SEMANTIC_STAGES.identity;
    }
    return SEMANTIC_STAGES.beacon;
  }

  function resolveSemanticStage(projectedRadius, previousStage, options) {
    const radius = Math.max(0, finiteNumber(projectedRadius, 0));
    const thresholds = normalizeThresholds(options);
    if (!isSemanticStage(previousStage)) {
      return rawSemanticStage(radius, thresholds);
    }

    const boundaries = [thresholds.identity, thresholds.preview, thresholds.interior];
    let stageIndex = SEMANTIC_STAGE_ORDER.indexOf(previousStage);

    while (
      stageIndex < SEMANTIC_STAGE_ORDER.length - 1
      && radius >= boundaries[stageIndex] + thresholds.hysteresis
    ) {
      stageIndex += 1;
    }
    while (
      stageIndex > 0
      && radius < boundaries[stageIndex - 1] - thresholds.hysteresis
    ) {
      stageIndex -= 1;
    }
    return SEMANTIC_STAGE_ORDER[stageIndex];
  }

  function revealAmount(radius, threshold, band) {
    return smoothstep((radius - (threshold - band)) / Math.max(1, band * 2));
  }

  function resolveSemanticProfile(projectedRadius, previousStage, options) {
    const radius = Math.max(0, finiteNumber(projectedRadius, 0));
    const thresholds = normalizeThresholds(options);
    const stage = resolveSemanticStage(radius, previousStage, thresholds);
    const transitionBand = Math.max(2, thresholds.hysteresis * 2);
    return Object.freeze({
      stage,
      index: SEMANTIC_STAGE_ORDER.indexOf(stage),
      projectedRadius: radius,
      reveal: Object.freeze({
        identity: revealAmount(radius, thresholds.identity, transitionBand),
        preview: revealAmount(radius, thresholds.preview, transitionBand),
        interior: revealAmount(radius, thresholds.interior, transitionBand)
      })
    });
  }

  function interactionPhaseLabel(phase) {
    return INTERACTION_PHASE_LABELS[phase] || INTERACTION_PHASE_LABELS[INTERACTION_PHASES.idle];
  }

  function canTransitionInteraction(fromPhase, toPhase) {
    if (fromPhase === toPhase) {
      return true;
    }
    const allowed = INTERACTION_TRANSITIONS[fromPhase] || INTERACTION_TRANSITIONS[INTERACTION_PHASES.idle];
    return allowed.includes(toPhase);
  }

  function resolveFocusContext(relation, focusActive, overrides) {
    const normalizedRelation = Object.values(FOCUS_RELATIONS).includes(relation)
      ? relation
      : FOCUS_RELATIONS.distant;
    const customWeights = overrides || {};
    const baseWeight = finiteNumber(customWeights[normalizedRelation], FOCUS_CONTEXT_WEIGHTS[normalizedRelation]);
    const weight = focusActive === false ? 1 : clamp(baseWeight, 0, 1);
    return Object.freeze({
      relation: normalizedRelation,
      weight,
      sphereAlpha: 0.3 + weight * 0.7,
      connectionAlpha: 0.18 + weight * 0.82,
      labelWeight: 0.12 + smoothstep(weight) * 0.88,
      hitPriority: Math.round(weight * 100)
    });
  }

  function normalizeVector(vector) {
    const source = vector || {};
    return {
      x: finiteNumber(source.x, 0),
      y: finiteNumber(source.y, 0),
      z: finiteNumber(source.z, 0)
    };
  }

  function normalizeCamera(camera) {
    const source = camera || {};
    const normalized = {
      target: normalizeVector(source.target),
      yaw: finiteNumber(source.yaw, 0),
      pitch: finiteNumber(source.pitch, 0),
      distance: Math.max(0.001, finiteNumber(source.distance, 1))
    };
    if (Number.isFinite(source.fov)) {
      normalized.fov = source.fov;
    }
    return normalized;
  }

  function normalizeId(value) {
    return typeof value === "string" && value.length ? value : null;
  }

  function normalizeUniqueIds(values, limit) {
    if (!Array.isArray(values)) {
      return [];
    }
    const ids = [];
    for (const value of values) {
      const id = normalizeId(value);
      if (!id || ids.includes(id)) {
        continue;
      }
      ids.push(id);
      if (ids.length === limit) {
        break;
      }
    }
    return ids;
  }

  function normalizeClusterBranches(values) {
    if (!Array.isArray(values)) {
      return [];
    }
    const branches = [];
    const paths = new Set();
    for (const value of values) {
      if (!value || typeof value.path !== "string" || !value.path || paths.has(value.path)) {
        continue;
      }
      const parentPath = typeof value.parentPath === "string" && value.parentPath
        ? value.parentPath
        : null;
      const parentNodeId = normalizeId(value.parentNodeId);
      if (!parentPath || !parentNodeId) {
        continue;
      }
      paths.add(value.path);
      const branch = {
        path: value.path,
        depth: Math.max(1, Math.floor(finiteNumber(value.depth, 1))),
        label: typeof value.label === "string" ? value.label : "",
        pathLabels: Array.isArray(value.pathLabels)
          ? value.pathLabels.filter((item) => typeof item === "string").slice(0, 64)
          : [],
        parentPath,
        parentNodeId
      };
      if (Object.prototype.hasOwnProperty.call(value, "projectionMode")) {
        branch.projectionMode = value.projectionMode === "nested" ? "nested" : "hierarchy";
      }
      branches.push(branch);
      if (branches.length === 64) {
        break;
      }
    }
    return branches;
  }

  function normalizeVisualSnapshot(snapshot) {
    const source = snapshot || {};
    const worldLens = source.worldLens || {};
    return {
      path: typeof source.path === "string" ? source.path : "root",
      depth: Math.max(0, Math.floor(finiteNumber(source.depth, 0))),
      crumbs: Array.isArray(source.crumbs)
        ? source.crumbs.filter((item) => typeof item === "string").slice(0, 64)
        : [],
      camera: normalizeCamera(source.camera),
      selectedId: normalizeId(source.selectedId),
      focusedId: normalizeId(source.focusedId),
      worldLens: {
        open: Boolean(worldLens.open),
        scope: worldLens.scope === "root" ? "root" : "current"
      },
      clusterFieldOpen: Boolean(source.clusterFieldOpen),
      viewMode: VIEW_MODES.includes(source.viewMode) ? source.viewMode : "nested",
      expandedClusters: normalizeClusterBranches(source.expandedClusters),
      revealedIds: normalizeUniqueIds(source.revealedIds, 64),
      detailLensIds: Array.isArray(source.detailLensIds)
        ? source.detailLensIds.map(normalizeId).filter(Boolean).slice(0, 2)
        : [],
      surfaceIds: normalizeUniqueIds(source.surfaceIds, 64)
    };
  }

  function cloneVisualSnapshot(snapshot) {
    return normalizeVisualSnapshot(snapshot);
  }

  function snapshotSignature(snapshot) {
    return JSON.stringify(normalizeVisualSnapshot(snapshot));
  }

  class ViewHistory {
    constructor(options) {
      const configuredLimit = typeof options === "number" ? options : options && options.limit;
      this._limit = clamp(Math.floor(finiteNumber(configuredLimit, 40)), 2, 128);
      this._entries = [];
      this._cursor = -1;
    }

    get limit() {
      return this._limit;
    }

    get size() {
      return this._entries.length;
    }

    get cursor() {
      return this._cursor;
    }

    get canBack() {
      return this._cursor > 0;
    }

    get canForward() {
      return this._cursor >= 0 && this._cursor < this._entries.length - 1;
    }

    current() {
      return this._cursor >= 0 ? cloneVisualSnapshot(this._entries[this._cursor]) : null;
    }

    push(snapshot, options) {
      const entry = normalizeVisualSnapshot(snapshot);
      const replace = Boolean(options && options.replace);
      if (replace && this._cursor >= 0) {
        this._entries[this._cursor] = entry;
        return this.current();
      }
      if (
        this._cursor >= 0
        && snapshotSignature(entry) === snapshotSignature(this._entries[this._cursor])
      ) {
        return this.current();
      }
      if (this.canForward) {
        this._entries.splice(this._cursor + 1);
      }
      this._entries.push(entry);
      if (this._entries.length > this._limit) {
        this._entries.splice(0, this._entries.length - this._limit);
      }
      this._cursor = this._entries.length - 1;
      return this.current();
    }

    replace(snapshot) {
      return this.push(snapshot, { replace: true });
    }

    back() {
      if (!this.canBack) {
        return null;
      }
      this._cursor -= 1;
      return this.current();
    }

    forward() {
      if (!this.canForward) {
        return null;
      }
      this._cursor += 1;
      return this.current();
    }

    reset(initialSnapshot) {
      this._entries.length = 0;
      this._cursor = -1;
      return initialSnapshot ? this.push(initialSnapshot) : null;
    }

    entries() {
      return this._entries.map(cloneVisualSnapshot);
    }
  }

  function createViewHistory(options) {
    return new ViewHistory(options);
  }

  global.SpatialViewGrammar = Object.freeze({
    version: "0.3.0",
    semanticStages: SEMANTIC_STAGES,
    semanticStageOrder: SEMANTIC_STAGE_ORDER,
    semanticThresholds: DEFAULT_SEMANTIC_THRESHOLDS,
    interactionPhases: INTERACTION_PHASES,
    interactionPhaseLabels: INTERACTION_PHASE_LABELS,
    interactionTransitions: INTERACTION_TRANSITIONS,
    focusRelations: FOCUS_RELATIONS,
    focusContextWeights: FOCUS_CONTEXT_WEIGHTS,
    visualSnapshotKeys: VISUAL_SNAPSHOT_KEYS,
    isSemanticStage,
    resolveSemanticStage,
    resolveSemanticProfile,
    interactionPhaseLabel,
    canTransitionInteraction,
    sanitizeVisualMeta,
    resolveOrbitDragDelta,
    resolveFocusContext,
    normalizeVisualSnapshot,
    createViewHistory
  });
})(window);
