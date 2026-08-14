(function inputConfiguration(global) {
  "use strict";

  const VISUAL_INTENTS = Object.freeze({
    aim: "aim",
    focus: "focus",
    activate: "activate",
    alternateActivate: "alternateActivate",
    orbit: "orbit",
    dolly: "dolly",
    peek: "peek",
    enter: "enter",
    exit: "exit",
    cancel: "cancel",
    reveal: "reveal",
    collapse: "collapse",
    inspect: "inspect",
    summonMenu: "summonMenu",
    grab: "grab",
    release: "release",
    pin: "pin",
    backView: "backView",
    forwardView: "forwardView",
    returnOverview: "returnOverview",
    expandToLeaves: "expandToLeaves",
    toggleWorldLens: "toggleWorldLens",
    toggleHelp: "toggleHelp",
    toggleDemo: "toggleDemo",
    toggleClusterField: "toggleClusterField",
    cycleViewMode: "cycleViewMode",
    applyViewMode: "applyViewMode",
    applyParentView: "applyParentView",
    setPeripheralView: "setPeripheralView",
    setNestedView: "setNestedView",
    setHierarchyView: "setHierarchyView",
    setImmersiveView: "setImmersiveView",
    collapseHoveredCluster: "collapseHoveredCluster",
    expandHoveredCluster: "expandHoveredCluster",
    resetView: "resetView",
    nextFocus: "nextFocus",
    previousFocus: "previousFocus",
    toggleChildren: "toggleChildren",
    toggleFieldChildren: "toggleFieldChildren",
    toggleSurface: "toggleSurface",
    cycleDetailMode: "cycleDetailMode",
    setSurfaceDetails: "setSurfaceDetails",
    setFloatingDetails: "setFloatingDetails",
    toggleFieldSurfaces: "toggleFieldSurfaces",
    clearFocus: "clearFocus",
    search: "search",
    createNode: "createNode",
    editNode: "editNode",
    editEdge: "editEdge",
    confirmEdit: "confirmEdit",
    cancelEdit: "cancelEdit",
    deleteEdit: "deleteEdit"
  });

  const EDIT_KEYBOARD = Object.freeze({
    Enter: VISUAL_INTENTS.confirmEdit,
    Escape: VISUAL_INTENTS.cancelEdit,
    Delete: VISUAL_INTENTS.deleteEdit
  });

  const PRESETS = {
    explorer: {
      name: "标准探索",
      hint: "左键使用 · 右键按 ASDF 视角展收 · CapsLock 详情 · 中键旋转 · Shift 魔杖",
      pointer: {
        nodePrimary: VISUAL_INTENTS.activate,
        fieldPrimary: null,
        nodeSecondary: VISUAL_INTENTS.applyViewMode,
        fieldSecondary: VISUAL_INTENTS.applyParentView,
        nodeMiddle: null,
        nodeMiddleDrag: VISUAL_INTENTS.orbit,
        nodeShiftPrimary: null,
        nodeAltPrimary: null,
        nodeDoublePrimary: VISUAL_INTENTS.activate,
        fieldDoublePrimary: null,
        nodeTriplePrimary: VISUAL_INTENTS.activate,
        fieldTriplePrimary: null,
        nodeDoubleSecondary: null,
        fieldDoubleSecondary: null,
        fieldMiddle: null,
        fieldMiddleDrag: VISUAL_INTENTS.orbit,
        fieldPrimaryDrag: null,
        fieldCtrlPrimary: VISUAL_INTENTS.createNode,
        nodeCtrlPrimary: VISUAL_INTENTS.editNode,
        nodeCtrlSecondary: VISUAL_INTENTS.editEdge,
        edgeCtrlSecondary: VISUAL_INTENTS.editEdge,
        wheel: VISUAL_INTENTS.dolly
      },
      keyboard: {
        KeyA: VISUAL_INTENTS.setNestedView,
        KeyS: VISUAL_INTENTS.setPeripheralView,
        KeyD: VISUAL_INTENTS.setHierarchyView,
        KeyF: VISUAL_INTENTS.setImmersiveView,
        KeyZ: VISUAL_INTENTS.backView,
        KeyX: VISUAL_INTENTS.forwardView,
        KeyO: VISUAL_INTENTS.toggleWorldLens,
        KeyH: VISUAL_INTENTS.toggleHelp,
        KeyP: VISUAL_INTENTS.toggleDemo,
        Escape: VISUAL_INTENTS.cancel,
        Home: VISUAL_INTENTS.returnOverview,
        End: VISUAL_INTENTS.expandToLeaves,
        PageUp: VISUAL_INTENTS.collapseHoveredCluster,
        PageDown: VISUAL_INTENTS.expandHoveredCluster,
        "Ctrl+KeyK": VISUAL_INTENTS.search
      },
      labels: {
        activate: "键盘确认 / Enter",
        summonMenu: "兼容星环 / M",
        peek: "兼容窥域 / P",
        focus: "左键单击聚焦 / F",
        clearFocus: "左键单击空白取消聚焦",
        activate: "左键双击使用 / Enter",
        toggleChildren: "右键单击展收 / R",
        toggleFieldChildren: "右键单击空白全域展收",
        toggleSurface: "中击球面 / L",
        toggleFieldSurfaces: "空域中击全体 / Shift + L",
        enter: "沉浸进入 / E",
        exit: "退出上层 / X",
        cancel: "Esc",
        grab: "Shift + 拖动节点",
        orbit: "空域拖动环绕",
        dolly: "滚轮缩放",
        backView: "B",
        forwardView: "V",
        toggleWorldLens: "O",
        toggleHelp: "H · 帮助",
        toggleDemo: "P · 演示",
        toggleClusterField: "兼容球团视野",
        cycleViewMode: "切换视角 / CapsLock",
        applyViewMode: "应用当前视角 / 右键单击",
        returnOverview: "Home",
        expandToLeaves: "End",
        focus: "键盘聚焦 / F",
        activate: "左键单击 / 双击 / 三击使用",
        applyParentView: "右键空白返回直接母节点",
        cycleDetailMode: "中键切换详情模式",
        setPeripheralView: "S · 外围",
        setNestedView: "A · 内包",
        setHierarchyView: "D · 层级",
        setImmersiveView: "F · 沉浸",
        collapseHoveredCluster: "PageUp · 光标所指团单层收缩（内包模式）",
        expandHoveredCluster: "PageDown · 光标所指团单层展开（内包模式）"
      }
    },
    oneHand: {
      name: "单手试验",
      hint: "左键使用 · 右键按 ASDF 视角展收 · CapsLock 详情 · 中键旋转 · Shift 魔杖",
      pointer: {
        nodePrimary: VISUAL_INTENTS.activate,
        fieldPrimary: null,
        nodeSecondary: VISUAL_INTENTS.applyViewMode,
        fieldSecondary: VISUAL_INTENTS.applyParentView,
        nodeMiddle: null,
        nodeMiddleDrag: VISUAL_INTENTS.orbit,
        nodeShiftPrimary: null,
        nodeAltPrimary: null,
        nodeDoublePrimary: VISUAL_INTENTS.activate,
        fieldDoublePrimary: null,
        nodeTriplePrimary: VISUAL_INTENTS.activate,
        fieldTriplePrimary: null,
        nodeDoubleSecondary: null,
        fieldDoubleSecondary: null,
        fieldMiddle: null,
        fieldMiddleDrag: VISUAL_INTENTS.orbit,
        fieldPrimaryDrag: null,
        fieldCtrlPrimary: VISUAL_INTENTS.createNode,
        nodeCtrlPrimary: VISUAL_INTENTS.editNode,
        nodeCtrlSecondary: VISUAL_INTENTS.editEdge,
        edgeCtrlSecondary: VISUAL_INTENTS.editEdge,
        wheel: VISUAL_INTENTS.dolly
      },
      keyboard: {
        KeyA: VISUAL_INTENTS.setNestedView,
        KeyS: VISUAL_INTENTS.setPeripheralView,
        KeyD: VISUAL_INTENTS.setHierarchyView,
        KeyF: VISUAL_INTENTS.setImmersiveView,
        KeyZ: VISUAL_INTENTS.backView,
        KeyX: VISUAL_INTENTS.forwardView,
        KeyO: VISUAL_INTENTS.toggleWorldLens,
        KeyH: VISUAL_INTENTS.toggleHelp,
        KeyP: VISUAL_INTENTS.toggleDemo,
        Escape: VISUAL_INTENTS.cancel,
        Home: VISUAL_INTENTS.returnOverview,
        End: VISUAL_INTENTS.expandToLeaves,
        PageUp: VISUAL_INTENTS.collapseHoveredCluster,
        PageDown: VISUAL_INTENTS.expandHoveredCluster,
        "Ctrl+KeyK": VISUAL_INTENTS.search
      },
      labels: {
        activate: "键盘确认 / Enter",
        summonMenu: "兼容星环 / Shift + M",
        peek: "兼容窥域 / P",
        focus: "左键单击聚焦 / F",
        clearFocus: "左键单击空白取消聚焦",
        activate: "左键双击使用 / Enter",
        toggleChildren: "右键单击展收 / R",
        toggleFieldChildren: "右键单击空白全域展收",
        toggleSurface: "中击球面 / L",
        toggleFieldSurfaces: "空域中击全体 / Shift + L",
        enter: "沉浸进入 / E",
        exit: "退出上层 / X",
        cancel: "Esc",
        grab: "Alt + 拖动节点",
        orbit: "空域拖动环绕",
        dolly: "滚轮缩放",
        backView: "B",
        forwardView: "V",
        toggleWorldLens: "O",
        toggleHelp: "H · 帮助",
        toggleDemo: "P · 演示",
        toggleClusterField: "兼容球团视野",
        cycleViewMode: "切换视角 / CapsLock",
        applyViewMode: "应用当前视角 / 右键单击",
        returnOverview: "Home",
        expandToLeaves: "End",
        focus: "键盘聚焦 / F",
        activate: "左键单击 / 双击 / 三击使用",
        applyParentView: "右键空白返回直接母节点",
        cycleDetailMode: "中键切换详情模式",
        setPeripheralView: "S · 外围",
        setNestedView: "A · 内包",
        setHierarchyView: "D · 层级",
        setImmersiveView: "F · 沉浸",
        collapseHoveredCluster: "PageUp · 光标所指团单层收缩（内包模式）",
        expandHoveredCluster: "PageDown · 光标所指团单层展开（内包模式）"
      }
    }
  };

  let activePreset = "explorer";
  const keyboardOverrides = {
    explorer: new Map(),
    oneHand: new Map()
  };

  function current() {
    return PRESETS[activePreset];
  }

  function resolvePointer(event, context) {
    const bindings = current().pointer;
    const onNode = Boolean(context && context.onNode);
    const onEdge = Boolean(context && context.onEdge);
    const edgeDraft = Boolean(context && context.edgeDraft);
    if (
      event.ctrlKey
      && context
      && (context.gesture === "down" || context.gesture === "tap")
    ) {
      if (event.button === 0) {
        return onNode ? bindings.nodeCtrlPrimary : bindings.fieldCtrlPrimary;
      }
      if (event.button === 2 && (onNode || onEdge || edgeDraft)) {
        return onEdge ? bindings.edgeCtrlSecondary : bindings.nodeCtrlSecondary;
      }
      return null;
    }
    if (context && context.gesture === "triple" && event.button === 0) {
      return onNode ? bindings.nodeTriplePrimary || null : bindings.fieldTriplePrimary || null;
    }
    if (context && context.gesture === "double" && event.button === 0) {
      return onNode ? bindings.nodeDoublePrimary || null : bindings.fieldDoublePrimary || null;
    }
    if (context && context.gesture === "double" && event.button === 2) {
      return onNode ? bindings.nodeDoubleSecondary || null : bindings.fieldDoubleSecondary || null;
    }
    if (
      context
      && (context.gesture === "down" || context.gesture === "tap")
      && onNode
      && event.button === 0
      && event.detail > 1
    ) {
      return null;
    }
    if (context && context.gesture === "wheel") {
      return bindings.wheel;
    }
    if (context && context.gesture === "drag") {
      if (event.button === 1) {
        return onNode ? bindings.nodeMiddleDrag || null : bindings.fieldMiddleDrag || null;
      }
      if (!onNode && event.button === 0) {
        return bindings.fieldPrimaryDrag || null;
      }
      if (onNode && event.button === 0 && event.shiftKey) {
        return bindings.nodeShiftPrimary || null;
      }
      if (onNode && event.button === 0 && (event.altKey || event.metaKey)) {
        return bindings.nodeAltPrimary || null;
      }
      return null;
    }
    if (!onNode && event.button === 0) {
      return bindings.fieldPrimary || null;
    }
    if (!onNode && event.button === 1) {
      return bindings.fieldMiddle;
    }
    if (onNode && event.button === 0 && event.shiftKey) {
      return bindings.nodeShiftPrimary;
    }
    if (onNode && event.button === 0 && (event.altKey || event.metaKey)) {
      return bindings.nodeAltPrimary;
    }
    if (onNode && event.button === 0) {
      return bindings.nodePrimary;
    }
    if (onNode && event.button === 1) {
      return bindings.nodeMiddle;
    }
    if (onNode && event.button === 2) {
      return bindings.nodeSecondary;
    }
    if (!onNode && event.button === 2) {
      return bindings.fieldSecondary || null;
    }
    return null;
  }

  function chordFromEvent(event) {
    const modifiers = [];
    if (event.ctrlKey) modifiers.push("Ctrl");
    if (event.metaKey) modifiers.push("Meta");
    if (event.altKey) modifiers.push("Alt");
    if (event.shiftKey) modifiers.push("Shift");
    return [...modifiers, event.code].filter(Boolean).join("+");
  }

  function validChord(chord) {
    return typeof chord === "string"
      && /^(?:(?:Ctrl|Meta|Alt|Shift)\+)*(?:Key[A-Z]|Digit[0-9]|Enter|Escape|Delete|Backspace|Space|Home|End|CapsLock|ArrowLeft|ArrowRight)$/.test(chord);
  }

  function configuredIntentForChord(chord, map) {
    const overrides = keyboardOverrides[activePreset];
    for (const [intent, overrideChord] of overrides.entries()) {
      if (overrideChord === chord) return intent;
    }
    const defaultIntent = map[chord] || null;
    if (defaultIntent && overrides.has(defaultIntent)) return null;
    return defaultIntent;
  }

  function resolveKeyboard(event, context) {
    if (event.repeat) return null;
    if (
      !(context && context.editing)
      && event.code === "CapsLock"
      && event.type === "keyup"
      && typeof event.getModifierState === "function"
    ) {
      return event.getModifierState("CapsLock")
        ? VISUAL_INTENTS.setSurfaceDetails
        : VISUAL_INTENTS.setFloatingDetails;
    }
    const chord = chordFromEvent(event);
    const map = context && context.editing ? EDIT_KEYBOARD : current().keyboard;
    const exact = configuredIntentForChord(chord, map);
    if (exact) return exact;
    if (event.ctrlKey || event.metaKey || event.altKey) return null;
    if (event.shiftKey) {
      const shifted = configuredIntentForChord(`Shift+${event.code}`, map);
      if (shifted) return shifted;
    }
    return configuredIntentForChord(event.code, map);
  }

  function setPreset(name) {
    if (!PRESETS[name]) {
      return false;
    }
    activePreset = name;
    global.dispatchEvent(new CustomEvent("spatial-input-config-changed", {
      detail: { preset: name, config: current() }
    }));
    return true;
  }

  function describe() {
    return Object.entries(current().labels).map(([intent, binding]) => ({ intent, binding }));
  }

  function defaultChordForIntent(intent) {
    const editEntry = Object.entries(EDIT_KEYBOARD).find(([, value]) => value === intent);
    const keyboardEntry = Object.entries(current().keyboard).find(([, value]) => value === intent);
    return keyboardOverrides[activePreset].get(intent)
      || (editEntry && editEntry[0])
      || (keyboardEntry && keyboardEntry[0])
      || "";
  }

  function keyboardItem(intent, label) {
    return {
      intent,
      label,
      binding: defaultChordForIntent(intent),
      device: "keyboard",
      editable: true
    };
  }

  function pointerItem(intent, label, binding) {
    return { intent, label, binding, device: "pointer", editable: false };
  }

  function describeGroups() {
    return [
      {
        id: "location",
        label: "空间定位",
        items: [
          keyboardItem(VISUAL_INTENTS.search, "空间搜索"),
          keyboardItem(VISUAL_INTENTS.toggleWorldLens, "域径图"),
          keyboardItem(VISUAL_INTENTS.returnOverview, "返回全域"),
          keyboardItem(VISUAL_INTENTS.toggleHelp, "操作帮助"),
          keyboardItem(VISUAL_INTENTS.toggleDemo, "自动演示")
        ]
      },
      {
        id: "view",
        label: "视角",
        items: [
          keyboardItem(VISUAL_INTENTS.setPeripheralView, "外围"),
          keyboardItem(VISUAL_INTENTS.setNestedView, "内包"),
          keyboardItem(VISUAL_INTENTS.setHierarchyView, "层级"),
          keyboardItem(VISUAL_INTENTS.setImmersiveView, "沉浸"),
          keyboardItem(VISUAL_INTENTS.collapseHoveredCluster, "光标所指团单层收缩（内包模式）"),
          keyboardItem(VISUAL_INTENTS.expandHoveredCluster, "光标所指团单层展开（内包模式）"),
          pointerItem(VISUAL_INTENTS.orbit, "旋转视角", "按住鼠标中键移动"),
          pointerItem(VISUAL_INTENTS.dolly, "远近缩放", "滚轮"),
          keyboardItem(VISUAL_INTENTS.backView, "视图后退"),
          keyboardItem(VISUAL_INTENTS.forwardView, "视图前进")
        ]
      },
      {
        id: "use",
        label: "节点使用",
        items: [
          pointerItem(VISUAL_INTENTS.applyViewMode, "当前视角动作", "右键单击"),
          pointerItem(VISUAL_INTENTS.applyParentView, "返回直接母节点", "右键单击子域空白"),
          pointerItem(VISUAL_INTENTS.activate, "使用承载", "左键单击 / 双击 / 三击"),
          keyboardItem(VISUAL_INTENTS.setSurfaceDetails, "镜面详情（CapsLock 大写）"),
          keyboardItem(VISUAL_INTENTS.setFloatingDetails, "透明页详情（CapsLock 小写）")
        ]
      },
      {
        id: "node-edit",
        label: "节点编辑",
        items: [
          pointerItem(VISUAL_INTENTS.createNode, "新增节点", "Ctrl + 左键空白"),
          pointerItem(VISUAL_INTENTS.editNode, "编辑节点", "Ctrl + 左键节点"),
          keyboardItem(VISUAL_INTENTS.confirmEdit, "提交更新"),
          keyboardItem(VISUAL_INTENTS.cancelEdit, "取消更新"),
          keyboardItem(VISUAL_INTENTS.deleteEdit, "删除预警")
        ]
      },
      {
        id: "edge-edit",
        label: "关系编辑",
        items: [
          pointerItem(VISUAL_INTENTS.editEdge, "起点 / 落脚 / 选线", "Ctrl + 右键"),
          keyboardItem(VISUAL_INTENTS.confirmEdit, "确认关系"),
          keyboardItem(VISUAL_INTENTS.cancelEdit, "取消关系"),
          keyboardItem(VISUAL_INTENTS.deleteEdit, "删除关系")
        ]
      },
      {
        id: "batch",
        label: "批量视角",
        items: [
          pointerItem(VISUAL_INTENTS.applyViewMode, "木杖轨迹", "Shift + 右键绘制"),
          pointerItem(VISUAL_INTENTS.applyViewMode, "五角星全域", "Shift + 右键绘制五角星"),
          pointerItem(VISUAL_INTENTS.applyViewMode, "玉杖递归切换", "三击 Shift")
        ]
      }
    ].map((group) => ({ ...group, items: group.items.map((item) => ({ ...item })) }));
  }

  function setKeyboardBinding(intent, chord) {
    if (!Object.values(VISUAL_INTENTS).includes(intent) || !validChord(chord)) return false;
    const overrides = keyboardOverrides[activePreset];
    for (const [existingIntent, existingChord] of overrides.entries()) {
      if (existingChord === chord && existingIntent !== intent) overrides.delete(existingIntent);
    }
    overrides.set(intent, chord);
    global.dispatchEvent(new CustomEvent("spatial-input-config-changed", {
      detail: { preset: activePreset, intent, chord, config: current() }
    }));
    return true;
  }

  global.SpatialInputConfig = Object.freeze({
    intents: VISUAL_INTENTS,
    presets: PRESETS,
    adapters: Object.freeze({
      active: ["pointer", "keyboard"],
      reserved: ["touch", "trackpad", "gamepad", "webxr", "gaze-gesture"]
    }),
    get activePreset() {
      return activePreset;
    },
    current,
    describe,
    describeGroups,
    resolvePointer,
    resolveKeyboard,
    setPreset,
    setKeyboardBinding,
    chordFromEvent
  });
})(window);
