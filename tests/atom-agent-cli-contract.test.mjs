import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { resolveAgentContext, runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { executeAtomLanguage } from './helpers/atom-language-test-runtime.mjs';

function atom(name, { type = null, detail = '', children = [] } = {}) {
  return {
    [`name${type ? `@${type}` : ''}`]: name,
    detail,
    children,
    partners: []
  };
}

function output() {
  let value = '';
  return {
    stream: {
      isTTY: false,
      write(chunk) {
        value += chunk;
      }
    },
    text() {
      return value;
    }
  };
}

async function world(t, atoms) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-agent-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const contextFile = path.join(directory, 'atom.json');
  const projectionFile = path.join(directory, 'graph.json');
  await fs.writeFile(contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');
  return { contextFile, projectionFile };
}

function publicCli(files, overrides = {}) {
  return {
    requireAgent: true,
    defaultContextFile: files.contextFile,
    defaultProjectionFile: files.projectionFile,
    stdin: { isTTY: false },
    execute: executeAtomLanguage,
    ...overrides
  };
}

test('public CLI selects one @agent context with --agent and needs no session', async (t) => {
  const files = await world(t, [
    atom('Workspace', {
      children: [
        atom('Work Agent', { type: 'agent', children: [atom('Current Task')] })
      ]
    })
  ]);
  const stdin = new PassThrough();
  stdin.end();
  const stdout = output();
  const stderr = output();

  const code = await runAtomCli(['--agent', 'Work Agent', 'atom'], publicCli(files, {
    stdout: stdout.stream,
    stderr: stderr.stream
  }));

  assert.equal(code, 0, stderr.text());
  assert.match(stdout.text(), /atom~count\d+/u);
  assert.match(stdout.text(), /"agent~current": "Workspace\/Work Agent"/u);
  assert.equal(stderr.text(), '');
});

test('agent resolution reuses the indexed directory for one immutable large-world revision', async (t) => {
  const files = await world(t, [
    atom('Work Agent', { type: 'agent' }),
    ...Array.from({ length: 10_000 }, (_, index) => atom(`Node ${index}`, {
      detail: 'x'.repeat(1_000)
    }))
  ]);
  await resolveAgentContext(files.contextFile, 'Work Agent');

  const startedAt = performance.now();
  const resolved = await resolveAgentContext(files.contextFile, 'Work Agent');
  const elapsedMs = performance.now() - startedAt;

  assert.equal(resolved.path, 'Work Agent');
  assert.ok(elapsedMs < 30, `cached agent resolution took ${elapsedMs}ms`);
});

test('public CLI reads one complete multiline long-text command from stdin without shell quoting', async (t) => {
  const files = await world(t, [atom('Work Agent', { type: 'agent' })]);
  const detail = `# 中文结构图\n\n\`\`\`mermaid\nflowchart LR\n  A["起点"] -->|"包含：冒号、引号与 $变量"| B["终点"]\n\`\`\`\n${'长文本段落。'.repeat(1200)}`;
  const source = `transform new ${JSON.stringify({
    name: '长文本节点',
    'detail#结构化正文': detail,
    children: [],
    partners: []
  }, null, 2)}`;
  const stdin = new PassThrough();
  stdin.end(source);
  const stdout = output();
  const stderr = output();

  const code = await runAtomCli(['--agent', 'Work Agent', '--stdin'], publicCli(files, {
    stdin,
    stdout: stdout.stream,
    stderr: stderr.stream
  }));

  assert.equal(code, 0, stderr.text());
  assert.match(stdout.text(), /"name~created": "长文本节点"/u);
  const explored = await executeAtomLanguage({
    source: 'explore {"name":"长文本节点","detail$full":true}',
    contextFile: files.contextFile,
    projectionFile: files.projectionFile
  });
  assert.equal(explored.ok, true);
  assert.equal(explored.items[0].matches[0].detail, detail);
});

test('public CLI rejects a missing, nonexistent, or non-agent context start', async (t) => {
  const files = await world(t, [
    atom('Workspace', {
      children: [
        atom('Work Agent', { type: 'agent' }),
        atom('Ordinary Node')
      ]
    })
  ]);
  const cases = [
    { argv: ['atom'], error: /AGENT_REQUIRED/u },
    { argv: ['--agent', 'Missing Agent', 'atom'], error: /AGENT_NOT_FOUND/u },
    { argv: ['--agent', 'Ordinary Node', 'atom'], error: /AGENT_TYPE_REQUIRED/u }
  ];

  for (const scenario of cases) {
    const stdout = output();
    const stderr = output();
    const code = await runAtomCli(scenario.argv, publicCli(files, {
      stdout: stdout.stream,
      stderr: stderr.stream
    }));

    assert.equal(code, 4, `${scenario.argv.join(' ')} unexpectedly succeeded`);
    assert.match(stderr.text(), scenario.error);
    assert.equal(stdout.text(), '');
  }
});

test('an ordinary target is explored through the already bound agent context', async (t) => {
  const files = await world(t, [
    atom('Work Agent', { type: 'agent' }),
    atom('目标节点', { detail: '公开契约测试节点' })
  ]);
  const stdout = output();
  const stderr = output();

  const code = await runAtomCli([
    '--agent', 'Work Agent',
    'explore', '{"name":"目标节点","detail$full"}'
  ], publicCli(files, { stdout: stdout.stream, stderr: stderr.stream }));

  assert.equal(code, 0, stderr.text());
  assert.match(stdout.text(), /"name": "目标节点"/u);
  assert.match(stdout.text(), /"detail": "公开契约测试节点"/u);
  assert.equal(stderr.text(), '');
});

test('a short ambiguous agent name is rejected while its exact path selects one @agent', async (t) => {
  const files = await world(t, [
    atom('Workspace A', { children: [atom('Worker', { type: 'agent' })] }),
    atom('Workspace B', { children: [atom('Worker', { type: 'agent' })] })
  ]);
  const ambiguousOut = output();
  const ambiguousErr = output();

  let code = await runAtomCli(['--agent', 'Worker', 'atom'], publicCli(files, {
    stdout: ambiguousOut.stream,
    stderr: ambiguousErr.stream
  }));
  assert.equal(code, 4);
  assert.match(ambiguousErr.text(), /AMBIGUOUS_AGENT/u);

  const exactOut = output();
  const exactErr = output();
  code = await runAtomCli(['--agent', 'Workspace B/Worker', 'atom'], publicCli(files, {
    stdout: exactOut.stream,
    stderr: exactErr.stream
  }));
  assert.equal(code, 0, exactErr.text());
  assert.match(exactOut.text(), /atom~count\d+/u);
  assert.match(exactOut.text(), /"agent~current": "Workspace B\/Worker"/u);
});

test('interactive prompt identifies the selected @agent context', async (t) => {
  const files = await world(t, [
    atom('Workspace', { children: [atom('Work Agent', { type: 'agent' })] })
  ]);
  const stdin = new PassThrough();
  stdin.isTTY = false;
  stdin.end('atom\n');
  const stdout = output();
  const stderr = output();

  const code = await runAtomCli(['--agent', 'Work Agent'], publicCli(files, {
    interactive: true,
    stdin,
    stdout: stdout.stream,
    stderr: stderr.stream,
    terminal: false
  }));

  assert.equal(code, 0, stderr.text());
  assert.match(stdout.text(), /atom\[Workspace\/Work Agent\]>/u);
  assert.match(stdout.text(), /"agent~current": "Workspace\/Work Agent"/u);
});

test('interactive entry is Graph-JSON and does not expand @program source', async (t) => {
  const files = await world(t, [
    atom('Workspace', {
      detail: '上层说明',
      children: [
        atom('Peer', { detail: '同层说明' }),
        atom('Work Agent', {
          type: 'agent', detail: '当前窗口说明',
          children: [
            atom('Current Task', { detail: '当前下层说明' }),
            atom('Main Branch', {
              detail: '主干说明',
              children: [
                atom('Form Node', {
                  detail: '第三层表单',
                  children: [atom('Hidden Field', { detail: '边界外字段' })]
                })
              ]
            }),
            atom('Router', { type: 'program', detail: 'SECRET_PROGRAM_SOURCE' })
          ]
        })
      ]
    })
  ]);
  const stdin = new PassThrough();
  stdin.isTTY = false;
  stdin.end();
  const stdout = output();
  const stderr = output();

  const code = await runAtomCli(['--agent', 'Work Agent'], publicCli(files, {
    interactive: true, stdin, stdout: stdout.stream, stderr: stderr.stream, terminal: false
  }));

  assert.equal(code, 0, stderr.text());
  assert.match(stdout.text(), /"name@context": "Workspace\/Work Agent"/u);
  assert.match(stdout.text(), /"name@parent": "Workspace"/u);
  assert.match(stdout.text(), /"name@peer": "Peer"/u);
  assert.match(stdout.text(), /"name@agent@current": "Work Agent"/u);
  assert.match(stdout.text(), /"name": "Current Task"/u);
  assert.match(stdout.text(), /"name": "Main Branch"/u);
  assert.match(stdout.text(), /"name": "Form Node"/u);
  assert.doesNotMatch(stdout.text(), /Hidden Field|边界外字段/u);
  assert.match(stdout.text(), /"name@program": "Router"/u);
  assert.doesNotMatch(stdout.text(), /"children": \[\]/u);
  assert.doesNotMatch(stdout.text(), /"partners": \[\]/u);
  assert.match(stdout.text(), /"children": \[/u);
  assert.doesNotMatch(stdout.text(), /SECRET_PROGRAM_SOURCE/u);
  assert.match(stdout.text(), /"boundary~preview"/u);
  assert.match(stdout.text(), /"down"[\s\S]*"nodes": 1[\s\S]*"characters": 17/u);
  assert.doesNotMatch(stdout.text(), /^(?:上下文起点|上层：|同层：|当前：|下层：)/mu);
});

test('interactive entry previews hidden peer branches to the left and right without leaking their content', async (t) => {
  const files = await world(t, [
    atom('Workspace', {
      children: [
        atom('Left Peer', { children: [atom('Left Secret', { detail: 'abc' })] }),
        atom('Work Agent', { type: 'agent' }),
        atom('Right Peer', { children: [atom('Right Secret', { detail: 'xyz' })] })
      ]
    })
  ]);
  const stdin = new PassThrough();
  stdin.end();
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--agent', 'Work Agent'], publicCli(files, {
    interactive: true,
    stdin,
    stdout: stdout.stream,
    stderr: stderr.stream,
    terminal: false
  }));

  assert.equal(code, 0, stderr.text());
  assert.doesNotMatch(stdout.text(), /Left Secret|Right Secret|abc|xyz/u);
  assert.match(stdout.text(), /"left"[\s\S]*"nodes": 1[\s\S]*"characters": 14/u);
  assert.match(stdout.text(), /"right"[\s\S]*"nodes": 1[\s\S]*"characters": 15/u);
});

