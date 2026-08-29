const ROOT_ISSUE = Object.freeze({ id: 'issue-1', number: 1, url: 'https://github.com/open-worker-2077/atom/issues/1' });
const BUSINESS_CASE = Object.freeze({ id: 'BC-ESG-ACTIVITY-001', version: 'v1' });
const GATE_NAMES = Object.freeze(['StructureGate', 'QuantityGate', 'ConservationGate', 'SemanticGate']);
const SCENARIO_IDS = Object.freeze([
  'TC-ESG-ACTIVITY-001-POS-01',
  'TC-ESG-ACTIVITY-001-REJECT-02',
  'TC-ESG-ACTIVITY-001-PENDING-03',
  'TC-ESG-ACTIVITY-001-REMAP-04',
  'TC-ESG-ACTIVITY-001-RESUME-05'
]);
const CASE_STATUSES = new Set(['pending', 'passed', 'failed', 'blocked', 'revalidation-required', 'pending-user-acceptance']);

export const NIGHT_WATCH_BUSINESS_CASE_CATALOG_CONTRACT = 'atom.night-watch-business-case-catalog';
export const NIGHT_WATCH_BUSINESS_CASE_CATALOG_VERSION = 1;

const businessCases = [
  { id: 'TC-ESG-ACTIVITY-001-POS-01', kind: 'business-scenario', issueNodeId: 'issue-3', status: 'pending', businessCase: BUSINESS_CASE, syntheticShape: ['一个执行部门起草含两个子文件的文件包', '审核岗位审核，审定岗位审定，随后正式分发', '完成说明确认两个子文件已经形成'], prerequisites: ['空槽例已由槽模打印', '字段行与规程行只读', '当前实例只连接声明的必要来源与参数槽'], steps: ['领取当前实例并读取当前合成来源', '锚定文件包及两个子文件', '连接起草、审核、审定、发送事项链并保留审核回环', '执行计数、逐字比较、四门复核后锁定结果'], gates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' }, minimalContext: ['当前合成来源', '起草、审核、审定、发送规则', '三个相关泳道画像'], prohibitedReads: ['其他活动', '真实 ESG 行', '旧候选答案', '完整 Session 历史', '无关泳道'], evidence: { status: 'pending' } },
  { id: 'TC-ESG-ACTIVITY-001-REJECT-02', kind: 'business-scenario', issueNodeId: 'issue-3', status: 'pending', businessCase: BUSINESS_CASE, syntheticShape: ['相邻文本写有操作员填写并重提', '审核员检查并反馈异常', '工具自动校验范围同时出现'], prerequisites: ['空槽例已由槽模打印', '字段行与规程行只读', '当前实例只连接声明的必要来源与参数槽'], steps: ['读取当前合成来源和三个规则输入', '将填报及其标准步骤归于操作员', '将审核和反馈归于审核员', '保留工具校验为工具范围并复核四门'], gates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' }, minimalContext: ['当前合成来源', '操作员与审核员画像', '填报、审核、校验规则'], prohibitedReads: ['其他泳道图标分布', '常识补造的岗位职责', '旧版管理员结论', '真实 ESG 行'], evidence: { status: 'pending' } },
  { id: 'TC-ESG-ACTIVITY-001-PENDING-03', kind: 'business-scenario', issueNodeId: 'issue-3', status: 'pending', businessCase: BUSINESS_CASE, syntheticShape: ['来源证明存在审核事项', '两个审核泳道均有历史活动级标记', '来源和现实档案均未说明本事项具体分工'], prerequisites: ['空槽例已由槽模打印', '字段行与规程行只读', '当前实例只连接声明的必要来源与参数槽'], steps: ['保留审核事项与历史图标来源', '将责任泳道写为编号待核问询', '返回精确缺项并停止受影响主计算', '保留无争议字段与前三门复核结果'], gates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'pending' }, minimalContext: ['当前合成来源', '两个相关泳道画像', '历史标记规则', '待核规则'], prohibitedReads: ['姓名推测', '领导称谓推测', '其他活动中的临时分工', 'Agent 记忆', '真实 ESG 行'], preciseMissing: '具体审核分工', roleSelection: 'forbidden', evidence: { status: 'pending' } },
  { id: 'TC-ESG-ACTIVITY-001-REMAP-04', kind: 'business-scenario', issueNodeId: 'issue-3', status: 'pending', businessCase: BUSINESS_CASE, syntheticShape: ['计划对象为“初始化资料”', '完成说明只证明实际形成“参数表”', '两者文本相近但不是同一对象'], prerequisites: ['空槽例已由槽模打印', '字段行与规程行只读', '当前实例只连接声明的必要来源与参数槽'], steps: ['分别读取当前合成计划来源与完成来源', '保持“初始化资料”为计划锚定对象', '记录“参数表”为实际形成对象', '形成计划—实际差异并复核四门'], gates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' }, minimalContext: ['当前合成计划来源', '完成来源', '锚定对象规程', '完成映射规程'], prohibitedReads: ['其他年份对象', '名称相似记录', '旧版本已经误替代的结果', '真实 ESG 行'], evidence: { status: 'pending' } },
  { id: 'TC-ESG-ACTIVITY-001-RESUME-05', kind: 'business-scenario', issueNodeId: 'issue-3', status: 'pending', businessCase: BUSINESS_CASE, syntheticShape: ['承接不能唯一映射场景', '人工只补充两个审核泳道的本事项具体分工'], prerequisites: ['原槽例、原缺项与原守恒证据可读', '字段行与规程行只读', '补充事实只连接至原待核缺口'], steps: ['从原待核断点继续', '只重算受影响责任关系、图标和语义门', '保留原来源片段、对象、事项链及守恒证据', '将追踪状态从待核转为完成并复核四门'], gates: { StructureGate: 'passed', QuantityGate: 'passed', ConservationGate: 'passed', SemanticGate: 'passed' }, minimalContext: ['原槽例', '原缺项', '人工补充事实', '相关泳道与图标规程'], prohibitedReads: ['重建其他槽例', '重跑无关活动', '用新事实改写原文', '用新事实改写历史标记', '真实 ESG 行'], recompute: ['责任关系', '图标', 'SemanticGate'], immutableEvidence: ['源片段', '锚定对象', '事项链', 'ConservationGate'], evidence: { status: 'pending' } }
];

const mechanismCases = [
  { id: 'TC-I10-ESG-EXPLORE-CONTEXT', kind: 'mechanism', issueNodeId: 'issue-10', status: 'pending', operation: 'Explore reads only the current slot example and explicitly necessary support', assertion: 'missing necessary support returns the precise gap', evidence: { status: 'pending' } },
  { id: 'TC-I10-ESG-TRANSFORM-BOUNDS', kind: 'mechanism', issueNodeId: 'issue-10', status: 'pending', operation: 'Transform writes only allowed output material in the current instance', assertion: 'field, procedure, and other-instance slots remain unchanged', evidence: { status: 'pending' } },
  { id: 'TC-I10-ESG-PROGRAM-GATES', kind: 'mechanism', issueNodeId: 'issue-10', status: 'pending', operation: 'Program performs deterministic counting, character reconstruction, state advance, and gate aggregation', assertion: 'the Program does not make the business semantic decision', evidence: { status: 'pending' } },
  { id: 'TC-I10-ESG-FORM-PENDING', kind: 'mechanism', issueNodeId: 'issue-10', status: 'pending', operation: 'Form displays the one pending decision and reconnects the response to its original gap', assertion: 'the Form cannot select a role without supplied fact', evidence: { status: 'pending' } },
  { id: 'TC-I10-ESG-SLOT-ISOLATION', kind: 'mechanism', issueNodeId: 'issue-10', status: 'pending', operation: 'Slot body shares the three-line procedure and Program while each activity instance owns its material', assertion: 'material cannot cross between activity instances', evidence: { status: 'pending' } },
  { id: 'TC-I10-ESG-JUMP-SCOPE', kind: 'mechanism', issueNodeId: 'issue-10', status: 'pending', operation: 'Dispatch jumps only after a completed or pending receipt', assertion: 'the next window follows the documented state transition', evidence: { status: 'pending' } },
  { id: 'TC-I10-ESG-AUTH-SCOPE', kind: 'mechanism', issueNodeId: 'issue-10', status: 'pending', operation: 'Execution scope reads and writes only the current instance and permitted descendants', assertion: 'horizontal, ancestor, and formal-business domains are denied', evidence: { status: 'pending' } },
  { id: 'TC-I10-ESG-COLD-START', kind: 'mechanism', issueNodeId: 'issue-10', status: 'pending', operation: 'Cold start restores the same fact, procedure version, gate state, and permission scope', assertion: 'recovery does not recalculate unrelated Programs', evidence: { status: 'pending' } },
  { id: 'TC-I10-ESG-CLI-WEB-PARITY', kind: 'mechanism', issueNodeId: 'issue-10', status: 'pending', operation: 'CLI and Web project the same current result', assertion: 'neither projection recomputes unrelated Program state', evidence: { status: 'pending' } }
];

function catalogError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function nonEmptyTextArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim());
}

