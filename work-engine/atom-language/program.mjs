import path from 'node:path';

import { diagnostic } from './errors.mjs';
import { parseAtomKey } from './key-parser.mjs';
import { applyTransform } from './transform-executor.mjs';

export const PROGRAM_CAPABILITIES = Object.freeze({
  READ_DETAIL: 'atom.engine/read-detail@1',
  FOLLOW_PARTNER: 'atom.engine/follow-partner@1',
  GUARD_NON_EMPTY: 'atom.engine/guard-non-empty@1',
  GUARD_EQUALS: 'atom.engine/guard-equals@1',
  REPLACE_DETAIL: 'atom.engine/replace-detail@1',
  CREATE_CHILD: 'atom.engine/create-child@1'
});

const SUPPORTED_CAPABILITIES = new Set(Object.values(PROGRAM_CAPABILITIES));

function fieldsByBase(atom) {
  const result = new Map();
  for (const [rawKey, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (parsed.errors.length) continue;
    if (!result.has(parsed.baseKey)) result.set(parsed.baseKey, []);
    result.get(parsed.baseKey).push({ rawKey, parsed, value });
  }
  return result;
}

function storedField(atom, baseKey) {
  const fields = fieldsByBase(atom).get(baseKey) ?? [];
  return fields.length === 1 ? fields[0] : null;
}

function atomName(atom) {
  return storedField(atom, 'name')?.value;
}

function directChildren(atom) {
  const children = storedField(atom, 'children')?.value;
  return Array.isArray(children) ? children : [];
}

function atomPartners(atom) {
  const partners = storedField(atom, 'partners')?.value;
  return Array.isArray(partners) ? partners : [];
}

function atomDetail(atom) {
  return storedField(atom, 'detail')?.value;
}

function isProgram(atom) {
  return storedField(atom, 'name')?.parsed.types.some((type) => (
    type.raw === 'program'
  )) ?? false;
}

function walkAtoms(atoms) {
  const result = [];
  function visit(atom, parent, index, parentPath) {
    const pathParts = [...parentPath, atomName(atom)];
    const record = { atom, parent, index, path: pathParts.join('/') };
    result.push(record);
    directChildren(atom).forEach((child, childIndex) => (
      visit(child, record, childIndex, pathParts)
    ));
  }
  atoms.forEach((atom, index) => visit(atom, null, index, []));
  return result;
}

function normalizeReference(object, rootName) {
  return object.startsWith(`${rootName}/`)
    ? object.slice(rootName.length + 1)
    : object;
}

function resolveReference(matches, source, object, rootName) {
  if (typeof object !== 'string' || !object) return null;
  const reference = normalizeReference(object, rootName);
  if (reference.includes('/')) {
    return matches.find((match) => match.path === reference) ?? null;
  }
  const siblingPath = [
    ...source.path.split('/').slice(0, -1),
    reference
  ].join('/');
  const sibling = matches.find((match) => match.path === siblingPath);
  if (sibling) return sibling;
  const named = matches.filter((match) => atomName(match.atom) === reference);
  return named.length === 1 ? named[0] : null;
}

function relations(step, verb) {
  return atomPartners(step.atom).filter((partner) => partner?.verb === verb);
}

function exactlyOneAlternative(step, directVerb, resultVerb, errors) {
  const direct = relations(step, directVerb);
  const result = relations(step, resultVerb);
  if (direct.length + result.length !== 1) {
    errors.push(diagnostic(
      'PROGRAM_PARTNER_REQUIRED',
      `Program step 需要且只能有一个 ${directVerb} 或 ${resultVerb} partner`,
      { path: step.path, directVerb, resultVerb }
    ));
    return null;
  }
  return direct.length
    ? { kind: 'atom', verb: directVerb, partner: direct[0] }
    : { kind: 'result', verb: resultVerb, partner: result[0] };
}

function exactlyOne(step, verb, errors) {
  const found = relations(step, verb);
  if (found.length !== 1) {
    errors.push(diagnostic(
      'PROGRAM_PARTNER_REQUIRED',
      `Program step 需要且只能有一个 ${verb} partner`,
      { path: step.path, verb, count: found.length }
    ));
    return null;
  }
  return { kind: 'atom', verb, partner: found[0] };
}

function compileInput(input, step, stepIndex, stepRecords, matches, rootName, errors) {
  if (!input) return null;
  if (input.kind === 'atom') {
    const target = resolveReference(matches, step, input.partner.object, rootName);
    if (!target) {
      errors.push(diagnostic(
        'PROGRAM_PARTNER_TARGET_NOT_FOUND',
        `Program partner 指向不存在或不唯一的 Atom：${input.partner.object}`,
        { path: step.path, verb: input.verb, object: input.partner.object }
      ));
      return null;
    }
    return { ...input, targetPath: target.path };
  }
  const target = resolveReference(matches, step, input.partner.object, rootName);
  const resultIndex = stepRecords.findIndex((candidate) => candidate.atom === target?.atom);
  if (resultIndex < 0 || resultIndex >= stepIndex) {
    errors.push(diagnostic(
      'PROGRAM_RESULT_NOT_READY',
      `${input.verb} 必须指向当前 Program 中已经完成的前序步骤`,
      { path: step.path, object: input.partner.object }
    ));
    return null;
  }
  return { ...input, stepIndex: resultIndex };
}

function compileStep(step, stepIndex, stepRecords, matches, rootName) {
  const errors = [];
  const uses = relations(step, 'uses');
  if (uses.length !== 1) {
    errors.push(diagnostic(
      'PROGRAM_USES_REQUIRED',
      'Program 的每个直接 child 必须且只能有一个 uses partner',
      { path: step.path, count: uses.length }
    ));
    return { errors };
  }
  const capabilityAtom = resolveReference(matches, step, uses[0].object, rootName);
  if (!capabilityAtom) {
    errors.push(diagnostic(
      'PROGRAM_CAPABILITY_NOT_FOUND',
      `Program capability 不存在或不唯一：${uses[0].object}`,
      { path: step.path, object: uses[0].object }
    ));
    return { errors };
  }
  const capability = atomDetail(capabilityAtom.atom);
  if (!SUPPORTED_CAPABILITIES.has(capability)) {
    errors.push(diagnostic(
      'UNKNOWN_ATOM_ENGINE_CAPABILITY',
      `Program step 使用了未登记的能力：${capability}`,
      { path: step.path, capability }
    ));
    return { errors };
  }

  const inputs = {};
  const alternative = (directVerb, resultVerb) => compileInput(
    exactlyOneAlternative(step, directVerb, resultVerb, errors),
    step,
    stepIndex,
    stepRecords,
    matches,
    rootName,
    errors
  );
  const direct = (verb) => compileInput(
    exactlyOne(step, verb, errors),
    step,
    stepIndex,
    stepRecords,
    matches,
    rootName,
    errors
  );

  if (capability === PROGRAM_CAPABILITIES.READ_DETAIL) {
    inputs.source = alternative('source', 'source-result');
  } else if (capability === PROGRAM_CAPABILITIES.FOLLOW_PARTNER) {
    inputs.source = alternative('source', 'source-result');
    inputs.verb = direct('verb');
  } else if (capability === PROGRAM_CAPABILITIES.GUARD_NON_EMPTY) {
    inputs.value = alternative('value', 'value-result');
  } else if (capability === PROGRAM_CAPABILITIES.GUARD_EQUALS) {
    inputs.value = alternative('value', 'value-result');
    inputs.expected = alternative('expected', 'expected-result');
  } else if (capability === PROGRAM_CAPABILITIES.REPLACE_DETAIL) {
    inputs.target = alternative('target', 'target-result');
    inputs.value = alternative('value', 'value-result');
  } else if (capability === PROGRAM_CAPABILITIES.CREATE_CHILD) {
    inputs.target = alternative('target', 'target-result');
    inputs.value = alternative('value', 'value-result');
  }

  return { capability, inputs, errors };
}

/**
 * Compiles every name@program Atom in one candidate graph. Compilation is
 * read-only and is intended to run before either active JSON file is written.
 */
export function compilePrograms(atoms, options = {}) {
  const rootName = options.rootName ?? 'atom.json';
  const matches = walkAtoms(atoms);
  const programs = [];
  const errors = [];
  for (const program of matches.filter((match) => isProgram(match.atom))) {
    const pythonSource = typeof atomDetail(program.atom) === 'string'
      && atomDetail(program.atom).trim().length > 0;
    const stepAtoms = pythonSource ? [] : directChildren(program.atom);
    const stepRecords = stepAtoms.map((atom) => (
      matches.find((match) => match.atom === atom)
    ));
    const steps = stepRecords.map((step, index) => (
      compileStep(step, index, stepRecords, matches, rootName)
    ));
    const programErrors = steps.flatMap((step) => step.errors);
    errors.push(...programErrors);
    programs.push({
      atom: program.atom,
      name: atomName(program.atom),
      path: program.path,
      runtime: pythonSource ? 'python' : 'steps',
      errors: programErrors,
      steps: steps.map((step, index) => ({
        ...step,
        atom: stepRecords[index].atom,
        name: atomName(stepRecords[index].atom),
        path: stepRecords[index].path
      }))
    });
  }
  return { ok: errors.length === 0, programs, errors };
}

function resultValue(result, input, matches) {
  if (input.kind === 'result') {
    const completed = result[input.stepIndex];
    if (completed?.kind !== 'atom') return completed;
    const current = matches.find((match) => match.path === completed.path);
    return current
      ? { kind: 'atom', path: current.path, atom: current.atom }
      : completed;
  }
  const target = matches.find((match) => match.path === input.targetPath);
  return { kind: 'atom', path: target.path, atom: target.atom };
}

function requireAtomResult(value, step, inputName) {
  if (value?.kind !== 'atom') {
    return {
      error: diagnostic(
        'INVALID_PROGRAM_RESULT',
        `${inputName} 必须取得 Atom 结果`,
        { path: step.path, resultKind: value?.kind ?? null }
      )
    };
  }
  return { value };
}

function detailResult(value, step, inputName) {
  if (value?.kind === 'value' && typeof value.value === 'string') return { value: value.value };
  if (value?.kind === 'atom' && typeof atomDetail(value.atom) === 'string') {
    return { value: atomDetail(value.atom) };
  }
  return {
    error: diagnostic(
      'INVALID_PROGRAM_RESULT',
      `${inputName} 必须取得字符串正文或 Atom`,
      { path: step.path, resultKind: value?.kind ?? null }
    )
  };
}

function atomToNormalized(atom) {
  const fields = [];
  for (const [rawKey, value] of Object.entries(atom)) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    fields.push({
      ...parsed,
      commands: [],
      valuePresent: true,
      value: parsed.baseKey === 'children' && Array.isArray(value)
        ? value.map((item) => (
          item && typeof item === 'object' && !Array.isArray(item)
            ? { kind: 'graph-object', fields: atomToNormalized(item).fields }
            : structuredClone(item)
        ))
        : structuredClone(value)
    });
  }
  return { kind: 'graph-object', fields };
}

