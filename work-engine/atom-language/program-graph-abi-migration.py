import ast
import hashlib
import json
import sys

RETIRED = {
    "name": "thing",
    "detail": "situation",
    "children": "contain",
    "partners": "support",
}
GRAPH_CALLS = {"explore", "transform"}


def source_hash(source):
    return "sha256:" + hashlib.sha256(source.encode("utf-8")).hexdigest()


def base_axis(value):
    for index, character in enumerate(value):
        if character in "@#$~":
            return value[:index], value[index:]
    return value, ""


class ProgramUpgradeAnalyzer(ast.NodeVisitor):
    def __init__(self, source):
        self.encoded = source.encode("utf-8")
        self.line_offsets = []
        offset = 0
        for line in source.splitlines(keepends=True):
            self.line_offsets.append(offset)
            offset += len(line.encode("utf-8"))
        if not self.line_offsets:
            self.line_offsets.append(0)
        self.edits = []
        self.blockers = []
        self.uses = []
        self.collection_names = set()
        self.view_names = set()
        self.ambiguous_names = set()
        self.tainted_names = set()
        self.graph_context_seen = False
        self.unproven_attributes = []

    def byte_span(self, node):
        return (
            self.line_offsets[node.lineno - 1] + node.col_offset,
            self.line_offsets[node.end_lineno - 1] + node.end_col_offset,
        )

    def add_edit(self, node, replacement, kind, axis, target):
        start, end = self.byte_span(node)
        edit = {
            "kind": kind,
            "axis": axis,
            "target": target,
            "replacement": replacement,
            "line": node.lineno,
            "column": node.col_offset + 1,
            "startByte": start,
            "endByte": end,
        }
        if not any(item["startByte"] == start and item["endByte"] == end for item in self.edits):
            self.edits.append(edit)

    def add_blocker(self, node, reason, axis=None):
        blocker = {
            "reason": reason,
            "line": getattr(node, "lineno", 1),
            "column": getattr(node, "col_offset", 0) + 1,
        }
        if axis:
            blocker["axis"] = axis
        if blocker not in self.blockers:
            self.blockers.append(blocker)

    @staticmethod
    def graph_call(node):
        return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
            and node.func.id in GRAPH_CALLS

    def is_collection(self, node):
        return ((self.graph_call(node) and node.func.id == "explore")
                or (isinstance(node, ast.Name) and node.id in self.collection_names
                    and node.id not in self.ambiguous_names))

    def is_view(self, node):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id == "current_atom":
            return True
        if isinstance(node, ast.Subscript) and self.is_collection(node.value):
            return True
        return isinstance(node, ast.Name) and node.id in self.view_names \
            and node.id not in self.ambiguous_names

    def contains_graph_origin(self, node):
        for child in ast.walk(node):
            if self.graph_call(child):
                return True
            if isinstance(child, ast.Call) and isinstance(child.func, ast.Name) \
                    and child.func.id == "current_atom":
                return True
            if isinstance(child, ast.Name) \
                    and child.id in self.collection_names | self.view_names | self.tainted_names:
                return True
        return False

    def record_assignment(self, target, value):
        if not isinstance(target, ast.Name):
            return
        name = target.id
        if self.is_collection(value):
            self.collection_names.add(name)
        elif self.is_view(value):
            self.view_names.add(name)
        elif self.contains_graph_origin(value):
            self.tainted_names.add(name)
        elif name in self.collection_names or name in self.view_names:
            self.ambiguous_names.add(name)

    def visit_Assign(self, node):
        for target in node.targets:
            self.record_assignment(target, node.value)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        if node.value is not None:
            self.record_assignment(node.target, node.value)
        self.generic_visit(node)

    def visit_For(self, node):
        if isinstance(node.target, ast.Name) and self.is_collection(node.iter):
            self.view_names.add(node.target.id)
        self.generic_visit(node)

    def visit_Call(self, node):
        if self.graph_call(node):
            self.graph_context_seen = True
            if not node.args or not isinstance(node.args[0], ast.Dict):
                self.add_blocker(node, "dynamic-graph-specification")
            else:
                for key in node.args[0].keys:
                    if key is None:
                        self.add_blocker(node, "graph-dict-unpack")
                        continue
                    if not isinstance(key, ast.Constant) or not isinstance(key.value, str):
                        self.add_blocker(key, "dynamic-graph-key")
                        continue
                    axis, suffix = base_axis(key.value)
                    if axis not in RETIRED:
                        continue
                    target = RETIRED[axis] + suffix
                    self.uses.append({
                        "call": node.func.id,
                        "axis": axis,
                        "line": key.lineno,
                        "column": key.col_offset + 1,
                    })
                    self.add_edit(key, repr(target), "graph-key", axis, target)
        elif isinstance(node.func, ast.Name) and node.func.id == "current_atom":
            self.graph_context_seen = True
        self.generic_visit(node)

    def visit_Attribute(self, node):
        if node.attr in RETIRED:
            if self.is_view(node.value):
                proxy = type("Span", (), {
                    "lineno": node.end_lineno,
                    "end_lineno": node.end_lineno,
                    "col_offset": node.end_col_offset - len(node.attr.encode("utf-8")),
                    "end_col_offset": node.end_col_offset,
                })()
                self.add_edit(
                    proxy, RETIRED[node.attr], "atom-view-attribute",
                    node.attr, RETIRED[node.attr]
                )
                self.uses.append({
                    "call": "AtomView",
                    "axis": node.attr,
                    "line": node.end_lineno,
                    "column": proxy.col_offset + 1,
                })
            elif self.contains_graph_origin(node.value):
                self.add_blocker(node, "ambiguous-atom-view-origin", node.attr)
            else:
                self.unproven_attributes.append(node)
        self.generic_visit(node)

    def finalize(self):
        if self.graph_context_seen:
            for node in self.unproven_attributes:
                self.add_blocker(node, "unproven-retired-attribute", node.attr)

    def apply(self):
        result = self.encoded
        for edit in sorted(self.edits, key=lambda item: item["startByte"], reverse=True):
            result = (result[:edit["startByte"]]
                      + edit["replacement"].encode("utf-8")
                      + result[edit["endByte"]:])
        return result.decode("utf-8")


