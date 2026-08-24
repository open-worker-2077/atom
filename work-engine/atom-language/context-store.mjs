import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  GRAPH_JSON_SCHEMA_VERSION,
  parseGraphDocument
} from '../../cli/lib/graph-json.mjs';
import { atomLanguageError } from './errors.mjs';
import { parseAtomKey } from './key-parser.mjs';

const DEFAULT_CONTEXT_FILENAME = 'atom.json';
const contextSnapshots = new Map();
const contextLoads = new Map();
const REQUIRED_ATOM_FIELDS = Object.freeze([
  'name',
  'detail',
  'children',
  'partners'
]);

function freezeSnapshot(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeSnapshot(child);
  return Object.freeze(value);
}

async function contextSignature(file) {
  const stat = await fs.stat(file, { bigint: true });
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

async function rememberContextSnapshot(file, value) {
  const snapshot = freezeSnapshot(structuredClone(value));
  contextSnapshots.set(file, { signature: await contextSignature(file), value: snapshot });
  return snapshot;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rejectWorldFilename(file) {
  const basename = path.basename(file).toLowerCase();
  if (basename === 'world.json' || basename.endsWith('.world.json')) {
    throw atomLanguageError(
      'ACTIVE_WORLD_JSON_REJECTED',
      'Atom context 与 Graph 投影不得使用活动 world.json 或 *.world.json',
      { file }
    );
  }
}

function requireJsonFile(file, label) {
  if (typeof file !== 'string' || !file.trim()) {
    throw atomLanguageError(
      'INVALID_ATOM_CONTEXT_TARGET',
      `${label}必须是非空 JSON 文件路径`
    );
  }
  const absolute = path.resolve(file);
  if (path.extname(absolute).toLowerCase() !== '.json') {
    throw atomLanguageError(
      'INVALID_ATOM_CONTEXT_TARGET',
      `${label}必须使用 .json 文件`,
      { file: absolute }
    );
  }
  rejectWorldFilename(absolute);
  return absolute;
}

/**
 * Resolve a context target. An omitted target or a directory target uses the
 * provisional default filename atom.json; an explicit non-world .json path is
 * preserved.
 */
export function resolveAtomContextFile(target = process.cwd()) {
  if (typeof target !== 'string' || !target.trim()) {
    throw atomLanguageError(
      'INVALID_ATOM_CONTEXT_TARGET',
      'Atom context 目标必须是目录或 .json 文件路径'
    );
  }
  const absolute = path.resolve(target);
  const file = path.extname(absolute).toLowerCase() === '.json'
    ? absolute
    : path.join(absolute, DEFAULT_CONTEXT_FILENAME);
  rejectWorldFilename(file);
  return file;
}

function atomFields(atom, location) {
  if (!isPlainObject(atom)) {
    throw atomLanguageError(
      'INVALID_ATOM',
      `${location} 必须是 Atom 对象`,
      { location }
    );
  }

  const fields = new Map();
  for (const rawKey of Object.keys(atom)) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (parsed.errors.length) {
      throw atomLanguageError(
        'INVALID_ATOM_FIELD',
        `${location} 的键 ${rawKey} 不是有效持久 Atom 键`,
        { location, rawKey, errors: parsed.errors }
      );
    }
    if (parsed.persistentKey !== rawKey) {
      throw atomLanguageError(
        'TRANSIENT_SYMBOL_PERSISTENCE_REJECTED',
        `${location} 的键 ${rawKey} 仍包含未剥离的 $ 或 ~`,
        { location, rawKey, persistentKey: parsed.persistentKey }
      );
    }
    if (fields.has(parsed.baseKey)) {
      throw atomLanguageError(
        'DUPLICATE_ATOM_FIELD',
        `${location} 重复声明基础字段 ${parsed.baseKey}`,
        {
          location,
          baseKey: parsed.baseKey,
          keys: [fields.get(parsed.baseKey).rawKey, rawKey]
        }
      );
    }
    fields.set(parsed.baseKey, {
      rawKey,
      parsed,
      value: atom[rawKey]
    });
  }

  for (const baseKey of REQUIRED_ATOM_FIELDS) {
    if (!fields.has(baseKey)) {
      throw atomLanguageError(
        'MISSING_ATOM_FIELD',
        `${location} 缺少基础字段 ${baseKey}`,
        { location, baseKey }
      );
    }
  }
  return fields;
}

function projectedPartner(partner, rootName) {
  const projected = structuredClone(partner);
  if (
    typeof projected?.object === 'string'
    && projected.object.includes('/')
    && !projected.object.startsWith(`${rootName}/`)
  ) {
    projected.object = `${rootName}/${projected.object}`;
  }
  return projected;
}

function projectAtom(atom, location, rootName) {
  const fields = atomFields(atom, location);
  const name = fields.get('name').value;
  const detail = fields.get('detail').value;
  const children = fields.get('children').value;
  const partners = fields.get('partners').value;
  if (typeof name !== 'string' || !name.trim() || name !== name.trim()) {
    throw atomLanguageError(
      'INVALID_ATOM_NAME',
      `${location} 的 name 必须是无首尾空白的非空字符串`,
      { location }
    );
  }
  if (typeof detail !== 'string') {
    throw atomLanguageError(
      'INVALID_ATOM_DETAIL',
      `${location} 的 detail 必须是字符串`,
      { location }
    );
  }
  if (!Array.isArray(children)) {
    throw atomLanguageError(
      'INVALID_ATOM_CHILDREN',
      `${location} 的 children 必须是数组`,
      { location }
    );
  }
  if (!Array.isArray(partners)) {
    throw atomLanguageError(
      'INVALID_ATOM_PARTNERS',
      `${location} 的 partners 必须是数组`,
      { location }
    );
  }
  return {
    name,
    detail,
    children: children.map((child, index) => (
      projectAtom(child, `${location}.children[${index}]`, rootName)
    )),
    partners: partners.map((partner) => projectedPartner(partner, rootName))
  };
}

/**
 * Adapt the provisional top-level Atom array to the existing strict Graph JSON
 * 1.0.0 shape. The graph root is projection scaffolding only, not a factual
 * Atom in the context.
 */
export function projectAtomContext(atoms, options = {}) {
  if (!Array.isArray(atoms)) {
    throw atomLanguageError(
      'INVALID_ATOM_CONTEXT_DOCUMENT',
      'Atom context 文档当前必须是顶层 Atom 数组'
    );
  }
  const rootName = options.rootName ?? DEFAULT_CONTEXT_FILENAME;
  const candidate = {
    config: {
      schema_version: GRAPH_JSON_SCHEMA_VERSION
    },
    graph: {
      name: rootName,
      detail: '',
      children: atoms.map((atom, index) => projectAtom(atom, `$[${index}]`, rootName)),
      partners: []
    }
  };
  return parseGraphDocument(candidate);
}

async function atomicWriteJson(file, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  JSON.parse(text);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temporary, file);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      await fs.copyFile(temporary, file);
      await fs.unlink(temporary);
    }
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Read one context array. Missing files initialize to [] by default; callers
 * can pass { create: false } for a non-writing probe.
 */