function transformItemForDetail(targetPath, value) {
  return {
    fields: [
      { baseKey: 'name', valuePresent: true, value: targetPath, commands: [] },
      {
        baseKey: 'detail',
        valuePresent: false,
        commands: [{ name: 'rep', parameter: value }]
      }
    ]
  };
}

function transformItemForChild(targetPath, child) {
  return {
    fields: [
      { baseKey: 'name', valuePresent: true, value: targetPath, commands: [] },
      {
        baseKey: 'children',
        valuePresent: true,
        commands: [],
        value: [atomToNormalized(child)]
      }
    ]
  };
}

function selectProgram(compiled, selector) {
  const byPath = compiled.programs.filter((program) => program.path === selector);
  if (byPath.length === 1) return { program: byPath[0] };
  const byName = compiled.programs.filter((program) => program.name === selector);
  if (byName.length === 1) return { program: byName[0] };
  return {
    error: diagnostic(
      byName.length ? 'AMBIGUOUS_ATOM_NAME' : 'PROGRAM_NOT_FOUND',
      byName.length
        ? `Program 名称不唯一：${selector}`
        : `找不到已编译 Program：${selector}`,
      { selector, paths: byName.map((program) => program.path) }
    )
  };
}

/**
 * Executes one compiled Program on private in-memory copies. Mutating
 * capabilities are translated into normalized Transform items and delegated to
 * applyTransform; this function performs no persistence.
 */