test('@agent is forwarded only as a context start, never as lock identity or permission', async (t) => {
  const files = await world(t, [
    atom('Workspace', { children: [atom('Work Agent', { type: 'agent' })] })
  ]);
  const stdout = output();
  const stderr = output();
  let received = null;

  const code = await runAtomCli(['--agent', 'Work Agent', 'atom'], publicCli(files, {
    stdout: stdout.stream,
    stderr: stderr.stream,
    execute: async (options) => {
      received = options;
      return {
        ok: true,
        command: 'atom',
        atomCount: 2,
        warnings: [],
        errors: [],
        changed: false
      };
    }
  }));

  assert.equal(code, 0, stderr.text());
  assert.deepEqual(received.interaction?.agent, {
    ref: received.interaction?.agent?.ref,
    path: 'Workspace/Work Agent'
  });
  assert.match(received.interaction.agent.ref, /^[A-Za-z0-9_-]{20,}$/u);
  assert.equal(Object.hasOwn(received, 'agentContext'), false);
  assert.equal(Object.hasOwn(received, 'access'), false);
});

test('Program message results are visible through the CLI return channel', async (t) => {
  const files = await world(t, [atom('Work Agent', { type: 'agent' })]);
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--agent', 'Work Agent', 'atom'], publicCli(files, {
    stdout: stdout.stream,
    stderr: stderr.stream,
    execute: async () => ({
      ok: true, command: 'atom', atomCount: 1, changed: false,
      warnings: [], errors: [], messages: [{ level: 'info', text: '已完成计算' }]
    })
  }));
  assert.equal(code, 0);
  assert.match(stderr.text(), /Program info: 已完成计算/u);
});

