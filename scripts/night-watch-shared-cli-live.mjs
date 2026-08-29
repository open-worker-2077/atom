#!/usr/bin/env node
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { validateNightWatchAuthorityReceipt } from './night-watch-authority.mjs';
import { createAtomCliAdapter } from './night-watch-cli-adapter.mjs';

const TEST_PREFIX = '🧊manage/工务/work/test/';
const execFileAsync = promisify(execFile);

function sharedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function parseSharedNightWatchOptions(argv) {
  const agent = option(argv, '--agent');
  const rootPath = option(argv, '--root');
  const evidenceDir = option(argv, '--evidence-dir');
  const authorityFile = option(argv, '--authority');
  const runId = typeof rootPath === 'string' && rootPath.startsWith(TEST_PREFIX)
    ? rootPath.slice(TEST_PREFIX.length)
    : '';
  if (agent !== '🧊manage' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(runId)
    || !evidenceDir || rootPath.includes('..')) {
    throw sharedError('NIGHT_WATCH_SHARED_SCOPE_INVALID', 'Shared night-watch requires the exact approved Agent and one bounded test run subtree');
  }
  return {
    agent,
    rootPath,
    runId,
    resume: argv.includes('--resume'),
    resumeAfterTransform: argv.includes('--resume-after-transform'),
    resumeAtJump: argv.includes('--resume-at-jump'),
    resumeAfterJump: argv.includes('--resume-after-jump'),
    resumeAfterRestart: argv.includes('--resume-after-restart'),
    verifyExisting: argv.includes('--verify-existing'),
    evidenceDir: path.resolve(evidenceDir),
    ...(authorityFile ? { authorityFile: path.resolve(authorityFile) } : {})
  };
}

