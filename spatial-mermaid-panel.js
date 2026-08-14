(function spatialMermaidPanel(global) {
  "use strict";

  const lab = global.spatialLab;
  const codecs = {
    mermaid: global.SpatialMermaidCodec,
    json: global.SpatialJsonCodec
  };
  const panel = document.getElementById("mermaidPanel");
  if (!lab || !codecs.mermaid || !codecs.json || !panel) return;

  const formats = {
    mermaid: {
      label: "Mermaid",
      filename: "graph-4d-knowledge.mmd",
      description: "Mermaid 图文件",
      mime: "text/plain",
      extensions: [".mmd", ".md"],
      placeholder: 'flowchart LR\n  A["节点名称<br/>节点详情"]',
      exportMethod: "exportMermaid"
    },
    json: {
      label: "JSON",
      filename: "graph-4d-knowledge.json",
      description: "Graph-4D JSON 知识文件",
      mime: "application/json",
      extensions: [".json"],
      placeholder: '{\n  "format": "graph-4d",\n  "version": 1,\n  "nodes": []\n}',
      exportMethod: "exportJson"
    }
  };

  const ui = {
    trigger: document.querySelector('[data-ui="mermaid"]'),
    target: document.getElementById("mermaidTarget"),
    source: document.getElementById("mermaidSource"),
    file: document.getElementById("mermaidFile"),
    format: document.getElementById("knowledgeFormat"),
    fileLabel: document.getElementById("knowledgeFileLabel"),
    sourceLabel: document.getElementById("knowledgeSourceLabel"),
    status: document.getElementById("mermaidStatus"),
    preview: document.getElementById("mermaidPreview"),
    confirm: document.getElementById("mermaidConfirm"),
    cancel: document.getElementById("mermaidCancel"),
    export: document.getElementById("mermaidExport"),
    copy: document.getElementById("mermaidCopy"),
    download: document.getElementById("mermaidDownload"),
    rootWrap: document.getElementById("mermaidRootConfirmWrap"),
    rootConfirm: document.getElementById("mermaidRootConfirm")
  };

  let pending = null;

  function currentFormat() {
    return formats[ui.format.value] ? ui.format.value : "mermaid";
  }

  function currentCodec() {
    return codecs[currentFormat()];
  }

  function currentSettings() {
    return formats[currentFormat()];
  }

  function syncFormatUi() {
    const settings = currentSettings();
    ui.sourceLabel.textContent = `${settings.label} 源码`;
    ui.fileLabel.textContent = currentFormat() === "json"
      ? "读取 .json 文件"
      : "读取 .mmd / .md 文件";
    ui.source.placeholder = settings.placeholder;
    ui.download.textContent = `另存 ${settings.extensions[0]}`;
  }

  function setStatus(message, state = "idle") {
    ui.status.textContent = message;
    ui.status.dataset.state = state;
  }

  function currentTarget() {
    const target = lab.mermaidTarget();
    ui.target.textContent = target.requiresConfirmation
      ? "目标：全局顶层（未选择母球）"
      : `目标母球：${target.parentLabel}`;
    return target;
  }

  function resetPreview(message = "源码已变化，请重新预览。") {
    pending = null;
    ui.confirm.disabled = true;
    ui.cancel.disabled = true;
    ui.rootWrap.hidden = true;
    ui.rootConfirm.checked = false;
    setStatus(message);
  }

  function describeError(error) {
    const line = error && error.details && error.details.line ? `（第 ${error.details.line} 行）` : "";
    return `${error && error.message ? error.message : `${currentSettings().label} 处理失败`}${line}`;
  }

  function previewImport() {
    try {
      const target = currentTarget();
      const codec = currentCodec();
      const documentModel = codec.parse(ui.source.value);
      const plan = codec.planImport(lab.exportKnowledge(), documentModel, target);
      pending = { plan, targetSignature: JSON.stringify(target), format: currentFormat() };
      ui.confirm.disabled = false;
      ui.cancel.disabled = false;
      ui.rootWrap.hidden = !target.requiresConfirmation;
      ui.rootConfirm.checked = false;
      const summary = plan.summary;
      const warning = target.requiresConfirmation ? "\n警告：尚未选择母球，确认后写入全局顶层。" : "";
      setStatus(
        `预览完成：新增 ${summary.addedNodes} 个，更新 ${summary.updatedNodes} 个，关系 ${summary.addedOrUpdatedEdges} 条，最深 ${summary.maxDepth} 层。${warning}`,
        target.requiresConfirmation ? "warning" : "ready"
      );
    } catch (error) {
      resetPreview(describeError(error));
      ui.status.dataset.state = "error";
    }
  }

  function confirmImport() {
    if (!pending) return;
    const target = currentTarget();
    if (pending.targetSignature !== JSON.stringify(target) || pending.format !== currentFormat()) {
      resetPreview("母球目标或交换格式已变化，请重新预览后再导入。");
      ui.status.dataset.state = "error";
      return;
    }
    if (target.requiresConfirmation && !ui.rootConfirm.checked) {
      setStatus("请先勾选确认：本次将导入全局顶层。", "error");
      return;
    }
    if (!lab.replaceKnowledge(pending.plan.knowledge)) {
      setStatus("导入未完成，原知识保持不变。", "error");
      return;
    }
    const summary = pending.plan.summary;
    pending = null;
    ui.confirm.disabled = true;
    ui.cancel.disabled = true;
    ui.rootWrap.hidden = true;
    setStatus(`导入完成：新增 ${summary.addedNodes} 个，更新 ${summary.updatedNodes} 个。`, "success");
  }

  async function exportCurrent() {
    try {
      const target = currentTarget();
      const knowledge = lab.exportKnowledge();
      const codec = currentCodec();
      const settings = currentSettings();
      const canExportSelection = target.selectedKey
        && knowledge.nodes.some((node) => node.key === target.selectedKey);
      ui.source.value = codec[settings.exportMethod](
        knowledge,
        canExportSelection ? { key: target.selectedKey } : {}
      );
      resetPreview(canExportSelection
        ? `已导出“${target.parentLabel}”及其全部子域。`
        : "已导出全局知识；当前母球不属于本地知识节点。"
      );
      ui.status.dataset.state = "success";
      await saveSourceToFile();
    } catch (error) {
      setStatus(describeError(error), "error");
    }
  }

  async function copySource() {
    try {
      await global.navigator.clipboard.writeText(ui.source.value);
      setStatus(`${currentSettings().label} 源码已复制。`, "success");
    } catch (error) {
      ui.source.focus();
      ui.source.select();
      setStatus("无法自动复制，源码已全选。", "error");
    }
  }

  async function saveSourceToFile() {
    const settings = currentSettings();
    if (!ui.source.value.trim()) {
      setStatus(`没有可下载的 ${settings.label} 源码。`, "error");
      return false;
    }
    const blob = new Blob([ui.source.value], { type: `${settings.mime};charset=utf-8` });
    if (typeof global.showSaveFilePicker === "function") {
      try {
        const handle = await global.showSaveFilePicker({
          suggestedName: settings.filename,
          types: [{
            description: settings.description,
            accept: { [settings.mime]: settings.extensions }
          }]
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setStatus(`已保存到你选择的位置：${handle.name}`, "success");
        return true;
      } catch (error) {
        if (error && error.name === "AbortError") {
          setStatus(`已生成 ${settings.label} 源码，但你取消了本地保存。`, "warning");
          return false;
        }
        setStatus("当前浏览器无法打开保存弹框，已改用浏览器下载。", "warning");
      }
    }
    if (!global.confirm("当前浏览器不支持选择保存目录，将下载到浏览器默认下载目录。是否继续？")) {
      setStatus(`已生成 ${settings.label} 源码，但你取消了本地下载。`, "warning");
      return false;
    }
    const href = global.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = settings.filename;
    anchor.click();
    global.setTimeout(() => global.URL.revokeObjectURL(href), 0);
    setStatus(`已交给浏览器下载：${settings.filename}`, "success");
    return true;
  }

  async function downloadSource() {
    await saveSourceToFile();
  }

  ui.trigger.addEventListener("click", currentTarget);
  ui.format.addEventListener("change", () => {
    syncFormatUi();
    resetPreview(`已切换为 ${currentSettings().label}，请预览后再导入。`);
  });
  ui.source.addEventListener("input", () => resetPreview());
  ui.file.addEventListener("change", async () => {
    const file = ui.file.files && ui.file.files[0];
    if (!file) return;
    try {
      if (/\.json$/i.test(file.name)) ui.format.value = "json";
      if (/\.(?:mmd|md)$/i.test(file.name)) ui.format.value = "mermaid";
      syncFormatUi();
      ui.source.value = await file.text();
      resetPreview(`已读取 ${file.name}，请预览导入。`);
    } catch (error) {
      setStatus("文件读取失败。", "error");
    }
  });
  ui.preview.addEventListener("click", previewImport);
  ui.confirm.addEventListener("click", confirmImport);
  ui.cancel.addEventListener("click", () => resetPreview("已取消预览，知识库未改变。"));
  ui.export.addEventListener("click", exportCurrent);
  ui.copy.addEventListener("click", copySource);
  ui.download.addEventListener("click", downloadSource);
  syncFormatUi();
})(window);
