import { diagnostic } from './errors.mjs';
import { parseAtomKey } from './key-parser.mjs';

export const TRANSFORM_COMMANDS = Object.freeze([
  'rep',
  'sum',
  'typ',
  'ren',
  'lnk',
  'mov',
  'cpy',
  'dsc',
  'rst',
  'run'
]);

const COMMAND_AXES = Object.freeze({
  rep: new Set(['situation', 'strut']),
  sum: new Set(['situation']),
  typ: new Set(['thing']),
  ren: new Set(['thing']),
  lnk: new Set(['thing']),
  mov: new Set(['thing']),
  cpy: new Set(['thing']),
  dsc: new Set(['thing']),
  rst: new Set(['thing']),
  run: new Set(['thing'])
});

const MARKER_PATTERN = new RegExp(
  `\\.(${TRANSFORM_COMMANDS.join('|')})\\.`,
  'gu'
);

const ACT_LABEL_PATTERN = /^[\p{L}\p{N}]+$/u;

function parseActionPayload(action, definition) {
  const separatorIndex = action.raw.indexOf('=');
  if (definition.payload !== 'labelPacket') {
    if (separatorIndex >= 0) {
      return {
        error: diagnostic(
          'INVALID_TRANSFORM_ACTION_PAYLOAD',
          `Transform 动作 ${definition.baseKey}$${definition.name} 不接受标签包`,
          { baseKey: definition.baseKey, action: definition.name }
        )
      };
    }
    return { payload: null };
  }
  if (separatorIndex < 0) {
    return {
      error: diagnostic(
        'INVALID_TRANSFORM_ACTION_PAYLOAD',
        `Transform 动作 ${definition.baseKey}$${definition.name}= 需要至少一个标签`,
        { baseKey: definition.baseKey, action: definition.name }
      )
    };
  }
  const labels = action.raw.slice(separatorIndex + 1).split('|');
  const invalid = labels.find((label) => !ACT_LABEL_PATTERN.test(label));
  if (invalid !== undefined || new Set(labels).size !== labels.length) {
    return {
      error: diagnostic(
        'INVALID_TRANSFORM_ACTION_PAYLOAD',
        'act 标签必须是唯一的非空文字或数字，且只能用 | 分隔',
        { baseKey: definition.baseKey, action: definition.name, labels }
      )
    };
  }
  return { payload: Object.freeze({ labels: Object.freeze(labels) }) };
}

