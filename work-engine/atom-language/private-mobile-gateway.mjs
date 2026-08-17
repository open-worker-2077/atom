#!/usr/bin/env node
import process from 'node:process';

import { startPrivateMobileGateway } from '../../src/atom-system/adapters/private-mobile-gateway.mjs';

function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  return argv[index + 1];
}

const argv = process.argv.slice(2);
const allowedLogin = option(argv, '--allowed-login', process.env.ATOM_PRIVATE_ALLOWED_TAILSCALE_LOGIN);
const allowedSource = option(argv, '--allowed-source', process.env.ATOM_PRIVATE_ALLOWED_TAILSCALE_SOURCE);
if (!allowedLogin && !allowedSource) {
  process.stderr.write('An allowed Tailscale login or source address is required\n');
  process.exitCode = 2;
} else {
  const running = await startPrivateMobileGateway({
    allowedLogins: allowedLogin ? [allowedLogin] : undefined,
    allowedRemoteAddresses: allowedSource ? [allowedSource] : undefined,
    targetUrl: option(argv, '--target', 'http://127.0.0.1:4784'),
    host: option(argv, '--host', '127.0.0.1'),
    port: option(argv, '--port', 4785)
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    host: running.host,
    port: running.port,
    targetUrl: running.targetUrl
  })}\n`);

  const stop = async () => {
    await running.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
