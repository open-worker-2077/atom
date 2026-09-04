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


class SlotScopeError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
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
    hierarchy = value.get("functionScopeHierarchy", {})
    if (value.get("contract") != "atom-program-function-registry"
            or value.get("version") != 7
            or value.get("runtimeContract") != "atom-interaction/4"
            or hierarchy.get("groupField") != "functionFamilies[].id"
            or hierarchy.get("parentField") != "functionFamilies[].parent"
            or hierarchy.get("rootWhenParentOmitted") is not True
            or hierarchy.get("functionMembership") != "single-family"
            or hierarchy.get("groupEffectiveMembership") != "self-and-descendants"):
        raise RuntimeError("Program function registry has an invalid public contract")
    families = set()
    family_ids = set()
    family_parents = {}
    kernel_families = set()
    for item in value.get("functionFamilies", []):
        layer = item.get("layer")
        family = item.get("id")
        key = (layer, family)
        if (layer not in {"kernel", "application"}
                or not isinstance(family, str) or not family
                or not isinstance(item.get("label"), str) or not item["label"]
                or key in families or family in family_ids
                or ("parent" in item
                    and (not isinstance(item["parent"], str) or not item["parent"]))):
            raise RuntimeError("Program function registry contains an invalid function family")
        families.add(key)
        family_ids.add(family)
        family_parents[family] = item.get("parent")
        if layer == "kernel":
            kernel_families.add(family)
    for family, parent in family_parents.items():
        if parent is not None and parent not in family_parents:
            raise RuntimeError(f"Unknown parent Program function family: {family}")
        visited = {family}
        cursor = parent
        while cursor is not None:
            if cursor in visited:
                raise RuntimeError(f"Cyclic Program function family: {family}")
            visited.add(cursor)
            cursor = family_parents[cursor]
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
                or ("explicitNameOnly" in item
                    and not isinstance(item["explicitNameOnly"], bool))
                or ("delegable" in item and not isinstance(item["delegable"], bool))
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
PROGRAM_FUNCTION_PARENT_BY_FAMILY = {
    item["id"]: item.get("parent")
    for item in PROGRAM_FUNCTION_REGISTRY["functionFamilies"]
}


def function_family_is_within(family, ancestor):
    cursor = family
    while cursor is not None:
        if cursor == ancestor:
            return True
        cursor = PROGRAM_FUNCTION_PARENT_BY_FAMILY[cursor]
    return False


def validate_program_function_selection(value):
    if (not isinstance(value, dict) or set(value) != {"groups", "names"}
            or not isinstance(value.get("groups"), list)
            or not isinstance(value.get("names"), list)):
        raise EngineCallError(
            "INVALID_AGENT_REGISTRATION",
            "agent.functions requires groups and names arrays",
        )
    groups = value["groups"]
    names = value["names"]
    if any(not isinstance(group, str) or not group for group in groups):
        raise EngineCallError(
            "INVALID_AGENT_REGISTRATION", "agent.functions.groups must contain strings"
        )
    if any(not isinstance(name, str) or not name for name in names):
        raise EngineCallError(
            "INVALID_AGENT_REGISTRATION", "agent.functions.names must contain strings"
        )
    unknown_groups = [group for group in groups if group not in PROGRAM_FUNCTION_PARENT_BY_FAMILY]
    if unknown_groups:
        raise EngineCallError(
            "UNKNOWN_PROGRAM_FUNCTION_GROUP", "Unknown Program function group: " + unknown_groups[0]
        )
    unknown_names = [name for name in names if name not in REGISTERED_PROGRAM_FUNCTIONS]
    if unknown_names:
        raise EngineCallError(
            "UNKNOWN_PROGRAM_FUNCTION", "Unknown Program function: " + unknown_names[0]
        )
    normalized = {
        "groups": sorted(set(groups)),
        "names": sorted(set(names)),
    }
    expanded = set(normalized["names"])
    for item in PROGRAM_FUNCTION_REGISTRY["functions"]:
        if (item.get("explicitNameOnly") is not True
                and any(function_family_is_within(item["family"], group)
                        for group in normalized["groups"])):
            expanded.add(item["name"])
    return normalized, sorted(expanded)


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
    "explore", "transform", "lock", "message", "choice", "current_atom", "trigger", "slot", "signal",
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


