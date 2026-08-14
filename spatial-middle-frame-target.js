(function spatialMiddleFrameTargetFactory(global) {
  "use strict";

  function chooseMostSpecificTarget(regions, x, y) {
    const candidates = (Array.isArray(regions) ? regions : [])
      .filter((region) => region && region.item && region.item.kind === "node" && region.item.node)
      .map((region) => {
        const radius = Math.max(1, Number(region.radius) || 1);
        return {
          region,
          radius,
          normalizedDistance: Math.hypot(x - region.x, y - region.y) / radius
        };
      })
      .filter((candidate) => candidate.normalizedDistance <= 1)
      .sort((left, right) => (
        left.radius - right.radius
        || left.normalizedDistance - right.normalizedDistance
        || left.region.item.screen.depth - right.region.item.screen.depth
      ));
    return candidates.length ? candidates[0].region : null;
  }

  const api = Object.freeze({ chooseMostSpecificTarget });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.SpatialMiddleFrameTarget = api;
})(typeof window !== "undefined" ? window : globalThis);