test('interactive submit forwards prior commands and complete receipts as this CLI history', async (t) => {
  const files = await world(t, [atom('Work Agent', { type: 'agent' })]);
  const stdin = new PassThrough();
  stdin.isTTY = false;
  stdin.end('explore {"name":"Work Agent","detail$full"}\nsubmit {"type":"bug","detail":"示例"}\n');
  let submittedHistory = null;
  const execute = async (options) => {
    if (options.source.startsWith('submit ')) submittedHistory = options.history;
    if (options.source.startsWith('explore ')) {
      return {
        ok: true, command: 'explore', changed: false, warnings: [], errors: [],
        items: [{ matches: [{ name: 'Work Agent', path: 'Work Agent', detail: '完整回执正文' }] }]
      };
    }
    if (options.source.startsWith('submit ')) {
      return { ok: true, command: 'submit', changed: false, warnings: [], errors: [], submission: { id: '1', type: 'bug', submittedAt: 'now' } };
    }
    return { ok: true, command: 'atom', changed: false, atomCount: 1, warnings: [], errors: [] };
  };
  const code = await runAtomCli(['--agent', 'Work Agent'], publicCli(files, {
    interactive: true, stdin, stdout: output().stream, stderr: output().stream, terminal: false, execute
  }));
  assert.equal(code, 0);
  assert.equal(submittedHistory.length, 1);
  assert.equal(submittedHistory[0].source, 'explore {"name":"Work Agent","detail$full"}');
  assert.equal(submittedHistory[0].receipt.items[0].matches[0].detail, '完整回执正文');
  assert.equal(Object.hasOwn(submittedHistory[0].receipt, 'contextFile'), false);
});

