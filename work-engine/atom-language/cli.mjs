#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { formatGraphJson, parseGraphJson } from './graph-json.mjs';
import { createAtomLanguageReceiver } from './receiver.mjs';
import { readAtomContext } from './context-store.mjs';
import { parseAtomKey } from './key-parser.mjs';
import { createActionRegistry } from './registry.mjs';
import { resolveAtomRuntime } from './runtime-config.mjs';
import { TRANSFORM_COMMANDS } from './transform-key-parser.mjs';
import { ATOM_RUNTIME_CONTRACT } from './runtime-contract.mjs';
import { programFunctionRegistry } from './program-function-registry.mjs';
import { createProgramRuntimeScheduler } from './program-runtime.mjs';
import { revisionOfWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';

const agentDirectories = new WeakMap();

export const DEFAULT_ATOM_COMMAND_ENDPOINT = 'http://127.0.0.1:4784/__atom/api/command';
export const DEFAULT_WORK_ORDER_REGISTRY_ENDPOINT = 'http://127.0.0.1:4784/__atom/api/work-order-registry';
export const DEFAULT_PROGRAM_FUNCTION_REGISTRY_ENDPOINT = 'http://127.0.0.1:4784/__atom/api/program-function-registry';

export async function executeAtomCommandEndpoint(options, endpoint = DEFAULT_ATOM_COMMAND_ENDPOINT) {
  const interaction = {
    ...(options.interaction ?? {}),
    id: options.interaction?.id ?? crypto.randomUUID()
  };
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: options.source,
        interaction,
        ...(Array.isArray(options.history) ? { history: options.history } : {})
      })
    });
  } catch (cause) {
    throw cliError('ATOM_ENGINE_UNAVAILABLE', `Atom engineering service is unavailable at ${endpoint}: ${cause.message}`);
  }
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw cliError(payload.error?.code ?? 'ATOM_ENGINE_REQUEST_FAILED', payload.error?.message ?? 'Atom engineering service request failed');
  }
  if (payload.result?.runtimeContract !== ATOM_RUNTIME_CONTRACT) {
    throw cliError(
      'ATOM_RUNTIME_CONTRACT_MISMATCH',
      `Atom engineering service contract is stale or incompatible; restart the 4784 service (expected ${ATOM_RUNTIME_CONTRACT})`
    );
  }
  return payload.result;
}

export async function executeAtomWorkOrderRegistryEndpoint(
  endpoint = DEFAULT_WORK_ORDER_REGISTRY_ENDPOINT
) {
  let response;
  try {
    response = await fetch(endpoint);
  } catch (cause) {
    throw cliError(
      'ATOM_ENGINE_UNAVAILABLE',
      `Atom engineering service is unavailable at ${endpoint}: ${cause.message}`
    );
  }
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw cliError(
      payload.error?.code ?? 'ATOM_ENGINE_REQUEST_FAILED',
      payload.error?.message ?? 'Work-order registry request failed'
    );
  }
  if (payload.result?.contract !== 'atom-work-order-registry'
    || payload.result?.version !== 1
    || payload.result?.runtimeContract !== ATOM_RUNTIME_CONTRACT) {
    throw cliError(
      'ATOM_RUNTIME_CONTRACT_MISMATCH',
      `Work-order registry is stale or incompatible; restart the 4784 service (expected ${ATOM_RUNTIME_CONTRACT})`
    );
  }
  return payload.result;
}

export async function executeAtomProgramFunctionRegistryEndpoint(
  endpoint = DEFAULT_PROGRAM_FUNCTION_REGISTRY_ENDPOINT
) {
  let response;
  try {
    response = await fetch(endpoint);
  } catch (cause) {
    throw cliError(
      'ATOM_ENGINE_UNAVAILABLE',
      `Atom engineering service is unavailable at ${endpoint}: ${cause.message}`
    );
  }
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw cliError(
      payload.error?.code ?? 'ATOM_ENGINE_REQUEST_FAILED',
      payload.error?.message ?? 'Program function registry request failed'
    );
  }
  if (payload.result?.contract !== 'atom-program-function-registry'
    || payload.result?.version !== 5
    || payload.result?.runtimeContract !== ATOM_RUNTIME_CONTRACT) {
    throw cliError(
      'ATOM_RUNTIME_CONTRACT_MISMATCH',
      `Program function registry is stale or incompatible; restart the 4784 service (expected ${ATOM_RUNTIME_CONTRACT})`
    );
  }
  return payload.result;
}

const TRANSFORM_HELP = Object.freeze({
  rep: '{"thing":"A","situation.rep.NEW"}；局部替换用 "situation.rep.NEW":"OLD"；support 全替换用 "support.rep.":[{"if@current":true,"then":[{"thing":"TARGET"}]}]',
  sum: '{"thing":"A","situation.sum.SUMMARY"}（只更新 situation 简介）',
  typ: '{"thing.typ.TYPE":"A"}（替换类型标记）；{"thing.typ.":"A"}（移除类型标记）',
  ren: '{"thing.ren.NEW_THING":"A"}（同级必须保持唯一）',
  mov: '{"thing.mov.DESTINATION_PATH":"A"}（移动 contain 子树；移至顶层时 DESTINATION_PATH 使用“世界之外”；拒绝形成循环）',
  cpy: '{"thing.cpy.DESTINATION_PATH":"A"}（复制 contain 子树）',
  dsc: '{"thing.dsc.":"A"}（可逆移入唯一默认备份仓）',
  rst: '{"thing.rst.":"BACKUP_PATH/A"}（按丢弃记录恢复原位置）',
  run: '{"thing.run.":"PROGRAM_PATH"}（显式运行唯一 @program）'
});

const EXPLORE_HELP = Object.freeze({
  'situation\u0000full': 'situation$full（返回完整 situation；否则可只返回简介）',
  'situation\u0000lock': 'situation$lock（只读返回当前 exact 节点的已编译锁状态，不读取或改写 backing JSON）',
  'contain\u0000latitude': 'contain$latitude+1 / contain$latitude-1（向上看一层 / 向下看一层；向下结果保留嵌套 contain；数字可调整，0 为锚点层）',
  'contain\u0000longitude': 'contain$longitude+1 / contain$longitude-1（向后看一个同级 / 向前看一个同级；数字可调整，0 为锚点）'
});

function verifiedHelpLines() {
  const transformNames = Object.keys(TRANSFORM_HELP);
  if (transformNames.length !== TRANSFORM_COMMANDS.length
    || TRANSFORM_COMMANDS.some((name) => !Object.hasOwn(TRANSFORM_HELP, name))) {
    throw cliError('ATOM_HELP_CONTRACT_DRIFT', 'Transform 注册表与 help 契约不一致');
  }
  const activeActions = createActionRegistry().entries()
    .filter(({ parameter }) => parameter !== 'retiredRoute');
  if (activeActions.length !== Object.keys(EXPLORE_HELP).length
    || activeActions.some(({ baseKey, name }) => !Object.hasOwn(EXPLORE_HELP, `${baseKey}\u0000${name}`))) {
    throw cliError('ATOM_HELP_CONTRACT_DRIFT', 'Explore 动作注册表与 help 契约不一致');
  }
  const functionRegistry = programFunctionRegistry();
  const familyLines = (layer) => functionRegistry.functionFamilies
    .filter((family) => family.layer === layer)
    .map((family) => {
      const names = functionRegistry.functions
        .filter((entry) => entry.layer === layer && entry.family === family.id)
        .map((entry) => entry.name);
      return names.length ? `  ${family.label}：${names.join('、')}` : null;
    })
    .filter(Boolean);
  return {
    transform: TRANSFORM_COMMANDS.map((name) => `  .${name}.  ${TRANSFORM_HELP[name]}`),
    explore: activeActions.map(({ baseKey, name }) => `  ${EXPLORE_HELP[`${baseKey}\u0000${name}`]}`),
    programFunctions: [
      '内核函数：',
      ...familyLines('kernel'),
      '应用函数：',
      ...familyLines('application')
    ]
  };
}

