(function spatialEntityRegistry(global) {
  "use strict";

  const DEFINITION_FIELDS = Object.freeze([
    "id",
    "label",
    "short",
    "description",
    "preview",
    "position",
    "radius",
    "hasChildren",
    "visualLinks",
    "preferredIntent",
    "capabilities",
    "visualBudget"
  ]);

  const COMMAND_FIELDS = Object.freeze([
    "id",
    "label",
    "inactiveLabel",
    "activeLabel",
    "short",
    "description",
    "intent",
    "preview",
    "order",
    "radiusScale",
    "preferredAngle",
    "requiresCapability",
    "stateFlag",
    "visualBudget"
  ]);

  const CAPABILITY_FIELDS = Object.freeze([
    "body",
    "portal",
    "lens",
    "halo",
    "focusField",
    "satellites",
    "grabbable",
    "semanticScale",
    "worldLens"
  ]);

  const COMMAND_STATE_FLAGS = Object.freeze([
    "peekOpen",
    "revealed",
    "lensOpen",
    "pinned",
    "worldLensOpen"
  ]);

  const VISUAL_BUDGET_FIELDS = Object.freeze([
    "importance",
    "renderCost",
    "labelPriority",
    "maxSatellites",
    "maxVisibleDepth"
  ]);

  const VISUAL_INTENTS = Object.freeze([
    "aim",
    "focus",
    "activate",
    "alternateActivate",
    "orbit",
    "dolly",
    "peek",
    "enter",
    "exit",
    "exitToDepth",
    "cancel",
    "reveal",
    "collapse",
    "inspect",
    "summonMenu",
    "grab",
    "release",
    "pin",
    "backView",
    "forwardView",
    "returnOverview",
    "toggleWorldLens",
    "resetView",
    "nextFocus",
    "previousFocus",
    "toggleChildren",
    "toggleSurface",
    "toggleFieldSurfaces"
  ]);

  const DEFAULT_CAPABILITIES = Object.freeze({
    body: true,
    portal: true,
    lens: true,
    halo: true,
    focusField: true,
    satellites: true,
    grabbable: true,
    semanticScale: true,
    worldLens: true
  });

  const DEFAULT_VISUAL_BUDGET = Object.freeze({
    importance: 1,
    renderCost: 1,
    labelPriority: 0.7,
    maxSatellites: 6,
    maxVisibleDepth: 3
  });

  const definitions = new Map();
  const definitionOrder = [];
  const rootKeys = [];
  const commands = new Map();
  const commandOrder = [];

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function safeKey(value) {
    if (typeof value !== "string") {
      return null;
    }
    const key = value.trim();
    if (!key || key.length > 80 || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(key)) {
      return null;
    }
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      return null;
    }
    return key;
  }

  function safeText(value, fallback, maximumLength) {
    if (typeof value !== "string") {
      return fallback;
    }
    const text = value.trim();
    return text ? text.slice(0, maximumLength) : fallback;
  }

  function safeVisualToken(value, fallback) {
    if (typeof value !== "string") {
      return fallback;
    }
    const token = value.trim();
    return /^[a-zA-Z][a-zA-Z0-9._:-]{0,63}$/.test(token) ? token : fallback;
  }

  function sanitizePosition(position) {
    const source = position || {};
    return Object.freeze({
      x: clamp(finiteNumber(source.x, 0), -10000, 10000),
      y: clamp(finiteNumber(source.y, 0), -10000, 10000),
      z: clamp(finiteNumber(source.z, 0), -10000, 10000)
    });
  }

  function sanitizeCapabilities(capabilities) {
    const source = capabilities || {};
    const sanitized = {};
    for (const field of CAPABILITY_FIELDS) {
      sanitized[field] = typeof source[field] === "boolean"
        ? source[field]
        : Boolean(DEFAULT_CAPABILITIES[field]);
    }
    return Object.freeze(sanitized);
  }

  function sanitizeVisualBudget(visualBudget) {
    const source = typeof visualBudget === "number"
      ? { importance: visualBudget }
      : visualBudget || {};
    return Object.freeze({
      importance: clamp(finiteNumber(source.importance, DEFAULT_VISUAL_BUDGET.importance), 0, 10),
      renderCost: clamp(finiteNumber(source.renderCost, DEFAULT_VISUAL_BUDGET.renderCost), 0.05, 100),
      labelPriority: clamp(finiteNumber(source.labelPriority, DEFAULT_VISUAL_BUDGET.labelPriority), 0, 1),
      maxSatellites: Math.floor(clamp(
        finiteNumber(source.maxSatellites, DEFAULT_VISUAL_BUDGET.maxSatellites),
        0,
        64
      )),
      maxVisibleDepth: Math.floor(clamp(
        finiteNumber(source.maxVisibleDepth, DEFAULT_VISUAL_BUDGET.maxVisibleDepth),
        0,
        16
      ))
    });
  }

  function sanitizeIntent(intent, fallback) {
    return VISUAL_INTENTS.includes(intent) ? intent : fallback;
  }

  function sanitizeVisualLinks(key, visualLinks) {
    if (!Array.isArray(visualLinks)) {
      return Object.freeze([]);
    }
    const sanitized = [];
    for (const candidate of visualLinks) {
      const linkedKey = safeKey(candidate);
      if (!linkedKey || linkedKey === key || sanitized.includes(linkedKey)) {
        continue;
      }
      sanitized.push(linkedKey);
      if (sanitized.length === 12) {
        break;
      }
    }
    return Object.freeze(sanitized);
  }

  function sanitizeDefinition(key, definition) {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      return null;
    }
    const label = safeText(definition.label, "", 80);
    if (!label) {
      return null;
    }
    return Object.freeze({
      id: key,
      label,
      short: safeText(definition.short, key.toUpperCase(), 24),
      description: safeText(definition.description, "", 320),
      preview: safeVisualToken(definition.preview, "orbit"),
      position: sanitizePosition(definition.position),
      radius: clamp(finiteNumber(definition.radius, 0.8), 0.05, 100),
      hasChildren: Object.prototype.hasOwnProperty.call(definition, "hasChildren")
        ? Boolean(definition.hasChildren)
        : true,
      visualLinks: sanitizeVisualLinks(key, definition.visualLinks),
      preferredIntent: sanitizeIntent(definition.preferredIntent, "focus"),
      capabilities: sanitizeCapabilities(definition.capabilities),
      visualBudget: sanitizeVisualBudget(definition.visualBudget)
    });
  }

  function sanitizeCommand(key, command) {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      return null;
    }
    const intent = sanitizeIntent(command.intent, null);
    const label = safeText(command.label, "", 48);
    if (!intent || !label) {
      return null;
    }
    const stateFlag = COMMAND_STATE_FLAGS.includes(command.stateFlag) ? command.stateFlag : null;
    const requiredCapability = CAPABILITY_FIELDS.includes(command.requiresCapability)
      ? command.requiresCapability
      : null;
    return Object.freeze({
      id: key,
      label,
      inactiveLabel: safeText(command.inactiveLabel, label, 48),
      activeLabel: safeText(command.activeLabel, label, 48),
      short: safeText(command.short, intent.toUpperCase(), 24),
      description: safeText(command.description, "", 240),
      intent,
      preview: safeVisualToken(command.preview, "command"),
      order: clamp(finiteNumber(command.order, commandOrder.length), -1000, 1000),
      radiusScale: clamp(finiteNumber(command.radiusScale, 0.22), 0.05, 4),
      preferredAngle: Number.isFinite(command.preferredAngle) ? command.preferredAngle : null,
      requiresCapability: requiredCapability,
      stateFlag,
      visualBudget: sanitizeVisualBudget(command.visualBudget)
    });
  }

  function registerDefinition(key, definition, options) {
    const normalizedKey = safeKey(key);
    if (!normalizedKey) {
      return null;
    }
    const replace = Boolean(options && options.replace);
    if (definitions.has(normalizedKey) && !replace) {
      return null;
    }
    const sanitized = sanitizeDefinition(normalizedKey, definition);
    if (!sanitized) {
      return null;
    }
    const exists = definitions.has(normalizedKey);
    definitions.set(normalizedKey, sanitized);
    if (!exists) {
      definitionOrder.push(normalizedKey);
    }
    if (options && options.root && !rootKeys.includes(normalizedKey)) {
      rootKeys.push(normalizedKey);
    }
    return sanitized;
  }

  function registerCommand(key, command, options) {
    const normalizedKey = safeKey(key);
    if (!normalizedKey) {
      return null;
    }
    const replace = Boolean(options && options.replace);
    if (commands.has(normalizedKey) && !replace) {
      return null;
    }
    const sanitized = sanitizeCommand(normalizedKey, command);
    if (!sanitized) {
      return null;
    }
    const exists = commands.has(normalizedKey);
    commands.set(normalizedKey, sanitized);
    if (!exists) {
      commandOrder.push(normalizedKey);
    }
    return sanitized;
  }

  function get(key) {
    const normalizedKey = safeKey(key);
    return normalizedKey && definitions.has(normalizedKey) ? definitions.get(normalizedKey) : null;
  }

  function getCommand(key) {
    const normalizedKey = safeKey(key);
    return normalizedKey && commands.has(normalizedKey) ? commands.get(normalizedKey) : null;
  }

  function list() {
    return definitionOrder.map((key) => definitions.get(key)).filter(Boolean);
  }

  function listCommands() {
    return commandOrder
      .map((key) => commands.get(key))
      .filter(Boolean)
      .sort((first, second) => first.order - second.order);
  }

  function rootDefinitions() {
    return rootKeys.map((key) => definitions.get(key)).filter(Boolean);
  }

  function readVisualNodeState(node) {
    const source = node && typeof node === "object" ? node : {};
    const capabilities = source.capabilities && typeof source.capabilities === "object"
      ? source.capabilities
      : {};
    const visualState = {
      capabilities: {},
      flags: {}
    };
    for (const capability of CAPABILITY_FIELDS) {
      visualState.capabilities[capability] = Boolean(capabilities[capability]);
    }
    for (const flag of COMMAND_STATE_FLAGS) {
      visualState.flags[flag] = Boolean(source[flag]);
    }
    return visualState;
  }

  function commandsFor(node) {
    const visualState = readVisualNodeState(node);
    return listCommands()
      .filter((command) => (
        !command.requiresCapability
        || visualState.capabilities[command.requiresCapability]
      ))
      .map((command) => {
        const active = Boolean(command.stateFlag && visualState.flags[command.stateFlag]);
        return Object.freeze({
          id: command.id,
          intent: command.intent,
          label: command.stateFlag
            ? active ? command.activeLabel : command.inactiveLabel
            : command.label,
          short: command.short,
          description: command.description,
          preview: command.preview,
          order: command.order,
          radiusScale: command.radiusScale,
          preferredAngle: command.preferredAngle,
          requiresCapability: command.requiresCapability,
          stateFlag: command.stateFlag,
          active,
          visualBudget: command.visualBudget
        });
      });
  }

  const validationSeeds = [
    {
      key: "orbit",
      label: "轨道视域",
      short: "ORBIT",
      preview: "orbit",
      preferredIntent: "reveal",
      description: "对象保持在场，子节点以卫星显露；环绕与缩放维持全局上下文。",
      position: { x: -5.7, y: 1.7, z: -1.4 },
      radius: 0.82,
      hasChildren: true,
      visualLinks: ["portal", "lens"]
    },
    {
      key: "portal",
      label: "递归球域",
      short: "PORTAL",
      preview: "portal",
      preferredIntent: "enter",
      description: "深邃边界表明这里存在下一层场域；进入后仍是可继续深入的多球系。",
      position: { x: 4.2, y: 2.6, z: 2.9 },
      radius: 1.18,
      hasChildren: true,
      visualLinks: ["scale"]
    },
    {
      key: "lens",
      label: "球镜观察",
      short: "LENS",
      preview: "lens",
      preferredIntent: "inspect",
      description: "把细节、剖面与远处结构映入球镜，不离开当前空间。",
      position: { x: -1.5, y: -2.6, z: 1 },
      radius: 0.76,
      hasChildren: false,
      visualLinks: ["workbench"]
    },
    {
      key: "scale",
      label: "语义尺度",
      short: "SCALE",
      preview: "scale",
      preferredIntent: "focus",
      description: "远看是信标，靠近出现名称、轮廓与独立球面展示。",
      position: { x: 6, y: -1.8, z: 0.8 },
      radius: 0.92,
      hasChildren: false,
      visualLinks: ["cluster"]
    },
    {
      key: "cluster",
      label: "群簇展开",
      short: "CLUSTER",
      preview: "cluster",
      preferredIntent: "reveal",
      description: "聚合载体在原位拆成节点群，避免用表格行列承载关系。",
      position: { x: -5.9, y: -2.9, z: 2.3 },
      radius: 0.86,
      hasChildren: true,
      visualLinks: ["halo"]
    },
    {
      key: "halo",
      label: "命令星环",
      short: "HALO",
      preview: "menu",
      preferredIntent: "summonMenu",
      description: "命令围绕当前焦点附着；物理按键只负责唤出，不绑定功能。",
      position: { x: 1.2, y: 0, z: 3.1 },
      radius: 1.07,
      hasChildren: false,
      visualLinks: []
    },
    {
      key: "workbench",
      label: "空间工作台",
      short: "BENCH",
      preview: "workbench",
      preferredIntent: "focus",
      description: "节点可抓取、移动、固定与编排，变化只作用于当前视图。",
      position: { x: -0.8, y: 3.8, z: 4 },
      radius: 1.22,
      hasChildren: true,
      visualLinks: ["portal"]
    }
  ];

  validationSeeds.forEach((seed) => {
    registerDefinition(seed.key, {
      label: seed.label,
      short: seed.short,
      description: seed.description,
      preview: seed.preview,
      position: seed.position,
      radius: seed.radius,
      hasChildren: seed.hasChildren,
      visualLinks: seed.visualLinks,
      preferredIntent: seed.preferredIntent,
      capabilities: DEFAULT_CAPABILITIES,
      visualBudget: DEFAULT_VISUAL_BUDGET
    }, { root: true });
  });

  [
    {
      key: "focus",
      label: "聚焦",
      intent: "focus",
      order: 10,
      requiresCapability: "focusField"
    },
    {
      key: "peek",
      label: "窥域",
      inactiveLabel: "窥域",
      activeLabel: "收窥",
      intent: "peek",
      order: 20,
      requiresCapability: "portal",
      stateFlag: "peekOpen"
    },
    {
      key: "reveal",
      label: "展开",
      inactiveLabel: "展开",
      activeLabel: "收圈",
      intent: "reveal",
      order: 30,
      requiresCapability: "satellites",
      stateFlag: "revealed"
    },
    {
      key: "enter",
      label: "进入",
      intent: "enter",
      order: 40,
      requiresCapability: "portal"
    },
    {
      key: "inspect",
      label: "球镜",
      inactiveLabel: "球镜",
      activeLabel: "关镜",
      intent: "inspect",
      order: 50,
      requiresCapability: "lens",
      stateFlag: "lensOpen"
    },
    {
      key: "pin",
      label: "固定",
      inactiveLabel: "固定",
      activeLabel: "解锁",
      intent: "pin",
      order: 60,
      requiresCapability: "grabbable",
      stateFlag: "pinned"
    },
    {
      key: "collapse",
      label: "收起",
      intent: "collapse",
      order: 70,
      requiresCapability: "body"
    }
  ].forEach((command) => registerCommand(command.key, command));

  global.SpatialEntityRegistry = Object.freeze({
    version: "0.1.0",
    allowedDefinitionFields: DEFINITION_FIELDS,
    allowedCommandFields: COMMAND_FIELDS,
    allowedCapabilityFields: CAPABILITY_FIELDS,
    allowedCommandStateFlags: COMMAND_STATE_FLAGS,
    allowedVisualBudgetFields: VISUAL_BUDGET_FIELDS,
    visualIntents: VISUAL_INTENTS,
    defaultCapabilities: DEFAULT_CAPABILITIES,
    defaultVisualBudget: DEFAULT_VISUAL_BUDGET,
    registerDefinition,
    registerCommand,
    list,
    get,
    rootDefinitions,
    listCommands,
    getCommand,
    commandsFor
  });
})(window);