test('@agent ref is revision-local rather than a hash of its path alone', async (t) => {
  const atoms = [
    atom('Workspace', { children: [atom('Work Agent', { type: 'agent' })] })
  ];
  const files = await world(t, atoms);
  const refs = [];
  const execute = async (options) => {
    refs.push(options.interaction.agent.ref);
    return {
      ok: true,
      command: 'atom',
      atomCount: 2,
      warnings: [],
      errors: [],
      changed: false
    };
  };

  let code = await runAtomCli(['--agent', 'Work Agent', 'atom'], publicCli(files, {
    stdout: output().stream,
    stderr: output().stream,
    execute
  }));
  assert.equal(code, 0);

  atoms.push(atom('Unrelated revision change'));
  await fs.writeFile(files.contextFile, `${JSON.stringify(atoms, null, 2)}\n`, 'utf8');
  code = await runAtomCli(['--agent', 'Work Agent', 'atom'], publicCli(files, {
    stdout: output().stream,
    stderr: output().stream,
    execute
  }));
  assert.equal(code, 0);
  assert.equal(refs.length, 2);
  assert.notEqual(refs[0], refs[1]);
});

test('public help exposes only public Agent CLI options', async () => {
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], {
    requireAgent: true,
    stdout: stdout.stream,
    stderr: stderr.stream
  });

  assert.equal(code, 0, stderr.text());
  assert.match(stdout.text(), /--agent AGENT/u);
  assert.match(stdout.text(), /--json/u);
  assert.match(
    stdout.text(),
    /atom\.cmd --% --agent 工作Agent explore .*""name"":""目标节点"".*""partners"":true/u
  );
  assert.match(stdout.text(), /Program 模板与复用/u);
  assert.match(stdout.text(), /template_catalog\(\{\}\)/u);
  assert.match(stdout.text(), /instantiate\(/u);
  assert.match(stdout.text(), /'template':'advancement-flow'/u);
  assert.match(stdout.text(), /新建 Agent 与追加 Program 分两次 transform/u);
  assert.match(stdout.text(), /use_program\(\{name,arguments\}\)/u);
  assert.match(stdout.text(), /--agent 只指定本次交互的上下文来源，不指定节点的归属或写入位置/u);
  assert.match(stdout.text(), /新节点的归属由 name 中的精确父路径决定/u);
  assert.match(stdout.text(), /会话已给出或已绑定唯一 @agent 时直接复用，不得重复询问/u);
  assert.match(stdout.text(), /CLI 不会把目标 name 自动当作 --agent/u);
  assert.match(stdout.text(), /父路径不明确时只询问父 Atom/u);
  assert.match(stdout.text(), /每次写入后重新 explore 实际写入的 Atom/u);
  assert.match(stdout.text(), /先 explore 预定父节点及其直接子节点/u);
  assert.match(stdout.text(), /确实没有可复用节点时.*transform new/u);
  assert.doesNotMatch(stdout.text(), /目标 @agent/u);
  assert.doesNotMatch(stdout.text(), /\\"name\\"/u);
  assert.doesNotMatch(stdout.text(), /--session|--window|--context|--projection|--global/u);
});