function help() {
  const contract = verifiedHelpLines();
  return [
    'atom',
    '',
    '用途：其他 session 的 Agent 仅凭本页完成安全的日常读取、改造、Program 复用、验收和反馈。',
    '',
    '调用格式：',
    '  atom.cmd --% --agent AGENT atom',
    '  atom.cmd --% --agent AGENT explore|explore new "{...}"',
    '  atom.cmd --% --agent AGENT transform|transform new "{...}"',
    '  atom.cmd --% --agent AGENT submit "{...}"',
    '  PowerShell：$request | atom.cmd --agent AGENT --stdin',
    '',
    'Options:',
    '  --agent AGENT      必填；exact 且唯一的已声明 Agent Program 名称或路径',
    '  --endpoint URL     显式指定隔离 Atom command endpoint；省略时使用本机 4784',
    '  --stdin            从标准输入读取一条完整 Atom 命令；用于变量、多行、长文本和特殊字符',
    '  --json             已弃用的兼容选项；Atom 命令结果仍为 Graph-JSON',
    '  --program-function-registry  输出 CLI/Web/Program 共用的注册函数、分层职能组 scope 与 Atom 类型契约',
    '  --work-order-registry  输出 CLI/Web 共用的工单动作、错误与回执契约',
    '  -h, --help         显示帮助',
    '',
    'Agent 入口：',
    '  --agent 只指定本次交互的上下文来源，不指定节点的归属或写入位置，也不代表身份、权限或锁。',
    '  查询或写入的事实目标不得代替 --agent 上下文来源；目标 Atom 本身不需要是 Agent Program。',
    '  会话已给出或已绑定唯一已声明 Agent Program 时直接复用，不得重复询问；只有上下文来源确实未知或不唯一时才请求明确。',
    '  每条非交互命令都原样携带已绑定的 Agent Program；CLI 不会把目标 thing 自动当作 --agent。',
    '  短名必须唯一；重名时增加必要路径片段。仍无法确定上下文时联系任务派发方或维护入口。',
    '  进入交互会话：atom.cmd --agent AGENT；Ctrl+C 退出。',
    '  PowerShell 固定短 JSON 可使用 --%；--% 会停止变量展开，变量、多行或长文本必须通过 --stdin 传入。',
    '',
    '日常闭环：',
    '  1. explore 当前锚点和最小必要邻域；只依据显式事实与用户授权决定下一步。',
    '     用户要求使用或创建一个命名节点时，先 explore 预定父节点及其直接子节点：已有相同或明确等价节点则复用；确实没有可复用节点时才 transform new。',
    '  2. 优先运行已有 Program/模板；没有适用能力时才执行最小 transform。',
    '  3. 每次写入后重新 explore 实际写入的 Atom 及其必要 contain、support 和 situation。',
    '  4. 以回读事实验收；Program 消息不是其他 Agent 已改变的证明。失败按下方错误动作处理。',
    '',
    'Graph-JSON 基础：',
    '  thing 使用最短唯一 exact 选择器；situation 是内容；contain 是真实包含；support 是 owner-local if→then 规则数组。',
    '  1→N 写在起点：{"if@current":true,"then":[{"thing":"B"},{"thing":"C"}]}；N→1 写在终点：{"if":[{"and":[{"thing":"A"},{"thing":"B"}]}],"then@current":true}。',
    '  每条 rule 必须且只能含一个 @current:true；if 永远是前项，then 永远是后项。禁止无 current、线载源码和 Program 自持 current 端点；禁止原生 N→M，事实前项与独立判定 Program 保持分层。',
    '  if 内的独立判定 Program 写 {"thing@program":"selector"}：仅以 strict bool 决定本条支撑，且不得产生写入等副作用；then 只接受普通事实 Thing。后项自己的 Program 只按自身 trigger/use_program/显式运行计算自己。',
    '  N→1、1→N 各自保留 support clause 身份；Web 在归一化 0.5 形成共享汇流／分流线干。多入多出必须建立显式枢纽 H，拆为 N→H 与 H→M 两条规则；H 保持可见可审计。Program 源码只放 exact thing@program 节点的 situation。',
    '  @type 写在 thing 键上（如 thing@program）；#简介必须在键末尾；~hint 仅为返回提示。Agent 是 Situation 中一个顶层字面量 agent({...}) 声明，不是 Key 类型。',
    '  Explore 接受对象或对象数组；Transform 对象数组把已有 Atom 改造作为一个原子批次执行，并逐项返回结果。所有结果只使用 Graph-JSON。',
    '',
    'Explore 契约（只读，不修复或写入投影）：',
    '  atom.cmd --% --agent 工作Agent explore "{""thing"":""目标节点"",""situation$full"":true,""contain$latitude+1"":true,""contain$longitude+1"":true,""support"":true}"',
    '  thing 默认 exact；短名重名时逐步增加必要的上级路径片段。顶层同名目标使用“世界之外/目标名”精确选择。fuzzy、regex、vector 不支持。',
    '  “世界之外”以 thing@universe 暴露为不落盘的虚拟父级；用于读取、上下钻、顶层消歧，以及作为 .mov. 的顶层目的地。',
    ...contract.explore,
    '  每次成功命中 exact 锚点都会返回 boundary~preview；up/down/left/right 分别给出视野外 state、hasMore、nodes、characters，并随重新锚定更新。protected 方向不公开精确数量且不得当作空白。',
    '  读取投影推荐使用标准 JSON true（例如 ""situation$full"":true、""support"":true）；无值投影键继续兼容。',
    '  support 按原始 ordinal 回读 owner 声明；从任一相关端查询会带出唯一 owner 节点及其完整 if→then rule，不复制持久声明。',
    '  多层向下查询按真实包含关系返回嵌套 contain；thing 仅在需要消歧时增加最短必要路径片段。',
    '  explore new 使用同一查询契约，并重置本次探索上下文；空结果返回 explore~empty/new，不代表错误。',
    '',
    'Transform 契约（目标 thing 必须 exact 且唯一；写入后必须回读）：',
    '  transform new 创建完整 Atom；新节点的归属由 thing 中的精确父路径决定，与 --agent 无关。',
    '  thing 可用“精确父路径/新名称”创建子 Atom，省略父路径则创建顶层 Atom；父路径不明确时只询问父 Atom。',
    '  Transform 对象数组可批量改名、移动或更新已有 Atom 的 situation/support：任一项失败整批不写；成功后整批只做一次权威提交。',
    '  批量改名按最终状态统一校验，可交换同级名称；整批统一重写后代路径与 support selector。批量改名项不得混入移动、situation 或 support。',
    '  situation 和 support 的全文替换必须显式使用 .rep.；每个对象的结构操作只能有一个。',
    ...contract.transform,
    '',
    'Program 模板与复用：',
    '  @program 是唯一可执行类型，situation 直接保存 Python；普通交互不得手工替代已有 Program 或模板。',
    '  本 Atom Program 可自行研发、研磨并通过 use_program() 复用；成熟实现也可作为后续公共能力素材。',
    '  注册表与底层运行时不通过 Program 开放修改；这项保护不限制 Agent 自行研发 Program。',
    ...contract.programFunctions,
    '  注册函数目录：function_catalog({layer?,family?,scope?})；完整公共契约可用 atom.cmd --program-function-registry 读取。',
    '  Form 评估：form({"action":"evaluate","components":[{"name":"组件","activation":"required|optional|disabled","value":{},"requirements":[{"path":["JSON键","下级键"]}],"components":[]}]})；components 可递归嵌套。',
    '  Form 返回 valid、required、optional、disabled、active、missing；missing 每项为 {"component":["组件路径"],"path":["缺失键路径"]}。required 必参与；optional 在自身或后代有内容时参与；disabled 子树不参与校验；未使用的 optional 不形成缺项。',
    '  多选函数：choice({id,options:[{id,label}],selected:[id],empty})；参数必须使用双引号标准 JSON（同时是合法 Python），当前仅支持多选，返回 selected 数组并在显式 .run. 回执中公开 choices。',
    '  Program 并发独立运行并共享单轮 10 秒时间预算；单项失败独立报告，超时自动中断。短期内避免编写超出该预算的复杂 Program。',
    '  Program transform 创建：transform({"thing":"精确父路径/新节点","situation":"内容","contain":[],"support":[]})；完整四轴且无点号指令时创建，带点号指令按更新处理。',
    '  transform() 返回 None，只表示登记了延后效果；实际提交必须以交互回执或后续 exact explore 回读确认。',
    '  JSON 函数：json_parse({"text":"..."})->JSON值；json_stringify({"value":...,"indent"?:0..8})->string。序列化默认紧凑，拒绝 NaN、Infinity 和非 JSON 值；失败将终止整个 Program 评估且不发布已登记效果；不开放 import/eval；可配合 situation.rep. 写回。',
    '  世界函数：explore(query)->rows；transform(spec)、shortcut(spec)、agent(spec)、slot_body(spec)、lock(spec)、message(spec)->effect；current_atom()->Program。',
    '  虚拟引用：target = explore({"thing":"EXACT目标"})[0]；shortcut({"placement":"contain","thing":"显示名","target":target})在当前 Program 直接 contain 下创建引用。resolved = explore({"thing":"EXACT快捷入口"})[0] 仍是透明目标 ThingCoordinate；仅在本次 Agent 已获统一 Graph 读取授权时，resolved.shortcut_reference 才提供该入口的精确引用记录 ThingCoordinate（父 contain Explore 的对应透明结果同样提供）。shortcut({"action":"delete","reference":resolved.shortcut_reference})只删除引用，不改变目标，也不删除创建 Program。目标坐标、路径字符串和 .ref 均不能代替引用坐标。引用不复制目标事实、不携带创建者权限；每次查看均以本次 Agent 的普通 Explore 鉴权解析目标。首版 Transform 不经引用重定向。',
    '  Agent登记：当前 Program 调用 agent({"labels":["^^","业务标签"],"functions":{"groups":["form"],"names":["message"]}}) 即把本节点登记为 Agent；无 target／lock／mode。labels、groups、names 必须是源码中的 JSON literal，functions 必填且禁止 null、通配。',
    '  职能 scope：groups 是正式分层权限，运行时按当前 registry 获得该组及后代组的函数；names 是冻结的具体函数授权。子窗口只能获得创建者 scope 本身、后代组或其函数，不能上铸祖先组、跨到同级其他职能树，仅持有 name 也不能铸造 group。',
    '  标签边界：连续 ^ 只表示管辖等级，普通字符串是业务标签，两者不混算；自身或子 Agent 的 ^ 数量不得超过创建者。持有 ^ 的 Agent 可在既有 Graph 活动空间内定义普通标签；子 functions 必须通过创建者符号 scope 的同组或后代关系校验。',
    '  Agent 重配：对 Agent Program 的 situation.rep 与普通 Transform 共用同一实际路径鉴权；当前 Agent 钥匙标签逐层匹配 contain／node 锁标签，自身与后代不设特殊管理通道，新的 labels／groups／names 不得超过调用方已持有范围。',
    '  权限索引：软件在 Agent、标签、锁或路径变化时增量更新可丢弃索引；请求命中即用，缺失或失效则沿实际路径即时计算并回填。索引缺失不得阻断启动、Explore 或 Transform。',
    '  窗口跳转：jump({"when":when_program,"where":where_program,"recycle":recycle_program})；三项均可省略，recycle=true 直接回收，随后才算 when，且仅 when=true 才算 where；省略 when 即守窗。jump 定位复用 Explore、移动复用 Transform，并通过同一 Graph 鉴权链。',
    '  受控横向迁窗：上级 Program 须显式获授 names:["jump_authorize"]，并在自身合法域内用 window=explore({"thing":"EXACT窗口"})[0]、source=explore({"thing":"EXACT注册Program"})[0]、destination=explore({"thing":"EXACT目的地"})[0] 后调用 jump_authorize({"window":window,"source":source,"destination":destination})。函数只返回 {"planned":true}，凭据不暴露；内核在 source 下生成一次性授权坐标。执行窗口的 where 返回该授权的 explore() 坐标后，仍按 recycle→when→where 顺序消费；落地前复验签发方当前 Graph 权限并在中央事务内移动与删授权。',
    '  受控迁窗边界：jump_authorize 只能用具体 names 授予且不可委派；执行窗口不能读取目的地 situation、改目的地、篡改／复制／重放授权。预传 ThingCoordinate、完整路径、短名、.ref、support 或 shortcut 都不携带迁移权限；签发方失权、Graph 世代变化、节点／contain 锁拒绝或提交失败时窗口原位不动。',
    '  精确坐标：when_program = explore({"thing":"EXACT判定@program"})[0]；把 explore() 返回对象直接交给 jump 或锁规则，不使用 .ref。jump 的 when／where／recycle 及 where 返回值只接受 ThingCoordinate；短名字符串与完整 EXACT_PATH 字符串均拒绝，数组位置也不得猜测。精确字符串兼容仅保留于 use_program.name 与 CLI thing.run. 选择器，不扩散到 jump；旧 AtomView 仅由内部适配层兼容。',
    '  变化探针：def main(arguments):\n    point = explore({"thing":"EXACT监测Thing"})[0]\n    if not changed([point]):\n        return\n    # 命中后才 explore／聚合／计算。changed 只返回 bool 并登记既有 Transform 反向索引，控制流必须由调用方显式短路。',
    '  固定窗口锁：agent() 登记时由内核强制启用且不可关闭或自定义；可读 current／后代／同父普通节点／唯一直接父上下文，可写 current 后代。直接父不能成为新锚点进入其同层；exact path 不绕过。',
    '  冷启动：内核从包含一个顶层字面量 agent({...}) 声明的 thing@program Situation 重建 labels 与符号职能 scope，并从 Program 中的 literal-path lock() 按当前 Graph 重编译锁；旧侧车 locks 返回 RETIRED_REQUEST_DRIVEN_LOCK_SNAPSHOT，agentRegistrations 返回 RETIRED_AGENT_REGISTRATION_SNAPSHOT，windowSelfLocks/windowSelfLockAgents 返回 RETIRED_WINDOW_SELF_LOCK_SNAPSHOT，均只能一次性审计清退且不作为鉴权输入。',
    '  Transform 触发器：先定义无参数 main，再声明 trigger("transform", {"nodes":["exact 节点路径"]}, main)。main 是函数引用，不能写 main()；运行时按反向索引只运行命中的 Program；相同值写入仍属于 Transform 事件。未声明 trigger 的 Program 冷启动时遇到无关 Transform 不会重放；显式 .run.、其自身被 Transform 或已知 explore 依赖变化时仍运行。',
    '  推支触发器：普通前项／后项不保存布尔值；独立判定 Program strict true 后只形成 typed delivery，不直接执行后项。后项自己的 Program 可声明 trigger("support", {"nodes":["exact 或槽例相对后项路径"]}, main)，其中 main(delivery) 接收 decision、clauseId、antecedentPaths、consequentPath 与 revision；未显式订阅、false、仅 contain／support 关联均不执行。',
    '  Program 停用：把 Program 本身或其普通 contain 上级通过 .dsc. 可逆移入唯一 thing@backup@default 子树；其中 @program 保留类型与 situation 源码，但不进入活跃运行、trigger、changed 或 explore 依赖索引，也不能由 thing.run/use_program 执行。.rst. 恢复原位后按当前事实重新激活并重建索引。停用只认显式 backup@default 类型，不根据容器显示名猜测。',
    '  统一鉴权顺序：当前 Agent 起点 → 实际 contain 路径上的锁 → 目标 node 锁；Explore、Transform 及注册函数内部读写共用此链，标签不足返回锁拒绝且不读取目标 situation。',
    '  模板函数：template_catalog(spec)->entries；instantiate({template,version,mode,parameters})->result；use_program({name,arguments})->result。',
    '  Program 复用：use_program({"name": explore({"thing":"EXACT @program 路径"})[0], "arguments": {...}})；坐标会按当前窗口与 Program 边界重新授权。精确字符串名称或路径继续兼容；不使用 .ref。',
    '  槽体研发：槽体首次只放一棵普通可自运行候选 DataFlow（下级槽、contain、support、@program）；研发态可用 transform {"thing.run.EXACT候选根路径":"EXACT_PROGRAM_PATH"} 绑定当前域，Program 内仅用 . 或 ./相对 contain 路径。',
    '  槽体封装：上层注册 Program 调用 slot_body({"action":"seal","body":"EXACT槽体路径"})；中央事务把同一候选保留为槽模，并生成“槽模／print@program／槽例”。不预建空槽例，print 计划在 Graph 中可 exact explore 审计。槽 detail／situation 是说明契约，计划不含默认料。',
    '  槽体结构锁：seal 固定自动保护当前及未来映射槽 self 的名称／结构／support／Program 规则，不接受 lock 开关；槽下未映射料初始可写，伪造槽角色返回 SLOT_ROLE_FORGERY_DENIED。审核等业务冻结使用通用 lock()。',
    '  业务状态锁：持久声明使用 lock({"targets":{"paths":["EXACT路径"],"scope":"exact|subtree"},"actions":["explore|transform"],"labels":["标签"]}) 的顶层 literal，冷启动按当前 Graph 重编译；动态或未知目标稳定拒绝。lock() 不能覆盖固定 Agent／槽体锁；条件动作由后项自己的 support trigger 直接消费 typed true，不重复 Explore 判定。',
    '  槽体打印：唯一公开调用是 use_program({"name":"EXACT槽体/print","arguments":{"name":"新槽例名"}})；name 是唯一打印参数，修订由当前 print@program 内部绑定，调用方不得传 revision。可用 explore {"thing":"EXACT槽体/print/修订","contain$latitude-1":true} 审计当前计划；内核复制全部抽象槽、嵌套 contain、support、类型和槽契约，不复制具体料，Program 只在槽模共享一份。',
    '  槽例填写与计算：用 transform {"thing":"EXACT槽体/槽例/实例/槽","situation.rep.填写值"} 填写槽的 situation；具体料应作为槽下未映射普通 Thing 创建。字段事件按“所属槽例→相对角色→当前修订 support→共享 Program”只在当前槽例域运行，再用 exact explore 回读该实例结果与采用槽模修订。禁止绝对实例路径、越过嵌套槽例边界、跨槽例或外部资料访问。',
    '  槽例填料与变量：带“槽模角色”的实例节点是抽象槽；在槽下 transform new 的未映射普通 Thing 子树才是本地料。外部变量必须先物化为目标槽例内的本地料 Thing，再触发该实例；共享 Program 只用 ./相对contain路径读取当前槽例域。',
    '  槽模修订：由同一 Program 在同一中央事务内先 transform 同一槽体的槽模，再 slot_body({"action":"seal","body":"EXACT槽体路径"})；只有这种同 Program、同槽体的组合获得 slot-reseal 能力，普通直改仍被结构锁拒绝。成功后自动同步全部所属槽例的映射槽、contain、support、契约元数据与共享 Program 引用，并逐字节保留未映射本地料 Thing 子树；删除含料槽整次冲突回滚。',
    '  槽体错误：INVALID_SLOT_BODY_EFFECT、INVALID_SLOT_BODY_LAYOUT、INVALID_SLOT_PRINT_PLAN、SLOT_BODY_NOT_SEALED、SLOT_PRINT_PLAN_STALE、SLOT_BODY_EXAMPLE_EXISTS、SLOT_MATERIAL_CONTAINMENT_CONFLICT、SLOT_INSTANCE_REVISION_MISSING、SLOT_SCOPE_ROOT_UNBOUND、SLOT_RELATIVE_SELECTOR_REQUIRED、SLOT_RELATIVE_TARGET_NOT_FOUND、SLOT_RELATIVE_TARGET_AMBIGUOUS、SLOT_SCOPE_BOUNDARY_CROSSING、SLOT_SCOPE_ROLE_MISMATCH、SLOT_BODY_NESTED_EFFECT_FORBIDDEN；任一失败不产生半份槽例。',
    '  工单函数：work_order_catalog({template?,version?})->contract；work_order({action,...})->result。v1 动作固定为 create/fill/validate/submit/reject/revise/read-back。',
    '  工单公开契约：atom.cmd --work-order-registry；该只读命令无需 --agent，Web 帮助从同一注册表渲染动作、错误和提交回执字段。',
    '  工单写入只能由 Program 发出并继续经过 Transform、修订检查和中央提交；调用时使用精确版本、稳定 creation_id 与 exact path，写后按 read-back 和世界回读验收。',
    '  规划函数：direct_children(rows,parent_path)、child_detail(rows,parent_path,name,default)、missing_details(rows,parent_path,names)、form_status(rows,parent_path,status_name)、first_pending(forms,completed_states)、transition_allowed(current,requested,transitions)、subtree_refs(rows,root_path)、plan_shards(sources,spec)、plan_form_flow(rows,parent_path,standard)、plan_template_instance(rows,parent_path,template)。',
    '  模板参数以 template_catalog({}) 返回的契约为准；被 use_program 调用的 Program 必须定义 main(arguments)。',
    '  推进流两步配方：当前 Agent 必须实际持有下列 agent／instantiate 等固定函数名；第1步只创建 Program，第2步显式运行后，agent() 把当前 Program 登记为 Agent，instantiate() 在同一事务附加完整推进流。',
    '    第1步：transform new {"thing@program":"当前Agent/任务区/任务名","situation":"agent({\\"labels\\":[],\\"functions\\":{\\"groups\\":[],\\"names\\":[\\"agent\\",\\"current_atom\\",\\"explore\\",\\"first_pending\\",\\"form_status\\",\\"instantiate\\",\\"lock\\",\\"message\\",\\"subtree_refs\\",\\"transform\\"]}})\\ninstantiate({\\"template\\":\\"advancement-flow\\",\\"version\\":\\"latest\\",\\"mode\\":\\"ensure\\",\\"parameters\\":{\\"title\\":\\"任务标题\\"}})","contain":[],"support":[]}',
    '    第2步：transform {"thing.run.":"当前Agent/任务区/任务名"}',
    '  “任务区”必须是当前窗口下已获准写入的普通事实父节点；不要通过给窗口自身追加 contain 绕过固定锁。两步均须使用当前已认证 --agent 选择已声明 Agent Program 并走统一 Graph 权限域；第2步成功回执后再 exact explore 回读新 Agent 与推进流。需要随职能树集中变更时使用 groups，需要冻结权限时使用最小 names；不得用公开 Transform 创建 Agent Key 类型。',
    '',
    '反馈：',
    '  submit {"type":"bug|pain|requirement|optimization","detail":"1 至 10000 字说明"}',
    '  反馈记录当前 Agent Program 和本会话最近历史；反馈不绕过锁，也不证明问题已修复。',
    '',
    '错误处理与下一步动作：',
    '  先按对应错误的纠正提示处理；纠正提示仍无法解除阻断、CLI 已无法正常使用时，才 submit bug 或 requirement。',
    '  AGENT_NOT_FOUND / AGENT_TYPE_REQUIRED / AMBIGUOUS_AGENT：只修正 --agent 上下文来源；不得把查询目标改成 Agent Program 或拿它代替入口；未知入口联系派发方。',
    '  INVALID_GRAPH_JSON：固定短 JSON 检查语法后重试；变量、多行或长文本改用 --stdin，不猜测、不改 backing JSON。',
    '  UNKNOWN_* / INVALID_*：按错误中的纠正提示修正输入后重试。',
    '  AMBIGUOUS_ATOM_NAME：重新 explore 预定父节点及必要同级；使用能唯一表征目标的最短 exact 路径。',
    '  ATOM_NOT_FOUND：若用户意图是使用或创建该节点，先 explore 预定父节点及直接子节点，复用相同或明确等价节点；确实不存在时，以“精确父路径/新名称”执行 transform new。父路径不明确时只询问父 Atom。',
    '  WORLD_REVISION_CONFLICT：停止当前写入，重新读取最新事实，再基于新修订重新判断；不得盲目重放。',
    '  PROGRAM_LOCK_DENIED / WINDOW_ACCESS_DENIED：停止修改并按错误提示处理，不绕过锁。',
    '  ATOM_ENGINE_UNAVAILABLE：确认 4784 服务可用；仍失败则联系维护入口。',
    '  PROJECTION_RECOVERY_PENDING：事实写入已成功，只是可丢弃派生投影待恢复；禁止重复写入。4784 应继续服务；维护入口仅限本机 POST /__atom/api/recover-projection，并使用 projectionRecovery.expectedRevision。',
    '  ATOM_PROGRAM_TIMEOUT / ATOM_PROGRAM_CANCELLED / ATOM_PROGRAM_FAILED：不得手工仿制 Program；回读事实并按错误提示处理。',
    '  未知损坏或无法确认提交状态：停止写入并联系维护入口。日常 Agent 不直接执行事务或投影恢复。'
  ].join('\n');
}

