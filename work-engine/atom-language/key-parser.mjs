import { diagnostic } from './errors.mjs';
import {
  GRAPH_AXIS_SET,
  RETIRED_GRAPH_AXES,
  validateSupportTypes
} from './graph-schema.mjs';
import { createActionRegistry, createMatcherRegistry } from './registry.mjs';

const LEFT_ENGINEERING_SYMBOLS = new Set(['@', '$', '~']);

function parseCommandSegment(symbol, raw) {
  if (symbol === '@') {
    return { symbol, raw, name: raw, parameter: null };
  }
  const numbered = raw.match(/^(.+?)([+-]?\d+)$/u);
  const numericParameter = numbered ? Number(numbered[2]) : null;
  return {
    symbol,
    raw,
    name: numbered ? numbered[1] : raw,
    parameter: numbered
      ? (Number.isSafeInteger(numericParameter) ? numericParameter : numbered[2])
      : null
  };
}

function splitLeftSide(left) {
  let baseEnd = left.length;
  for (let index = 0; index < left.length; index += 1) {
    if (LEFT_ENGINEERING_SYMBOLS.has(left[index])) {
      baseEnd = index;
      break;
    }
  }
  const baseKey = left.slice(0, baseEnd);
  const sections = [];
  let index = baseEnd;
  while (index < left.length) {
    const symbol = left[index];
    let end = index + 1;
    while (end < left.length && !LEFT_ENGINEERING_SYMBOLS.has(left[end])) end += 1;
    sections.push({ symbol, raw: left.slice(index + 1, end) });
    index = end;
  }
  return { baseKey, sections };
}

function persistentKey(baseKey, types, descriptionPresent, description) {
  const typeText = types.map((type) => `@${type.raw}`).join('');
  const descriptionText = descriptionPresent ? `#${description}` : '';
  return `${baseKey}${typeText}${descriptionText}`;
}

function actionParameterError(action, definition) {
  if (definition.parameter === 'retiredRoute') {
    return diagnostic(
      'RETIRED_ROUTE_ACTION',
      `路线 $${action.name} 已停用；请改用 contain$latitude+1、contain$latitude-1、contain$longitude+1 或 contain$longitude-1（数字可调整）`,
      { action: action.name }
    );
  }
  if (definition.parameter === 'none' && action.parameter !== null) {
    return diagnostic(
      'INVALID_ACTION_PARAMETER',
      `动作 $${action.name} 不接受数字参数`,
      { action: action.name, parameter: action.parameter }
    );
  }
  if (definition.parameter === 'nonNegativeInteger'
    && (!Number.isSafeInteger(action.parameter) || action.parameter < 0)) {
    return diagnostic(
      'INVALID_ACTION_PARAMETER',
      `动作 $${action.name} 需要非负整数参数`,
      { action: action.name, parameter: action.parameter }
    );
  }
  if (definition.parameter === 'integer' && !Number.isSafeInteger(action.parameter)) {
    return diagnostic(
      'INVALID_ACTION_PARAMETER',
      `动作 $${action.name} 需要有符号整数参数`,
      { action: action.name, parameter: action.parameter }
    );
  }
  return null;
}

/**
 * Parse one already-decoded JSON key. The first # is removed before any
 * engineering-symbol dispatch, so its right side can never become a command.
 */
