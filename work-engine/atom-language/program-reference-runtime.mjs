import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'program-worker.py');

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
