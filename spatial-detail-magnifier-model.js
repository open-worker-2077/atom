(function spatialDetailMagnifierModel(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpatialDetailMagnifierModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createDetailMagnifierModel() {
  "use strict";

  const TRIPLE_WINDOW_MS = 1600;
  const VIEWPORT_MARGIN = 24;
  const FULL_TEXT_WIDTH = 960;

  function createState() {
    return { enabled: false, presses: [] };
  }

  function registerCapsLock(input, now) {
    const state = input && typeof input === "object" ? input : createState();
    const timestamp = Number(now) || 0;
    const presses = (Array.isArray(state.presses) ? state.presses : [])
      .filter((press) => timestamp - press <= TRIPLE_WINDOW_MS)
      .concat(timestamp);
    if (presses.length < 3) {
      return { state: { enabled: state.enabled === true, presses }, toggled: false };
    }
    return { state: { enabled: state.enabled !== true, presses: [] }, toggled: true };
  }

  function targetAt({ node, nodeOwnerPath, relations, boxes, regions, x, y }) {
    if (node) return {
      kind: "node",
      node,
      ownerPath: nodeOwnerPath || "",
      detail: String(node.description || node.detail || "")
    };
    const relation = (Array.isArray(relations) ? relations : [])
      .filter((entry) => (
        entry && entry.edge
        && Math.hypot(x - entry.x, y - entry.y) <= Math.max(1, entry.radius)
      ))
      .sort((left, right) => (
        Math.hypot(x - left.x, y - left.y) / Math.max(1, left.radius)
        - Math.hypot(x - right.x, y - right.y) / Math.max(1, right.radius)
      ))[0];
    if (relation) {
      const edge = relation.edge;
      const label = String(relation.label || edge.label || "关系");
      const body = String(relation.detail || edge.detail || edge.description || "").trim();
      return {
        kind: "relationship",
        edge,
        label,
        detail: body ? `${label}\n\n${body}` : label
      };
    }
    const region = (Array.isArray(regions) ? regions : [])
      .filter((entry) => (
        entry
        && entry.node
        && Math.hypot(x - entry.x, y - entry.y) <= Math.max(1, entry.radius)
      ))
      .sort((left, right) => left.radius - right.radius)[0];
    if (region) {
      return {
        kind: "node",
        node: region.node,
        ownerPath: region.ownerPath || "",
        detail: String(region.detail || region.node.description || region.node.detail || "")
      };
    }
    const match = (Array.isArray(boxes) ? boxes : []).find((box) => (
      x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
    ));
    if (!match || !match.node) return null;
    return {
      kind: "node",
      node: match.node,
      ownerPath: match.ownerPath || "",
      detail: String(match.detail || match.node.description || match.node.detail || "")
    };
  }

  function panelLayout({ x, viewportWidth, viewportHeight }) {
    const width = Math.max(240, Math.min(FULL_TEXT_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2));
    const preferredRight = x + 20;
    const left = preferredRight + width <= viewportWidth - VIEWPORT_MARGIN
      ? preferredRight
      : Math.max(VIEWPORT_MARGIN, x - width - 20);
    return {
      left,
      top: VIEWPORT_MARGIN,
      width,
      maxHeight: Math.max(160, viewportHeight - VIEWPORT_MARGIN * 2)
    };
  }

  return Object.freeze({ createState, panelLayout, registerCapsLock, targetAt });
});
