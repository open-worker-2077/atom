import crypto from 'node:crypto';

import {
  SLOT_REVISION_VERB,
  SLOT_ROLE_VERB,
  atomDescription,
  atomName,
  atomTypes,
  childrenOf,
  createAtom,
  directChild,
  directedSupports,
  fieldValue,
  partnersOf,
  relationTarget,
  replaceStoredField,
  resolveUnique,
  setRelation,
  storedField,
  walkAtoms
} from './slot-graph-semantics.mjs';

const MODEL_NAME = '槽模';
const PRINT_NAME = 'print';
const EXAMPLES_NAME = '槽例';
const ROLES_NAME = '角色';
const REVISIONS_NAME = '修订';
const instancePrefixIndexes = new WeakMap();

function slotError(code, message, details = {}) {
  return { code, message, details };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function layoutOf(atoms, bodySelector) {
  const selected = resolveUnique(atoms, bodySelector);
  if (selected.error) return selected;
  const body = selected.match.atom;
  const bodyPath = selected.match.path.join('/');
  const children = childrenOf(body);
  if (!children) {
    return { error: slotError('INVALID_SLOT_BODY_LAYOUT', '槽体必须具有完整 children Graph', { body: bodyPath }) };
  }
  const model = directChild(body, MODEL_NAME);
  const print = directChild(body, PRINT_NAME);
  const examples = directChild(body, EXAMPLES_NAME);
  if (children.length === 3 && model && print && examples && atomTypes(print).includes('program')) {
    return {
      sealed: true,
      body,
      bodyPath,
      model,
      modelPath: `${bodyPath}/${MODEL_NAME}`,
      print,
      printPath: `${bodyPath}/${PRINT_NAME}`,
      examples,
      examplesPath: `${bodyPath}/${EXAMPLES_NAME}`
    };
  }
  const retiredBlank = examples && directChild(examples, '空槽例');
  if (retiredBlank || children.length !== 1 || atomTypes(children[0]).includes('program')) {
    return {
      error: slotError(
        'INVALID_SLOT_BODY_LAYOUT',
        '首次封装要求槽体只包含一棵普通候选 DataFlow；旧空槽例布局不再受理',
        { body: bodyPath }
      )
    };
  }
  return { sealed: false, body, bodyPath, candidate: children[0] };
}

function modelRecords(layout) {
  const matches = walkAtoms([layout.model]);
  return matches.map((match) => {
    const relativeParts = match.path.slice(1);
    const relative = relativeParts.length ? `./${relativeParts.join('/')}` : '.';
    return {
      ...match,
      relative,
      absolute: [layout.modelPath, ...relativeParts].join('/')
    };
  });
}

function roleIdFor(layout, record) {
  const existing = relationTarget(record.atom, SLOT_ROLE_VERB);
  if (typeof existing === 'string' && existing.startsWith(`${layout.printPath}/${ROLES_NAME}/`)) {
    return existing.slice(`${layout.printPath}/${ROLES_NAME}/`.length);
  }
  return digest(`${layout.bodyPath}\0${record.relative}`).slice(0, 24);
}

function resolveSupportTarget(source, relation, records) {
  if (typeof relation?.object !== 'string' || !relation.object.trim()) return null;
  const object = relation.object.trim();
  const byAbsolute = records.find((record) => record.absolute === object);
  if (byAbsolute) return byAbsolute;
  if (object.startsWith('./')) return records.find((record) => record.relative === object) ?? null;
  if (object.includes('/')) return null;
  const sourceParent = source.relative === '.'
    ? '.'
    : source.relative.split('/').slice(0, -1).join('/') || '.';
  const siblingPath = sourceParent === '.' ? `./${object}` : `${sourceParent}/${object}`;
  const sibling = records.find((record) => record.relative === siblingPath);
  if (sibling) return sibling;
  const named = records.filter((record) => atomName(record.atom) === object);
  return named.length === 1 ? named[0] : null;
}

function compilePlan(layout) {
  const records = modelRecords(layout);
  const roles = records.map((record) => {
    const roleId = roleIdFor(layout, record);
    const parentRelative = record.relative === '.'
      ? null
      : record.relative.split('/').slice(0, -1).join('/') || '.';
    const parent = parentRelative == null
      ? null
      : records.find((candidate) => candidate.relative === parentRelative);
    const kind = atomTypes(record.atom).includes('program') ? 'program' : 'slot';
    return {
      role_id: roleId,
      kind,
      path: record.relative,
      parent_role_id: parent ? roleIdFor(layout, parent) : null,
      name: atomName(record.atom),
      types: [...atomTypes(record.atom)],
      description: atomDescription(record.atom),
      ...(kind === 'slot'
        ? { default_detail: fieldValue(record.atom, 'detail') ?? '' }
        : { program_digest: `sha256:${digest(fieldValue(record.atom, 'detail') ?? '')}` })
    };
  });
  const roleByRelative = new Map(roles.map((role) => [role.path, role]));
  const support = [];
  for (const record of records) {
    for (const relation of directedSupports(record.atom)) {
      const target = resolveSupportTarget(record, relation, records);
      if (!target) {
        return {
          error: slotError('INVALID_SLOT_PRINT_PLAN', '槽模 support 必须指向槽模内唯一角色', {
            source: record.absolute,
            verb: relation.verb,
            target: relation.object
          })
        };
      }
      support.push({
        verb: relation.verb,
        source_role_id: roleByRelative.get(record.relative).role_id,
        target_role_id: roleByRelative.get(target.relative).role_id,
        source_path: record.relative,
        target_path: target.relative
      });
    }
  }
  const roleOrder = new Map(roles.map((role, index) => [role.role_id, index]));
  support.sort((left, right) => (
    roleOrder.get(left.source_role_id) - roleOrder.get(right.source_role_id)
    || roleOrder.get(left.target_role_id) - roleOrder.get(right.target_role_id)
    || left.verb.localeCompare(right.verb)
  ));
  const planBase = { schema: 'atom-slot-print-plan/v1', body: layout.bodyPath, roles, support };
  const revision = `sha256:${digest(stableStringify(planBase))}`;
  return { plan: { ...planBase, revision }, records };
}

function planSource(plan) {
  const planText = JSON.stringify(plan);
  return [
    `PRINT_PLAN = json_parse(${JSON.stringify({ text: planText })})`,
    'def main(arguments):',
    `    return slot_body({"action":"print","body":${JSON.stringify(plan.body)},"name":arguments["name"],"revision":${JSON.stringify(plan.revision)}})`
  ].join('\n');
}

function revisionContainer(layout) {
  return directChild(layout.print, REVISIONS_NAME);
}

function currentPlan(layout) {
  const revisions = revisionContainer(layout);
  const records = childrenOf(revisions) ?? [];
  if (!records.length) return null;
  try {
    return JSON.parse(fieldValue(records.at(-1), 'detail'));
  } catch {
    return null;
  }
}

function roleCatalog(layout) {
  return directChild(layout.print, ROLES_NAME);
}

function ensureRoleRecords(layout, plan) {
  const catalog = roleCatalog(layout);
  const existing = new Map((childrenOf(catalog) ?? []).map((record) => [atomName(record), record]));
  for (const role of plan.roles) {
    if (!existing.has(role.role_id)) {
      childrenOf(catalog).push(createAtom({
        name: role.role_id,
        detail: JSON.stringify({ role_id: role.role_id })
      }));
    }
  }
  const byRelative = new Map(modelRecords(layout).map((record) => [record.relative, record]));
  for (const role of plan.roles) {
    setRelation(byRelative.get(role.path).atom, SLOT_ROLE_VERB, `${layout.printPath}/${ROLES_NAME}/${role.role_id}`);
  }
}

function appendRevision(layout, plan) {
  const revisions = revisionContainer(layout);
  const existing = (childrenOf(revisions) ?? []).find((record) => atomName(record) === plan.revision);
  if (!existing) {
    childrenOf(revisions).push(createAtom({
      name: plan.revision,
      detail: JSON.stringify(plan)
    }));
  }
  replaceStoredField(layout.print, 'detail', planSource(plan));
}

function initialSeal(atoms, layout) {
  replaceStoredField(layout.candidate, 'name', MODEL_NAME, {
    types: atomTypes(layout.candidate),
    descriptionPresent: atomDescription(layout.candidate) != null,
    description: atomDescription(layout.candidate)
  });
  childrenOf(layout.body).push(
    createAtom({
      name: PRINT_NAME,
      detail: 'def main(arguments):\n    return arguments',
      children: [
        createAtom({ name: ROLES_NAME }),
        createAtom({ name: REVISIONS_NAME })
      ],
      types: ['program']
    }),
    createAtom({ name: EXAMPLES_NAME })
  );
  return layoutOf(atoms, layout.bodyPath);
}

function roleTargetPath(layout, role, instancePath) {
  if (role.kind === 'program') {
    return role.path === '.'
      ? layout.modelPath
      : `${layout.modelPath}/${role.path.slice(2)}`;
  }
  return role.path === '.' ? instancePath : `${instancePath}/${role.path.slice(2)}`;
}

function buildInstance(layout, plan, name) {
  const instancePath = `${layout.examplesPath}/${name}`;
  const slots = plan.roles.filter((role) => role.kind === 'slot');
  const created = new Map();
  for (const role of slots) {
    const node = createAtom({
      name: role.path === '.' ? name : role.name,
      detail: role.default_detail,
      types: role.types,
      description: role.description
    });
    setRelation(node, SLOT_ROLE_VERB, `${layout.printPath}/${ROLES_NAME}/${role.role_id}`);
    created.set(role.role_id, node);
  }
  for (const role of slots.filter((candidate) => candidate.parent_role_id)) {
    childrenOf(created.get(role.parent_role_id)).push(created.get(role.role_id));
  }
  const root = created.get(slots.find((role) => role.path === '.').role_id);
  setRelation(root, SLOT_REVISION_VERB, `${layout.printPath}/${REVISIONS_NAME}/${plan.revision}`);
  for (const edge of plan.support) {
    const sourceRole = plan.roles.find((role) => role.role_id === edge.source_role_id);
    const targetRole = plan.roles.find((role) => role.role_id === edge.target_role_id);
    if (sourceRole.kind !== 'slot') continue;
    const source = created.get(sourceRole.role_id);
    const retained = partnersOf(source) ?? [];
    retained.push({ verb: edge.verb, object: roleTargetPath(layout, targetRole, instancePath) });
    replaceStoredField(source, 'partners', retained);
  }
  return root;
}

function instanceRevision(layout, instance) {
  const target = relationTarget(instance, SLOT_REVISION_VERB);
  const prefix = `${layout.printPath}/${REVISIONS_NAME}/`;
  return typeof target === 'string' && target.startsWith(prefix) ? target.slice(prefix.length) : null;
}

function roleMapForInstance(layout, instance) {
  const prefix = `${layout.printPath}/${ROLES_NAME}/`;
  const result = new Map();
  for (const match of walkAtoms([instance])) {
    const target = relationTarget(match.atom, SLOT_ROLE_VERB);
    if (typeof target === 'string' && target.startsWith(prefix)) {
      result.set(target.slice(prefix.length), match.atom);
    }
  }
  return result;
}

function generatedRelationKeys(layout, plan, roleId, instancePath) {
  const byId = new Map(plan.roles.map((role) => [role.role_id, role]));
  return new Set(plan.support
    .filter((edge) => edge.source_role_id === roleId)
    .map((edge) => {
      const target = byId.get(edge.target_role_id);
      return `${edge.verb}\0${roleTargetPath(layout, target, instancePath)}`;
    }));
}

function localPartners(layout, plan, roleId, instancePath, node) {
  const generated = generatedRelationKeys(layout, plan, roleId, instancePath);
  return (partnersOf(node) ?? []).filter((partner) => (
    partner.verb !== SLOT_ROLE_VERB
    && partner.verb !== SLOT_REVISION_VERB
    && !generated.has(`${partner.verb}\0${partner.object}`)
  ));
}

function roleMatchesOldDefault(node, role) {
  return fieldValue(node, 'detail') === role.default_detail
    && atomName(node) === role.name
    && stableStringify(atomTypes(node)) === stableStringify(role.types)
    && atomDescription(node) === role.description;
}

function sanitizePreservedSubtree(layout, oldPlan, instancePath, node) {
  const clone = structuredClone(node);
  function visit(current) {
    const roleTarget = relationTarget(current, SLOT_ROLE_VERB);
    const roleId = typeof roleTarget === 'string' ? roleTarget.split('/').at(-1) : null;
    const generated = roleId
      ? generatedRelationKeys(layout, oldPlan, roleId, instancePath)
      : new Set();
    replaceStoredField(current, 'partners', (partnersOf(current) ?? []).filter((partner) => (
      partner.verb !== SLOT_ROLE_VERB
      && partner.verb !== SLOT_REVISION_VERB
      && !generated.has(`${partner.verb}\0${partner.object}`)
    )));
    for (const child of childrenOf(current) ?? []) visit(child);
  }
  visit(clone);
  return clone;
}

function removedSubtreeIsCustomized(layout, oldPlan, oldRoleById, oldMap, instancePath, roleId) {
  const role = oldRoleById.get(roleId);
  const node = oldMap.get(roleId);
  if (!role || !node) return false;
  if (!roleMatchesOldDefault(node, role)) return true;
  if (localPartners(layout, oldPlan, roleId, instancePath, node).length) return true;
  const childRoleIds = oldPlan.roles
    .filter((candidate) => candidate.parent_role_id === roleId && candidate.kind === 'slot')
    .map((candidate) => candidate.role_id);
  const mappedChildren = new Set(childRoleIds.map((childId) => oldMap.get(childId)).filter(Boolean));
  if ((childrenOf(node) ?? []).some((child) => !mappedChildren.has(child))) return true;
  return childRoleIds.some((childId) => (
    removedSubtreeIsCustomized(layout, oldPlan, oldRoleById, oldMap, instancePath, childId)
  ));
}

function synchronizeInstance(layout, instance, oldPlan, newPlan, receipt) {
  const instanceName = atomName(instance);
  const instancePath = `${layout.examplesPath}/${instanceName}`;
  const oldMap = roleMapForInstance(layout, instance);
  const oldRoleById = new Map(oldPlan.roles.map((role) => [role.role_id, role]));
  const newRoleById = new Map(newPlan.roles.map((role) => [role.role_id, role]));
  const rebuilt = buildInstance(layout, newPlan, instanceName);
  const rebuiltMap = roleMapForInstance(layout, rebuilt);

  for (const [roleId, newRole] of newRoleById) {
    if (newRole.kind !== 'slot') continue;
    const oldRole = oldRoleById.get(roleId);
    const oldNode = oldMap.get(roleId);
    const newNode = rebuiltMap.get(roleId);
    if (!oldRole || !oldNode || !newNode) continue;
    const currentDetail = fieldValue(oldNode, 'detail');
    if (currentDetail === oldRole.default_detail) {
      if (currentDetail !== newRole.default_detail) {
        receipt.default_updated.push({
          instance: instanceName,
          role_id: roleId,
          old_default: oldRole.default_detail,
          new_default: newRole.default_detail
        });
      }
    } else {
      replaceStoredField(newNode, 'detail', currentDetail);
      receipt.preserved_customized.push({
        instance: instanceName,
        role_id: roleId,
        old_path: oldRole.path,
        new_path: newRole.path,
        reason: 'current_differs_from_old_default'
      });
    }
    const locals = localPartners(layout, oldPlan, roleId, instancePath, oldNode);
    if (locals.length) replaceStoredField(newNode, 'partners', [...partnersOf(newNode), ...structuredClone(locals)]);

    const oldChildRoles = new Set(oldPlan.roles
      .filter((candidate) => candidate.parent_role_id === roleId && candidate.kind === 'slot')
      .map((candidate) => oldMap.get(candidate.role_id))
      .filter(Boolean));
    for (const child of childrenOf(oldNode) ?? []) {
      if (!oldChildRoles.has(child)) childrenOf(newNode).push(structuredClone(child));
    }
  }

  const removed = oldPlan.roles.filter((role) => (
    role.kind === 'slot' && !newRoleById.has(role.role_id) && oldMap.has(role.role_id)
  ));
  const removedIds = new Set(removed.map((role) => role.role_id));
  for (const role of removed) {
    if (removedIds.has(role.parent_role_id)) continue;
    if (!removedSubtreeIsCustomized(
      layout, oldPlan, oldRoleById, oldMap, instancePath, role.role_id
    )) continue;
    let parentId = role.parent_role_id;
    while (parentId && !rebuiltMap.has(parentId)) parentId = oldRoleById.get(parentId)?.parent_role_id;
    const destination = parentId ? rebuiltMap.get(parentId) : rebuilt;
    childrenOf(destination).push(sanitizePreservedSubtree(
      layout, oldPlan, instancePath, oldMap.get(role.role_id)
    ));
    receipt.preserved_customized.push({
      instance: instanceName,
      role_id: role.role_id,
      old_path: role.path,
      new_path: null,
      reason: 'removed_role_contains_personalized_material'
    });
  }
  return rebuilt;
}

function cursorInventory(layout) {
  return digest((childrenOf(layout.examples) ?? []).map(atomName).sort().join('\0'));
}

function encodeCursor(layout, revision, after) {
  const payload = {
    body: layout.bodyPath,
    revision,
    after,
    inventory: cursorInventory(layout)
  };
  return Buffer.from(JSON.stringify({ ...payload, checksum: digest(stableStringify(payload)) }))
    .toString('base64url');
}

function decodeCursor(layout, effect, revision) {
  if (effect.cursor == null) return { after: null };
  try {
    const parsed = JSON.parse(Buffer.from(effect.cursor, 'base64url').toString('utf8'));
    const { checksum, ...payload } = parsed;
    if (checksum !== digest(stableStringify(payload))) throw new Error('checksum');
    if (payload.body !== layout.bodyPath || payload.revision !== revision
      || payload.inventory !== cursorInventory(layout) || typeof payload.after !== 'string') {
      return { error: slotError('SLOT_SYNC_CURSOR_STALE', '槽例同步游标不属于当前槽模修订或实例集合') };
    }
    return { after: payload.after };
  } catch {
    return { error: slotError('SLOT_SYNC_CURSOR_INVALID', '槽例同步游标无法解析或校验失败') };
  }
}

function retireUnreferencedPlans(layout, currentRevision) {
  const adopted = new Set((childrenOf(layout.examples) ?? []).map((instance) => (
    instanceRevision(layout, instance)
  )).filter(Boolean));
  const revisions = revisionContainer(layout);
  replaceStoredField(revisions, 'children', (childrenOf(revisions) ?? []).filter((record) => (
    atomName(record) === currentRevision || adopted.has(atomName(record))
  )));
}

async function authorizeLayout(layout, authorize) {
  for (const path of [layout.bodyPath, ...(layout.sealed ? [layout.modelPath, layout.printPath, layout.examplesPath] : [])]) {
    const decision = await authorize({ path, action: 'transform' });
    if (decision?.decision && decision.decision !== 'allow') {
      return slotError('PROGRAM_LOCK_DENIED', '当前窗口不允许执行槽体动作', { path });
    }
  }
  return null;
}

async function seal(atoms, effect, authorize) {
  let layout = layoutOf(atoms, effect.body);
  if (layout.error) return layout;
  const denied = await authorizeLayout(layout, authorize);
  if (denied) return { error: denied };
  if (!layout.sealed) layout = initialSeal(atoms, layout);
  const compiled = compilePlan(layout);
  if (compiled.error) return compiled;
  ensureRoleRecords(layout, compiled.plan);
  const recompiled = compilePlan(layout);
  if (recompiled.error) return recompiled;
  const oldPlan = currentPlan(layout);
  appendRevision(layout, recompiled.plan);
  const limit = effect.limit == null ? Number.POSITIVE_INFINITY : effect.limit;
  if (effect.limit != null && (!Number.isInteger(limit) || limit <= 0)) {
    return { error: slotError('INVALID_SLOT_SYNC_LIMIT', '同步批次 limit 必须是正整数') };
  }
  const cursor = decodeCursor(layout, effect, recompiled.plan.revision);
  if (cursor.error) return cursor;
  const instances = [...(childrenOf(layout.examples) ?? [])].sort((left, right) => (
    atomName(left).localeCompare(atomName(right), 'zh-CN')
  ));
  const pending = instances.filter((instance) => (
    instanceRevision(layout, instance) !== recompiled.plan.revision
    && (cursor.after == null || atomName(instance).localeCompare(cursor.after, 'zh-CN') > 0)
  ));
  const selected = pending.slice(0, limit);
  const receipt = {
    action: 'seal',
    body: layout.bodyPath,
    model: layout.modelPath,
    print: layout.printPath,
    examples: layout.examplesPath,
    revision: recompiled.plan.revision,
    previous_revision: oldPlan?.revision ?? null,
    processed: [],
    preserved_customized: [],
    default_updated: [],
    recompute_targets: []
  };
  for (const instance of selected) {
    const name = atomName(instance);
    const decision = await authorize({ path: `${layout.examplesPath}/${name}`, action: 'transform' });
    if (decision?.decision && decision.decision !== 'allow') {
      return { error: slotError('PROGRAM_LOCK_DENIED', '当前窗口不允许同步槽例', {
        path: `${layout.examplesPath}/${name}`
      }) };
    }
    const adoptedRevision = instanceRevision(layout, instance);
    const adoptedPlan = planAtRevision(layout, adoptedRevision);
    if (!adoptedPlan) {
      return { error: slotError('SLOT_INSTANCE_REVISION_MISSING', '槽例采用的槽模修订不可回读', {
        instance: `${layout.examplesPath}/${name}`,
        revision: adoptedRevision
      }) };
    }
    const replacement = synchronizeInstance(layout, instance, adoptedPlan, recompiled.plan, receipt);
    const position = childrenOf(layout.examples).indexOf(instance);
    childrenOf(layout.examples)[position] = replacement;
    receipt.processed.push(name);
    const sourceIds = new Set(recompiled.plan.support.map((edge) => edge.source_role_id));
    for (const role of recompiled.plan.roles) {
      if (role.kind === 'slot' && sourceIds.has(role.role_id)) {
        receipt.recompute_targets.push(roleTargetPath(
          layout, role, `${layout.examplesPath}/${name}`
        ));
      }
    }
  }
  const remaining = (childrenOf(layout.examples) ?? []).filter((instance) => (
    instanceRevision(layout, instance) !== recompiled.plan.revision
  )).length;
  const complete = remaining === 0;
  if (complete) retireUnreferencedPlans(layout, recompiled.plan.revision);
  const lastProcessed = receipt.processed.at(-1) ?? cursor.after;
  Object.assign(receipt, {
    remaining,
    next_cursor: complete || !lastProcessed
      ? null
      : encodeCursor(layout, recompiled.plan.revision, lastProcessed),
    complete
  });
  return {
    atoms,
    receipt
  };
}

async function printExample(atoms, effect, sourceProgramPath, authorize) {
  const layout = layoutOf(atoms, effect.body);
  if (layout.error) return layout;
  if (!layout.sealed) return { error: slotError('SLOT_BODY_NOT_SEALED', '槽体尚未封装', { body: layout.bodyPath }) };
  if (sourceProgramPath !== layout.printPath) {
    return { error: slotError('INVALID_SLOT_PRINT_PLAN', '打印效果必须由目标槽体当前 print Program 发出', {
      body: layout.bodyPath,
      program: sourceProgramPath
    }) };
  }
  const plan = currentPlan(layout);
  if (!plan) return { error: slotError('INVALID_SLOT_PRINT_PLAN', '当前 print Program 缺少可见计划') };
  if (effect.revision !== plan.revision) {
    return { error: slotError('SLOT_PRINT_PLAN_STALE', '打印计划修订已经过期', {
      body: layout.bodyPath,
      expected: plan.revision,
      actual: effect.revision
    }) };
  }
  if (typeof effect.name !== 'string' || !effect.name.trim() || effect.name.includes('/')) {
    return { error: slotError('INVALID_SLOT_BODY_EXAMPLE_NAME', '槽例名称必须是非空单段字符串') };
  }
  const name = effect.name.trim();
  if ((childrenOf(layout.examples) ?? []).some((example) => atomName(example) === name)) {
    return { error: slotError('SLOT_BODY_EXAMPLE_EXISTS', `槽例中已存在名称：${name}`, {
      target: `${layout.examplesPath}/${name}`
    }) };
  }
  const decision = await authorize({ path: layout.examplesPath, action: 'transform' });
  if (decision?.decision && decision.decision !== 'allow') {
    return { error: slotError('PROGRAM_LOCK_DENIED', '当前窗口不允许打印槽例', { path: layout.examplesPath }) };
  }
  childrenOf(layout.examples).push(buildInstance(layout, plan, name));
  return {
    atoms,
    receipt: {
      action: 'print',
      body: layout.bodyPath,
      revision: plan.revision,
      target: `${layout.examplesPath}/${name}`
    }
  };
}

export async function applyPlanSlotBodyEffect({
  atoms,
  effect,
  sourceProgramPath = null,
  authorize = async () => ({ decision: 'allow' }),
  mutateInput = false
}) {
  const effectKeys = effect && typeof effect === 'object' && !Array.isArray(effect)
    ? Object.keys(effect)
    : [];
  const allowedKeys = effect?.action === 'seal'
    ? ['action', 'body', 'cursor', 'limit']
    : ['action', 'body', 'name', 'revision'];
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)
    || !['seal', 'print'].includes(effect.action)
    || typeof effect.body !== 'string' || !effect.body.trim()
    || effectKeys.some((key) => !allowedKeys.includes(key))) {
    return { error: slotError('INVALID_SLOT_BODY_EFFECT', 'slot_body() 需要 seal 或带当前计划修订的 print') };
  }
  const candidate = mutateInput ? atoms : structuredClone(atoms);
  const before = mutateInput ? structuredClone(atoms) : null;
  const result = effect.action === 'seal'
    ? await seal(candidate, effect, authorize)
    : await printExample(candidate, effect, sourceProgramPath, authorize);
  if (result?.error && mutateInput) atoms.splice(0, atoms.length, ...before);
  return result;
}