function cliError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireExecutionCapability(execute) {
  if (typeof execute !== 'function') {
    throw cliError(
      'ATOM_EXECUTION_CAPABILITY_REQUIRED',
      'Atom CLI requires an explicit application execution capability'
    );
  }
  return execute;
}

function parseCliArgs(argv) {
  let contextFile;
  let projectionFile;
  let endpoint;
  let agent;
  let global = false;
  let explicitContext = false;
  let json = false;
  let readSourceFromStdin = false;
  let workOrderRegistryRequested = false;
  let programFunctionRegistryRequested = false;
  const source = [];
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!positionalOnly && argument === '--') {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && (argument === '--help' || argument === '-h')) {
      return { help: true, source: [] };
    }
    if (!positionalOnly && argument === '--json') {
      json = true;
      continue;
    }
    if (!positionalOnly && argument === '--stdin') {
      readSourceFromStdin = true;
      continue;
    }
    if (!positionalOnly && argument === '--endpoint') {
      const value = argv[index + 1];
      if (!value) throw cliError('MISSING_CLI_OPTION_VALUE', '--endpoint 需要 URL 参数值');
      try {
        const parsedEndpoint = new URL(value);
        if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) throw new TypeError('protocol');
      } catch {
        throw cliError('INVALID_CLI_ENDPOINT', '--endpoint 必须是 http(s) command endpoint URL');
      }
      endpoint = value;
      index += 1;
      continue;
    }
    if (!positionalOnly && argument === '--work-order-registry') {
      workOrderRegistryRequested = true;
      continue;
    }
    if (!positionalOnly && argument === '--program-function-registry') {
      programFunctionRegistryRequested = true;
      continue;
    }
    if (!positionalOnly && argument === '--global') {
      global = true;
      continue;
    }
    if (!positionalOnly && argument === '--agent') {
      const value = argv[index + 1];
      if (!value) throw cliError('MISSING_CLI_OPTION_VALUE', `${argument} 需要参数值`);
      agent = value;
      index += 1;
      continue;
    }
    if (!positionalOnly && (argument === '--session' || argument === '--window')) {
      throw cliError(
        'LEGACY_AGENT_ENTRY_OPTION',
        `${argument} 已停用；请使用 --agent 选择已声明 Agent Program 上下文起点`
      );
    }
    if (!positionalOnly && (argument === '--context' || argument === '--file')) {
      const value = argv[index + 1];
      if (!value) throw cliError('MISSING_CLI_OPTION_VALUE', `${argument} 需要文件路径`);
      contextFile = value;
      explicitContext = true;
      index += 1;
      continue;
    }
    if (!positionalOnly && argument === '--projection') {
      const value = argv[index + 1];
      if (!value) throw cliError('MISSING_CLI_OPTION_VALUE', '--projection 需要文件路径');
      projectionFile = value;
      index += 1;
      continue;
    }
    if (!positionalOnly && argument.startsWith('-')) {
      throw cliError('UNKNOWN_CLI_OPTION', `未知 atom CLI 选项：${argument}`);
    }
    source.push(argument);
  }
  return {
    help: false,
    contextFile,
    projectionFile,
    endpoint,
    agent,
    global,
    explicitContext,
    json,
    readSourceFromStdin,
    workOrderRegistry: workOrderRegistryRequested,
    programFunctionRegistry: programFunctionRegistryRequested,
    source
  };
}