export function validateNightWatchBusinessCaseCatalog(catalog) {
  if (!catalog || catalog.contract !== NIGHT_WATCH_BUSINESS_CASE_CATALOG_CONTRACT
    || catalog.version !== NIGHT_WATCH_BUSINESS_CASE_CATALOG_VERSION
    || catalog.businessCase?.id !== BUSINESS_CASE.id || catalog.businessCase?.version !== BUSINESS_CASE.version) {
    throw catalogError('NIGHT_WATCH_BUSINESS_CASE_CATALOG_INVALID', 'BusinessCase catalog identity is invalid');
  }
  if (!Array.isArray(catalog.businessCases) || catalog.businessCases.length !== SCENARIO_IDS.length
    || !Array.isArray(catalog.mechanismCases) || catalog.mechanismCases.length === 0) {
    throw catalogError('NIGHT_WATCH_BUSINESS_CASE_CATALOG_INVALID', 'BusinessCase catalog must contain all scenarios and mechanisms');
  }
  const ids = new Set();
  for (const item of [...catalog.businessCases, ...catalog.mechanismCases]) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) {
      throw catalogError('NIGHT_WATCH_BUSINESS_CASE_ID_INVALID', 'BusinessCase and mechanism ids must be unique');
    }
    ids.add(item.id);
    if (item.status !== 'pending' || item.evidence?.status !== 'pending') {
      throw catalogError('NIGHT_WATCH_BUSINESS_CASE_EVIDENCE_INVALID', 'Unexecuted catalog entries must retain pending evidence');
    }
  }
  for (const id of SCENARIO_IDS) {
    const item = catalog.businessCases.find((entry) => entry.id === id);
    if (!item || item.kind !== 'business-scenario' || item.issueNodeId !== 'issue-3'
      || item.businessCase?.id !== BUSINESS_CASE.id || item.businessCase?.version !== BUSINESS_CASE.version
      || !nonEmptyTextArray(item.syntheticShape) || !nonEmptyTextArray(item.prerequisites)
      || !nonEmptyTextArray(item.steps) || !nonEmptyTextArray(item.minimalContext)
      || !nonEmptyTextArray(item.prohibitedReads) || !item.gates) {
      throw catalogError('NIGHT_WATCH_BUSINESS_CASE_CONTRACT_INVALID', `BusinessCase scenario ${id} is incomplete`);
    }
    if (Object.keys(item.gates).length !== GATE_NAMES.length || GATE_NAMES.some((gate) => !CASE_STATUSES.has(item.gates[gate]))) {
      throw catalogError('NIGHT_WATCH_BUSINESS_CASE_GATE_INVALID', `BusinessCase scenario ${id} has invalid four-gate state`);
    }
  }
  const pending = catalog.businessCases.find((item) => item.id === 'TC-ESG-ACTIVITY-001-PENDING-03');
  if (pending.gates.SemanticGate !== 'pending' || pending.preciseMissing !== '具体审核分工' || pending.roleSelection !== 'forbidden') {
    throw catalogError('NIGHT_WATCH_BUSINESS_CASE_PENDING_INVALID', 'Pending scenario must preserve its precise missing fact and forbid role selection');
  }
  const resume = catalog.businessCases.find((item) => item.id === 'TC-ESG-ACTIVITY-001-RESUME-05');
  if (JSON.stringify(resume.recompute) !== JSON.stringify(['责任关系', '图标', 'SemanticGate'])
    || JSON.stringify(resume.immutableEvidence) !== JSON.stringify(['源片段', '锚定对象', '事项链', 'ConservationGate'])) {
    throw catalogError('NIGHT_WATCH_BUSINESS_CASE_RESUME_INVALID', 'Resume scenario must limit recomputation and preserve conservation evidence');
  }
  for (const item of catalog.mechanismCases) {
    if (item.kind !== 'mechanism' || item.issueNodeId !== 'issue-10'
      || typeof item.operation !== 'string' || !item.operation || typeof item.assertion !== 'string' || !item.assertion
      || Object.hasOwn(item, 'gates')) {
      throw catalogError('NIGHT_WATCH_BUSINESS_CASE_MECHANISM_INVALID', 'Issue #10 may own only mechanism cases without business gate conclusions');
    }
  }
  return structuredClone(catalog);
}