export function assertSharedHealth(health) {
  const projectionStatus = health?.atomProjection?.status;
  if (health?.ok !== true || projectionStatus !== 'published') {
    throw sharedError('NIGHT_WATCH_SHARED_NOT_READY', 'Shared Atom runtime is not ready', { projectionStatus });
  }
  return {
    version: health.version,
    revision: health.atomProjection.revision ?? health.revision,
    projectionStatus
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function jsonReceipt(stdout) {
  try { return JSON.parse(stdout); } catch {
    throw sharedError('NIGHT_WATCH_SHARED_RECEIPT_INVALID', 'Public CLI returned a non-JSON receipt');
  }
}

function diagnosticCode(text) {
  return [...`${text}`.matchAll(/(?:提示|错误)\s+([A-Z][A-Z0-9_]+)/gu)].map((match) => match[1]);
}

function programAtom(thing, situation) {
  return { 'thing@program': thing, situation, contain: [], support: [] };
}

function agentProgram(thing, labels) {
  return {
    'thing@program@agent': thing,
    situation: `agent(${JSON.stringify({ labels, functions: { groups: [], names: [
      'agent', 'current_atom', 'explore', 'jump', 'lock', 'shortcut', 'slot_body', 'transform', 'use_program', 'work_order'
      , 'json_parse', 'message'
    ] } })})`,
    contain: [], support: []
  };
}

async function restartSharedRuntime(deadlineSeconds) {
  try { await execFileAsync('schtasks.exe', ['/End', '/TN', 'Atom Graph Runtime'], { windowsHide: true }); } catch {}
  const stoppedDeadline = Date.now() + Math.min(10000, deadlineSeconds * 500);
  while (Date.now() < stoppedDeadline) {
    try {
      await fetch('http://127.0.0.1:4784/__spatial/api/health');
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch { break; }
  }
  await execFileAsync('schtasks.exe', ['/Run', '/TN', 'Atom Graph Runtime'], { windowsHide: true });
  const deadline = Date.now() + deadlineSeconds * 1000;
  let lastError;
  let consecutive = 0;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:4784/__spatial/api/health');
      const health = assertSharedHealth(await response.json());
      consecutive += 1;
      if (consecutive >= 2) return health;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      lastError = error;
      consecutive = 0;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw sharedError('NIGHT_WATCH_SHARED_RESTART_TIMEOUT', 'Shared Atom runtime did not recover before the authority deadline', {
    cause: lastError?.code ?? lastError?.name
  });
}

async function main() {
  const options = parseSharedNightWatchOptions(process.argv.slice(2));
  if (!options.authorityFile) {
    throw sharedError('NIGHT_WATCH_SHARED_AUTHORITY_REQUIRED', 'Use --authority with the approved receipt JSON');
  }
  const authority = validateNightWatchAuthorityReceipt(
    JSON.parse(await fs.readFile(options.authorityFile, 'utf8')),
    { agent: options.agent }
  );
  if (authority.testDomain !== options.rootPath) {
    throw sharedError('NIGHT_WATCH_SHARED_AUTHORITY_MISMATCH', 'Authority test domain does not match the requested run subtree');
  }
  await fs.mkdir(options.evidenceDir, { recursive: true });
  const adapter = createAtomCliAdapter();
  const evidence = [];
  const record = async (id, action) => {
    const startedAt = new Date().toISOString();
    try {
      const result = await action();
      const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
      const entry = { id, status: 'passed', startedAt, endedAt: new Date().toISOString(), receiptHash: sha256(text), diagnostics: diagnosticCode(text) };
      evidence.push(entry);
      await fs.appendFile(path.join(options.evidenceDir, 'shared-cli-live-attempts.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
      return result;
    } catch (error) {
      const entry = { id, status: 'failed', startedAt, endedAt: new Date().toISOString(), errorCode: error.code ?? 'NIGHT_WATCH_SHARED_STEP_FAILED' };
      evidence.push(entry);
      await fs.appendFile(path.join(options.evidenceDir, 'shared-cli-live-attempts.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
      throw error;
    }
  };

  const initialHealth = await record('health.before', async () => {
    const response = await fetch('http://127.0.0.1:4784/__spatial/api/health');
    return { stdout: JSON.stringify(assertSharedHealth(await response.json())) };
  });
  await record('cli.help', () => adapter.validateHelp());
  await record('agent.exact', () => adapter.resolveExactAgent(options.agent));

  const runnerName = `nw-runner-${options.runId}`;
  const runnerPath = `${options.rootPath}/${runnerName}`;
  const runnerAgent = runnerPath;
  const noLabelName = `nw-none-${options.runId}`;
  const noLabelPath = `${options.rootPath}/${noLabelName}`;
  const noLabelAgent = noLabelPath;
  const destinationPath = `${options.rootPath}/destination`;
  const movedRunnerPath = `${destinationPath}/${runnerName}`;
  const movedRunnerAgent = movedRunnerPath;
  const fixture = {
    thing: options.rootPath,
    situation: 'Synthetic Atom night-watch run; no business facts.',
    contain: [
      agentProgram(runnerName, ['^']),
      { ...agentProgram(noLabelName, []), contain: [
        { thing: 'locked', situation: 'unchanged', contain: [], support: [] },
        programAtom('guard', `lock(${JSON.stringify({ targets: { paths: [`世界之外/${noLabelPath}/locked`], scope: 'exact' }, actions: ['transform'], labels: ['^'] })})`)
      ] },
      { thing: 'destination', situation: 'synthetic jump destination', contain: [], support: [] }
    ],
    support: []
  };
  if (options.resume) {
    await record('fixture.resume-readback', () => adapter.executeStdin(
      options.agent,
      `explore ${JSON.stringify({ thing: `世界之外/${options.rootPath}`, 'situation$full': true })}`
    ));
  } else {
    await record('fixture.create', () => adapter.executeStdin(options.agent, `transform new ${JSON.stringify(fixture)}`));
    await record('runner.register', () => adapter.executeStdin(options.agent, `transform ${JSON.stringify({ 'thing.run.': runnerPath })}`));
    await record('nolabel.register', () => adapter.executeStdin(options.agent, `transform ${JSON.stringify({ 'thing.run.': noLabelPath })}`));
  }
  await record('runner.resolve', () => adapter.resolveExactAgent(options.resumeAfterJump ? movedRunnerAgent : runnerAgent));

  if (options.verifyExisting) {
    const verifyRead = (id, thing, agent = movedRunnerAgent) => record(id, () => adapter.executeStdin(
      agent,
      `explore ${JSON.stringify({ thing: `世界之外/${thing}`, 'situation$full': true })}`
    ));
    const verifySituation = (id, thing, expected, agent = movedRunnerAgent) => record(id, async () => {
      const result = await adapter.executeStdin(agent, `explore ${JSON.stringify({ thing: `世界之外/${thing}`, 'situation$full': true })}`);
      if (jsonReceipt(result.stdout).situation !== expected) {
        throw sharedError('NIGHT_WATCH_SHARED_STATE_MISMATCH', `${id} did not match the expected persisted state`);
      }
      return result;
    });
    await verifySituation('verify.program-result', `${movedRunnerPath}/result`, 'passed');
    await verifySituation('verify.transform-result', `${movedRunnerPath}/transform`, 'after');
    await verifyRead('verify.shortcut', `${movedRunnerPath}/shortcut-program/entry`);
    await verifyRead('verify.slot-instance', `${movedRunnerPath}/slot-body/槽例/instance`);
    await verifyRead('verify.work-order', `${movedRunnerPath}/work-order-program/night-watch-order`);
    await record('verify.lock-denied', async () => {
      const result = await adapter.executeStdin(noLabelAgent, `transform {"thing":${JSON.stringify(`${noLabelPath}/locked`)},"situation.rep.must-not-change"}`);
      const text = `${result.stdout}\n${result.stderr}`;
      if (!text.includes('GRAPH_LOCK_DENIED')) throw sharedError('NIGHT_WATCH_SHARED_LOCK_NOT_ENFORCED', 'No-label verification write was not denied');
      return result;
    });
    await verifySituation('verify.lock-unchanged', `${noLabelPath}/locked`, 'unchanged', noLabelAgent);
  }

  if (!options.resumeAfterJump) {
  const transformPath = `${runnerPath}/transform`;
  if (!options.resumeAfterTransform) {
    const resultPath = `${runnerPath}/result`;
    const programPath = `${runnerPath}/program`;
    const resultProgram = programAtom(
      programPath,
      `transform({"thing":${JSON.stringify(resultPath)},"situation":"passed","contain":[],"support":[]})`
    );
    await record('program.create', () => adapter.executeStdin(
      runnerAgent,
      `transform new ${JSON.stringify(resultProgram)}`
    ));
    await record('program.run', () => adapter.executeStdin(runnerAgent, `transform ${JSON.stringify({ 'thing.run.': programPath })}`));
    await record('program.readback', async () => {
      const result = await adapter.executeStdin(runnerAgent, `explore ${JSON.stringify({ thing: `世界之外/${resultPath}`, 'situation$full': true })}`);
      if (jsonReceipt(result.stdout).situation !== 'passed') throw sharedError('NIGHT_WATCH_SHARED_PROGRAM_MISMATCH', 'Program result did not persist');
      return result;
    });

    await record('transform.create', () => adapter.executeStdin(runnerAgent, `transform new ${JSON.stringify({ thing: transformPath, situation: 'before', contain: [], support: [] })}`));
  }
  await record('transform.update', () => adapter.executeStdin(runnerAgent, `transform {"thing":${JSON.stringify(transformPath)},"situation.rep.after"}`));
  await record('transform.readback', async () => {
    const result = await adapter.executeStdin(runnerAgent, `explore ${JSON.stringify({ thing: `世界之外/${transformPath}`, 'situation$full': true })}`);
    if (jsonReceipt(result.stdout).situation !== 'after') throw sharedError('NIGHT_WATCH_SHARED_TRANSFORM_MISMATCH', 'Transform result did not persist');
    return result;
  });

  if (!options.resumeAtJump) {
    await record('lock.activate', () => adapter.executeStdin(noLabelAgent, `transform ${JSON.stringify({ 'thing.run.': `${noLabelPath}/guard` })}`));
    await record('lock.denied', async () => {
      const result = await adapter.executeStdin(noLabelAgent, `transform ${JSON.stringify({ thing: `${noLabelPath}/locked`, 'situation.rep.changed': true })}`);
      const text = `${result.stdout}\n${result.stderr}`;
      if (!text.includes('GRAPH_LOCK_DENIED')) throw sharedError('NIGHT_WATCH_SHARED_LOCK_NOT_ENFORCED', 'No-label write was not denied');
      return result;
    });

    const shortcutProgramPath = `${runnerPath}/shortcut-program`;
    const shortcutTargetPath = `${shortcutProgramPath}/target`;
    await record('shortcut.create', () => adapter.executeStdin(runnerAgent, `transform new ${JSON.stringify({
      ...programAtom(shortcutProgramPath, `target = explore({"thing":${JSON.stringify(shortcutTargetPath)}})[0]\nshortcut({"placement":"contain","thing":"entry","target":target})`),
      contain: [{ thing: 'target', situation: 'authoritative', contain: [], support: [] }]
    })}`));
    await record('shortcut.run', () => adapter.executeStdin(runnerAgent, `transform ${JSON.stringify({ 'thing.run.': shortcutProgramPath })}`));
    await record('shortcut.readback', () => adapter.executeStdin(runnerAgent, `explore ${JSON.stringify({ thing: `世界之外/${shortcutProgramPath}/entry`, 'situation$full': true })}`));
  }

  const jumpSuite = `${runnerPath}/jump-suite`;
  const jumpWhen = `${jumpSuite}/when`;
  const jumpWhere = `${jumpSuite}/where`;
  const jumpRegister = `${jumpSuite}/register`;
  await record('jump.programs.create', () => adapter.executeStdin(runnerAgent, `transform new ${JSON.stringify({
    thing: jumpSuite, situation: 'synthetic jump suite', contain: [
      programAtom('when', 'def main(arguments):\n    return True'),
      programAtom('where', `def main(arguments):\n    return explore({"thing":${JSON.stringify(destinationPath)}})[0]`),
      programAtom('register', `when_program = explore({"thing":${JSON.stringify(jumpWhen)}})[0]\nwhere_program = explore({"thing":${JSON.stringify(jumpWhere)}})[0]\njump({"when":when_program,"where":where_program})`)
    ], support: []
  })}`));
  await record('jump.register', () => adapter.executeStdin(runnerAgent, `transform ${JSON.stringify({ 'thing.run.': jumpRegister })}`));
  await record('jump.trigger', () => adapter.resolveExactAgent(runnerAgent));
  await record('jump.resolve', () => adapter.resolveExactAgent(movedRunnerAgent));
  }

  const slotBodyPath = `${movedRunnerPath}/slot-body`;
  const sealPath = `${movedRunnerPath}/seal-slot`;
  const printPath = `${movedRunnerPath}/print-slot`;
  if (!options.resumeAfterRestart) {
  await record('slot.create', () => adapter.executeStdin(movedRunnerAgent, `transform new ${JSON.stringify({
    thing: slotBodyPath, situation: 'synthetic slot body', contain: [{
      thing: 'flow', situation: 'synthetic flow', contain: [
        { 'thing@text': 'input', situation: 'input slot', contain: [], support: [{ 'if@current': true, then: [{ thing: 'output' }] }] },
        { 'thing@number': 'output', situation: 'output slot', contain: [], support: [{ 'if@current': true, then: [{ 'thing@program': 'compute' }] }] },
        { 'thing@program': 'compute', situation: 'def main(arguments):\n    return arguments', contain: [], support: [] }
      ], support: []
    }], support: []
  })}`));
  await record('slot.seal-program.create', () => adapter.executeStdin(movedRunnerAgent, `transform new ${JSON.stringify(programAtom(sealPath, `slot_body({"action":"seal","body":${JSON.stringify(slotBodyPath)}})`))}`));
  await record('slot.seal', () => adapter.executeStdin(movedRunnerAgent, `transform ${JSON.stringify({ 'thing.run.': sealPath })}`));
  await record('slot.print', () => adapter.executeStdin(movedRunnerAgent, `transform new ${JSON.stringify(programAtom(printPath, `use_program({"name":${JSON.stringify(`${slotBodyPath}/print`)},"arguments":{"name":"instance"}})`))}`));
  await record('slot.print.run', () => adapter.executeStdin(options.agent, `transform ${JSON.stringify({ 'thing.run.': printPath })}`));
  await record('slot.readback', () => adapter.executeStdin(movedRunnerAgent, `explore ${JSON.stringify({ thing: `世界之外/${slotBodyPath}/槽例/instance`, 'situation$full': true })}`));

  const orderProgramPath = `${movedRunnerPath}/work-order-program`;
  const orderPath = `${orderProgramPath}/night-watch-order`;
  const orderSource = [
    'order_path = current_atom().path + "/night-watch-order"',
    'rows = explore({"thing": current_atom().path, "contain$latitude-1": None, "situation$full": None})',
    'if not any(row.path == order_path for row in rows):',
    '    work_order({"action":"create","title":"night-watch-order","creation_id":"nw-shared-20260829","version":"1"})',
    'else:',
    '    work_order({"action":"read-back","path":order_path})'
  ].join('\n');
  await record('work-order.program.create', () => adapter.executeStdin(movedRunnerAgent, `transform new ${JSON.stringify(programAtom(orderProgramPath, orderSource))}`));
  await record('work-order.create', () => adapter.executeStdin(movedRunnerAgent, `transform ${JSON.stringify({ 'thing.run.': orderProgramPath })}`));
  await record('work-order.readback', () => adapter.executeStdin(movedRunnerAgent, `explore ${JSON.stringify({ thing: `世界之外/${orderPath}`, 'situation$full': true })}`));

  await record('restart', async () => ({ stdout: JSON.stringify(await restartSharedRuntime(authority.restart.deadlineSeconds)) }));
  }
  await record('persistence.readback', () => adapter.executeStdin(movedRunnerAgent, `explore ${JSON.stringify({ thing: `世界之外/${slotBodyPath}/槽例/instance`, 'situation$full': true })}`));

  const finalHealth = await record('health.after', async () => {
    const response = await fetch('http://127.0.0.1:4784/__spatial/api/health');
    return { stdout: JSON.stringify(assertSharedHealth(await response.json())) };
  });
  const evidenceId = `NW-SHARED-${sha256(JSON.stringify(evidence)).slice(0, 16)}`;
  const report = {
    contract: 'atom.night-watch.shared-cli-live', version: 1, status: 'accepted', evidenceId,
    generatedAt: new Date().toISOString(), runId: options.runId,
    candidate: process.env.ATOM_CANDIDATE ?? 'local-candidate',
    scope: 'redacted-synthetic-subtree',
    initialHealth: jsonReceipt(initialHealth.stdout), finalHealth: jsonReceipt(finalHealth.stdout),
    steps: evidence
  };
  await fs.writeFile(path.join(options.evidenceDir, 'shared-cli-live-report.jsonl'), `${JSON.stringify(report)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ ok: true, evidenceId, evidenceCount: evidence.length })}\n`);
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentFile = path.resolve(fileURLToPath(import.meta.url));
if (invokedFile === currentFile) await main();
