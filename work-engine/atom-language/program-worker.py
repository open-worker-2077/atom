import ast
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True


def load_program_stdlib():
    module_path = Path(__file__).with_name("program_stdlib.py")
    specification = importlib.util.spec_from_file_location("atom_program_stdlib", module_path)
    if specification is None or specification.loader is None:
        raise RuntimeError("Unable to load the trusted Atom Program standard library")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


PROGRAM_STDLIB = load_program_stdlib()
child_detail = PROGRAM_STDLIB.child_detail
direct_children = PROGRAM_STDLIB.direct_children
first_pending = PROGRAM_STDLIB.first_pending
form_status = PROGRAM_STDLIB.form_status
missing_details = PROGRAM_STDLIB.missing_details
plan_shards = PROGRAM_STDLIB.plan_shards
plan_form_flow = PROGRAM_STDLIB.plan_form_flow
plan_template_instance = PROGRAM_STDLIB.plan_template_instance
subtree_refs = PROGRAM_STDLIB.subtree_refs
transition_allowed = PROGRAM_STDLIB.transition_allowed
compile_form = PROGRAM_STDLIB.compile_form
evaluate_form = PROGRAM_STDLIB.evaluate_form
work_order_template = PROGRAM_STDLIB.work_order_template
json_parse_impl = PROGRAM_STDLIB.json_parse
json_stringify_impl = PROGRAM_STDLIB.json_stringify


def load_program_function_registry():
    module_path = Path(__file__).with_name("program-function-registry.json")
    value = json.loads(module_path.read_text(encoding="utf-8"))
    if (value.get("contract") != "atom-program-function-registry"
            or value.get("version") != 4
            or value.get("runtimeContract") != "atom-interaction/3"):
        raise RuntimeError("Program function registry has an invalid public contract")
    families = set()
    kernel_families = set()
    for item in value.get("functionFamilies", []):
        layer = item.get("layer")
        family = item.get("id")
        key = (layer, family)
        if (layer not in {"kernel", "application"}
                or not isinstance(family, str) or not family
                or not isinstance(item.get("label"), str) or not item["label"]
                or key in families):
            raise RuntimeError("Program function registry contains an invalid function family")
        families.add(key)
        if layer == "kernel":
            kernel_families.add(family)
    if kernel_families != {"graph", "form", "program"}:
        raise RuntimeError("Kernel function families must be graph, form, and program")
    names = set()
    for item in value.get("functions", []):
        name = item.get("name")
        layer = item.get("layer")
        family = item.get("family")
        scope = item.get("scope")
        if (not isinstance(name, str) or not name or name in names
                or (layer, family) not in families
                or scope not in {"atom", "public"}
                or "category" in item
                or "effectiveConstraints" in item):
            raise RuntimeError(f"Invalid or duplicate Program function: {name}")
        names.add(name)
    executable = [item for item in value.get("types", []) if item.get("executable")]
    if executable != [{"id": "program", "layer": "kernel", "executable": True}]:
        raise RuntimeError("Program must be the only executable kernel type")
    return value


PROGRAM_FUNCTION_REGISTRY = load_program_function_registry()
REGISTERED_PROGRAM_FUNCTIONS = {
    item["name"] for item in PROGRAM_FUNCTION_REGISTRY["functions"]
}


def load_program_templates():
    module_path = Path(__file__).with_name("program_templates.py")
    specification = importlib.util.spec_from_file_location("atom_program_templates", module_path)
    if specification is None or specification.loader is None:
        raise RuntimeError("Unable to load the trusted Atom Program template registry")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


PROGRAM_TEMPLATES = load_program_templates()


def load_work_order_registry():
    module_path = Path(__file__).with_name("work-order-registry.json")
    with module_path.open("r", encoding="utf-8") as handle:
        registry = json.load(handle)
    if (registry.get("contract") != "atom-work-order-registry"
            or registry.get("version") != 1):
        raise RuntimeError("Unable to load the trusted work-order registry")
    return registry


WORK_ORDER_REGISTRY = load_work_order_registry()


class ProgramSecurityError(Exception):
    pass


