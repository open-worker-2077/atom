import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GRAPH_GENERATIONS = Object.freeze([
  Object.freeze({
    id: '1.0',
    sourceByTarget: Object.freeze({ thing: 'name', situation: 'detail', slot: 'children', strut: 'partners' })
  }),
  Object.freeze({
    id: '2.0',
    sourceByTarget: Object.freeze({ thing: 'thing', situation: 'situation', slot: 'contain', strut: 'support' })
  })
]);
const RETIRED = Object.freeze(Object.fromEntries(GRAPH_GENERATIONS.flatMap(({ sourceByTarget }) => (
  Object.entries(sourceByTarget).map(([target, source]) => [source, target])
))));
const MIGRATION_INPUT_AXES = new Set([...Object.keys(RETIRED), 'slot', 'strut']);
const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), 'program-graph-abi-migration.py');

function problem(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(
    typeof value === 'string' ? value : JSON.stringify(value)
  ).digest('hex')}`;
}

function baseKey(rawKey) {
  return String(rawKey).match(/^[^@#$~]+/u)?.[0] ?? '';
}

function migratedKey(rawKey) {
  const base = baseKey(rawKey);
  return `${RETIRED[base]}${String(rawKey).slice(base.length)}`;
}

function fieldsOf(value, parentPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw problem('INVALID_LEGACY_GRAPH_NODE', '旧 Graph 节点必须是对象', { parent: parentPath.join('/') });
  }
  const fields = new Map();
  for (const [rawKey, fieldValue] of Object.entries(value)) {
    const base = baseKey(rawKey);
    if (!MIGRATION_INPUT_AXES.has(base)) {
      throw problem('UNKNOWN_LEGACY_GRAPH_FIELD', `旧 Graph 节点包含未知字段：${rawKey}`, {
        parent: parentPath.join('/'), rawKey
      });
    }
    if (fields.has(base)) {
      throw problem('DUPLICATE_LEGACY_GRAPH_AXIS', `旧 Graph 轴重复：${base}`, {
        parent: parentPath.join('/'), base
      });
    }
    fields.set(base, { rawKey, value: fieldValue });
  }
  if ((fields.has('slot') || fields.has('strut'))
    && (fields.has('contain') || fields.has('support'))) {
    throw problem('MIXED_GRAPH_AXIS_GENERATION', '同一持久 Atom 不得混用不同 Graph 轴世代', {
      parent: parentPath.join('/'), fields: [...fields.keys()]
    });
  }
  const generations = GRAPH_GENERATIONS.filter(({ sourceByTarget }) => (
    Object.values(sourceByTarget).every((required) => fields.has(required))
  ));
  if (generations.length !== 1 || fields.size !== 4) {
    const represented = GRAPH_GENERATIONS.filter(({ sourceByTarget }) => (
      Object.values(sourceByTarget).some((axis) => fields.has(axis))
    ));
    if (represented.length > 1) {
      throw problem('MIXED_GRAPH_AXIS_GENERATION', '同一持久 Atom 不得混用不同 Graph 轴世代', {
        parent: parentPath.join('/'), fields: [...fields.keys()]
      });
    }
    const generation = represented[0] ?? GRAPH_GENERATIONS[0];
    const required = Object.values(generation.sourceByTarget).find((axis) => !fields.has(axis));
    throw problem('MISSING_LEGACY_GRAPH_AXIS', `旧 Graph 缺少轴：${required}`, {
      parent: parentPath.join('/'), required
    });
  }
  return { fields, generation: generations[0] };
}

function analyzePrograms(programs, python) {
  if (!programs.length) return [];
  const child = spawnSync(python ?? 'python', ['-I', '-X', 'utf8', tool], {
    input: JSON.stringify({ programs }), encoding: 'utf8', windowsHide: true,
    maxBuffer: 32 * 1024 * 1024
  });
  if (child.error || child.status !== 0) {
    throw problem('GRAPH_PROGRAM_PREFLIGHT_FAILED', '旧 Program AST 预检失败', {
      cause: child.error?.code ?? child.status, stderr: child.stderr?.trim()
    });
  }
  try {
    return JSON.parse(child.stdout).programs;
  } catch (error) {
    throw problem('GRAPH_PROGRAM_PREFLIGHT_FAILED', '旧 Program AST 预检返回无效结果', {
      cause: error.message
    });
  }
}

function classificationAt(programPath, defaultBackupPath, testRoots) {
  if (defaultBackupPath
    && (programPath === defaultBackupPath || programPath.startsWith(`${defaultBackupPath}/`))) {
    return 'default-backup';
  }
  if (testRoots.some((root) => programPath === root || programPath.startsWith(`${root}/`))) {
    return 'configured-test-root';
  }
  return null;
}

export function planGraphFourAxisMigration(root, options = {}) {
  const testRoots = [...new Set(options.testRoots ?? [])];
  if (testRoots.some((value) => typeof value !== 'string' || !value.trim())) {
    throw problem('INVALID_GRAPH_MIGRATION_TEST_ROOT', 'Program test 分类根必须是非空 exact path');
  }
  const summary = {
    nodes: 0, struts: 0, situationBytes: 0, paths: [], typedNodes: [],
    strutEndpoints: [], programs: [], legacyRelations: [], legacyStrutSources: [],
    blockedPrograms: [], readyToCommit: false
  };
  const seen = new Set();
  const programs = [];
  let defaultBackupPath = null;

  function convert(value, parentPath = []) {
    const { fields, generation } = fieldsOf(value, parentPath);
    const field = (target) => fields.get(generation.sourceByTarget[target]);
    const thing = field('thing').value;
    const situation = field('situation').value;
    const children = field('slot').value;
    const partners = field('strut').value;
    if (typeof thing !== 'string' || !thing.trim() || typeof situation !== 'string'
      || !Array.isArray(children) || !Array.isArray(partners)) {
      throw problem('INVALID_LEGACY_GRAPH_AXES', '旧 Graph 四轴类型无效', { parent: parentPath.join('/') });
    }
    const pathParts = [...parentPath, thing];
    const pathText = pathParts.join('/');
    if (seen.has(pathText)) throw problem('DUPLICATE_LEGACY_GRAPH_PATH', `旧 Graph 路径重复：${pathText}`);
    seen.add(pathText);
    const thingKey = migratedKey(field('thing').rawKey);
    const types = thingKey.split('@').slice(1).map((part) => part.split('#')[0]);
    if (types.includes('backup') && types.includes('default')) {
      if (defaultBackupPath) {
        throw problem('AMBIGUOUS_DEFAULT_BACKUP', 'World contains multiple typed default backup roots', {
          paths: [defaultBackupPath, pathText]
        });
      }
      defaultBackupPath = pathText;
    }
    const situationKey = migratedKey(field('situation').rawKey);
    const converted = {
      [thingKey]: thing,
      [situationKey]: situation,
      slot: [],
      strut: structuredClone(partners)
    };
    summary.nodes += 1;
    summary.situationBytes += Buffer.byteLength(situation);
    summary.paths.push(pathText);
    if (types.length) summary.typedNodes.push({ path: pathText, key: thingKey });
    if (types.includes('program')) {
      programs.push({ path: pathText, source: situation, converted, thingKey, situationKey });
    }
    summary.struts += partners.length;
    for (const [ordinal, partner] of generation.id === '1.0' ? partners.entries() : []) {
      if (!partner || typeof partner !== 'object' || Array.isArray(partner)
        || typeof partner.object !== 'string' || !partner.object.trim()
        || typeof partner.verb !== 'string') {
        throw problem('INVALID_LEGACY_PARTNER', '旧 partner 必须包含字符串 verb 与 object', {
          source: pathText, ordinal
        });
      }
      summary.legacyRelations.push({ source: pathText, ordinal, verb: partner.verb, object: partner.object });
    }
    if (partners.length) {
      summary.legacyStrutSources.push({
        path: pathText,
        fingerprint: digest(partners),
        entries: partners.length
      });
    }
    converted.slot = children.map((child) => convert(child, pathParts));
    return converted;
  }

  const graph = Array.isArray(root) ? root.map((node) => convert(node)) : convert(root);
  const analyses = analyzePrograms(programs.map(({ path: programPath, source }) => ({
    path: programPath, source
  })), options.python);
  const analysisByPath = new Map(analyses.map((analysis) => [analysis.path, analysis]));
  const counts = {
    nodes: summary.nodes,
    legacyPartnerNodes: new Set(summary.legacyRelations.map(({ source }) => source)).size,
    legacyPartners: summary.legacyRelations.length,
    programs: programs.length,
    legacyAbiPrograms: 0,
    defaultBackupPrograms: 0,
    testLegacyPrograms: 0,
    activeLegacyPrograms: 0,
    upgradedPrograms: 0,
    blockedPrograms: 0
  };
  for (const program of programs) {
    const analysis = analysisByPath.get(program.path);
    const legacyAbi = analysis.uses.length > 0 || analysis.blockers.length > 0;
    if (legacyAbi) counts.legacyAbiPrograms += 1;
    const configuredReason = classificationAt(program.path, defaultBackupPath, testRoots);
    let disposition = configuredReason === 'configured-test-root' ? 'current-test' : 'current';
    let reason = 'current-abi';
    if (configuredReason === 'default-backup') {
      disposition = 'historical-non-executable';
      reason = configuredReason;
      if (legacyAbi) counts.defaultBackupPrograms += 1;
    } else if (analysis.blockers.length) {
      disposition = 'blocked';
      reason = 'program-source-upgrade-ambiguous';
      counts.blockedPrograms += 1;
      summary.blockedPrograms.push({
        path: program.path,
        sourceHash: analysis.sourceHashBefore,
        blockers: structuredClone(analysis.blockers)
      });
      if (configuredReason === 'configured-test-root') counts.testLegacyPrograms += 1;
      else counts.activeLegacyPrograms += 1;
    } else if (analysis.edits.length) {
      disposition = configuredReason === 'configured-test-root' ? 'upgraded-test' : 'upgraded';
      reason = 'ast-proven-graph-structure-edits';
      counts.upgradedPrograms += 1;
      if (configuredReason === 'configured-test-root') counts.testLegacyPrograms += 1;
      else counts.activeLegacyPrograms += 1;
      program.converted[program.situationKey] = analysis.migratedSource;
    } else if (legacyAbi) {
      counts.activeLegacyPrograms += 1;
    }
    summary.programs.push({
      path: program.path,
      sourceHash: analysis.sourceHashBefore,
      sourceHashBefore: analysis.sourceHashBefore,
      sourceHashAfter: analysis.sourceHashAfter,
      uses: analysis.uses, blockingAxes: analysis.blockingAxes,
      edits: analysis.edits, blockers: analysis.blockers,
      disposition, reason
    });
  }
  summary.counts = counts;
  summary.readyToCommit = summary.blockedPrograms.length === 0;
  summary.sourceFactsHash = digest(root);
  return { graph, summary };
}
