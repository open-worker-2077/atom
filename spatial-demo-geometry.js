(function spatialDemoGeometry(global) {
  "use strict";

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeRegions(regionsInput) {
    return (Array.isArray(regionsInput) ? regionsInput : [])
      .map((region, index) => ({
        key: String(region && region.key || `region-${index}`),
        x: Number(region && region.x),
        y: Number(region && region.y),
        radius: Math.max(0, Number(region && region.radius) || 0),
        index
      }))
      .filter((region) => Number.isFinite(region.x) && Number.isFinite(region.y));
  }

  function distance(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y);
  }

  function sampleWaypoints(regions, maximum) {
    if (regions.length <= maximum) return [...regions];
    const selected = [];
    const candidates = [...regions];
    const take = (candidate) => {
      if (!candidate || selected.some((item) => item.index === candidate.index)) return;
      selected.push(candidate);
    };
    take(regions.reduce((best, item) => item.x < best.x ? item : best));
    take(regions.reduce((best, item) => item.x > best.x ? item : best));
    take(regions.reduce((best, item) => item.y < best.y ? item : best));
    take(regions.reduce((best, item) => item.y > best.y ? item : best));
    while (selected.length < maximum) {
      let next = null;
      let nextDistance = -1;
      for (const candidate of candidates) {
        if (selected.some((item) => item.index === candidate.index)) continue;
        const nearest = Math.min(...selected.map((item) => distance(candidate, item)));
        if (nearest > nextDistance) {
          next = candidate;
          nextDistance = nearest;
        }
      }
      if (!next) break;
      take(next);
    }
    return selected;
  }

  function orderWaypoints(points) {
    if (points.length <= 1) return [...points];
    const remaining = [...points];
    const startIndex = remaining.reduce((bestIndex, point, index, list) => (
      point.x < list[bestIndex].x || (point.x === list[bestIndex].x && point.y < list[bestIndex].y)
        ? index
        : bestIndex
    ), 0);
    const ordered = [remaining.splice(startIndex, 1)[0]];
    while (remaining.length) {
      const current = ordered.at(-1);
      let nearestIndex = 0;
      for (let index = 1; index < remaining.length; index += 1) {
        if (distance(current, remaining[index]) < distance(current, remaining[nearestIndex])) {
          nearestIndex = index;
        }
      }
      ordered.push(remaining.splice(nearestIndex, 1)[0]);
    }
    return ordered;
  }

  function planWandPath(regionsInput, optionsInput = {}) {
    const regions = normalizeRegions(regionsInput);
    if (!regions.length) {
      return Object.freeze({
        points: Object.freeze([]),
        targetKeys: Object.freeze([]),
        waypointKeys: Object.freeze([])
      });
    }
    const viewport = optionsInput.viewport || {};
    const width = Math.max(1, Number(viewport.width) || 1);
    const height = Math.max(1, Number(viewport.height) || 1);
    const maximum = Math.max(4, Math.floor(Number(optionsInput.maxWaypoints) || 14));
    const ordered = orderWaypoints(sampleWaypoints(regions, maximum));
    const tail = clamp(Math.min(width, height) * 0.09, 34, 86);
    const first = ordered[0];
    const last = ordered.at(-1);
    const entry = {
      x: clamp(first.x - tail, 8, width - 8),
      y: clamp(first.y - tail * 0.62, 8, height - 8)
    };
    const exit = {
      x: clamp(last.x + tail, 8, width - 8),
      y: clamp(last.y + tail * 0.62, 8, height - 8)
    };
    const points = [entry, ...ordered.map((point) => ({ x: point.x, y: point.y })), exit];
    return Object.freeze({
      points: Object.freeze(points.map(Object.freeze)),
      targetKeys: Object.freeze(regions.map((region) => region.key)),
      waypointKeys: Object.freeze(ordered.map((region) => region.key))
    });
  }

  function planAdaptiveFrame(boundsInput, viewportInput, optionsInput = {}) {
    const bounds = boundsInput || {};
    const viewport = viewportInput || {};
    const width = Math.max(1, Number(viewport.width) || 1);
    const height = Math.max(1, Number(viewport.height) || 1);
    const minX = Number.isFinite(Number(bounds.minX)) ? Number(bounds.minX) : width * 0.5;
    const maxX = Number.isFinite(Number(bounds.maxX)) ? Number(bounds.maxX) : minX;
    const minY = Number.isFinite(Number(bounds.minY)) ? Number(bounds.minY) : height * 0.5;
    const maxY = Number.isFinite(Number(bounds.maxY)) ? Number(bounds.maxY) : minY;
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const paddingRatio = clamp(Number(optionsInput.paddingRatio) || 0.15, 0.12, 0.18);
    const desiredOccupancy = 1 - paddingRatio * 2;
    const rawScale = Math.min(
      width * desiredOccupancy / contentWidth,
      height * desiredOccupancy / contentHeight
    );
    const scaleFactor = Math.max(0.02, rawScale);
    const currentDistance = Math.max(0.0001, Number(optionsInput.currentDistance) || 1);
    const minimum = Math.max(0.0001, Number(optionsInput.minDistance) || 0.0001);
    const maximum = Math.max(minimum, Number(optionsInput.maxDistance) || Number.MAX_SAFE_INTEGER);
    const distanceValue = clamp(currentDistance / scaleFactor, minimum, maximum);
    const actualScale = currentDistance / distanceValue;
    const occupancy = Math.max(
      contentWidth * actualScale / width,
      contentHeight * actualScale / height
    );
    return Object.freeze({
      paddingRatio,
      scaleFactor: actualScale,
      distance: distanceValue,
      occupancy,
      screenOffset: Object.freeze({
        x: (minX + maxX) * 0.5 - width * 0.5,
        y: (minY + maxY) * 0.5 - height * 0.5
      })
    });
  }

  global.SpatialDemoGeometry = Object.freeze({
    planWandPath,
    planAdaptiveFrame
  });
})(window);
