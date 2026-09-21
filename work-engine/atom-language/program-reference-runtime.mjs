import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'program-worker.py');

export function normalizeProgramReferences({ source, sourceHash, referenceSites, worldBindings }) {
  const actualHash = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  if (sourceHash !== actualHash) {
    throw Object.assign(new Error('Program reference AST does not match its source'), {
      code: 'PROGRAM_REFERENCE_SOURCE_MISMATCH'
    });
  }
  const boundSites = referenceSites.map((site) => {
    const rooted = site.selector.startsWith('世界之外/');
    const selector = rooted ? site.selector.slice('世界之外/'.length) : site.selector;
    const matches = worldBindings.filter(({ path }) => rooted
      ? path === selector
      : path === selector || path.endsWith(`/${selector}`));
    if (matches.length !== 1) {
      throw Object.assign(new Error(`Program reference must resolve uniquely: ${site.selector}`), {
        code: matches.length ? 'AMBIGUOUS_PROGRAM_REFERENCE' : 'PROGRAM_REFERENCE_NOT_FOUND',
        details: { selector: site.selector, role: site.role, matches: matches.map(({ path }) => path) }
      });
    }
    const target = matches[0];
    const needsRoot = rooted || worldBindings.some(({ path }) => path !== target.path && path.endsWith(`/${target.path}`));
    const exactPath = needsRoot ? `世界之外/${target.path}` : target.path;
    return { ...site, targetThingId: target.id, exactPath };
  });
  return { source: patchProgramSites(source, boundSites), sourceHash, referenceSites: boundSites };
}

function patchProgramSites(source, sites, { compile = false } = {}) {
  const encoded = Buffer.from(source, 'utf8');
  const patches = [];
  const literals = new Map();
  for (const site of sites) {
    const exactPath = site.exactPath;
    const { startByte, endByte } = site;
    if (!Number.isInteger(startByte) || !Number.isInteger(endByte)
      || startByte < 0 || endByte <= startByte || endByte > encoded.length) {
      throw Object.assign(new Error('Invalid Program reference byte range'), { code: 'INVALID_PROGRAM_REFERENCE_SITE' });
    }
    if (site.selector !== exactPath) {
      const key = `${startByte}:${endByte}`;
      const literal = literals.get(key) ?? {
        value: site.literalValue ?? site.selector,
        tokens: site.literalTokens ?? [{ startByte, endByte }],
        changes: []
      };
      literal.changes.push({ start: site.selectorStart ?? 0,
        end: site.selectorEnd ?? Array.from(literal.value).length, replacement: exactPath });
      literals.set(key, literal);
    }
    if (compile && site.kind === 'ref') {
      // Remove the marker expression tokens, retaining call parentheses and every comment.
      for (const token of site.markerTokens) patches.push({ ...token, replacement: Buffer.alloc(0) });
    }
  }
  for (const literal of literals.values()) {
    const characters = Array.from(literal.value);
    for (const change of literal.changes.sort((a, b) => b.start - a.start)) {
      characters.splice(change.start, change.end - change.start, ...change.replacement);
    }
    // Keep all token boundaries, comments and intervening whitespace intact.
    for (const [index, token] of literal.tokens.entries()) {
      const original = encoded.subarray(token.startByte, token.endByte).toString('utf8');
      const quote = original.match(/^[uUrR]*('''|"""|'|")/u)?.[1] ?? '"';
      const inner = JSON.stringify(index === 0 ? characters.join('') : '').slice(1, -1)
        .replace(/\\"/gu, '"').replace(new RegExp(quote[0], 'gu'), `\\${quote[0]}`);
      patches.push({ ...token, replacement: Buffer.from(`${quote}${inner}${quote}`, 'utf8') });
    }
  }
  let normalized = encoded;
  for (const patch of patches.sort((a, b) => b.startByte - a.startByte)) {
    normalized = Buffer.concat([normalized.subarray(0, patch.startByte), patch.replacement, normalized.subarray(patch.endByte)]);
  }
  return normalized.toString('utf8');
}

function runReferenceWorker(request, { python = 'python', timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-X', 'utf8', workerFile], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error('Program reference operation timed out'), {
        code: 'PROGRAM_REFERENCE_OPERATION_TIMEOUT'
      }));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(Object.assign(new Error(stderr || `Python worker exited ${code}`), {
          code: 'PROGRAM_REFERENCE_OPERATION_FAILED'
        }));
        return;
      }
      const result = JSON.parse(stdout.trim());
      if (!result.ok) {
        reject(Object.assign(new Error(result.error?.message ?? 'Program reference operation failed'), {
          code: result.error?.code ?? 'PROGRAM_REFERENCE_OPERATION_FAILED'
        }));
        return;
      }
      resolve(result);
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

export async function inspectProgramReferenceSites({
  source, programPath = '<atom-program>', python = 'python', timeoutMs = 10_000
}) {
  const result = await runReferenceWorker({
    operation: 'inspect-references', source, path: programPath
  }, { python, timeoutMs });
  return Object.freeze({
    sourceHash: result.sourceHash,
    sites: Object.freeze(result.sites.map((site) => Object.freeze(site)))
  });
}

export async function rewriteProgramReferenceBatch({
  programs, aliases, worldBindings, python = 'python', timeoutMs = 10_000
}) {
  const result = await runReferenceWorker({
    operation: 'rewrite-reference-batch', programs, aliases, worldBindings
  }, { python, timeoutMs });
  return result.programs;
}

// Bindings are kernel metadata supplied by the caller; selectors never resolve identities here.
export async function compileProgramRefs({ source, bindings, pathByThingId, sourceHash, referenceSites }) {
  const inspected = referenceSites ? { sourceHash, sites: referenceSites } : await inspectProgramReferenceSites({ source });
  const actualHash = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  if ((sourceHash && sourceHash !== actualHash) || inspected.sourceHash !== actualHash) {
    throw Object.assign(new Error('Program 引述 source does not match its binding analysis'), { code: 'PROGRAM_REF_SOURCE_MISMATCH' });
  }
  const sites = inspected.sites.map((site) => {
    const matches = (bindings ?? []).filter(binding => binding.fingerprint === site.fingerprint && binding.role === site.role);
    if (matches.length !== 1) throw Object.assign(new Error('Program 引述 binding is missing'), { code: 'PROGRAM_REF_BINDING_MISSING' });
    const targetThingId = matches[0].targetThingId;
    const exactPath = pathByThingId instanceof Map ? pathByThingId.get(targetThingId) : pathByThingId?.[targetThingId];
    if (typeof exactPath !== 'string' || !exactPath) throw Object.assign(new Error('Program 引述 target is missing'), { code: 'PROGRAM_REF_TARGET_MISSING' });
    return { ...site, exactPath };
  });
  return { source: patchProgramSites(source, sites, { compile: true }), sourceHash: actualHash };
}

export const inspectProgramRefSites = inspectProgramReferenceSites;
