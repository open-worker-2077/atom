import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { diagnostic } from './errors.mjs';
import { matchesExactSelector } from './exact-selector.mjs';
import { parseAtomKey } from './key-parser.mjs';
import { programLockDeniedDiagnostic } from './program-locks.mjs';
import { WORLD_OUTSIDE_NAME } from './world-root.mjs';

function fieldsByBase(atom) {
  const result = new Map();
  for (const [rawKey, value] of Object.entries(atom)) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (!result.has(parsed.baseKey)) result.set(parsed.baseKey, []);
    result.get(parsed.baseKey).push({ rawKey, parsed, value });
  }
  return result;
}

function storedField(atom, baseKey) {
  const fields = fieldsByBase(atom).get(baseKey) ?? [];
  return fields.length === 1 ? fields[0] : null;
}

function persistentValue(value) {
  if (Array.isArray(value)) return value.map(persistentValue);
  if (value?.kind !== 'graph-object' || !Array.isArray(value.fields)) {
    return structuredClone(value);
  }
  return atomFromFields(value.fields);
}

function atomFromFields(fields) {
  const atom = {};
  for (const field of fields) {
    if (!field.valuePresent || field.commands?.length) continue;
    atom[field.persistentKey] = persistentValue(field.value);
  }
  return atom;
}