export async function executeProgram({
  atoms,
  selector,
  contextFile,
  authorize = async () => ({ decision: 'allow' })
}) {
  const rootName = path.basename(contextFile);
  const compiled = compilePrograms(atoms, { rootName });
  if (!compiled.ok) return { error: compiled.errors[0], errors: compiled.errors };
  const selected = selectProgram(compiled, selector);
  if (selected.error) return selected;

  let working = structuredClone(atoms);
  const results = [];
  const changes = [];
  for (const [index, step] of selected.program.steps.entries()) {
    const currentCompiled = compilePrograms(working, { rootName });
    if (!currentCompiled.ok) {
      return { error: currentCompiled.errors[0], errors: currentCompiled.errors };
    }
    const currentProgram = currentCompiled.programs.find((program) => (
      program.path === selected.program.path
    ));
    const currentStep = currentProgram.steps[index];
    const matches = walkAtoms(working);
    const input = (name) => resultValue(results, currentStep.inputs[name], matches);

    if (currentStep.capability === PROGRAM_CAPABILITIES.READ_DETAIL) {
      const source = requireAtomResult(input('source'), currentStep, 'source');
      if (source.error) return source;
      if ((await authorize(source.value, 'read')).decision !== 'allow') {
        return { error: diagnostic('PROGRAM_ACCESS_DENIED', 'Program 无权读取目标；请反馈派发方') };
      }
      results.push({ kind: 'value', value: atomDetail(source.value.atom) });
      continue;
    }
    if (currentStep.capability === PROGRAM_CAPABILITIES.FOLLOW_PARTNER) {
      const source = requireAtomResult(input('source'), currentStep, 'source');
      const verb = detailResult(input('verb'), currentStep, 'verb');
      if (source.error) return source;
      if (verb.error) return verb;
      if ((await authorize(source.value, 'read')).decision !== 'allow') {
        return { error: diagnostic('PROGRAM_ACCESS_DENIED', 'Program 无权读取关系；请反馈派发方') };
      }
      const sourceRecord = matches.find((match) => match.path === source.value.path);
      let targets = atomPartners(source.value.atom)
        .filter((partner) => partner.verb === verb.value)
        .map((partner) => resolveReference(matches, sourceRecord, partner.object, rootName))
        .filter(Boolean);
      const visibleTargets = [];
      for (const target of targets) {
        if ((await authorize(target, 'read')).decision === 'allow') visibleTargets.push(target);
      }
      targets = visibleTargets;
      if (targets.length !== 1) {
        return {
          error: diagnostic(
            targets.length ? 'AMBIGUOUS_PROGRAM_PARTNER' : 'PROGRAM_PARTNER_REQUIRED',
            'follow-partner 要求来源 Atom 在指定 verb 上恰有一个目标',
            { path: currentStep.path, source: source.value.path, verb: verb.value }
          )
        };
      }
      results.push({ kind: 'atom', path: targets[0].path, atom: targets[0].atom });
      continue;
    }
    if (currentStep.capability === PROGRAM_CAPABILITIES.GUARD_NON_EMPTY) {
      const value = detailResult(input('value'), currentStep, 'value');
      if (value.error) return value;
      if (value.value === '') {
        return {
          error: diagnostic(
            'PROGRAM_GUARD_REJECTED',
            'guard-non-empty 拒绝了空正文',
            { path: currentStep.path }
          )
        };
      }
      results.push({ kind: 'value', value: value.value });
      continue;
    }
    if (currentStep.capability === PROGRAM_CAPABILITIES.GUARD_EQUALS) {
      const value = detailResult(input('value'), currentStep, 'value');
      const expected = detailResult(input('expected'), currentStep, 'expected');
      if (value.error) return value;
      if (expected.error) return expected;
      if (value.value !== expected.value) {
        return {
          error: diagnostic(
            'PROGRAM_GUARD_REJECTED',
            'guard-equals 拒绝了不相等的正文',
            { path: currentStep.path }
          )
        };
      }
      results.push({ kind: 'value', value: value.value });
      continue;
    }
    if (currentStep.capability === PROGRAM_CAPABILITIES.REPLACE_DETAIL) {
      const target = requireAtomResult(input('target'), currentStep, 'target');
      const value = detailResult(input('value'), currentStep, 'value');
      if (target.error) return target;
      if (value.error) return value;
      if ((await authorize(target.value, 'write')).decision !== 'allow') {
        return { error: diagnostic('PROGRAM_ACCESS_DENIED', 'Program 无权改造目标；请反馈派发方') };
      }
      const transformed = await applyTransform({
        atoms: working,
        contextFile,
        item: transformItemForDetail(target.value.path, value.value),
        authorize
      });
      if (transformed.error) return transformed;
      working = transformed.atoms;
      changes.push({ operation: 'replace-detail', target: target.value.path });
      results.push({ kind: 'value', value: value.value });
      continue;
    }
    if (currentStep.capability === PROGRAM_CAPABILITIES.CREATE_CHILD) {
      const target = requireAtomResult(input('target'), currentStep, 'target');
      const template = requireAtomResult(input('value'), currentStep, 'value');
      if (target.error) return target;
      if (template.error) return template;
      if ((await authorize(target.value, 'write')).decision !== 'allow'
        || (await authorize(template.value, 'read')).decision !== 'allow') {
        return { error: diagnostic('PROGRAM_ACCESS_DENIED', 'Program 无权读取模板或改造目标；请反馈派发方') };
      }
      const transformed = await applyTransform({
        atoms: working,
        contextFile,
        item: transformItemForChild(target.value.path, template.value.atom),
        authorize
      });
      if (transformed.error) return transformed;
      working = transformed.atoms;
      const childPath = `${target.value.path}/${atomName(template.value.atom)}`;
      const created = walkAtoms(working).find((match) => match.path === childPath);
      changes.push({ operation: 'create-child', target: target.value.path, child: childPath });
      results.push({ kind: 'atom', path: childPath, atom: created.atom });
    }
  }

  const validated = compilePrograms(working, { rootName });
  if (!validated.ok) return { error: validated.errors[0], errors: validated.errors };
  return {
    atoms: working,
    resultName: selected.program.name,
    resultPath: selected.program.path,
    summary: {
      program: selected.program.path,
      executedSteps: selected.program.steps.length,
      changes: changes.length
    },
    changes
  };
}
