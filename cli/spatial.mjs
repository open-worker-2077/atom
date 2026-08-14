#!/usr/bin/env node
import { runSpatialCli } from './lib/cli-app.mjs';
import { VERSION } from './lib/version.mjs';

process.exitCode = await runSpatialCli(process.argv.slice(2), { version: VERSION });
