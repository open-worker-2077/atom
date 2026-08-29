#!/usr/bin/env node
import process from 'node:process';

import { createRuntimeCliExecutor } from '../../src/atom-system/adapters/runtime-cli-executor.mjs';
import { runAtomCli } from './cli.mjs';
import { assertMaintenanceToken, resolveAtomRuntime } from './runtime-config.mjs';

const runtime = resolveAtomRuntime();
try {
  await assertMaintenanceToken(runtime, process.env.ATOM_MAINTENANCE_TOKEN);
  const execute = createRuntimeCliExecutor({
    contextFile: runtime.contextFile,
    graphFile: runtime.graphFile,
    storeFile: runtime.storeFile,
    trustedMaintenance: true
  });
  process.exitCode = await runAtomCli([
    '--context', runtime.contextFile,
    '--projection', runtime.graphFile,
    ...process.argv.slice(2)
  ], { maintenance: true, execute });
} catch (error) {
  process.stderr.write(`错误 ${error.code || 'ATOM_GLOBAL_ERROR'}：${error.message}\n`);
  process.exitCode = 4;
}
