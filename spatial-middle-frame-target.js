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

  function choosePointerTarget(candidatesInput, x, y, optionsInput) {
    const candidates = Array.isArray(candidatesInput) ? candidatesInput : [];
    const highest = candidates[0] || null;
    if (!highest || optionsInput?.clusterFieldOpen !== true) return highest;
    if (highest.region?.item?.kind !== "node") return highest;
    const concreteRegions = candidates
      .map((candidate) => candidate?.region)
      .filter((region) => region?.item?.kind === "node" && region.item.clusterShellProxy !== true);
    const mostSpecific = chooseMostSpecificTarget(
      concreteRegions.length ? concreteRegions : candidates.map((candidate) => candidate?.region),
      x,
      y
    );
    return candidates.find((candidate) => candidate?.region === mostSpecific) || highest;
  }

  const api = Object.freeze({ chooseMostSpecificTarget, choosePointerTarget });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.SpatialMiddleFrameTarget = api;
})(typeof window !== "undefined" ? window : globalThis);
