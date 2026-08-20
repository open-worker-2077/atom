## Purpose

为 Agent、CLI、Web 和 Program 提供同一份可验证的注册函数分类与公共层级目录，同时把本 Atom 的 `@program` 自主生产空间与后台维护的公共注册能力清楚分开。

## ADDED Requirements

### Requirement: Registered functions have one authoritative classification
The system SHALL expose one authoritative registry in which every Atom Program function has one stable name, a first-level layer of `kernel` or `application`, a second-level capability category, and one scope descriptor. `explore` and `transform` SHALL share the same Graph-world category; `form` SHALL be a kernel structure/constraint capability; `work_order` SHALL be an application capability.

#### Scenario: Query the complete catalog
- **WHEN** a Program, CLI client, or Web client requests the function catalog without filters
- **THEN** each registered Atom function appears exactly once with the same layer, category, and scope in every interface

#### Scenario: Explore and Transform remain one architectural category
- **WHEN** the catalog is grouped by layer and category
- **THEN** `explore` and `transform` appear together rather than as unrelated system stages

### Requirement: Scope is either Atom-local or hierarchical public
The registry contract SHALL define only `atom` and `public` scope kinds. A public entry SHALL carry a hierarchical public path, and every nested public path SHALL inherit the constraints of all public ancestors. A locally public subset SHALL remain `public`; it SHALL NOT become a third cross-Atom scope kind.

#### Scenario: Nested public function
- **WHEN** a public application function is registered below a parent public category
- **THEN** its effective constraints contain both its own constraints and every parent public constraint

#### Scenario: Atom-local executable
- **WHEN** a usage-side Agent encapsulates behavior for one Atom
- **THEN** it remains an Atom-local `@program` unless the backend separately publishes a registry entry

### Requirement: Program remains a kernel type
The catalog SHALL identify `@program` as a kernel type and the only currently executable Atom type. This change SHALL NOT add an application Atom type or a new shape/type field.

#### Scenario: Inspect executable types
- **WHEN** a caller reads the registry type metadata
- **THEN** `program` is marked as kernel and executable, with no application executable type synthesized

### Requirement: Registry mutation remains a backend boundary
Usage-side Agents, including domain-specialized usage-side Agents, SHALL NOT directly modify the platform function registry or protected kernel code through Program execution. Their code and application patterns MAY remain usable as Atom-local Programs and MAY be treated as backend research material without requiring the usage side to judge kernel suitability.

#### Scenario: Domain-specialized usage remains usage-side
- **WHEN** a usage-side Agent builds a specialized Program for a domain scenario
- **THEN** its specialization does not grant authority to modify protected runtime code or public registry facts

#### Scenario: Local material is not silently promoted
- **WHEN** a local Program is useful in production
- **THEN** it continues to run locally and is not automatically published, reclassified, or versioned as a formal registry function

### Requirement: Help and interfaces are projections of the same registry
Program catalog queries, CLI registry output, Web registry output, and relevant Help classification SHALL derive from the same registry contract. Unknown filters or registry drift SHALL fail explicitly rather than presenting conflicting inventories.

#### Scenario: Filter by layer and category
- **WHEN** a Program requests one declared layer or category
- **THEN** the returned entries are a stable subset of the same authoritative registry

#### Scenario: CLI and Web parity
- **WHEN** CLI and Web read the current function registry
- **THEN** they return equivalent registry data without requiring an Agent context
