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

  function resolveShiftTap(stateInput, nowInput, windowMsInput = 680) {
    const state = stateInput || {};
    const now = Math.max(0, Number(nowInput) || 0);
    const lastTapAt = Math.max(0, Number(state.lastTapAt) || 0);
    const priorTapCount = Math.max(0, Number(state.tapCount) || 0);
    const windowMs = Math.max(240, Number(windowMsInput) || 680);
    const withinWindow = lastTapAt > 0 && now >= lastTapAt && now - lastTapAt <= windowMs;
    const tapCount = withinWindow ? priorTapCount + 1 : 1;
    if (tapCount >= 3) {
      return Object.freeze({
        highEnergy: !Boolean(state.highEnergy),
        lastTapAt: 0,
        tapCount: 0,
        toggled: true
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

  function planPeerBatch(regionsInput, pointInput) {
    const point = pointInput || { x: 0, y: 0 };
    const regions = (Array.isArray(regionsInput) ? regionsInput : [])
      .filter((region) => (
        region
        && region.key !== undefined
        && region.ownerPath
        && region.portal === true
        && region.clusterShellProxy !== true
      ));
    const target = regions
      .map((region) => ({
        region,
        radius: Math.max(1, Number(region.radius) || 0),
        distance: pointDistance(point, region)
      }))
      .filter((entry) => entry.distance <= entry.radius * 1.14)
      .sort((left, right) => (
        left.distance / left.radius - right.distance / right.radius
        || left.radius - right.radius
      ))[0];
    if (!target) return Object.freeze([]);
    return Object.freeze(regions
      .filter((region) => (
        region.ownerPath === target.region.ownerPath
        && Number(region.level) === Number(target.region.level)
      ))
      .map((region) => region.key));
  }

  global.SpatialViewModeModel = Object.freeze({
    modes: MODES,
    modeLabels: MODE_LABELS,
    nextMode,
    modeForKey,
    pointToSegmentDistance,
    pointInPolygon,
    resolveStrokeTargets,
    resolveShiftTap,
    classifyStrokeGesture,
    planRecursiveTargets,
    planPeerBatch
  });
})(window);
