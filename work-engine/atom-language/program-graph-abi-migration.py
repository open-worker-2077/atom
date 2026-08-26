import ast
import hashlib
import json
import sys

RETIRED = {"name", "detail", "children", "partners"}
GRAPH_CALLS = {"explore", "transform"}


def analyze(item):
    source = item["source"]
    result = {
        "path": item["path"],
        "sourceHash": "sha256:" + hashlib.sha256(source.encode("utf-8")).hexdigest(),
        "uses": [], "blockingAxes": [],
    }
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        result["blockingAxes"] = ["syntax"]
        result["syntaxError"] = {"line": error.lineno, "column": error.offset, "message": error.msg}
        return result
    blockers = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
            continue
        if node.func.id not in GRAPH_CALLS or not node.args or not isinstance(node.args[0], ast.Dict):
            continue
        for key in node.args[0].keys:
            if key is None or not isinstance(key, ast.Constant) or not isinstance(key.value, str):
                blockers.add("dynamic")
                continue
            axis = key.value
            if axis not in RETIRED:
                continue
            result["uses"].append({
                "call": node.func.id, "axis": axis,
                "line": key.lineno, "column": key.col_offset + 1,
            })
            if axis == "partners":
                blockers.add(axis)
    if blockers:
        result["blockingAxes"] = sorted(blockers)
        return result
    return result


payload = json.load(sys.stdin)
json.dump({"programs": [analyze(item) for item in payload["programs"]]}, sys.stdout, ensure_ascii=False)