test('public help is a complete daily Agent operation contract', async () => {
  const stdout = output();
  const stderr = output();
  const code = await runAtomCli(['--help'], {
    requireAgent: true,
    stdout: stdout.stream,
    stderr: stderr.stream
  });
  const text = stdout.text();

  assert.equal(code, 0, stderr.text());
  for (const heading of [
    '日常闭环',
    'Explore 契约',
    'Transform 契约',
    'Program 模板与复用',
    '错误处理与下一步动作'
  ]) assert.match(text, new RegExp(heading, 'u'));
  for (const command of ['rep', 'sum', 'typ', 'ren', 'mov', 'cpy', 'dsc', 'rst', 'run']) {
    assert.match(text, new RegExp(`\\.${command}\\.`, 'u'));
  }
  for (const example of [
    '{"name":"A","detail.rep.NEW"}',
    '{"name.typ.TYPE":"A"}',
    '{"name.ren.NEW_NAME":"A"}',
    '{"name.mov.DESTINATION_PATH":"A"}',
    '{"name.cpy.DESTINATION_PATH":"A"}',
    '{"name.dsc.":"A"}',
    '{"name.rst.":"BACKUP_PATH/A"}',
    '{"name.run.":"PROGRAM_PATH"}'
  ]) assert.match(text, new RegExp(example.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(text, /detail\$full/u);
  assert.match(text, /partners（返回每个匹配 Atom 的完整有向关系数组/u);
  assert.match(text, /读取投影推荐使用标准 JSON true/u);
  assert.match(text, /任一项失败整批不写；成功后整批只做一次权威提交/u);
  assert.match(text, /children\$latitude\+1.*children\$latitude-1/u);
  assert.match(text, /children\$longitude\+1.*children\$longitude-1/u);
  assert.doesNotMatch(text, /±N/u);
  assert.match(text, /AGENT_NOT_FOUND.*AGENT_TYPE_REQUIRED.*AMBIGUOUS_AGENT/us);
  assert.match(text, /查询或写入的事实目标不得代替 --agent 上下文来源/u);
  assert.match(text, /目标 Atom 本身不需要是 @agent/u);
  assert.match(text, /AMBIGUOUS_ATOM_NAME.*ATOM_NOT_FOUND/us);
  assert.match(text, /ATOM_NOT_FOUND.*预定父节点.*复用.*transform new/us);
  assert.match(text, /WORLD_REVISION_CONFLICT.*重新读取/us);
  assert.match(text, /PROJECTION_RECOVERY_PENDING.*事实写入已成功.*维护入口/us);
  assert.doesNotMatch(text, /WORLD_COMMITTED_PROJECTION_PENDING/u);
  assert.match(text, /纠正提示仍无法解除阻断.*submit/u);
  assert.doesNotMatch(text, /PROGRAM_LOCK_DENIED[^\n]*submit/u);
  assert.doesNotMatch(text, /ATOM_PROGRAM_TIMEOUT[^\n]*submit/u);
  assert.doesNotMatch(text, /注册的自动化函数/u);
});

test('public CLI rejects retired entry options and maintenance-only data-source options', async (t) => {
  const files = await world(t, [atom('Work Agent', { type: 'agent' })]);
  const cases = [
    { argv: ['--session', 'opaque', 'atom'], error: /LEGACY_AGENT_ENTRY_OPTION/u },
    { argv: ['--window', 'Work Agent', 'atom'], error: /LEGACY_AGENT_ENTRY_OPTION/u },
    {
      argv: ['--agent', 'Work Agent', '--context', files.contextFile, 'atom'],
      error: /DAILY_CONTEXT_OVERRIDE_REJECTED/u
    },
    {
      argv: ['--agent', 'Work Agent', '--projection', files.projectionFile, 'atom'],
      error: /DAILY_CONTEXT_OVERRIDE_REJECTED/u
    },
    {
      argv: ['--agent', 'Work Agent', '--global', 'atom'],
      error: /DAILY_GLOBAL_MODE_REJECTED/u
    }
  ];

  for (const scenario of cases) {
    const stdout = output();
    const stderr = output();
    const code = await runAtomCli(scenario.argv, publicCli(files, {
      stdout: stdout.stream,
      stderr: stderr.stream
    }));
    assert.equal(code, 4, `${scenario.argv.join(' ')} unexpectedly succeeded`);
    assert.match(stderr.text(), scenario.error);
    assert.equal(stdout.text(), '');
  }
});
