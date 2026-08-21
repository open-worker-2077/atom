## Context

See `proposal.md` for motivation and `specs/program-json-codec/spec.md` for behavior. The worker already imports Python's standard `json` module for trusted request and result transport, but the sandbox exposes neither that module nor any registered JSON function. `AtomView.detail` deliberately remains a string, and successful worker effects are returned only after the entire Program finishes.

## Goals / Non-Goals

**Goals:**

- Add a small pure-data boundary between detail strings and JSON-compatible Program values.
- Preserve strict standard JSON across parse and stringify, including Chinese and other non-ASCII text.
- Fail before any Program effect is published when input or output is not valid JSON data.
- Publish complete machine-readable signatures beside concise Help examples.

**Non-Goals:**

- Do not expose the Python `json` module, imports, `eval`, object hooks, custom encoders, file APIs, or dynamic code.
- Do not couple the codecs to one Atom path, one work-order template, or one ESG schema.
- Do not make `AtomView.detail` implicitly parse JSON; the caller chooses when a string is JSON.
- Do not add schema validation, JSONPath, streaming parsing, canonical key sorting, or business-size limits in this change.

## Decisions

### 1. Register two object-root functions

The public surface will be `json_parse({"text": ...})` and `json_stringify({"value": ..., "indent"?: ...})`. Object-root arguments match every other registered Program function and leave room for later compatible options without positional ambiguity.

A `detail_json()` convenience function was rejected because it would merge Graph traversal with data decoding and would not solve serialization of computed values. Exposing `json.loads` and `json.dumps` was rejected because modules and attribute calls would widen the sandbox grammar.

### 2. Keep implementation in the trusted Program standard library

Pure codec and recursive JSON-value validation will live in the trusted standard-library module, then be explicitly bound into the worker namespace. Program source receives only the two functions. `ALLOWED_FUNCTIONS` continues to derive registered names from the public registry, so an unregistered function cannot become callable accidentally.

Inline worker-only implementations were rejected because pure data behavior is easier to test and review when separated from process transport. A new dependency was rejected because Python's standard library already supplies the parser and encoder.

### 3. Enforce strict numbers and JSON-compatible values

Parsing will reject `NaN`, `Infinity`, and `-Infinity` through a constant-rejection hook. Stringification will recursively allow only null, booleans, strings, integers, finite floats, arrays and string-keyed objects; it will reject tuples, sets, Atom views and cycles before encoding. The encoder will also use `allow_nan=False` as a second gate.

Python can parse a syntactically valid exponent such as `1e400` into a non-finite float without invoking the constant hook, so parsed results also pass through the recursive JSON-value validator. Worker protocol output uses `allow_nan=False`, and the Node protocol reader converts malformed worker output into a bounded Program failure rather than an unhandled process rejection.

Relying only on `json.dumps` was rejected because Python accepts tuples as arrays and its default permits non-standard floating-point constants. Coercing unsupported values to strings was rejected because it destroys type integrity silently.

### 4. Make compact output the default and bound indentation

Absent `indent` produces compact JSON with no unnecessary separator spaces. Integers from 0 through 8 enable readable formatting; booleans are rejected even though Python treats them as integers. `ensure_ascii=False` preserves readable Unicode.

Defaulting to two-space indentation was rejected because large Sheet and work-order payloads would grow without the caller requesting readability. Unbounded indentation was rejected because it can amplify large payloads needlessly.

### 5. Reuse worker failure atomicity

The worker publishes accumulated effects only in its success result. A codec exception therefore produces `ATOM_PROGRAM_FAILED` and discards every effect from that evaluation. No new transaction mechanism is needed; a successful stringify result enters the existing deferred Transform and central commit path.

Codec wrappers record the first validation failure in an evaluation-local latch. Program `try/except` may observe the Python exception for local control flow, but cannot clear the latch; the worker fails before publishing its result even when Program source catches the exception.

## Risks / Trade-offs

- **[Large JSON can consume most of the ten-second Program budget]** → Keep the codec linear, avoid copies beyond parser/encoder requirements, and retain the existing bounded worker timeout; do not invent an arbitrary business-size cap.
- **[Python integers can exceed JavaScript's exact numeric range]** → Preserve standard JSON behavior in this change; callers that require exact large identifiers should represent them as strings, as the existing Graph JSON boundary already requires.
- **[Compact output changes whitespace]** → JSON semantics, not source whitespace, are the contract; callers needing readable detail explicitly request `indent: 2`.
- **[New registry metadata could be ignored by older consumers]** → Add optional contract fields while retaining registry version 2 and every existing required field.

## Migration Plan

1. Add failing real-Program tests for parse, stringify, write-back, invalid numbers, unsupported values and preserved import denial.
2. Implement the trusted codecs and bind them through the registered namespace.
3. Add registry metadata and Help examples, then run focused sandbox, registry, Program and interaction tests.
4. Restart the 4784 service together with the companion Transform-runtime repair.
5. In `test`, run a small detail JSON round trip; only after that tell the ESG application task to rerun its existing Program static acceptance.

Rollback removes the two registry entries, namespace bindings and pure helpers in one commit; no persisted Atom format changes require migration.
