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
  const encoded = Buffer.from(source, 'utf8');
  const patches = [];
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
    const { startByte, endByte } = site;
    if (!Number.isInteger(startByte) || !Number.isInteger(endByte)
      || startByte < 0 || endByte <= startByte || endByte > encoded.length) {
      throw Object.assign(new Error('Invalid Program reference byte range'), { code: 'INVALID_PROGRAM_REFERENCE_SITE' });
    }
    if (site.selector !== exactPath) {
      const literal = encoded.subarray(startByte, endByte).toString('utf8');
      const quote = literal.match(/^[uUrR]*('''|"""|'|")/u)?.[1] ?? '"';
      // Drop raw prefixes when escaping is needed; preserve the quote delimiter.
      const inner = JSON.stringify(exactPath).slice(1, -1)
        .replace(/\\"/gu, '"').replace(new RegExp(quote[0], 'gu'), `\\${quote[0]}`);
      patches.push({ startByte, endByte, replacement: Buffer.from(`${quote}${inner}${quote}`, 'utf8') });
    }
    return { ...site, targetThingId: target.id, exactPath };
  });
  let normalized = encoded;
  for (const patch of patches.sort((a, b) => b.startByte - a.startByte)) {
    normalized = Buffer.concat([normalized.subarray(0, patch.startByte), patch.replacement, normalized.subarray(patch.endByte)]);
  }
  return { source: normalized.toString('utf8'), sourceHash, referenceSites: boundSites };
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