async function readCommandSource(stream) {
  let source = '';
  const decoder = new StringDecoder('utf8');
  for await (const chunk of stream) {
    source += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
  }
  source += decoder.end();
  if (!source.trim()) {
    throw cliError('EMPTY_STDIN_COMMAND', '--stdin 未收到 Atom 命令');
  }
  return source.replace(/^\uFEFF/u, '');
}

function requestIsComplete(source) {
  const text = source.trim();
  if (!text) return false;
  const payloadStart = text.search(/[\[{]/u);
  if (payloadStart < 0) return true;
  const stack = [];
  let quoted = false;
  let escaped = false;
  for (let index = payloadStart; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === '{' || character === '[') stack.push(character);
    if (character === '}' || character === ']') stack.pop();
  }
  return !quoted && stack.length === 0;
}

function stripCopiedSessionPrompt(line) {
  const commandPrompt = line.match(/^atom(?:\[[^\]]+\])?>\s?(.*)$/u);
  if (commandPrompt) {
    return { line: commandPrompt[1], copiedPrompt: true };
  }
  const continuationPrompt = line.match(/^\.\.\.\s?(.*)$/u);
  if (continuationPrompt) {
    return { line: continuationPrompt[1], copiedPrompt: true };
  }
  return { line, copiedPrompt: false };
}

