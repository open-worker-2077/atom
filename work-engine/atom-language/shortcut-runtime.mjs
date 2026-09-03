import crypto from 'node:crypto';

import { diagnostic } from './errors.mjs';
import { parseAtomKey } from './key-parser.mjs';

export const SHORTCUT_TYPE = 'shortcut';
export const SHORTCUT_CONTRACT = 'atom.shortcut';
export const SHORTCUT_VERSION = 1;
export const SHORTCUT_MAX_DEPTH = 8;

function fieldsByBase(atom) {
  const fields = new Map();
  for (const [rawKey, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (parsed.errors.length || fields.has(parsed.baseKey)) continue;
    fields.set(parsed.baseKey, { rawKey, value, parsed });
  }
  return fields;
}

function storedField(atom, baseKey) {
  return fieldsByBase(atom).get(baseKey) ?? null;
}

function walk(atoms) {
  const matches = [];
  function visit(atom, parent, index, parentPath) {
    if (!atom || typeof atom !== 'object' || Array.isArray(atom)) return;
    const thing = storedField(atom, 'thing')?.value;
    const path = [...parentPath, thing];
    const match = { atom, parent, index, path };
    matches.push(match);
    const slot = storedField(atom, 'slot')?.value;
    if (Array.isArray(slot)) {
      slot.forEach((child, childIndex) => visit(child, match, childIndex, path));
    }
  }
  (Array.isArray(atoms) ? atoms : []).forEach((atom, index) => visit(atom, null, index, []));
  return matches;
}

function shortcutFailure(code, message) {
  return Object.assign(new Error(message), { code });
}

function parseMetadata(atom) {
  const situation = storedField(atom, 'situation')?.value;
  const slot = storedField(atom, 'slot')?.value;
  const strut = storedField(atom, 'strut')?.value;
  let metadata;
  try {
    metadata = JSON.parse(situation);
  } catch {
    throw shortcutFailure('INVALID_SHORTCUT_RECORD', '虚拟引用的内核记录无效');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
    || metadata.contract !== SHORTCUT_CONTRACT
    || metadata.version !== SHORTCUT_VERSION
    || typeof metadata.referenceId !== 'string' || !metadata.referenceId
    || !metadata.target || typeof metadata.target !== 'object' || Array.isArray(metadata.target)
    || !['linked', 'broken'].includes(metadata.target.state)
    || (metadata.target.state === 'linked'
      && (typeof metadata.target.path !== 'string' || !metadata.target.path.trim()))
    || (metadata.target.state === 'broken' && metadata.target.path !== null)
    || !Array.isArray(slot) || slot.length !== 0
    || !Array.isArray(strut) || strut.length !== 0) {
    throw shortcutFailure('INVALID_SHORTCUT_RECORD', '虚拟引用的内核记录无效');
  }
  return metadata;
}

function stringifyMetadata(metadata) {
  return JSON.stringify(metadata);
}

export function isShortcutAtom(atom) {
  return storedField(atom, 'thing')?.parsed.types.some((type) => type.raw === SHORTCUT_TYPE) ?? false;
}

export function createShortcutAtom({ thing, targetPath, referenceId = crypto.randomUUID() }) {
  if (typeof thing !== 'string' || !thing.trim() || thing !== thing.trim() || thing.includes('/')) {
    throw shortcutFailure('INVALID_SHORTCUT_THING', 'shortcut.thing 必须是单段非空显示名');
  }
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    throw shortcutFailure('INVALID_SHORTCUT_TARGET_COORDINATE', 'shortcut.target 必须是精确 ThingCoordinate');
  }
  return {
    'thing@shortcut': thing,
    situation: stringifyMetadata({
      contract: SHORTCUT_CONTRACT,
      version: SHORTCUT_VERSION,
      referenceId,
      target: { state: 'linked', path: targetPath.trim() }
    }),
    slot: [],
    strut: []
  };
}

export function shortcutMetadata(atom) {
  return isShortcutAtom(atom) ? structuredClone(parseMetadata(atom)) : null;
}

export function retargetShortcutAtom(atom, targetPath) {
  if (!isShortcutAtom(atom)) {
    throw shortcutFailure('SHORTCUT_RETARGET_REQUIRED', '.lnk. 只可改造虚拟引用自身');
  }
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    throw shortcutFailure(
      'INVALID_SHORTCUT_TARGET_COORDINATE',
      '.lnk. 需要目标的精确语义路径'
    );
  }
  const metadata = parseMetadata(atom);
  metadata.target = { state: 'linked', path: targetPath.trim() };
  replaceSituation(atom, metadata);
  return atom;
}

