## Purpose

为 Agent、CLI、Web 和 Program 提供同一份可验证的注册函数与 Atom 类型目录，以粗颗粒函数家族组织公共能力，并保留本 Atom `@program` 的自主研发和复用空间。

## ADDED Requirements

### Requirement: Registered functions have one authoritative classification
The system SHALL expose one authoritative registry in which every Atom Program function has one stable name, a first-level layer of `kernel` or `application`, one coarse function family, and one simple scope descriptor. Kernel functions SHALL use only the `graph`, `form`, or `program` families in this contract; application functions SHALL use an application-owned family. `explore` and `transform` SHALL share `graph`, `form` SHALL use `form`, and `work_order` SHALL remain an application function.

#### Scenario: Query the complete catalog
- **WHEN** a Program, CLI client, or Web client requests the function catalog without filters
- **THEN** each registered Atom function appears exactly once with the same layer, family, and scope in every interface

#### Scenario: Explore and Transform remain one Graph family
- **WHEN** the catalog is grouped by layer and family
- **THEN** `explore` and `transform` appear together rather than as unrelated system stages

### Requirement: Scope does not prescribe public hierarchy
The registry contract SHALL use only the simple values `atom` and `public` when scope is needed. A public function SHALL NOT carry a platform-imposed public path, inherited parent constraints, or an application hierarchy. Public means available as a registered runtime component; concrete composition remains the caller Program's responsibility.

#### Scenario: Read a public function
- **WHEN** a caller reads a registered public function
- **THEN** the catalog reports `public` without synthesizing parent paths or inherited application constraints

#### Scenario: Compose behavior in one Atom
- **WHEN** an Agent encapsulates behavior for one Atom
- **THEN** it can keep and reuse an ordinary `@program` without a public hierarchy or formal registration step

### Requirement: Program remains a kernel type
The catalog SHALL identify `@program` as a kernel type and the only currently executable Atom type. This change SHALL NOT add an application Atom type or a new shape/type field.

#### Scenario: Inspect executable types
- **WHEN** a caller reads the registry type metadata
- **THEN** `program` is marked as kernel and executable, with no application executable type synthesized

### Requirement: Program development is open while registry mutation is not a Program function
Agents SHALL be able to write, refine, and reuse Atom-local Programs through the ordinary Program surface, including `use_program()`. Program execution SHALL NOT expose a function that directly mutates the protected registered-function inventory or runtime source. This boundary SHALL NOT prohibit Agents from researching, improving, or providing mature Program material.

#### Scenario: Refine a local Program
- **WHEN** an Agent develops or improves a specialized Program
- **THEN** the Program remains callable through the ordinary Program surface without requiring platform registration

#### Scenario: Read-only registry surface
- **WHEN** a Program queries the registered-function catalog
- **THEN** it can read the catalog but receives no registry or runtime-source mutation capability

### Requirement: Help and interfaces are projections of the same registry
Program catalog queries, CLI registry output, Web registry output, and relevant Help classification SHALL derive from the same registry contract. Help SHALL also be the unified operational explanation that Agents may develop and reuse local Programs while protected registration is not exposed as a Program mutation function. Unknown filters or registry drift SHALL fail explicitly rather than presenting conflicting inventories.

#### Scenario: Filter by layer and family
- **WHEN** a Program requests one declared layer or family
- **THEN** the returned entries are a stable subset of the same authoritative registry

#### Scenario: CLI and Web parity
- **WHEN** CLI and Web read the current function registry
- **THEN** they return equivalent registry data without requiring an Agent context