function replaceStoredField(atom, baseKey, value, metadata = {}) {
  const previous = storedField(atom, baseKey);
  const types = metadata.types ?? previous?.parsed.types.map((type) => type.raw) ?? [];
  const descriptionPresent = metadata.descriptionPresent
    ?? previous?.parsed.descriptionPresent
    ?? false;
  const description = metadata.description
    ?? previous?.parsed.description
    ?? null;
  const rawKey = `${baseKey}${types.map((type) => `@${type}`).join('')}${
    descriptionPresent ? `#${description}` : ''
  }`;
  if (
    previous?.rawKey === rawKey
    && isDeepStrictEqual(previous.value, value)
  ) {
    return;
  }
  for (const key of Object.keys(atom)) {
    if (parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === baseKey) {
      delete atom[key];
    }
  }
  atom[rawKey] = structuredClone(value);
}

function walkAtoms(atoms) {
  const result = [];
  function visit(atom, parent, index, pathParts) {
    const name = storedField(atom, 'name')?.value;
    const match = {
      atom,
      parent,
      index,
      path: [...pathParts, name]
    };
    result.push(match);
    const children = storedField(atom, 'children')?.value;
    if (Array.isArray(children)) {
      children.forEach((child, childIndex) => (
        visit(child, match, childIndex, match.path)
      ));
    }
  }
  atoms.forEach((atom, index) => visit(atom, null, index, []));
  return result;
}

function partnerTarget(source, object, matches, rootName) {
  if (typeof object !== 'string' || !object) return null;
  const normalized = object.startsWith(`${rootName}/`)
    ? object.slice(rootName.length + 1)
    : object;
  const byPath = new Map(matches.map((match) => [
    match.path.join('/'),
    match
  ]));
  if (normalized.includes('/')) return byPath.get(normalized) ?? null;
  const siblingPath = [...source.path.slice(0, -1), normalized].join('/');
  const sibling = byPath.get(siblingPath);
  if (sibling) return sibling;
  const named = matches.filter((match) => (
    storedField(match.atom, 'name')?.value === normalized
  ));
  return named.length === 1 ? named[0] : null;
}

function capturePartnerBindings(atoms, rootName) {
  const matches = walkAtoms(atoms);
  const bindings = [];
  for (const source of matches) {
    const partners = storedField(source.atom, 'partners')?.value;
    if (!Array.isArray(partners)) continue;
    partners.forEach((partner, partnerIndex) => {
      const target = partnerTarget(source, partner?.object, matches, rootName);
      if (!target) return;
      bindings.push({
        sourceAtom: source.atom,
        targetAtom: target.atom,
        partner,
        partnerIndex,
        explicitPath: partner.object.includes('/')
      });
    });
  }
  return bindings;
}

function canonicalPartnerObject(source, target, matches, explicitPath) {
  if (explicitPath) return target.path.join('/');
  const targetName = storedField(target.atom, 'name').value;
  if (source.parent === target.parent) return targetName;
  const sameName = matches.filter((match) => (
    storedField(match.atom, 'name')?.value === targetName
  ));
  return sameName.length === 1 ? targetName : target.path.join('/');
}

function rewritePartnerBindings(atoms, bindings) {
  const matches = walkAtoms(atoms);
  const byAtom = new Map(matches.map((match) => [match.atom, match]));
  for (const binding of bindings) {
    const source = byAtom.get(binding.sourceAtom);
    const target = byAtom.get(binding.targetAtom);
    if (!source || !target) continue;
    const partners = storedField(source.atom, 'partners')?.value;
    if (!Array.isArray(partners)) continue;
    if (partners[binding.partnerIndex] !== binding.partner) continue;
    binding.partner.object = canonicalPartnerObject(
      source,
      target,
      matches,
      binding.explicitPath
    );
  }
}

function mapClonedSubtree(original, clone, mapping) {
  mapping.set(original, clone);
  const originalChildren = immediateChildren(original) ?? [];
  const clonedChildren = immediateChildren(clone) ?? [];
  originalChildren.forEach((child, index) => (
    mapClonedSubtree(child, clonedChildren[index], mapping)
  ));
}

function copiedBindings(bindings, mapping) {
  return bindings
    .filter((binding) => mapping.has(binding.sourceAtom))
    .map((binding) => {
      const sourceAtom = mapping.get(binding.sourceAtom);
      const partners = storedField(sourceAtom, 'partners')?.value;
      return {
        ...binding,
        sourceAtom,
        targetAtom: mapping.get(binding.targetAtom) ?? binding.targetAtom,
        partner: partners[binding.partnerIndex]
      };
    });
}

function resolveUnique(atoms, selector, exactIndex = null) {
  const matches = exactIndex?.get(selector) ?? walkAtoms(atoms).filter((match) => (
    matchesExactSelector(
      match.path,
      storedField(match.atom, 'name')?.value,
      selector
    )
  ));
  if (matches.length === 0) {
    return {
      error: diagnostic('ATOM_NOT_FOUND', `找不到 exact Atom：${selector}`, { selector })
    };
  }
  if (matches.length > 1) {
    return {
      error: diagnostic(
        'AMBIGUOUS_ATOM_NAME',
        `exact Atom“${selector}”不唯一`,
        { selector, paths: matches.map((match) => match.path.join('/')) }
      )
    };
  }
  return { match: matches[0] };
}

function captureSubtreeBindings(sourceAtom, sourcePath) {
  const sourceParts = sourcePath.split('/');
  const prefix = sourceParts.slice(0, -1);
  const matches = walkAtoms([sourceAtom]).map((match) => ({
    ...match,
    path: [...prefix, ...match.path]
  }));
  const bindings = [];
  for (const source of matches) {
    const partners = storedField(source.atom, 'partners')?.value;
    if (!Array.isArray(partners)) continue;
    partners.forEach((partner, partnerIndex) => {
      const target = partnerTarget(source, partner?.object, matches, null);
      if (!target) return;
      bindings.push({
        sourceAtom: source.atom,
        targetAtom: target.atom,
        partnerIndex,
        explicitPath: partner.object.includes('/')
      });
    });
  }
  return bindings;
}

function rewriteCopiedSubtreeBindings(clone, mapping, bindings, destinationPath) {
  const clonedMatches = walkAtoms([clone]);
  const byAtom = new Map(clonedMatches.map((match) => [match.atom, match]));
  for (const binding of bindings) {
    const source = byAtom.get(mapping.get(binding.sourceAtom));
    const target = byAtom.get(mapping.get(binding.targetAtom));
    if (!source || !target) continue;
    const partners = storedField(source.atom, 'partners')?.value;
    if (!Array.isArray(partners) || !partners[binding.partnerIndex]) continue;
    const sameParent = source.parent === target.parent;
    partners[binding.partnerIndex].object = !binding.explicitPath && sameParent
      ? storedField(target.atom, 'name')?.value
      : [destinationPath, ...target.path].join('/');
  }
}

export function insertAuthoritativeSubtreeCopy({
  atoms,
  sourceAtom,
  destinationChildren,
  newRootName = null,
  rootName = null,
  bindings = null,
  sourcePath = null,
  destinationPath = null,
  scope = 'world'
}) {
  const partnerBindings = scope === 'subtree'
    ? captureSubtreeBindings(sourceAtom, sourcePath)
    : (bindings ?? capturePartnerBindings(atoms, rootName));
  const clone = structuredClone(sourceAtom);
  if (newRootName !== null) replaceStoredField(clone, 'name', newRootName);
  const mapping = new Map();
  mapClonedSubtree(sourceAtom, clone, mapping);
  destinationChildren.push(clone);
  if (scope === 'subtree') {
    rewriteCopiedSubtreeBindings(clone, mapping, partnerBindings, destinationPath);
    return { clone, bindings: partnerBindings };
  }
  const allBindings = [
    ...partnerBindings,
    ...copiedBindings(partnerBindings, mapping)
  ];
  rewritePartnerBindings(atoms, allBindings);
  return { clone, bindings: allBindings };
}

export function createExactTransformIndex(atoms) {
  const index = new Map();
  const add = (selector, match) => {
    if (!index.has(selector)) index.set(selector, []);
    index.get(selector).push(match);
  };
  for (const match of walkAtoms(atoms)) {
    const parts = match.path;
    add(storedField(match.atom, 'name')?.value, match);
    for (let start = 0; start < parts.length - 1; start += 1) {
      add(parts.slice(start).join('/'), match);
    }
    add(`${WORLD_OUTSIDE_NAME}/${parts.join('/')}`, match);
  }
  return index;
}

export function transformChangesStructure(item) {
  return item.fields.some((field) => (
    (field.baseKey === 'children' && field.valuePresent)
    || (field.baseKey === 'name' && field.commands.some((command) => (
      ['ren', 'mov', 'cpy', 'dsc', 'rst'].includes(command.name)
    )))
  ));
}

export function isBatchRenameItem(item) {
  return item.fields.length === 1
    && item.fields[0].baseKey === 'name'
    && item.fields[0].valuePresent
    && typeof item.fields[0].value === 'string'
    && item.fields[0].value.length > 0
    && item.fields[0].commands.length === 1
    && item.fields[0].commands[0].name === 'ren';
}

function containerOf(atoms, match) {
  if (!match.parent) return atoms;
  return storedField(match.parent.atom, 'children').value;
}

function validateParameter(command, allowEmpty = false) {
  if (allowEmpty || command.parameter.length > 0) return null;
  return diagnostic(
    'TRANSFORM_COMMAND_PARAMETER_REQUIRED',
    `点号指令 .${command.name}. 需要键内参数`,
    { command: command.name }
  );
}

function applyDetail(target, field) {
  const current = storedField(target, 'detail');
  if (!current || typeof current.value !== 'string') {
    return diagnostic('INVALID_ATOM_DETAIL', '目标 Atom 的 detail 必须是字符串');
  }
  let detail = current.value;
  let descriptionPresent = current.parsed.descriptionPresent;
  let description = current.parsed.description;
  for (const command of field.commands) {
    if (command.name === 'rep') {
      if (field.valuePresent) {
        if (typeof field.value !== 'string' || field.value.length === 0) {
          return diagnostic(
            'INVALID_LOCAL_REPLACEMENT',
            '局部替换的 Value 必须是非空旧局部字符串'
          );
        }
        const index = detail.indexOf(field.value);
        if (index < 0) {
          return diagnostic(
            'DETAIL_FRAGMENT_NOT_FOUND',
            'detail 中找不到提交的旧局部内容',
            { oldFragment: field.value }
          );
        }
        detail = `${detail.slice(0, index)}${command.parameter}${
          detail.slice(index + field.value.length)
        }`;
      } else {
        detail = command.parameter;
      }
    }
    if (command.name === 'sum') {
      if (field.valuePresent) {
        return diagnostic('SUMMARY_VALUE_NOT_ALLOWED', '.sum. 只从键内读取新简介');
      }
      descriptionPresent = true;
      description = command.parameter;
    }
  }
  replaceStoredField(target, 'detail', detail, {
    types: current.parsed.types.map((type) => type.raw),
    descriptionPresent,
    description
  });
  return null;
}

function applyNameMetadata(target, field) {
  const current = storedField(target, 'name');
  let name = current.value;
  let types = current.parsed.types.map((type) => type.raw);
  for (const command of field.commands) {
    if (command.name === 'typ') {
      types = command.parameter ? [command.parameter] : [];
    }
    if (command.name === 'ren') {
      const invalid = validateParameter(command);
      if (invalid) return invalid;
      name = command.parameter;
    }
  }
  replaceStoredField(target, 'name', name, {
    types,
    descriptionPresent: current.parsed.descriptionPresent,
    description: current.parsed.description
  });
  return null;
}

export async function applyBatchRenames({
  atoms,
  items,
  contextFile,
  authorize = async () => ({ decision: 'allow' })
}) {
  const nextAtoms = structuredClone(atoms);
  const exactIndex = createExactTransformIndex(nextAtoms);
  const rootName = path.basename(contextFile);
  const partnerBindings = capturePartnerBindings(nextAtoms, rootName);
  const plans = [];
  const planByAtom = new Map();

  for (const item of items) {
    const nameField = item.fields[0];
    const rename = nameField.commands[0];
    const invalid = validateParameter(rename);
    if (invalid) return { error: invalid, itemIndex: item.index };
    const selected = resolveUnique(nextAtoms, nameField.value, exactIndex);
    if (selected.error) return { error: selected.error, itemIndex: item.index };
    if (planByAtom.has(selected.match.atom)) {
      return {
        error: diagnostic(
          'DUPLICATE_TRANSFORM_BATCH_TARGET',
          `批量 transform 重复改造同一 Atom：${nameField.value}`
        ),
        itemIndex: item.index
      };
    }
    const plan = {
      item,
      nameField,
      rename,
      match: selected.match,
      sourcePath: selected.match.path.join('/'),
      before: JSON.stringify(selected.match.atom)
    };
    plans.push(plan);
    planByAtom.set(selected.match.atom, plan);
  }

  const affectedContainers = new Set(plans.map((plan) => containerOf(nextAtoms, plan.match)));
  for (const container of affectedContainers) {
    const names = new Map();
    for (const atom of container) {
      const plan = planByAtom.get(atom);
      const name = plan?.rename.parameter ?? storedField(atom, 'name')?.value;
      if (names.has(name)) {
        const duplicatePlan = plan ?? planByAtom.get(names.get(name));
        return {
          error: diagnostic(
            'DUPLICATE_DESTINATION_CHILD',
            `批量改名后的同一 children 中会出现重名 Atom：${name}`
          ),
          itemIndex: duplicatePlan?.item.index ?? 0
        };
      }
      names.set(name, atom);
    }
  }

  const selectedAtoms = new Set();
  const ownerPlanByAtom = new Map();
  const authoritativeMatches = walkAtoms(nextAtoms);
  for (const plan of plans) {
    const decision = await authorize(plan.match, 'write', 'name');
    if (decision.decision !== 'allow') {
      if (decision.matched) {
        const denied = programLockDeniedDiagnostic(decision, 'name');
        return {
          error: diagnostic(denied.code, denied.message, denied.details),
          itemIndex: plan.item.index
        };
      }
      return {
        error: diagnostic(
          'WINDOW_ACCESS_DENIED',
          '当前窗口无权执行该批量改名；请反馈派发方',
          { field: 'name' }
        ),
        itemIndex: plan.item.index
      };
    }
    const subtreeAtoms = new Set(walkAtoms([plan.match.atom]).map((match) => match.atom));
    subtreeAtoms.forEach((atom) => {
      selectedAtoms.add(atom);
      if (!ownerPlanByAtom.has(atom)) ownerPlanByAtom.set(atom, plan);
    });
    for (const descendant of authoritativeMatches.filter((match) => (
      match.atom !== plan.match.atom && subtreeAtoms.has(match.atom)
    ))) {
      if ((await authorize(descendant, 'write', 'children')).decision !== 'allow') {
        return {
          error: diagnostic('WINDOW_ACCESS_DENIED', '当前窗口无权改造该批量改名子树；请反馈派发方'),
          itemIndex: plan.item.index
        };
      }
    }
  }

  const matchesByAtom = new Map(authoritativeMatches.map((match) => [match.atom, match]));
  for (const binding of partnerBindings) {
    if (!selectedAtoms.has(binding.targetAtom) || selectedAtoms.has(binding.sourceAtom)) continue;
    const source = matchesByAtom.get(binding.sourceAtom);
    if (source && (await authorize(source, 'write')).decision !== 'allow') {
      return {
        error: diagnostic('WINDOW_ACCESS_DENIED', '当前窗口无权改写指向批量改名子树的关系；请反馈派发方'),
        itemIndex: ownerPlanByAtom.get(binding.targetAtom)?.item.index ?? 0
      };
    }
  }

  for (const plan of plans) applyNameMetadata(plan.match.atom, plan.nameField);
  rewritePartnerBindings(nextAtoms, partnerBindings);
  const finalMatches = new Map(walkAtoms(nextAtoms).map((match) => [match.atom, match]));
  return {
    atoms: nextAtoms,
    results: plans.map((plan) => ({
      index: plan.item.index,
      sourcePath: plan.sourcePath,
      resultPath: finalMatches.get(plan.match.atom)?.path.join('/') ?? null,
      resultName: storedField(plan.match.atom, 'name').value,
      changed: JSON.stringify(plan.match.atom) !== plan.before
    }))
  };
}

function immediateChildren(atom) {
  const children = storedField(atom, 'children')?.value;
  return Array.isArray(children) ? children : null;
}

function childNameCollision(parent, name, excludedAtom = null) {
  return immediateChildren(parent)?.some((child) => (
    child !== excludedAtom && storedField(child, 'name')?.value === name
  )) ?? false;
}

function siblingNameCollision(atoms, match, name) {
  return containerOf(atoms, match).some((candidate) => (
    candidate !== match.atom && storedField(candidate, 'name')?.value === name
  ));
}

function applyPartners(target, field) {
  if (field.commands.length !== 1 || field.commands[0].name !== 'rep') {
    return diagnostic('INVALID_PARTNERS_TRANSFORM', 'partners 只接受单个 .rep. 完整替换');
  }
  if (field.commands[0].parameter !== '') {
    return diagnostic('INVALID_PARTNERS_TRANSFORM', 'partners.rep 不接受键内参数');
  }
  if (!field.valuePresent || !Array.isArray(field.value)) {
    return diagnostic('INVALID_ATOM_PARTNERS', 'partners.rep 必须提交完整关系矩阵 Value');
  }
  replaceStoredField(target, 'partners', field.value);
  return null;
}

function applyExplicitChildren(target, field, atoms) {
  if (!field.valuePresent || !Array.isArray(field.value)) {
    return diagnostic('INVALID_ATOM_CHILDREN', 'children 必须提交明确节点数组');
  }
  const children = immediateChildren(target);
  if (!children) return diagnostic('INVALID_ATOM_CHILDREN', '目标 children 不是数组');

  for (const submitted of field.value) {
    if (submitted?.kind !== 'graph-object') {
      return diagnostic('INVALID_ATOM_CHILD', 'children 项必须是明确 Atom 对象');
    }
    const nameField = submitted.fields.find((candidate) => candidate.baseKey === 'name');
    if (!nameField?.valuePresent || typeof nameField.value !== 'string' || !nameField.value) {
      return diagnostic('ATOM_NAME_REQUIRED', '明确 children 节点必须提交 name Value');
    }
    const matches = children.filter((child) => (
      storedField(child, 'name')?.value === nameField.value
    ));
    if (matches.length > 1) {
      return diagnostic('AMBIGUOUS_ATOM_NAME', `同一 children 中名称不唯一：${nameField.value}`);
    }
    if (matches.length === 0) {
      const created = atomFromFields(submitted.fields);
      const required = ['name', 'detail', 'children', 'partners'];
      const missing = required.filter((baseKey) => !storedField(created, baseKey));
      if (missing.length) {
        return diagnostic(
          'TRANSFORM_NEW_REQUIRES_FOUR_AXES',
          '明确新增 child 必须提交完整四轴 Atom',
          { missing }
        );
      }
      children.push(created);
      continue;
    }
    const error = applyFields(matches[0], submitted.fields, atoms, { nested: true });
    if (error) return error;
  }
  return null;
}

function applyFields(target, fields, atoms, options = {}) {
  for (const field of fields) {
    if (field.baseKey === 'name') {
      const structural = field.commands.filter((command) => (
        ['mov', 'cpy', 'dsc', 'rst'].includes(command.name)
      ));
      if (structural.length) {
        return diagnostic(
          'NESTED_STRUCTURAL_TRANSFORM_REJECTED',
          '结构动作只能位于顶层 transform 的 name 轴'
        );
      }
      if (field.commands.length) {
        const error = applyNameMetadata(target, field);
        if (error) return error;
      }
      continue;
    }
    if (field.baseKey === 'detail') {
      if (!field.commands.length) {
        if (field.valuePresent) {
          return diagnostic(
            'EXPLICIT_DETAIL_REPLACEMENT_REQUIRED',
            '全文 detail 替换必须显式使用 .rep.'
          );
        }
        continue;
      }
      const error = applyDetail(target, field);
      if (error) return error;
      continue;
    }
    if (field.baseKey === 'partners') {
      if (!field.commands.length) {
        if (field.valuePresent) {
          return diagnostic(
            'EXPLICIT_PARTNERS_REPLACEMENT_REQUIRED',
            '完整 partners 替换必须显式使用 .rep.'
          );
        }
        continue;
      }
      const error = applyPartners(target, field);
      if (error) return error;
      continue;
    }
    if (field.baseKey === 'children' && field.valuePresent) {
      const error = applyExplicitChildren(target, field, atoms);
      if (error) return error;
    }
  }
  return null;
}

function structuralCommand(item) {
  const commands = item.fields
    .filter((field) => field.baseKey === 'name')
    .flatMap((field) => field.commands.map((command) => ({ field, command })))
    .filter(({ command }) => ['mov', 'cpy', 'dsc', 'rst'].includes(command.name));
  if (commands.length > 1) {
    return {
      error: diagnostic(
        'MULTIPLE_STRUCTURAL_TRANSFORMS',
        '一次 transform 只能执行一个 move/copy/discard/restore'
      )
    };
  }
  return { operation: commands[0] ?? null };
}

function backupMatch(atoms) {
  const matches = walkAtoms(atoms).filter((match) => {
    const types = storedField(match.atom, 'name')?.parsed.types.map((type) => type.raw) ?? [];
    return types.includes('backup') && types.includes('default');
  });
  if (matches.length !== 1) {
    return {
      error: diagnostic(
        'DEFAULT_BACKUP_REQUIRED',
        'World 必须存在唯一 name@backup@default'
      )
    };
  }
  return { match: matches[0] };
}

export function transformLogFileFor(contextFile) {
  return path.join(path.dirname(contextFile), 'atom.transform-log.json');
}

async function readTransformLog(contextFile) {
  try {
    const value = JSON.parse(await fs.readFile(transformLogFileFor(contextFile), 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function appendTransformLog(contextFile, record) {
  const file = transformLogFileFor(contextFile);
  const entries = await readTransformLog(contextFile);
  entries.push(record);
  await fs.writeFile(file, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  return file;
}

function activeDiscard(entries, target) {
  const restored = new Set(
    entries
      .filter((entry) => entry.operation === 'restore')
      .map((entry) => entry.discardId)
  );
  return entries.findLast((entry) => (
    entry.operation === 'discard'
    && entry.target === target
    && !restored.has(entry.id)
  ));
}

export async function applyTransform({
  atoms,
  item,
  contextFile,
  authorize = async () => ({ decision: 'allow' }),
  mutateInput = false,
  exactIndex = null
}) {
  const nextAtoms = mutateInput ? atoms : structuredClone(atoms);
  const rootName = path.basename(contextFile);
  const nameField = item.fields.find((field) => field.baseKey === 'name');
  if (!nameField?.valuePresent || typeof nameField.value !== 'string' || !nameField.value) {
    return { error: diagnostic('ATOM_NAME_REQUIRED', 'transform 需要 name 精确锚点') };
  }
  const selected = resolveUnique(nextAtoms, nameField.value, exactIndex);
  if (selected.error) return selected;
  const selectedBefore = JSON.stringify(selected.match.atom);
  const selectedSnapshot = mutateInput ? structuredClone(selected.match.atom) : null;
  const rejectAfterMutation = (error) => {
    if (!selectedSnapshot || JSON.stringify(selected.match.atom) === selectedBefore) return { error };
    for (const key of Object.keys(selected.match.atom)) delete selected.match.atom[key];
    Object.assign(selected.match.atom, selectedSnapshot);
    return { error, rolledBack: true };
  };
  const structural = structuralCommand(item);
  if (structural.error) return structural;
  const nameCommands = item.fields
    .filter((field) => field.baseKey === 'name')
    .flatMap((field) => field.commands ?? []);
  const rewritesPaths = nameCommands.some((command) => (
    ['ren', 'mov', 'cpy', 'dsc', 'rst'].includes(command.name)
  ));
  const partnerBindings = rewritesPaths
    ? capturePartnerBindings(nextAtoms, rootName)
    : [];
  const sourcePath = selected.match.path.join('/');
  const changedFields = new Set();
  for (const field of item.fields) {
    if (field.baseKey === 'name' && field.commands?.length) changedFields.add('name');
    if (field.baseKey === 'detail' && (field.commands?.length || field.valuePresent)) changedFields.add('detail');
    if (field.baseKey === 'partners' && (field.commands?.length || field.valuePresent)) changedFields.add('partners');
    if (field.baseKey === 'children' && (field.commands?.length || field.valuePresent)) changedFields.add('children');
  }
  if (nameCommands.some((command) => ['mov', 'cpy', 'dsc', 'rst'].includes(command.name))) {
    changedFields.add('children');
  }
  for (const field of changedFields) {
    const decision = await authorize(selected.match, 'write', field);
    if (decision.decision !== 'allow') {
      if (decision.matched) {
        const denied = programLockDeniedDiagnostic(decision, field);
        return { error: diagnostic(denied.code, denied.message, denied.details) };
      }
      return { error: diagnostic('WINDOW_ACCESS_DENIED', '当前窗口无权执行该改造；请反馈派发方', { field }) };
    }
  }
  const selectedAtoms = new Set([selected.match.atom]);
  const changesSubtree = rewritesPaths || changedFields.has('children');
  if (changesSubtree && (immediateChildren(selected.match.atom)?.length ?? 0) > 0) {
    for (const match of walkAtoms([selected.match.atom])) selectedAtoms.add(match.atom);
    for (const descendant of walkAtoms(nextAtoms)) {
      if (descendant.atom !== selected.match.atom
        && selectedAtoms.has(descendant.atom)
        && (await authorize(descendant, 'write', 'children')).decision !== 'allow') {
        return { error: diagnostic('WINDOW_ACCESS_DENIED', '当前窗口无权改造该子树；请反馈派发方') };
      }
    }
  }
  // Renames and structural changes rewrite incoming relations. Their source
  // atoms are mutations too, so authorize them before any in-memory rewrite.
  for (const binding of partnerBindings) {
    if (selectedAtoms.has(binding.targetAtom) && !selectedAtoms.has(binding.sourceAtom)) {
      const source = walkAtoms(nextAtoms).find((match) => match.atom === binding.sourceAtom);
      if (source && (await authorize(source, 'write')).decision !== 'allow') {
        return { error: diagnostic('WINDOW_ACCESS_DENIED', '当前窗口无权改写指向该子树的关系；请反馈派发方') };
      }
    }
  }

  const operation = structural.operation;
  if (!operation) {
    const rename = nameCommands.find((command) => command.name === 'ren');
    if (
      rename
      && siblingNameCollision(nextAtoms, selected.match, rename.parameter)
    ) {
      return {
        error: diagnostic(
          'DUPLICATE_DESTINATION_CHILD',
          `改名后会与同一 children 中的 Atom 重名：${rename.parameter}`
        )
      };
    }
    const error = applyFields(selected.match.atom, item.fields, nextAtoms);
    if (!error) {
      if (changedFields.has('partners')) {
        const currentMatches = walkAtoms(nextAtoms);
        const byAtom = new Map(currentMatches.map((match) => [match.atom, match]));
        const outgoing = capturePartnerBindings(nextAtoms, rootName)
          .filter((binding) => binding.sourceAtom === selected.match.atom);
        for (const binding of outgoing) {
          const relationTarget = byAtom.get(binding.targetAtom);
          if (relationTarget && (await authorize(relationTarget, 'read')).decision !== 'allow') {
            return rejectAfterMutation(
              diagnostic(
                'WINDOW_ACCESS_DENIED',
                '当前窗口无权建立指向该关系目标的连接；请反馈派发方'
              )
            );
          }
        }
      }
      if (partnerBindings.length) rewritePartnerBindings(nextAtoms, partnerBindings);
    }
    const resultPath = rewritesPaths
      ? walkAtoms(nextAtoms).find((match) => match.atom === selected.match.atom)?.path.join('/') ?? null
      : sourcePath;
    return error
      ? rejectAfterMutation(error)
      : {
          atoms: nextAtoms,
          resultName: storedField(selected.match.atom, 'name').value,
          sourcePath,
          resultPath,
          changed: JSON.stringify(selected.match.atom) !== selectedBefore
        };
  }

  const { command } = operation;
  const target = selected.match;
  if (['mov', 'cpy'].includes(command.name)) {
    const invalid = validateParameter(command);
    if (invalid) return { error: invalid };
    const worldRootDestination = command.name === 'mov' && command.parameter === WORLD_OUTSIDE_NAME;
    const destination = worldRootDestination
      ? { match: { atom: null, path: [], parent: null, index: -1 } }
      : resolveUnique(nextAtoms, command.parameter, exactIndex);
    if (destination.error) return destination;
    if (!worldRootDestination && (await authorize(destination.match, 'write')).decision !== 'allow') {
      return { error: diagnostic('WINDOW_ACCESS_DENIED', '当前窗口无权改造目标位置；请反馈派发方') };
    }
    if (command.name === 'mov' && destination.match.path.join('/').startsWith(
      `${target.path.join('/')}/`
    )) {
      return { error: diagnostic('ATOM_MOVE_CYCLE', '不能把 Atom 移入自身后代') };
    }
    const destinationChildren = worldRootDestination
      ? nextAtoms
      : immediateChildren(destination.match.atom);
    if (!destinationChildren) {
      return { error: diagnostic('INVALID_ATOM_CHILDREN', '目标上级 children 不是数组') };
    }
    const targetName = storedField(target.atom, 'name').value;
    const excluded = command.name === 'mov'
      && target.parent?.atom === destination.match.atom
      ? target.atom
      : null;
    const collision = worldRootDestination
      ? destinationChildren.some((atom) => atom !== excluded && storedField(atom, 'name')?.value === targetName)
      : childNameCollision(destination.match.atom, targetName, excluded);
    if (collision) {
      return {
        error: diagnostic(
          'DUPLICATE_DESTINATION_CHILD',
          `目标上级已存在同名 child：${targetName}`,
          { destination: command.parameter, name: targetName }
        )
      };
    }
    if (command.name === 'cpy') {
      insertAuthoritativeSubtreeCopy({
        atoms: nextAtoms,
        sourceAtom: target.atom,
        destinationChildren,
        rootName,
        bindings: partnerBindings
      });
    } else {
      containerOf(nextAtoms, target).splice(target.index, 1);
      destinationChildren.push(target.atom);
      rewritePartnerBindings(nextAtoms, partnerBindings);
    }
    const resultMatch = walkAtoms(nextAtoms).find((match) => match.atom === target.atom);
    return {
      atoms: nextAtoms,
      resultName: nameField.value,
      sourcePath,
      resultPath: resultMatch?.path.join('/') ?? sourcePath,
      changed: true
    };
  }

  if (command.name === 'dsc') {
    if (command.parameter !== '') {
      return { error: diagnostic('INVALID_DISCARD_PARAMETER', '.dsc. 不接受参数') };
    }
    const backup = backupMatch(nextAtoms);
    if (backup.error) return backup;
    if ((await authorize(backup.match, 'write')).decision !== 'allow') {
      return { error: diagnostic('WINDOW_ACCESS_DENIED', '当前窗口无权访问备份位置；请反馈派发方') };
    }
    if (target.atom === backup.match.atom) {
      return { error: diagnostic('DEFAULT_BACKUP_DISCARD_REJECTED', '不能丢弃默认备份仓') };
    }
    const originalContainer = containerOf(nextAtoms, target);
    const targetName = storedField(target.atom, 'name').value;
    if (childNameCollision(backup.match.atom, targetName)) {
      return {
        error: diagnostic(
          'DUPLICATE_DESTINATION_CHILD',
          `默认备份仓已存在同名 child：${targetName}`
        )
      };
    }
    originalContainer.splice(target.index, 1);
    immediateChildren(backup.match.atom).push(target.atom);
    rewritePartnerBindings(nextAtoms, partnerBindings);
    return {
      atoms: nextAtoms,
      resultName: targetName,
      sourcePath,
      resultPath: walkAtoms(nextAtoms).find((match) => match.atom === target.atom)?.path.join('/') ?? null,
      changed: true,
      logRecord: {
        id: crypto.randomUUID(),
        operation: 'discard',
        target: targetName,
        originalParentPath: target.parent ? target.parent.path.join('/') : null,
        originalIndex: target.index
      }
    };
  }

  if (command.name === 'rst') {
    if (command.parameter !== '') {
      return { error: diagnostic('INVALID_RESTORE_PARAMETER', '.rst. 不接受参数') };
    }
    const backup = backupMatch(nextAtoms);
    if (backup.error) return backup;
    if ((await authorize(backup.match, 'write')).decision !== 'allow') {
      return { error: diagnostic('WINDOW_ACCESS_DENIED', '当前窗口无权访问备份位置；请反馈派发方') };
    }
    if (target.parent?.atom !== backup.match.atom) {
      return { error: diagnostic('RESTORE_TARGET_NOT_IN_BACKUP', '恢复目标不在默认备份仓') };
    }
    const entries = await readTransformLog(contextFile);
    const targetName = storedField(target.atom, 'name').value;
    const discard = activeDiscard(entries, targetName);
    if (!discard) {
      return { error: diagnostic('RESTORE_RECORD_NOT_FOUND', '找不到可逆丢弃记录') };
    }
    let destination;
    if (discard.originalParentPath === null) {
      destination = nextAtoms;
    } else {
      const parent = resolveUnique(nextAtoms, discard.originalParentPath, exactIndex);
      if (parent.error) return parent;
      if ((await authorize(parent.match, 'write')).decision !== 'allow') {
        return { error: diagnostic('WINDOW_ACCESS_DENIED', '当前窗口无权恢复到目标位置；请反馈派发方') };
      }
      destination = immediateChildren(parent.match.atom);
    }
    if (destination.some((child) => (
      child !== target.atom && storedField(child, 'name')?.value === targetName
    ))) {
      return {
        error: diagnostic(
          'DUPLICATE_DESTINATION_CHILD',
          `恢复位置已存在同名 child：${targetName}`
        )
      };
    }
    containerOf(nextAtoms, target).splice(target.index, 1);
    destination.splice(Math.min(discard.originalIndex, destination.length), 0, target.atom);
    rewritePartnerBindings(nextAtoms, partnerBindings);
    return {
      atoms: nextAtoms,
      resultName: targetName,
      sourcePath,
      resultPath: walkAtoms(nextAtoms).find((match) => match.atom === target.atom)?.path.join('/') ?? null,
      changed: true,
      logRecord: {
        id: crypto.randomUUID(),
        operation: 'restore',
        discardId: discard.id,
        target: targetName
      }
    };
  }

  return { error: diagnostic('UNSUPPORTED_TRANSFORM_OPERATION', '未知结构改造') };
}