def validate_program(source, filename, allowed_registered_functions=None):
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
                if (allowed_registered_functions is not None
                        and node.func.id in REGISTERED_PROGRAM_FUNCTIONS
                        and node.func.id not in allowed_registered_functions):
                    raise EngineCallError(
                        "PROGRAM_FUNCTION_DENIED",
                        f"Registered function is not allowed for this Agent: {node.func.id}",
                    )
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
            if (isinstance(node.func, ast.Name)
                    and node.func.id in {"explore", "transform"}
                    and node.args and isinstance(node.args[0], ast.Dict)):
                retired = [
                    key.value for key in node.args[0].keys
                    if isinstance(key, ast.Constant)
                    and isinstance(key.value, str)
                    and key.value.split("@", 1)[0] in LEGACY_GRAPH_AXES
                ]
                if retired:
                    raise ProgramSecurityError(
                        "Retired Graph axes are not executable; run the four-axis Program upgrader: "
                        + ", ".join(retired)
                    )
    extract_agent_declaration(tree)
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
    if mode == "transform":
        if function.args.args or function.args.vararg or function.args.kwarg:
            raise ProgramSecurityError("trigger transform entrypoint must accept no arguments")
    elif mode == "strut":
        if len(function.args.args) != 1 or function.args.vararg or function.args.kwarg:
            raise ProgramSecurityError("trigger strut entrypoint must accept one delivery argument")
    elif mode == "slot":
        if (function.args.posonlyargs or function.args.args
                or function.args.vararg or function.args.kwonlyargs
                or function.args.kwarg):
            raise ProgramSecurityError("trigger slot entrypoint must accept no arguments")
    else:
        raise ProgramSecurityError("trigger() supports only transform, strut, or slot mode")
    if mode == "slot":
        if (not isinstance(parameters, dict)
                or set(parameters) - {"from", "labels", "match"}
                or "from" not in parameters
                or "labels" not in parameters
                or parameters["from"] not in {"up", "down"}
                or not isinstance(parameters["labels"], list)
                or not parameters["labels"]
                or any(not isinstance(value, str) or not value
                       for value in parameters["labels"])
                or len(set(parameters["labels"])) != len(parameters["labels"])
                or parameters.get("match", "all") not in {"all", "exact"}):
            raise ProgramSecurityError(
                "slot trigger parameters require from, labels, and optional match"
            )
        return {
            "mode": "slot",
            "parameters": {
                "from": parameters["from"],
                "labels": list(parameters["labels"]),
                "match": parameters.get("match", "all"),
            },
            "entrypoint": entrypoint,
        }
    if mode == "strut":
        if not isinstance(parameters, dict) or parameters:
            raise ProgramSecurityError(
                "trigger strut parameters must be an empty object; Graph consequents own delivery routing"
            )
        return {
            "mode": "strut",
            "parameters": {},
            "entrypoint": entrypoint,
        }
    if (not isinstance(parameters, dict)
            or set(parameters) != {"nodes"}
            or not isinstance(parameters.get("nodes"), list)
            or not parameters["nodes"]
            or any(not isinstance(value, str) or not value.strip()
                   for value in parameters["nodes"])
            or len(set(parameters["nodes"])) != len(parameters["nodes"])):
        raise ProgramSecurityError(
            "trigger parameters require one non-empty unique nodes string list"
        )
    return {
        "mode": mode,
        "parameters": {"nodes": [value.strip() for value in parameters["nodes"]]},
        "entrypoint": entrypoint,
    }


