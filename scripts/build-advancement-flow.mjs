const forms = [
  ['设标/定向', '明确需求、目标、边界与达标条件。', '进行中', ['需求', '目标', '边界', '达标']],
  ['设标/调研', '从目标出发选择高价值渠道，研究并评估素材。', '未进入', ['目标', '渠道', '高价值素材', '素材评估', '结论']],
  ['设标/策评', '脑暴方法并同步评估后果，形成决定。', '未进入', ['脑暴', '后果', '权衡', '决定']],
  ['建标/建表', '定义推进所需表单、字段、引用与校验。', '未进入', ['表单', '字段', '引用', '校验']],
  ['建标/分层', '定义从基础层逐步扩大到全量层的范围和通过条件。', '未进入', ['层序', '范围', '进入条件', '通过条件']],
  ['建标/分片', '定义由脚本自动生成真实分片的划分规则。', '未进入', ['划分规则', '生成脚本', '粒度', '完成条件']],
  ['推进/试点', '总控派发当前层分片，下级执行并一次性回执。', '未进入', ['当前层', '派发', '下级回执']],
  ['推进/回归', '总控审核验收当前分片，并一次性写回审核结果。', '未进入', ['总控审核', '验收', '审核结果', '升层结论']],
  ['推进/打磨', '针对问题根因改进并返回当前层重试。', '未进入', ['问题', '根因', '改进', '重试']],
  ['收尾/总验', '汇总全量层成果、回归和风险。', '未进入', ['成果', '回归', '风险', '结论']],
  ['收尾/裁定', '人工决定通过、退回、暂缓及冻结。', '未进入', ['结论', '理由', '冻结', '退回']],
  ['收尾/沉淀', '保存成果边界、经验候选与归档引用。', '未进入', ['成果', '边界', '经验', '归档']],
];

const program = String.raw`forms = [
    ('定向', '推进流总控/设标/定向'),
    ('调研', '推进流总控/设标/调研'),
    ('策评', '推进流总控/设标/策评'),
    ('建表', '推进流总控/建标/建表'),
    ('分层', '推进流总控/建标/分层'),
    ('分片', '推进流总控/建标/分片'),
    ('试点', '推进流总控/推进/试点'),
    ('回归', '推进流总控/推进/回归'),
    ('打磨', '推进流总控/推进/打磨'),
    ('总验', '推进流总控/收尾/总验'),
    ('裁定', '推进流总控/收尾/裁定'),
    ('沉淀', '推进流总控/收尾/沉淀')
]
current = ''
for form_name, form_path in forms:
    rows = explore({'name': form_path, 'children$latitude-1': None, 'detail$full': None})
    status = ''
    protected_refs = []
    for row in rows:
        if row.path == form_path + '/状态':
            status = row.detail.strip()
            protected_refs.append(row.ref)
        elif row.path == form_path or row.path.startswith(form_path + '/'):
            protected_refs.append(row.ref)
    if status == '已冻结' and protected_refs:
        lock({
            'targets': {'refs': protected_refs},
            'mode': 'write',
            'fields': ['name', 'detail', 'children', 'partners'],
            'protect': {'atom': True, 'messages': False},
            'reason': {'code': 'MANUAL_FREEZE', 'message': '该表单已人工冻结'}
        })
    if not current and status not in ['已通过', '已冻结']:
        current = form_name
navigation = explore({'name': '推进流总控/导航坐标', 'detail$full': None})
navigation_value = current or '已完成'
if navigation and navigation[0].detail != navigation_value:
    detail_command = 'detail.re' + 'p.' + navigation_value
    transform({'name': '推进流总控/导航坐标', detail_command: None})
message({'level': 'info', 'text': '推进流当前节点：' + navigation_value})`;

async function execute(source) {
  if (process.env.ATOM_DIRECT === '1') {
    const runtime = resolveAtomRuntime();
    const code = await runAtomCli([
      '--context', runtime.contextFile,
      '--projection', runtime.graphFile,
      source
    ], { interactive: false });
    if (code !== 0) throw new Error(`Atom CLI command failed with exit code ${code}`);
    return {};
  }
  const response = await fetch('http://127.0.0.1:4784/__atom/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source,
      interaction: { agent: { ref: 'resolved-by-service', path: '推进流总控' } }
    })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok || payload.result?.ok === false) {
    throw new Error(`Atom CLI command failed: ${JSON.stringify(payload)}`);
  }
  return payload.result;
}

if (process.env.ATOM_RECOVER_PROGRAM !== '1') {
  for (const [relativePath, purpose, initialStatus, fields] of forms) {
    const children = [
      { name: '状态', detail: initialStatus, children: [], partners: [] },
      ...fields.map((name) => ({ name, detail: '', children: [], partners: [] }))
    ];
    await execute(`transform {"name":${JSON.stringify(`推进流总控/${relativePath}`)},${JSON.stringify(`detail.rep.${purpose}`)},"children":${JSON.stringify(children)}}`);
  }

  await execute(`transform ${JSON.stringify({
    name: '推进流总控',
    children: [{ name: '导航坐标', detail: '定向', children: [], partners: [] }]
  })}`);
}

await execute(`transform {"name":"推进流总控/推进流路由",${JSON.stringify(`detail.rep.${program}`)}}`);

const navigation = await execute('explore {"name":"推进流总控/导航坐标","detail$full"}');
const direction = await execute('explore {"name":"推进流总控/设标/定向","children$latitude-1","detail$full"}');
console.log(JSON.stringify({
  navigation,
  direction
}, null, 2));
import { runAtomCli } from '../work-engine/atom-language/cli.mjs';
import { resolveAtomRuntime } from '../work-engine/atom-language/runtime-config.mjs';
