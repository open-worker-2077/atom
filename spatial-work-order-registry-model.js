(function exposeSpatialWorkOrderRegistryModel(root) {
  "use strict";

  function invalid() {
    throw new Error("Invalid work-order registry contract");
  }

  function summarize(registry) {
    if (!registry || registry.contract !== "atom-work-order-registry"
      || registry.version !== 1 || registry.runtimeContract !== "atom-interaction/4") invalid();
    const template = Array.isArray(registry.templates)
      ? registry.templates.find((item) => item && item.id === "work-order")
      : null;
    const version = template && Array.isArray(template.versions)
      ? template.versions.find((item) => String(item && item.version) === String(template.latest))
      : null;
    if (!template || !version || !Array.isArray(version.groups)
      || !Array.isArray(version.actions) || !Array.isArray(version.errors)
      || !version.commitReceipt || !Array.isArray(version.commitReceipt.required)) invalid();
    return {
      title: `${template.label} v${version.version}`,
      groups: version.groups.slice(),
      actions: version.actions.map((action) => ({ id: action.id, label: action.label })),
      errors: version.errors.map((error) => ({ code: error.code, meaning: error.meaning })),
      receipt: {
        contract: version.commitReceipt.contract,
        version: version.commitReceipt.version,
        required: version.commitReceipt.required.slice()
      }
    };
  }

  const api = Object.freeze({ summarize });
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SpatialWorkOrderRegistryModel = api;
})(typeof window !== "undefined" ? window : globalThis);
