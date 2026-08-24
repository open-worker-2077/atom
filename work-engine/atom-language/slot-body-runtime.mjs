import { isDeepStrictEqual } from 'node:util';

import { parseAtomKey } from './key-parser.mjs';
import { insertAuthoritativeSubtreeCopy } from './transform-executor.mjs';

const MODEL_NAME = '槽模';
const EXAMPLES_NAME = '槽例';
const BLANK_NAME = '空槽例';
const MAPPING_VERB = '槽模映照';

function slotError(code, message, details = {}) {
  return { code, message, details };
}

function fieldsByBase(atom) {
  const result = new Map();
  for (const [rawKey, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (!result.has(parsed.baseKey)) result.set(parsed.baseKey, []);
    result.get(parsed.baseKey).push({ rawKey, parsed, value });
  }
  return result;
}

function storedField(atom, baseKey) {
  const values = fieldsByBase(atom).get(baseKey) ?? [];
  return values.length === 1 ? values[0] : null;
}

function fieldValue(atom, baseKey) {
  return storedField(atom, baseKey)?.value;
}

function atomName(atom) {
  return fieldValue(atom, 'name');
}

function atomTypes(atom) {
  return storedField(atom, 'name')?.parsed.types.map((type) => type.raw) ?? [];
}

function childrenOf(atom) {
  const value = fieldValue(atom, 'children');
  return Array.isArray(value) ? value : null;
}

function partnersOf(atom) {
  const value = fieldValue(atom, 'partners');
  return Array.isArray(value) ? value : null;
}

function replaceStoredField(atom, baseKey, value, metadata = {}) {
  const previous = storedField(atom, baseKey);
  const types = metadata.types ?? previous?.parsed.types.map((type) => type.raw) ?? [];
  const descriptionPresent = metadata.descriptionPresent
    ?? previous?.parsed.descriptionPresent
    ?? false;
  const description = metadata.description ?? previous?.parsed.description ?? null;
  const rawKey = `${baseKey}${types.map((type) => `@${type}`).join('')}${
    descriptionPresent ? `#${description}` : ''
  }`;
  for (const key of Object.keys(atom)) {
    if (parseAtomKey(key, { descriptionSymbolWarnings: false }).baseKey === baseKey) delete atom[key];
  }
  atom[rawKey] = structuredClone(value);
}

function copyFieldMetadata(target, source, baseKey, preserveValue = false) {
  const sourceField = storedField(source, baseKey);
  const targetField = storedField(target, baseKey);
  if (!sourceField || !targetField) return;
  replaceStoredField(target, baseKey, preserveValue ? targetField.value : sourceField.value, {
    types: sourceField.parsed.types.map((type) => type.raw),
    descriptionPresent: sourceField.parsed.descriptionPresent,
    description: sourceField.parsed.description
  });
}

function walkAtoms(atoms) {
  const result = [];
  function visit(atom, parent, index, pathParts) {
    const name = atomName(atom);
    const match = { atom, parent, index, path: [...pathParts, name] };
    result.push(match);
    for (const [childIndex, child] of (childrenOf(atom) ?? []).entries()) {
      visit(child, match, childIndex, match.path);
    }
  }
  atoms.forEach((atom, index) => visit(atom, null, index, []));
  return result;
}

function resolveUnique(atoms, selector) {
  const parts = selector.split('/').filter(Boolean);
  let candidates = atoms.map((atom, index) => ({ atom, parent: null, index, path: [atomName(atom)] }))
    .filter((match) => match.path[0] === parts[0]);
  for (const part of parts.slice(1)) {
    candidates = candidates.flatMap((parent) => (childrenOf(parent.atom) ?? [])
      .map((atom, index) => ({ atom, parent, index, path: [...parent.path, atomName(atom)] }))
      .filter((match) => atomName(match.atom) === part));
  }
  if (candidates.length === 0) return { error: slotError('ATOM_NOT_FOUND', `找不到 exact Atom：${selector}`, { selector }) };
  if (candidates.length > 1) {
    return {
      error: slotError('AMBIGUOUS_ATOM_NAME', `exact Atom“${selector}”不唯一`, {
        selector,
        paths: candidates.map((match) => match.path.join('/'))
      })
    };
  }
  return { match: candidates[0] };
}

function cloneWorldAtSelector(atoms, selector) {
  const selected = resolveUnique(atoms, selector);
  if (selected.error) return selected;
  const chain = [];
  for (let current = selected.match; current; current = current.parent) chain.push(current);
  chain.reverse();
  const candidate = atoms.slice();
  let destination = candidate;
  for (const [depth, match] of chain.entries()) {
    const clone = depth === chain.length - 1
      ? structuredClone(match.atom)
      : { ...match.atom };
    destination[match.index] = clone;
    if (depth < chain.length - 1) {
      const childrenField = storedField(clone, 'children');
      replaceStoredField(clone, 'children', childrenField.value.slice());
      destination = childrenOf(clone);
    }
  }
  return { atoms: candidate };
}

function childMatches(parent, name) {
  return (childrenOf(parent) ?? []).filter((child) => atomName(child) === name);
}

function directChild(parent, name) {
  const matches = childMatches(parent, name);
  return matches.length === 1 ? matches[0] : null;
}

function layoutOf(atoms, bodySelector) {
  const selected = resolveUnique(atoms, bodySelector);
  if (selected.error) return selected;
  const body = selected.match.atom;
  const bodyChildren = childrenOf(body);
  const modelMatches = childMatches(body, MODEL_NAME);
  const examplesMatches = childMatches(body, EXAMPLES_NAME);
  const model = modelMatches[0];
  const examples = examplesMatches[0];
  const blankMatches = examples ? childMatches(examples, BLANK_NAME) : [];
  if (!bodyChildren
    || bodyChildren.length !== 2
    || modelMatches.length !== 1
    || examplesMatches.length !== 1
    || blankMatches.length !== 1) {
    return {
      error: slotError(
        'INVALID_SLOT_BODY_LAYOUT',
        '槽体必须采用“槽体 → 槽模／槽例 → 空槽例”的唯一显式结构',
        { body: selected.match.path.join('/') }
      )
    };
  }
  return {
    body,
    bodyPath: selected.match.path.join('/'),
    model,
    modelPath: `${selected.match.path.join('/')}/${MODEL_NAME}`,
    examples,
    examplesPath: `${selected.match.path.join('/')}/${EXAMPLES_NAME}`,
    blank: blankMatches[0],
    blankPath: `${selected.match.path.join('/')}/${EXAMPLES_NAME}/${BLANK_NAME}`
  };
}

function isProgram(atom) {
  return atomTypes(atom).includes('program');
}

function modelRecords(layout, { includePrograms = false } = {}) {
  return walkAtoms([layout.model])
    .filter((match) => includePrograms || !isProgram(match.atom))
    .map((match) => ({
      ...match,
      relative: match.path.slice(1),
      path: [layout.bodyPath, MODEL_NAME, ...match.path.slice(1)].join('/')
    }));
}

function exampleRecords(layout, example) {
  const exampleName = atomName(example);
  return walkAtoms([example]).map((match) => ({
    ...match,
    relative: match.path.slice(1),
    path: [layout.bodyPath, EXAMPLES_NAME, exampleName, ...match.path.slice(1)].join('/')
  }));
}

function mappingTarget(atom) {
  return partnersOf(atom)?.find((partner) => partner?.verb === MAPPING_VERB)?.object ?? null;
}

function setMapping(atom, modelPath) {
  const partners = (partnersOf(atom) ?? []).filter((partner) => partner?.verb !== MAPPING_VERB);
  partners.push({ verb: MAPPING_VERB, object: modelPath });
  replaceStoredField(atom, 'partners', partners);
}

function byRelative(records) {
  return new Map(records.map((record) => [record.relative.join('/'), record]));
}

function sealExample(layout, example, models) {
  const examples = byRelative(exampleRecords(layout, example));
  const missing = [];
  for (const model of models) {
    const current = examples.get(model.relative.join('/'));
    if (!current) {
      missing.push(model.path);
      continue;
    }
    setMapping(current.atom, model.path);
  }
  if (missing.length) {
    return slotError('INVALID_SLOT_BODY_LAYOUT', '槽例缺少与槽模对应的显式槽', {
      example: `${layout.examplesPath}/${atomName(example)}`,
      missing
    });
  }
  return null;
}

function subtreeHasMaterial(atom) {
  if ((fieldValue(atom, 'detail') ?? '') !== '') return true;
  return (childrenOf(atom) ?? []).some(subtreeHasMaterial);
}

function removeAtom(match) {
  if (!match.parent) return false;
  childrenOf(match.parent.atom).splice(match.index, 1);
  return true;
}

function createMappedSlot(model, modelPath) {
  const nameField = storedField(model, 'name');
  const detailField = storedField(model, 'detail');
  const created = {};
  replaceStoredField(created, 'name', nameField.value, {
    types: nameField.parsed.types.map((type) => type.raw),
    descriptionPresent: nameField.parsed.descriptionPresent,
    description: nameField.parsed.description
  });
  replaceStoredField(created, 'detail', '', {
    types: detailField?.parsed.types.map((type) => type.raw) ?? [],
    descriptionPresent: detailField?.parsed.descriptionPresent ?? false,
    description: detailField?.parsed.description ?? null
  });
  replaceStoredField(created, 'children', []);
  replaceStoredField(created, 'partners', [{ verb: MAPPING_VERB, object: modelPath }]);
  return created;
}

function modelTargetPath(modelRecord, relation, models) {
  if (typeof relation?.object !== 'string') return null;
  const byPath = new Map(models.map((record) => [record.path, record]));
  if (relation.object.includes('/')) return byPath.get(relation.object)?.path ?? relation.object;
  const sibling = [...modelRecord.path.split('/').slice(0, -1), relation.object].join('/');
  if (byPath.has(sibling)) return sibling;
  const named = models.filter((record) => atomName(record.atom) === relation.object);
  return named.length === 1 ? named[0].path : relation.object;
}

function translatedPartners(modelRecord, exampleByModel, models, allModelRecords, existing) {
  const modelPartners = (partnersOf(modelRecord.atom) ?? []).filter((partner) => partner.verb !== MAPPING_VERB);
  const mappedExamples = [...exampleByModel.values()];
  const modelRootPath = allModelRecords[0]?.path;
  const targetsMappedStructure = (partner) => {
    const target = partner?.object;
    if (typeof target !== 'string') return false;
    if (modelRootPath && (target === modelRootPath || target.startsWith(`${modelRootPath}/`))) return true;
    const namedModelTargets = allModelRecords.filter((record) => atomName(record.atom) === target);
    if (namedModelTargets.length === 1) return true;
    if (mappedExamples.some((record) => record.path === target)) return true;
    const named = mappedExamples.filter((record) => atomName(record.atom) === target);
    return named.length === 1;
  };
  const result = existing.filter((partner) => (
    partner.verb !== MAPPING_VERB && !targetsMappedStructure(partner)
  ));
  result.push({ verb: MAPPING_VERB, object: modelRecord.path });
  for (const relation of modelPartners) {
    const targetPath = modelTargetPath(modelRecord, relation, allModelRecords);
    const mappedTarget = exampleByModel.get(targetPath);
    result.push({
      verb: relation.verb,
      object: mappedTarget?.path ?? targetPath
    });
  }
  return result;
}

async function authorizePaths(layout, action, authorize) {
  const paths = action === 'print'
    ? [
        layout.examplesPath,
        ...exampleRecords(layout, layout.blank).map((record) => record.path)
      ]
    : [
        layout.bodyPath,
        ...modelRecords(layout).map((record) => record.path),
        ...childrenOf(layout.examples).flatMap((example) => (
          exampleRecords(layout, example).map((record) => record.path)
        ))
      ];
  for (const path of new Set(paths)) {
    const decision = await authorize({ path, action });
    if (decision?.decision && decision.decision !== 'allow') {
      return slotError('PROGRAM_LOCK_DENIED', '当前窗口不允许执行槽体动作', { path, action });
    }
  }
  return null;
}

async function seal(atoms, effect, authorize) {
  const layout = layoutOf(atoms, effect.body);
  if (layout.error) return layout;
  const denied = await authorizePaths(layout, 'transform', authorize);
  if (denied) return { error: denied };
  const models = modelRecords(layout);
  const examples = childrenOf(layout.examples);
  for (const example of examples) {
    const error = sealExample(layout, example, models);
    if (error) return { error };
  }
  return {
    atoms,
    receipt: {
      action: 'seal',
      body: layout.bodyPath,
      model: layout.modelPath,
      blank: layout.blankPath,
      examples: examples.map((example) => `${layout.examplesPath}/${atomName(example)}`)
    }
  };
}

async function printExample(atoms, effect, authorize) {
  const layout = layoutOf(atoms, effect.body);
  if (layout.error) return layout;
  const denied = await authorizePaths(layout, 'print', authorize);
  if (denied) return { error: denied };
  if (typeof effect.name !== 'string' || !effect.name.trim() || effect.name.includes('/')) {
    return { error: slotError('INVALID_SLOT_BODY_EXAMPLE_NAME', '槽例名称必须是非空单段字符串') };
  }
  const name = effect.name.trim();
  if (name === BLANK_NAME || childMatches(layout.examples, name).length) {
    return {
      error: slotError('SLOT_BODY_EXAMPLE_EXISTS', `槽例中已存在名称：${name}`, {
        target: `${layout.examplesPath}/${name}`
      })
    };
  }
  const models = modelRecords(layout);
  const blankMappings = new Set(exampleRecords(layout, layout.blank).map((record) => mappingTarget(record.atom)));
  const missing = models.filter((model) => !blankMappings.has(model.path)).map((model) => model.path);
  if (missing.length) {
    return { error: slotError('SLOT_BODY_NOT_SEALED', '空槽例尚未完成槽模映照', { missing }) };
  }
  insertAuthoritativeSubtreeCopy({
    atoms,
    sourceAtom: layout.blank,
    destinationChildren: childrenOf(layout.examples),
    newRootName: name,
    sourcePath: layout.blankPath,
    destinationPath: layout.examplesPath,
    scope: 'subtree'
  });
  return {
    atoms,
    receipt: {
      action: 'print',
      body: layout.bodyPath,
      source: layout.blankPath,
      target: `${layout.examplesPath}/${name}`
    }
  };
}

async function sync(atoms, effect, authorize) {
  let layout = layoutOf(atoms, effect.body);
  if (layout.error) return layout;
  const denied = await authorizePaths(layout, 'transform', authorize);
  if (denied) return { error: denied };
  const models = modelRecords(layout);
  const allModelRecords = modelRecords(layout, { includePrograms: true });
  const modelByPath = new Map(models.map((model) => [model.path, model]));

  for (const example of childrenOf(layout.examples)) {
    const records = exampleRecords(layout, example);
    const stale = records.filter((record) => {
      const target = mappingTarget(record.atom);
      return target && !modelByPath.has(target);
    });
    const staleSet = new Set(stale.map((record) => record.atom));
    const roots = stale.filter((record) => !record.parent || !staleSet.has(record.parent.atom));
    const conflicts = roots.filter((record) => subtreeHasMaterial(record.atom));
    if (conflicts.length) {
      return {
        error: slotError('SLOT_BODY_SYNC_CONFLICT', `有料槽不能被静默移除：${conflicts[0].path}`, {
          paths: conflicts.map((record) => record.path)
        })
      };
    }
    roots.sort((left, right) => right.path.split('/').length - left.path.split('/').length)
      .forEach(removeAtom);

    const byModel = new Map(exampleRecords(layout, example)
      .filter((record) => mappingTarget(record.atom))
      .map((record) => [mappingTarget(record.atom), record]));
    const rootRecord = byModel.get(layout.modelPath);
    if (!rootRecord || rootRecord.atom !== example) {
      return {
        error: slotError('SLOT_BODY_NOT_SEALED', '槽例根节点缺少有效槽模映照', {
          example: `${layout.examplesPath}/${atomName(example)}`
        })
      };
    }

    for (const model of models.slice(1)) {
      const parentModelPath = model.path.split('/').slice(0, -1).join('/');
      const parentExample = byModel.get(parentModelPath);
      if (!parentExample) {
        return { error: slotError('SLOT_BODY_SYNC_CONFLICT', '找不到映照父槽', { model: model.path }) };
      }
      let current = byModel.get(model.path);
      if (!current) {
        const created = createMappedSlot(model.atom, model.path);
        childrenOf(parentExample.atom).push(created);
        current = {
          atom: created,
          parent: parentExample,
          path: `${parentExample.path}/${atomName(created)}`
        };
        byModel.set(model.path, current);
      } else {
        const desiredParent = parentExample.atom;
        if (current.parent?.atom !== desiredParent) {
          removeAtom(current);
          if (childMatches(desiredParent, atomName(model.atom)).some((child) => child !== current.atom)) {
            return { error: slotError('SLOT_BODY_SYNC_CONFLICT', '移动槽会产生同名冲突', { model: model.path }) };
          }
          childrenOf(desiredParent).push(current.atom);
        }
        copyFieldMetadata(current.atom, model.atom, 'name');
        copyFieldMetadata(current.atom, model.atom, 'detail', true);
      }
    }

    layout = layoutOf(atoms, effect.body);
    const refreshedRecords = exampleRecords(layout, directChild(layout.examples, atomName(example)) ?? example);
    const refreshedByModel = new Map(refreshedRecords
      .filter((record) => mappingTarget(record.atom))
      .map((record) => [mappingTarget(record.atom), record]));
    for (const model of models) {
      const current = refreshedByModel.get(model.path);
      if (!current) continue;
      replaceStoredField(
        current.atom,
        'partners',
        translatedPartners(
          model,
          refreshedByModel,
          models,
          allModelRecords,
          partnersOf(current.atom) ?? []
        )
      );
    }
  }

  return {
    atoms,
    receipt: {
      action: 'sync',
      body: layout.bodyPath,
      examples: childrenOf(layout.examples).map((example) => `${layout.examplesPath}/${atomName(example)}`)
    }
  };
}

export async function applySlotBodyEffect({
  atoms,
  effect,
  authorize = async () => ({ decision: 'allow' }),
  mutateInput = false
}) {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)
    || !['seal', 'print', 'sync'].includes(effect.action)
    || typeof effect.body !== 'string' || !effect.body.trim()) {
    return { error: slotError('INVALID_SLOT_BODY_EFFECT', 'slot_body() 需要 action、body 与对应动作参数') };
  }
  const localized = mutateInput ? { atoms } : cloneWorldAtSelector(atoms, effect.body);
  if (localized.error) return localized;
  const candidate = localized.atoms;
  const before = mutateInput ? structuredClone(atoms) : null;
  let result;
  if (effect.action === 'seal') result = await seal(candidate, effect, authorize);
  if (effect.action === 'print') result = await printExample(candidate, effect, authorize);
  if (effect.action === 'sync') result = await sync(candidate, effect, authorize);
  if (result?.error && mutateInput && !isDeepStrictEqual(candidate, before)) {
    atoms.splice(0, atoms.length, ...before);
  }
  return result;
}

export const SLOT_BODY_CONTRACT = Object.freeze({
  function: 'slot_body',
  actions: ['seal', 'print', 'sync'],
  layout: { model: MODEL_NAME, examples: EXAMPLES_NAME, blank: BLANK_NAME },
  mappingVerb: MAPPING_VERB
});
