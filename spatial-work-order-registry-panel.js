(function mountSpatialWorkOrderRegistry(root) {
  "use strict";

  function element(name, text) {
    const node = document.createElement(name);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render(mount, summary) {
    const heading = element("h3", summary.title);
    const groups = element("p", `编组：${summary.groups.join(" / ")}`);
    const actions = element("dl");
    for (const action of summary.actions) {
      const row = element("div");
      row.dataset.workOrderAction = action.id;
      row.append(element("dt", action.id), element("dd", action.label));
      actions.append(row);
    }
    const errors = element("p", `错误：${summary.errors.map((error) => error.code).join(" / ")}`);
    for (const error of summary.errors) {
      const marker = element("span");
      marker.dataset.workOrderError = error.code;
      errors.append(marker);
    }
    const receipt = element(
      "p",
      `提交回执：${summary.receipt.contract}@${summary.receipt.version} · ${summary.receipt.required.join(" / ")}`
    );
    receipt.dataset.workOrderReceipt = summary.receipt.required.join(",");
    mount.replaceChildren(heading, groups, actions, errors, receipt);
    mount.dataset.state = "ready";
  }

  async function load() {
    const mount = document.getElementById("workOrderRegistryHelp");
    if (!mount) return;
    try {
      const response = await fetch("/__atom/api/work-order-registry", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error("Registry endpoint unavailable");
      render(mount, root.SpatialWorkOrderRegistryModel.summarize(payload.result));
    } catch (error) {
      mount.dataset.state = "error";
      mount.textContent = `工单契约暂不可用：${error.message}`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load, { once: true });
  else load();
})(typeof window !== "undefined" ? window : globalThis);