export function readVisibleSlotPlans(atoms) {
  const plans = [];
  for (const match of walkAtoms(atoms)) {
    if (atomName(match.atom) !== PRINT_NAME || !atomTypes(match.atom).includes('program')) continue;
    const parent = match.parent?.atom;
    if (!parent || !directChild(parent, MODEL_NAME) || !directChild(parent, EXAMPLES_NAME)) continue;
    const layout = layoutOf(atoms, match.parent.path.join('/'));
    const plan = layout.error ? null : currentPlan(layout);
    if (plan) plans.push({ layout, plan });
  }
  return plans;
}

function planAtRevision(layout, revision) {
  const record = (childrenOf(revisionContainer(layout)) ?? [])
    .find((candidate) => atomName(candidate) === revision);
  if (!record) return null;
  try {
    return JSON.parse(fieldValue(record, 'detail'));
  } catch {
    return null;
  }
}

function instanceContextForEvent(atoms, eventPath) {
  const segments = eventPath.split('/').filter(Boolean);
  let prefixCache = instancePrefixIndexes.get(atoms);
  if (!prefixCache) {
    prefixCache = new Map();
    instancePrefixIndexes.set(atoms, prefixCache);
  }
  for (let index = segments.length - 2; index >= 1; index -= 1) {
    if (segments[index] !== EXAMPLES_NAME || index + 1 >= segments.length) continue;
    const instancePath = segments.slice(0, index + 2).join('/');
    const cached = prefixCache.get(instancePath);
    if (cached) {
      const suffix = segments.slice(index + 2);
      return { ...cached, relativePath: suffix.length ? `./${suffix.join('/')}` : '.' };
    }
    const bodyPath = segments.slice(0, index).join('/');
    const layout = layoutOf(atoms, bodyPath);
    if (layout.error || !layout.sealed) continue;
    const selected = resolveUnique(atoms, instancePath);
    if (selected.error) continue;
    const revisionTarget = relationTarget(selected.match.atom, SLOT_REVISION_VERB);
    const prefix = `${layout.printPath}/${REVISIONS_NAME}/`;
    if (typeof revisionTarget !== 'string' || !revisionTarget.startsWith(prefix)) continue;
    const revision = revisionTarget.slice(prefix.length);
    const plan = planAtRevision(layout, revision);
    if (!plan) continue;
    const suffix = segments.slice(index + 2);
    const cachedContext = {
      layout,
      instancePath,
      revision,
      plan
    };
    prefixCache.set(instancePath, cachedContext);
    return { ...cachedContext, relativePath: suffix.length ? `./${suffix.join('/')}` : '.' };
  }
  return null;
}

