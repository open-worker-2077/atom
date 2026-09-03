(function spatialViewModeModel(global) {
  "use strict";

  const MODES = Object.freeze(["immersive", "peripheral", "nested", "hierarchy"]);
  const MODE_LABELS = Object.freeze({
    immersive: "沉浸",
    peripheral: "外围",
    nested: "内包",
    hierarchy: "层级"
  });
  const KEY_MODES = Object.freeze({
    KeyA: "nested",
    KeyS: "peripheral",
    KeyD: "hierarchy",
    KeyF: "immersive"
  });

  function nextMode(mode) {
    const index = MODES.indexOf(mode);
    return MODES[(index < 0 ? 0 : index + 1) % MODES.length];
  }

  function modeForKey(code) {
    return KEY_MODES[code] || null;
  }

  function isShiftKeyEvent(eventInput) {
    const event = eventInput || {};
    return event.code === "ShiftLeft"
      || event.code === "ShiftRight"
      || event.key === "Shift";
  }

  function pointDistance(left, right) {
    return Math.hypot((right.x || 0) - (left.x || 0), (right.y || 0) - (left.y || 0));
  }

  function pointToSegmentDistance(point, start, end) {
    const dx = (end.x || 0) - (start.x || 0);
    const dy = (end.y || 0) - (start.y || 0);
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 0.000001) return pointDistance(point, start);
    const ratio = Math.max(0, Math.min(1, (
      ((point.x || 0) - (start.x || 0)) * dx
      + ((point.y || 0) - (start.y || 0)) * dy
    ) / lengthSquared));
    return Math.hypot(
      (point.x || 0) - ((start.x || 0) + dx * ratio),
      (point.y || 0) - ((start.y || 0) + dy * ratio)
    );
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
      const a = polygon[current];
      const b = polygon[previous];
      const crosses = ((a.y > point.y) !== (b.y > point.y))
        && point.x < ((b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 0.000001) + a.x);
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function trailTouches(region, points, padding) {
    const point = { x: Number(region.x) || 0, y: Number(region.y) || 0 };
    const threshold = Math.max(0, Number(region.radius) || 0) + padding;
    if (points.length === 1) return pointDistance(point, points[0]) <= threshold;
    for (let index = 1; index < points.length; index += 1) {
      if (pointToSegmentDistance(point, points[index - 1], points[index]) <= threshold) return true;
    }
    return false;
  }

  function resolveStrokeTargets(pointsInput, regionsInput, optionsInput = {}) {
    const points = Array.isArray(pointsInput)
      ? pointsInput.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
      : [];
    const regions = Array.isArray(regionsInput) ? regionsInput : [];
    const closeDistance = Math.max(1, Number(optionsInput.closeDistance) || 18);
    const hitPadding = Math.max(0, Number(optionsInput.hitPadding) || 0);
    const closed = points.length >= 4 && pointDistance(points[0], points.at(-1)) <= closeDistance;
    const keys = [];
    const selected = new Set();
    for (const region of regions) {
      if (!region || region.key === undefined || region.key === null) continue;
      const hit = trailTouches(region, points, hitPadding)
        || (closed && pointInPolygon({ x: Number(region.x) || 0, y: Number(region.y) || 0 }, points));
      if (!hit || selected.has(region.key)) continue;
      selected.add(region.key);
      keys.push(region.key);
    }
    return Object.freeze({
      closed,
      keys: Object.freeze(keys),
      glowDurationMs: closed ? 500 : 0
    });
  }

  function resolveShiftTap(stateInput, nowInput, windowMsInput = 6500) {
    const state = stateInput || {};
    const now = Math.max(0, Number(nowInput) || 0);
    const lastTapAt = Math.max(0, Number(state.lastTapAt) || 0);
    const priorTapCount = Math.max(0, Number(state.tapCount) || 0);
    const windowMs = Math.max(240, Number(windowMsInput) || 6500);
    const withinWindow = lastTapAt > 0 && now >= lastTapAt && now - lastTapAt <= windowMs;
    const tapCount = withinWindow ? priorTapCount + 1 : 1;
    if (tapCount >= 3) {
      return Object.freeze({
        highEnergy: Boolean(state.highEnergy),
        lastTapAt: 0,
        tapCount: 0,
        toggled: false,
        triple: true
      });
    }
    return Object.freeze({
      highEnergy: Boolean(state.highEnergy),
      lastTapAt: now,
      tapCount,
      toggled: false
    });
  }

  function orientation(a, b, c) {
    return ((b.x - a.x) * (c.y - a.y)) - ((b.y - a.y) * (c.x - a.x));
  }

  function segmentsCross(a, b, c, d) {
    const abC = orientation(a, b, c);
    const abD = orientation(a, b, d);
    const cdA = orientation(c, d, a);
    const cdB = orientation(c, d, b);
    return abC * abD < 0 && cdA * cdB < 0;
  }

  function classifyStrokeGesture(pointsInput, optionsInput = {}) {
    const points = Array.isArray(pointsInput)
      ? pointsInput.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
      : [];
    const closeDistance = Math.max(1, Number(optionsInput.closeDistance) || 24);
    const closed = points.length >= 4 && pointDistance(points[0], points.at(-1)) <= closeDistance;
    let intersections = 0;
    for (let left = 1; left < points.length; left += 1) {
      for (let right = left + 2; right < points.length; right += 1) {
        if (left === 1 && right === points.length - 1) continue;
        if (segmentsCross(points[left - 1], points[left], points[right - 1], points[right])) {
          intersections += 1;
        }
      }
    }
    return Object.freeze({
      kind: closed && intersections >= 4 ? "star" : closed ? "loop" : "stroke",
      closed,
      intersections
    });
  }

  function planRecursiveTargets(startKeysInput, childrenFor) {
    const starts = Array.isArray(startKeysInput) ? startKeysInput : [];
    const result = [];
    const visited = new Set();
    const visit = (key) => {
      if (key === undefined || key === null || visited.has(key)) return;
      visited.add(key);
      result.push(key);
      const children = typeof childrenFor === "function" ? childrenFor(key) : [];
      for (const child of Array.isArray(children) ? children : []) visit(child);
    };
    for (const key of starts) visit(key);
    return Object.freeze(result);
  }

  function planPeerBatch(regionsInput, pointInput, fallbackOwnerPathInput) {
    const point = pointInput
      && Number.isFinite(Number(pointInput.x))
      && Number.isFinite(Number(pointInput.y))
      ? pointInput
      : null;
    const regions = (Array.isArray(regionsInput) ? regionsInput : [])
      .filter((region) => (
        region
        && region.key !== undefined
        && region.ownerPath
        && region.clusterShellProxy !== true
      ));
    const target = point ? regions
      .map((region) => ({
        region,
        radius: Math.max(1, Number(region.radius) || 0),
        distance: pointDistance(point, region)
      }))
      .filter((entry) => entry.distance <= entry.radius * 1.14)
      .sort((left, right) => (
        left.distance / left.radius - right.distance / right.radius
        || left.radius - right.radius
      ))[0] : null;
    if (!target) {
      const fallbackOwnerPath = typeof fallbackOwnerPathInput === "string"
        ? fallbackOwnerPathInput
        : "";
      const contextRegions = regions.filter((region) => region.ownerPath === fallbackOwnerPath);
      if (!contextRegions.length) return Object.freeze([]);
      const level = Math.min(...contextRegions.map((region) => Number(region.level) || 0));
      return Object.freeze(contextRegions
        .filter((region) => (Number(region.level) || 0) === level)
        .map((region) => region.key));
    }
    return Object.freeze(regions
      .filter((region) => (
        region.ownerPath === target.region.ownerPath
        && Number(region.level) === Number(target.region.level)
      ))
      .map((region) => region.key));
  }

  function toggleSelectionKey(selectionInput, key) {
    const selected = new Set(Array.isArray(selectionInput) ? selectionInput : selectionInput || []);
    if (selected.has(key)) selected.delete(key);
    else if (key !== undefined && key !== null) selected.add(key);
    return Object.freeze([...selected]);
  }

  function planViewTargets(mode, clickedKey, selectionInput) {
    if (clickedKey === undefined || clickedKey === null) return Object.freeze([]);
    if (mode === 'immersive') return Object.freeze([clickedKey]);
    var selected = Array.from(new Set(Array.isArray(selectionInput) ? selectionInput : selectionInput || []));
    return Object.freeze(selected.length ? selected : [clickedKey]);
  }

  function cloneRouteEntry(entryInput) {
    const entry = entryInput || {};
    return Object.freeze({
      ...entry,
      crumbs: Array.isArray(entry.crumbs) ? Object.freeze([...entry.crumbs]) : entry.crumbs,
      camera: entry.camera ? Object.freeze({
        ...entry.camera,
        target: entry.camera.target ? Object.freeze({ ...entry.camera.target }) : entry.camera.target
      }) : entry.camera,
      entryDirection: entry.entryDirection
        ? Object.freeze({ ...entry.entryDirection })
        : entry.entryDirection
    });
  }

  function resolveImmersiveOwnerContext(input = {}) {
    const currentPath = typeof input.currentPath === "string" ? input.currentPath : "";
    const ownerPath = typeof input.ownerPath === "string" ? input.ownerPath : "";
    if (!ownerPath) return null;

    const isCurrentOwner = ownerPath === currentPath;
    const sourceStack = isCurrentOwner ? input.currentStack : input.ownerRoute;
    const crumbs = isCurrentOwner ? input.currentCrumbs : input.ownerCrumbs;
    if (!Array.isArray(sourceStack) || !Array.isArray(crumbs)) return null;

    return Object.freeze({
      path: ownerPath,
      depth: isCurrentOwner
        ? Math.max(0, Number(input.currentDepth) || 0)
        : sourceStack.length,
      crumbs: Object.freeze([...crumbs]),
      stack: Object.freeze(sourceStack.map(cloneRouteEntry))
    });
  }

  function clusterDomainFrame(clusterInput, optionsInput) {
    var cluster = clusterInput || {};
    var options = optionsInput || {};
    var center = cluster.center || { x: 0, y: 0, z: 0 };
    var radius = Math.max(0.001, Number(cluster.radius) || 0);
    var fov = Math.max(0.1, Number(options.fov) || Math.PI / 3);
    var aspect = Math.max(0.1, Number(options.aspect) || 1);
    var verticalTangent = Math.tan(fov / 2);
    var limitingTangent = Math.max(0.05, Math.min(verticalTangent, verticalTangent * aspect));
    var minimumDistance = Math.max(0.01, Number(options.minimumDistance) || 0.04);
    var maximumDistance = Math.max(minimumDistance, Number(options.maximumDistance) || 25200);
    return Object.freeze({
      target: Object.freeze({ x: center.x, y: center.y, z: center.z }),
      distance: Math.min(maximumDistance, Math.max(minimumDistance, radius / (limitingTangent * 0.82)))
    });
  }

  function planContextLevelExpansion(entriesInput, expandedPathsInput, mode) {
    if (mode === "immersive") return Object.freeze([]);
    const expanded = new Set(Array.isArray(expandedPathsInput) ? expandedPathsInput : []);
    const plannedPaths = new Set();
    const keys = [];
    for (const entry of Array.isArray(entriesInput) ? entriesInput : []) {
      if (!entry || !entry.portal || !entry.key || !entry.childPath) continue;
      if (expanded.has(entry.childPath) || plannedPaths.has(entry.childPath)) continue;
      plannedPaths.add(entry.childPath);
      keys.push(entry.key);
    }
    return Object.freeze(keys);
  }

  function planContextLevelCollapse(pathsInput, currentPath, mode) {
    if (mode === "immersive" || !currentPath) return Object.freeze([]);
    const paths = (Array.isArray(pathsInput) ? pathsInput : [])
      .filter((path) => path && path !== currentPath && path.startsWith(`${currentPath}/`));
    return Object.freeze(paths.filter((path) => (
      !paths.some((candidate) => candidate !== path && candidate.startsWith(`${path}/`))
    )));
  }

  function immersiveDomainFrame(nodesInput, optionsInput = {}) {
    const nodes = (Array.isArray(nodesInput) ? nodesInput : []).filter((node) => (
      node
      && node.position
      && Number.isFinite(node.position.x)
      && Number.isFinite(node.position.y)
      && Number.isFinite(node.position.z)
    ));
    const fallbackDistance = Math.max(0.01, Number(optionsInput.fallbackDistance) || 17.2);
    if (!nodes.length) {
      return Object.freeze({
        target: Object.freeze({ x: 0, y: 0, z: 0 }),
        distance: fallbackDistance
      });
    }
    const axes = ["x", "y", "z"];
    const minimum = Object.fromEntries(axes.map((axis) => [axis, Infinity]));
    const maximum = Object.fromEntries(axes.map((axis) => [axis, -Infinity]));
    for (const node of nodes) {
      const radius = Math.max(0, Number(node.radius) || 0);
      for (const axis of axes) {
        minimum[axis] = Math.min(minimum[axis], node.position[axis] - radius);
        maximum[axis] = Math.max(maximum[axis], node.position[axis] + radius);
      }
    }
    const target = Object.fromEntries(axes.map((axis) => [axis, (minimum[axis] + maximum[axis]) / 2]));
    const radius = Math.max(...nodes.map((node) => (
      Math.hypot(
        node.position.x - target.x,
        node.position.y - target.y,
        node.position.z - target.z
      ) + Math.max(0, Number(node.radius) || 0)
    )));
    const fov = Math.max(0.1, Number(optionsInput.fov) || Math.PI / 3);
    const aspect = Math.max(0.1, Number(optionsInput.aspect) || 1);
    const verticalTangent = Math.tan(fov / 2);
    const limitingTangent = Math.max(0.05, Math.min(verticalTangent, verticalTangent * aspect));
    const minimumDistance = Math.max(0.01, Number(optionsInput.minimumDistance) || 0.04);
    const maximumDistance = Math.max(minimumDistance, Number(optionsInput.maximumDistance) || 25200);
    const distance = Math.min(
      maximumDistance,
      Math.max(minimumDistance, radius / (limitingTangent * 0.82))
    );
    return Object.freeze({ target: Object.freeze(target), distance });
  }

  global.SpatialViewModeModel = Object.freeze({
    modes: MODES,
    modeLabels: MODE_LABELS,
    nextMode,
    modeForKey,
    isShiftKeyEvent,
    pointToSegmentDistance,
    pointInPolygon,
    resolveStrokeTargets,
    resolveShiftTap,
    classifyStrokeGesture,
    planRecursiveTargets,
    planPeerBatch,
    toggleSelectionKey,
    planViewTargets,
    resolveImmersiveOwnerContext,
    clusterDomainFrame,
    planContextLevelExpansion,
    planContextLevelCollapse,
    immersiveDomainFrame
  });
})(window);
