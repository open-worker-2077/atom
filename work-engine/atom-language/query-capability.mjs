import { diagnostic } from './errors.mjs';
import { matchesExactSelector } from './exact-selector.mjs';
import { parseAtomKey } from './key-parser.mjs';
import { createAtomLanguageReceiver } from './receiver.mjs';
import { selectCoordinateScope } from './world-laws/coordinates.mjs';
import { decodeLockAtoms, evaluateLockAccess } from './world-laws/locks.mjs';
import { createDefaultWorldLawRegistry } from './world-laws/registry.mjs';
import { authorizeProgramLock, programLockState } from './program-locks.mjs';
import { WORLD_OUTSIDE_NAME, worldOutsideAtom } from './world-root.mjs';

const preparedExploreSnapshots = new WeakMap();

export function fieldsByBase(atom) {
  const byBase = new Map();
  for (const [rawKey, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (parsed.errors.length) continue;
    const list = byBase.get(parsed.baseKey) ?? [];
    list.push({ rawKey, value, parsed });
    byBase.set(parsed.baseKey, list);
  }
  return byBase;
}

export function oneStoredField(atom, baseKey) {
  const matches = fieldsByBase(atom).get(baseKey) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function storedSupportFields(atom) {
  return fieldsByBase(atom).get('support') ?? [];
}

export function walkAtoms(atoms, options = {}) {
  const visited = [];
  function visit(atom, parentPath, index, parent = null) {
    if (!atom || typeof atom !== 'object' || Array.isArray(atom)) return;
    const nameField = oneStoredField(atom, 'thing');
    const name = typeof nameField?.value === 'string' ? nameField.value : `[${index}]`;
    const visiblePath = [...parentPath, name];
    const match = { atom, path: visiblePath, parent, index };
    visited.push(match);
    const children = oneStoredField(atom, 'contain')?.value;
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
  const matcher = matcherRegistry.resolve(mode);
  if (!matcher) {
    return { error: diagnostic('UNSUPPORTED_MATCHER', `不支持此匹配模式：${mode}`, { mode }) };
  }
  const available = candidates ?? walkAtoms(atoms);
  if (mode === 'exact' && exactIndex) {
    const candidateSet = new Set(available);
    return {
      matches: (exactIndex.get(nameField.value) ?? []).filter((match) => candidateSet.has(match)),
      expected: nameField.value
    };
  }
  const matches = available.filter(({ atom, path: atomPath }) => {
    if (mode === 'exact') {
      return matchesExactSelector(
        atomPath,
        oneStoredField(atom, 'thing')?.value,
        nameField.value
      );
    }
    return matcher.match(oneStoredField(atom, 'thing')?.value, nameField.value);
  });
  return { matches, expected: nameField.value };
}

export function createAccessController(atoms, options = {}) {
  const programLockIndex = options.programLockIndex?.byPath?.size ? options.programLockIndex : null;
  const legacyAccess = options.legacyAccess;
  if ((!legacyAccess || legacyAccess.global === true) && !programLockIndex) {
    return { restricted: false, authorize: async () => ({ decision: 'allow', matchedLocks: [] }) };
  }
  const registry = options.worldLawRegistry ?? createDefaultWorldLawRegistry();
  const locks = legacyAccess && legacyAccess.global !== true ? decodeLockAtoms(atoms) : [];
  const access = legacyAccess;
  const agentPath = options.agentPath ?? options.interaction?.agent?.path ?? null;
  const agentMatch = agentPath
    ? walkAtoms(atoms).find((match) => match.path.join('/') === agentPath)
    : null;
  const agentTypes = oneStoredField(agentMatch?.atom, 'thing')?.parsed.types
    .map((type) => type.raw) ?? [];
  return {
    restricted: true,
    async authorize(match, operation, field, actor = {}) {
      const targetPath = Array.isArray(match.path) ? match.path.join('/') : match.path;
      if (programLockIndex) {
        const decision = authorizeProgramLock({
          lockIndex: programLockIndex, targetPath, operation, field,
          agentPath,
          agentTypes,
          programPath: actor.programPath ?? null,
          targetTypes: oneStoredField(match.atom, 'thing')?.parsed.types
            .map((type) => type.raw) ?? [],
          action: operation === 'read' ? 'explore' : 'transform'
        });
        if (decision.decision !== 'allow') return decision;
      }
      if (!access || access.global === true) return { decision: 'allow', matchedLocks: [] };
      return evaluateLockAccess({
        locks,
        registry,
        operation,
        window: access.window,
        keys: access.keys ?? [],
        target: { name: oneStoredField(match.atom, 'thing')?.value ?? match.name ?? null, path: targetPath }
      });
    }
  };
}

export function describeAtom(match, includeFullDetail, options = {}) {
  const nameField = oneStoredField(match.atom, 'thing');
  const detailField = oneStoredField(match.atom, 'situation');
  const result = {
    path: match.path.join('/'),
    selector: options.selector ?? match.path.join('/'),
    thing: nameField?.value ?? null,
    types: nameField?.parsed.types.map((type) => type.raw) ?? [],
    description: detailField?.parsed.descriptionPresent ? detailField.parsed.description : null
  };
  if (includeFullDetail) result.situation = detailField?.value ?? null;
  for (const field of options.supportFields ?? []) {
    result[field.rawKey] = structuredClone(field.value);
  }
  if (options.lockState) result.lockState = structuredClone(options.lockState);
  return result;
}

export function prepareExploreWorld(atoms) {
  if (Object.isFrozen(atoms) && preparedExploreSnapshots.has(atoms)) {
    return preparedExploreSnapshots.get(atoms);
  }
  const allMatches = walkAtoms(atoms, { virtualRoot: true });
  const exactIndex = new Map();
  const add = (selector, match) => {
    if (!indexableSelector(selector)) return;
    if (!exactIndex.has(selector)) exactIndex.set(selector, []);
    exactIndex.get(selector).push(match);
  };
  for (const match of allMatches) {
    const name = oneStoredField(match.atom, 'thing')?.value;
    add(name, match);
    for (let length = 2; length <= match.path.length; length += 1) {
      add(match.path.slice(-length).join('/'), match);
    }
    if (!match.virtual) add(`${WORLD_OUTSIDE_NAME}/${match.path.join('/')}`, match);
  }
  const prepared = { allMatches, exactIndex };
  if (Object.isFrozen(atoms)) preparedExploreSnapshots.set(atoms, prepared);
  return prepared;
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
  const named = matches.filter((match) => oneStoredField(match.atom, 'thing')?.value === target);
  for (let depth = source.path.length - 2; depth >= 0; depth -= 1) {
    const domain = source.path.slice(0, depth + 1);
    const scoped = named.filter((match) => domain.every((part, index) => match.path[index] === part));
    if (scoped.length === 1) return scoped[0];
    if (scoped.length > 1) return null;
  }
  return named.length === 1 ? named[0] : null;
}

function supportRuleEndpoints(owner, matches) {
  const selectorsInExpr = (expr) => {
    if (!expr || typeof expr !== 'object' || Array.isArray(expr)) return [];
    if (typeof expr.thing === 'string') return [expr.thing];
    if (typeof expr['thing@program'] === 'string') return [expr['thing@program']];
    return ['and', 'or'].flatMap((operator) => (
      Array.isArray(expr[operator]) ? expr[operator].flatMap(selectorsInExpr) : []
    ));
  };
  return storedSupportFields(owner.atom).flatMap((field) => (
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

function supportScope(anchor, matches) {
  const selected = new Set([anchor]);
  for (const owner of matches) {
    for (const rule of supportRuleEndpoints(owner, matches)) {
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
    const nameField = oneStoredField(candidate.atom, 'thing');
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
    const detail = oneStoredField(candidate.atom, 'situation')?.value;
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
    if (field.baseKey === 'situation') return !isProjection(field) || field.actions.some((action) => action.name !== 'full');
    if (field.baseKey === 'contain') {
      return !isProjection(field) || field.actions.some((action) => !['latitude', 'longitude'].includes(action.name));
    }
    if (field.baseKey === 'support') return !isProjection(field) || field.actions.length > 0;
    return field.valuePresent || field.actions.length > 0;
  });
  if (unsupported.length) {
    return {
      ok: false,
      index: item.index,
      errors: [diagnostic('UNSUPPORTED_EXPLORE_EXECUTION', '当前 explore 只执行 exact thing、situation$full、contain$latitude/longitude 与 support 投影', {
        fields: unsupported.map((field) => field.rawKey)
      })]
    };
  }
  const prepared = preparedWorld ?? prepareExploreWorld(atoms);
  const allMatches = prepared.allMatches;
  const visibleMatches = accessController.restricted ? [] : allMatches;
  const requestedReadFields = new Set(['thing']);
  if (item.fields.some((field) => field.baseKey === 'situation' && field.actions.some((action) => action.name === 'full'))) requestedReadFields.add('situation');
  if (item.fields.some((field) => field.baseKey === 'contain')) requestedReadFields.add('contain');
  if (item.fields.some((field) => field.baseKey === 'support')) requestedReadFields.add('support');
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
      for (const match of unfiltered.matches) {
        for (const field of requestedReadFields) {
          const decision = await accessController.authorize(match, 'read', field);
          for (const source of decision.matched ?? []) {
            if (!programSources.some((candidate) => candidate.sourceProgramPath === source.sourceProgramPath)) {
              programSources.push(source);
            }
          }
        }
      }
      const source = programSources[0];
      const reason = source?.reason?.message?.trim();
      const contextExplanation = source?.allowedWindows
        || source?.allowedWindowTypes
        || source?.allowedWindowRelation
        ? '当前 @agent 上下文未满足放行条件。'
        : '此限制不依赖 @agent 上下文。';
      const explanation = source?.sourceProgramPath
        ? `目标存在，但读取受到 Program“${source.sourceProgramPath}”限制。${reason ? `原因：${reason}。` : ''}${contextExplanation}`
        : '目标存在，但读取受到世界规则限制；此限制不依赖 @agent 上下文。';
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
        paths: selected.matches.map((match) => match.path.join('/'))
      })]
    };
  }
  const includeFullDetail = item.fields.some((field) => field.baseKey === 'situation'
    && field.actions.some((action) => action.name === 'full'));
  const includeSupport = item.fields.some((field) => field.baseKey === 'support');
  const anchor = visibleMatches.find((match) => match.atom === selected.matches[0].atom);
  const routes = item.fields.filter((field) => field.baseKey === 'contain').flatMap((field) => (
    field.actions.map((action) => ({ axis: action.name, parameter: action.parameter }))
  ));
  const scoped = selectCoordinateScope(anchor, visibleMatches, routes);
  if (includeSupport) {
    for (const match of supportScope(anchor, visibleMatches)) scoped.add(match);
  }
  const ordered = visibleMatches.filter((match) => scoped.has(match));
  const boundary = options.includeBoundary === false
    ? null
    : await exploreBoundary(anchor, allMatches, scoped, accessController);
  return {
    ok: true,
    index: item.index,
    matches: ordered.map((match) => describeAtom(match, includeFullDetail, {
      selector: shortestUniqueSelector(match, visibleMatches),
      ...(includeSupport
        ? { supportFields: storedSupportFields(match.atom) }
        : {}),
      lockState: programLockState(lockIndex, match.path.join('/'))
    })),
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
  preparedWorld = null
}) {
  const normalizedRequest = request.thing === undefined && agentOrigin?.path
    ? { ...request, thing: agentOrigin.path }
    : request;
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
