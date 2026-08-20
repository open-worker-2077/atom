"""Pure helpers available to trusted Atom Python Programs.

These functions interpret values already returned by ``explore``.  They never
read files, mutate the Atom world, or emit effects.  World changes remain
explicit calls to ``transform``, ``lock`` and ``message`` in Program source.
"""


def _join_path(parent_path, child_name):
    return f"{parent_path}/{child_name}" if parent_path else child_name


def direct_children(rows, parent_path):
    prefix = f"{parent_path}/" if parent_path else ""
    children = []
    for row in rows:
        if not row.path.startswith(prefix) or row.path == parent_path:
            continue
        remainder = row.path[len(prefix):]
        if "/" not in remainder:
            children.append(row)
    return children


def child_detail(rows, parent_path, child_name, default=""):
    expected_path = _join_path(parent_path, child_name)
    for row in rows:
        if row.path == expected_path:
            return row.detail
    return default


def missing_details(rows, parent_path, field_names):
    missing = []
    for field_name in field_names:
        value = child_detail(rows, parent_path, field_name, "")
        if not str(value).strip():
            missing.append(field_name)
    return missing


def form_status(rows, parent_path, status_name="状态"):
    return child_detail(rows, parent_path, status_name, "").strip()


def first_pending(forms, completed_states=("已通过", "已冻结")):
    completed = set(completed_states)
    for form in forms:
        if len(form) < 2:
            raise ValueError("Each form must contain a name and status")
        if form[-1] not in completed:
            return form
    return None


def transition_allowed(current_state, requested_state, transitions):
    allowed = transitions.get(current_state, [])
    return requested_state in allowed


def subtree_refs(rows, root_path):
    prefix = f"{root_path}/"
    return [row.ref for row in rows if row.path == root_path or row.path.startswith(prefix)]


def _atom(name, detail="", children=None, partners=None):
    return {
        "name": name,
        "detail": detail,
        "children": list(children or []),
        "partners": list(partners or []),
    }


def _field_definition(field):
    if isinstance(field, str):
        name = field
        detail = ""
    elif isinstance(field, dict):
        name = field.get("name")
        detail = field.get("detail", "")
    else:
        raise TypeError("Each form field must be a name or JSON object")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Each form field requires a non-empty name")
    if not isinstance(detail, str):
        raise TypeError("Form field detail must be a string")
    return {"name": name, "detail": detail}


def plan_form_flow(rows, parent_path, standard):
    if not isinstance(standard, dict):
        raise TypeError("plan_form_flow() standard must be a JSON object")
    forms = standard.get("forms")
    if not isinstance(forms, list):
        raise TypeError("plan_form_flow() standard.forms must be a list")
    status_name = standard.get("status_name", "状态")
    if not isinstance(status_name, str) or not status_name.strip():
        raise ValueError("plan_form_flow() status_name must be a non-empty string")

    row_paths = {row.path: row for row in rows}
    submitted_children = []
    conflicts = []
    seen_forms = set()

    for form in forms:
        if not isinstance(form, dict):
            raise TypeError("Each form definition must be a JSON object")
        form_name = form.get("name")
        if not isinstance(form_name, str) or not form_name.strip():
            raise ValueError("Each form requires a non-empty name")
        if form_name in seen_forms:
            raise ValueError(f"Duplicate form name: {form_name}")
        seen_forms.add(form_name)

        detail = form.get("detail", "")
        initial_status = form.get("status", "未进入")
        routes = form.get("routes", [])
        if not isinstance(detail, str) or not isinstance(initial_status, str):
            raise TypeError("Form detail and status must be strings")
        if not isinstance(routes, list) or any(not isinstance(route, dict) for route in routes):
            raise TypeError("Form routes must be a list of JSON objects")
        for route in routes:
            if not isinstance(route.get("verb"), str) or not isinstance(route.get("object"), str):
                raise TypeError("Each form route requires string verb and object values")

        field_definitions = [_field_definition(field) for field in form.get("fields", [])]
        field_names = [field["name"] for field in field_definitions]
        if status_name in field_names:
            raise ValueError(f"Status field {status_name!r} is created by the compiler")
        if len(set(field_names)) != len(field_names):
            raise ValueError(f"Duplicate field name in form {form_name!r}")

        form_path = _join_path(parent_path, form_name)
        existing_form = row_paths.get(form_path)
        desired_fields = [
            {"name": status_name, "detail": initial_status},
            *field_definitions,
        ]
        if existing_form is None:
            submitted_children.append(_atom(
                form_name,
                detail,
                [_atom(field["name"], field["detail"]) for field in desired_fields],
                routes,
            ))
            continue

        if detail and existing_form.detail != detail:
            conflicts.append(f"{form_path}:detail")
        if list(existing_form.partners) != routes:
            conflicts.append(f"{form_path}:routes")
        missing = []
        for field in desired_fields:
            field_path = _join_path(form_path, field["name"])
            if field_path not in row_paths:
                missing.append(_atom(field["name"], field["detail"]))
        if missing:
            submitted_children.append({"name": form_name, "children": missing})

    return {
        "children": submitted_children,
        "conflicts": conflicts,
        "complete": not submitted_children and not conflicts,
    }