function isCompleteGraphJson(source) {
  if (!requestIsComplete(source)) return false;
  try {
    parseGraphJson(source);
    return true;
  } catch {
    return false;
  }
}

function writeDiagnostics(result, stderr) {
  if (result?.ok === false && typeof result.interactionId === 'string' && result.interactionId) {
    stderr.write(`关联 ${result.interactionId}\n`);
  }
  for (const message of result.messages ?? []) {
    stderr.write(`Program ${message.level ?? 'info'}: ${message.text}\n`);
  }
  for (const warning of result.warnings ?? []) {
    stderr.write(`提示 ${warning.code ?? 'ATOM_LANGUAGE_WARNING'}：${warning.message}\n`);
  }
  for (const error of result.errors ?? []) {
    stderr.write(`错误 ${error.code}：${error.message}\n`);
  }
}

function graphObject(entries) {
  return { kind: 'object', entries };
}

function graphEntry(key, valuePresent = false, value) {
  return valuePresent
    ? { key, valuePresent: true, value }
    : { key, valuePresent: false };
}

function graphBoundary(boundary) {
  const directions = ['up', 'down', 'left', 'right'];
  return graphObject(directions.map((direction) => graphEntry(
    direction,
    true,
    graphObject(Object.entries(boundary?.[direction] ?? {}).map(([key, value]) => (
      graphEntry(key, true, value)
    )))
  )));
}

