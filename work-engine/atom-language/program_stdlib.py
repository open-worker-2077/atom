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