export function parseAtomKey(rawKey, options = {}) {
  const matcherRegistry = options.matcherRegistry ?? createMatcherRegistry();
  const actionRegistry = options.actionRegistry ?? createActionRegistry();
  const descriptionSymbolWarnings = options.descriptionSymbolWarnings !== false;
  const warnings = [];
  const errors = [];

  if (typeof rawKey !== 'string') {
    return {
      rawKey,
      baseKey: null,
      types: [],
      actions: [],
      hints: [],
      descriptionPresent: false,
      description: null,
      matcher: null,
      persistentKey: null,
      warnings,
      errors: [diagnostic('INVALID_GRAPH_KEY', 'Graph 键必须是字符串')]
    };
  }

  const hashIndex = rawKey.indexOf('#');
  const descriptionPresent = hashIndex >= 0;
  const description = descriptionPresent ? rawKey.slice(hashIndex + 1) : null;
  const left = descriptionPresent ? rawKey.slice(0, hashIndex) : rawKey;

  if (descriptionPresent && descriptionSymbolWarnings
    && ['@', '$', '~'].some((symbol) => description.includes(symbol))) {
    warnings.push(diagnostic(
      'DESCRIPTION_NOT_LAST',
      '简介应放在最后；# 右侧仍全部按简介原文处理',
      { rawKey }
    ));
  }

  const { baseKey, sections } = splitLeftSide(left);
  if (!baseKey) {
    errors.push(diagnostic('INVALID_GRAPH_KEY', '基础 Graph 键不能为空', { rawKey }));
  } else if (Object.hasOwn(RETIRED_GRAPH_AXES, baseKey)) {
    errors.push(diagnostic(
      'RETIRED_GRAPH_AXIS',
      `Graph 轴 ${baseKey} 已停用；请改用 ${RETIRED_GRAPH_AXES[baseKey]}`,
      { rawKey, baseKey, replacement: RETIRED_GRAPH_AXES[baseKey] }
    ));
  } else if (!GRAPH_AXIS_SET.has(baseKey)) {
    errors.push(diagnostic(
      'UNKNOWN_GRAPH_FIELD',
      `未知基础 Graph 键：${baseKey}`,
      { rawKey, baseKey }
    ));
  }

  const types = [];
  const actions = [];
  const hints = [];
  for (const section of sections) {
    const command = parseCommandSegment(section.symbol, section.raw);
    if (!command.name) {
      errors.push(diagnostic(
        'EMPTY_SYMBOL_SECTION',
        `工程符号 ${section.symbol} 后缺少命令或参数`,
        { rawKey, symbol: section.symbol }
      ));
      continue;
    }
    if (section.symbol === '@') types.push(command);
    if (section.symbol === '$') actions.push(command);
    if (section.symbol === '~') hints.push(command);
  }

  if (baseKey === 'thing'
    && options.allowRetiredAgentKey === false
    && types.some((type) => type.raw === 'agent')) {
    errors.push(diagnostic(
      'RETIRED_AGENT_KEY_TYPE',
      'Agent 不再是 Key 类型；请使用包含一个顶层字面量 agent({...}) 的 thing@program',
      {
        rawKey,
        replacement: 'thing@program with one literal agent({...}) declaration',
        details: { rawKey, replacement: 'thing@program with one literal agent({...}) declaration' }
      }
    ));
  }

  if (baseKey === 'support') {
    const markerError = validateSupportTypes(types);
    if (markerError) errors.push(diagnostic(markerError.code, markerError.message, {
      rawKey,
      markers: markerError.markers
    }));
  }

  let matcher = null;
  if (baseKey === 'thing') {
    if (actions.length > 1) {
      errors.push(diagnostic(
        'MULTIPLE_MATCHERS',
        'name 一次只能声明一个匹配模式',
        { modes: actions.map((action) => action.name) }
      ));
    }
    const mode = actions[0]?.name ?? 'exact';
    const registered = matcherRegistry.resolve(mode) !== null;
    matcher = { mode, explicit: actions.length > 0, registered };
    if (!registered) {
      errors.push(diagnostic(
        'UNSUPPORTED_MATCHER',
        `不支持此匹配模式：${mode}`,
        { mode }
      ));
    } else if (actions[0]?.parameter !== null && actions[0] !== undefined) {
      errors.push(diagnostic(
        'INVALID_MATCHER_PARAMETER',
        `匹配模式 ${mode} 不接受数字参数`,
        { mode, parameter: actions[0].parameter }
      ));
    }
  } else {
    for (const action of actions) {
      const definition = actionRegistry.resolve(baseKey, action.name);
      if (!definition) {
        errors.push(diagnostic(
          'UNKNOWN_ACTION',
          `未知 $ 动作：${baseKey}$${action.raw}`,
          { baseKey, action: action.name }
        ));
        continue;
      }
      const parameterError = actionParameterError(action, definition);
      if (parameterError) errors.push(parameterError);
    }
  }

  const parsed = {
    rawKey,
    baseKey,
    types,
    actions,
    hints,
    descriptionPresent,
    description,
    matcher,
    persistentKey: persistentKey(baseKey, types, descriptionPresent, description),
    warnings,
    errors
  };
  return parsed;
}
