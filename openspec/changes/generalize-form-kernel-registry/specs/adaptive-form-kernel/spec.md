## Purpose

为任意外层 Program 提供不预设业务流程的 Graph 原生 Form 内核，使简单单子和递归多层单子都能显式选择组件启用方式并得到精确、无副作用的缺项结果。

## ADDED Requirements

### Requirement: Existing Graph-native Form compilation remains compatible
The system SHALL continue to accept the existing `form()` Graph definition containing only `name`, `detail`, `children`, and `partners`, SHALL return only those four axes, and SHALL reject a parallel persisted Form or field hierarchy.

#### Scenario: Existing compiler caller remains valid
- **WHEN** an existing Program passes a valid four-axis Graph definition directly to `form()`
- **THEN** the result remains byte-compatible in structure with the current compiled Graph definition

#### Scenario: Parallel storage axis is rejected
- **WHEN** a compiler caller supplies `fields`, `form`, or another unsupported Graph axis
- **THEN** evaluation fails before any world effect is emitted

### Requirement: Component activation is selected by the outer Program
For component evaluation, the system SHALL require each component to declare exactly one activation value of `required`, `optional`, or `disabled`. The Form kernel SHALL NOT infer activation from component names, workflow stages, scale, empty content, or a platform default.

#### Scenario: Required and optional components are evaluated differently
- **WHEN** a required component and an unused optional component both contain empty required paths
- **THEN** only the required component contributes missing results

#### Scenario: Disabled component is absent from validation
- **WHEN** a component is explicitly disabled
- **THEN** that component and its descendants contribute no missing result and no skip reason is required

#### Scenario: Activation is not declared
- **WHEN** a component evaluation omits activation or supplies an unknown activation value
- **THEN** evaluation fails with a deterministic input error instead of choosing for the caller

### Requirement: Form scale and nesting are data-driven
The system SHALL evaluate zero or more recursively nested components with the same contract and SHALL NOT impose a minimum component count, a fixed two-level workflow, or named stages. A disabled parent SHALL disable its whole descendant subtree. An optional component SHALL enforce its declared requirements only after its own value or descendant values are in use.

#### Scenario: Minimal Form has no unnecessary stages
- **WHEN** an outer Program evaluates one required component and no other components
- **THEN** the Form result contains only that component and does not synthesize research, layering, sharding, pilot, or other stages

#### Scenario: Disabled subtree
- **WHEN** a disabled parent contains required descendants with empty values
- **THEN** neither the parent nor descendants are reported missing

#### Scenario: Optional subtree becomes active through content
- **WHEN** an optional component or one of its descendants contains content
- **THEN** its declared requirements and enabled descendants are evaluated normally

### Requirement: Missing content is reported by explicit JSON paths
Each component requirement SHALL identify its target with a JSON key-path array. Evaluation SHALL report the component path and missing key path without inventing dynamic keys, dotted traversal syntax, or business-specific validation rules.

#### Scenario: Nested value is missing
- **WHEN** a required component declares `{"path":["验收","条件"]}` and that value is absent or empty
- **THEN** the result reports that exact component path and the unchanged `['验收', '条件']` key path

#### Scenario: Required nested value is present
- **WHEN** every declared required path resolves to non-empty JSON-compatible content
- **THEN** the component contributes no missing result

### Requirement: Form evaluation is pure and caller-controlled
Component evaluation SHALL return JSON-compatible status data and SHALL NOT explore the world, emit Transform, mutate backing storage, choose application ordering, or change an Atom status. Outer Programs SHALL remain responsible for locating values and deciding subsequent actions.

#### Scenario: Evaluate an incomplete Form
- **WHEN** a Program evaluates components with missing required content
- **THEN** it receives `valid`, activation-group and missing-path results while the Program effect set remains unchanged
