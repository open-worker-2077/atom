# Adaptive 3D Graph Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current immersed Atom Web domain form a stable, rotatable three-dimensional Graph whose slot groups shrink to their contents and whose same-level strut topology forms the main and branch axes.

**Architecture:** Keep Atom four-axis facts, SceneSnapshot, Workspace edits, navigation, hit testing and camera contracts unchanged. Extend the existing pure layout models so slot containment produces cached three-dimensional volumes and same-level strut edges produce a deterministic directed skeleton; Canvas continues projecting these world coordinates while existing interaction code consumes stable Thing IDs.

**Tech Stack:** Browser JavaScript, Canvas 2D perspective projection, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-31-atom-web-spatial-design.md` §4.4–4.5

## Global Constraints

- `thing / situation / slot / strut` remain the only Graph axes.
- Slot defines containment and cutaway; strut defines same-level directed push relations and never owns hidden child nodes.
- Default main-axis orientation is low source to high target; layout yaw, pitch and branch spread are projection settings only.
- Adding a closing strut preserves the prior layout and overlays the closing edge; a cold closed graph uses its stored final edge as the closure reference.
- Normal cutaway shells are translucent; the immersed shell is visually transparent but remains hit-testable.
- Recompute only the changed local domain and its ancestor envelope chain.

---

### Task 1: Directed 3D topology skeleton

**Files:**
- Modify: `spatial-visual-model.js`
- Test: `tests/spatial-visual-model.test.js`

**Interfaces:**
- Consumes: layout entries, same-level relationship pairs and `{ layoutYawDegrees, layoutPitchDegrees, branchSpreadDegrees }`.
- Produces: `relaxRelationshipLayout()` positions with a stable three-dimensional main axis, radial branches and cycle-preserving closure behavior.

- [x] **Step 1: Write failing tests** for a directed chain rising along the default axis, a branch receiving nonzero depth, yaw/pitch rotation, and a final closing edge preserving the open-chain coordinates.
- [x] **Step 2: Run** `node --test --test-isolation=none tests/spatial-visual-model.test.js`; the new orientation and closure contracts failed before implementation.
- [x] **Step 3: Implement** deterministic directed backbone placement, rotated main-axis orientation, radial branch spread, and closure-edge exclusion from layout forces while retaining the real relationship for drawing.
- [x] **Step 4: Run** `node --test --test-isolation=none tests/spatial-visual-model.test.js`; 50/50 passed.

### Task 2: Slot-driven adaptive 3D volumes

**Files:**
- Modify: `spatial-cluster-field.js`
- Test: `tests/spatial-cluster-field.test.js`

**Interfaces:**
- Consumes: local node spheres, nested slot carriers and adjustable compactness/clearance.
- Produces: stable non-overlapping 3D node positions and the smallest spherical shell that contains every real child edge plus clearance.

- [x] **Step 1: Write failing tests** proving dense equal children use distinct z coordinates and authored z intervals remain intact; existing tests retain the empty minimum, measured contraction and ancestor-containment contracts.
- [x] **Step 2: Run** `node --test --test-isolation=none tests/spatial-cluster-field.test.js`; both new 3D cases failed before implementation.
- [x] **Step 3: Implement** deterministic volumetric packing and full x/y/z collision separation, remove z compression only in explicit 3D mode, and keep the legacy planar path unchanged.
- [x] **Step 4: Run** `node --test --test-isolation=none tests/spatial-cluster-field.test.js`; 44/44 passed.

### Task 3: Projection settings and shell states

**Files:**
- Modify: `spatial-demo-model.js`
- Modify: `index.html`
- Modify: `spatial-engine.js`
- Test: `tests/spatial-demo-model.test.js`
- Test: `tests/spatial-visual-model.test.js`

**Interfaces:**
- Consumes: settings-menu inputs for layout yaw 0–360°, pitch 0–360° and branch spread; existing S sibling-clearance control remains the slot interval input.
- Produces: normalized persisted settings passed into the two pure layout models; active immersed shell alpha 0, ordinary expanded shell translucent.

- [x] **Step 1: Write failing tests** for angle wrapping, branch-spread bounds, default values, real depth and preservation of the derived strut skeleton inside compact shells.
- [x] **Step 2: Run** the focused model tests; the new settings and spatial contracts failed before implementation.
- [x] **Step 3: Add** the three orientation controls, model normalizers, shared-setting migration and engine bindings; reuse the existing S interval control, pass explicit 3D options into current-domain layout, and make only the active immersed shell visually transparent while retaining hit regions.
- [x] **Step 4: Run** focused settings, layout, cluster and shared-persistence tests; 136/136 passed.

### Task 4: Integration and public build

**Files:**
- Modify: `index.html` build identifiers generated by the existing build script
- Modify: `docs/superpowers/plans/2026-09-03-atom-current-requirement-ledger.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: one browser build with stable 3D rotation, adaptive slot shells and unchanged interaction semantics.

- [x] **Step 1: Run** the minimum affected model, cluster, browser-scene, input and navigation tests; final directly affected contract chain 168/168 passed.
- [x] **Step 2: Run** `npm run build:browser` and `npm run check:development-control`; both passed for the candidate build.
- [x] **Step 3: Exercise** one real browser journey: immerse, rotate side-on, change layout angles, open a nested slot, verify normal/immersed alpha, and add a closing edge without moving existing nodes; Chromium layout-control/persistence journey 4/4 passed and the closing-edge coordinate contract passed in the pure layout model.
- [x] **Step 4: Update** the unique Superpowers ledger with exact revision and evidence, commit and push the authorized safety backup, read the exact remote check, and deploy/read back the public 4784 build after the affected chain is green. `origin/main@7e8ee9348969805c05e4ee10d9dbb940611552b1` was verified by `ls-remote`; GitHub run `34212876165` completed with the Superpowers control green and the repository-wide suite red only in pre-existing commit-receipt, temporary-world CLI and migration rollback chains. The directly affected rendering chain remained 168/168 green, the adjacent input chain 56/56 green, Chromium controls/persistence 4/4 green, and the live 4784 journey preserved the world hash.