export function resolveShortcutMatch(atoms, initialMatch, options = {}) {
  if (!isShortcutAtom(initialMatch?.atom)) return initialMatch;
  const maxDepth = options.maxDepth ?? SHORTCUT_MAX_DEPTH;
  const byPath = new Map(walk(atoms).map((match) => [match.path.join('/'), match]));
  const visited = new Set();
  let current = initialMatch;
  let depth = 0;
  while (isShortcutAtom(current.atom)) {
    const currentPath = current.path.join('/');
    if (visited.has(currentPath)) {
      throw shortcutFailure('SHORTCUT_REFERENCE_CYCLE', '虚拟引用链形成循环');
    }
    visited.add(currentPath);
    if (depth >= maxDepth) {
      throw shortcutFailure('SHORTCUT_REFERENCE_DEPTH_EXCEEDED', '虚拟引用链超过最大解析深度');
    }
    const metadata = parseMetadata(current.atom);
    if (metadata.target.state === 'broken') {
      throw shortcutFailure('SHORTCUT_TARGET_BROKEN', '虚拟引用目标已删除或回收');
    }
    const target = byPath.get(metadata.target.path);
    if (!target) {
      throw shortcutFailure('SHORTCUT_TARGET_BROKEN', '虚拟引用目标已删除或回收');
    }
    current = target;
    depth += 1;
  }
  return current;
}

function replaceSituation(atom, metadata) {
  const field = storedField(atom, 'situation');
  atom[field.rawKey] = stringifyMetadata(metadata);
}

