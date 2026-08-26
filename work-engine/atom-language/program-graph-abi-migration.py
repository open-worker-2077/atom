import ast
import hashlib
import json
from pathlib import Path
import sys

RETIRED = {
    "name": "thing",
    "detail": "situation",
    "children": "contain",
    "partners": "support",
}
GRAPH_CALLS = {"explore", "transform"}
ACTIVE = set(RETIRED.values())


def prove_registered_direct_children():
    try:
        tree = ast.parse(Path(__file__).with_name("program_stdlib.py").read_text(encoding="utf-8"))
    except (OSError, SyntaxError):
        return False
    definitions = [node for node in tree.body
                   if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                   and node.name == "direct_children"]
    if len(definitions) != 1:
        return False
    definition = definitions[0]
    if not definition.args.args or definition.args.args[0].arg != "rows":
        return False
    parents = {}
    for parent in ast.walk(definition):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent
    returns = [node for node in ast.walk(definition) if isinstance(node, ast.Return)]
    if len(returns) != 1 or not isinstance(returns[0].value, ast.Name):
        return False
    result_name = returns[0].value.id
    initializers = [node for node in ast.walk(definition)
                    if isinstance(node, ast.Assign)
                    and any(isinstance(target, ast.Name) and target.id == result_name
                            for target in node.targets)]
    if len(initializers) != 1 or not isinstance(initializers[0].value, ast.List) \
            or initializers[0].value.elts:
        return False
    loops = [node for node in ast.walk(definition)
             if isinstance(node, (ast.For, ast.AsyncFor))
             and isinstance(node.target, ast.Name) and isinstance(node.iter, ast.Name)
             and node.iter.id == "rows"]
    if len(loops) != 1:
        return False
    row_name = loops[0].target.id
    appends = [node for node in ast.walk(definition)
               if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
               and isinstance(node.func.value, ast.Name)
               and node.func.value.id == result_name and node.func.attr == "append"]
    result_method_calls = [node for node in ast.walk(definition)
                           if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                           and isinstance(node.func.value, ast.Name)
                           and node.func.value.id == result_name]
    if len(appends) != 1 or len(appends[0].args) != 1 \
            or not isinstance(appends[0].args[0], ast.Name) \
            or appends[0].args[0].id != row_name:
        return False
    current = appends[0]
    while current is not None and current is not loops[0]:
        current = parents.get(current)
    if current is not loops[0]:
        return False
    other_result_writes = [node for node in ast.walk(definition)
                           if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
                           and node.id == result_name]
    other_row_writes = [node for node in ast.walk(definition)
                        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
                        and node.id == row_name]
    return result_method_calls == appends \
        and len(other_result_writes) == 1 and len(other_row_writes) == 1


REGISTERED_COLLECTION_PASSTHROUGHS = (
    {"direct_children": 0} if prove_registered_direct_children() else {}
)


def source_hash(source):
    return "sha256:" + hashlib.sha256(source.encode("utf-8")).hexdigest()


def base_axis(value):
    for index, character in enumerate(value):
        if character in "@#$~.":
            return value[:index], value[index:]
    return value, ""