export function slotProgramInvocationsForEvent(atoms, triggerEvent) {
  if (triggerEvent?.mode !== 'transform' || !Array.isArray(triggerEvent.nodes)) return [];
  const invocations = [];
  const seen = new Set();
  for (const eventPath of triggerEvent.nodes) {
    if (typeof eventPath !== 'string') continue;
    const context = instanceContextForEvent(atoms, eventPath);
    if (!context) continue;
    const source = context.plan.roles.find((role) => role.path === context.relativePath);
    if (!source) {
      throw Object.assign(new Error('实例事件无法映射到采用修订中的相对槽角色'), {
        code: 'SLOT_SCOPE_ROLE_MISMATCH',
        details: {
          body: context.layout.bodyPath,
          revision: context.revision,
          scope_root: context.instancePath,
          role: context.relativePath
        }
      });
    }
    const outgoing = new Map();
    for (const edge of context.plan.support) {
      if (!outgoing.has(edge.source_role_id)) outgoing.set(edge.source_role_id, []);
      outgoing.get(edge.source_role_id).push(edge.target_role_id);
    }
    const byId = new Map(context.plan.roles.map((role) => [role.role_id, role]));
    const queue = [...(outgoing.get(source.role_id) ?? [])];
    const visited = new Set([source.role_id]);
    while (queue.length) {
      const roleId = queue.shift();
      if (visited.has(roleId)) continue;
      visited.add(roleId);
      const role = byId.get(roleId);
      if (!role) continue;
      if (role.kind === 'program') {
        const programPath = role.path === '.'
          ? context.layout.modelPath
          : `${context.layout.modelPath}/${role.path.slice(2)}`;
        const key = `${programPath}\0${context.instancePath}\0${context.revision}`;
        if (!seen.has(key)) {
          seen.add(key);
          invocations.push({
            programPath,
            programRoot: context.layout.modelPath,
            scopeRoot: context.instancePath,
            revision: context.revision,
            eventPath,
            sourceRole: context.relativePath
          });
        }
      }
      queue.push(...(outgoing.get(roleId) ?? []));
    }
  }
  return invocations;
}
