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


def load_program_templates():
    module_path = Path(__file__).with_name("program_templates.py")
    specification = importlib.util.spec_from_file_location("atom_program_templates", module_path)
    if specification is None or specification.loader is None:
        raise RuntimeError("Unable to load the trusted Atom Program template registry")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


PROGRAM_TEMPLATES = load_program_templates()


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
    "explore", "transform", "lock", "message", "current_atom",
    "direct_children", "child_detail", "missing_details", "form_status",
    "first_pending", "transition_allowed", "subtree_refs", "plan_form_flow",
    "plan_template_instance", "plan_shards", "instantiate", "template_catalog",
    "use_program",
}

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
    effects = {"locks": [], "messages": [], "transforms": []}

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
        }, ensure_ascii=True) + "\n")
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
        "lock": lock,
        "message": message,
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
    program_tree = validate_program(request["program"]["detail"], request["program"]["path"])
    exec(compile(program_tree, request["program"]["path"], "exec"), namespace, namespace)
    sys.stdout.write(json.dumps({"type": "result", "ok": True, **effects}, ensure_ascii=True) + "\n")
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
        }, ensure_ascii=True) + "\n")
        sys.stdout.flush()
