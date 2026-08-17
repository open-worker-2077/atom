(function exposeSpatialHelpPageModel(root) {
  "use strict";

  const pages = new Set(["desktop", "mobile"]);

  function defaultPage(options = {}) {
    return options.coarsePointer === true ? "mobile" : "desktop";
  }

  function selectPage(currentPage, requestedPage) {
    if (pages.has(requestedPage)) return requestedPage;
    return pages.has(currentPage) ? currentPage : "desktop";
  }

  const api = Object.freeze({ defaultPage, selectPage });
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpatialHelpPageModel = api;
})(typeof window !== "undefined" ? window : globalThis);