class AtomView:
    __slots__ = (
        "ref", "thing", "situation", "path", "types", "strut",
        "shortcut_identity", "shortcut_reference", "_record"
    )

    def __init__(self, record):
        self.ref = record["ref"]
        self.thing = record["name"]
        self.situation = record["detail"]
        self.path = record["path"]
        self.types = tuple(record["types"])
        self.strut = tuple(record.get("partners", []))
        self.shortcut_identity = record.get("shortcutIdentity")
        shortcut_reference = record.get("shortcutReference")
        self.shortcut_reference = (
            AtomView(shortcut_reference)
            if isinstance(shortcut_reference, dict)
            else None
        )
        self._record = record

    def __repr__(self):
        return f"AtomView(thing={self.thing!r}, path={self.path!r})"


class EngineCallError(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def validate_agent_specification(specification):
    if (not isinstance(specification, dict)
            or set(specification) - {"labels", "functions"}
            or "functions" not in specification):
        raise EngineCallError(
            "INVALID_AGENT_REGISTRATION",
            "agent() accepts only optional labels and required functions",
        )
    labels = specification.get("labels", [])
    if (not isinstance(labels, list)
            or any(not isinstance(label, str) or not label for label in labels)):
        raise EngineCallError("INVALID_AGENT_REGISTRATION", "agent.labels must contain strings")
    function_scopes, functions = validate_program_function_selection(specification["functions"])
    return {
        "labels": list(dict.fromkeys(labels)),
        "functionScopes": function_scopes,
        "functions": functions,
    }


def extract_agent_declaration(tree):
    calls = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "agent"
    ]
    if not calls:
        return None
    top_level_calls = [
        node.value for node in tree.body
        if isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
        and node.value.func.id == "agent"
    ]
    if len(calls) != 1 or len(top_level_calls) != 1 or calls[0] is not top_level_calls[0]:
        raise EngineCallError(
            "AGENT_REGISTRATION_LITERAL_REQUIRED",
            "agent() must be one top-level call with a literal JSON-compatible argument",
        )
    declaration = calls[0]
    if declaration.keywords or len(declaration.args) != 1:
        raise EngineCallError(
            "AGENT_REGISTRATION_LITERAL_REQUIRED",
            "agent() must be one top-level call with one literal argument",
        )
    try:
        specification = ast.literal_eval(declaration.args[0])
    except (TypeError, ValueError, SyntaxError) as error:
        raise EngineCallError(
            "AGENT_REGISTRATION_LITERAL_REQUIRED",
            "agent labels and function scopes must be literal JSON-compatible values",
        ) from error
    return validate_agent_specification(specification)


def extract_request_driven_lock_declarations(tree):
    """Return persistent lock facts that can be reconstructed without executing Program code."""
    declarations = []
    top_level_calls = {
        id(node.value): node.value for node in tree.body
        if isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
        and node.value.func.id == "lock"
    }
    literal_assignments = {}
    for node in tree.body:
        if (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)):
            try:
                literal_assignments[node.targets[0].id] = ast.literal_eval(node.value)
            except (TypeError, ValueError, SyntaxError):
                pass
    for call in (
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "lock"
    ):
        specification = None
        direct_literal = False
        if not call.keywords and len(call.args) == 1:
            try:
                specification = ast.literal_eval(call.args[0])
                direct_literal = True
            except (TypeError, ValueError, SyntaxError):
                if isinstance(call.args[0], ast.Name):
                    specification = literal_assignments.get(call.args[0].id)
        is_request_driven = (
            isinstance(specification, dict)
            and (specification.get("refresh") == {"policy": "on_request"}
                 or "actions" in specification or "labels" in specification)
        )
        if not is_request_driven:
            continue
        if id(call) not in top_level_calls or not direct_literal:
            raise EngineCallError(
                "REQUEST_DRIVEN_LOCK_LITERAL_REQUIRED",
                "request-driven lock() must be one top-level call with one literal argument",
            )
        declarations.append(specification)
    return declarations