function pathWithin(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

export function rewriteShortcutTargetPaths(atoms, changes, affectedPaths = null, preparedMatches = null) {
  const normalized = changes.filter(({ sourcePath, resultPath }) => (
    typeof sourcePath === 'string' && sourcePath
    && typeof resultPath === 'string' && resultPath
  ));
  if (!normalized.length) return atoms;
  for (const { atom, path } of preparedMatches ?? walk(atoms)) {
    if (!isShortcutAtom(atom)) continue;
    const metadata = parseMetadata(atom);
    if (metadata.target.state !== 'linked') continue;
    const change = normalized.find(({ sourcePath }) => pathWithin(metadata.target.path, sourcePath));
    if (!change) continue;
    metadata.target.path = `${change.resultPath}${metadata.target.path.slice(change.sourcePath.length)}`;
    replaceSituation(atom, metadata);
    affectedPaths?.push(path.join('/'));
  }
  return atoms;
}

export function breakShortcutTargets(
  atoms,
  removedPath,
  affectedPaths = null,
  preparedMatches = null,
  restorations = null
) {
  if (typeof removedPath !== 'string' || !removedPath) return atoms;
  for (const { atom, path } of preparedMatches ?? walk(atoms)) {
    if (!isShortcutAtom(atom)) continue;
    const metadata = parseMetadata(atom);
    if (metadata.target.state !== 'linked' || !pathWithin(metadata.target.path, removedPath)) continue;
    restorations?.push({
      referenceId: metadata.referenceId,
      targetPath: metadata.target.path
    });
    metadata.target = { state: 'broken', path: null };
    replaceSituation(atom, metadata);
    affectedPaths?.push(path.join('/'));
  }
  return atoms;
}

export function restoreShortcutTargets(
  atoms,
  restorations,
  { originalPath, restoredPath },
  affectedPaths = null,
  preparedMatches = null
) {
  if (!Array.isArray(restorations) || !originalPath || !restoredPath) return atoms;
  const byIdentity = new Map(restorations.map((entry) => [entry.referenceId, entry]));
  for (const { atom, path } of preparedMatches ?? walk(atoms)) {
    if (!isShortcutAtom(atom)) continue;
    const metadata = parseMetadata(atom);
    const restoration = byIdentity.get(metadata.referenceId);
    if (!restoration
      || metadata.target.state !== 'broken'
      || !pathWithin(restoration.targetPath, originalPath)) continue;
    metadata.target = {
      state: 'linked',
      path: `${restoredPath}${restoration.targetPath.slice(originalPath.length)}`
    };
    replaceSituation(atom, metadata);
    affectedPaths?.push(path.join('/'));
  }
  return atoms;
}

export async function applyShortcutEffect({
  atoms,
  effect,
  authorize = async () => ({ decision: 'allow' })
}) {
  const matches = walk(atoms);
  const source = matches.find((match) => match.path.join('/') === effect?.sourceProgramPath);
  if (!source || !storedField(source.atom, 'thing')?.parsed.types.some((type) => type.raw === 'program')) {
    return { error: diagnostic(
      'SHORTCUT_PLACEMENT_PROGRAM_NOT_FOUND',
      'shortcut() 的当前 Program 位置不存在'
    ) };
  }
  if (effect?.action === 'delete') {
    const reference = matches.find((match) => match.path.join('/') === effect.referencePath);
    if (!reference) {
      return { error: diagnostic('SHORTCUT_REFERENCE_NOT_FOUND', '待删除的虚拟引用不存在') };
    }
    if (!isShortcutAtom(reference.atom)
      || parseMetadata(reference.atom).referenceId !== effect.referenceIdentity) {
      return { error: diagnostic(
        'SHORTCUT_DELETE_REFERENCE_REQUIRED',
        'shortcut delete 只接受虚拟引用自身的精确 ThingCoordinate'
      ) };
    }
    for (const [match, field] of [[reference, 'thing'], [reference.parent, 'slot']]) {
      if (!match || (await authorize(
        match, 'write', field, { programPath: effect.sourceProgramPath }
      )).decision !== 'allow') {
        return { error: diagnostic(
          'SHORTCUT_REFERENCE_ACCESS_DENIED',
          '当前 Agent 无权删除该虚拟引用'
        ) };
      }
    }
    const nextAtoms = structuredClone(atoms);
    const nextReference = walk(nextAtoms)
      .find((match) => match.path.join('/') === effect.referencePath);
    const siblings = nextReference.parent
      ? storedField(nextReference.parent.atom, 'slot').value
      : nextAtoms;
    siblings.splice(nextReference.index, 1);
    return {
      atoms: nextAtoms,
      changed: true,
      action: 'delete',
      resultPath: effect.referencePath,
      referenceIdentity: effect.referenceIdentity,
      triggerPaths: [effect.referencePath]
    };
  }
  if (effect?.placement !== 'slot') {
    return { error: diagnostic(
      'INVALID_SHORTCUT_PLACEMENT',
      'shortcut.placement 首版只接受 slot'
    ) };
  }
  if (typeof effect.thing !== 'string' || !effect.thing.trim()
    || effect.thing !== effect.thing.trim() || effect.thing.includes('/')) {
    return { error: diagnostic('INVALID_SHORTCUT_THING', 'shortcut.thing 必须是单段非空显示名') };
  }
  const target = matches.find((match) => match.path.join('/') === effect.targetPath);
  if (!target) {
    return { error: diagnostic('SHORTCUT_TARGET_BROKEN', '虚拟引用目标已删除或回收') };
  }
  const targetDecision = await authorize(
    target,
    'read',
    'thing',
    { programPath: effect.sourceProgramPath }
  );
  if (targetDecision.decision !== 'allow') {
    return { error: diagnostic(
      'SHORTCUT_TARGET_ACCESS_DENIED',
      '当前 Agent 无权访问虚拟引用目标'
    ) };
  }
  const placementDecision = await authorize(
    source,
    'write',
    'slot',
    { programPath: effect.sourceProgramPath }
  );
  if (placementDecision.decision !== 'allow') {
    return { error: diagnostic(
      placementDecision.code ?? 'WINDOW_ACCESS_DENIED',
      '当前 Agent 无权在当前 Program 下创建虚拟引用'
    ) };
  }

  const children = storedField(source.atom, 'slot')?.value;
  const existing = children.find((child) => storedField(child, 'thing')?.value === effect.thing);
  if (existing) {
    if (isShortcutAtom(existing)) {
      const metadata = parseMetadata(existing);
      if (metadata.target.state === 'linked' && metadata.target.path === effect.targetPath) {
        return {
          atoms,
          changed: false,
          resultPath: `${effect.sourceProgramPath}/${effect.thing}`,
          targetPath: effect.targetPath,
          triggerPaths: []
        };
      }
    }
    return { error: diagnostic(
      'DUPLICATE_DESTINATION_CHILD',
      '当前 Program 下已存在同名 Thing'
    ) };
  }

  const nextAtoms = structuredClone(atoms);
  const nextSource = walk(nextAtoms).find((match) => match.path.join('/') === effect.sourceProgramPath);
  storedField(nextSource.atom, 'slot').value.push(createShortcutAtom({
    thing: effect.thing,
    targetPath: effect.targetPath
  }));
  return {
    atoms: nextAtoms,
    changed: true,
    resultPath: `${effect.sourceProgramPath}/${effect.thing}`,
    targetPath: effect.targetPath,
    triggerPaths: [`${effect.sourceProgramPath}/${effect.thing}`, effect.targetPath]
  };
}
