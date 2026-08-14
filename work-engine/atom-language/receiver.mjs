import { diagnostic } from './errors.mjs';
import { materializeGraphJson, parseGraphJson } from './graph-json.mjs';
import { parseAtomKey } from './key-parser.mjs';
import { createActionRegistry, createMatcherRegistry } from './registry.mjs';
import { parseTransformKey } from './transform-key-parser.mjs';

const PARTNER_FIELDS = new Set(['verb', 'object']);

function entryResult() {
  return {
    ok: true,
    language: 'atom',
    kind: 'entry',
    command: 'atom',
    newExploration: false,
    batch: false,
    items: [],
    warnings: [],
    errors: []
  };
}

function parseCommand(source) {
  const text = source.trim();
  if (text === 'atom') return { entry: true };
  const requestCommand = ['explore', 'transform'].find((candidate) => (
    text === candidate
    || (text.startsWith(candidate) && /\s/u.test(text[candidate.length]))
  ));
  if (!requestCommand) {
    return {
      error: diagnostic(
        'UNKNOWN_ATOM_LANGUAGE_COMMAND',
        '当前只识别 atom、explore、explore new、transform 与 transform new'
      )
    };
  }

  let remainder = text.slice(requestCommand.length).trimStart();
  let newModifier = false;
  if (remainder === 'new' || /^new(?=\s)/u.test(remainder)) {
    newModifier = true;
    remainder = remainder.slice(3).trimStart();
  }
  return {
    entry: false,
    command: requestCommand,
    newExploration: requestCommand === 'explore' && newModifier,
    createNew: requestCommand === 'transform' && newModifier,
    payload: remainder
  };
}

function invalidCommandResult(error) {
  return {
    ok: false,
    language: 'atom',
    kind: 'request',
    command: null,
    newExploration: false,
    batch: false,
    items: [],
    warnings: [],
    errors: [error]
  };
}

function normalizeValue(value, parserOptions, command) {
  if (value?.kind === 'array' && Array.isArray(value.values)) {
    return value.values.map((item) => normalizeValue(item, parserOptions, command));
  }
  if (value?.kind === 'object' && Array.isArray(value.entries)) {
    const fields = value.entries.map((entry) => (
      normalizeField(entry, parserOptions, command)
    ));
    return {
      kind: 'graph-object',
      fields,
      warnings: fields.flatMap((field) => field.warnings),
      errors: fields.flatMap((field) => field.errors)
    };
  }
  return value;
}

function nestedDiagnostics(value, property) {
  if (Array.isArray(value)) return value.flatMap((item) => nestedDiagnostics(item, property));
  if (value?.kind === 'graph-object') return value[property] ?? [];
  return [];
}

function normalizePartners(value) {
  if (value?.kind !== 'array' || !Array.isArray(value.values)) {
    return {
      value: materializeGraphJson(value),
      errors: [diagnostic(
        'INVALID_ATOM_PARTNERS',
        'partners 必须是关系对象数组'
      )]
    };
  }

  const errors = [];
  const partners = value.values.map((partner, index) => {
    if (partner?.kind !== 'object' || !Array.isArray(partner.entries)) {
      errors.push(diagnostic(
        'INVALID_GRAPH_PARTNER',
        'partners 项必须是只含 verb 与 object 的对象',
        { partnerIndex: index }
      ));
      return materializeGraphJson(partner);
    }

    const normalized = {};
    for (const entry of partner.entries) {
      if (!PARTNER_FIELDS.has(entry.key)) {
        errors.push(diagnostic(
          'UNKNOWN_GRAPH_PARTNER_FIELD',
          `未知 partner 字段：${entry.key}`,
          { partnerIndex: index, field: entry.key }
        ));
        continue;
      }
      if (Object.hasOwn(normalized, entry.key)) {
        errors.push(diagnostic(
          'DUPLICATE_GRAPH_PARTNER_FIELD',
          `partner 字段不得重复：${entry.key}`,
          { partnerIndex: index, field: entry.key }
        ));
        continue;
      }
      if (!entry.valuePresent) {
        errors.push(diagnostic(
          'INVALID_GRAPH_PARTNER',
          `partner.${entry.key} 必须提交字符串 Value`,
          { partnerIndex: index, field: entry.key }
        ));
        continue;
      }
      normalized[entry.key] = materializeGraphJson(entry.value);
    }

    for (const field of PARTNER_FIELDS) {
      if (!Object.hasOwn(normalized, field)) {
        errors.push(diagnostic(
          'INVALID_GRAPH_PARTNER',
          `partner 缺少 ${field}`,
          { partnerIndex: index, field }
        ));
      } else if (
        typeof normalized[field] !== 'string'
        || !normalized[field].trim()
      ) {
        errors.push(diagnostic(
          field === 'verb' ? 'INVALID_GRAPH_VERB' : 'INVALID_GRAPH_OBJECT',
          `partner.${field} 必须是非空字符串`,
          { partnerIndex: index, field }
        ));
      }
    }
    return normalized;
  });
  return { value: partners, errors };
}