ALLOWED_NODE_TYPES = (
    ast.Module, ast.Expr, ast.Assign, ast.AnnAssign, ast.AugAssign,
    ast.If, ast.For, ast.While, ast.Break, ast.Continue, ast.Pass,
    ast.FunctionDef, ast.Return, ast.arguments, ast.arg,
    ast.Try, ast.ExceptHandler, ast.Raise, ast.Assert,
    ast.BoolOp, ast.BinOp, ast.UnaryOp, ast.Compare, ast.IfExp,
    ast.Call, ast.keyword, ast.Constant, ast.Name, ast.Load, ast.Store,
    ast.List, ast.Tuple, ast.Set, ast.Dict, ast.Subscript, ast.Slice,
    ast.Attribute, ast.ListComp, ast.SetComp, ast.DictComp,
    ast.GeneratorExp, ast.comprehension, ast.JoinedStr, ast.FormattedValue,
    ast.And, ast.Or, ast.Not, ast.Add, ast.Sub, ast.Mult, ast.Div,
    ast.FloorDiv, ast.Mod, ast.Pow, ast.USub, ast.UAdd,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
    ast.In, ast.NotIn, ast.Is, ast.IsNot,
)

ALLOWED_FUNCTIONS = {
    "all", "any", "bool", "dict", "enumerate", "filter", "float",
    "int", "len", "list", "map", "max", "min", "range", "set",
    "sorted", "str", "sum", "tuple", "zip",
    "Exception", "ValueError", "TypeError",
    "explore", "transform", "lock", "message", "choice", "current_atom", "trigger",
    "direct_children", "child_detail", "missing_details", "form_status",
    "first_pending", "transition_allowed", "subtree_refs", "plan_form_flow",
    "plan_template_instance", "plan_shards", "instantiate", "template_catalog",
} | REGISTERED_PROGRAM_FUNCTIONS

ALLOWED_METHODS = {
    "append", "extend", "insert", "pop", "remove", "clear", "copy",
    "count", "index", "sort", "reverse", "add", "discard", "update",
    "get", "items", "keys", "values", "setdefault",
    "startswith", "endswith", "strip", "lstrip", "rstrip", "lower",
    "upper", "casefold", "replace", "split", "rsplit", "join", "find",
}


def validate_program(source, filename):
    try:
        tree = ast.parse(source, filename=filename, mode="exec")
    except SyntaxError:
        raise

    defined_functions = {
        node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
    }
    for node in ast.walk(tree):
        if not isinstance(node, ALLOWED_NODE_TYPES):
            raise ProgramSecurityError(
                f"Python construct {type(node).__name__} is not allowed in Atom Program"
            )
        if isinstance(node, ast.Name) and node.id.startswith("_"):
            raise ProgramSecurityError("Private and dunder names are not allowed in Atom Program")
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise ProgramSecurityError("Private and dunder attributes are not allowed in Atom Program")
        if isinstance(node, ast.FunctionDef):
            if node.decorator_list:
                raise ProgramSecurityError("Function decorators are not allowed in Atom Program")
            if node.name.startswith("_"):
                raise ProgramSecurityError("Private function names are not allowed in Atom Program")
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id not in ALLOWED_FUNCTIONS | defined_functions:
                    raise ProgramSecurityError(
                        f"Function {node.func.id!r} is not allowed in Atom Program"
                    )
            elif isinstance(node.func, ast.Attribute):
                if node.func.attr not in ALLOWED_METHODS:
                    raise ProgramSecurityError(
                        f"Method {node.func.attr!r} is not allowed in Atom Program"
                    )
            else:
                raise ProgramSecurityError("Indirect callable expressions are not allowed in Atom Program")
    return tree


def extract_trigger_contract(tree):
    declarations = [
        node.value for node in tree.body
        if isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
        and node.value.func.id == "trigger"
    ]
    if not declarations:
        return None
    if len(declarations) != 1:
        raise ProgramSecurityError("Atom Program must declare at most one trigger()")
    declaration = declarations[0]
    if declaration.keywords or len(declaration.args) != 3:
        raise ProgramSecurityError(
            "trigger() requires mode, mode parameters, and one function reference"
        )
    try:
        mode = ast.literal_eval(declaration.args[0])
        parameters = ast.literal_eval(declaration.args[1])
    except (TypeError, ValueError, SyntaxError) as error:
        raise ProgramSecurityError(
            "trigger mode and parameters must be literal JSON-compatible values"
        ) from error
    entrypoint_node = declaration.args[2]
    if not isinstance(entrypoint_node, ast.Name):
        raise ProgramSecurityError("trigger() third argument must be a function reference, not a call")
    entrypoint = entrypoint_node.id
    functions = {
        node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)
    }
    function = functions.get(entrypoint)
    if function is None:
        raise ProgramSecurityError(f"trigger() entrypoint is not defined: {entrypoint}")
    if function.args.args or function.args.vararg or function.args.kwarg:
        raise ProgramSecurityError("trigger() entrypoint must accept no arguments")
    if mode != "transform":
        raise ProgramSecurityError("trigger() currently supports only transform mode")
    if (not isinstance(parameters, dict)
            or set(parameters) != {"nodes"}
            or not isinstance(parameters.get("nodes"), list)
            or not parameters["nodes"]
            or any(not isinstance(value, str) or not value.strip()
                   for value in parameters["nodes"])
            or len(set(parameters["nodes"])) != len(parameters["nodes"])):
        raise ProgramSecurityError(
            "trigger transform parameters require one non-empty unique nodes string list"
        )
    return {
        "mode": mode,
        "parameters": {"nodes": [value.strip() for value in parameters["nodes"]]},
        "entrypoint": entrypoint,
    }