export async function readAtomContext(file, options = {}) {
  const contextFile = resolveAtomContextFile(file);
  let signature;
  try {
    signature = await contextSignature(contextFile);
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (options.create !== false) await writeAtomContext(contextFile, []);
      return [];
    }
    throw error;
  }
  const cached = contextSnapshots.get(contextFile);
  if (cached?.signature === signature) return cached.value;
  const loadKey = `${contextFile}\0${signature}`;
  if (contextLoads.has(loadKey)) return contextLoads.get(loadKey);
  const loading = (async () => {
    let value;
    try {
      value = JSON.parse(await fs.readFile(contextFile, 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw atomLanguageError(
          'INVALID_ATOM_CONTEXT_JSON',
          'Atom context 不是有效的严格 JSON',
          { file: contextFile, cause: error.message }
        );
      }
      throw error;
    }
    projectAtomContext(value);
    const snapshot = freezeSnapshot(value);
    contextSnapshots.set(contextFile, { signature, value: snapshot });
    return snapshot;
  })().finally(() => contextLoads.delete(loadKey));
  contextLoads.set(loadKey, loading);
  return loading;
}

/**
 * Atom context persistence is separate from projection persistence so the
 * engine can coordinate the two files without coupling either to knowledge.json.
 */
export async function writeAtomContext(file, atoms) {
  const contextFile = resolveAtomContextFile(file);
  projectAtomContext(atoms);
  await atomicWriteJson(contextFile, atoms);
  await rememberContextSnapshot(contextFile, atoms);
  return contextFile;
}

export async function writeAtomGraphProjection(file, atoms, options = {}) {
  const graphFile = requireJsonFile(file, 'Graph 投影文件');
  const projection = projectAtomContext(atoms, options);
  // Keep the strict validator immediately before the persistence boundary.
  const validated = parseGraphDocument(projection);
  await atomicWriteJson(graphFile, validated);
  return graphFile;
}