export const nightWatchBusinessCaseCatalog = Object.freeze({
  contract: NIGHT_WATCH_BUSINESS_CASE_CATALOG_CONTRACT,
  version: NIGHT_WATCH_BUSINESS_CASE_CATALOG_VERSION,
  businessCase: BUSINESS_CASE,
  businessCases,
  mechanismCases
});

export function createBusinessCaseStatusProjection(catalog = nightWatchBusinessCaseCatalog) {
  const validated = validateNightWatchBusinessCaseCatalog(catalog);
  const allCases = [...validated.businessCases, ...validated.mechanismCases];
  const evidenceFor = (item) => `E-${item.id}`;
  const casesForIssue = (issueNodeId) => allCases.filter((item) => item.issueNodeId === issueNodeId);
  const issue = (id, number) => {
    const entries = casesForIssue(id);
    return {
      id, number, status: 'pending', rootIssueRef: 'issue-1',
      testCaseRefs: entries.map((item) => item.id), evidenceRefs: entries.map(evidenceFor)
    };
  };
  return {
    issue: ROOT_ISSUE,
    issueInstances: [issue('issue-3', 3), issue('issue-10', 10)],
    testCases: allCases.map((item) => ({ id: item.id, issueRef: item.issueNodeId, status: item.status, evidenceRefs: [evidenceFor(item)] })),
    evidenceAttachments: allCases.map((item) => ({
      id: evidenceFor(item), issueRefs: [item.issueNodeId], testCaseRefs: [item.id],
      provenNodes: [
        { id: item.issueNodeId, proof: 'pending evidence reservation; no execution outcome claimed' },
        { id: item.id, proof: 'pending evidence reservation; no execution outcome claimed' }
      ],
      outcome: item.evidence.status, validity: item.evidence.status, conclusive: false
    })),
    requirements: [],
    gates: [{ id: 'issue-1-business-case-delivery', status: 'pending', required: allCases.map((item) => item.id) }]
  };
}