def analyze(item):
    source = item["source"]
    result = {
        "path": item["path"],
        "sourceHash": source_hash(source),
        "sourceHashBefore": source_hash(source),
        "sourceHashAfter": source_hash(source),
        "migratedSource": source,
        "uses": [],
        "edits": [],
        "blockers": [],
        "blockingAxes": [],
    }
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        blocker = {
            "reason": "syntax-error",
            "line": error.lineno or 1,
            "column": error.offset or 1,
            "message": error.msg,
        }
        result["blockers"] = [blocker]
        result["blockingAxes"] = ["syntax"]
        return result
    analyzer = ProgramUpgradeAnalyzer(source)
    analyzer.visit(tree)
    analyzer.finalize()
    migrated = source
    if not analyzer.blockers:
        candidate = analyzer.apply()
        post_tree = ast.parse(candidate)
        post_analyzer = ProgramUpgradeAnalyzer(candidate)
        post_analyzer.visit(post_tree)
        post_analyzer.finalize()
        if post_analyzer.edits or post_analyzer.blockers:
            residual = (post_analyzer.blockers or post_analyzer.edits)[0]
            analyzer.blockers.append({
                "reason": "post-upgrade-legacy-abi",
                "line": residual["line"],
                "column": residual["column"],
            })
        else:
            migrated = candidate
    result.update({
        "uses": sorted(analyzer.uses, key=lambda use: (use["line"], use["column"])),
        "edits": sorted(analyzer.edits, key=lambda edit: (edit["startByte"], edit["endByte"])),
        "blockers": sorted(analyzer.blockers, key=lambda blocker: (blocker["line"], blocker["column"])),
        "blockingAxes": sorted({blocker.get("axis", blocker["reason"])
                                for blocker in analyzer.blockers}),
        "migratedSource": migrated,
        "sourceHashAfter": source_hash(migrated),
    })
    return result


payload = json.load(sys.stdin)
json.dump(
    {"programs": [analyze(item) for item in payload["programs"]]},
    sys.stdout,
    ensure_ascii=False,
)
