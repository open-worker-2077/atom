# Atom Program Runtime 2.5

## Stable concepts

- `@agent` is an Atom whose position is the context origin. It is not an identity or permission system.
- Public CLI interaction selects one exact unique context origin with `atom.cmd --agent "<@agent name-or-path>"` and displays its full path in the prompt and command receipt.
- Interactive entry displays the current `@agent` as layer 1 and recursively
  includes its descendants through layer 3. One parent and same-level peers
  remain visible without expanding their content branches.
- `boundary~preview` reports non-content metadata for undisplayed directions:
  `up`, `down`, `left`, and `right`, each with an approximate Atom count and
  character count. It never includes hidden names or detail, and executable
  Program source contributes zero characters.
- The CLI passes the origin to the engine only as `interaction.agent = { ref, path }`. The opaque `ref` is derived from the immutable world revision plus structural address; the Agent is not passed to lock evaluation.
- `@program` is the only executable Atom type. Its `detail` is Python source.
- Program source controls execution order. Atom world functions are ordinary Python calls whose single root argument is a JSON-shaped object (`dict`).
- The world functions are `explore({...})`, `transform({...})`, `lock({...})`, `message({...})`, and `choice({...})`; `choice` takes a double-quoted JSON object (valid Python), registers a multi-select control, and returns its selected option ids, while `use_program({...})` composes reusable Program logic without adding another executable Atom type.
- `explore` and `transform` compile into the same internal command model as the CLI; they do not launch a CLI subprocess or edit JSON storage.
- `lock` receives targets only after Program logic has selected them. The stable target form is `{ "refs": [<opaque-ref>...] }`; the engine validates every reference against the same immutable world revision.
- `message` is the only user-visible Program return channel. Python `return` remains local Python control flow.

## Reusable Program references

A reusable `@program` defines `main(arguments)`. Another Program calls it with
`use_program({'name': '<exact name-or-path>', 'arguments': {...}})`. Arguments
and the return value must be JSON-compatible. A short name must resolve to one
unique Program; full paths disambiguate. Recursive calls and chains deeper than
eight Programs are rejected. Referenced code uses the same sandbox and Atom
world functions as its caller, so it cannot open storage or bypass locks.

## Pure Program helpers

The runtime also exposes a small trusted Python standard library. These helpers
only interpret Atom values already returned by `explore`; they cannot read
storage, mutate the world, emit locks, or send messages. Programs keep all side
effects explicit through the registered world functions.

| Helper | Purpose |
| --- | --- |
| `direct_children(rows, parent_path)` | Select direct children from explored rows. |
| `child_detail(rows, parent_path, child_name, default='')` | Read one direct child detail. |
| `missing_details(rows, parent_path, field_names)` | Return missing or blank form fields. |
| `form_status(rows, parent_path, status_name='状态')` | Read a form's separate status field. |
| `first_pending(forms, completed_states)` | Select the first tuple whose final item is not terminal. |
| `transition_allowed(current, requested, transitions)` | Evaluate a caller-supplied state transition table. |
| `subtree_refs(rows, root_path)` | Select validated refs belonging to one explored subtree. |
| `plan_form_flow(rows, parent_path, standard)` | Compile a form standard into safe, idempotent child additions. |
| `plan_template_instance(rows, parent_path, template)` | Compile one complete typed Atom subtree only when that instance is absent. |
| `plan_shards(sources, specification)` | Produce a deterministic, side-effect-free shard plan. |

### Standard compilation before sharding

Form-flow compilation is the upstream operation. A compiler Program declares
or reads one standard containing forms, independent status fields, fields, and
routes, then asks `plan_form_flow` for the missing structure:

```python
rows = explore({
    'name': '任务流',
    'children$latitude-2': None,
    'detail$full': None
})
standard = {
    'forms': [
        {
            'name': '定向',
            'detail': '明确需求、目标与边界',
            'status': '未进入',
            'fields': ['需求', '目标', '边界'],
            'routes': [{'verb': '通过后', 'object': '调研'}]
        }
    ]
}
plan = plan_form_flow(rows, '任务流', standard)
if plan['children']:
    transform({'name': '任务流', 'children': plan['children']})
if plan['conflicts']:
    message({'level': 'warning', 'text': ','.join(plan['conflicts'])})
```