def _compile_atom_template(template):
    if not isinstance(template, dict):
        raise TypeError("Each Atom template must be a JSON object")
    name = template.get("name")
    detail = template.get("detail", "")
    types = template.get("types", [])
    children = template.get("children", [])
    partners = template.get("partners", [])
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Each Atom template requires a non-empty name")
    if not isinstance(detail, str):
        raise TypeError("Atom template detail must be a string")
    if (not isinstance(types, list)
            or any(not isinstance(item, str) or not item.strip() for item in types)
            or len(set(types)) != len(types)):
        raise ValueError("Atom template types must be unique non-empty strings")
    if not isinstance(children, list):
        raise TypeError("Atom template children must be a list")
    if not isinstance(partners, list) or any(not isinstance(item, dict) for item in partners):
        raise TypeError("Atom template partners must be a list of JSON objects")
    child_names = [child.get("name") if isinstance(child, dict) else None for child in children]
    if len(set(child_names)) != len(child_names):
        raise ValueError(f"Duplicate child name in Atom template {name!r}")

    name_key = "name" + "".join(f"@{item}" for item in types)
    return {
        name_key: name,
        "detail": detail,
        "children": [_compile_atom_template(child) for child in children],
        "partners": [dict(item) for item in partners],
    }


def compile_form(specification):
    """Compile one protected Form definition to the four native Graph axes."""
    if not isinstance(specification, dict):
        raise TypeError("form() requires one JSON object argument")
    allowed = {"name", "detail", "children", "partners"}
    unknown = set(specification) - allowed
    if unknown:
        raise ValueError(
            "form() contains unsupported Graph axes: " + ", ".join(sorted(unknown))
        )
    name = specification.get("name")
    detail = specification.get("detail", "")
    children = specification.get("children", [])
    partners = specification.get("partners", [])
    if not isinstance(name, str) or not name.strip():
        raise ValueError("form() requires a non-empty name")
    if not isinstance(detail, str):
        raise TypeError("form.detail must be a string")
    if not isinstance(children, list):
        raise TypeError("form.children must be an array")
    if not isinstance(partners, list):
        raise TypeError("form.partners must be an array")
    compiled_children = [compile_form(child) for child in children]
    child_names = [child["name"] for child in compiled_children]
    if len(set(child_names)) != len(child_names):
        raise ValueError(f"form() contains duplicate child names under {name!r}")
    normalized_partners = []
    for relation in partners:
        if not isinstance(relation, dict):
            raise TypeError("form.partners items must be JSON objects")
        if set(relation) != {"verb", "object"}:
            raise ValueError("form.partners items require exactly verb and object")
        if not all(isinstance(relation[key], str) and relation[key].strip()
                   for key in ("verb", "object")):
            raise ValueError("form.partners verb and object must be non-empty strings")
        normalized_partners.append({"verb": relation["verb"], "object": relation["object"]})
    return {
        "name": name,
        "detail": detail,
        "children": compiled_children,
        "partners": normalized_partners,
    }


def _json_has_content(value):
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return bool(value)
    return True


