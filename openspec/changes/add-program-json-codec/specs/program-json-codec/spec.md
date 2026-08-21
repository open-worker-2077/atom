## Purpose

让受限 `@program` 在不获得模块导入、动态执行或文件访问能力的前提下，安全处理 Atom detail 中的标准 JSON，并把计算结果可靠写回 Graph。

## ADDED Requirements

### Requirement: json_parse shall decode strict standard JSON
The Program runtime SHALL register `json_parse({"text": string})` and return the represented JSON-compatible value. The function SHALL require exactly one `text` parameter and SHALL reject non-string input, unknown parameters, malformed JSON, and non-standard numeric constants.

#### Scenario: Parse an object from Atom detail
- **WHEN** a Program passes an Atom detail string containing a valid JSON object to `json_parse`
- **THEN** the function returns a Program dictionary with the same nested strings, numbers, booleans, nulls, arrays, and objects

#### Scenario: Parse any JSON value
- **WHEN** a Program passes a valid JSON scalar or array rather than an object
- **THEN** the function returns the corresponding JSON-compatible Program value

#### Scenario: Reject invalid input
- **WHEN** `text` is absent, not a string, contains malformed JSON, or contains `NaN`, `Infinity`, or `-Infinity`
- **THEN** the Program fails without emitting Transform effects

### Requirement: json_stringify shall encode strict standard JSON
The Program runtime SHALL register `json_stringify({"value": JSON-value, "indent"?: integer})` and return a UTF-8-preserving JSON string. `indent` SHALL be optional, SHALL accept integers from 0 through 8, and SHALL default to compact output when absent. The function SHALL reject unknown parameters, unsupported values, non-string object keys, circular values, non-finite numbers, booleans used as indentation, and indentation outside the supported range.

#### Scenario: Serialize a compact JSON value
- **WHEN** a Program calls `json_stringify` with one JSON-compatible value and no indentation
- **THEN** the result is strict compact JSON that preserves non-ASCII text without `NaN` or Infinity extensions

#### Scenario: Serialize readable indented JSON
- **WHEN** a Program supplies `indent` equal to 2
- **THEN** the result uses two-space nested indentation and remains parseable by `json_parse`

#### Scenario: Reject a non-JSON value
- **WHEN** the supplied value contains an unsupported runtime object, non-string dictionary key, circular reference, or non-finite number
- **THEN** the Program fails without emitting Transform effects

### Requirement: JSON codecs shall close the Atom detail processing loop
An active Program SHALL be able to read an Atom detail string through existing Graph functions, parse it, compute a JSON-compatible result, serialize that result, and emit an existing deferred Transform update within one Program evaluation.

#### Scenario: Read process and write back JSON detail
- **WHEN** a Program explores a source Atom containing JSON detail, changes a parsed field, serializes the value, and emits a detail replacement for a target Atom
- **THEN** the target detail is committed as parseable JSON and an exact read returns the changed value

### Requirement: JSON codecs shall not widen the Program sandbox
Registration of the JSON codecs SHALL NOT make module imports, `eval`, file APIs, private attributes, or the JSON module object available to Program source.

#### Scenario: Existing import denial remains enforced
- **WHEN** a Program attempts `import json` after the codecs are registered
- **THEN** validation rejects the Import construct before execution

### Requirement: JSON codec contracts shall be discoverable
CLI Help and the public Program function registry SHALL expose each function's object argument, required and optional parameters, result type, supported indentation range, strict-number behavior, and failure boundary without requiring an Agent context.

#### Scenario: Agent discovers the safe JSON loop
- **WHEN** an Agent reads CLI Help or the public function registry
- **THEN** it can write the parse-process-stringify-Transform sequence without inventing a parameter or using prohibited Python features
