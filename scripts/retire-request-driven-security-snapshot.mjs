#!/usr/bin/env node
import fs from 'node:fs/promises';

import { createTrustedRequestDrivenSecurityRetirementPersistence } from '../src/atom-system/adapters/trusted-request-driven-security-retirement-persistence.mjs';
import {
  applyRequestDrivenSecurityRetirement,
  planRequestDrivenSecurityRetirement,
  rollbackRequestDrivenSecurityRetirement
} from '../src/atom-system/operations/retire-request-driven-security-snapshot.mjs';

function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function argumentsOf(argv) {
  const result = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--apply') {
      result.apply = true;
      continue;
    }
    if (!['--sidecar', '--state-directory', '--request', '--rollback'].includes(key)
      || index + 1 >= argv.length) {
      throw problem(
        'REQUEST_DRIVEN_SECURITY_RETIREMENT_CLI_INVALID',
        'CLI arguments are invalid'
      );
    }
    result[key.slice(2).replaceAll('-', '_')] = argv[index += 1];
  }
  if (!result.sidecar || !result.state_directory
    || Boolean(result.rollback) === Boolean(result.request)) {
    throw problem(
      'REQUEST_DRIVEN_SECURITY_RETIREMENT_CLI_INVALID',
      'Explicit sidecar, private state directory, and exactly one action are required'
    );
  }
  return result;
}

async function main() {
  const args = argumentsOf(process.argv.slice(2));
  const persistence = createTrustedRequestDrivenSecurityRetirementPersistence({
    file: args.sidecar,
    stateDirectory: args.state_directory
  });
  if (args.rollback) {
    const receipt = JSON.parse(await fs.readFile(args.rollback, 'utf8'));
    return rollbackRequestDrivenSecurityRetirement({ receipt, persistence });
  }
  const request = JSON.parse(await fs.readFile(args.request, 'utf8'));
  const sourceBytes = await fs.readFile(args.sidecar);
  const plan = planRequestDrivenSecurityRetirement({ sourceBytes, request });
  if (!args.apply) {
    return {
      contract: plan.contract,
      version: plan.version,
      operationId: plan.operationId,
      status: 'planned',
      sourceHash: plan.sourceHash,
      targetHash: plan.targetHash,
      retired: plan.retired
    };
  }
  return applyRequestDrivenSecurityRetirement({ plan, persistence });
}

main().then((result) => {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}).catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: { code: error.code ?? 'ERROR', message: error.message }
  })}\n`);
  process.exitCode = 1;
});
