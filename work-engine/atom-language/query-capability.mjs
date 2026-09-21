import { diagnostic } from './errors.mjs';
import { isProvenWorldObject, isSealedWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';
import { matchesExactSelector } from './exact-selector.mjs';
import { parseThingSelector } from './thing-selector.mjs';
import { parseAtomKey } from './key-parser.mjs';
import { createAtomLanguageReceiver } from './receiver.mjs';
import { parseSlotRelativeSelector, resolveSlotRelativeSelector } from './slot-relative-scope.mjs';
import { selectCoordinateScope } from './world-laws/coordinates.mjs';
import { decodeLockAtoms, evaluateLockAccess } from './world-laws/locks.mjs';
import { createDefaultWorldLawRegistry } from './world-laws/registry.mjs';
import { authorizeProgramLock, programLockState } from './program-locks.mjs';
import { WORLD_OUTSIDE_NAME, worldOutsideAtom } from './world-root.mjs';
import { authorizeWindowGraphPath } from './window-lock-v1.mjs';
import { compileSlotStructureGraphLocks } from './slot-body-plan-runtime.mjs';
import {
  isShortcutAtom,
  resolveShortcutMatch,
  shortcutMetadata
} from './shortcut-runtime.mjs';

const preparedExploreSnapshots = new WeakMap();
const preparedSlotStructureSnapshots = new WeakMap();
const preparedAtomFields = new WeakMap();

function freezeDescription(value) {
  if (!value || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freezeDescription(child);
  return Object.freeze(value);
}

function fieldDescriptions(atom) {
  const proven = isProvenWorldObject(atom);
  if (proven && preparedAtomFields.has(atom)) return preparedAtomFields.get(atom);
  const byBase = new Map();
  for (const [rawKey, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (parsed.errors.length) continue;
    const list = byBase.get(parsed.baseKey) ?? [];
    list.push(Object.freeze({ rawKey, value, parsed: freezeDescription(parsed) }));
    byBase.set(parsed.baseKey, list);
  }
  for (const list of byBase.values()) Object.freeze(list);
  if (proven) preparedAtomFields.set(atom, byBase);
  return byBase;
}

function readStoredField(atom, baseKey) {
  const matches = fieldDescriptions(atom).get(baseKey) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

// Only immutable scalar declaration data crosses this internal boundary.
// An unusual mutable situation retains the public-field fallback semantics.
export function readOnlyProgramDeclarationFields(atom) {
  const thing = readStoredField(atom, 'thing');
  if (!thing?.parsed.types.some((type) => type.raw === 'program')) return null;
  const situation = readStoredField(atom, 'situation');
  const value = situation?.value ?? null;
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    return undefined;
  }
  return Object.freeze({
    thingKey: thing.rawKey,
    situationKey: situation?.rawKey ?? null,
    situation: value
  });
}

export function isStoredTypedDefaultBackupAtom(atom) {
  // Boundary classification takes the first thing field. The first valid
  // descriptor is conservative if an earlier malformed field was omitted.
  const types = fieldDescriptions(atom).get('thing')?.[0]?.parsed.types ?? [];
  return types.some((type) => type.raw === 'backup')
    && types.some((type) => type.raw === 'default');
}

function publicField(field) {
  return { rawKey: field.rawKey, value: field.value, parsed: structuredClone(field.parsed) };
}

export function fieldsByBase(atom) {
  const byBase = new Map();
  for (const [baseKey, fields] of fieldDescriptions(atom)) {
    byBase.set(baseKey, fields.map(publicField));
  }
  return byBase;
}

export function oneStoredField(atom, baseKey) {
  const field = readStoredField(atom, baseKey);
  return field ? publicField(field) : null;
}

function storedStrutFields(atom) {
  return fieldDescriptions(atom).get('strut') ?? [];
}

export function walkAtoms(atoms, options = {}) {
  const visited = [];
  function visit(atom, parentPath, index, parent = null) {
    if (!atom || typeof atom !== 'object' || Array.isArray(atom)) return;
    const nameField = readStoredField(atom, 'thing');
    const name = typeof nameField?.value === 'string' ? nameField.value : `[${index}]`;
    const visiblePath = [...parentPath, name];
    const match = { atom, path: visiblePath, parent, index };
    visited.push(match);
    if (options.skipDescendants?.(match) === true) return;
    const children = readStoredField(atom, 'slot')?.value;
    if (Array.isArray(children)) {
      children.forEach((child, childIndex) => visit(child, visiblePath, childIndex, match));
    }
  }
  let virtualRoot = null;
  if (options.virtualRoot) {
    virtualRoot = {
      atom: worldOutsideAtom(),
      path: [WORLD_OUTSIDE_NAME],
      parent: null,
      index: -1,
      virtual: true
    };
    visited.push(virtualRoot);
  }
  atoms.forEach((atom, index) => visit(atom, [], index, virtualRoot));
  return visited;
}

function nameFieldIn(item) {
  return item.fields.find((field) => field.baseKey === 'thing');
}

export function exactMatches(atoms, item, matcherRegistry, candidates = null, exactIndex = null) {
  const nameField = nameFieldIn(item);
  if (!nameField?.valuePresent || typeof nameField.value !== 'string' || !nameField.value) {
    return { error: diagnostic('ATOM_THING_REQUIRED', '首轮 explore/transform 执行需要带 Value 的 thing 精确锚点') };
  }
  const mode = nameField.matcher?.mode ?? 'exact';
  const parsedSelector = mode === 'exact' ? parseThingSelector(nameField.value) : null;
  if (parsedSelector?.kind === 'invalid-identity') return { error: parsedSelector.error };
  if (parsedSelector?.kind === 'identity') {
    const available = candidates ?? walkAtoms(atoms);
    return {
      matches: available.filter(match => (
        readStoredField(match.atom, 'thing')?.parsed.identity === parsedSelector.identity
      )),
      expected: 'identity selector'
    };
  }
  const matcher = matcherRegistry.resolve(mode);
  if (!matcher) {
    return { error: diagnostic('UNSUPPORTED_MATCHER', `不支持此匹配模式：${mode}`, { mode }) };
  }
  if (mode === 'exact' && exactIndex) {
    const indexed = exactIndex.get(nameField.value) ?? [];
    if (!candidates) {
      return { matches: indexed, expected: nameField.value };
    }
    const candidateSet = new Set(candidates);
    return {
      matches: indexed.filter((match) => candidateSet.has(match)),
      expected: nameField.value
    };
  }
  const available = candidates ?? walkAtoms(atoms);
  const matches = available.filter(({ atom, path: atomPath }) => {
    if (mode === 'exact') {
      return matchesExactSelector(
        atomPath,
        readStoredField(atom, 'thing')?.value,
        nameField.value
      );
    }
    return matcher.match(readStoredField(atom, 'thing')?.value, nameField.value);
  });
  return { matches, expected: nameField.value };
}

export function createAccessController(atoms, options = {}) {
  if (options.trustedMaintenance === true) {
    return { restricted: false, authorize: async () => ({ decision: 'allow', matchedLocks: [] }) };
  }
  const programLockIndex = options.programLockIndex?.byPath?.size ? options.programLockIndex : null;
  const humanAuthority = options.humanAuthority === true;
  const legacyAccess = options.legacyAccess;
  const agentPath = options.agentPath ?? options.interaction?.agent?.path ?? null;
  const agentIdentity = Boolean(agentPath && options.agentSecurity);
  const fixedAgentWindow = agentIdentity;
  const exploreWorld = Array.isArray(options.preparedAccessMatches)
    ? { allMatches: options.preparedAccessMatches }
    : prepareExploreWorld(atoms);
  const slotStructure = prepareSlotStructureWorld(atoms);
  const graphLocks = [...(options.graphLocks ?? []), ...slotStructure.locks];
  const graphLocksByAction = new Map();
  const locksForAction = (action) => {
    if (!graphLocksByAction.has(action)) {
      graphLocksByAction.set(action, graphLocks.filter((lock) => (
        Array.isArray(lock.actions) && lock.actions.includes(action)
      )));
    }
    return graphLocksByAction.get(action);
  };
  const slotStructureRestricted = slotStructure.locks.length > 0;
  if (!humanAuthority && (!legacyAccess || legacyAccess.global === true) && !programLockIndex
    && !fixedAgentWindow && !slotStructureRestricted && graphLocks.length === 0) {
    return { restricted: false, authorize: async () => ({ decision: 'allow', matchedLocks: [] }) };
  }
  const registry = options.worldLawRegistry ?? createDefaultWorldLawRegistry();
  const locks = legacyAccess && legacyAccess.global !== true ? decodeLockAtoms(atoms) : [];
  const access = legacyAccess;
  const agentMatch = agentPath
    ? exploreWorld.allMatches.find((match) => match.path.join('/') === agentPath)
    : null;
  const agentTypes = readStoredField(agentMatch?.atom, 'thing')?.parsed.types
    .map((type) => type.raw) ?? [];
  return {
    restricted: true,
    async authorize(match, operation, field, actor = {}) {
      const targetPath = Array.isArray(match.path) ? match.path.join('/') : match.path;
      const createdTypes = actor.createdAtom
        ? readStoredField(actor.createdAtom, 'thing')?.parsed.types.map((type) => type.raw) ?? []
        : [];
      const targetTypes = readStoredField(match.atom, 'thing')?.parsed.types
        .map((type) => type.raw) ?? [];
      if (operation === 'write' && targetTypes.includes('jump-authorization')
        && actor.windowJumpAuthorization !== true) {
        return {
          decision: 'deny', code: 'WINDOW_JUMP_AUTHORIZATION_IMMUTABLE',
          lockKind: 'window-jump-authorization', matchedLocks: []
        };
      }
      const insideSlotDomain = slotStructure.domains.some(({ path }) => (
        targetPath === path || targetPath.startsWith(`${path}/`)
      ));
      if (operation === 'write' && insideSlotDomain
        && createdTypes.some((type) => type.startsWith('slot-role-'))) {
        return {
          decision: 'deny', code: 'SLOT_ROLE_FORGERY_DENIED',
          lockKind: 'slot-structure-lock', matchedLocks: []
        };
      }
      // Web is the explicit human control surface. Its authority is not an
      // Agent label, while kernel-owned identities and structural roles remain immutable.
      if (humanAuthority) return { decision: 'allow', matchedLocks: [] };
      if (programLockIndex) {
        const decision = authorizeProgramLock({
          lockIndex: programLockIndex, targetPath, operation, field,
          agentPath,
          agentTypes,
          agentIdentity,
          programPath: actor.programPath ?? null,
          targetTypes,
          action: operation === 'read' ? 'explore' : 'transform'
        });
        if (decision.decision !== 'allow') return decision;
      }
      if (access && access.global !== true) {
        const legacyDecision = evaluateLockAccess({
          locks,
          registry,
          operation,
          window: access.window,
          keys: access.keys ?? [],
          target: { name: readStoredField(match.atom, 'thing')?.value ?? match.name ?? null, path: targetPath }
        });
        if (legacyDecision.decision !== 'allow') return legacyDecision;
      }
      if (fixedAgentWindow || graphLocks.length > 0) {
        const capabilities = [];
        if (actor.slotMaterialCreate === true) capabilities.push('slot-material-create');
        if (actor.slotMaterialMove === true) capabilities.push('slot-material-move');
        if (actor.slotReseal === true) capabilities.push('slot-reseal');
        const fixed = authorizeWindowGraphPath({
          agentPath: fixedAgentWindow ? agentPath : null,
          targetPath,
          operation: operation === 'read' ? 'explore' : 'transform',
          locks: locksForAction(operation === 'read' ? 'explore' : 'transform'),
          labels: options.agentSecurity?.labels ?? [],
          capabilities,
          field,
          windowLifecycle: actor.windowLifecycle ?? null
        });
        if (fixed.decision !== 'allow') return fixed;
      }
      return { decision: 'allow', matchedLocks: [] };
    }
  };
}

export function describeAtom(match, includeFullDetail, options = {}) {
  const nameField = readStoredField(match.atom, 'thing');
  const detailField = readStoredField(match.atom, 'situation');
  const result = {
    path: match.path.join('/'),
    selector: options.selector ?? match.path.join('/'),
    thing: nameField?.value ?? null,
    types: nameField?.parsed.types.map((type) => type.raw) ?? [],
    description: detailField?.parsed.descriptionPresent ? detailField.parsed.description : null
  };
  if (['explicit', 'ambiguity', 'audit'].includes(options.identityDisclosure)
    && nameField?.parsed.identity) {
    result.identity = `@${nameField.parsed.identity}`;
  }
  if (includeFullDetail) result.situation = detailField?.value ?? null;
  for (const field of options.strutFields ?? []) {
    result[field.rawKey] = structuredClone(field.value);
  }
  if (options.lockState) result.lockState = structuredClone(options.lockState);
  if (options.lockStatus) result.lockStatus = structuredClone(options.lockStatus);
  if (options.resolvedThroughShortcut) result.resolvedThroughShortcut = structuredClone(options.resolvedThroughShortcut);
  return result;
}

function graphLockState(graphLocks, targetPath) {
  const matches = (graphLocks ?? []).filter((lock) => (
    lock?.kind === 'node' ? lock.path === targetPath
      : lock?.kind === 'slot' && (targetPath === lock.path || targetPath.startsWith(`${lock.path}/`))
  ));
  if (!matches.length) return null;
  return Object.freeze({
    kind: matches.some((lock) => lock.kind === 'slot') ? 'slot' : 'node',
    path: targetPath,
    actions: [...new Set(matches.flatMap((lock) => lock.actions ?? []))].sort(),
    labels: [...new Set(matches.flatMap((lock) => lock.labels ?? []))].sort(),
    sourceProgramPath: matches.map((lock) => lock.sourceProgramPath).sort().join(',')
  });
}

function compiledLockState(lockIndex, graphLocks, targetPath) {
  return graphLockState(graphLocks, targetPath) ?? programLockState(lockIndex, targetPath);
}

function shortcutResolutionMarker(match) {
  const metadata = shortcutMetadata(match.atom);
  return {
    identity: metadata.referenceId,
    thing: readStoredField(match.atom, 'thing')?.value ?? null,
    placement: 'slot',
    path: match.path.join('/')
  };
}

function prepareExploreMatches(allMatches) {
  const exactIndex = new Map();
  const add = (selector, match) => {
    if (!indexableSelector(selector)) return;
    if (!exactIndex.has(selector)) exactIndex.set(selector, []);
    exactIndex.get(selector).push(match);
  };
  for (const match of allMatches) {
    const name = readStoredField(match.atom, 'thing')?.value;
    add(name, match);
    for (let length = 2; length <= match.path.length; length += 1) {
      add(match.path.slice(-length).join('/'), match);
    }
    if (!match.virtual) add(`${WORLD_OUTSIDE_NAME}/${match.path.join('/')}`, match);
  }
  return { allMatches, exactIndex };
}

export function prepareExploreWorld(atoms) {
  if (isSealedWorldFacts(atoms) && preparedExploreSnapshots.has(atoms)) {
    return preparedExploreSnapshots.get(atoms);
  }
  const prepared = prepareExploreMatches(walkAtoms(atoms, { virtualRoot: true }));
  if (isSealedWorldFacts(atoms)) preparedExploreSnapshots.set(atoms, prepared);
  return prepared;
}

export function prepareAccessWorld(atoms) {
  const exploreWorld = prepareExploreWorld(atoms);
  const slotStructure = prepareSlotStructureWorld(atoms);
  return { exploreWorld, slotStructure };
}

export function prepareSlotStructureWorld(atoms) {
  let slotStructure = isSealedWorldFacts(atoms)
    ? preparedSlotStructureSnapshots.get(atoms)
    : null;
  if (!slotStructure) {
    slotStructure = compileSlotStructureGraphLocks(atoms);
    if (isSealedWorldFacts(atoms)) preparedSlotStructureSnapshots.set(atoms, slotStructure);
  }
  return slotStructure;
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function inheritPreparedSlotStructureWorld(previousAtoms, nextAtoms, changedPaths = []) {
  if (!isSealedWorldFacts(previousAtoms) || !isSealedWorldFacts(nextAtoms)) return false;
  const previousSlotStructure = preparedSlotStructureSnapshots.get(previousAtoms);
  if (!previousSlotStructure) return false;
  const protectedPaths = [
    ...previousSlotStructure.domains.flatMap(({ path, body }) => [path, body]),
    ...previousSlotStructure.locks.flatMap(({ path, body }) => [path, body])
  ].filter(Boolean);
  if (changedPaths.some((changedPath) => (
    protectedPaths.some((protectedPath) => pathsOverlap(changedPath, protectedPath))
  ))) return false;
  preparedSlotStructureSnapshots.set(nextAtoms, previousSlotStructure);
  return true;
}

export function inheritPreparedAccessWorld(previousAtoms, nextAtoms, observe = null) {
  if (typeof observe === 'function') {
    const previousExplore = preparedExploreSnapshots.get(previousAtoms);
    const previousSlotStructure = preparedSlotStructureSnapshots.get(previousAtoms);
    try {
      observe({ previousSealed: isSealedWorldFacts(previousAtoms), nextSealed: isSealedWorldFacts(nextAtoms),
        previousExplore: Boolean(previousExplore), previousSlotStructure: Boolean(previousSlotStructure),
        exploreMatches: previousExplore?.allMatches.length ?? 0, exploreSelectors: previousExplore?.exactIndex.size ?? 0,
        slotDomains: previousSlotStructure?.domains.length ?? 0, slotLocks: previousSlotStructure?.locks.length ?? 0 });
    } catch { /* Local observation cannot alter cache inheritance. */ }
  }
  if (!isSealedWorldFacts(previousAtoms) || !isSealedWorldFacts(nextAtoms)) return false;
  const previousExplore = preparedExploreSnapshots.get(previousAtoms);
  const previousSlotStructure = preparedSlotStructureSnapshots.get(previousAtoms);
  if (!previousExplore || !previousSlotStructure) return false;
  const currentByPath = new Map(walkAtoms(nextAtoms).map((match) => [match.path.join('/'), match]));
  const previousPaths = previousExplore.allMatches
    .filter((match) => !match.virtual)
    .map((match) => match.path.join('/'));
  if (previousPaths.length !== currentByPath.size
    || previousPaths.some((candidatePath) => !currentByPath.has(candidatePath))) {
    return false;
  }
  const replacements = new Map();
  const allMatches = previousExplore.allMatches.map((previous) => {
    if (previous.virtual) return previous;
    const current = currentByPath.get(previous.path.join('/'));
    if (!current) return previous;
    const replacement = {
      ...current,
      parent: previous.parent ? (replacements.get(previous.parent) ?? previous.parent) : null
    };
    replacements.set(previous, replacement);
    return replacement;
  });
  const exactIndex = new Map([...previousExplore.exactIndex].map(([selector, matches]) => (
    [selector, matches.map((match) => replacements.get(match) ?? match)]
  )));
  preparedExploreSnapshots.set(nextAtoms, { allMatches, exactIndex });
  preparedSlotStructureSnapshots.set(nextAtoms, previousSlotStructure);
  return true;
}

function indexableSelector(selector) {
  return typeof selector === 'string' && selector.length > 0;
}

function shortestUniqueSelector(match, matches) {
  for (let length = 1; length <= match.path.length; length += 1) {
    const suffix = match.path.slice(-length).join('/');
    const count = matches.filter((candidate) => (
      candidate.path.slice(-length).join('/') === suffix
    )).length;
    if (count === 1) return suffix;
  }
  return match.path.join('/');
}

function resolvePartnerTarget(source, target, matches) {
  if (typeof target !== 'string' || !target) return null;
  const byPath = new Map(matches.map((match) => [match.path.join('/'), match]));
  if (target.includes('/')) return byPath.get(target) ?? null;
  const sibling = byPath.get([...source.path.slice(0, -1), target].join('/'));
  if (sibling) return sibling;
  const named = matches.filter((match) => readStoredField(match.atom, 'thing')?.value === target);
  for (let depth = source.path.length - 2; depth >= 0; depth -= 1) {
    const domain = source.path.slice(0, depth + 1);
    const scoped = named.filter((match) => domain.every((part, index) => match.path[index] === part));
    if (scoped.length === 1) return scoped[0];
    if (scoped.length > 1) return null;
  }
  return named.length === 1 ? named[0] : null;
}

function strutRuleEndpoints(owner, matches) {
  const selectorsInExpr = (expr) => {
    if (!expr || typeof expr !== 'object' || Array.isArray(expr)) return [];
    if (typeof expr.thing === 'string') return [expr.thing];
    if (typeof expr.program === 'string') return [];
    return ['and', 'or'].flatMap((operator) => (
      Array.isArray(expr[operator]) ? expr[operator].flatMap(selectorsInExpr) : []
    ));
  };
  return storedStrutFields(owner.atom).flatMap((field) => (
    Array.isArray(field.value) ? field.value.map((rule, ordinal) => {
      const endpoints = new Set([owner]);
      for (const selector of [
        ...(Array.isArray(rule?.if) ? rule.if.flatMap(selectorsInExpr) : []),
        ...(Array.isArray(rule?.then) ? rule.then.map((item) => item?.thing ?? item?.['thing@program']) : [])
      ]) {
        const target = resolvePartnerTarget(owner, selector, matches);
        if (target) endpoints.add(target);
      }
      return { key: field.rawKey, ordinal, owner, endpoints };
    }) : []
  ));
}

function strutScope(anchor, matches) {
  const selected = new Set([anchor]);
  for (const owner of matches) {
    for (const rule of strutRuleEndpoints(owner, matches)) {
      if (!rule.endpoints.has(anchor)) continue;
      selected.add(owner);
      for (const endpoint of rule.endpoints) selected.add(endpoint);
    }
  }
  return selected;
}

function boundaryCandidates(anchor, matches, selected) {
  const outside = (candidate) => !selected.has(candidate);
  const childrenByParent = new Map();
  for (const match of matches) {
    const children = childrenByParent.get(match.parent) ?? [];
    children.push(match);
    childrenByParent.set(match.parent, children);
  }
  const up = [];
  let ancestor = anchor.parent;
  while (ancestor) {
    if (outside(ancestor)) up.push(ancestor);
    ancestor = ancestor.parent;
  }
  const down = [];
  const descendants = [...(childrenByParent.get(anchor) ?? [])];
  for (let index = 0; index < descendants.length; index += 1) {
    const candidate = descendants[index];
    if (outside(candidate)) down.push(candidate);
    descendants.push(...(childrenByParent.get(candidate) ?? []));
  }
  const siblings = childrenByParent.get(anchor.parent) ?? [];
  const anchorIndex = siblings.indexOf(anchor);
  const left = anchorIndex < 0
    ? []
    : siblings.slice(0, anchorIndex).filter(outside);
  const right = anchorIndex < 0
    ? []
    : siblings.slice(anchorIndex + 1).filter(outside);
  return { up, down, left, right };
}

async function boundaryDirection(candidates, accessController) {
  let characters = 0;
  for (const candidate of candidates) {
    const nameField = readStoredField(candidate.atom, 'thing');
    const executable = nameField?.parsed.types.some((type) => type.raw === 'program') ?? false;
    if (accessController.restricted) {
      const nameAccess = await accessController.authorize(candidate, 'read', 'thing');
      const detailAccess = executable
        ? { decision: 'allow' }
        : await accessController.authorize(candidate, 'read', 'situation');
      if (nameAccess.decision !== 'allow' || detailAccess.decision !== 'allow') {
        return { state: 'protected', hasMore: true };
      }
    }
    const name = typeof nameField?.value === 'string' ? nameField.value : '';
    const detail = readStoredField(candidate.atom, 'situation')?.value;
    characters += name.length + (executable ? 0 : String(detail ?? '').length);
  }
  return {
    state: 'complete',
    hasMore: candidates.length > 0,
    nodes: candidates.length,
    characters
  };
}

async function exploreBoundary(anchor, matches, selected, accessController) {
  const candidates = boundaryCandidates(anchor, matches, selected);
  const entries = await Promise.all(Object.entries(candidates).map(async ([direction, values]) => (
    [direction, await boundaryDirection(values, accessController)]
  )));
  return Object.fromEntries(entries);
}

export async function executeExploreItem(
  atoms,
  item,
  matcherRegistry,
  accessController,
  lockIndex = null,
  preparedWorld = null,
  options = {}
) {
  if (!item.ok) return { ok: false, index: item.index, errors: item.errors };
  const isProjection = (field) => !field.valuePresent || field.value === true;
  const unsupported = item.fields.filter((field) => {
    if (field.baseKey === 'thing') return false;
    if (field.baseKey === 'situation') return !isProjection(field) || field.actions.some((action) => !['full', 'lock'].includes(action.name));
    if (field.baseKey === 'slot') {
      return !isProjection(field) || field.actions.some((action) => !['latitude', 'longitude'].includes(action.name));
    }
    if (field.baseKey === 'strut') return !isProjection(field) || field.actions.length > 0;
    return field.valuePresent || field.actions.length > 0;
  });
  if (unsupported.length) {
    return {
      ok: false,
      index: item.index,
      errors: [diagnostic('UNSUPPORTED_EXPLORE_EXECUTION', '当前 explore 只执行 exact thing、situation$full、slot$latitude/longitude 与 strut 投影', {
        fields: unsupported.map((field) => field.rawKey)
      })]
    };
  }
  const prepared = preparedWorld ?? prepareExploreWorld(atoms);
  const allMatches = prepared.allMatches;
  const visibleMatches = accessController.restricted ? [] : allMatches;
  const requestedReadFields = new Set(['thing']);
  if (item.fields.some((field) => field.baseKey === 'situation' && field.actions.some((action) => action.name === 'full'))) requestedReadFields.add('situation');
  if (item.fields.some((field) => field.baseKey === 'slot')) requestedReadFields.add('slot');
  if (item.fields.some((field) => field.baseKey === 'strut')) requestedReadFields.add('strut');
  for (const match of accessController.restricted ? allMatches : []) {
    if (match.virtual) {
      visibleMatches.push(match);
      continue;
    }
    let allowed = true;
    for (const field of requestedReadFields) {
      const decision = await accessController.authorize(match, 'read', field);
      if (decision.decision !== 'allow') {
        allowed = false;
        break;
      }
    }
    if (allowed) visibleMatches.push(match);
  }
  const selected = exactMatches(
    atoms, item, matcherRegistry, visibleMatches, prepared.exactIndex
  );
  if (selected.error) return { ok: false, index: item.index, errors: [selected.error] };
  if (selected.matches.length === 0) {
    const unfiltered = exactMatches(
      atoms, item, matcherRegistry, allMatches, prepared.exactIndex
    );
    if (unfiltered.error) return { ok: false, index: item.index, errors: [unfiltered.error] };
    if (unfiltered.matches.length > 0) {
      const programSources = [];
      let windowAccessDenied = false;
      for (const match of unfiltered.matches) {
        for (const field of requestedReadFields) {
          const decision = await accessController.authorize(match, 'read', field);
          if (decision.decision !== 'allow' && decision.code === 'WINDOW_ACCESS_DENIED') {
            windowAccessDenied = true;
          }
          for (const source of decision.matched ?? []) {
            if (!programSources.some((candidate) => candidate.sourceProgramPath === source.sourceProgramPath)) {
              programSources.push(source);
            }
          }
        }
      }
      if (windowAccessDenied) {
        return {
          ok: false,
          index: item.index,
          errors: [diagnostic(
            'WINDOW_ACCESS_DENIED',
            '固定 Agent 窗口边界拒绝读取该 exact 目标'
          )]
        };
      }
      const source = programSources[0];
      const reason = source?.reason?.message?.trim();
      const contextExplanation = source?.allowedWindows
        || source?.allowedWindowTypes
        || source?.allowedWindowRelation
        ? '当前已声明 Agent Program 上下文未满足放行条件。'
        : '此限制不依赖 Agent Program 上下文。';
      const explanation = source?.sourceProgramPath
        ? `目标存在，但读取受到 Program“${source.sourceProgramPath}”限制。${reason ? `原因：${reason}。` : ''}${contextExplanation}`
        : '目标存在，但读取受到世界规则限制；此限制不依赖 Agent Program 上下文。';
      return {
        ok: true,
        index: item.index,
        matches: [],
        warnings: [diagnostic('ATOM_READ_PROTECTED', explanation, {
          programs: programSources.map((candidate) => ({
            sourceProgramPath: candidate.sourceProgramPath,
            reason: candidate.reason ?? null
          }))
        })]
      };
    }
    return {
      ok: false,
      index: item.index,
      errors: [diagnostic('ATOM_NOT_FOUND', `找不到 exact name 为“${selected.expected}”的 Atom`, { name: selected.expected })]
    };
  }
  if (selected.matches.length > 1) {
    return {
      ok: false,
      index: item.index,
      errors: [diagnostic('AMBIGUOUS_ATOM_NAME', `exact name“${selected.expected}”匹配到多个 Atom，首轮不会猜测`, {
        name: selected.expected,
        paths: selected.matches.map((match) => match.path.join('/')),
        candidates: selected.matches.map((match) => ({
          path: match.path.join('/'),
          identity: `@${readStoredField(match.atom, 'thing').parsed.identity}`
        }))
      })]
    };
  }
  const shortcutMatch = isShortcutAtom(selected.matches[0].atom) ? selected.matches[0] : null;
  let resolvedThroughShortcut = null;
  if (shortcutMatch) {
    let target;
    try {
      target = resolveShortcutMatch(atoms, shortcutMatch);
    } catch (error) {
      return { ok: false, index: item.index, errors: [diagnostic(
        error.code ?? 'INVALID_SHORTCUT_RECORD', error.message ?? '虚拟引用无法解析'
      )] };
    }
    for (const field of requestedReadFields) {
      if ((await accessController.authorize(target, 'read', field)).decision !== 'allow') {
        return { ok: false, index: item.index, errors: [diagnostic(
          'SHORTCUT_TARGET_ACCESS_DENIED', '当前 Agent 无权访问虚拟引用目标'
        )] };
      }
    }
    selected.matches[0] = target;
    resolvedThroughShortcut = shortcutResolutionMarker(shortcutMatch);
  }
  const includeFullDetail = item.fields.some((field) => field.baseKey === 'situation'
    && field.actions.some((action) => action.name === 'full'));
  const includeLockStatus = item.fields.some((field) => field.baseKey === 'situation'
    && field.actions.some((action) => action.name === 'lock'));
  const graphLocks = options.graphLocks ?? [];
  const includeStrut = item.fields.some((field) => field.baseKey === 'strut');
  const anchor = visibleMatches.find((match) => match.atom === selected.matches[0].atom);
  const queryThingField = nameFieldIn(item);
  const querySelector = queryThingField?.matcher?.mode === 'exact'
    ? parseThingSelector(queryThingField.value)
    : null;
  const anchorIdentityDisclosure = querySelector?.kind === 'identity'
    ? 'explicit'
    : queryThingField?.hints.some((hint) => hint.name === 'identity') ? 'audit' : null;
  const routes = item.fields.filter((field) => field.baseKey === 'slot').flatMap((field) => (
    field.actions.map((action) => ({ axis: action.name, parameter: action.parameter }))
  ));
  const scoped = selectCoordinateScope(anchor, visibleMatches, routes);
  if (includeStrut) {
    for (const match of strutScope(anchor, visibleMatches)) scoped.add(match);
  }
  const ordered = visibleMatches.filter((match) => scoped.has(match));
  const boundary = options.includeBoundary === false
    ? null
    : await exploreBoundary(anchor, allMatches, scoped, accessController);
  const describedMatches = [];
  for (const match of ordered) {
    let describedMatch = match;
    let marker = match === anchor ? resolvedThroughShortcut : null;
    if (isShortcutAtom(match.atom)) {
      try {
        describedMatch = resolveShortcutMatch(atoms, match);
      } catch (error) {
        describedMatches.push({
          path: match.path.join('/'), selector: shortestUniqueSelector(match, visibleMatches),
          thing: readStoredField(match.atom, 'thing')?.value ?? null, types: ['shortcut'],
          description: null, shortcut: { state: 'broken', error: error.code ?? 'INVALID_SHORTCUT_RECORD' }
        });
        continue;
      }
      let allowed = true;
      for (const field of requestedReadFields) {
        if ((await accessController.authorize(describedMatch, 'read', field)).decision !== 'allow') {
          allowed = false;
          break;
        }
      }
      if (!allowed) continue;
      marker = shortcutResolutionMarker(match);
    }
    const described = describeAtom(describedMatch, includeFullDetail, {
      selector: shortestUniqueSelector(describedMatch, visibleMatches),
      ...(match === anchor && anchorIdentityDisclosure
        ? { identityDisclosure: anchorIdentityDisclosure }
        : {}),
      ...(includeStrut ? { strutFields: storedStrutFields(describedMatch.atom) } : {}),
      lockState: compiledLockState(lockIndex, graphLocks, describedMatch.path.join('/')),
      ...(includeLockStatus ? {
        lockStatus: (() => {
          const compiled = compiledLockState(lockIndex, graphLocks, describedMatch.path.join('/'));
          return { active: compiled !== null, compiled };
        })()
      } : {}),
      ...(marker ? { resolvedThroughShortcut: marker } : {})
    });
    if (isShortcutAtom(match.atom)) described.path = marker.path;
    describedMatches.push(described);
  }
  return {
    ok: true,
    index: item.index,
    matches: describedMatches,
    ...(boundary ? { anchorPath: anchor.path.join('/'), boundary } : {}),
    presentation: routes.some((route) => route.axis === 'latitude' && route.parameter < 0)
      ? { kind: 'children-tree', anchorPath: anchor.path.join('/') }
      : null,
    warnings: item.warnings
  };
}

function programObjectSource(command, request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw Object.assign(new Error(`${command}() requires one root JSON object`), { code: 'INVALID_PROGRAM_WORLD_FUNCTION' });
  }
  const fields = Object.entries(request).map(([key, value]) => (
    value === null ? JSON.stringify(key) : `${JSON.stringify(key)}:${JSON.stringify(value)}`
  ));
  return `${command} {${fields.join(',')}}`;
}

export async function executeProgramExplore({
  atoms,
  request,
  receiver = createAtomLanguageReceiver(),
  accessController = { restricted: false, authorize: async () => ({ decision: 'allow' }) },
  agentOrigin = null,
  scopeRoot = null,
  programRoot = null,
  preparedWorld = null
}) {
  const requestedThing = request.thing === undefined
    ? (scopeRoot ? '.' : agentOrigin?.path)
    : request.thing;
  const relativeSelector = parseSlotRelativeSelector(requestedThing) !== null;
  const effectiveScopeRoot = scopeRoot ?? (
    relativeSelector ? agentOrigin?.path ?? null : null
  );
  const resolved = resolveSlotRelativeSelector({
    atoms,
    selector: requestedThing,
    scopeRoot: effectiveScopeRoot,
    programRoot
  });
  const normalizedRequest = { ...request, thing: resolved.selector };
  const parsed = receiver.receive(programObjectSource('explore', normalizedRequest));
  if (!parsed.ok || parsed.batch || parsed.items.length !== 1) {
    const error = new Error(parsed.errors?.[0]?.message ?? 'Invalid Program explore request');
    error.code = parsed.errors?.[0]?.code ?? 'INVALID_PROGRAM_EXPLORE';
    throw error;
  }
  const result = await executeExploreItem(
    atoms,
    parsed.items[0],
    receiver.matcherRegistry,
    accessController,
    null,
    preparedWorld,
    { includeBoundary: false }
  );
  if (!result.ok) {
    const error = new Error(result.errors?.[0]?.message ?? 'Program explore failed');
    error.code = result.errors?.[0]?.code ?? 'PROGRAM_EXPLORE_FAILED';
    throw error;
  }
  return result.matches;
}
