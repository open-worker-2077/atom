# Web Interaction Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Atom Web operations complete only after authoritative data, final scene layout, and camera/view state agree, with real-browser regression gates for the user-visible paths that have repeatedly failed.

**Architecture:** Preserve Atom's single fact owner and treat Web view state as an independent fact set. A data operation advances through one ordered completion boundary: optimistic scene, authoritative receipt, projection reconciliation, final layout, then visible completion; a view operation frames the final rendered scene rather than pre-layout node data. Browser acceptance tests, not source-pattern tests, decide whether a critical journey is achieved.

**Tech Stack:** JavaScript, Node.js 24, Canvas Web UI, Atom 4784 HTTP service, Playwright Chromium, node:test.

## Global Constraints

- Do not modify or expose private Atom JSON data; browser tests use an isolated temporary world.
- Do not stage or overwrite unrelated local changes in `AGENTS.md`, backup runtime files, `.claude/`, or `CLAUDE.md`.
- Every production behavior starts with a failing behavior test and must be observed failing for the intended reason.
- A data edit must preserve camera, mode, expansion state, selection intent, and current path unless the user explicitly changes view.
- A view operation must frame the final rendered layout and cannot report completion while its intended nodes are outside the usable viewport.
- Critical Web journeys remain `partial` until the real browser gate passes locally and in CI.

---

### Task 1: Real-browser critical-journey gate

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.mjs`
- Create: `tests/browser/atom-web-critical-journeys.spec.mjs`
- Modify: `scripts/start-browser-acceptance-server.mjs`
- Modify: `.github/workflows/test.yml`

**Outcome:** A disposable Atom world is started for each run and Chromium exercises the actual Canvas page. The first two RED cases prove the existing failures: immersive entry does not keep all child nodes inside the usable viewport, and an Enter-committed node edit does not retain the same view while authoritative data returns.

**Acceptance:**
- [ ] The immersive-entry case fails on current `main` because at least one intended child is not visible after the transition settles.
- [ ] The edit/reconcile case fails on current `main` if the node vanishes, stale data reappears, or camera/path/mode changes.
- [ ] `npm run test:browser` runs against temporary files only and retains a trace or screenshot on failure.
- [ ] CI installs Chromium and runs this gate after the existing suite.

**Risk:** Canvas hit-testing is coordinate-sensitive; the test must discover targets through `spatialLab.state()` and use real pointer/keyboard input, while assertions remain user-visible geometry and persisted world state.

### Task 2: Final-scene framing boundary

**Files:**
- Create: `spatial-scene-completion-model.js`
- Create: `tests/spatial-scene-completion-model.test.js`
- Modify: `index.html`
- Modify: `spatial-engine.js`
- Modify: `tests/browser/atom-web-critical-journeys.spec.mjs`

**Interfaces:**
- Consumes: final rendered node regions from the current scene plus viewport safe-area bounds.
- Produces: a deterministic camera destination and a completion result stating which intended nodes are inside or outside the usable viewport.

**Outcome:** Enter, exit, PageUp/PageDown, and explicit reframe operations use one final-scene framing rule. Switching A/S/D/F alone remains a mode choice and does not move the camera.

**Acceptance:**
- [ ] A model RED test catches framing pre-layout coordinates instead of final scene coordinates.
- [ ] Immersive enter and exit browser cases keep every intended node visible without manual zoom.
- [ ] A-mode PageDown remains A-mode and frames around the latest explicit middle/right-click anchor.
- [ ] Repeated rendering does not create a second unsolicited camera movement.

**Risk:** Relationship relaxation currently runs while collecting render items; the implementation must establish one stable final scene per operation rather than recomputing a different layout for framing and rendering.

### Task 3: Ordered edit/reconcile completion

**Files:**
- Create: `spatial-operation-completion-model.js`
- Create: `tests/spatial-operation-completion-model.test.js`
- Modify: `spatial-browser-bridge.js`
- Modify: `spatial-engine.js`
- Modify: `tests/browser-bridge-contract.test.js`
- Modify: `tests/browser/atom-web-critical-journeys.spec.mjs`

**Interfaces:**
- Consumes: operation identity, starting world revision, authoritative receipt revision, and the view snapshot captured when the user commits.
- Produces: ordered `pending`, `authoritative`, `projected`, `settled`, or `failed` states; only the latest compatible revision may reconcile the scene.

**Outcome:** Create, rename/detail edit, move, relate, and delete each become one queued operation. An older pull or queued view save cannot replace a newer optimistic edit; an authoritative response updates data while restoring the captured view facts and stable visual identities.

**Acceptance:**
- [ ] RED model/bridge tests reproduce stale pull, response reordering, and two rapid local operations.
- [ ] Enter does not remove the edited/created node before the authoritative receipt.
- [ ] After the receipt, the exact authoritative value is visible and remains stable across a later server notice.
- [ ] Move/delete reconcile incoming and outgoing edges without ghosts.
- [ ] Camera, path, mode, expansion state, and selection intent remain unchanged unless the operation itself changes them.

**Risk:** Server persistence is already authoritative; this task must not create a second client-side fact owner or retry a committed command as a new command.

### Task 4: Capability-wide browser matrix and governance

**Files:**
- Modify: `tests/browser/atom-web-critical-journeys.spec.mjs`
- Modify: `docs/architecture/atom-capability-graph.json`
- Modify: `tests/atom-capability-graph.test.mjs`
- Modify: `README.md` only if the verified operational contract changes user instructions

**Outcome:** The gate covers A/S/D/F mode selection and application, PageUp/PageDown, immersive enter/exit, single and batch selection, and the five edit operations on desktop; the shared operation contract is also exercised through a mobile viewport for supported gestures.

**Acceptance:**
- [ ] Each critical journey asserts input, visible result, authoritative persistence when applicable, and stability after a second synchronization event.
- [ ] No critical capability is marked `achieved` without its browser-test reference.
- [ ] `npm test` and `npm run test:browser` both pass from a clean dependency install.
- [ ] The capability graph names any remaining unsupported path instead of implying system-wide completion.

**Risk:** Mobile gesture design is adjacent but not allowed to dilute the desktop convergence gate; unsupported gestures remain explicit gaps rather than hidden skips.

### Task 5: Verified publication

**Files:**
- Only files changed by Tasks 1–4

**Outcome:** Review the isolated diff, run the complete verification once, commit only task files, and push the verified commit to `main` while preserving the pre-work backup branch.

**Acceptance:**
- [ ] `git diff --check` passes.
- [ ] Targeted RED/GREEN history is recorded in the task notes or test output.
- [ ] Full unit/system suite and Chromium gate pass without private data.
- [ ] The pushed `origin/main` commit equals the locally verified commit.
- [ ] Unrelated pre-existing worktree changes remain unstaged and unchanged.

