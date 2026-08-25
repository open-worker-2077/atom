export const GRAPH_SCHEMA_VERSION = '2.0.0';
export const GRAPH_AXES = Object.freeze(['thing', 'situation', 'contain', 'support']);
export const GRAPH_AXIS_SET = new Set(GRAPH_AXES);
export const RETIRED_GRAPH_AXES = Object.freeze({
  name: 'thing',
  detail: 'situation',
  children: 'contain',
  partners: 'support'
});
export const SUPPORT_KEYS = Object.freeze(['support']);

export function validateSupportTypes(types) {
  const names = types.map(({ name }) => name);
  if (!names.length) return null;
  return {
    code: 'INVALID_SUPPORT_KEY',
    message: 'support 不接受 @ 类型标记；推支方向必须用显式 if→then clause 表达',
    markers: names
  };
}

function migrationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function legacyBaseKey(rawKey) {
  const match = String(rawKey).match(/^[^@#$~]+/u);
  return match?.[0] ?? '';
}

function migratedKey(rawKey) {
  const base = legacyBaseKey(rawKey);
  return `${RETIRED_GRAPH_AXES[base]}${String(rawKey).slice(base.length)}`;
}

function matchingCallEnd(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')' && --depth === 0) return index;
  }
  return source.length;
}

function legacyProgramGraphUses(source) {
  const uses = [];
  const callPattern = /\b(explore|transform)\s*\(/gu;
  for (const call of source.matchAll(callPattern)) {
    const openIndex = call.index + call[0].lastIndexOf('(');
    const endIndex = matchingCallEnd(source, openIndex);
    const argument = source.slice(openIndex + 1, endIndex);
    const axisPattern = /(["'])(name|detail|children|partners)\1\s*:/gu;
    for (const match of argument.matchAll(axisPattern)) {
      const offset = openIndex + 1 + match.index;
      const prefix = source.slice(0, offset);
      const lines = prefix.split(/\r?\n/u);
      uses.push({
        call: call[1], axis: match[2],
        line: lines.length, column: lines.at(-1).length + 1,
        token: match[0].slice(0, match[0].lastIndexOf(':')).trim()
      });
    }
    callPattern.lastIndex = Math.max(callPattern.lastIndex, endIndex + 1);
  }
  return uses;
}

export function planGraphFourAxisMigration(root, options = {}) {
  const summary = {
    nodes: 0, supports: 0, situationBytes: 0,
    paths: [], typedNodes: [], supportEndpoints: [], programs: []
  };
  const nodesByPath = new Map();
  const nodesByThing = new Map();
  const pending = [];

  function convert(value, parentPath = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw migrationError('INVALID_LEGACY_GRAPH_NODE', '旧 Graph 节点必须是对象', {
        parent: parentPath.join('/')
      });
    }
    const fields = new Map();
    for (const [rawKey, fieldValue] of Object.entries(value)) {
      const base = legacyBaseKey(rawKey);
      if (!Object.hasOwn(RETIRED_GRAPH_AXES, base)) {
        throw migrationError('UNKNOWN_LEGACY_GRAPH_FIELD', `旧 Graph 节点包含未知字段：${rawKey}`, {
          parent: parentPath.join('/'), rawKey
        });
      }
      if (fields.has(base)) {
        throw migrationError('DUPLICATE_LEGACY_GRAPH_AXIS', `旧 Graph 轴重复：${base}`, {
          parent: parentPath.join('/'), base
        });
      }
      fields.set(base, { rawKey, value: fieldValue });
    }
    for (const required of ['name', 'detail', 'children', 'partners']) {
      if (!fields.has(required)) {
        throw migrationError('MISSING_LEGACY_GRAPH_AXIS', `旧 Graph 缺少轴：${required}`, {
          parent: parentPath.join('/'), required
        });
      }
    }
    const thing = fields.get('name').value;
    const situation = fields.get('detail').value;
    const children = fields.get('children').value;
    const partners = fields.get('partners').value;
    if (typeof thing !== 'string' || !thing.trim() || typeof situation !== 'string'
      || !Array.isArray(children) || !Array.isArray(partners)) {
      throw migrationError('INVALID_LEGACY_GRAPH_AXES', '旧 Graph 四轴类型无效', {
        parent: parentPath.join('/')
      });
    }
    const path = [...parentPath, thing];
    const pathText = path.join('/');
    if (nodesByPath.has(pathText)) {
      throw migrationError('DUPLICATE_LEGACY_GRAPH_PATH', `旧 Graph 路径重复：${pathText}`, { path: pathText });
    }
    const converted = {};
    converted[migratedKey(fields.get('name').rawKey)] = thing;
    converted[migratedKey(fields.get('detail').rawKey)] = situation;
    converted.contain = [];
    converted.support = [];
    nodesByPath.set(pathText, converted);
    if (!nodesByThing.has(thing)) nodesByThing.set(thing, []);
    nodesByThing.get(thing).push(pathText);
    summary.nodes += 1;
    summary.situationBytes += Buffer.byteLength(situation);
    summary.paths.push(pathText);
    const nameSuffix = fields.get('name').rawKey.slice('name'.length);
    if (nameSuffix.includes('@')) summary.typedNodes.push({ path: pathText, key: migratedKey(fields.get('name').rawKey) });
    if (nameSuffix.split('@').includes('program')) {
      const legacyGraphUses = legacyProgramGraphUses(situation);
      if (legacyGraphUses.length) {
        throw migrationError(
          'UNMAPPABLE_LEGACY_PROGRAM_GRAPH_ABI',
          `旧 Program 使用旧 Graph 轴，禁止猜测改写：${pathText}`,
          { path: pathText, uses: legacyGraphUses }
        );
      }
      summary.programs.push({ path: pathText, situationBytes: Buffer.byteLength(situation) });
    }
    pending.push({ path: pathText, converted, partners });
    converted.contain = children.map((child) => convert(child, path));
    return converted;
  }

  const graph = Array.isArray(root)
    ? root.map((node) => convert(node))
    : convert(root);
  for (const entry of pending) {
    if (entry.partners.length > 0) {
      const relations = entry.partners.map((partner, ordinal) => {
      if (!partner || typeof partner !== 'object' || Array.isArray(partner)
        || typeof partner.object !== 'string' || !partner.object.trim()
        || typeof partner.verb !== 'string') {
        throw migrationError('INVALID_LEGACY_PARTNER', '旧 partner 必须包含字符串 verb 与 object', {
          source: entry.path, ordinal
        });
      }
        return { source: entry.path, ordinal, verb: partner.verb, object: partner.object };
      });
      throw migrationError(
        'UNMAPPABLE_LEGACY_SUPPORT_RELATION',
        `旧 partners 无法无损映射为显式 if→then clause：${entry.path}`,
        { source: entry.path, relations }
      );
    }
    entry.converted.support = [];
  }
  return { graph, summary };
}