function labelPacketBoundaryErrors(rawKey, baseKey, actionRegistry) {
  if (typeof actionRegistry?.entries !== 'function') return [];
  const errors = [];
  for (const definition of actionRegistry.entries()) {
    if (definition.baseKey !== baseKey || definition.payload !== 'labelPacket') continue;
    const marker = `$${definition.name}=`;
    const markerIndex = rawKey.indexOf(marker);
    if (markerIndex < 0) continue;
    const payloadText = rawKey.slice(markerIndex + marker.length);
    if (/[@$~#]/u.test(payloadText)) {
      errors.push(diagnostic(
        'INVALID_TRANSFORM_ACTION_PAYLOAD',
        'act 标签只能包含文字或数字，工程符号不能出现在标签包中',
        { baseKey, action: definition.name }
      ));
    }
  }
  return errors;
}

function commandMatches(left) {
  const matches = [];
  for (const match of left.matchAll(MARKER_PATTERN)) {
    matches.push({
      name: match[1],
      index: match.index,
      end: match.index + match[0].length
    });
  }
  return matches;
}

/**
 * Transform has its own exact dot-command lexer. Ordinary periods are data:
 * only a complete marker from TRANSFORM_COMMANDS starts a command segment.
 */
export function parseTransformKey(rawKey, options = {}) {
  if (typeof rawKey !== 'string') {
    return {
      rawKey,
      baseKey: null,
      types: [],
      descriptionPresent: false,
      description: null,
      commands: [],
      persistentKey: null,
      warnings: [],
      errors: [diagnostic('INVALID_GRAPH_KEY', 'Graph 键必须是字符串')]
    };
  }

  const matches = commandMatches(rawKey);
  if (!matches.length) {
    const ordinary = parseAtomKey(rawKey, options);
    const transformActions = [];
    const matcherOnlyCodes = new Set([
      'MULTIPLE_MATCHERS',
      'UNSUPPORTED_MATCHER',
      'INVALID_MATCHER_PARAMETER'
    ]);
    const errors = ordinary.actions.length
      ? ordinary.errors.filter((error) => !matcherOnlyCodes.has(error.code))
      : [...ordinary.errors];
    errors.push(...labelPacketBoundaryErrors(
      rawKey,
      ordinary.baseKey,
      options.actionRegistry
    ));
    if (ordinary.actions.length) {
      for (const action of ordinary.actions) {
        const separatorIndex = action.raw.indexOf('=');
        const actionName = separatorIndex < 0 ? action.name : action.raw.slice(0, separatorIndex);
        const definition = options.actionRegistry?.resolve(ordinary.baseKey, actionName) ?? null;
        if (!definition || definition.context !== 'transform') {
          errors.push(diagnostic(
            'UNKNOWN_TRANSFORM_ACTION',
            `未知 Transform $ 动作：${ordinary.baseKey}$${action.raw}`,
            { baseKey: ordinary.baseKey, action: actionName }
          ));
          continue;
        }
        const payloadResult = parseActionPayload(action, definition);
        if (payloadResult.error) {
          errors.push(payloadResult.error);
          continue;
        }
        const parameter = separatorIndex < 0
          ? (action.parameter ?? definition.defaultParameter ?? null)
          : null;
        if (separatorIndex < 0 && definition.parameter === 'none' && action.parameter !== null) {
          errors.push(diagnostic(
            'INVALID_TRANSFORM_ACTION_PARAMETER',
            `Transform 动作 ${ordinary.baseKey}$${action.name} 不接受数字参数`,
            { baseKey: ordinary.baseKey, action: action.name, parameter: action.parameter }
          ));
        }
        if (separatorIndex < 0 && definition.parameter === 'positiveInteger'
          && (!Number.isSafeInteger(parameter) || parameter < 1)) {
          errors.push(diagnostic(
            'INVALID_TRANSFORM_ACTION_PARAMETER',
            `Transform 动作 ${ordinary.baseKey}$${action.name} 需要正整数参数`,
            { baseKey: ordinary.baseKey, action: action.name, parameter }
          ));
        }
        transformActions.push({
          name: actionName,
          parameter,
          ...(payloadResult.payload ? { payload: payloadResult.payload } : {})
        });
      }
    }
    return {
      ...ordinary,
      matcher: ordinary.actions.length ? null : ordinary.matcher,
      transformActions,
      commands: [],
      errors
    };
  }

  const baseRaw = rawKey.slice(0, matches[0].index);
  const persistent = parseAtomKey(baseRaw, options);
  // Situation replacement is an opaque text payload. Once .rep. begins, its
  // Program/body bytes must never be re-lexed as outer Transform commands.
  const replacementIndex = persistent.baseKey === 'situation'
    ? matches.findIndex((match) => match.name === 'rep')
    : -1;
  const commandMarkers = replacementIndex < 0
    ? matches
    : matches.slice(0, replacementIndex + 1);
  const commands = commandMarkers.map((match, index) => ({
    name: match.name,
    parameter: rawKey.slice(
      match.end,
      commandMarkers[index + 1]?.index ?? rawKey.length
    )
  }));
  const errors = [...persistent.errors];
  for (const command of commands) {
    if (!COMMAND_AXES[command.name]?.has(persistent.baseKey)) {
      errors.push(diagnostic(
        'INVALID_TRANSFORM_COMMAND_AXIS',
        `点号指令 .${command.name}. 不能用于 ${persistent.baseKey}`,
        { command: command.name, baseKey: persistent.baseKey }
      ));
    }
  }
  return {
    ...persistent,
    rawKey,
    commands,
    transformActions: [],
    persistentKey: persistent.persistentKey,
    errors
  };
}
