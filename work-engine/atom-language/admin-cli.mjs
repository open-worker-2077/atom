#!/usr/bin/env node
import process from 'node:process';

import { createRuntimeCliExecutor } from '../../src/atom-system/adapters/runtime-cli-executor.mjs';
import { issueWorldAgentSession } from './admin.mjs';
import { runAtomCli } from './cli.mjs';
import { assertMaintenanceToken, resolveAtomRuntime } from './runtime-config.mjs';

function parseIssue(argv) {
  const windows = [];
  const keys = [];
  let hours = 8;
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--window') {
      windows.push(value);
      index += 1;
    } else if (argument === '--key') {
      keys.push(JSON.parse(value));
      index += 1;
    } else if (argument === '--hours') {
      hours = Number(value);
      index += 1;
    } else {
      const error = new Error(`未知 session issue 参数：${argument}`);
      error.code = 'UNKNOWN_ADMIN_OPTION';
      throw error;
    }
  }
  if (!Number.isFinite(hours) || hours <= 0) {
    const error = new Error('--hours 必须是正数');
    error.code = 'INVALID_SESSION_HOURS';
    throw error;
  }
  return { windows, keys, hours };
}

const runtime = resolveAtomRuntime();
try {
  const signingKey = await assertMaintenanceToken(runtime, process.env.ATOM_MAINTENANCE_TOKEN);
  if (process.argv[2] === 'session' && process.argv[3] === 'issue') {
    const parsed = parseIssue(process.argv.slice(2));
    const issued = await issueWorldAgentSession({
      contextFile: runtime.contextFile,
      sessionsDirectory: runtime.sessionsDirectory,
      signingKey,
      windows: parsed.windows,
      keys: parsed.keys,
      expiresAt: new Date(Date.now() + parsed.hours * 60 * 60 * 1000).toISOString()
    });
    process.stdout.write(`${JSON.stringify({ token: issued.token, windows: issued.session.windows })}\n`);
  } else {
    const execute = createRuntimeCliExecutor({
      contextFile: runtime.contextFile,
      graphFile: runtime.graphFile,
      storeFile: runtime.storeFile
    });
    process.exitCode = await runAtomCli([
      '--context', runtime.contextFile,
      '--projection', runtime.graphFile,
      ...process.argv.slice(2)
    ], { maintenance: true, execute });
  }
} catch (error) {
  process.stderr.write(`错误 ${error.code || 'ATOM_ADMIN_ERROR'}：${error.message}\n`);
  process.exitCode = 4;
}