The compiler creates only missing forms and fields. It never resets an existing
runtime status and never overwrites human-authored form detail. Existing detail
or route mismatches are returned as conflicts. Re-running an already satisfied
standard emits no transform, so normal interaction-triggered refresh remains
idempotent. Sharding runs only after this compiled form flow exists.

### Registered template instantiation

Template creation stays inside `@program`; no additional executable type or
task marker is required. A Program calls the registered high-level function:

```python
instantiate({
    'template': 'advancement-flow',
    'version': 'latest',
    'mode': 'ensure',
    'parameters': {
        'title': 'ESG项目总结汇报'
    }
})
```

The current Program Atom is the implicit target. The registered template is
compiled beneath that Program, including ordinary fields, routes, and nested
`@program` nodes. `ensure` creates missing template roots and becomes a no-op
when they already exist. The Program author does not reproduce the flow tree or
its internal Python.

The trusted template registry supplies a dynamic catalog rather than a
hard-coded advancement-only prompt. `template_catalog({})` returns each
template's id, label, description, latest version, and JSON parameter schema;
`template_catalog({'template': 'advancement-flow'})` selects one entry. CLI and
Web menu renderers can consume this same metadata and produce a fillable JSON
skeleton without defining another schema source.

`plan_shards` initially supports two deliberately small strategies:

```python
per_item = plan_shards(source_atoms, {
    'mode': 'each',
    'name_prefix': '片'
})

fixed_size = plan_shards(source_atoms, {
    'mode': 'fixed_size',
    'size': 20,
    'name_prefix': '批'
})
```

Each planned shard contains `name`, `ordinal`, `source_refs`, and
`source_paths`. Planning never creates Atoms. The Program reviews or reports
the plan and explicitly calls `transform({...})` when creation is justified.
Different advancement layers therefore reuse one planner with their own source
range, shard specification, and form template; a new partitioning strategy can
be added without rewriting dispatch, review, or closure Programs.

## Lock result

`lock` accepts one JSON-shaped object:

```json
{
  "targets": { "refs": ["opaque-ref"] },
  "mode": "write",
  "protect": {
    "atom": true,
    "messages": false
  },
  "reason": {
    "code": "MANUAL_FREEZE",
    "message": "已人工冻结"
  }
}
```

- `mode` is `write` or `read_write`.
- `protect.atom` controls the target Atom.
- `protect.messages` controls messages emitted by a target Program. It is data, not a hard-coded consequence of locking Program source.
- Multiple lock results only strengthen one another.

## Interaction scheduling

Every external CLI/Web interaction requests one Program refresh. A refresh request is not necessarily a new execution.

1. Compute the immutable world revision and Program-source fingerprint.
2. Reuse a completed result for the same fingerprint immediately.
3. Coalesce concurrent requests for the same fingerprint into one in-flight execution.
4. Run dirty Programs concurrently in isolated Python workers.
5. Program world-function calls belong to the existing interaction and never recursively trigger another cycle.
6. Enforce one 10-second wall-clock budget per cycle. Programs run independently within that shared deadline; on timeout, terminate only the affected worker and return a structured failure instead of blocking Atom.
7. Commit one validated result set for the revision. Messages are delivered once for the interaction that produced them; cached refreshes do not repeat old messages.

The first implementation invalidates the cache on any world revision change. A later dependency index may record `explore` query descriptors and read Atom references, allowing unaffected Programs to reuse results across revisions without changing the public API.

## Execution boundary

The JavaScript engine owns storage, revisions, validation, locking, and persistence. Python receives an immutable Atom snapshot plus its current Program reference. Python cannot open Atom storage directly. World-changing calls return intents; the JavaScript engine validates and applies them through the same Transform boundary.
