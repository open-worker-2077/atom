import crypto from 'node:crypto';
import { revisionOfWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';

import {
  atomDescription,
  atomName,
  atomTypes,
  publicAtomTypes,
  childrenOf,
  createAtom,
  directChild,
  directedStruts,
  fieldValue,
  instanceRevisionOf,
  partnersOf,
  replaceStoredField,
  resolveUnique,
  roleIdOf,
  setInstanceRevision,
  setRoleId,
  storedField,
  walkAtoms
} from './slot-graph-semantics.mjs';

const MODEL_NAME = '槽模';
const PRINT_NAME = 'print';
const EXAMPLES_NAME = '槽例';
const ROLES_NAME = '角色';
const REVISIONS_NAME = '修订';
const instancePrefixIndexes = new WeakMap();
const compiledStructureLocks = new WeakMap();

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
    return { error: slotError('INVALID_SLOT_BODY_LAYOUT', '槽体必须具有完整 slot Graph', { body: bodyPath }) };
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
  const existing = roleIdOf(record.atom);
  if (existing) return existing;
  return digest(`${layout.bodyPath}\0${record.relative}`).slice(0, 24);
}

function resolveStrutEndpoint(source, endpoint, records) {
  const key = Object.hasOwn(endpoint ?? {}, 'thing@program') ? 'thing@program' : 'thing';
  const selector = endpoint?.[key];
  if (typeof selector !== 'string' || !selector.trim()) return null;
  if (selector === '.') return source;
  if (selector.startsWith('./')) {
    const sourceParent = source.relative === '.'
      ? '.'
      : source.relative.split('/').slice(0, -1).join('/') || '.';
    const relative = sourceParent === '.' ? `./${selector.slice(2)}` : `${sourceParent}/${selector.slice(2)}`;
    return records.find((record) => record.relative === relative) ?? null;
  }
  const absolute = records.find((record) => record.absolute === selector);
  if (absolute) return absolute;
  if (selector.includes('/')) return null;
  const sourceParent = source.relative === '.'
    ? '.'
    : source.relative.split('/').slice(0, -1).join('/') || '.';
  const siblingPath = sourceParent === '.' ? `./${selector}` : `${sourceParent}/${selector}`;
  const sibling = records.find((record) => record.relative === siblingPath);
  if (sibling) return sibling;
  const named = records.filter((record) => atomName(record.atom) === selector);
  return named.length === 1 ? named[0] : null;
}

function compileStrutEndpoint(source, endpoint, records, roleByRelative) {
  const key = Object.hasOwn(endpoint ?? {}, 'thing@program') ? 'thing@program' : 'thing';
  const target = resolveStrutEndpoint(source, endpoint, records);
  if (!target) return null;
  return { [key]: roleByRelative.get(target.relative).role_id };
}

function compileStrutExpr(source, expr, records, roleByRelative) {
  if (Object.hasOwn(expr ?? {}, 'program')) return { program: expr.program };
  if (Object.hasOwn(expr ?? {}, 'thing')) {
    return compileStrutEndpoint(source, expr, records, roleByRelative);
  }
  for (const key of ['and', 'or']) {
    if (Array.isArray(expr?.[key])) {
      const children = expr[key].map((child) => compileStrutExpr(source, child, records, roleByRelative));
      return children.every(Boolean) ? { [key]: children } : null;
    }
  }
  return null;
}

function compileStrutRule(source, rule, records, roleByRelative) {
  const compiled = {};
  if (rule['if@current'] === true) compiled['if@current'] = true;
  if (Array.isArray(rule.if)) {
    const root = rule.if.length === 0 ? [] : [compileStrutExpr(source, rule.if[0], records, roleByRelative)];
    if (root.some((entry) => !entry)) return null;
    compiled.if = root;
  }
  if (rule['then@current'] === true) compiled['then@current'] = true;
  if (Array.isArray(rule.then)) {
    compiled.then = rule.then.map((entry) => compileStrutEndpoint(source, entry, records, roleByRelative));
    if (compiled.then.some((entry) => !entry)) return null;
  }
  return compiled;
}

