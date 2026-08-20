## Purpose

让 Atom 调用方在每次沿坐标探索后都知道当前返回范围之外是否仍有可继续查看的内容及其预计读取成本，避免把局部视野误判为完整世界。

## ADDED Requirements

### Requirement: Every successful anchored Explore reports its current boundary
The system SHALL attach one boundary preview to every successful Explore item that resolves one exact anchor. The preview SHALL be recalculated from that query's anchor and returned coordinate scope rather than reused from the initial Agent entry view.

#### Scenario: Move down and receive an updated boundary
- **WHEN** a caller explores one level below an anchor whose descendants continue beyond the returned level
- **THEN** the result reports that the `down` boundary has more nodes outside the current response

#### Scenario: Re-anchor after following the route
- **WHEN** a caller uses a returned child as the next exact anchor
- **THEN** the next result reports boundary data relative to that child instead of the previous anchor

### Requirement: Boundary directions describe further coordinate expansion
The boundary preview SHALL contain `up`, `down`, `left`, and `right`. For a fully visible direction, each direction SHALL return `state`, `hasMore`, `nodes`, and `characters`; `nodes` SHALL count visible Atoms not returned by the current query that the corresponding coordinate direction can reach, and `characters` SHALL estimate their name and readable detail characters while treating executable Program source as zero detail characters.

#### Scenario: Returned depth excludes deeper descendants
- **WHEN** an Explore response contains the anchor and its direct children but deeper readable descendants remain
- **THEN** `down.nodes` counts those unreturned descendants and `down.characters` estimates their readable content

#### Scenario: No further node in one direction
- **WHEN** no additional readable Atom exists beyond the returned scope in a direction
- **THEN** that direction reports `state` as `complete`, `hasMore` as false, `nodes` as zero, and `characters` as zero

#### Scenario: Longitude preview follows sibling coordinates
- **WHEN** readable siblings remain before or after the returned longitude range
- **THEN** the corresponding `left` or `right` preview counts those unreturned sibling coordinates without silently expanding their descendant branches

### Requirement: Protected boundaries fail closed without appearing empty
If any otherwise reachable Atom in one direction cannot safely contribute its name or estimated readable content, the system SHALL mark that direction `protected`, SHALL report `hasMore` as true, and SHALL omit exact node and character counts. It SHALL NOT expose protected names, details, or exact quantities and SHALL NOT report the direction as an empty complete boundary.

#### Scenario: Protected descendant lies beyond the returned scope
- **WHEN** an unreadable descendant exists below the visible response
- **THEN** `down` reports `state` as `protected` and does not include exact `nodes` or `characters`

### Requirement: CLI and query interfaces project one boundary result
The query result used by CLI and Web SHALL carry one authoritative boundary preview. CLI Graph-JSON SHALL render it as `boundary~preview` beside the matched result, while existing matched Atom fields and the Program `explore()` list contract SHALL remain compatible.

#### Scenario: CLI renders boundary metadata with one match
- **WHEN** an ordinary CLI Explore resolves one exact anchor
- **THEN** its Graph-JSON result includes the matched Atom data and `boundary~preview`

#### Scenario: Program Explore remains a list of Atom views
- **WHEN** an existing Program calls `explore()` after this change
- **THEN** it continues receiving the same Atom-view list rather than a new envelope or synthetic boundary Atom
