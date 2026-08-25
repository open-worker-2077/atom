#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
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
import { revisionOfWorldFacts } from '../../src/atom-system/world-runtime/world-revision.mjs';

const agentDirectories = new WeakMap();

export const DEFAULT_ATOM_COMMAND_ENDPOINT = 'http://127.0.0.1:4784/__atom/api/command';
export const DEFAULT_WORK_ORDER_REGISTRY_ENDPOINT = 'http://127.0.0.1:4784/__atom/api/work-order-registry';
export const DEFAULT_PROGRAM_FUNCTION_REGISTRY_ENDPOINT = 'http://127.0.0.1:4784/__atom/api/program-function-registry';

export async function executeAtomCommandEndpoint(options, endpoint = DEFAULT_ATOM_COMMAND_ENDPOINT) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: options.source,
        interaction: options.interaction,
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
  rep: '{"name":"A","detail.rep.NEW"}；局部替换用 "detail.rep.NEW":"OLD"；关系全替换用 "partners.rep.":[...]',
  sum: '{"name":"A","detail.sum.SUMMARY"}（只更新 detail 简介）',
  typ: '{"name.typ.TYPE":"A"}（替换类型标记）；{"name.typ.":"A"}（移除类型标记）',
  ren: '{"name.ren.NEW_NAME":"A"}（同级必须保持唯一）',
  mov: '{"name.mov.DESTINATION_PATH":"A"}（移动子树；移至顶层时 DESTINATION_PATH 使用“世界之外”；拒绝形成循环）',
  cpy: '{"name.cpy.DESTINATION_PATH":"A"}（复制子树）',
  dsc: '{"name.dsc.":"A"}（可逆移入唯一默认备份仓）',
  rst: '{"name.rst.":"BACKUP_PATH/A"}（按丢弃记录恢复原位置）',
  run: '{"name.run.":"PROGRAM_PATH"}（显式运行唯一 @program）'
});

