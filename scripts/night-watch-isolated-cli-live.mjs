#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { createNightWatchCliFixture } from './night-watch-isolated-cli-fixture.mjs';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cliError(message, details = {}) {
  return Object.assign(new Error(message), { code: 'NIGHT_WATCH_ISOLATED_CLI_FAILED', details });
}

function parseArgs(argv) {
  const index = argv.indexOf('--evidence-dir');
  if (index < 0 || !argv[index + 1] || argv.length !== 2) {
    throw cliError('Usage: node scripts/night-watch-isolated-cli-live.mjs --evidence-dir <directory>');
  }
  return { evidenceDir: path.resolve(argv[index + 1]) };
}

function sourceReplace(pathname, next) {
  return `transform {"thing":${JSON.stringify(pathname)},"situation.rep.${next}"}`;
}

function sourceRun(pathname) {
  return `transform ${JSON.stringify({ 'thing.run.': pathname })}`;
}

function programAtom(pathname, situation) {
  return { 'thing@program': pathname, situation, contain: [], support: [] };
}

function pathLockProgram(pathname, targetPath) {
  return programAtom(pathname, `lock(${JSON.stringify({
    targets: { paths: [`世界之外/${targetPath}`], scope: 'exact' },
    actions: ['transform'], labels: ['^']
  })})`);
}

export function atomCmdSpawnOptions() {
  return {
    cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    // Arguments are generated fixed selectors and loopback URLs; Program text is stdin.
    ...(process.platform === 'win32' ? { shell: true } : {})
  };
}

function childProcess(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, atomCmdSpawnOptions());
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input);
  });
}

function safePayload(stdout) {
  try {
    const value = JSON.parse(stdout);
    return {
      keys: Object.keys(value).sort(),
      thing: value.thing ?? value['thing@program'] ?? value['thing@program@agent'] ?? null,
      agent: value.agent ?? value['agent~current'] ?? null,
      situationHash: typeof value.situation === 'string' ? sha256(value.situation) : null,
      shortcut: value['shortcut~resolved']?.identity ?? null,
      lockActive: value['lock~active']?.labels ?? null
    };
  } catch {
    return { keys: [], thing: null, agent: null, situationHash: null, shortcut: null, lockActive: null };
  }
}

function diagnosticCodes(stderr) {
  return [...new Set([...stderr.matchAll(/(?:提示|错误)\s+([A-Z][A-Z0-9_]+)/gu)].map((match) => match[1]))];
}

function requireSuccess(result, label) {
  const blocking = diagnosticCodes(result.stderr).filter((code) => (
    code === 'PROGRAM_FUNCTION_DENIED' || code === 'ATOM_PROGRAM_FAILED'
  ));
  if (result.code !== 0 || blocking.length) {
    throw cliError(`${label} did not succeed`, { label, code: result.code, blocking, stderr: result.stderr });
  }
  return result;
}

function requireFailure(result, label, code) {
  if (result.code === 0 || !`${result.stdout}\n${result.stderr}`.includes(code)) {
    throw cliError(`${label} did not fail closed with ${code}`, { label, code: result.code, stdout: result.stdout, stderr: result.stderr });
  }
  return result;
}

