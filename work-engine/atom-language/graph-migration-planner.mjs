import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RETIRED = Object.freeze({ name: 'thing', detail: 'situation', children: 'contain', partners: 'support' });
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
    if (!Object.hasOwn(RETIRED, base)) {
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
  for (const required of Object.keys(RETIRED)) {
    if (!fields.has(required)) {
      throw problem('MISSING_LEGACY_GRAPH_AXIS', `旧 Graph 缺少轴：${required}`, {
        parent: parentPath.join('/'), required
      });
    }
  }
  return fields;
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

function reasonAt(programPath, defaultBackupPath, isolatedRoots) {
  if (defaultBackupPath
    && (programPath === defaultBackupPath || programPath.startsWith(`${defaultBackupPath}/`))) {
    return 'default-backup';
  }
  if (isolatedRoots.some((root) => programPath === root || programPath.startsWith(`${root}/`))) {
    return 'configured-isolation-root';
  }
  return null;
}

export function planGraphFourAxisMigration(root, options = {}) {
  const isolatedRoots = [...new Set(options.isolatedRoots ?? [])];
  if (isolatedRoots.some((value) => typeof value !== 'string' || !value.trim())) {
    throw problem('INVALID_GRAPH_MIGRATION_ISOLATION_ROOT', 'Program 隔离根必须是非空 exact path');
  }
  const summary = {
    nodes: 0, supports: 0, situationBytes: 0, paths: [], typedNodes: [],
    supportEndpoints: [], programs: [], legacyRelations: [], legacySupportSources: [],
    readyToCommit: false
  };
  const seen = new Set();
  const programs = [];
  let defaultBackupPath = null;

  function convert(value, parentPath = []) {
    const fields = fieldsOf(value, parentPath);
    const thing = fields.get('name').value;
    const situation = fields.get('detail').value;
    const children = fields.get('children').value;
    const partners = fields.get('partners').value;
    if (typeof thing !== 'string' || !thing.trim() || typeof situation !== 'string'
      || !Array.isArray(children) || !Array.isArray(partners)) {
      throw problem('INVALID_LEGACY_GRAPH_AXES', '旧 Graph 四轴类型无效', { parent: parentPath.join('/') });
    }
    const pathParts = [...parentPath, thing];
    const pathText = pathParts.join('/');
    if (seen.has(pathText)) throw problem('DUPLICATE_LEGACY_GRAPH_PATH', `旧 Graph 路径重复：${pathText}`);
    seen.add(pathText);
    const thingKey = migratedKey(fields.get('name').rawKey);
    const types = thingKey.split('@').slice(1).map((part) => part.split('#')[0]);
    if (types.includes('backup') && types.includes('default')) {
      if (defaultBackupPath) {
        throw problem('AMBIGUOUS_DEFAULT_BACKUP', 'World contains multiple typed default backup roots', {
          paths: [defaultBackupPath, pathText]
        });
      }
      defaultBackupPath = pathText;
    }
    const situationKey = migratedKey(fields.get('detail').rawKey);
    const converted = {
      [thingKey]: thing,
      [situationKey]: situation,
      contain: [],
      support: structuredClone(partners)
    };
    summary.nodes += 1;
    summary.situationBytes += Buffer.byteLength(situation);
    summary.paths.push(pathText);
    if (types.length) summary.typedNodes.push({ path: pathText, key: thingKey });
    if (types.includes('program')) {
      programs.push({ path: pathText, source: situation, converted, thingKey, situationKey });
    }
    for (const [ordinal, partner] of partners.entries()) {
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
      summary.legacySupportSources.push({
        path: pathText,
        fingerprint: digest(partners),
        entries: partners.length
      });
    }
    converted.contain = children.map((child) => convert(child, pathParts));
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
    testIsolatedPrograms: 0,
    activeLegacyPrograms: 0,
    activeIsolatedPrograms: 0
  };
  for (const program of programs) {
    const analysis = analysisByPath.get(program.path);
    const legacyAbi = analysis.uses.length > 0 || analysis.blockingAxes.includes('dynamic');
    if (legacyAbi) counts.legacyAbiPrograms += 1;
    const configuredReason = reasonAt(program.path, defaultBackupPath, isolatedRoots);
    let disposition = 'unchanged';
    let reason = 'current-abi';
    if (configuredReason) {
      disposition = 'isolated';
      reason = configuredReason;
      if (legacyAbi && reason === 'default-backup') counts.defaultBackupPrograms += 1;
      if (legacyAbi && reason === 'configured-isolation-root') counts.testIsolatedPrograms += 1;
    } else if (legacyAbi) {
      disposition = 'legacy-wrapper';
      reason = 'revision-path-source-manifest';
      counts.activeLegacyPrograms += 1;
    }
    summary.programs.push({
      path: program.path, sourceHash: analysis.sourceHash,
      uses: analysis.uses, blockingAxes: analysis.blockingAxes,
      disposition, reason
    });
  }
  summary.supports = summary.legacyRelations.length;
  summary.counts = counts;
  summary.readyToCommit = true;
  summary.sourceFactsHash = digest(root);
  return { graph, summary };
}