def _normalize_form_component(component, parent_path=()):
    if not isinstance(component, dict):
        raise TypeError("form.evaluate components must be JSON objects")
    allowed = {"name", "activation", "value", "requirements", "components"}
    unknown = set(component) - allowed
    if unknown:
        raise ValueError(
            "form.evaluate component contains unknown keys: " + ", ".join(sorted(unknown))
        )
    name = component.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("form.evaluate component requires a non-empty name")
    activation = component.get("activation")
    if activation not in {"required", "optional", "disabled"}:
        raise ValueError(
            "form.evaluate component activation must be required, optional, or disabled"
        )
    requirements = component.get("requirements", [])
    children = component.get("components", [])
    if not isinstance(requirements, list):
        raise TypeError("form.evaluate component requirements must be an array")
    if not isinstance(children, list):
        raise TypeError("form.evaluate nested components must be an array")
    normalized_requirements = []
    for requirement in requirements:
        if not isinstance(requirement, dict) or set(requirement) != {"path"}:
            raise ValueError("form.evaluate requirements require exactly one path array")
        key_path = requirement["path"]
        if (not isinstance(key_path, list) or not key_path
                or any(not isinstance(key, str) or not key for key in key_path)):
            raise ValueError(
                "form.evaluate requirement path must contain non-empty JSON key strings"
            )
        normalized_requirements.append({"path": list(key_path)})
    normalized_children = [
        _normalize_form_component(child, (*parent_path, name)) for child in children
    ]
    child_names = [child["name"] for child in normalized_children]
    if len(set(child_names)) != len(child_names):
        location = "/".join((*parent_path, name))
        raise ValueError(f"form.evaluate contains duplicate component names under {location}")
    return {
        "name": name,
        "activation": activation,
        "value": component.get("value", {}),
        "requirements": normalized_requirements,
        "components": normalized_children,
    }


def _component_has_content(component):
    if component["activation"] == "disabled":
        return False
    if _json_has_content(component["value"]):
        return True
    return any(_component_has_content(child) for child in component["components"])


def _required_value(value, key_path):
    current = value
    for key in key_path:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    return current


def evaluate_form(specification):
    """Evaluate caller-selected components without reading or changing the Atom world."""
    if not isinstance(specification, dict):
        raise TypeError("form() requires one JSON object argument")
    unknown = set(specification) - {"action", "components"}
    if unknown:
        raise ValueError(
            "form.evaluate contains unknown options: " + ", ".join(sorted(unknown))
        )
    if specification.get("action") != "evaluate":
        raise ValueError("form.action must be evaluate when an action is supplied")
    submitted = specification.get("components")
    if not isinstance(submitted, list):
        raise TypeError("form.evaluate components must be an array")
    components = [_normalize_form_component(component) for component in submitted]
    component_names = [component["name"] for component in components]
    if len(set(component_names)) != len(component_names):
        raise ValueError("form.evaluate contains duplicate top-level component names")

    result = {
        "valid": True,
        "required": [],
        "optional": [],
        "disabled": [],
        "active": [],
        "missing": [],
    }

    def evaluate(component, parent_path=()):
        component_path = (*parent_path, component["name"])
        display_path = "/".join(component_path)
        activation = component["activation"]
        result[activation].append(display_path)
        if activation == "disabled":
            return
        engaged = activation == "required" or _component_has_content(component)
        if not engaged:
            return
        result["active"].append(display_path)
        for requirement in component["requirements"]:
            key_path = requirement["path"]
            if not _json_has_content(_required_value(component["value"], key_path)):
                result["missing"].append({
                    "component": list(component_path),
                    "path": list(key_path),
                })
        for child in component["components"]:
            evaluate(child, component_path)

    for component in components:
        evaluate(component)
    result["valid"] = not result["missing"]
    return result