function graphMatch(match, hint = null, boundary = null) {
  const types = (match.types ?? []).map((type) => `@${type}`).join('');
  const transientHint = hint ? `~${hint}` : '';
  const entries = [
    graphEntry(`thing${types}${transientHint}`, true, match.selector ?? match.thing)
  ];
  const descriptionPresent = (
    match.description !== null && match.description !== undefined
  );
  const detailPresent = Object.hasOwn(match, 'situation');
  if (descriptionPresent || detailPresent) {
    entries.push(graphEntry(
      `situation${descriptionPresent ? `#${match.description}` : ''}`,
      detailPresent,
      match.situation
    ));
  }
  if (Array.isArray(match.support)) {
    entries.push(graphEntry('support', true, match.support));
  }
  if (match.lockState) {
    entries.push(graphEntry('lock~active', true, match.lockState));
  }
  if (match.lockStatus) {
    entries.push(graphEntry('lock~status', true, match.lockStatus));
  }
  if (match.resolvedThroughShortcut) {
    const marker = match.resolvedThroughShortcut;
    entries.push(graphEntry('shortcut~resolved', true, graphObject([
      graphEntry('identity', true, marker.identity),
      graphEntry('thing', true, marker.thing),
      graphEntry('placement', true, marker.placement),
      graphEntry('path', true, marker.path)
    ])));
  }
  if (boundary) {
    entries.push(graphEntry('boundary~preview', true, graphBoundary(boundary)));
  }
  return graphObject(entries);
}

function graphChildrenTree(item) {
  const matches = item.matches ?? [];
  const byPath = new Map(matches.map((match) => [match.path, match]));
  const childrenByPath = new Map();
  for (const match of matches) {
    const parentPath = match.path.split('/').slice(0, -1).join('/');
    if (!childrenByPath.has(parentPath)) childrenByPath.set(parentPath, []);
    childrenByPath.get(parentPath).push(match);
  }
  function build(match) {
    const value = graphMatch(match);
    const children = childrenByPath.get(match.path) ?? [];
    if (children.length) {
      value.entries.push(graphEntry('contain', true, {
        kind: 'array', values: children.map(build)
      }));
    }
    return value;
  }
  const root = byPath.get(item.presentation?.anchorPath);
  if (!root) return null;
  const tree = build(root);
  if (item.boundary) {
    tree.entries.push(graphEntry('boundary~preview', true, graphBoundary(item.boundary)));
  }
  return tree;
}

function graphResult(result) {
  if (result.command === 'atom') {
    const count = Number.isInteger(result.atomCount) ? result.atomCount : null;
    const entries = [graphEntry(count === null ? 'atom~ready' : `atom~count${count}`)];
    if (result.agent) entries.push(graphEntry('agent~current', true, result.agent));
    return graphObject(entries);
  }
  if (result.command === 'explore') {
    const values = (result.items ?? []).flatMap((item) => {
      if (item.presentation?.kind === 'children-tree') {
        const tree = graphChildrenTree(item);
        return tree ? [tree] : [];
      }
      return (item.matches ?? []).map((match) => graphMatch(
        match,
        null,
        match.path === item.anchorPath ? item.boundary : null
      ));
    });
    if (values.length === 1) return values[0];
    if (values.length > 1) return { kind: 'array', values };
    if (result.ok) {
      return graphObject([
        graphEntry(result.newExploration ? 'explore~new' : 'explore~empty')
      ]);
    }
    return null;
  }
  if (result.command === 'transform' && result.batch && Array.isArray(result.results)) {
    const values = result.results.map((item) => {
      const hint = item.changed ? 'updated' : 'unchanged';
      return graphMatch(item.result, hint);
    });
    return { kind: 'array', values };
  }
  if (result.command === 'transform' && result.result) {
    const hint = result.createNew
      ? 'created'
      : (result.changed ? 'updated' : 'unchanged');
    const types = (result.result.types ?? []).map((type) => `@${type}`).join('');
    const entries = [
      graphEntry(`thing${types}~${hint}`, true, result.result.thing)
    ];
    if (result.archive) {
      entries.push(
        graphEntry('archive~id', true, result.archive.discardId),
        graphEntry('archive~path', true, result.archive.path),
        graphEntry('restore~coordinate', true, result.archive.restoreCoordinate)
      );
    }
    if (Array.isArray(result.program?.choices)) {
      entries.push(graphEntry('choices', true, result.program.choices));
    }
    return graphObject(entries);
  }
  if (result.command === 'submit' && result.submission) {
    return graphObject([
      graphEntry('submit~recorded'),
      graphEntry('id', true, result.submission.id),
      graphEntry('type', true, result.submission.type),
      graphEntry('submittedAt', true, result.submission.submittedAt)
    ]);
  }
  if (result.ok) return graphObject([graphEntry('atom~done')]);
  return null;
}

function writeGraphResult(result, stdout, stderr) {
  const value = graphResult(result);
  if (value) stdout.write(`${formatGraphJson(value, { omitEmptyStructuralArrays: true })}\n`);
  writeDiagnostics(result, stderr);
  return result.ok ? 0 : 4;
}

function storedField(atom, baseKey) {
  for (const [rawKey, value] of Object.entries(atom ?? {})) {
    const parsed = parseAtomKey(rawKey, { descriptionSymbolWarnings: false });
    if (parsed.baseKey === baseKey) return { parsed, value };
  }
  return null;
}

function atomEntries(atoms, agentProgramPaths, parentPath = [], parentAddress = '') {
  const entries = [];
  for (const [index, atom] of (atoms ?? []).entries()) {
    const nameField = storedField(atom, 'thing');
    if (typeof nameField?.value !== 'string') continue;
    const path = [...parentPath, nameField.value];
    const address = parentAddress ? `${parentAddress}/${index}` : `${index}`;
    entries.push({
      name: nameField.value,
      types: nameField.parsed.types.map((type) => type.raw),
      path: path.join('/'),
      address,
      parentAddress,
      detail: storedField(atom, 'situation')?.value ?? '',
      agent: agentProgramPaths.has(path.join('/'))
    });
    const children = storedField(atom, 'contain')?.value;
    if (Array.isArray(children)) entries.push(...atomEntries(children, agentProgramPaths, path, address));
  }
  return entries;
}

