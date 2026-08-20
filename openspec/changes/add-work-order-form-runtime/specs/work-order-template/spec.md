## Purpose

提供首个可复用的外层工单模板，用一张真实单子验证 Atom 从模板创建、实例填写、局部校验到提交回读的完整闭环。

## ADDED Requirements

### Requirement: Work order has a minimal complete structure
The work-order template SHALL instantiate Output, Step, and Criteria groups plus the necessary child slots required to state the requested result, execution evidence, acceptance rules, status, and exception outcome.

#### Scenario: Create an empty work order
- **WHEN** a caller creates a work order with a title and exact template version
- **THEN** one complete instance is created with every required group and slot, without requiring the caller to reproduce the subtree

### Requirement: Work order guides the instance user
The generated instance SHALL expose only the guidance, current values, available actions, validation results, and status needed to complete that instance; it SHALL NOT expose template design history or internal implementation source as ordinary form content.

#### Scenario: Read an unfilled instance
- **WHEN** a human or Agent explores the new instance
- **THEN** each missing slot explains what is needed and the instance reports the next valid action

### Requirement: Work order submission depends on child outcomes
The root work order SHALL accept structured child outcomes and SHALL permit submission only when the template's required Output, Step, and Criteria conditions are satisfied.

#### Scenario: Submit an incomplete work order
- **WHEN** a required child reports missing or failed validation
- **THEN** submission is rejected with the responsible child paths and no completion state is committed

#### Scenario: Submit a complete work order
- **WHEN** every required child reports a passing result
- **THEN** the work order commits its completed state and returns a receipt that can be read back

### Requirement: First version stays within one work order
The first version SHALL NOT implement organizational dispatch, claiming, multi-order workflow, complex routing, or PM-specific nesting.

#### Scenario: Unsupported dispatch request
- **WHEN** a caller requests organizational dispatch through the first-version template
- **THEN** the system reports the capability as unsupported without partially creating dispatch data
