import { atomLanguageError } from './errors.mjs';

function syntax(message, position) {
  throw atomLanguageError(
    'INVALID_GRAPH_JSON',
    `${message}（位置 ${position}）`,
    { position }
  );
}

class GraphJsonParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      syntax('Graph-JSON 末尾存在多余内容', this.index);
    }
    return value;
  }

  skipWhitespace() {
    while (this.index < this.source.length && /\s/u.test(this.source[this.index])) {
      this.index += 1;
    }
  }

  parseValue() {
    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === '{') return this.parseObject();
    if (character === '[') return this.parseArray();
    if (character === '"') return this.parseString();
    if (character === '-' || (character >= '0' && character <= '9')) return this.parseNumber();
    if (this.source.startsWith('true', this.index)) {
      this.index += 4;
      return true;
    }
    if (this.source.startsWith('false', this.index)) {
      this.index += 5;
      return false;
    }
    if (this.source.startsWith('null', this.index)) {
      this.index += 4;
      return null;
    }
    syntax('无法识别的 Graph-JSON Value', this.index);
  }

  parseString() {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        const token = this.source.slice(start, this.index);
        try {
          return JSON.parse(token);
        } catch {
          syntax('字符串不是合法 JSON 字符串', start);
        }
      }
      if (character === '\\') {
        this.index += 2;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) {
        syntax('字符串包含未转义的控制字符', this.index);
      }
      this.index += 1;
    }
    syntax('字符串缺少结束引号', start);
  }

  parseNumber() {
    const match = this.source.slice(this.index).match(
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u
    );
    if (!match) syntax('数字格式无效', this.index);
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) syntax('数字超出可表示范围', this.index);
    return value;
  }

  parseObject() {
    const entries = [];
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === '}') {
      this.index += 1;
      return { kind: 'object', entries };
    }
    while (this.index < this.source.length) {
      this.skipWhitespace();
      if (this.source[this.index] !== '"') {
        syntax('对象键必须是双引号 JSON 字符串', this.index);
      }
      const key = this.parseString();
      this.skipWhitespace();

      let valuePresent = false;
      let value;
      if (this.source[this.index] === ':') {
        this.index += 1;
        value = this.parseValue();
        valuePresent = true;
        this.skipWhitespace();
      } else if (this.source[this.index] !== ',' && this.source[this.index] !== '}') {
        syntax('对象键后必须是冒号、逗号或右花括号', this.index);
      }

      entries.push(valuePresent ? { key, valuePresent, value } : { key, valuePresent });

      if (this.source[this.index] === '}') {
        this.index += 1;
        return { kind: 'object', entries };
      }
      if (this.source[this.index] !== ',') {
        syntax('对象字段之间缺少逗号', this.index);
      }
      this.index += 1;
      this.skipWhitespace();
      if (this.source[this.index] === '}') {
        syntax('Graph-JSON 不接受尾随逗号', this.index);
      }
    }
    syntax('对象缺少右花括号', this.index);
  }

  parseArray() {
    const values = [];
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === ']') {
      this.index += 1;
      return { kind: 'array', values };
    }
    while (this.index < this.source.length) {
      values.push(this.parseValue());
      this.skipWhitespace();
      if (this.source[this.index] === ']') {
        this.index += 1;
        return { kind: 'array', values };
      }
      if (this.source[this.index] !== ',') {
        syntax('数组项目之间缺少逗号', this.index);
      }
      this.index += 1;
      this.skipWhitespace();
      if (this.source[this.index] === ']') {
        syntax('Graph-JSON 不接受尾随逗号', this.index);
      }
    }
    syntax('数组缺少右方括号', this.index);
  }
}

export function parseGraphJson(source) {
  if (typeof source !== 'string') {
    throw atomLanguageError('INVALID_GRAPH_JSON', 'Graph-JSON 输入必须是文本');
  }
  return new GraphJsonParser(source).parse();
}

export function materializeGraphJson(value) {
  if (value?.kind === 'array' && Array.isArray(value.values)) {
    return value.values.map(materializeGraphJson);
  }
  if (value?.kind === 'object' && Array.isArray(value.entries)) {
    const result = {};
    for (const entry of value.entries) {
      if (entry.valuePresent) result[entry.key] = materializeGraphJson(entry.value);
    }
    return result;
  }
  return value;
}

function formatGraphJsonValue(value, depth, indent, options) {
  const currentIndent = ' '.repeat(depth * indent);
  const childIndent = ' '.repeat((depth + 1) * indent);

  if (value?.kind === 'object' && Array.isArray(value.entries)) {
    if (!value.entries.length) return '{}';
    const visibleEntries = options.omitEmptyStructuralArrays
      ? value.entries.filter((entry) => !(
        entry?.valuePresent
        && (entry.key === 'contain' || entry.key === 'support')
        && entry.value?.kind === 'array'
        && Array.isArray(entry.value.values)
        && entry.value.values.length === 0
      ))
      : value.entries;
    if (!visibleEntries.length) return '{}';
    const entries = visibleEntries.map((entry) => {
      if (typeof entry?.key !== 'string') {
        throw atomLanguageError(
          'INVALID_GRAPH_JSON_FORMAT_VALUE',
          'Graph-JSON 格式化对象的键必须是字符串'
        );
      }
      const key = JSON.stringify(entry.key);
      if (!entry.valuePresent) return `${childIndent}${key}`;
      return `${childIndent}${key}: ${formatGraphJsonValue(
        entry.value,
        depth + 1,
        indent,
        options
      )}`;
    });
    return `{\n${entries.join(',\n')}\n${currentIndent}}`;
  }

  if (value?.kind === 'array' && Array.isArray(value.values)) {
    if (!value.values.length) return '[]';
    const values = value.values.map((entry) => (
      `${childIndent}${formatGraphJsonValue(entry, depth + 1, indent, options)}`
    ));
    return `[\n${values.join(',\n')}\n${currentIndent}]`;
  }

  const formatted = JSON.stringify(value);
  if (formatted === undefined) {
    throw atomLanguageError(
      'INVALID_GRAPH_JSON_FORMAT_VALUE',
      'Graph-JSON 无法格式化 undefined、函数或 Symbol'
    );
  }
  return formatted;
}

export function formatGraphJson(value, options = {}) {
  const indent = options.indent ?? 2;
  if (!Number.isInteger(indent) || indent < 0 || indent > 10) {
    throw atomLanguageError(
      'INVALID_GRAPH_JSON_FORMAT_INDENT',
      'Graph-JSON 缩进必须是 0 到 10 之间的整数'
    );
  }
  return formatGraphJsonValue(value, 0, indent, options);
}