class AtomView:
    __slots__ = ("ref", "name", "detail", "path", "types", "partners", "_record")

    def __init__(self, record):
        self.ref = record["ref"]
        self.name = record["name"]
        self.detail = record["detail"]
        self.path = record["path"]
        self.types = tuple(record["types"])
        self.partners = tuple(record.get("partners", []))
        self._record = record

    def __repr__(self):
        return f"AtomView(name={self.name!r}, path={self.path!r})"


def require_object(value, function_name):
    if not isinstance(value, dict):
        raise TypeError(f"{function_name}() requires one JSON object argument")
    return value


def main():
    request = json.loads(sys.stdin.readline())
    records = request["world"]
    by_ref = {record["ref"]: record for record in records}
    views = {ref: AtomView(record) for ref, record in by_ref.items()}
    effects = {"locks": [], "messages": [], "transforms": [], "choices": [], "slotBodies": []}

    next_request_id = 0

    def call_engine(function_name, specification):
        nonlocal next_request_id
        specification = require_object(specification, function_name)
        next_request_id += 1
        sys.stdout.write(json.dumps({
            "type": "call",
            "id": next_request_id,
            "function": function_name,
            "request": specification,
        }, ensure_ascii=True, allow_nan=False) + "\n")
        sys.stdout.flush()
        response = json.loads(sys.stdin.readline())
        if response.get("id") != next_request_id:
            raise RuntimeError("Atom engine returned a mismatched world-function response")
        if not response.get("ok"):
            raise RuntimeError(response.get("error", {}).get("message", "Atom world function failed"))
        return response.get("result")

    def remember(result):
        result_refs = []
        for item in result:
            if isinstance(item, dict):
                ref = item["ref"]
                by_ref[ref] = item
                views[ref] = AtomView(item)
                result_refs.append(ref)
            else:
                result_refs.append(item)
        return result_refs

    def explore(query):
        result_refs = remember(call_engine("explore", query))
        return [views[ref] for ref in result_refs]

    def lock(specification):
        specification = require_object(specification, "lock")
        effects["locks"].append(specification)

    def message(specification):
        specification = require_object(specification, "message")
        effects["messages"].append(specification)

    def transform(specification):
        specification = require_object(specification, "transform")
        effects["transforms"].append(specification)

    def slot_body(specification):
        specification = require_object(specification, "slot_body")
        effects["slotBodies"].append(specification)
        action = specification.get("action")
        body = specification.get("body")
        result = {"planned": True, "action": action, "body": body}
        if "name" in specification:
            result["target"] = body + "/槽例/" + str(specification["name"])
        return result

    def choice(specification):
        specification = require_object(specification, "choice")
        effects["choices"].append(specification)
        selected = specification.get("selected", [])
        if not isinstance(selected, list):
            raise TypeError("choice.selected must be an array")
        return list(selected)

    def trigger(mode, parameters, entrypoint):
        if request.get("triggered") is True:
            entrypoint()

    program_stack = [request["program"]["ref"]]

    def current_atom():
        return views[program_stack[-1]]

    def instantiate(specification):
        specification = require_object(specification, "instantiate")
        resolved = PROGRAM_TEMPLATES.resolve_instantiation(specification)
        program = current_atom()
        result_refs = remember(call_engine("explore", {
            "name": program.path,
            "children$latitude-1": None,
            "detail$full": None,
        }))
        rows = [views[ref] for ref in result_refs]
        children = []
        conflicts = []
        for template in resolved["roots"]:
            plan = plan_template_instance(rows, program.path, template)
            children.extend(plan["children"])
            conflicts.extend(plan["conflicts"])
        if children:
            effects["transforms"].append({"name": program.path, "children": children})
        if conflicts:
            effects["messages"].append({
                "level": "warning",
                "text": "模板实例与已有结构冲突：" + ",".join(conflicts),
            })
        return {
            "template": resolved["template"],
            "version": resolved["version"],
            "created": [next(iter(child.values())) for child in children],
            "conflicts": conflicts,
        }

    def template_catalog(specification):
        specification = require_object(specification, "template_catalog")
        return PROGRAM_TEMPLATES.catalog_entries(specification)

    def form(specification):
        specification = require_object(specification, "form")
        if "action" in specification:
            return evaluate_form(specification)
        return compile_form(specification)

    def parse_detail(record):
        try:
            value = json.loads(record.get("detail", ""))
            return value if isinstance(value, dict) else {}
        except (TypeError, ValueError):
            return {}

    def formatted_detail(value):
        return json.dumps(value, ensure_ascii=False, indent=2)

    def merge_declared_detail(current, patch, group_name, prefix=""):
        if not isinstance(patch, dict):
            raise TypeError(f"work_order values for {group_name} must be a JSON object")
        merged = dict(current)
        for key, value in patch.items():
            field_path = f"{prefix}.{key}" if prefix else key
            if key == "定义":
                raise ValueError(f"Reserved {group_name} guidance field cannot be filled: {field_path}")
            if key not in current:
                raise ValueError(f"Unknown {group_name} field: {field_path}")
            existing = current[key]
            if isinstance(existing, dict):
                if not isinstance(value, dict):
                    raise TypeError(f"work_order {group_name}.{field_path} must be a JSON object")
                merged[key] = merge_declared_detail(
                    existing, value, group_name, field_path
                )
            else:
                merged[key] = value
        return merged

    def content_at(value, path):
        current = value
        for key in path:
            current = current.get(key) if isinstance(current, dict) else None
        return current

    def has_content(value):
        if value is None:
            return False
        if isinstance(value, str):
            return bool(value.strip())
        if isinstance(value, (list, dict)):
            return bool(value)
        return True

    def incomplete_work_order_groups(selector, details):
        missing = []
        output = details.get("Output", {})
        if "requestedResult" in output:
            output_complete = has_content(output.get("requestedResult"))
        else:
            output_complete = (
                has_content(content_at(output, ("交付物", "成果引用")))
                and has_content(content_at(output, ("交付物", "版本")))
            )
        step = details.get("Step", {})
        if "evidence" in step:
            step_complete = has_content(step.get("evidence"))
        else:
            step_complete = (
                has_content(content_at(step, ("操作", "实际产出")))
                and content_at(step, ("操作", "状态")) == "已完成"
                and not has_content(content_at(step, ("操作", "异常")))
            )
        criteria = details.get("Criteria", {})
        if "acceptanceRules" in criteria:
            criteria_complete = has_content(criteria.get("acceptanceRules"))
        else:
            criteria_complete = has_content(content_at(criteria, ("要求", "条件")))
        for name, complete in (
            ("Output", output_complete),
            ("Step", step_complete),
            ("Criteria", criteria_complete),
        ):
            if not complete:
                missing.append(selector + "/" + name)
        return missing

    def root_status(detail):
        status = detail.get("status")
        if isinstance(status, str) and status.strip():
            return status
        return content_at(detail, ("状态", "当前"))

    def with_root_status(detail, status):
        updated = dict(detail)
        updated["status"] = status
        state = dict(updated.get("状态", {}))
        state["当前"] = status
        updated["状态"] = state
        return updated

    def work_order_actions(status):
        return {
            "待执行": ["fill", "validate", "read-back"],
            "执行中": ["fill", "validate", "submit", "read-back"],
            "待验收": ["submit", "reject", "read-back"],
            "已通过": ["read-back"],
            "已驳回": ["revise", "read-back"],
            "已暂缓": ["read-back"],
        }.get(status, ["read-back"])

    def work_order_catalog(specification):
        specification = require_object(specification, "work_order_catalog")
        unknown = set(specification) - {"template", "version"}
        if unknown:
            raise ValueError(
                "Unknown work_order_catalog options: " + ", ".join(sorted(unknown))
            )
        template_id = specification.get("template", "work-order")
        templates = [
            item for item in WORK_ORDER_REGISTRY["templates"]
            if item["id"] == template_id
        ]
        if len(templates) != 1:
            raise ValueError(f"Unknown work-order template {template_id}")
        template = templates[0]
        requested_version = str(specification.get("version", template["latest"]))
        versions = [
            item for item in template["versions"]
            if str(item["version"]) == requested_version
        ]
        if len(versions) != 1:
            raise ValueError(f"Unsupported work-order version {requested_version}")
        return {
            "template": template["id"],
            "label": template["label"],
            "description": template["description"],
            **json.loads(json.dumps(versions[0], ensure_ascii=False)),
        }

    def function_catalog(specification):
        specification = require_object(specification, "function_catalog")
        unknown = set(specification) - {"layer", "family", "scope"}
        if unknown:
            raise ValueError(
                "Unknown function_catalog options: " + ", ".join(sorted(unknown))
            )
        requested_layer = specification.get("layer")
        requested_family = specification.get("family")
        requested_scope = specification.get("scope")
        if requested_layer is not None and requested_layer not in {"kernel", "application"}:
            raise ValueError("function_catalog.layer must be kernel or application")
        if requested_family is not None and not isinstance(requested_family, str):
            raise TypeError("function_catalog.family must be a string")
        if requested_scope is not None and requested_scope not in {"atom", "public"}:
            raise ValueError("function_catalog.scope must be atom or public")
        result = json.loads(json.dumps(PROGRAM_FUNCTION_REGISTRY, ensure_ascii=False))
        result["functions"] = [
            item for item in result["functions"]
            if (requested_layer is None or item["layer"] == requested_layer)
            and (requested_family is None or item["family"] == requested_family)
            and (requested_scope is None or item["scope"] == requested_scope)
        ]
        return result

    def work_order_instance(selector):
        if not isinstance(selector, str) or not selector.strip():
            raise ValueError("work_order action requires one exact path")
        rows = explore({
            "name": selector,
            "children$latitude-1": None,
            "detail$full": None,
        })
        records = [by_ref[row.ref] for row in rows]
        matches = [record for record in records if record["path"] == selector]
        if len(matches) != 1:
            raise ValueError(f"Work-order path must resolve exactly once: {selector}")
        root = matches[0]
        root_detail = parse_detail(root)
        if root_detail.get("template") != "work-order":
            raise ValueError(f"Atom is not a work-order instance: {selector}")
        if str(root_detail.get("templateVersion")) != "1":
            raise ValueError(
                f"Unsupported work-order instance version {root_detail.get('templateVersion')}"
            )
        children = {
            record["name"]: record
            for record in records
            if record["path"].startswith(selector + "/")
            and "/" not in record["path"][len(selector) + 1:]
        }
        required = {"Output", "Step", "Criteria"}
        if set(children) != required:
            raise ValueError(f"Work-order groups must be exactly Output, Step, Criteria: {selector}")
        details = {name: parse_detail(children[name]) for name in required}
        return root, root_detail, children, details

    def merged_group_values(details, values):
        if not isinstance(values, dict) or not values:
            raise ValueError("work_order values must be a non-empty JSON object")
        unknown = set(values) - {"Output", "Step", "Criteria"}
        if unknown:
            raise ValueError("Unknown work-order group: " + ", ".join(sorted(unknown)))
        updates = {}
        for name in ("Output", "Step", "Criteria"):
            if name not in values:
                continue
            updates[name] = merge_declared_detail(details[name], values[name], name)
        return updates

    def emit_detail_transform(path, current, updated):
        if current != updated:
            effects["transforms"].append({
                "name": path,
                "detail$replace": formatted_detail(updated),
            })

    def work_order(specification):
        specification = require_object(specification, "work_order")
        action = specification.get("action")
        supported_actions = {
            item["id"] for item in work_order_catalog({"version": "1"})["actions"]
        }
        if action not in supported_actions:
            raise ValueError(f"Unsupported work-order action {action}")
        if action == "create":
            allowed = {"action", "title", "creation_id", "version"}
            unknown = set(specification) - allowed
            if unknown:
                raise ValueError("Unknown work_order.create options: " + ", ".join(sorted(unknown)))
            title = specification.get("title")
            creation_id = specification.get("creation_id")
            requested_version = specification.get("version")
            if requested_version is None:
                raise ValueError("work_order.create requires an exact version")
            version = str(requested_version)
            template = work_order_template(title, creation_id, version)
            rows = explore({
                "name": current_atom().path,
                "children$latitude-1": None,
                "detail$full": None,
            })
            identities = []
            for row in rows:
                record = by_ref[row.ref]
                detail = parse_detail(record)
                if detail.get("template") == "work-order" and detail.get("creationId") == creation_id:
                    identities.append(record)
            if len(identities) > 1:
                raise ValueError(f"Work-order creation identity is ambiguous: {creation_id}")
            if identities:
                existing = identities[0]
                if existing["name"] != title:
                    raise ValueError(
                        f"Work-order creation identity {creation_id} already belongs to {existing['name']}"
                    )
                existing_detail = parse_detail(existing)
                if str(existing_detail.get("templateVersion")) != version:
                    raise ValueError(f"Work-order creation identity {creation_id} has another template version")
                return {"template": "work-order", "version": version, "created": False, "path": existing["path"]}
            effects["transforms"].append({"name": current_atom().path, "children": [template]})
            return {"template": "work-order", "version": version, "created": True, "path": current_atom().path + "/" + title}
        selector = specification.get("path")
        allowed_options = {
            "fill": {"action", "path", "values"},
            "validate": {"action", "path"},
            "submit": {
                "action", "path", "submitted_at", "decision", "reviewer", "reviewed_at"
            },
            "reject": {"action", "path", "reasons", "reviewer", "reviewed_at"},
            "revise": {"action", "path", "values", "note"},
            "read-back": {"action", "path"},
        }
        unknown = set(specification) - allowed_options[action]
        if unknown:
            raise ValueError(
                f"Unknown work_order.{action} options: " + ", ".join(sorted(unknown))
            )
        root, root_detail, children, details = work_order_instance(selector)
        status = root_status(root_detail)

        if action == "validate":
            missing = incomplete_work_order_groups(selector, details)
            return {"valid": not missing, "missing": missing, "status": status}

        if action == "read-back":
            missing = incomplete_work_order_groups(selector, details)
            return {
                "template": "work-order",
                "version": "1",
                "path": selector,
                "status": status,
                "valid": not missing,
                "missing": missing,
                "available_actions": work_order_actions(status),
                "guidance": {
                    "Output": "填写交付物成果引用和版本。",
                    "Step": "记录已完成状态、实际动作、实际产出和异常。",
                    "Criteria": "填写验收条件和不可越过的边界。",
                },
                "values": {
                    "Output": details["Output"].get("交付物", details["Output"].get("requestedResult")),
                    "Step": details["Step"].get("操作", details["Step"].get("evidence")),
                    "Criteria": details["Criteria"].get("要求", details["Criteria"].get("acceptanceRules")),
                },
            }

        if action == "fill":
            if status not in {"待执行", "执行中"}:
                raise ValueError(f"work_order.fill is not allowed from status {status}")
            updates = merged_group_values(details, specification.get("values"))
            for name, updated in updates.items():
                emit_detail_transform(children[name]["path"], details[name], updated)
            updated_root = with_root_status(root_detail, "执行中")
            emit_detail_transform(root["path"], root_detail, updated_root)
            return {
                "filled": any(details[name] != updated for name, updated in updates.items()),
                "status": "执行中",
                "path": selector,
            }

        if action == "submit":
            missing = incomplete_work_order_groups(selector, details)
            if missing:
                return {"submitted": False, "status": status, "missing": missing}
            decision = specification.get("decision")
            if decision not in {None, "通过"}:
                raise ValueError("work_order.submit decision must be 通过 when provided")
            submitted_at = specification.get("submitted_at")
            output = content_at(details["Output"], ("交付物",))
            criteria = details["Criteria"]
            submission = content_at(criteria, ("验收", "提交"))
            if not isinstance(submission, dict):
                raise ValueError("work_order Criteria is missing 验收.提交")
            if not isinstance(submitted_at, str) or not submitted_at.strip():
                submitted_at = submission.get("提交时间")
            if not isinstance(submitted_at, str) or not submitted_at.strip():
                raise ValueError("work_order.submit requires submitted_at")
            expected_submission = {
                "成果引用": output.get("成果引用") if isinstance(output, dict) else None,
                "版本": output.get("版本") if isinstance(output, dict) else None,
                "提交时间": submitted_at,
            }
            acceptance = dict(criteria.get("验收", {}))
            audit = dict(acceptance.get("审核", {}))
            if decision == "通过":
                reviewer = specification.get("reviewer")
                reviewed_at = specification.get("reviewed_at")
                if not isinstance(reviewer, str) or not reviewer.strip():
                    raise ValueError("work_order.submit decision requires reviewer")
                if not isinstance(reviewed_at, str) or not reviewed_at.strip():
                    raise ValueError("work_order.submit decision requires reviewed_at")
                expected_audit = {
                    **audit,
                    "结论": "通过",
                    "意见": [],
                    "审核人": reviewer,
                    "审核时间": reviewed_at,
                }
                if (status == "已通过" and submission == expected_submission
                        and audit == expected_audit):
                    return {
                        "submitted": False, "idempotent": True,
                        "status": status, "missing": []
                    }
                if status not in {"执行中", "待验收"}:
                    raise ValueError(f"work_order.submit is not allowed from status {status}")
                acceptance["提交"] = expected_submission
                acceptance["审核"] = expected_audit
                updated_criteria = {**criteria, "验收": acceptance}
                emit_detail_transform(
                    children["Criteria"]["path"], criteria, updated_criteria
                )
                updated_root = with_root_status(root_detail, "已通过")
                emit_detail_transform(root["path"], root_detail, updated_root)
                return {"submitted": True, "status": "已通过", "missing": []}
            if status == "待验收" and submission == expected_submission:
                return {"submitted": False, "idempotent": True, "status": status, "missing": []}
            if status != "执行中":
                raise ValueError(f"work_order.submit is not allowed from status {status}")
            updated_criteria = dict(criteria)
            acceptance["提交"] = expected_submission
            updated_criteria["验收"] = acceptance
            emit_detail_transform(children["Criteria"]["path"], criteria, updated_criteria)
            updated_root = with_root_status(root_detail, "待验收")
            emit_detail_transform(root["path"], root_detail, updated_root)
            return {"submitted": True, "status": "待验收", "missing": []}

        if action == "reject":
            reasons = specification.get("reasons")
            reviewer = specification.get("reviewer")
            reviewed_at = specification.get("reviewed_at")
            if (not isinstance(reasons, list) or not reasons
                    or any(not isinstance(item, str) or not item.strip() for item in reasons)):
                raise ValueError("work_order.reject requires non-empty reasons")
            if not isinstance(reviewer, str) or not reviewer.strip():
                raise ValueError("work_order.reject requires reviewer")
            if not isinstance(reviewed_at, str) or not reviewed_at.strip():
                raise ValueError("work_order.reject requires reviewed_at")
            criteria = details["Criteria"]
            acceptance = dict(criteria.get("验收", {}))
            audit = dict(acceptance.get("审核", {}))
            rejection = dict(acceptance.get("驳回", {}))
            expected_audit = {
                **audit,
                "结论": "驳回",
                "意见": list(reasons),
                "审核人": reviewer,
                "审核时间": reviewed_at,
            }
            expected_rejection = {**rejection, "返回": "Step", "原因": list(reasons)}
            if (status == "已驳回" and audit == expected_audit and rejection == expected_rejection):
                return {"rejected": False, "idempotent": True, "status": status}
            if status != "待验收":
                raise ValueError(f"work_order.reject is not allowed from status {status}")
            acceptance["审核"] = expected_audit
            acceptance["驳回"] = expected_rejection
            updated_criteria = {**criteria, "验收": acceptance}
            emit_detail_transform(children["Criteria"]["path"], criteria, updated_criteria)
            updated_root = with_root_status(root_detail, "已驳回")
            emit_detail_transform(root["path"], root_detail, updated_root)
            return {"rejected": True, "status": "已驳回", "responsible": selector + "/Step"}

        note = specification.get("note")
        if not isinstance(note, str) or not note.strip():
            raise ValueError("work_order.revise requires note")
        updates = merged_group_values(details, specification.get("values"))
        history = list(root_detail.get("修订记录", []))
        already_recorded = bool(history and isinstance(history[-1], dict)
                                and history[-1].get("说明") == note)
        already_applied = all(details[name] == updated for name, updated in updates.items())
        if status == "执行中" and already_recorded and already_applied:
            return {"revised": False, "idempotent": True, "status": status}
        if status != "已驳回":
            raise ValueError(f"work_order.revise is not allowed from status {status}")
        for name, updated in updates.items():
            emit_detail_transform(children[name]["path"], details[name], updated)
        history.append({"序号": len(history) + 1, "说明": note})
        updated_root = with_root_status(root_detail, "执行中")
        updated_root["修订记录"] = history
        emit_detail_transform(root["path"], root_detail, updated_root)
        return {"revised": True, "status": "执行中", "path": selector}

    codec_failure = None

    def call_json_codec(implementation, specification):
        nonlocal codec_failure
        try:
            return implementation(specification)
        except (TypeError, ValueError) as error:
            if codec_failure is None:
                codec_failure = error
            raise

    def json_parse(specification):
        return call_json_codec(json_parse_impl, specification)

    def json_stringify(specification):
        return call_json_codec(json_stringify_impl, specification)

    safe_builtins = {
        "all": all, "any": any, "bool": bool, "dict": dict, "enumerate": enumerate,
        "filter": filter, "float": float, "int": int, "len": len, "list": list,
        "map": map, "max": max, "min": min, "range": range, "set": set,
        "sorted": sorted, "str": str, "sum": sum, "tuple": tuple, "zip": zip,
        "Exception": Exception, "ValueError": ValueError, "TypeError": TypeError,
        "True": True, "False": False, "None": None,
    }
    namespace = {
        "__builtins__": safe_builtins,
        "explore": explore,
        "transform": transform,
        "slot_body": slot_body,
        "lock": lock,
        "message": message,
        "choice": choice,
        "trigger": trigger,
        "current_atom": current_atom,
        "direct_children": direct_children,
        "child_detail": child_detail,
        "missing_details": missing_details,
        "form_status": form_status,
        "first_pending": first_pending,
        "transition_allowed": transition_allowed,
        "subtree_refs": subtree_refs,
        "plan_shards": plan_shards,
        "plan_form_flow": plan_form_flow,
        "plan_template_instance": plan_template_instance,
        "instantiate": instantiate,
        "template_catalog": template_catalog,
        "function_catalog": function_catalog,
        "json_parse": json_parse,
        "json_stringify": json_stringify,
        "work_order_catalog": work_order_catalog,
        "form": form,
        "work_order": work_order,
    }

    def use_program(specification):
        specification = require_object(specification, "use_program")
        selector = specification.get("name")
        arguments = specification.get("arguments", {})
        if not isinstance(selector, str) or not selector.strip():
            raise ValueError("use_program.name must be one exact Program name or path")
        if not isinstance(arguments, dict):
            raise TypeError("use_program.arguments must be one JSON object")
        matches = [
            record for record in by_ref.values()
            if "program" in record.get("types", [])
            and (record["path"] == selector or record["name"] == selector)
        ]
        if not matches:
            raise ValueError(f"Referenced Program not found: {selector}")
        if len(matches) > 1:
            raise ValueError(f"Referenced Program name is ambiguous; use its full path: {selector}")
        target = matches[0]
        if target["ref"] in program_stack:
            raise ValueError(f"Recursive Program reference is not allowed: {target['path']}")
        if len(program_stack) >= 8:
            raise ValueError("Program reference depth exceeds 8")
        target_tree = validate_program(target["detail"], target["path"])
        child_namespace = dict(namespace)
        child_namespace["use_program"] = use_program
        program_stack.append(target["ref"])
        try:
            exec(compile(target_tree, target["path"], "exec"), child_namespace, child_namespace)
            entrypoint = child_namespace.get("main")
            if not callable(entrypoint):
                raise ValueError(f"Referenced Program must define main(arguments): {target['path']}")
            result = entrypoint(arguments)
            return json.loads(json.dumps(result, ensure_ascii=False))
        finally:
            program_stack.pop()

    namespace["use_program"] = use_program
    missing_implementations = REGISTERED_PROGRAM_FUNCTIONS - set(namespace)
    if missing_implementations:
        raise RuntimeError(
            "Program function registry contains unimplemented functions: "
            + ", ".join(sorted(missing_implementations))
        )
    program_tree = validate_program(request["program"]["detail"], request["program"]["path"])
    trigger_contract = extract_trigger_contract(program_tree)
    if request.get("validateOnly") is True:
        sys.stdout.write(json.dumps(
            {"type": "result", "ok": True, "trigger": trigger_contract, **effects},
            ensure_ascii=True,
            allow_nan=False,
        ) + "\n")
        sys.stdout.flush()
        return
    exec(compile(program_tree, request["program"]["path"], "exec"), namespace, namespace)
    if codec_failure is not None:
        raise codec_failure
    sys.stdout.write(json.dumps(
        {"type": "result", "ok": True, "trigger": trigger_contract, **effects},
        ensure_ascii=True,
        allow_nan=False,
    ) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        sys.stdout.write(json.dumps({
            "type": "result",
            "ok": False,
            "error": {
                "type": type(error).__name__,
                "message": str(error),
            },
        }, ensure_ascii=True, allow_nan=False) + "\n")
        sys.stdout.flush()
