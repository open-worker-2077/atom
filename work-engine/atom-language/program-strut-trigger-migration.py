import ast
import json
import sys


def fail(code, message, details=None):
    raise RuntimeError(json.dumps({
        "code": code,
        "message": message,
        "details": details or {},
    }, ensure_ascii=False))


def literal_string(node):
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def source_offset(source, line, byte_column):
    lines = source.splitlines(keepends=True)
    prefix = "".join(lines[:line - 1])
    encoded = lines[line - 1].encode("utf-8")
    column = len(encoded[:byte_column].decode("utf-8"))
    return len(prefix) + column


def analyze(program):
    source = program["source"]
    try:
        tree = ast.parse(source, filename=program["path"], mode="exec")
    except SyntaxError as error:
        fail("STRUT_RECEIVER_MIGRATION_INVALID_PROGRAM", "Program source is invalid Python", {
            "path": program["path"], "line": error.lineno, "offset": error.offset
        })
    calls = []
    for statement in tree.body:
        if not isinstance(statement, ast.Expr) or not isinstance(statement.value, ast.Call):
            continue
        call = statement.value
        if not isinstance(call.func, ast.Name) or call.func.id != "trigger":
            continue
        if len(call.args) != 3 or call.keywords:
            continue
        if literal_string(call.args[0]) == "strut":
            calls.append(call)
    if not calls:
        return {"path": program["path"], "status": "none", "source": source}
    if len(calls) != 1:
        fail("STRUT_RECEIVER_MIGRATION_TRIGGER_COUNT", "Program must contain exactly one top-level Strut trigger", {
            "path": program["path"], "count": len(calls)
        })
    call = calls[0]
    parameters = call.args[1]
    if not isinstance(parameters, ast.Dict) or len(parameters.keys) != 1 \
            or literal_string(parameters.keys[0]) != "nodes" \
            or not isinstance(parameters.values[0], (ast.List, ast.Tuple)):
        fail("STRUT_RECEIVER_MIGRATION_DYNAMIC_TRIGGER", "Legacy Strut trigger parameters must be one literal nodes list", {
            "path": program["path"]
        })
    nodes = [literal_string(node) for node in parameters.values[0].elts]
    if not nodes or any(node is None or not node for node in nodes) or len(set(nodes)) != len(nodes):
        fail("STRUT_RECEIVER_MIGRATION_DYNAMIC_TRIGGER", "Legacy Strut nodes must be non-empty unique strings", {
            "path": program["path"]
        })
    entrypoint = call.args[2].id if isinstance(call.args[2], ast.Name) else None
    if not entrypoint:
        fail("STRUT_RECEIVER_MIGRATION_DYNAMIC_TRIGGER", "Legacy Strut entrypoint must be a function name", {
            "path": program["path"]
        })
    start = source_offset(source, parameters.lineno, parameters.col_offset)
    end = source_offset(source, parameters.end_lineno, parameters.end_col_offset)
    return {
        "path": program["path"],
        "status": "legacy",
        "nodes": nodes,
        "entrypoint": entrypoint,
        "source": source[:start] + "{}" + source[end:],
    }


def main():
    payload = json.load(sys.stdin)
    results = [analyze(program) for program in payload.get("programs", [])]
    json.dump({"programs": results}, sys.stdout, ensure_ascii=False)


try:
    main()
except RuntimeError as error:
    sys.stderr.write(str(error))
    sys.exit(1)
