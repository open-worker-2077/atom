import fs from 'node:fs/promises';
import path from 'node:path';

import { atomLanguageError } from './errors.mjs';
import { parseAtomKey } from './key-parser.mjs';
import { parseTransformKey } from './transform-key-parser.mjs';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireJsonValue(value, location, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw atomLanguageError('INVALID_ATOM_JSON', `${location} 必须是有限 JSON 数字`);
    }
    return;
  }
  if (typeof value !== 'object') {
    throw atomLanguageError('INVALID_ATOM_JSON', `${location} 不是严格 JSON Value`);
  }
  if (ancestors.has(value)) {
    throw atomLanguageError('INVALID_ATOM_JSON', `${location} 包含循环引用`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => requireJsonValue(item, `${location}[${index}]`, ancestors));
  } else {
    if (!isPlainObject(value)) {
      throw atomLanguageError('INVALID_ATOM_JSON', `${location} 必须是普通 JSON 对象`);
    }
    for (const [key, child] of Object.entries(value)) {
      requireJsonValue(child, `${location}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function metadataOf(rawKey) {
  return parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
}

function keyFromMetadata(baseKey, types, descriptionPresent, description) {
  return `${baseKey}${types.map((type) => `@${type.raw}`).join('')}${
    descriptionPresent ? `#${description}` : ''
  }`;
}

/**
 * Minimal persistence-boundary merge. It applies only submitted Values,
 * strips transient key sections, and inherits existing @/# metadata when an
 * ordinary field update does not restate them.
 */
export function mergePersistentAtom(existingAtom, normalizedItem) {
  if (!isPlainObject(existingAtom)) {
    throw atomLanguageError('INVALID_ATOM_JSON', '待合并 Atom 必须是普通对象');
  }
  if (!normalizedItem || !Array.isArray(normalizedItem.fields)) {
    throw atomLanguageError('INVALID_NORMALIZED_ITEM', '持久化合并需要接收器的归一化 item');
  }

  const output = structuredClone(existingAtom);
  for (const incoming of normalizedItem.fields) {
    if (!incoming.valuePresent) continue;
    if (incoming.errors?.length) {
      throw atomLanguageError(
        'PERSISTENCE_PARSE_ERROR',
        `字段 ${incoming.rawKey} 存在解析错误，不能持久化`,
        { errors: incoming.errors }
      );
    }

    const matchingKeys = Object.keys(output).filter(
      (key) => metadataOf(key).baseKey === incoming.baseKey
    );
    const previous = matchingKeys.length > 0 ? metadataOf(matchingKeys[0]) : null;
    const types = incoming.types.length > 0 ? incoming.types : (previous?.types ?? []);
    const descriptionPresent = incoming.descriptionPresent || previous?.descriptionPresent || false;
    const description = incoming.descriptionPresent
      ? incoming.description
      : (previous?.description ?? null);
    const targetKey = keyFromMetadata(
      incoming.baseKey,
      types,
      descriptionPresent,
      description
    );
    for (const key of matchingKeys) delete output[key];
    output[targetKey] = structuredClone(incoming.value);
  }
  return output;
}

function outputFileFor(target) {
  const absolute = path.resolve(target);
  return path.extname(absolute).toLowerCase() === '.json'
    ? absolute
    : path.join(absolute, 'atom.json');
}

function rejectTransientKeys(value, location = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectTransientKeys(item, `${location}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const left = key.split('#', 1)[0];
    if (
      left.includes('$')
      || left.includes('~')
      || parseTransformKey(key, { descriptionSymbolWarnings: false }).commands.length
    ) {
      throw atomLanguageError(
        'TRANSIENT_SYMBOL_PERSISTENCE_REJECTED',
        `持久 JSON 键不得包含未剥离的临时指令：${key}`,
        { key, location }
      );
    }
    rejectTransientKeys(child, `${location}.${key}`);
  }
}

/**
 * atom.json is the default context file, not a singleton. Callers may provide
 * another contextual .json path, while rejected historical world names can
 * never become active output through this P0 writer.
 */
export async function writeAtomJson(target, document) {
  if (typeof target !== 'string' || !target.trim()) {
    throw atomLanguageError('INVALID_ATOM_JSON_TARGET', '必须提供 JSON 目录或文件路径');
  }
  const file = outputFileFor(target);
  const basename = path.basename(file).toLowerCase();
  if (basename === 'world.json' || basename.endsWith('.world.json')) {
    throw atomLanguageError(
      'ACTIVE_WORLD_JSON_REJECTED',
      '新 Atom Language 实现不得生成活动 world.json 或 *.world.json',
      { file }
    );
  }
  requireJsonValue(document, '$', new Set());
  rejectTransientKeys(document);
  const text = `${JSON.stringify(document, null, 2)}\n`;
  JSON.parse(text);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
  return file;
}
