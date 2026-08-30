"""Trusted template registry used by Atom Program instantiate()."""


ADVANCEMENT_FORMS = (
    ("定向", "设标", "明确需求、目标、边界与达标条件。", ("需求", "目标", "边界", "达标")),
    ("调研", "设标", "从目标出发选择高价值渠道，研究并评估素材。", ("目标", "渠道", "高价值素材", "素材评估", "结论")),
    ("策评", "设标", "脑暴方法并同步评估后果，形成决定。", ("脑暴", "后果", "权衡", "决定")),
    ("建表", "建标", "定义推进所需表单、字段、引用与校验。", ("表单", "字段", "引用", "校验")),
    ("分层", "建标", "定义从基础层逐步扩大到全量层的范围和通过条件。", ("层序", "范围", "进入条件", "通过条件")),
    ("分片", "建标", "定义根据当前层规格生成下级工单的规则。", ("来源范围", "分片规格", "工单模板", "完成条件")),
    ("试点", "推进", "总控派发当前层分片，下级执行并一次性回执。", ("当前层", "派发", "下级回执")),
    ("回归", "推进", "总控审核验收当前分片，并一次性写回审核结果。", ("总控审核", "验收", "审核结果", "升层结论")),
    ("打磨", "推进", "针对问题根因改进并返回当前层重试。", ("问题", "根因", "改进", "重试")),
    ("总验", "收尾", "汇总全量层成果、回归和风险。", ("成果", "回归", "风险", "结论")),
    ("裁定", "收尾", "人工决定通过、退回、暂缓及冻结。", ("结论", "理由", "冻结", "退回")),
    ("沉淀", "收尾", "保存成果边界、经验候选与归档引用。", ("成果", "边界", "经验", "归档")),
)


INNER_ROUTER_SOURCE = """flow_path = current_atom().path.rsplit('/', 1)[0]
definitions = [
    ('定向', '设标/定向'), ('调研', '设标/调研'), ('策评', '设标/策评'),
    ('建表', '建标/建表'), ('分层', '建标/分层'), ('分片', '建标/分片'),
    ('试点', '推进/试点'), ('回归', '推进/回归'), ('打磨', '推进/打磨'),
    ('总验', '收尾/总验'), ('裁定', '收尾/裁定'), ('沉淀', '收尾/沉淀')
]
states = []
framework_paths = [flow_path] + [flow_path + '/' + block for block in ['设标', '建标', '推进', '收尾']]
framework_refs = []
for framework_path in framework_paths:
    framework_rows = explore({'thing': framework_path})
    if framework_rows:
        framework_refs.append(framework_rows[0].ref)
if framework_refs:
    lock({'targets': {'refs': framework_refs}, 'mode': 'write', 'fields': ['thing', 'situation'], 'protect': {'atom': True, 'messages': False}, 'reason': {'code': 'FRAMEWORK_SCHEMA', 'message': '推进流第1至2级框架由模板维护；请填写下级表单字段，不要修改框架名称与总说明'}})
for form_name, relative_path in definitions:
    form_path = flow_path + '/' + relative_path
    rows = explore({'thing': form_path, 'contain$latitude-1': None, 'situation$full': None})
    status = form_status(rows, form_path)
    states.append((form_name, form_path, status))
    if status == '已冻结':
        refs = subtree_refs(rows, form_path)
        if refs:
            lock({'targets': {'refs': refs}, 'mode': 'write', 'fields': ['thing', 'situation', 'contain', 'support'], 'protect': {'atom': True, 'messages': False}, 'reason': {'code': 'MANUAL_FREEZE', 'message': '该表单已人工冻结；如需继续，请向人工反馈解冻需求'}})
pending = first_pending(states, ['已通过', '已冻结'])
navigation_value = pending[0] if pending else '已完成'
navigation = explore({'thing': flow_path + '/导航坐标', 'situation$full': None})
if navigation and navigation[0].situation != navigation_value:
    command = 'situation.re' + 'p.' + navigation_value
    transform({'thing': flow_path + '/导航坐标', command: None})
message({'level': 'info', 'text': '推进流当前节点：' + navigation_value})"""


def _atom(name, detail="", children=None, support=None, types=None):
    result = {"thing": name, "situation": detail}
    if types:
        result["types"] = list(types)
    if children:
        result["contain"] = list(children)
    if support:
        result["support"] = list(support)
    return result


def _legacy_form(name, purpose, fields, next_name=None):
    routes = ([{"if@current": True, "then": [{"thing": next_name}]}]
              if next_name else [])
    return _atom(
        name,
        purpose,
        [_atom("状态", "未进入"), *[_atom(field) for field in fields]],
        routes,
    )