async function formatAgentEntryContext(contextFile, agentPath) {
  if (!contextFile || !agentPath) return '';
  const entries = atomEntries(
    await readAtomContext(contextFile, { create: false }),
    new Set([agentPath])
  );
  const current = entries.find((entry) => entry.path === agentPath);
  if (!current) return '';
  const parent = current.parentAddress
    ? entries.find((entry) => entry.address === current.parentAddress)
    : null;
  const peers = entries.filter((entry) => (
    entry.parentAddress === current.parentAddress && entry.address !== current.address
  ));
  const byAddress = new Map(entries.map((entry) => [entry.address, entry]));
  const childrenByParent = new Map();
  for (const entry of entries) {
    const children = childrenByParent.get(entry.parentAddress) ?? [];
    children.push(entry);
    childrenByParent.set(entry.parentAddress, children);
  }
  const graphArray = (values) => ({ kind: 'array', values });
  const graphAtom = (entry, role = null, descendantDepth = 0) => {
    const types = [...(entry.types ?? [])];
    if (role && !types.includes(role)) types.push(role);
    const nameKey = `thing${types.map((type) => `@${type}`).join('')}`;
    const executable = types.includes('program');
    const childEntries = descendantDepth > 0
      ? (childrenByParent.get(entry.address) ?? []).map((child) => (
        graphAtom(child, null, descendantDepth - 1)
      ))
      : [];
    return graphObject([
      graphEntry(nameKey, true, entry.name),
      graphEntry('situation', true, executable ? '' : entry.detail),
      graphEntry('contain', true, graphArray(childEntries)),
      graphEntry('support', true, graphArray([]))
    ]);
  };
  const descendantsOf = (entry) => entries.filter((candidate) => (
    candidate.address.startsWith(`${entry.address}/`)
  ));
  const addressDepth = (address) => address.split('/').length;
  const currentDepth = addressDepth(current.address);
  const downOutside = descendantsOf(current).filter((entry) => (
    addressDepth(entry.address) - currentDepth > 2
  ));
  const siblings = childrenByParent.get(current.parentAddress) ?? [];
  const currentSiblingIndex = siblings.findIndex((entry) => entry.address === current.address);
  const leftOutside = siblings
    .slice(0, currentSiblingIndex)
    .flatMap((entry) => descendantsOf(entry));
  const rightOutside = siblings
    .slice(currentSiblingIndex + 1)
    .flatMap((entry) => descendantsOf(entry));
  const upOutside = [];
  let ancestor = parent;
  while (ancestor?.parentAddress) {
    ancestor = byAddress.get(ancestor.parentAddress) ?? null;
    if (ancestor) upOutside.push(ancestor);
  }
  const previewStats = (outsideEntries) => graphObject([
    graphEntry('nodes', true, outsideEntries.length),
    graphEntry('characters', true, outsideEntries.reduce((total, entry) => (
      total
      + entry.name.length
      + (entry.types.includes('program') ? 0 : entry.detail.length)
    ), 0))
  ]);
  const context = graphObject([
    graphEntry('thing@context', true, current.path),
    graphEntry('situation', true, ''),
    graphEntry('contain', true, graphArray([
      ...(parent ? [graphAtom(parent, 'parent')] : []),
      ...peers.map((entry) => graphAtom(entry, 'peer')),
      graphAtom(current, 'current', 2)
    ])),
    graphEntry('support', true, graphArray([])),
    graphEntry('boundary~preview', true, graphObject([
      graphEntry('up', true, previewStats(upOutside)),
      graphEntry('down', true, previewStats(downOutside)),
      graphEntry('left', true, previewStats(leftOutside)),
      graphEntry('right', true, previewStats(rightOutside))
    ]))
  ]);
  return formatGraphJson(context, { omitEmptyStructuralArrays: true });
}

async function formatRuntimeAgentEntryContext(execute, executionOptions, agentPath) {
  if (!agentPath) return '';
  const result = await execute({
    ...executionOptions,
    source: `explore ${JSON.stringify({
      thing: agentPath,
      'contain$latitude+1': true,
      'contain$latitude-2': true,
      'contain$longitude+1': true,
      'contain$longitude-1': true
    })}`
  });
  if (!result?.ok) return '';
  const value = graphResult(result);
  return value ? formatGraphJson(value, { omitEmptyStructuralArrays: true }) : '';
}

export async function resolveAgentContext(contextFile, selector, options = {}) {
  if (typeof selector !== 'string' || !selector.trim()) {
    throw cliError('AGENT_REQUIRED', '公开 Atom CLI 需要 --agent 上下文起点');
  }
  const requested = selector.trim();
  const atoms = await readAtomContext(contextFile, {
    create: false,
    ...(options.compatibilityManifest
      ? { compatibilityManifest: options.compatibilityManifest }
      : {})
  });
  const scheduler = options.programScheduler ?? createProgramRuntimeScheduler({});
  const security = await scheduler.rebuildAgentSecurity(atoms);
  const directory = agentDirectoryFor(atoms, new Set(security.keys()), options);
  const exact = requested.includes('/')
    ? (directory.byPath.get(requested) ?? [])
    : (directory.byName.get(requested) ?? []);
  const agents = exact.filter((entry) => entry.agent);
  if (agents.length > 1) {
    throw cliError('AMBIGUOUS_AGENT', '只能选择 exact 且唯一的已声明 Agent Program');
  }
  if (agents.length === 1) {
    return {
      ref: crypto.createHash('sha256')
        .update(`${directory.revision}:${agents[0].address}`)
        .digest('base64url')
        .slice(0, 24),
      path: agents[0].path
    };
  }
  if (exact.length) {
    throw cliError('AGENT_TYPE_REQUIRED', '--agent 上下文来源必须是包含一个顶层字面量 agent({...}) 声明的 thing@program；查询或写入目标不得代替入口，目标本身无需是 Agent Program');
  }
  throw cliError('AGENT_NOT_FOUND', '未找到 exact 匹配的已声明 Agent Program');
}

function agentDirectoryFor(atoms, agentProgramPaths, options = {}) {
  let directory = agentDirectories.get(atoms);
  if (directory) return directory;
  const byName = new Map();
  const byPath = new Map();
  for (const entry of atomEntries(atoms, agentProgramPaths)) {
    const named = byName.get(entry.name) ?? [];
    named.push(entry);
    byName.set(entry.name, named);
    byPath.set(entry.path, [entry]);
  }
  directory = {
    revision: (options.worldRevision ?? revisionOfWorldFacts(atoms)).replace(/^sha256:/u, ''),
    byName,
    byPath
  };
  agentDirectories.set(atoms, directory);
  return directory;
}

export async function primeAgentDirectory(contextFile, options = {}) {
  const atoms = await readAtomContext(contextFile, {
    create: false,
    ...(options.compatibilityManifest ? { compatibilityManifest: options.compatibilityManifest } : {})
  });
  const scheduler = options.programScheduler ?? createProgramRuntimeScheduler({});
  const security = await scheduler.rebuildAgentSecurity(atoms);
  agentDirectoryFor(atoms, new Set(security.keys()), options);
}

