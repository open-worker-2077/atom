(function spatialDemoModel(global) {
  "use strict";

  const DEFAULT_IDLE_SECONDS = 5;
  const MAX_IDLE_SECONDS = 3600;
  const DEFAULT_NESTED_TUNNEL_PERCENT = 0;
  const DEFAULT_NESTED_COMPACTNESS_PERCENT = 50;
  const DEFAULT_PERIPHERAL_DEPTH_SHRINK_PERCENT = 20;
  const MAX_NESTED_COMPACTNESS_PERCENT = 100;
  const DEFAULT_ZOOM_SPEED_PERCENT = 160;
  const DEFAULT_MIDDLE_LABEL_DEPTH = 3;
  const DEFAULT_HIGHLIGHTED_LABEL_BRIGHTNESS_PERCENT = 100;
  const DEFAULT_OTHER_LABEL_BRIGHTNESS_PERCENT = 35;
  const DEFAULT_HIGHLIGHTED_DETAIL_BRIGHTNESS_PERCENT = 100;
  const DEFAULT_OTHER_DETAIL_BRIGHTNESS_PERCENT = 0;
  const DEFAULT_FLOATING_DETAIL_BACKDROP_OPACITY_PERCENT = 82;

  function validSeconds(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
      ? Math.min(MAX_IDLE_SECONDS, Math.max(1, number))
      : null;
  }

  function validPercent(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(100, Math.max(0, Math.round(number)))
      : DEFAULT_NESTED_TUNNEL_PERCENT;
  }

  function validZoomSpeed(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(400, Math.max(25, Math.round(number)))
      : DEFAULT_ZOOM_SPEED_PERCENT;
  }

  function validMiddleLabelDepth(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(9, Math.max(1, Math.round(number)))
      : DEFAULT_MIDDLE_LABEL_DEPTH;
  }

  function validLabelBrightness(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(100, Math.max(0, Math.round(number)))
      : fallback;
  }

  function validNestedCompactness(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(MAX_NESTED_COMPACTNESS_PERCENT, Math.max(0, Math.round(number)))
      : DEFAULT_NESTED_COMPACTNESS_PERCENT;
  }

  function validPeripheralDepthShrink(value) {
    const number = Number(value);
    return Number.isFinite(number)
      ? Math.min(90, Math.max(0, Math.round(number)))
      : DEFAULT_PERIPHERAL_DEPTH_SHRINK_PERCENT;
  }

  function normalizeSettings(input) {
    const source = input && typeof input === "object" ? input : {};
    const lastIdleSeconds = validSeconds(source.lastIdleSeconds) || DEFAULT_IDLE_SECONDS;
    const idleSeconds = !Object.prototype.hasOwnProperty.call(source, "idleSeconds")
      || source.idleSeconds === null
      ? null
      : (validSeconds(source.idleSeconds) || DEFAULT_IDLE_SECONDS);
    const middleLabelDepth = validMiddleLabelDepth(source.middleLabelDepth);
    return Object.freeze({
      idleSeconds,
      lastIdleSeconds,
      helpVisible: typeof source.helpVisible === "boolean" ? source.helpVisible : true,
      peripheralDepthShrinkPercent: validPeripheralDepthShrink(source.peripheralDepthShrinkPercent),
      nestedCompactnessPercent: validNestedCompactness(source.nestedCompactnessPercent),
      nestedTunnelPercent: validPercent(source.nestedTunnelPercent),
      nestedTunnelInteriorPercent: validPercent(source.nestedTunnelInteriorPercent),
      zoomSpeedPercent: validZoomSpeed(source.zoomSpeedPercent),
      middleLabelDepth,
      highlightedLabelBrightnessPercent: validLabelBrightness(
        source.highlightedLabelBrightnessPercent,
        DEFAULT_HIGHLIGHTED_LABEL_BRIGHTNESS_PERCENT
      ),
      otherLabelBrightnessPercent: validLabelBrightness(
        source.otherLabelBrightnessPercent,
        DEFAULT_OTHER_LABEL_BRIGHTNESS_PERCENT
      ),
      middleDetailDepth: middleLabelDepth,
      highlightedDetailBrightnessPercent: validLabelBrightness(
        source.highlightedDetailBrightnessPercent,
        DEFAULT_HIGHLIGHTED_DETAIL_BRIGHTNESS_PERCENT
      ),
      otherDetailBrightnessPercent: validLabelBrightness(
        source.otherDetailBrightnessPercent,
        DEFAULT_OTHER_DETAIL_BRIGHTNESS_PERCENT
      ),
      floatingDetailBackdropOpacityPercent: validLabelBrightness(
        source.floatingDetailBackdropOpacityPercent,
        DEFAULT_FLOATING_DETAIL_BACKDROP_OPACITY_PERCENT
      )
    });
  }

  function withIdleInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    if (value === "" || value === null || value === undefined) {
      return normalizeSettings({ ...settings, idleSeconds: null });
    }
    const idleSeconds = validSeconds(value);
    if (!idleSeconds) return settings;
    return normalizeSettings({ ...settings, idleSeconds, lastIdleSeconds: idleSeconds });
  }

  function toggleDemo(settingsInput) {
    const settings = normalizeSettings(settingsInput);
    return normalizeSettings({
      ...settings,
      idleSeconds: settings.idleSeconds === null ? settings.lastIdleSeconds : null
    });
  }

  function withNestedTunnelInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    return normalizeSettings({ ...settings, nestedTunnelPercent: validPercent(value) });
  }

  function withPeripheralDepthShrinkInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    return normalizeSettings({
      ...settings,
      peripheralDepthShrinkPercent: validPeripheralDepthShrink(value)
    });
  }

  function withNestedCompactnessInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    return normalizeSettings({
      ...settings,
      nestedCompactnessPercent: validNestedCompactness(value)
    });
  }

  function withNestedTunnelInteriorInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    return normalizeSettings({ ...settings, nestedTunnelInteriorPercent: validPercent(value) });
  }

  function withZoomSpeedInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    return normalizeSettings({ ...settings, zoomSpeedPercent: validZoomSpeed(value) });
  }

  function withMiddleLabelDepthInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    const middleLabelDepth = validMiddleLabelDepth(value);
    return normalizeSettings({ ...settings, middleLabelDepth, middleDetailDepth: middleLabelDepth });
  }

  function withOtherLabelBrightnessInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    return normalizeSettings({
      ...settings,
      otherLabelBrightnessPercent: validLabelBrightness(value, DEFAULT_OTHER_LABEL_BRIGHTNESS_PERCENT)
    });
  }

  function withHighlightedLabelBrightnessInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    return normalizeSettings({
      ...settings,
      highlightedLabelBrightnessPercent: validLabelBrightness(
        value,
        DEFAULT_HIGHLIGHTED_LABEL_BRIGHTNESS_PERCENT
      )
    });
  }

  function withMiddleDetailDepthInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    const number = Number(value);
    const middleLabelDepth = Number.isFinite(number)
      ? validMiddleLabelDepth(number)
      : DEFAULT_MIDDLE_LABEL_DEPTH;
    return normalizeSettings({
      ...settings,
      middleLabelDepth,
      middleDetailDepth: middleLabelDepth
    });
  }

  function withOtherDetailBrightnessInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    return normalizeSettings({
      ...settings,
      otherDetailBrightnessPercent: validLabelBrightness(
        value,
        DEFAULT_OTHER_DETAIL_BRIGHTNESS_PERCENT
      )
    });
  }

  function withHighlightedDetailBrightnessInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    return normalizeSettings({
      ...settings,
      highlightedDetailBrightnessPercent: validLabelBrightness(
        value,
        DEFAULT_HIGHLIGHTED_DETAIL_BRIGHTNESS_PERCENT
      )
    });
  }

  function withFloatingDetailBackdropOpacityInput(settingsInput, value) {
    const settings = normalizeSettings(settingsInput);
    return normalizeSettings({
      ...settings,
      floatingDetailBackdropOpacityPercent: validLabelBrightness(
        value,
        DEFAULT_FLOATING_DETAIL_BACKDROP_OPACITY_PERCENT
      )
    });
  }

  function pathDepth(path) {
    return String(path || "").split("/").filter(Boolean).length;
  }

  function pathIsWithin(path, rootPath) {
    return Boolean(path && rootPath && (path === rootPath || path.startsWith(`${rootPath}/`)));
  }

  function domainHierarchyItem(path, parentPath) {
    return {
      kind: "domain",
      path,
      key: "",
      ownerPath: parentPath
    };
  }

  function hierarchyLabelLevel(focus, item) {
    if (!focus || !item || !item.ownerPath) return null;
    if (focus.kind === "domain" && item.kind === "domain" && item.path === focus.path) return 1;
    if (focus.kind === "node" && item.key === focus.anchorKey) return 1;
    const rootPath = focus.kind === "node" ? focus.descendantPath : focus.path;
    if (!pathIsWithin(item.ownerPath, rootPath)) return null;
    return pathDepth(item.ownerPath) - pathDepth(rootPath) + 2;
  }

  function isHierarchyLabelHighlighted(focus, item, levels) {
    const level = hierarchyLabelLevel(focus, item);
    return level !== null && level <= validMiddleLabelDepth(levels);
  }

  function hierarchyDetailLevel(focus, item) {
    return hierarchyLabelLevel(focus, item);
  }

  function isHierarchyDetailHighlighted(focus, item, levels) {
    return isHierarchyLabelHighlighted(focus, item, levels);
  }

  function levelBrightnessPercent(level, levels, highlightedPercent, otherPercent) {
    if (level === null) return otherPercent;
    const validLevels = validMiddleLabelDepth(levels);
    const ratio = Math.min(1, Math.max(0, (level - 1) / validLevels));
    return highlightedPercent + (otherPercent - highlightedPercent) * ratio;
  }

  function hierarchyLabelBrightnessPercent(focus, item, levels, highlightedPercent, otherPercent) {
    return levelBrightnessPercent(
      hierarchyLabelLevel(focus, item),
      levels,
      highlightedPercent,
      otherPercent
    );
  }

  function hierarchyRelationshipBrightnessPercent(focus, fromItem, toItem, levels, highlightedPercent, otherPercent) {
    const fromLevel = hierarchyLabelLevel(focus, fromItem);
    const toLevel = hierarchyLabelLevel(focus, toItem);
    const levelCandidates = [fromLevel, toLevel].filter((level) => level !== null);
    const level = levelCandidates.length ? Math.min(...levelCandidates) : null;
    return levelBrightnessPercent(level, levels, highlightedPercent, otherPercent);
  }

  function shouldStart({ idleSeconds, lastInputAt, now }) {
    const delay = validSeconds(idleSeconds);
    return Boolean(delay && Number(now) - Number(lastInputAt) >= delay * 1000);
  }

  function shuffleSteps(stepsInput, randomInput) {
    const steps = Array.isArray(stepsInput) ? [...stepsInput] : [];
    const random = typeof randomInput === "function" ? randomInput : Math.random;
    for (let index = steps.length - 1; index > 0; index -= 1) {
      const sample = Number(random());
      const bounded = Number.isFinite(sample) ? Math.min(0.999999, Math.max(0, sample)) : 0;
      const swapIndex = Math.floor(bounded * (index + 1));
      [steps[index], steps[swapIndex]] = [steps[swapIndex], steps[index]];
    }
    return Object.freeze(steps);
  }

  function formatSessionMarker(dateInput) {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `【演示·${safeDate.getFullYear()}${pad(safeDate.getMonth() + 1)}${pad(safeDate.getDate())}-${pad(safeDate.getHours())}${pad(safeDate.getMinutes())}${pad(safeDate.getSeconds())}】`;
  }

  function tourTask(id, theme, themeIndex, themeLabel, key, label, kind, extra = {}) {
    return Object.freeze({
      id,
      theme,
      themeIndex,
      themeLabel,
      key,
      label,
      kind,
      ...extra
    });
  }

  function buildTourAgenda(summaryInput, completedInput) {
    const source = summaryInput && typeof summaryInput === "object" ? summaryInput : {};
    const completed = new Set(Array.isArray(completedInput) ? completedInput : []);
    const portalCount = Math.max(0, Number(source.portalCount) || 0);
    const detailCount = Math.max(0, Number(source.detailCount) || 0);
    const batchCount = Math.max(0, Number(source.batchCount) || 0);
    const maxDescent = Math.min(3, Math.max(0, Number(source.maxDescent) || 0));
    const tasks = [];
    const add = (task) => {
      if (!completed.has(task.id)) tasks.push(task);
    };

    if (source.worldLensOpen !== true) {
      add(tourTask("spatial.world-lens", "spatial", "01", "空间视角", "O", "展开域径图", "worldLens"));
    }
    if (portalCount) {
      add(tourTask("spatial.nested", "spatial", "01", "空间视角", "A", "内包展开", "mode", { mode: "nested" }));
      add(tourTask("spatial.peripheral", "spatial", "01", "空间视角", "S", "外围展开", "mode", { mode: "peripheral" }));
      add(tourTask("spatial.hierarchy", "spatial", "01", "空间视角", "D", "层级展开", "mode", { mode: "hierarchy" }));
      for (let step = 1; step <= maxDescent; step += 1) {
        add(tourTask(`tunnel.descend.${step}`, "tunnel", "02", "隧洞游历", "F", `沉浸第 ${step} 层`, "descend", { step }));
      }
    }
    if (Number(source.depth) > 0) {
      add(tourTask("tunnel.retreat", "tunnel", "02", "隧洞游历", "右键空白", "退出一层并回望", "retreat"));
    }
    if (source.atRoot !== true || source.clusterOpen === true) {
      add(tourTask("navigation.home", "tunnel", "02", "隧洞游历", "Home", "返回全域", "overview"));
    }

    if (detailCount) {
      add(tourTask("observation.surface", "observation", "03", "观察层", "中键", "球镜详情", "detail", { detailMode: "surface" }));
      add(tourTask("observation.floating", "observation", "03", "观察层", "中键", "悬浮详情", "detail", { detailMode: "floating" }));
    }

    add(tourTask("camera.orbit", "camera", "04", "摄像机", "Space", "环绕观察", "camera", { cameraAction: "orbit" }));
    add(tourTask("camera.pan", "camera", "04", "摄像机", "Space + 左拖", "平移 Graph", "camera", { cameraAction: "pan" }));
    add(tourTask("camera.far", "camera", "04", "摄像机", "滚轮", "拉远总览", "camera", { cameraAction: "far" }));
    add(tourTask("camera.near", "camera", "04", "摄像机", "滚轮", "靠近观察", "camera", { cameraAction: "near" }));

    if (batchCount) {
      add(tourTask("batch.wand", "batch", "05", "批量视野", "Shift + 右拖", "木杖轨迹命中", "batch", { batchAction: "wand" }));
      add(tourTask("batch.recursive", "batch", "05", "批量视野", "Shift 三击", "玉杖递归展开", "batch", { batchAction: "recursive" }));
    }

    if (source.canCreate === true) {
      add(tourTask("editing.create", "editing", "06", "数据编辑", "Ctrl + 左键", "创建演示节点", "editing", { editAction: "create" }));
    }
    if (source.canUpdate === true) {
      add(tourTask("editing.update", "editing", "06", "数据编辑", "Enter", "更新演示详情", "editing", { editAction: "update" }));
    }
    if (source.canRelate === true) {
      add(tourTask("editing.relation", "editing", "06", "数据编辑", "Ctrl + 右键", "建立演示关系", "editing", { editAction: "relation" }));
    }
    if (source.canLand === true) {
      add(tourTask("editing.land", "editing", "06", "数据编辑", "Ctrl + 右键空白", "转入演示新域", "editing", { editAction: "land" }));
    }

    return Object.freeze(tasks);
  }

  function nextTourTask(summaryInput, completedInput) {
    return buildTourAgenda(summaryInput, completedInput)[0] || null;
  }

  global.SpatialDemoModel = Object.freeze({
    defaultIdleSeconds: DEFAULT_IDLE_SECONDS,
    normalizeSettings,
    withIdleInput,
    withPeripheralDepthShrinkInput,
    withNestedCompactnessInput,
    withNestedTunnelInput,
    withNestedTunnelInteriorInput,
    withZoomSpeedInput,
    withMiddleLabelDepthInput,
    withOtherLabelBrightnessInput,
    withHighlightedLabelBrightnessInput,
    withMiddleDetailDepthInput,
    withOtherDetailBrightnessInput,
    withHighlightedDetailBrightnessInput,
    withFloatingDetailBackdropOpacityInput,
    domainHierarchyItem,
    hierarchyLabelLevel,
    isHierarchyLabelHighlighted,
    hierarchyLabelBrightnessPercent,
    hierarchyRelationshipBrightnessPercent,
    hierarchyDetailLevel,
    isHierarchyDetailHighlighted,
    toggleDemo,
    shouldStart,
    shuffleSteps,
    formatSessionMarker,
    buildTourAgenda,
    nextTourTask
  });
})(window);