async function main() {
  const { evidenceDir } = parseArgs(process.argv.slice(2));
  await fs.mkdir(evidenceDir, { recursive: true });
  const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-night-watch-live-'));
  const fixture = createNightWatchCliFixture(runtimeDirectory);
  await fs.writeFile(fixture.contextFile, `${JSON.stringify(fixture.world, null, 2)}\n`, 'utf8');
  const server = await startAtomGraphServer({
    host: '127.0.0.1', port: 0,
    contextFile: fixture.contextFile, graphFile: fixture.graphFile, storeFile: fixture.storeFile
  });
  const endpoint = `${server.url}/__atom/api/command`;
  const agents = Object.freeze({ bootstrap: 'Bootstrap', synthetic: '🧊', journey: '旅程', noLabel: '无标签' });
  const evidence = [];
  const run = async (step, agent, source, expected = 'success') => {
    const result = await childProcess('atom.cmd', ['--endpoint', endpoint, '--agent', agent, '--stdin'], source);
    const entry = {
      step,
      outcome: expected === 'success' ? 'passed' : 'expected-fail-closed',
      agent,
      exitCode: result.code,
      stdoutSha256: sha256(result.stdout),
      stderrSha256: sha256(result.stderr),
      diagnosticCodes: diagnosticCodes(result.stderr),
      payload: safePayload(result.stdout),
      ...(expected === 'success' ? {} : { expectedError: expected })
    };
    evidence.push(entry);
    await fs.appendFile(path.join(evidenceDir, 'isolated-cli-live-attempts.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
    if (expected === 'success') requireSuccess(result, step);
    else requireFailure(result, step, expected);
    return result;
  };
  const read = (step, agent, thing) => run(step, agent, `explore ${JSON.stringify({ thing, 'situation$full': true })}`);
  const create = (step, agent, atom) => run(step, agent, `transform new ${JSON.stringify(atom)}`);

  try {
    await create('registration.synthetic-program.write', agents.bootstrap, programAtom(fixture.syntheticPath, fixture.syntheticAgentSource));
    await run('registration.synthetic-agent.run', agents.bootstrap, sourceRun(fixture.syntheticPath));
    await read('registration.synthetic-agent.read-back', agents.bootstrap, fixture.syntheticPath);

    await run('agent.exact-resolution', agents.journey, 'atom');
    await read('agent.registered-source.read-back', agents.journey, fixture.journeyPath);
    let activePath = fixture.journeyPath;

    const destinationPath = 'test/目的地';
    const whenPath = `${activePath}/跳转判定`;
    const wherePath = `${activePath}/目标定位`;
    const jumpPath = `${activePath}/跳转登记`;
    await create('jump.when-program.write', agents.journey, programAtom(whenPath, 'def main(arguments):\n    return True'));
    await create('jump.where-program.write', agents.journey, programAtom(wherePath, `def main(arguments):\n    return explore({"thing":${JSON.stringify(destinationPath)}})[0]`));
    await create('jump.registration-program.write', agents.journey, programAtom(jumpPath, [
      `when_program = explore({"thing":${JSON.stringify(whenPath)}})[0]`,
      `where_program = explore({"thing":${JSON.stringify(wherePath)}})[0]`,
      'jump({"when":when_program,"where":where_program})'
    ].join('\n')));
    await run('jump.registration.run', agents.journey, sourceRun(jumpPath));
    activePath = `${destinationPath}/旅程`;
    await run('jump.new-origin.resolution', agents.journey, 'atom');
    await read('jump.read-back', agents.journey, activePath);

    const programPath = `${activePath}/Program`;
    const programResultPath = `${programPath}/结果`;
    await create('program.write', agents.journey, programAtom(programPath, [
      `transform({"thing":${JSON.stringify(programResultPath)},"situation":"program-passed","contain":[],"support":[]})`
    ].join('\n')));
    await read('program.read-back', agents.journey, programResultPath);

    const transformPath = `${activePath}/ExploreTransform`;
    await create('explore-transform.write', agents.journey, {
      thing: transformPath, situation: 'draft', contain: [], support: []
    });
    await run('explore-transform.transform', agents.journey, sourceReplace(transformPath, 'transformed'));
    await read('explore-transform.read-back', agents.journey, transformPath);

    const lockedTargetPath = `${activePath}/受锁结果`;
    const lockPath = `${activePath}/路径锁`;
    await create('lock.target.write', agents.journey, {
      thing: lockedTargetPath, situation: 'unchanged', contain: [], support: []
    });
    await create('lock.program.write', agents.journey, pathLockProgram(lockPath, lockedTargetPath));
    await run('lock.program.run', agents.journey, sourceRun(lockPath));
    await run('lock.no-label.denied', agents.noLabel, sourceReplace(fixture.noLabelTargetPath, 'must-not-write'), 'GRAPH_LOCK_DENIED');
    await read('lock.no-label.read-back', agents.noLabel, fixture.noLabelTargetPath);
    await run('lock.caret.transform', agents.journey, sourceReplace(lockedTargetPath, 'caret-authorized'));
    await read('lock.caret.read-back', agents.journey, lockedTargetPath);
    const shortcutProgramPath = `${activePath}/快捷Program`;
    const shortcutTargetPath = `${shortcutProgramPath}/权威目标`;
    const shortcutPath = `${shortcutProgramPath}/快捷入口`;
    await create('shortcut.program.write', agents.journey, programAtom(shortcutProgramPath, [
        `target = explore({"thing":${JSON.stringify(shortcutTargetPath)}})[0]`,
        'shortcut({"placement":"contain","thing":"快捷入口","target":target})'
    ].join('\n')));
    await create('shortcut.target.write', agents.journey, {
      thing: shortcutTargetPath, situation: 'authoritative-shortcut-target', contain: [], support: []
    });
    await run('shortcut.program.run', agents.journey, sourceRun(shortcutProgramPath));
    await read('shortcut.read-back', agents.journey, shortcutPath);

    const bodyPath = `${activePath}/槽体`;
    const sealPath = `${activePath}/封装槽体`;
    const printPath = `${activePath}/打印槽例`;
    await create('slot-body.candidate.write', agents.journey, {
      thing: bodyPath, situation: 'synthetic slot body', contain: [{
        thing: '候选流', situation: 'candidate data flow', contain: [
          {
            'thing@text': '客户', situation: 'input slot contract', contain: [],
            support: [{ 'if@current': true, then: [{ thing: '金额' }] }]
          },
          {
            'thing@number': '金额', situation: 'output slot contract', contain: [],
            support: [{
              'if@current': true,
              if: [{ 'thing@program': '共享计算' }],
              then: [{ thing: '结果' }]
            }]
          },
          { thing: '结果', situation: 'ordinary result fact', contain: [], support: [] },
          {
            'thing@program': '共享计算',
            situation: 'def main(arguments):\n    return True', contain: [], support: []
          }
        ], support: []
      }], support: []
    });
    await create('slot-body.seal-program.write', agents.journey, programAtom(sealPath, `slot_body({"action":"seal","body":${JSON.stringify(bodyPath)}})`));
    await run('slot-body.seal-program.run', agents.journey, sourceRun(sealPath));
    await create('slot-body.print-program.write-and-print', agents.journey, programAtom(
      printPath,
      `use_program({"name":${JSON.stringify(`${bodyPath}/print`)},"arguments":{"name":"实例"}})`
    ));
    await read('slot-body.read-back', agents.journey, `${bodyPath}/槽例/实例`);

    const workOrderProgramPath = `${activePath}/工单流程`;
    const workOrderPath = `${workOrderProgramPath}/闭环工单`;
    await create('work-order.program.write', agents.journey, programAtom(workOrderProgramPath, [
      'order_path = current_atom().path + "/闭环工单"',
      'rows = explore({"thing": current_atom().path, "contain$latitude-1": None, "situation$full": None})',
      'if not any(row.path == order_path for row in rows):',
      '    work_order({"action":"create","title":"闭环工单","creation_id":"night-watch-isolated-20260829","version":"1"})',
      'else:',
      '    state = work_order({"action":"read-back","path":order_path})',
      '    if state["status"] == "待执行":',
      '        work_order({"action":"fill","path":order_path,"values":{"Output":{"交付物":{"名称":"验收报告","接收方":"测试方","成果引用":"doc://night-watch.synthetic","版本":"v1"}},"Step":{"操作":{"状态":"已完成","实际动作":["隔离验收"],"实际产出":["doc://night-watch.synthetic"],"异常":[]}},"Criteria":{"要求":{"条件":["内容完整"],"边界":["只写隔离世界"]}}}})',
      '    elif state["status"] == "执行中":',
      '        checked = work_order({"action":"validate","path":order_path})',
      '        if checked["valid"]:',
      '            work_order({"action":"submit","path":order_path,"submitted_at":"2026-08-29T00:00:00Z"})',
      '    elif state["status"] == "待验收":',
      '        work_order({"action":"read-back","path":order_path})'
    ].join('\n')));
    for (const pass of ['create', 'fill', 'validate-submit', 'read-back']) {
      await run(`work-order.${pass}.run`, agents.journey, sourceRun(workOrderProgramPath));
      await read(`work-order.${pass}.read-back`, agents.journey, workOrderPath);
    }

    // Deliberately last: declaration-time validation must fail closed before
    // an overreaching Agent Program can enter the world or be run.
    const movedOverreachPath = `${activePath}/越级`;
    await run(
      'lock.overreach.declaration-denied',
      agents.journey,
      `transform new ${JSON.stringify(programAtom(movedOverreachPath, fixture.overreachAgentSource))}`,
      'AGENT_JURISDICTION_ESCALATION'
    );

    const evidenceId = `NW-CLI-${sha256(JSON.stringify(evidence.map((entry) => [entry.step, entry.stdoutSha256, entry.stderrSha256]))).slice(0, 16)}`;
    const report = {
      contract: 'atom.night-watch.isolated-cli-live', version: 1,
      generatedAt: new Date().toISOString(), endpoint: 'redacted-isolated-loopback',
      runtimeDirectory: 'redacted-temp-world', agent: '旅程', keyLabel: '^',
      evidenceId,
      steps: evidence
    };
    await fs.writeFile(path.join(evidenceDir, 'isolated-cli-live-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await fs.appendFile(path.join(evidenceDir, 'night-watch-checkpoints.jsonl'), `${JSON.stringify({
      at: report.generatedAt, status: 'passed', contract: report.contract,
      evidenceId,
      completed: ['Program', 'Explore/Transform', 'path-label-lock', 'jump', 'shortcut', 'slot-body', 'work-order'],
      evidenceCount: evidence.length
    })}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ ok: true, evidenceDir, evidenceCount: evidence.length })}\n`);
  } finally {
    server.server.closeAllConnections?.();
    await server.close();
  }
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentFile = path.resolve(fileURLToPath(import.meta.url));
if (invokedFile === currentFile) await main();
