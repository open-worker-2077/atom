# Atom Private Mobile Access Implementation Plan

> **For agentic workers:** Execute inline with test-driven development; do not introduce a second world store or public endpoint.

**Goal:** Let one approved Android phone securely edit the authoritative Atom world hosted on the always-on Windows computer.

**Architecture:** A localhost-only identity gateway accepts only Tailscale Serve requests carrying an approved login and streams them to the unchanged localhost-only 4784 service. The existing Web client gains a coarse-pointer action dock that dispatches the same visual intents as desktop controls.

**Tech Stack:** Node.js HTTP, PowerShell, Tailscale Serve, existing browser JavaScript/CSS and Node test runner.

## Global Constraints

- `127.0.0.1:4784` remains the only Atom world authority.
- Tailscale Funnel, router port forwarding, offline writes and copied phone data are forbidden.
- Existing uncommitted backup changes are preserved and excluded from this feature commit.
- Every behavior change follows red-green verification.

---

### Task 1: Tailscale identity gateway

**Files:**
- Create: `src/atom-system/adapters/private-mobile-gateway.mjs`
- Create: `work-engine/atom-language/private-mobile-gateway.mjs`
- Test: `tests/atom-private-mobile-gateway.test.mjs`

**Interfaces:**
- Consumes: `targetUrl`, `host`, `port`, `allowedLogins`.
- Produces: `startPrivateMobileGateway(options)` returning the listening server and URL.

- [ ] Write tests proving missing and wrong Tailscale identities are rejected.
- [ ] Run the focused test and confirm it fails because the gateway does not exist.
- [ ] Implement identity normalization, deny-by-default authorization and streaming proxy behavior.
- [ ] Test allowed GET, POST body forwarding and SSE streaming against a temporary localhost target.
- [ ] Verify the gateway itself binds only to `127.0.0.1`.

### Task 2: Reversible Windows private-access installer

**Files:**
- Create: `scripts/install-atom-private-access.ps1`
- Create: `scripts/disable-atom-private-access.ps1`
- Test: `tests/atom-private-access-contract.test.mjs`

**Interfaces:**
- Consumes: installed/logged-in Tailscale, current login identity and healthy 4784.
- Produces: one background gateway task, one private Serve mapping and one local ownership marker.

- [ ] Write contract tests for localhost targets, identity requirement, existing-config refusal and non-use of Funnel/reset.
- [ ] Confirm tests fail before the scripts exist.
- [ ] Implement prerequisite checks and safe refusal behavior.
- [ ] Implement an owned scheduled task plus `tailscale serve --bg` mapping to 4785.
- [ ] Implement targeted disable behavior that leaves unrelated Tailscale configuration untouched.

### Task 3: Mobile interaction adapter

**Files:**
- Modify: `index.html`
- Modify: `spatial.css`
- Test: `tests/mobile-interaction-contract.test.js`

**Interfaces:**
- Consumes: existing `data-intent` dispatch boundary.
- Produces: a coarse-pointer-only action dock for view, navigation and editing intents.

- [ ] Write contract tests for mode, layer, detail, create/edit/relation, confirm/cancel and safe-area controls.
- [ ] Confirm tests fail because the dock is absent.
- [ ] Add semantic buttons using existing visual intents; add no duplicate Atom behavior.
- [ ] Add responsive coarse-pointer layout without changing desktop presentation.
- [ ] Verify narrow portrait and landscape viewports by browser inspection.

### Task 4: Install and end-to-end acceptance

**Files:**
- Update: `README.md` with the supported private-mobile entry and rollback command.

**Interfaces:**
- Consumes: tested gateway, scripts, mobile dock and an approved Android device.
- Produces: a private HTTPS URL accessible only inside the tailnet.

- [ ] Install Tailscale on Windows and authenticate the computer.
- [ ] Authenticate and approve the Android device; restrict access to the Atom endpoint.
- [ ] Run the installer and verify Serve status contains no Funnel.
- [ ] Exercise one test-world edit from Android and confirm immediate desktop revision update.
- [ ] Disable and re-enable access to prove exact rollback without interrupting local 4784.
- [ ] Run targeted gateway/UI/system tests, build the browser bundle, inspect the diff and commit only feature files.