function normalizeField(entry, parserOptions, command) {
  const parsed = command === 'transform'
    ? parseTransformKey(entry.key, parserOptions)
    : parseAtomKey(entry.key, parserOptions);
  if (!entry.valuePresent) return { ...parsed, valuePresent: false };
  if (
    command === 'explore'
    && parsed.baseKey === 'partners'
    && materializeGraphJson(entry.value) === true
  ) {
    return {
      ...parsed,
      valuePresent: true,
      value: true
    };
  }
  if (parsed.baseKey === 'partners') {
    const normalized = normalizePartners(entry.value);
    return {
      ...parsed,
      warnings: parsed.warnings,
      errors: [...parsed.errors, ...normalized.errors],
      valuePresent: true,
      value: normalized.value
    };
  }
  const value = normalizeValue(entry.value, parserOptions, command);
  return {
    ...parsed,
    warnings: [...parsed.warnings, ...nestedDiagnostics(value, 'warnings')],
    errors: [...parsed.errors, ...nestedDiagnostics(value, 'errors')],
    valuePresent: true,
    value
  };
}

function normalizeItem(node, index, parserOptions, command) {
  if (node?.kind !== 'object' || !Array.isArray(node.entries)) {
    const error = diagnostic(
      command === 'transform' ? 'INVALID_TRANSFORM_ITEM' : 'INVALID_EXPLORE_ITEM',
      `${command} 的每一项必须是 Graph-JSON 对象`,
      { itemIndex: index }
    );
    return { index, ok: false, fields: [], warnings: [], errors: [error] };
  }

  const fields = node.entries.map((entry) => (
    normalizeField(entry, parserOptions, command)
  ));
  const warnings = fields.flatMap((parsed) => parsed.warnings);
  const errors = fields.flatMap((parsed) => parsed.errors);
  return { index, ok: errors.length === 0, fields, warnings, errors };
}

export function createAtomLanguageReceiver(options = {}) {
  const matcherRegistry = options.matcherRegistry ?? createMatcherRegistry();
  const actionRegistry = options.actionRegistry ?? createActionRegistry();
  const parserOptions = {
    matcherRegistry,
    actionRegistry,
    descriptionSymbolWarnings: options.descriptionSymbolWarnings
  };

  function receive(source) {
    if (typeof source !== 'string') {
      return invalidCommandResult(diagnostic(
        'INVALID_ATOM_LANGUAGE_INPUT',
        'Atom Language 接收器需要文本输入'
      ));
    }
    const command = parseCommand(source);
    if (command.entry) return entryResult();
    if (command.error) return invalidCommandResult(command.error);

    let root;
    if (!command.payload) {
      return {
        ok: true,
        language: 'atom',
        kind: 'request',
        command: command.command,
        newExploration: command.newExploration,
        ...(command.command === 'transform'
          ? { createNew: command.createNew }
          : {}),
        batch: false,
        items: [],
        warnings: [],
        errors: []
      };
    }
    try {
      root = parseGraphJson(command.payload);
    } catch (error) {
      return {
        ok: false,
        language: 'atom',
        kind: 'request',
        command: command.command,
        newExploration: command.newExploration,
        ...(command.command === 'transform'
          ? { createNew: command.createNew }
          : {}),
        batch: false,
        items: [],
        warnings: [],
        errors: [diagnostic(
          error.code || 'INVALID_GRAPH_JSON',
          error.message,
          { details: error.details ?? {} }
        )]
      };
    }

    const batch = root?.kind === 'array';
    const nodes = batch ? root.values : [root];
    const items = nodes.map((node, index) => (
      normalizeItem(node, index, parserOptions, command.command)
    ));
    const warnings = items.flatMap((item) => (
      item.warnings.map((warning) => ({ ...warning, itemIndex: item.index }))
    ));
    const errors = items.flatMap((item) => (
      item.errors.map((error) => ({ ...error, itemIndex: item.index }))
    ));
    return {
      ok: errors.length === 0,
      language: 'atom',
      kind: 'request',
      command: command.command,
      newExploration: command.newExploration,
      ...(command.command === 'transform'
        ? { createNew: command.createNew }
        : {}),
      batch,
      items,
      warnings,
      errors
    };
  }

  return Object.freeze({
    receive,
    matcherRegistry,
    actionRegistry
  });
}