COMPLETION_GATE_SOURCE = """def main(arguments):
    form_path = current_atom().path.rsplit('/', 1)[0]
    rows = explore({'thing': form_path + '/状态', 'situation$full': None})
    return bool(rows and rows[0].situation in ['已通过', '已冻结'])"""


def _gated_form(name, purpose, fields, previous_name=None, has_next=False):
    routes = ([{
        "if": [{"thing@program": f"{previous_name}完成门"}],
        "then@current": True,
    }] if previous_name else [])
    children = [_atom("状态", "未进入"), *[_atom(field) for field in fields]]
    if has_next:
        children.append(_atom(f"{name}完成门", COMPLETION_GATE_SOURCE, types=["program"]))
    return _atom(name, purpose, children, routes)


def _advancement_flow_roots(parameters, version, gated):
    title = parameters.get("title", "")
    if not isinstance(title, str):
        raise TypeError("advancement-flow parameter 'title' must be a string")
    allowed = {"title"}
    unknown = set(parameters) - allowed
    if unknown:
        raise ValueError(f"Unknown advancement-flow parameters: {', '.join(sorted(unknown))}")
    next_by_name = {
        current[0]: ADVANCEMENT_FORMS[index + 1][0]
        for index, current in enumerate(ADVANCEMENT_FORMS[:-1])
    }
    grouped = {}
    previous_name = None
    for name, block, purpose, fields in ADVANCEMENT_FORMS:
        form = (_gated_form(
            name, purpose, fields, previous_name, name in next_by_name
        ) if gated else _legacy_form(
            name, purpose, fields, next_by_name.get(name)
        ))
        grouped.setdefault(block, []).append(form)
        previous_name = name
    return [
        _atom("编标版本", version),
        _atom("任务标题", title),
        _atom("导航坐标", "定向"),
        _atom("设标", "人工主导方法逻辑。", grouped["设标"]),
        _atom("建标", "Agent编制表单、状态与路由。", grouped["建标"]),
        _atom("推进", "按层生成工单，由总控派发、验收和调整节奏。", grouped["推进"]),
        _atom("收尾", "人工总验、裁定和沉淀。", grouped["收尾"]),
        _atom("内部路由", INNER_ROUTER_SOURCE, types=["program"]),
    ]


def advancement_flow_roots_v1(parameters):
    return _advancement_flow_roots(parameters, "1", False)


def advancement_flow_roots_v2(parameters):
    return _advancement_flow_roots(parameters, "2", True)


TEMPLATE_CATALOG = {
    "advancement-flow": {
        "label": "推进流",
        "description": "生成设标、建标、推进、收尾及内部路由 Program。",
        "latest": "2",
        "versions": {
            "1": advancement_flow_roots_v1,
            "2": advancement_flow_roots_v2,
        },
        "parameters": {
            "type": "object",
            "properties": {"title": {"type": "string", "description": "任务标题"}},
            "additionalProperties": False,
        },
    }
}


def catalog_entries(specification):
    requested = specification.get("template")
    unknown_keys = set(specification) - {"template"}
    if unknown_keys:
        raise ValueError(f"Unknown template_catalog options: {', '.join(sorted(unknown_keys))}")
    if requested is not None and requested not in TEMPLATE_CATALOG:
        raise ValueError(f"Unknown template {requested!r}")
    entries = []
    for template_id in sorted(TEMPLATE_CATALOG):
        if requested is not None and template_id != requested:
            continue
        entry = TEMPLATE_CATALOG[template_id]
        properties = {
            name: dict(definition)
            for name, definition in entry["parameters"]["properties"].items()
        }
        entries.append({
            "id": template_id,
            "label": entry["label"],
            "description": entry["description"],
            "latest": entry["latest"],
            "parameters": {
                "type": "object",
                "properties": properties,
                "additionalProperties": entry["parameters"]["additionalProperties"],
            },
        })
    return entries


def resolve_instantiation(specification):
    template_id = specification.get("template")
    version = specification.get("version", "latest")
    mode = specification.get("mode", "ensure")
    parameters = specification.get("parameters", {})
    if template_id not in TEMPLATE_CATALOG:
        available = ", ".join(sorted(TEMPLATE_CATALOG))
        raise ValueError(f"Unknown template {template_id!r}; available templates: {available}")
    if mode != "ensure":
        raise ValueError("instantiate() currently supports mode 'ensure' only")
    if not isinstance(parameters, dict):
        raise TypeError("instantiate.parameters must be a JSON object")
    entry = TEMPLATE_CATALOG[template_id]
    resolved_version = entry["latest"] if version == "latest" else str(version)
    builder = entry["versions"].get(resolved_version)
    if builder is None:
        raise ValueError(f"Unknown {template_id!r} template version {version!r}")
    return {
        "template": template_id,
        "version": resolved_version,
        "mode": mode,
        "roots": builder(parameters),
    }