def require_object(value, function_name):
    if not isinstance(value, dict):
        raise TypeError(f"{function_name}() requires one JSON object argument")
    return value


LEGACY_GRAPH_AXES = {
    "name": "thing",
    "detail": "situation",
    "children": "slot",
    "partners": "strut",
}


def main():
    request = json.loads(sys.stdin.readline())
    records = request["world"]
    agent_program_paths = set(request.get("agentProgramPaths", []))
    by_ref = {record["ref"]: record for record in records}
    views = {ref: AtomView(record) for ref, record in by_ref.items()}
    effects = {
        "locks": [], "messages": [], "transforms": [], "choices": [],
        "slotBodies": [], "slotSignals": [], "jumps": [], "jumpAuthorizations": [], "shortcuts": [], "agents": [], "changedThings": []
    }

    if request.get("agentDeclarationOnly") is True:
        tree = ast.parse(
            request["program"]["detail"],
            filename=request["program"]["path"],
            mode="exec",
        )
        agent_declaration = extract_agent_declaration(tree)
        sys.stdout.write(json.dumps(
            {
                "type": "result", "ok": True,
                **effects,
                **({"agents": [agent_declaration]} if agent_declaration is not None else {}),
            },
            ensure_ascii=True,
            allow_nan=False,
        ) + "\n")
        sys.stdout.flush()
        return

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
            failure = response.get("error", {})
            raise EngineCallError(
                failure.get("code", "ATOM_PROGRAM_ENGINE_CALL_FAILED"),
                failure.get("message", "Atom world function failed"),
            )
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

    def agent(specification):
        try:
            declaration = validate_agent_specification(require_object(specification, "agent"))
        except TypeError as error:
            raise EngineCallError("INVALID_AGENT_REGISTRATION", str(error)) from error
        return {
            "declared": True,
            "path": current_atom().path,
            "labels": declaration["labels"],
            "functionScopes": declaration["functionScopes"],
            "functions": declaration["functions"],
        }

    request_lock_declarations = []

    def lock(specification):
        specification = require_object(specification, "lock")
        if (specification.get("refresh") == {"policy": "on_request"}
                or "actions" in specification or "labels" in specification):
            canonical = json.dumps(specification, sort_keys=True, ensure_ascii=True, allow_nan=False)
            declared = {
                json.dumps(item, sort_keys=True, ensure_ascii=True, allow_nan=False)
                for item in request_lock_declarations
            }
            if canonical not in declared:
                raise EngineCallError(
                    "REQUEST_DRIVEN_LOCK_LITERAL_REQUIRED",
                    "request-driven lock() must match a top-level literal Program declaration",
                )
        effects["locks"].append(specification)

    def message(specification):
        specification = require_object(specification, "message")
        effects["messages"].append(specification)

    def transform(specification):
        specification = require_object(specification, "transform")
        effects["transforms"].append(specification)

    def shortcut(specification):
        try:
            specification = require_object(specification, "shortcut")
        except TypeError as error:
            raise EngineCallError("INVALID_SHORTCUT_CONTRACT", str(error)) from error
        if set(specification) == {"action", "reference"}:
            if specification["action"] != "delete":
                raise EngineCallError(
                    "INVALID_SHORTCUT_CONTRACT",
                    "shortcut.action currently accepts only delete",
                )
            reference_coordinate = specification["reference"]
            if not isinstance(reference_coordinate, AtomView):
                raise EngineCallError(
                    "INVALID_SHORTCUT_REFERENCE_COORDINATE",
                    "shortcut.reference requires one exact shortcut ThingCoordinate; strings and refs are forbidden",
                )
            reference = reference_coordinate._record
            if ("shortcut" not in reference["types"]
                    or not isinstance(reference.get("shortcutIdentity"), str)
                    or not reference["shortcutIdentity"]):
                raise EngineCallError(
                    "SHORTCUT_DELETE_REFERENCE_REQUIRED",
                    "shortcut delete requires a ThingCoordinate for the shortcut record, not its target",
                )
            effects["shortcuts"].append({
                "action": "delete",
                "referenceRef": reference["ref"],
                "referencePath": reference["path"],
                "referenceIdentity": reference["shortcutIdentity"],
                "__sourceProgramPath": current_atom().path,
            })
            return None
        if set(specification) != {"placement", "thing", "target"}:
            raise EngineCallError(
                "INVALID_SHORTCUT_CONTRACT",
                "shortcut() accepts create {placement, thing, target} or delete {action, reference}",
            )
        if specification["placement"] != "slot":
            raise EngineCallError("INVALID_SHORTCUT_PLACEMENT", "shortcut.placement currently accepts only slot")
        thing = specification["thing"]
        if (not isinstance(thing, str) or not thing.strip() or thing != thing.strip() or "/" in thing):
            raise EngineCallError("INVALID_SHORTCUT_THING", "shortcut.thing must be one non-empty Atom name")
        target_coordinate = specification["target"]
        if not isinstance(target_coordinate, AtomView):
            raise EngineCallError("INVALID_SHORTCUT_TARGET_COORDINATE", "shortcut.target requires one exact ThingCoordinate from explore(); strings and refs are forbidden")
        target = target_coordinate._record
        effects["shortcuts"].append({
            "action": "create", "placement": "slot", "thing": thing, "targetRef": target["ref"],
            "targetPath": target["path"], "__sourceProgramPath": current_atom().path,
        })
        return None

    def slot_body(specification):
        specification = require_object(specification, "slot_body")
        if "lock" in specification:
            raise EngineCallError(
                "INVALID_SLOT_BODY_EFFECT",
                "slot_body lock is fixed by the kernel and cannot be configured",
            )
        effects["slotBodies"].append({**specification, "__sourceProgramPath": current_atom().path})
        action = specification.get("action")
        body = current_atom().path if action == "seal" else current_atom().path.rsplit("/", 1)[0]
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

    def slot(specification):
        specification = require_object(specification, "slot")
        if set(specification) != {"to", "labels"}:
            raise EngineCallError("INVALID_SLOT_SIGNAL", "slot() requires only to and labels")
        if specification["to"] not in {"up", "down"}:
            raise EngineCallError("INVALID_SLOT_SIGNAL_DIRECTION", "slot.to must be up or down")
        labels = specification["labels"]
        if (not isinstance(labels, list) or not labels
                or any(not isinstance(label, str) or not label for label in labels)
                or len(set(labels)) != len(labels)):
            raise EngineCallError("INVALID_SLOT_SIGNAL_LABELS", "slot.labels must be unique non-empty strings")
        effects["slotSignals"].append({
            "sourceProgramPath": current_atom().path,
            "to": specification["to"],
            "labels": list(labels),
        })

    def signal():
        value = request.get("programArguments")
        if (request.get("triggered") is not True or not isinstance(value, dict)
                or value.get("mode") != "slot"):
            raise EngineCallError("SLOT_SIGNAL_REQUIRED", "signal() requires one active Slot signal invocation")
        return {"from": value["from"], "labels": list(value["labels"])}

    def trigger(mode, parameters, entrypoint):
        if request.get("triggered") is True:
            if mode == "strut":
                delivery = request.get("programArguments")
                required = {
                    "mode", "revision", "clauseId", "decision",
                    "antecedentPaths", "consequentPath", "consequentOrdinal",
                }
                if (not isinstance(delivery, dict)
                        or set(delivery) != required
                        or delivery.get("mode") != "strut"
                        or delivery.get("decision") is not True):
                    raise EngineCallError(
                        "STRUT_DELIVERY_REQUIRED",
                        "strut subscriber requires one strict typed true delivery",
                    )
                entrypoint(delivery)
            else:
                entrypoint()

    program_stack = [request["program"]["ref"]]

    def current_atom():
        return views[program_stack[-1]]

    def resolve_exact_thing(value, function_name, required_type=None):
        if isinstance(value, AtomView):
            target = value._record
        elif isinstance(value, dict):
            if len(value) != 1:
                raise TypeError(
                    f"{function_name} requires one exact Thing coordinate object"
                )
            coordinate = value.get("thing", value.get("thing@program"))
            if not isinstance(coordinate, str) or not coordinate.strip():
                raise TypeError(
                    f"{function_name} requires one exact Thing coordinate object"
                )
            matches = [record for record in by_ref.values()
                       if record["path"] == coordinate.strip()]
            if len(matches) != 1:
                raise ValueError(
                    f"{function_name} exact Thing coordinate was not found: {coordinate}"
                )
            target = matches[0]
        else:
            raise TypeError(
                f"{function_name} requires an exact Thing coordinate object; strings and refs are forbidden"
            )
        if required_type and required_type not in target.get("types", []):
            raise TypeError(
                f"{function_name} requires an exact Thing@{required_type} coordinate"
            )
        return target

    def invoke_program_thing(value, function_name):
        target = resolve_exact_thing(value, function_name, "program")
        program_root = request.get("programRoot")
        if program_root and not (
            target["path"] == program_root
            or target["path"].startswith(program_root + "/")
        ):
            raise SlotScopeError(
                "SLOT_SCOPE_BOUNDARY_CROSSING",
                "Scoped Program may reuse code only inside its current model: "
                + target["path"]
            )
        if target["ref"] in program_stack:
            raise ValueError(f"Recursive Program reference is not allowed: {target['path']}")
        if len(program_stack) >= 8:
            raise ValueError("Program reference depth exceeds 8")
        target_tree = validate_program(
            target["detail"], target["path"], request.get("allowedFunctions")
        )
        child_namespace = dict(namespace)
        child_namespace["use_program"] = use_program
        program_stack.append(target["ref"])
        try:
            exec(compile(target_tree, target["path"], "exec"), child_namespace, child_namespace)
            entrypoint = child_namespace.get("main")
            if not callable(entrypoint):
                raise ValueError(f"Referenced Program must define main(arguments): {target['path']}")
            return entrypoint({})
        finally:
            program_stack.pop()

    def jump(specification):
        try:
            specification = require_object(specification, "jump")
        except TypeError as error:
            raise EngineCallError("INVALID_JUMP_CONTRACT", str(error)) from error
        allowed = {"when", "where", "recycle"}
        unknown = set(specification) - allowed
        if unknown:
            raise EngineCallError(
                "INVALID_JUMP_CONTRACT",
                "jump() accepts only when, where, and recycle",
            )
        for coordinate_name in ("when", "where", "recycle"):
            if coordinate_name not in specification:
                continue
            try:
                resolve_exact_thing(
                    specification[coordinate_name],
                    f"jump.{coordinate_name}",
                    "program",
                )
            except (TypeError, ValueError) as error:
                raise EngineCallError("INVALID_JUMP_CONTRACT", str(error)) from error
        action = "guard"
        destination_path = None
        authorization_path = None
        if "recycle" in specification:
            recycle = invoke_program_thing(specification["recycle"], "jump.recycle")
            if not isinstance(recycle, bool):
                raise TypeError("jump.recycle Program must return bool")
            if recycle:
                action = "recycle"
        if action != "recycle" and "when" in specification:
            when = invoke_program_thing(specification["when"], "jump.when")
            if not isinstance(when, bool):
                raise TypeError("jump.when Program must return bool")
            if when:
                if "where" not in specification:
                    raise ValueError("jump.where is required when jump.when returns true")
                destination = invoke_program_thing(specification["where"], "jump.where")
                resolved_destination = resolve_exact_thing(
                    destination, "jump.where result"
                )
                if "jump-authorization" in resolved_destination.get("types", []):
                    authorization_path = resolved_destination["path"]
                else:
                    destination_path = resolved_destination["path"]
                action = "move"
        effect = {"action": action}
        if destination_path is not None:
            effect["destinationPath"] = destination_path
        if authorization_path is not None:
            effect["authorizationPath"] = authorization_path
        effects["jumps"].append(effect)
        return None

    def jump_authorize(specification):
        try:
            specification = require_object(specification, "jump_authorize")
        except TypeError as error:
            raise EngineCallError("INVALID_JUMP_AUTHORIZATION_CONTRACT", str(error)) from error
        if set(specification) != {"window", "source", "destination"}:
            raise EngineCallError(
                "INVALID_JUMP_AUTHORIZATION_CONTRACT",
                "jump_authorize() accepts exactly window, source, and destination",
            )
        resolved = {}
        for name in ("window", "source", "destination"):
            value = specification[name]
            if not isinstance(value, AtomView):
                raise EngineCallError(
                    "INVALID_JUMP_AUTHORIZATION_COORDINATE",
                    f"jump_authorize.{name} requires an exact ThingCoordinate returned by explore()",
                )
            resolved[name] = value._record
        if resolved["window"]["path"] not in agent_program_paths:
            raise EngineCallError(
                "INVALID_JUMP_AUTHORIZATION_WINDOW",
                "jump_authorize.window must identify one registered Agent Program",
            )
        if "program" not in resolved["source"].get("types", []):
            raise EngineCallError(
                "INVALID_JUMP_AUTHORIZATION_SOURCE",
                "jump_authorize.source must identify one Program",
            )
        effects["jumpAuthorizations"].append({
            "windowPath": resolved["window"]["path"],
            "sourcePath": resolved["source"]["path"],
            "destinationPath": resolved["destination"]["path"],
            "__sourceProgramPath": current_atom().path,
        })
        return {"planned": True}

    def changed(things):
        if not isinstance(things, list) or not things:
            raise TypeError("changed() requires one non-empty exact Thing coordinate array")
        paths = []
        for thing in things:
            path = resolve_exact_thing(thing, "changed")["path"]
            if path in paths:
                raise ValueError("changed() Thing coordinates must be unique")
            paths.append(path)
        for path in paths:
            if path not in effects["changedThings"]:
                effects["changedThings"].append(path)
        event_nodes = set(request.get("changedNodes", []))
        return any(path in event_nodes for path in paths)

    def instantiate(specification):
        specification = require_object(specification, "instantiate")
        resolved = PROGRAM_TEMPLATES.resolve_instantiation(specification)
        program = current_atom()
        result_refs = remember(call_engine("explore", {
            "thing": program.path,
            "slot$latitude-1": None,
            "situation$full": None,
        }))
        rows = [views[ref] for ref in result_refs]
        children = []
        conflicts = []
        for template in resolved["roots"]:
            plan = plan_template_instance(rows, program.path, template)
            children.extend(plan["slot"])
            conflicts.extend(plan["conflicts"])
        if children:
            effects["transforms"].append({"thing": program.path, "slot": children})
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
            "thing": selector,
            "slot$latitude-1": None,
            "situation$full": None,
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
                "thing": path,
                "situation$replace": formatted_detail(updated),
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
                "thing": current_atom().path,
                "slot$latitude-1": None,
                "situation$full": None,
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
            effects["transforms"].append({"thing": current_atom().path, "slot": [template]})
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
        "shortcut": shortcut,
        "slot_body": slot_body,
        "lock": lock,
        "message": message,
        "choice": choice,
        "trigger": trigger,
        "slot": slot,
        "signal": signal,
        "jump": jump,
        "jump_authorize": jump_authorize,
        "changed": changed,
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
        "agent": agent,
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
        if isinstance(selector, AtomView):
            coordinate_path = selector.path
            authorized_refs = remember(call_engine("explore", {"thing": coordinate_path}))
            authorized = [
                by_ref[ref] for ref in authorized_refs
                if by_ref[ref]["path"] == coordinate_path and ref == selector.ref
            ]
            if len(authorized) != 1:
                raise EngineCallError(
                    "USE_PROGRAM_COORDINATE_NOT_FOUND",
                    "use_program ThingCoordinate no longer resolves exactly: "
                    + coordinate_path,
                )
            target = authorized[0]
            if "program" not in target.get("types", []):
                raise EngineCallError(
                    "USE_PROGRAM_TARGET_NOT_PROGRAM",
                    "use_program ThingCoordinate does not identify a Program: "
                    + coordinate_path,
                )
        elif isinstance(selector, str) and selector.strip():
            matches = [
                record for record in by_ref.values()
                if "program" in record.get("types", [])
                and (record["path"] == selector or record["name"] == selector)
            ]
            if not matches:
                raise ValueError(f"Referenced Program not found: {selector}")
            if len(matches) > 1:
                raise ValueError(
                    "Referenced Program name is ambiguous; use its full path: "
                    + selector
                )
            target = matches[0]
        else:
            raise ValueError("use_program.name must be one exact Program name or path")
        if not isinstance(arguments, dict):
            raise TypeError("use_program.arguments must be one JSON object")
        program_root = request.get("programRoot")
        if program_root and not (
            target["path"] == program_root
            or target["path"].startswith(program_root + "/")
        ):
            raise SlotScopeError(
                "SLOT_SCOPE_BOUNDARY_CROSSING",
                "Scoped Program may reuse code only inside its current model: "
                + target["path"]
            )
        if target["ref"] in program_stack:
            raise ValueError(f"Recursive Program reference is not allowed: {target['path']}")
        if len(program_stack) >= 8:
            raise ValueError("Program reference depth exceeds 8")
        target_tree = validate_program(
            target["detail"], target["path"], request.get("allowedFunctions")
        )
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
    program_tree = validate_program(
        request["program"]["detail"],
        request["program"]["path"],
        request.get("allowedFunctions"),
    )
    trigger_contract = extract_trigger_contract(program_tree)
    agent_declaration = extract_agent_declaration(program_tree)
    request_lock_declarations = extract_request_driven_lock_declarations(program_tree)
    if request.get("validateOnly") is True:
        sys.stdout.write(json.dumps(
            {
                "type": "result", "ok": True, "trigger": trigger_contract,
                **effects,
                "locks": request_lock_declarations,
                **({"agents": [agent_declaration]} if agent_declaration is not None else {}),
            },
            ensure_ascii=True,
            allow_nan=False,
        ) + "\n")
        sys.stdout.flush()
        return
    exec(compile(program_tree, request["program"]["path"], "exec"), namespace, namespace)
    if request.get("invokeMain") is True:
        entrypoint = namespace.get("main")
        if not callable(entrypoint):
            raise ValueError(
                "Strut-target Program must define main(arguments): "
                + request["program"]["path"]
            )
        entrypoint(request.get("programArguments", {}))
    if codec_failure is not None:
        raise codec_failure
    strut_decision = None
    if request.get("strutDecision") is True:
        entrypoint = namespace.get("main")
        if not callable(entrypoint):
            raise ValueError("Strut antecedent Program must define main(arguments)")
        strut_decision = entrypoint(request.get("programArguments", {}))
    sys.stdout.write(json.dumps(
        {
            "type": "result", "ok": True, "trigger": trigger_contract,
            **({"strutDecision": strut_decision} if request.get("strutDecision") is True else {}),
            **effects,
        },
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
                **({"code": error.code} if hasattr(error, "code") else {}),
            },
        }, ensure_ascii=True, allow_nan=False) + "\n")
        sys.stdout.flush()