def work_order_template(title, creation_id, version="1"):
    """Build the first Graph-native work-order template without emitting effects."""
    if str(version) != "1":
        raise ValueError(f"Unsupported work-order version {version}")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("work_order.create requires a non-empty title")
    if not isinstance(creation_id, str) or not creation_id.strip():
        raise ValueError("work_order.create requires a non-empty creation_id")

    root_detail = {
        "定义": "工单表示一项需要形成明确交付物并接受审核的工作任务。",
        "template": "work-order",
        "templateVersion": "1",
        "creationId": creation_id,
        "status": "待执行",
        "状态": {
            "定义": "表示整张工单从接收、执行、提交到审核结束的整体流转状态；不代替各Step的局部状态。",
            "当前": "待执行",
            "可选值": ["待执行", "执行中", "待验收", "已通过", "已驳回", "已暂缓"],
            "流转": ["待执行→执行中", "执行中→待验收", "待验收→已通过", "待验收→已驳回", "已驳回→执行中"],
        },
        "当前节点": "Step",
        "修订记录": [],
    }
    output_detail = {
        "定义": "领导或派活方要求最终交付的成果事物；它不是Step中的动作，也不是未经产出的字段清单。",
        "交付物": {"名称": None, "接收方": None, "成果引用": None, "版本": None},
    }
    step_detail = {
        "定义": "把已有输入加工为工单交付物的作业步骤；本工单当前只有一个Step。",
        "输入": {"定义": "进入本步骤并需要被加工的原始内容。", "内容": []},
        "加工": {"定义": "针对输入实际实施的整理、判断和转化动作。", "内容": None},
        "输出": {"定义": "本步骤加工完成后形成并交给工单Output的结果。", "目标": None},
        "支撑": {"定义": "帮助Step正确执行但不直接等同于输入或交付物的数据、规范、工具和上下文。", "数据": []},
        "操作": {"定义": "记录本Step的局部执行状态与实际发生事实；可与其他Step分别变化。", "状态": "未开始", "实际动作": [], "实际产出": [], "异常": []},
    }
    criteria_detail = {
        "定义": "针对Output的一组条件及其审核结果；要求与验收是同一标准的事前规定和事后判定。",
        "要求": {"定义": "执行前规定交付物必须符合的条件和不可越过的边界。", "条件": [], "边界": []},
        "验收": {
            "定义": "Output提交后，审核方依据同一组要求作出通过或驳回判定。",
            "提交": {"成果引用": None, "版本": None, "提交时间": None},
            "审核": {"结论": None, "意见": [], "审核人": None, "审核时间": None},
            "驳回": {"返回": "Step", "原因": []},
        },
    }

    def formatted(value):
        import json
        return json.dumps(value, ensure_ascii=False, indent=2)

    return compile_form({
        "name": title,
        "detail": formatted(root_detail),
        "children": [
            {"name": "Output", "detail": formatted(output_detail), "partners": [{"verb": "提交验收", "object": "Criteria"}]},
            {"name": "Step", "detail": formatted(step_detail), "partners": [{"verb": "产出", "object": "Output"}]},
            {"name": "Criteria", "detail": formatted(criteria_detail), "partners": [
                {"verb": "约束", "object": "Step"},
                {"verb": "驳回返工", "object": "Step"},
            ]},
        ],
    })


def plan_template_instance(rows, parent_path, template):
    compiled = _compile_atom_template(template)
    template_name = template.get("name")
    instance_path = _join_path(parent_path, template_name)
    existing = None
    for row in rows:
        if row.path == instance_path:
            existing = row
            break
    if existing is not None:
        expected_types = tuple(template.get("types", []))
        conflicts = []
        if tuple(existing.types) != expected_types:
            conflicts.append(f"{instance_path}:types")
        return {"children": [], "conflicts": conflicts, "exists": True}
    return {"children": [compiled], "conflicts": [], "exists": False}


def plan_shards(sources, specification):
    if not isinstance(specification, dict):
        raise TypeError("plan_shards() specification must be a JSON object")

    mode = specification.get("mode")
    if mode not in ("each", "fixed_size"):
        raise ValueError("plan_shards() mode must be 'each' or 'fixed_size'")

    if mode == "each":
        size = 1
    else:
        size = specification.get("size")
        if isinstance(size, bool) or not isinstance(size, int) or size < 1:
            raise ValueError("plan_shards() fixed_size requires a positive integer size")

    source_list = list(sources)
    groups = [source_list[index:index + size] for index in range(0, len(source_list), size)]
    prefix = str(specification.get("name_prefix", "分片"))
    width = max(2, len(str(len(groups))))
    plan = []
    for index, group in enumerate(groups, start=1):
        plan.append({
            "name": f"{prefix}{index:0{width}d}",
            "ordinal": index,
            "source_refs": [item.ref for item in group],
            "source_paths": [item.path for item in group],
        })
    return plan