class ProgramUpgradeAnalyzer(ast.NodeVisitor):
    def __init__(self, source, tree):
        self.encoded = source.encode("utf-8")
        self.tree = tree
        self.parents = {}
        for parent in ast.walk(tree):
            for child in ast.iter_child_nodes(parent):
                self.parents[child] = parent
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
        self.current_graph_call = "GraphSpec"

    def scope_of(self, node):
        current = node
        while current is not None:
            if isinstance(current, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                return current
            current = self.parents.get(current)
        return self.tree

    def unique_direct_assignment(self, name, use):
        scope = self.scope_of(use)
        assignments = []
        for candidate in ast.walk(scope):
            if self.scope_of(candidate) is not scope:
                continue
            if isinstance(candidate, ast.Assign):
                if any(isinstance(target, ast.Name) and target.id == name
                       for target in candidate.targets):
                    assignments.append((candidate, candidate.value))
            elif isinstance(candidate, ast.AnnAssign) \
                    and isinstance(candidate.target, ast.Name) \
                    and candidate.target.id == name and candidate.value is not None:
                assignments.append((candidate, candidate.value))
        if len(assignments) != 1:
            return None
        statement, value = assignments[0]
        block = self.parents.get(statement)
        if block is None or statement.lineno >= use.lineno:
            return None
        direct_use = use
        while self.parents.get(direct_use) is not None \
                and self.parents.get(direct_use) is not block:
            direct_use = self.parents[direct_use]
        if self.parents.get(direct_use) is not block:
            return None
        containing_sequence = next((sequence for sequence in (
            getattr(block, "body", None), getattr(block, "orelse", None)
        ) if isinstance(sequence, list)
            and statement in sequence and direct_use in sequence), None)
        if containing_sequence is None \
                or containing_sequence.index(statement) >= containing_sequence.index(direct_use):
            return None
        return statement, value

    def name_loads(self, name, use):
        scope = self.scope_of(use)
        return [node for node in ast.walk(scope)
                if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)
                and node.id == name and self.scope_of(node) is scope]

    def graph_argument(self, node):
        parent = self.parents.get(node)
        return self.graph_call(parent) and parent.args and parent.args[0] is node

    def safe_spec_name(self, name, use):
        for load in self.name_loads(name, use):
            parent = self.parents.get(load)
            if self.graph_argument(load):
                continue
            if isinstance(parent, ast.Subscript) and parent.value is load \
                    and isinstance(parent.ctx, ast.Store):
                continue
            return False
        return True

    def safe_graph_key_name(self, name, use):
        for load in self.name_loads(name, use):
            dictionary = self.parents.get(load)
            if not isinstance(dictionary, ast.Dict) or load not in dictionary.keys:
                return False
            call = self.parents.get(dictionary)
            if not self.graph_call(call) or not call.args or call.args[0] is not dictionary:
                return False
        return True

    def safe_list_name(self, name, use):
        for load in self.name_loads(name, use):
            parent = self.parents.get(load)
            if isinstance(parent, (ast.For, ast.AsyncFor)) and parent.iter is load:
                continue
            if isinstance(parent, ast.Call) and isinstance(parent.func, ast.Name) \
                    and parent.func.id == "len" and len(parent.args) == 1 \
                    and parent.args[0] is load and not parent.keywords:
                continue
            return False
        return True

    def safe_loop_target(self, name, loop):
        scope = self.scope_of(loop)
        for load in self.name_loads(name, loop):
            current = load
            inside_loop = False
            while current is not None and current is not scope:
                if current is loop:
                    inside_loop = True
                    break
                current = self.parents.get(current)
            if not inside_loop or not self.graph_argument(load):
                return False
        return True

    def containing_loop_target(self, node):
        current = self.parents.get(node)
        while current is not None:
            if isinstance(current, (ast.For, ast.AsyncFor)) \
                    and isinstance(current.target, ast.Name) \
                    and isinstance(node, ast.Name) and current.target.id == node.id:
                return current
            if isinstance(current, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                return None
            current = self.parents.get(current)
        return None

    def subscript_keys_before(self, name, definition, use):
        scope = self.scope_of(use)
        keys = []
        for candidate in ast.walk(scope):
            if self.scope_of(candidate) is not scope or not isinstance(candidate, ast.Assign):
                continue
            if self.parents.get(candidate) is not scope \
                    or not (definition.lineno < candidate.lineno < use.lineno):
                continue
            for target in candidate.targets:
                if isinstance(target, ast.Subscript) \
                        and isinstance(target.value, ast.Name) \
                        and target.value.id == name:
                    keys.append(target.slice)
        return keys

    def resolve_graph_spec(self, node, use):
        if isinstance(node, ast.Dict):
            return [node], []
        if not isinstance(node, ast.Name):
            return None
        loop = self.containing_loop_target(node)
        if loop is not None:
            if not self.safe_loop_target(node.id, loop) or not isinstance(loop.iter, ast.Name):
                return None
            binding = self.unique_direct_assignment(loop.iter.id, loop)
            if binding is None or not self.safe_list_name(loop.iter.id, loop):
                return None
            _, value = binding
            if not isinstance(value, (ast.List, ast.Tuple)) \
                    or not value.elts or not all(isinstance(item, ast.Dict) for item in value.elts):
                return None
            return list(value.elts), []
        binding = self.unique_direct_assignment(node.id, use)
        if binding is None or not self.safe_spec_name(node.id, use):
            return None
        definition, value = binding
        if not isinstance(value, ast.Dict):
            return None
        return [value], self.subscript_keys_before(node.id, definition, use)

    @staticmethod
    def flatten_add(node):
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            return ProgramUpgradeAnalyzer.flatten_add(node.left) \
                + ProgramUpgradeAnalyzer.flatten_add(node.right)
        return [node]

    @staticmethod
    def static_string(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
            left = ProgramUpgradeAnalyzer.static_string(node.left)
            right = ProgramUpgradeAnalyzer.static_string(node.right)
            if left is not None and right is not None:
                return left + right
        return None

    def record_key_edit(self, node, axis, target, replacement, kind="graph-key"):
        self.uses.append({
            "call": self.current_graph_call,
            "axis": axis,
            "line": node.lineno,
            "column": node.col_offset + 1,
        })
        self.add_edit(node, replacement, kind, axis, target)

    def process_composite_prefix(self, node, kind="graph-key-prefix"):
        operands = self.flatten_add(node)
        leading = []
        for operand in operands:
            if not isinstance(operand, ast.Constant) or not isinstance(operand.value, str):
                break
            leading.append(operand)
        prefix = "".join(operand.value for operand in leading)
        axis, suffix = base_axis(prefix)
        if leading and suffix and axis in RETIRED and leading[0].value.startswith(axis):
            target_axis = RETIRED[axis]
            replacement = target_axis + leading[0].value[len(axis):]
            self.record_key_edit(
                leading[0], axis, target_axis + suffix, repr(replacement), kind
            )
            return True
        return bool(leading and suffix and axis in ACTIVE)

    def process_graph_key(self, key):
        if key is None:
            self.add_blocker(key, "graph-dict-unpack")
            return
        if isinstance(key, ast.Constant) and isinstance(key.value, str):
            axis, suffix = base_axis(key.value)
            if axis in RETIRED:
                target = RETIRED[axis] + suffix
                self.record_key_edit(key, axis, target, repr(target))
            return
        if isinstance(key, ast.Name):
            binding = self.unique_direct_assignment(key.id, key)
            value = self.static_string(binding[1]) if binding is not None else None
            if value is not None:
                axis, suffix = base_axis(value)
                if axis in RETIRED:
                    target = RETIRED[axis] + suffix
                    self.record_key_edit(key, axis, target, repr(target), "graph-key-expression")
                    return
                if axis in ACTIVE:
                    return
            if binding is not None and self.safe_graph_key_name(key.id, key) \
                    and self.process_composite_prefix(binding[1], "graph-key-prefix-binding"):
                return
            self.add_blocker(key, "dynamic-graph-key")
            return
        if self.process_composite_prefix(key):
            return
        self.add_blocker(key, "dynamic-graph-key")

    def process_graph_dict(self, node):
        for key in node.keys:
            self.process_graph_key(key)

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

    def collection_passthrough_argument(self, call):
        if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name):
            return None
        definitions = [node for node in ast.walk(self.tree)
                       if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                       and node.name == call.func.id]
        if definitions:
            return None
        index = REGISTERED_COLLECTION_PASSTHROUGHS.get(call.func.id)
        return index if index is not None and index < len(call.args) else None

    def is_collection(self, node):
        if self.graph_call(node) and node.func.id == "explore":
            return True
        passthrough = self.collection_passthrough_argument(node)
        if passthrough is not None and self.is_collection(node.args[passthrough]):
            return True
        return isinstance(node, ast.Name) and node.id in self.collection_names \
            and node.id not in self.ambiguous_names

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

    def visit_ListComp(self, node):
        for generator in node.generators:
            if isinstance(generator.target, ast.Name) and self.is_collection(generator.iter):
                self.view_names.add(generator.target.id)
        self.generic_visit(node)

    def visit_Call(self, node):
        if self.graph_call(node):
            self.graph_context_seen = True
            resolved = self.resolve_graph_spec(node.args[0], node) if node.args else None
            if resolved is None:
                self.add_blocker(node, "dynamic-graph-specification")
            else:
                previous_call = self.current_graph_call
                self.current_graph_call = node.func.id
                dictionaries, extra_keys = resolved
                for dictionary in dictionaries:
                    self.process_graph_dict(dictionary)
                for key in extra_keys:
                    self.process_graph_key(key)
                self.current_graph_call = previous_call
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
    analyzer = ProgramUpgradeAnalyzer(source, tree)
    analyzer.visit(tree)
    analyzer.finalize()
    migrated = source
    if not analyzer.blockers:
        candidate = analyzer.apply()
        post_tree = ast.parse(candidate)
        post_analyzer = ProgramUpgradeAnalyzer(candidate, post_tree)
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