function compilePlan(layout, structureLock = null) {
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
      thing: atomName(record.atom),
      types: [...publicAtomTypes(record.atom)],
      description: atomDescription(record.atom),
      ...(kind === 'slot'
        ? { contract_situation: fieldValue(record.atom, 'situation') ?? '' }
        : { program_digest: `sha256:${digest(fieldValue(record.atom, 'situation') ?? '')}` })
    };
  });
  const roleByRelative = new Map(roles.map((role) => [role.path, role]));
  const strut = [];
  for (const record of records) {
    for (const rule of directedStruts(record.atom)) {
      const compiledRule = compileStrutRule(record, rule, records, roleByRelative);
      if (!compiledRule) {
        return {
          error: slotError('INVALID_SLOT_PRINT_PLAN', '槽模 strut 必须指向槽模内唯一角色', {
            source: record.absolute,
            rule
          })
        };
      }
      strut.push({
        owner_role_id: roleByRelative.get(record.relative).role_id,
        rule: compiledRule
      });
    }
  }
  const roleOrder = new Map(roles.map((role, index) => [role.role_id, index]));
  strut.sort((left, right) => (
    roleOrder.get(left.owner_role_id) - roleOrder.get(right.owner_role_id)
  ));
  const planBase = {
    schema: 'atom-slot-print-plan/v1', body: layout.bodyPath, roles, strut,
    ...(structureLock === true ? { structureLock: true } : {})
  };
  const revision = `sha256:${digest(stableStringify(planBase))}`;
  return { plan: { ...planBase, revision }, records };
}

function planSource(plan) {
  const planText = JSON.stringify(plan);
  return [
    `PRINT_PLAN = json_parse(${JSON.stringify({ text: planText })})`,
    'def main(arguments):',
    `    return slot_body({"action":"print","body":${JSON.stringify(plan.body)},"name":arguments["name"]})`
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
    return JSON.parse(fieldValue(records.at(-1), 'situation'));
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
        thing: role.role_id,
        situation: JSON.stringify({ role_id: role.role_id })
      }));
    }
  }
  const byRelative = new Map(modelRecords(layout).map((record) => [record.relative, record]));
  for (const role of plan.roles) {
    setRoleId(byRelative.get(role.path).atom, role.role_id);
  }
}

function appendRevision(layout, plan) {
  const revisions = revisionContainer(layout);
  const existing = (childrenOf(revisions) ?? []).find((record) => atomName(record) === plan.revision);
  if (!existing) {
    childrenOf(revisions).push(createAtom({
      thing: plan.revision,
      situation: JSON.stringify(plan)
    }));
  }
  replaceStoredField(layout.print, 'situation', planSource(plan));
}