export async function runAtomSession(options = {}) {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const execute = requireExecutionCapability(options.execute);
  const interaction = options.interaction ?? null;
  const executionOptions = {
    contextFile: options.contextFile,
    projectionFile: options.projectionFile,
    receiverOptions: options.receiverOptions,
    ...(interaction ? { interaction } : {})
  };
  const entered = await execute({ ...executionOptions, source: 'atom' });
  if (interaction?.agent && !entered.agent) entered.agent = interaction.agent.path;
  const writer = writeGraphResult;
  if (!entered.ok) return writer(entered, stdout, stderr);

  const count = Number.isInteger(entered.atomCount) ? `（${entered.atomCount} 个 Atom）` : '';
  stdout.write(`Atom Language 已就绪${count}\n`);
  const activeAgentPath = entered.agent ?? interaction?.agent?.path;
  const entryContext = options.remoteEntryContext === true
    ? await formatRuntimeAgentEntryContext(execute, executionOptions, activeAgentPath)
    : await formatAgentEntryContext(options.contextFile, activeAgentPath);
  if (entryContext) stdout.write(`${entryContext}\n`);
  stdout.write('Ctrl+C 退出\n');

  const terminal = options.terminal ?? Boolean(stdin.isTTY && stdout.isTTY);
  const session = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal
  });
  let pending = '';
  let pendingFromCopiedPrompt = false;
  let expectedCopiedReceipt = false;
  let copiedReceipt = '';
  let code = 0;
  const history = [];
  session.once('SIGINT', () => {
    pending = '';
    copiedReceipt = '';
    stdout.write('\n');
    session.close();
  });
  const prompt = () => {
    if (session.closed) return;
    session.setPrompt(pending ? '... ' : `atom${interaction?.agent ? `[${interaction.agent.path}]` : ''}> `);
    try {
      session.prompt();
    } catch (error) {
      if (error.code !== 'ERR_USE_AFTER_CLOSE') throw error;
    }
  };
  try {
    prompt();
    for await (const rawLine of session) {
      const normalized = stripCopiedSessionPrompt(rawLine);

      if (copiedReceipt) {
        copiedReceipt = `${copiedReceipt}\n${rawLine}`;
        if (!requestIsComplete(copiedReceipt)) continue;
        if (isCompleteGraphJson(copiedReceipt)) {
          copiedReceipt = '';
          expectedCopiedReceipt = false;
          continue;
        }
        pending = copiedReceipt;
        copiedReceipt = '';
        expectedCopiedReceipt = false;
      } else if (
        expectedCopiedReceipt
        && !normalized.copiedPrompt
        && !rawLine.trim()
      ) {
        continue;
      } else if (
        expectedCopiedReceipt
        && !normalized.copiedPrompt
        && /^[\[{]/u.test(rawLine.trimStart())
      ) {
        copiedReceipt = rawLine;
        if (!requestIsComplete(copiedReceipt)) continue;
        if (isCompleteGraphJson(copiedReceipt)) {
          copiedReceipt = '';
          expectedCopiedReceipt = false;
          continue;
        }
        pending = copiedReceipt;
        copiedReceipt = '';
        expectedCopiedReceipt = false;
      } else {
        if (!normalized.copiedPrompt) expectedCopiedReceipt = false;
        pending = pending
          ? `${pending}\n${normalized.line}`
          : normalized.line;
        pendingFromCopiedPrompt ||= normalized.copiedPrompt;
      }

      if (!requestIsComplete(pending)) {
        prompt();
        continue;
      }
      if (!pending.trim()) {
        pending = '';
        prompt();
        continue;
      }
      const source = pending;
      const result = await execute({ ...executionOptions, source, history: structuredClone(history) });
      if (interaction?.agent) result.agent = interaction.agent.path;
      code = writer(result, stdout, stderr);
      history.push({
        source,
        receipt: Object.fromEntries(Object.entries(structuredClone(result)).filter(([key]) => (
          key !== 'contextFile' && key !== 'projectionFile'
        )))
      });
      if (history.length > 50) history.splice(0, history.length - 50);
      expectedCopiedReceipt = pendingFromCopiedPrompt;
      pending = '';
      pendingFromCopiedPrompt = false;
      prompt();
    }
  } finally {
    session.close();
  }
  return code;
}

export async function runAtomCli(argv = [], overrides = {}) {
  const stdin = overrides.stdin ?? process.stdin;
  const stdout = overrides.stdout ?? process.stdout;
  const stderr = overrides.stderr ?? process.stderr;
  try {
    const parsed = parseCliArgs(argv);
    if (parsed.help) {
      stdout.write(`${help()}\n`);
      return 0;
    }
    if (parsed.workOrderRegistry && parsed.programFunctionRegistry) {
      throw cliError(
        'AMBIGUOUS_COMMAND_SOURCE',
        '--work-order-registry 与 --program-function-registry 必须单独使用'
      );
    }
    if (parsed.workOrderRegistry) {
      if (parsed.readSourceFromStdin || parsed.source.length) {
        throw cliError(
          'AMBIGUOUS_COMMAND_SOURCE',
          '--work-order-registry 不能与 Atom 命令或 --stdin 同时使用'
        );
      }
      const loadRegistry = overrides.workOrderRegistry ?? executeAtomWorkOrderRegistryEndpoint;
      if (typeof loadRegistry !== 'function') {
        throw cliError(
          'ATOM_WORK_ORDER_REGISTRY_UNAVAILABLE',
          'Atom CLI requires a work-order registry capability'
        );
      }
      const endpoint = parsed.endpoint
        ? new URL('/__atom/api/work-order-registry', parsed.endpoint).toString()
        : undefined;
      stdout.write(`${JSON.stringify(await loadRegistry(endpoint), null, 2)}\n`);
      return 0;
    }
    if (parsed.programFunctionRegistry) {
      if (parsed.readSourceFromStdin || parsed.source.length) {
        throw cliError(
          'AMBIGUOUS_COMMAND_SOURCE',
          '--program-function-registry 不能与 Atom 命令或 --stdin 同时使用'
        );
      }
      const loadRegistry = overrides.programFunctionRegistry
        ?? executeAtomProgramFunctionRegistryEndpoint;
      if (typeof loadRegistry !== 'function') {
        throw cliError(
          'ATOM_PROGRAM_FUNCTION_REGISTRY_UNAVAILABLE',
          'Atom CLI requires a Program function registry capability'
        );
      }
      const endpoint = parsed.endpoint
        ? new URL('/__atom/api/program-function-registry', parsed.endpoint).toString()
        : undefined;
      stdout.write(`${JSON.stringify(await loadRegistry(endpoint), null, 2)}\n`);
      return 0;
    }
    if (parsed.readSourceFromStdin && parsed.source.length) {
      throw cliError('AMBIGUOUS_COMMAND_SOURCE', '--stdin 不能与命令行中的 Atom 命令同时使用');
    }
    const contextFile = parsed.contextFile ?? overrides.defaultContextFile;
    const projectionFile = parsed.projectionFile ?? overrides.defaultProjectionFile;
    let interaction = overrides.interaction ?? null;
    let remoteAgentResolution = false;
    if (overrides.requireAgent) {
      if (parsed.explicitContext || parsed.projectionFile) {
        throw cliError(
          'DAILY_CONTEXT_OVERRIDE_REJECTED',
          '日常 Atom CLI 不允许切换数据源；请联系维护入口'
        );
      }
      if (parsed.global) {
        throw cliError('DAILY_GLOBAL_MODE_REJECTED', '日常 Atom CLI 不允许进入全局模式');
      }
      if (typeof parsed.agent !== 'string' || !parsed.agent.trim()) {
        throw cliError('AGENT_REQUIRED', '公开 Atom CLI 需要 --agent 上下文起点');
      }
      remoteAgentResolution = overrides.remoteAgentResolution
        ?? overrides.execute === executeAtomCommandEndpoint;
      interaction = remoteAgentResolution
        ? {
            ...(interaction ?? {}),
            agentSelector: parsed.agent.trim(),
            agent: { path: parsed.agent.trim() }
          }
        : {
            ...(interaction ?? {}),
            agent: await resolveAgentContext(contextFile, parsed.agent, {
              ...(overrides.programScheduler ? { programScheduler: overrides.programScheduler } : {})
            })
          };
    }
    const interactive = overrides.interactive
      ?? (parsed.source.length === 0 && Boolean(stdin.isTTY && stdout.isTTY));
    const execute = requireExecutionCapability(overrides.execute);
    const executeAtEndpoint = parsed.endpoint
      ? (options) => execute(options, parsed.endpoint)
      : execute;
    if (interactive) {
      return runAtomSession({
        stdin,
        stdout,
        stderr,
        contextFile,
        projectionFile,
        receiverOptions: overrides.receiverOptions,
        execute: executeAtEndpoint,
        remoteEntryContext: remoteAgentResolution,
        terminal: overrides.terminal,
        interaction
      });
    }

    if (parsed.source.length === 0 && !parsed.explicitContext && !overrides.requireAgent) {
      const result = createAtomLanguageReceiver(overrides.receiverOptions).receive('atom');
      return writeGraphResult(result, stdout, stderr);
    }
    const source = parsed.readSourceFromStdin
      ? await readCommandSource(stdin)
      : (parsed.source.length ? parsed.source.join(' ') : 'atom');
    const result = await executeAtEndpoint({
      source,
      contextFile,
      projectionFile,
      receiverOptions: overrides.receiverOptions,
      ...(interaction ? { interaction } : {}),
      history: []
    });
    if (interaction?.agent && !result.agent) result.agent = interaction.agent.path;
    return writeGraphResult(result, stdout, stderr);
  } catch (error) {
    stderr.write(`错误 ${error.code || 'ATOM_LANGUAGE_CLI_ERROR'}：${error.message}\n`);
    return error.code ? 4 : 1;
  }
}

const invokedFile = process.argv[1]
  ? await fs.realpath(path.resolve(process.argv[1])).catch(() => path.resolve(process.argv[1]))
  : null;
const currentFile = await fs.realpath(fileURLToPath(import.meta.url))
  .catch(() => fileURLToPath(import.meta.url));
if (invokedFile && invokedFile === currentFile) {
  const runtime = resolveAtomRuntime();
  process.exitCode = await runAtomCli(process.argv.slice(2), {
    requireAgent: true,
    defaultContextFile: runtime.contextFile,
    defaultProjectionFile: runtime.graphFile,
    execute: executeAtomCommandEndpoint
  });
}
