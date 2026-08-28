import { spawn } from 'node:child_process';

function evidenceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function defaultExecute({ args, stdin }) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'atom.cmd';
    const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'atom.cmd', ...args] : args;
    const child = spawn(command, commandArgs, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(Object.assign(
      new Error(stderr || `atom.cmd exited ${code}`), { code, exitCode: code, stdout, stderr }
    )));
    child.stdin.end(stdin);
  });
}

export function createAtomCliAdapter({ execute = defaultExecute } = {}) {
  return {
    async validateHelp() {
      const result = await execute({ args: ['--help'] });
      if (!/--agent\s+AGENT/u.test(result.stdout) || !/--stdin/u.test(result.stdout)) {
        const error = new Error('Atom CLI Help lacks the night-watch contract');
        error.code = 'NIGHT_WATCH_CLI_CONTRACT_INCOMPATIBLE';
        throw error;
      }
      return result;
    },
    async resolveExactAgent(agent) {
      const result = await execute({ args: ['--agent', agent, '--stdin'], stdin: 'atom\n' });
      const escapedAgent = agent.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      if (!(new RegExp(`"agent~current"\\s*:\\s*"${escapedAgent}"`, 'u')).test(result.stdout)) {
        const error = new Error('Atom CLI did not resolve the exact authorized Agent');
        error.code = 'NIGHT_WATCH_AGENT_NOT_EXACT';
        throw error;
      }
      return result;
    },
    async executeStdin(agent, source) {
      try {
        return await execute({ args: ['--agent', agent, '--stdin'], stdin: `${source}\n` });
      } catch (error) {
        const receipt = typeof error?.stdout === 'string' && error.stdout.trim()
          ? error.stdout
          : (typeof error?.stderr === 'string' && error.stderr.trim() ? error.stderr : null);
        if (receipt) {
          return { stdout: receipt, stderr: error.stderr ?? '', exitCode: error.exitCode ?? error.code };
        }
        throw error;
      }
    },
    async executeVerified(agent, source, { verifier, evidenceId } = {}) {
      if (typeof verifier !== 'function' || typeof evidenceId !== 'string' || !evidenceId) {
        throw evidenceError('NIGHT_WATCH_CLI_EVIDENCE_INVALID', 'Verified CLI execution requires a verifier and evidence id');
      }
      const result = await execute({ args: ['--agent', agent, '--stdin'], stdin: `${source}\n` });
      if (typeof result.stdout !== 'string' || !result.stdout.trim()) {
        throw evidenceError('NIGHT_WATCH_CLI_EVIDENCE_MISSING', 'Public CLI returned no receipt evidence');
      }
      if (!verifier(result.stdout)) {
        throw evidenceError('NIGHT_WATCH_CLI_EVIDENCE_MISMATCH', 'Public CLI receipt did not satisfy the expected proof');
      }
      return {
        result,
        evidence: { id: evidenceId, transport: 'public-cli-stdin', outcome: 'passed' }
      };
    }
  };
}
