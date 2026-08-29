import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  GRAPH_JSON_SCHEMA_VERSION,
  parseGraphDocument
} from '../../cli/lib/graph-json.mjs';
import { atomLanguageError } from './errors.mjs';
import { RETIRED_GRAPH_AXES } from './graph-schema.mjs';
import { parseAtomKey } from './key-parser.mjs';
import {
  compatibilityMetadata,
  isLegacySupportEntry,
  validateCompatibilityManifest
} from '../../src/atom-system/world-runtime/legacy-graph-compat.mjs';

const DEFAULT_CONTEXT_FILENAME = 'atom.json';
const contextSnapshots = new Map();
const contextLoads = new Map();
const legacySnapshotMetadata = new WeakMap();
const REQUIRED_ATOM_FIELDS = Object.freeze([
  'thing',
  'situation',
  'contain',
  'support'
]);
const GRAPH_BASES = new Set(REQUIRED_ATOM_FIELDS);

function rawBaseKey(rawKey) {
  return String(rawKey).match(/^[^@#$~]+/u)?.[0] ?? '';
}

function migratedLegacyKey(rawKey) {
  const baseKey = rawBaseKey(rawKey);
  return `${RETIRED_GRAPH_AXES[baseKey]}${String(rawKey).slice(baseKey.length)}`;
}

function normalizePersistedContext(value) {
  if (!Array.isArray(value)) return { atoms: value, metadata: null };
  const relations = [];
  const isolatedProgramPaths = [];
  let legacyNodes = 0;

  function visit(atom, parentPath = []) {
    if (!isPlainObject(atom)) return atom;
    const entries = Object.entries(atom);
    const oldEntries = entries.filter(([key]) => Object.hasOwn(RETIRED_GRAPH_AXES, rawBaseKey(key)));
    const newEntries = entries.filter(([key]) => GRAPH_BASES.has(rawBaseKey(key)));
    if (!oldEntries.length) {
      if (!newEntries.length) return atom;
      const thing = newEntries.find(([key]) => rawBaseKey(key) === 'thing')?.[1];
      const contain = newEntries.find(([key]) => rawBaseKey(key) === 'contain');
      if (!Array.isArray(contain?.[1])) return atom;
      return {
        ...atom,
        [contain[0]]: contain[1].map((child) => visit(child, [...parentPath, String(thing ?? '')]))
      };
    }
    if (newEntries.length) {
      throw atomLanguageError('MIXED_GRAPH_AXIS_GENERATION', '同一持久 Atom 不得混用旧轴与新四轴', {
        parent: parentPath.join('/')
      });
    }
    const fields = new Map(oldEntries.map(([key, fieldValue]) => [
      rawBaseKey(key), { rawKey: key, value: fieldValue }
    ]));
    if (Object.keys(RETIRED_GRAPH_AXES).some((required) => !fields.has(required))) return atom;
    const thing = fields.get('name').value;
    const pathParts = [...parentPath, thing];
    const pathText = pathParts.join('/');
    legacyNodes += 1;
    if (Array.isArray(fields.get('partners').value)) {
      for (const [ordinal, partner] of fields.get('partners').value.entries()) {
        relations.push({ source: pathText, ordinal, verb: partner?.verb, object: partner?.object });
      }
    }
    const thingKey = migratedLegacyKey(fields.get('name').rawKey);
    if (thingKey.split('@').slice(1).some((part) => part.split('#')[0] === 'program')) {
      isolatedProgramPaths.push(pathText);
    }
    return {
      [thingKey]: thing,
      [migratedLegacyKey(fields.get('detail').rawKey)]: fields.get('detail').value,
      contain: Array.isArray(fields.get('children').value)
        ? fields.get('children').value.map((child) => visit(child, pathParts))
        : fields.get('children').value,
      support: structuredClone(fields.get('partners').value)
    };
  }

  const atoms = value.map((atom) => visit(atom));
  if (!legacyNodes) return { atoms: value, metadata: null };
  return {
    atoms,
    metadata: Object.freeze({
      contract: 'atom.legacy-graph-read-only', version: 1, mode: 'legacy-read-only',
      legacyNodes,
      relations: Object.freeze(relations.map(Object.freeze)),
      isolatedProgramPaths: Object.freeze([...isolatedProgramPaths]),
      sourceFactsHash: `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
    })
  };
}

export function legacyAtomContextMetadata(atoms) {
  const metadata = atoms && typeof atoms === 'object' ? legacySnapshotMetadata.get(atoms) : null;
  return metadata ? structuredClone(metadata) : null;
}

function freezeSnapshot(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeSnapshot(child);
  return Object.freeze(value);
}

async function contextSignature(file) {
  const stat = await fs.stat(file, { bigint: true });
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

function compatibilityCacheKey(manifest) {
  if (!manifest) return '';
  return crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

export async function adoptAtomContextSnapshot(file, value, options = {}) {
  const contextFile = resolveAtomContextFile(file);
  const snapshot = freezeSnapshot(value);
  const manifestRevision = compatibilityCacheKey(options.compatibilityManifest);
  if (options.compatibilityManifest) {
    legacySnapshotMetadata.set(
      snapshot,
      compatibilityMetadata(options.compatibilityManifest, snapshot)
    );
  }
  contextSnapshots.set(contextFile, {
    signature: await contextSignature(contextFile),
    manifestRevision,
    value: snapshot
  });
  return snapshot;
}

async function rememberContextSnapshot(file, value, options = {}) {
  return adoptAtomContextSnapshot(file, structuredClone(value), options);
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
    if (fields.has(parsed.baseKey) && parsed.baseKey !== 'support') {
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
    if (!fields.has(parsed.baseKey) || rawKey === 'support') fields.set(parsed.baseKey, {
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

function projectedSupport(clause, rootThing) {
  const projected = structuredClone(clause);
  const qualify = (selector) => {
    const key = typeof selector?.thing === 'string' ? 'thing'
      : typeof selector?.['thing@program'] === 'string' ? 'thing@program' : null;
    if (key && selector[key] !== '.'
      && !selector[key].startsWith('./')
      && selector[key].includes('/')
      && !selector[key].startsWith(`${rootThing}/`)) {
      selector[key] = `${rootThing}/${selector[key]}`;
    }
  };
  const visitExpr = (expr) => {
    if (!expr || typeof expr !== 'object' || Array.isArray(expr)) return;
    qualify(expr);
    for (const child of expr.and ?? expr.or ?? []) visitExpr(child);
  };
  for (const expr of projected?.if ?? []) visitExpr(expr);
  for (const target of projected?.then ?? []) qualify(target);
  return projected;
}

function projectAtom(atom, location, rootThing, options = {}) {
  const fields = atomFields(atom, location);
  const thing = fields.get('thing').value;
  const situation = fields.get('situation').value;
  const contain = fields.get('contain').value;
  const support = fields.get('support').value;
  if (typeof thing !== 'string' || !thing.trim() || thing !== thing.trim()) {
    throw atomLanguageError(
      'INVALID_ATOM_THING',
      `${location} 的 thing 必须是无首尾空白的非空字符串`,
      { location }
    );
  }
  if (typeof situation !== 'string') {
    throw atomLanguageError(
      'INVALID_ATOM_SITUATION',
      `${location} 的 situation 必须是字符串`,
      { location }
    );
  }
  if (!Array.isArray(contain)) {
    throw atomLanguageError(
      'INVALID_ATOM_CONTAIN',
      `${location} 的 contain 必须是数组`,
      { location }
    );
  }
  if (!Array.isArray(support)) {
    throw atomLanguageError(
      'INVALID_ATOM_SUPPORT',
      `${location} 的 support 必须是数组`,
      { location }
    );
  }
  const atomPath = options.parentAtomPath
    ? `${options.parentAtomPath}/${thing}`
    : thing;
  options.atomPathByGraphPath?.set(`${rootThing}/${atomPath}`, atomPath);
  const projected = {
    [fields.get('thing').rawKey]: thing,
    [fields.get('situation').rawKey]: situation,
    [fields.get('contain').rawKey]: contain.map((child, index) => (
      projectAtom(child, `${location}.contain[${index}]`, rootThing, {
        ...options,
        parentAtomPath: atomPath
      })
    ))
  };
  for (const [rawKey, value] of Object.entries(atom)) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (parsed.baseKey !== 'support') continue;
    projected[rawKey] = value
      .filter((selector) => options.allowLegacySupport !== true || !isLegacySupportEntry(selector))
      .map((selector) => projectedSupport(selector, rootThing));
  }
  return projected;
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
  const projectionOptions = {
    ...options,
    allowLegacySupport: options.allowLegacySupport === true || legacySnapshotMetadata.has(atoms),
    atomPathByGraphPath: new Map(),
    parentAtomPath: ''
  };
  const candidate = {
    config: {
      schema_version: GRAPH_JSON_SCHEMA_VERSION
    },
    graph: {
      thing: rootName,
      situation: '',
      contain: atoms.map((atom, index) => projectAtom(atom, `$[${index}]`, rootName, projectionOptions)),
      support: []
    }
  };
  const parsed = parseGraphDocument(candidate);
  Object.defineProperty(parsed, 'atomPathByGraphPath', {
    value: projectionOptions.atomPathByGraphPath,
    enumerable: false
  });
  return parsed;
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
  const manifestRevision = compatibilityCacheKey(options.compatibilityManifest);
  const cached = contextSnapshots.get(contextFile);
  if (cached?.signature === signature && cached.manifestRevision === manifestRevision) return cached.value;
  const loadKey = `${contextFile}\0${signature}\0${manifestRevision}`;
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
    const normalized = normalizePersistedContext(value);
    const metadata = options.compatibilityManifest
      ? compatibilityMetadata(options.compatibilityManifest, normalized.atoms)
      : normalized.metadata;
    projectAtomContext(normalized.atoms, { allowLegacySupport: Boolean(metadata) });
    const snapshot = freezeSnapshot(normalized.atoms);
    if (metadata) legacySnapshotMetadata.set(snapshot, metadata);
    contextSnapshots.set(contextFile, { signature, manifestRevision, value: snapshot });
    return snapshot;
  })().finally(() => contextLoads.delete(loadKey));
  contextLoads.set(loadKey, loading);
  return loading;
}

/**
 * Atom context persistence is separate from projection persistence so the
 * engine can coordinate the two files without coupling either to knowledge.json.
 */
export async function writeAtomContext(file, atoms, options = {}) {
  const contextFile = resolveAtomContextFile(file);
  const legacy = legacySnapshotMetadata.get(atoms);
  if (legacy?.mode === 'legacy-read-only') {
    throw atomLanguageError(
      'LEGACY_GRAPH_MIGRATION_REQUIRED',
      '存量旧 Graph 已以只读兼容模式加载；完成可验证迁移前禁止普通写入',
      { file: contextFile, sourceFactsHash: legacy.sourceFactsHash }
    );
  }
  if (options.compatibilityManifest) validateCompatibilityManifest(options.compatibilityManifest, atoms);
  const trusted = legacy?.mode === 'versioned-compatibility' || Boolean(options.compatibilityManifest);
  projectAtomContext(atoms, { allowLegacySupport: trusted });
  await atomicWriteJson(contextFile, atoms);
  await rememberContextSnapshot(contextFile, atoms, options);
  return contextFile;
}

export async function writeAtomGraphProjection(file, atoms, options = {}) {
  const graphFile = requireJsonFile(file, 'Graph 投影文件');
  // projectAtomContext returns validated derived relation metadata for runtime
  // consumers; only the strict public Graph document is persisted.
  const { config, graph } = projectAtomContext(atoms, options);
  await atomicWriteJson(graphFile, { config, graph });
  return graphFile;
}
