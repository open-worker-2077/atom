import { diagnostic } from './errors.mjs';
import { parseAtomKey } from './key-parser.mjs';

export const TRANSFORM_COMMANDS = Object.freeze([
  'rep',
  'sum',
  'typ',
  'ren',
  'mov',
  'cpy',
  'dsc',
  'rst',
  'run'
]);

const COMMAND_AXES = Object.freeze({
  rep: new Set(['detail', 'partners']),
  sum: new Set(['detail']),
  typ: new Set(['name']),
  ren: new Set(['name']),
  mov: new Set(['name']),
  cpy: new Set(['name']),
  dsc: new Set(['name']),
  rst: new Set(['name']),
  run: new Set(['name'])
});

const MARKER_PATTERN = new RegExp(
  `\\.(${TRANSFORM_COMMANDS.join('|')})\\.`,
  'gu'
);

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
    const errors = [...ordinary.errors];
    if (ordinary.actions.length) {
      errors.push(diagnostic(
        'TRANSFORM_DOLLAR_COMMAND_REJECTED',
        'Transform 指令只使用已登记的完整点号指令，不使用 $',
        { rawKey }
      ));
    }
    return { ...ordinary, commands: [], errors };
  }

  const baseRaw = rawKey.slice(0, matches[0].index);
  const persistent = parseAtomKey(baseRaw, options);
  const commands = matches.map((match, index) => ({
    name: match.name,
    parameter: rawKey.slice(
      match.end,
      matches[index + 1]?.index ?? rawKey.length
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
    persistentKey: persistent.persistentKey,
    errors
  };
}