function initialSeal(atoms, layout) {
  replaceStoredField(layout.candidate, 'thing', MODEL_NAME, {
    types: atomTypes(layout.candidate),
    descriptionPresent: atomDescription(layout.candidate) != null,
    description: atomDescription(layout.candidate)
  });
  childrenOf(layout.body).push(
    createAtom({
      thing: PRINT_NAME,
      situation: 'def main(arguments):\n    return arguments',
      slot: [
        createAtom({ thing: ROLES_NAME }),
        createAtom({ thing: REVISIONS_NAME })
      ],
      types: ['program']
    }),
    createAtom({ thing: EXAMPLES_NAME })
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

function materializeEndpoint(endpoint, plan, layout, instancePath) {
  const key = Object.hasOwn(endpoint, 'thing@program') ? 'thing@program' : 'thing';
  const role = plan.roles.find((candidate) => candidate.role_id === endpoint[key]);
  return role ? { [key]: roleTargetPath(layout, role, instancePath) } : null;
}

function materializeExpr(expr, plan, layout, instancePath) {
  if (Object.hasOwn(expr, 'program')) return { program: expr.program };
  if (Object.hasOwn(expr, 'thing')) {
    return materializeEndpoint(expr, plan, layout, instancePath);
  }
  for (const key of ['and', 'or']) {
    if (Array.isArray(expr[key])) {
      return { [key]: expr[key].map((child) => materializeExpr(child, plan, layout, instancePath)) };
    }
  }
  return null;
}

function materializeRule(compiled, plan, layout, instancePath) {
  const rule = {};
  if (compiled['if@current'] === true) rule['if@current'] = true;
  if (Array.isArray(compiled.if)) rule.if = compiled.if.map((expr) => materializeExpr(expr, plan, layout, instancePath));
  if (compiled['then@current'] === true) rule['then@current'] = true;
  if (Array.isArray(compiled.then)) rule.then = compiled.then.map((endpoint) => (
    materializeEndpoint(endpoint, plan, layout, instancePath)
  ));
  return rule;
}

function roleIdsInExpr(expr) {
  if (Object.hasOwn(expr ?? {}, 'thing')) return [expr.thing];
  if (Object.hasOwn(expr ?? {}, 'program')) return [];
  for (const key of ['and', 'or']) {
    if (Array.isArray(expr?.[key])) return expr[key].flatMap(roleIdsInExpr);
  }
  return [];
}

function strutRoleSides(entry) {
  const antecedent = entry.rule['if@current'] === true ? [entry.owner_role_id] : [];
  antecedent.push(...(entry.rule.if ?? []).flatMap(roleIdsInExpr));
  const consequent = entry.rule['then@current'] === true ? [entry.owner_role_id] : [];
  consequent.push(...(entry.rule.then ?? []).flatMap(roleIdsInExpr));
  return {
    antecedent: [...new Set(antecedent)],
    consequent: [...new Set(consequent)]
  };
}

function buildInstance(layout, plan, name) {
  const instancePath = `${layout.examplesPath}/${name}`;
  const slots = plan.roles.filter((role) => role.kind === 'slot');
  const created = new Map();
  for (const role of slots) {
    const node = createAtom({
      thing: role.path === '.' ? name : role.thing,
      situation: role.contract_situation,
      types: role.types,
      description: role.description
    });
    setRoleId(node, role.role_id);
    created.set(role.role_id, node);
  }
  for (const role of slots.filter((candidate) => candidate.parent_role_id)) {
    childrenOf(created.get(role.parent_role_id)).push(created.get(role.role_id));
  }
  const root = created.get(slots.find((role) => role.path === '.').role_id);
  setInstanceRevision(root, plan.revision);
  for (const edge of plan.strut) {
    const sourceRole = plan.roles.find((role) => role.role_id === edge.owner_role_id);
    if (sourceRole.kind !== 'slot') continue;
    const source = created.get(sourceRole.role_id);
    const retained = partnersOf(source) ?? [];
    retained.push(materializeRule(edge.rule, plan, layout, instancePath));
    replaceStoredField(source, 'strut', retained);
  }
  return root;
}

function instanceRevision(layout, instance) {
  void layout;
  return instanceRevisionOf(instance);
}

function roleMapForInstance(layout, instance) {
  const result = new Map();
  for (const match of walkAtoms([instance])) {
    const roleId = roleIdOf(match.atom);
    if (roleId) result.set(roleId, match.atom);
  }
  return result;
}

function firstLocalMaterial(oldPlan, oldMap, roleId, slotPath) {
  const node = oldMap.get(roleId);
  if (!node) return null;
  const childRoles = oldPlan.roles.filter((candidate) => (
    candidate.kind === 'slot' && candidate.parent_role_id === roleId
  ));
  const mappedChildren = new Map(childRoles
    .map((role) => [oldMap.get(role.role_id), role])
    .filter(([child]) => child));
  for (const child of childrenOf(node) ?? []) {
    const childRole = mappedChildren.get(child);
    if (!childRole) return `${slotPath}/${atomName(child)}`;
    const nested = firstLocalMaterial(
      oldPlan,
      oldMap,
      childRole.role_id,
      `${slotPath}/${atomName(child)}`
    );
    if (nested) return nested;
  }
  return null;
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
    const oldChildRoles = new Set(oldPlan.roles
      .filter((candidate) => candidate.parent_role_id === roleId && candidate.kind === 'slot')
      .map((candidate) => oldMap.get(candidate.role_id))
      .filter(Boolean));
    for (const child of childrenOf(oldNode) ?? []) {
      if (!oldChildRoles.has(child)) {
        childrenOf(newNode).push(structuredClone(child));
        receipt.material_preserved.push({
          instance: instancePath,
          slot: roleTargetPath(layout, newRole, instancePath),
          material: `${roleTargetPath(layout, newRole, instancePath)}/${atomName(child)}`
        });
      }
    }
  }

  const removed = oldPlan.roles.filter((role) => (
    role.kind === 'slot' && !newRoleById.has(role.role_id) && oldMap.has(role.role_id)
  ));
  const removedIds = new Set(removed.map((role) => role.role_id));
  for (const role of removed) {
    if (removedIds.has(role.parent_role_id)) continue;
    const slotPath = roleTargetPath(layout, role, instancePath);
    const material = firstLocalMaterial(oldPlan, oldMap, role.role_id, slotPath);
    if (material) {
      return {
        error: slotError(
          'SLOT_MATERIAL_SLOTMENT_CONFLICT',
          '待删除映射槽仍包含实例本地料，重封装已回滚',
          { instance: instancePath, slot: slotPath, material }
        )
      };
    }
  }
  return { replacement: rebuilt };
}

function retireUnreferencedPlans(layout, currentRevision) {
  const adopted = new Set((childrenOf(layout.examples) ?? []).map((instance) => (
    instanceRevision(layout, instance)
  )).filter(Boolean));
  const revisions = revisionContainer(layout);
  replaceStoredField(revisions, 'slot', (childrenOf(revisions) ?? []).filter((record) => (
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
  const compiled = compilePlan(layout, true);
  if (compiled.error) return compiled;
  ensureRoleRecords(layout, compiled.plan);
  const recompiled = compilePlan(layout, true);
  if (recompiled.error) return recompiled;
  const oldPlan = currentPlan(layout);
  appendRevision(layout, recompiled.plan);
  const instances = [...(childrenOf(layout.examples) ?? [])].sort((left, right) => (
    atomName(left).localeCompare(atomName(right), 'zh-CN')
  ));
  const pending = instances.filter((instance) => (
    instanceRevision(layout, instance) !== recompiled.plan.revision
  ));
  const receipt = {
    action: 'seal',
    body: layout.bodyPath,
    model: layout.modelPath,
    print: layout.printPath,
    examples: layout.examplesPath,
    revision: recompiled.plan.revision,
    previous_revision: oldPlan?.revision ?? null,
    processed: [],
    material_preserved: [],
    recompute_targets: []
  };
  for (const instance of pending) {
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
    const synchronized = synchronizeInstance(layout, instance, adoptedPlan, recompiled.plan, receipt);
    if (synchronized.error) return synchronized;
    const position = childrenOf(layout.examples).indexOf(instance);
    childrenOf(layout.examples)[position] = synchronized.replacement;
    receipt.processed.push(name);
    const sourceIds = new Set(recompiled.plan.strut.flatMap((entry) => (
      strutRoleSides(entry).antecedent
    )));
    for (const role of recompiled.plan.roles) {
      if (role.kind === 'slot' && sourceIds.has(role.role_id)) {
        receipt.recompute_targets.push(roleTargetPath(
          layout, role, `${layout.examplesPath}/${name}`
        ));
      }
    }
  }
  retireUnreferencedPlans(layout, recompiled.plan.revision);
  receipt.complete = true;
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
  if (effect.revision !== undefined && effect.revision !== plan.revision) {
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
    ? ['action', 'body']
    : ['action', 'body', 'name', 'revision'];
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)
    || !['seal', 'print'].includes(effect.action)
    || typeof effect.body !== 'string' || !effect.body.trim()
    || effectKeys.some((key) => !allowedKeys.includes(key))) {
    return { error: slotError('INVALID_SLOT_BODY_EFFECT', 'slot_body() 只接受 seal 或当前 print Program 的内部打印效果') };
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

export function compileSlotStructureGraphLocks(atoms) {
  const revision = revisionOfWorldFacts(atoms);
  const cached = compiledStructureLocks.get(atoms);
  if (cached?.revision === revision) return cached.value;
  const locks = [];
  const domains = [];
  const seen = new Set();
  for (const { layout, plan } of readVisibleSlotPlans(atoms)) {
    if (plan.structureLock !== true) continue;
    const roots = [layout.modelPath];
    for (const instance of childrenOf(layout.examples) ?? []) {
      roots.push(`${layout.examplesPath}/${atomName(instance)}`);
    }
    for (const root of roots) {
      domains.push({ path: root, body: layout.bodyPath, revision: plan.revision });
      for (const role of plan.roles.filter((entry) => entry.kind === 'slot')) {
        const path = roleTargetPath(layout, role, root);
        const key = `${path}\u0000${plan.revision}`;
        if (seen.has(key)) continue;
        seen.add(key);
        locks.push({
          kind: 'node',
          path,
          actions: ['transform'],
          allowCapabilities: ['slot-material-create', 'slot-material-move', 'slot-reseal'],
          denialCode: 'SLOT_STRUCTURE_LOCK_DENIED',
          lockKind: 'slot-structure-lock',
          source: 'slot_body',
          body: layout.bodyPath,
          revision: plan.revision
        });
      }
    }
  }
  const value = { locks, domains };
  compiledStructureLocks.set(atoms, { revision, value });
  return value;
}

function planAtRevision(layout, revision) {
  const record = (childrenOf(revisionContainer(layout)) ?? [])
    .find((candidate) => atomName(candidate) === revision);
  if (!record) return null;
  try {
    return JSON.parse(fieldValue(record, 'situation'));
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
    const revision = instanceRevisionOf(selected.match.atom);
    if (!revision) continue;
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

export function slotProgramInvocationsForEvent(atoms, triggerEvent, triggerContracts = new Map()) {
  if (!['transform', 'strut'].includes(triggerEvent?.mode)) return [];
  if (triggerEvent.mode === 'transform' && !Array.isArray(triggerEvent.nodes)) return [];
  if (triggerEvent.mode === 'strut' && !Array.isArray(triggerEvent.deliveries)) return [];
  const invocations = [];
  const invocationByKey = new Map();
  const addInvocation = (context, eventPath, source, role) => {
    const programPath = role.path === '.'
      ? context.layout.modelPath
      : `${context.layout.modelPath}/${role.path.slice(2)}`;
    const key = `${programPath}\0${context.instancePath}\0${context.revision}`;
    if (invocationByKey.has(key)) return;
    const invocation = {
      programPath,
      programRoot: context.layout.modelPath,
      scopeRoot: context.instancePath,
      revision: context.revision,
      eventPath,
      sourceRole: source.path
    };
    invocationByKey.set(key, invocation);
    invocations.push(invocation);
  };
  if (triggerEvent.mode === 'strut') {
    for (const delivery of triggerEvent.deliveries) {
      if (delivery?.mode !== 'strut' || delivery.decision !== true) continue;
      const contexts = new Map();
      for (const antecedentPath of delivery.antecedentPaths ?? []) {
        const context = instanceContextForEvent(atoms, antecedentPath);
        if (context) contexts.set(context.instancePath, context);
      }
      for (const context of contexts.values()) {
        const role = context.plan.roles.find((candidate) => (
          candidate.kind === 'program'
          && roleTargetPath(context.layout, candidate, context.instancePath) === delivery.consequentPath
        ));
        if (!role) continue;
        const programPath = roleTargetPath(context.layout, role, context.instancePath);
        const contract = triggerContracts.get(programPath)?.contract;
        if (contract?.mode !== 'strut') continue;
        addInvocation(context, delivery.consequentPath, role, role);
      }
    }
    return invocations;
  }
  for (const eventPath of triggerEvent.nodes) {
    if (typeof eventPath !== 'string') continue;
    const context = instanceContextForEvent(atoms, eventPath);
    if (!context) continue;
    let source = context.plan.roles.find((role) => role.path === context.relativePath);
    if (!source) {
      const selected = resolveUnique(atoms, eventPath);
      if (!selected.error && !roleIdOf(selected.match.atom)) {
        source = context.plan.roles
          .filter((role) => role.kind === 'slot'
            && context.relativePath.startsWith(`${role.path}/`))
          .sort((left, right) => right.path.length - left.path.length)[0];
        if (!source) continue;
      }
    }
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
    for (const role of context.plan.roles.filter((candidate) => candidate.kind === 'program')) {
      const programPath = role.path === '.'
        ? context.layout.modelPath
        : `${context.layout.modelPath}/${role.path.slice(2)}`;
      const contract = triggerContracts.get(programPath)?.contract;
      if (contract?.mode !== 'transform') continue;
      if (!(contract.parameters?.nodes ?? []).includes(source.path)) continue;
      addInvocation(context, eventPath, source, role);
    }
  }
  return invocations;
}