const EXPLORE_HELP = Object.freeze({
  'detail\u0000full': 'detail$full（返回完整 detail；否则可只返回简介）',
  'children\u0000latitude': 'children$latitude+1 / children$latitude-1（向上看一层 / 向下看一层；向下结果保留嵌套 children；数字可调整，0 为锚点层）',
  'children\u0000longitude': 'children$longitude+1 / children$longitude-1（向后看一个同级 / 向前看一个同级；数字可调整，0 为锚点）'
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
    '  --agent AGENT      必填；exact 且唯一的 @agent 短名或业务路径',
    '  --stdin            从标准输入读取一条完整 Atom 命令；用于变量、多行、长文本和特殊字符',
    '  --json             已弃用的兼容选项；Atom 命令结果仍为 Graph-JSON',
    '  --program-function-registry  输出 CLI/Web/Program 共用的注册函数、粗颗粒家族、简单作用域与 Atom 类型契约',
    '  --work-order-registry  输出 CLI/Web 共用的工单动作、错误与回执契约',
    '  -h, --help         显示帮助',
    '',
    'Agent 入口：',
    '  --agent 只指定本次交互的上下文来源，不指定节点的归属或写入位置，也不代表身份、权限或锁。',
    '  查询或写入的事实目标不得代替 --agent 上下文来源；目标 Atom 本身不需要是 @agent。',
    '  会话已给出或已绑定唯一 @agent 时直接复用，不得重复询问；只有上下文来源确实未知或不唯一时才请求明确。',
    '  每条非交互命令都原样携带已绑定的 @agent；CLI 不会把目标 name 自动当作 --agent。',
    '  短名必须唯一；重名时增加必要路径片段。仍无法确定上下文时联系任务派发方或维护入口。',
    '  进入交互会话：atom.cmd --agent AGENT；Ctrl+C 退出。',
    '  PowerShell 固定短 JSON 可使用 --%；--% 会停止变量展开，变量、多行或长文本必须通过 --stdin 传入。',
    '',
    '日常闭环：',
    '  1. explore 当前锚点和最小必要邻域；只依据显式事实与用户授权决定下一步。',
    '     用户要求使用或创建一个命名节点时，先 explore 预定父节点及其直接子节点：已有相同或明确等价节点则复用；确实没有可复用节点时才 transform new。',
    '  2. 优先运行已有 Program/模板；没有适用能力时才执行最小 transform。',
    '  3. 每次写入后重新 explore 实际写入的 Atom 及其必要 children、partners 和 detail。',
    '  4. 以回读事实验收；Program 消息不是其他 Agent 已改变的证明。失败按下方错误动作处理。',
    '',
    'Graph-JSON 基础：',
    '  name 使用能唯一表征目标的最短 exact 选择器；detail 是内容；children 是真实包含；partners 是 [{"verb":"...","object":"目标路径"}]。',
    '  @type 写在 name 键上（如 name@agent、name@program）；#简介必须在键末尾；~hint 仅为返回提示。',
    '  Explore 接受对象或对象数组；Transform 对象数组把已有 Atom 改造作为一个原子批次执行，并逐项返回结果。所有结果只使用 Graph-JSON。',
    '',
    'Explore 契约（只读，不修复或写入投影）：',
    '  atom.cmd --% --agent 工作Agent explore "{""name"":""目标节点"",""detail$full"":true,""children$latitude+1"":true,""children$longitude+1"":true,""partners"":true}"',
    '  name 默认 exact；短名重名时逐步增加必要的上级路径片段。顶层同名目标使用“世界之外/目标名”精确选择。fuzzy、regex、vector 不支持。',
    '  “世界之外”以 name@universe 暴露为不落盘的虚拟父级；用于读取、上下钻、顶层消歧，以及作为 .mov. 的顶层目的地。',
    ...contract.explore,
    '  每次成功命中 exact 锚点都会返回 boundary~preview；up/down/left/right 分别给出视野外 state、hasMore、nodes、characters，并随重新锚定更新。protected 方向不公开精确数量且不得当作空白。',
    '  读取投影推荐使用标准 JSON true（例如 ""detail$full"":true、""partners"":true）；旧的无值投影键继续兼容。',
    '  partners（返回每个匹配 Atom 的完整有向关系数组；每项包含 verb 与 object）',
    '  多层向下查询按真实包含关系返回嵌套 children；name 仅在需要消歧时增加最短必要路径片段。',
    '  explore new 使用同一查询契约，并重置本次探索上下文；空结果返回 explore~empty/new，不代表错误。',
    '',
    'Transform 契约（目标 name 必须 exact 且唯一；写入后必须回读）：',
    '  transform new 创建完整 Atom；新节点的归属由 name 中的精确父路径决定，与 --agent 无关。',
    '  name 可用“精确父路径/新名称”创建子 Atom，省略父路径则创建顶层 Atom；父路径不明确时只询问父 Atom。',
    '  Transform 对象数组可批量改名、移动或更新已有 Atom 的 detail/partners：任一项失败整批不写；成功后整批只做一次权威提交。',
    '  批量改名按最终状态统一校验，可交换同级名称；整批统一重写后代路径与 partners。批量改名项不得混入移动、detail 或 partners。',
    '  detail 和 partners 的全文替换必须显式使用 .rep.；每个对象的结构操作只能有一个。',
    ...contract.transform,
    '',
    'Program 模板与复用：',
    '  @program 是唯一可执行类型，detail 直接保存 Python；普通交互不得手工替代已有 Program 或模板。',
    '  本 Atom Program 可自行研发、研磨并通过 use_program() 复用；成熟实现也可作为后续公共能力素材。',
    '  注册表与底层运行时不通过 Program 开放修改；这项保护不限制 Agent 自行研发 Program。',
    ...contract.programFunctions,
    '  注册函数目录：function_catalog({layer?,family?,scope?})；完整公共契约可用 atom.cmd --program-function-registry 读取。',
    '  Form 评估：form({"action":"evaluate","components":[{"name":"组件","activation":"required|optional|disabled","value":{},"requirements":[{"path":["JSON键","下级键"]}],"components":[]}]})；components 可递归嵌套。',
    '  Form 返回 valid、required、optional、disabled、active、missing；missing 每项为 {"component":["组件路径"],"path":["缺失键路径"]}。required 必参与；optional 在自身或后代有内容时参与；disabled 子树不参与校验；未使用的 optional 不形成缺项。',
    '  多选函数：choice({id,options:[{id,label}],selected:[id],empty})；参数必须使用双引号标准 JSON（同时是合法 Python），当前仅支持多选，返回 selected 数组并在显式 .run. 回执中公开 choices。',
    '  Program 并发独立运行并共享单轮 10 秒时间预算；单项失败独立报告，超时自动中断。短期内避免编写超出该预算的复杂 Program。',
    '  Program transform 创建：transform({"name":"精确父路径/新节点","detail":"内容","children":[],"partners":[]})；完整四轴且无点号指令时创建，带点号指令的既有写法继续按更新处理。',
    '  transform() 返回 None，只表示登记了延后效果；实际提交必须以交互回执或后续 exact explore 回读确认。',
    '  JSON 函数：json_parse({"text":"..."})->JSON值；json_stringify({"value":...,"indent"?:0..8})->string。序列化默认紧凑，拒绝 NaN、Infinity 和非 JSON 值；失败将终止整个 Program 评估且不发布已登记效果；不开放 import/eval；可配合 detail.rep. 写回。',
    '  世界函数：explore(query)->rows；transform(spec)、slot_body(spec)、lock(spec)、message(spec)->effect；current_atom()->Program。',
    '  Transform 触发器：先定义无参数 main，再声明 trigger("transform", {"nodes":["exact 节点路径"]}, main)。main 是函数引用，不能写 main()；运行时按反向索引只运行命中的 Program；相同值写入仍属于 Transform 事件。未声明 trigger 的 Program 冷启动时遇到无关 Transform 不会重放；显式 .run.、其自身被 Transform 或已知 explore 依赖变化时仍运行。',
    '  窗口识别锁：lock({...\"allowed_windows\":{\"paths\":[\"exact 完整 @agent 路径\"]},\"refresh\":{\"policy\":\"on_request\"}})。只有当前 --agent 解析路径 exact 命中才绕过该锁；未命中写入返回 PROGRAM_LOCK_DENIED。',
    '  类型条件锁：allowed_windows 也可写 {"types":{"all":["agent"],"any":["研发","总控"],"none":["执行"]}}；all／any／none 读取当前窗口节点的 Graph 类型，不读取调用方自报类型，并与旧 paths 写法二选一。',
    '  空间范围锁：targets.scope 取 subtree 时锁覆盖目标整棵子树；allowed_windows 可写 {"relation":"target_within_window_parent"}，只允许窗口读取或改造其当前父节点及下级，exact path 不能绕过。',
    '  调度权限：allowed_programs.paths 显式列出可越过该锁执行 Transform 的调度 Program；该权限不交给执行窗口。窗口被调度 Program 移动后，相对空间权限按新父级即时生效，无需重算锁。',
    '  锁定条件轴：when.target_types 使用相同类型条件判断目标状态；when.actions 仅取 explore／transform。状态与动作决定锁是否生效，窗口条件决定是否放行；守窗、跳窗、关窗和滚动绑定由上层 Program 调度，内核不写死。',
    '  显式重算：transform {\"name.run.\":\"EXACT_PROGRAM_PATH\"}；仅成功运行才原子替换旧锁快照，普通依赖变化不自动重算，失败保留旧锁快照。',
    '  模板函数：template_catalog(spec)->entries；instantiate({template,version,mode,parameters})->result；use_program({name,arguments})->result。',
    '  槽体研发：槽体首次只放一棵普通可自运行候选 DataFlow（下级槽、contain、support、@program）；研发态可用 transform {"name.run.EXACT候选根路径":"EXACT_PROGRAM_PATH"} 绑定当前域，Program 内仅用 . 或 ./相对contain路径。',
    '  槽体封装：上层注册 Program 调用 slot_body({"action":"seal","body":"EXACT槽体路径","limit"?:正整数,"cursor"?:"续批游标"})；中央事务把同一候选保留为槽模，并生成“槽模／print@program／槽例”。不预建空槽例，print 计划在 Graph 中可 exact explore 审计。',
    '  槽体打印：用 explore {"name":"EXACT槽体/print/修订","children$latitude-1":true} 回读当前 sha256 revision，再显式 use_program({"name":"EXACT槽体/print","arguments":{"name":"新槽例名"}})；内核复制全部普通槽、嵌套 contain、support、类型、描述和默认料，Program 只在槽模共享一份。',
    '  槽例填写与计算：用 transform {"name":"EXACT槽体/槽例/实例/槽","detail.rep.填写值"} 填料；字段事件按“所属槽例→相对角色→当前修订 support→共享 Program”只在当前槽例域运行，再用 exact explore 回读该实例结果与“采用槽模修订”。禁止绝对实例路径、越过嵌套槽例边界、跨槽例或外部资料访问。',
    '  槽模修订：修改同一槽模后再次 seal；每张槽例以旧槽模默认值／槽例当前值／新槽模默认值三方比较，未改默认随新值更新，个性字符逐字节保留并在 preserved_customized 报告；批次未 complete 时按 next_cursor 续跑，每张槽例保留“采用槽模修订”，同步批次内统一重算派生结果。',
    '  槽体错误：INVALID_SLOT_BODY_EFFECT、INVALID_SLOT_BODY_LAYOUT、INVALID_SLOT_PRINT_PLAN、INVALID_SLOT_SYNC_LIMIT、SLOT_BODY_NOT_SEALED、SLOT_PRINT_PLAN_STALE、SLOT_BODY_EXAMPLE_EXISTS、SLOT_SYNC_CURSOR_INVALID、SLOT_SYNC_CURSOR_STALE、SLOT_INSTANCE_REVISION_MISSING、SLOT_SCOPE_ROOT_UNBOUND、SLOT_RELATIVE_SELECTOR_REQUIRED、SLOT_RELATIVE_TARGET_NOT_FOUND、SLOT_RELATIVE_TARGET_AMBIGUOUS、SLOT_SCOPE_BOUNDARY_CROSSING、SLOT_SCOPE_ROLE_MISMATCH、SLOT_BODY_NESTED_EFFECT_FORBIDDEN；任一失败不产生半份槽例。',
    '  工单函数：work_order_catalog({template?,version?})->contract；work_order({action,...})->result。v1 动作固定为 create/fill/validate/submit/reject/revise/read-back。',
    '  工单公开契约：atom.cmd --work-order-registry；该只读命令无需 --agent，Web 帮助从同一注册表渲染动作、错误和提交回执字段。',
    '  工单写入只能由 Program 发出并继续经过 Transform、修订检查和中央提交；调用时使用精确版本、稳定 creation_id 与 exact path，写后按 read-back 和世界回读验收。',
    '  规划函数：direct_children(rows,parent_path)、child_detail(rows,parent_path,name,default)、missing_details(rows,parent_path,names)、form_status(rows,parent_path,status_name)、first_pending(forms,completed_states)、transition_allowed(current,requested,transitions)、subtree_refs(rows,root_path)、plan_shards(sources,spec)、plan_form_flow(rows,parent_path,standard)、plan_template_instance(rows,parent_path,template)。',
    '  模板参数以 template_catalog({}) 返回的契约为准；被 use_program 调用的 Program 必须定义 main(arguments)。',
    '  推进流配方：在指定的事实父 Atom 下建立“推进流” @program，其 detail 调用 instantiate({\'template\':\'advancement-flow\',\'version\':\'latest\',\'mode\':\'ensure\',\'parameters\':{\'title\':\'任务标题\'}})；新建 Agent 与追加 Program 分两次 transform。',
    '',
    '反馈：',
    '  submit {"type":"bug|pain|requirement|optimization","detail":"1 至 10000 字说明"}',
    '  反馈记录当前 @agent 和本会话最近历史；反馈不绕过锁，也不证明问题已修复。',
    '',
    '错误处理与下一步动作：',
    '  先按对应错误的纠正提示处理；纠正提示仍无法解除阻断、CLI 已无法正常使用时，才 submit bug 或 requirement。',
    '  AGENT_NOT_FOUND / AGENT_TYPE_REQUIRED / AMBIGUOUS_AGENT：只修正 --agent 上下文来源；不得把查询目标改成 @agent 或拿它代替入口；未知入口联系派发方。',
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
        `${argument} 已停用；请使用 --agent 选择 @agent 上下文起点`
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
  for await (const chunk of stream) source += chunk.toString('utf8');
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
    graphEntry(`name${types}${transientHint}`, true, match.selector ?? match.name)
  ];
  const descriptionPresent = (
    match.description !== null && match.description !== undefined
  );
  const detailPresent = Object.hasOwn(match, 'detail');
  if (descriptionPresent || detailPresent) {
    entries.push(graphEntry(
      `detail${descriptionPresent ? `#${match.description}` : ''}`,
      detailPresent,
      match.detail
    ));
  }
  if (Array.isArray(match.partners)) {
    entries.push(graphEntry('partners', true, match.partners));
  }
  if (match.lockState) {
    entries.push(graphEntry('lock~active', true, match.lockState));
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
      value.entries.push(graphEntry('children', true, {
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
      graphEntry(`name${types}~${hint}`, true, result.result.name)
    ];
    if (Array.isArray(result.program?.choices)) {
      entries.push(graphEntry('choices', true, result.program.choices));
    }
    return graphObject(entries);
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
  if (result.command === 'submit' && result.submission) {
    return graphObject([
      graphEntry('submit~recorded'),
      graphEntry('id', true, result.submission.id),
      graphEntry('type', true, result.submission.type),
      graphEntry('submittedAt', true, result.submission.submittedAt)
    ]);
  }
  return null;
}

function atomEntries(atoms, parentPath = [], parentAddress = '') {
  const entries = [];
  for (const [index, atom] of (atoms ?? []).entries()) {
    const nameField = storedField(atom, 'name');
    if (typeof nameField?.value !== 'string') continue;
    const path = [...parentPath, nameField.value];
    const address = parentAddress ? `${parentAddress}/${index}` : `${index}`;
    entries.push({
      name: nameField.value,
      types: nameField.parsed.types.map((type) => type.raw),
      path: path.join('/'),
      address,
      parentAddress,
      detail: storedField(atom, 'detail')?.value ?? '',
      agent: nameField.parsed.types.some((type) => type.raw === 'agent')
    });
    const children = storedField(atom, 'children')?.value;
    if (Array.isArray(children)) entries.push(...atomEntries(children, path, address));
  }
  return entries;
}

async function formatAgentEntryContext(contextFile, agentPath) {
  if (!contextFile || !agentPath) return '';
  const entries = atomEntries(await readAtomContext(contextFile, { create: false }));
  const current = entries.find((entry) => entry.path === agentPath && entry.agent);
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
    const nameKey = `name${types.map((type) => `@${type}`).join('')}`;
    const executable = types.includes('program');
    const childEntries = descendantDepth > 0
      ? (childrenByParent.get(entry.address) ?? []).map((child) => (
        graphAtom(child, null, descendantDepth - 1)
      ))
      : [];
    return graphObject([
      graphEntry(nameKey, true, entry.name),
      graphEntry('detail', true, executable ? '' : entry.detail),
      graphEntry('children', true, graphArray(childEntries)),
      graphEntry('partners', true, graphArray([]))
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
    graphEntry('name@context', true, current.path),
    graphEntry('detail', true, ''),
    graphEntry('children', true, graphArray([
      ...(parent ? [graphAtom(parent, 'parent')] : []),
      ...peers.map((entry) => graphAtom(entry, 'peer')),
      graphAtom(current, 'current', 2)
    ])),
    graphEntry('partners', true, graphArray([])),
    graphEntry('boundary~preview', true, graphObject([
      graphEntry('up', true, previewStats(upOutside)),
      graphEntry('down', true, previewStats(downOutside)),
      graphEntry('left', true, previewStats(leftOutside)),
      graphEntry('right', true, previewStats(rightOutside))
    ]))
  ]);
  return formatGraphJson(context, { omitEmptyStructuralArrays: true });
}

export async function resolveAgentContext(contextFile, selector) {
  if (typeof selector !== 'string' || !selector.trim()) {
    throw cliError('AGENT_REQUIRED', '公开 Atom CLI 需要 --agent 上下文起点');
  }
  const requested = selector.trim();
  const atoms = await readAtomContext(contextFile, { create: false });
  let directory = agentDirectories.get(atoms);
  if (!directory) {
    const byName = new Map();
    const byPath = new Map();
    for (const entry of atomEntries(atoms)) {
      const named = byName.get(entry.name) ?? [];
      named.push(entry);
      byName.set(entry.name, named);
      byPath.set(entry.path, [entry]);
    }
    directory = {
      revision: revisionOfWorldFacts(atoms).slice('sha256:'.length),
      byName,
      byPath
    };
    agentDirectories.set(atoms, directory);
  }
  const exact = requested.includes('/')
    ? (directory.byPath.get(requested) ?? [])
    : (directory.byName.get(requested) ?? []);
  const agents = exact.filter((entry) => entry.agent);
  if (agents.length > 1) {
    throw cliError('AMBIGUOUS_AGENT', '只能选择 exact 且唯一的 @agent Atom');
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
    throw cliError('AGENT_TYPE_REQUIRED', '--agent 上下文来源必须是 @agent Atom；查询或写入目标不得代替入口，目标本身无需是 @agent');
  }
  throw cliError('AGENT_NOT_FOUND', '未找到 exact 匹配的 @agent Atom');
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
  if (interaction?.agent) entered.agent = interaction.agent.path;
  const writer = writeGraphResult;
  if (!entered.ok) return writer(entered, stdout, stderr);

  const count = Number.isInteger(entered.atomCount) ? `（${entered.atomCount} 个 Atom）` : '';
  stdout.write(`Atom Language 已就绪${count}\n`);
  const entryContext = await formatAgentEntryContext(options.contextFile, interaction?.agent?.path);
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
      stdout.write(`${JSON.stringify(await loadRegistry(), null, 2)}\n`);
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
      stdout.write(`${JSON.stringify(await loadRegistry(), null, 2)}\n`);
      return 0;
    }
    if (parsed.readSourceFromStdin && parsed.source.length) {
      throw cliError('AMBIGUOUS_COMMAND_SOURCE', '--stdin 不能与命令行中的 Atom 命令同时使用');
    }
    const contextFile = parsed.contextFile ?? overrides.defaultContextFile;
    const projectionFile = parsed.projectionFile ?? overrides.defaultProjectionFile;
    let interaction = overrides.interaction ?? null;
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
      const remoteAgentResolution = overrides.remoteAgentResolution
        ?? overrides.execute === executeAtomCommandEndpoint;
      interaction = remoteAgentResolution
        ? {
            ...(interaction ?? {}),
            agentSelector: parsed.agent.trim(),
            agent: { path: parsed.agent.trim() }
          }
        : {
            ...(interaction ?? {}),
            agent: await resolveAgentContext(contextFile, parsed.agent)
          };
    }
    const interactive = overrides.interactive
      ?? (parsed.source.length === 0 && Boolean(stdin.isTTY && stdout.isTTY));
    if (interactive) {
      return runAtomSession({
        stdin,
        stdout,
        stderr,
        contextFile,
        projectionFile,
        receiverOptions: overrides.receiverOptions,
        execute: overrides.execute,
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
    const result = await requireExecutionCapability(overrides.execute)({
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
