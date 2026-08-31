## 1. Bounded State Projection

- [x] 1.1 Add a failing server contract proving the requested path includes direct child scopes but excludes grandchildren.
- [x] 1.2 Reuse the canonical child-domain path function to project nodes, patches, deletions, and edges for exactly one lookahead level.

## 2. Browser Acceptance

- [x] 2.1 Add a Chromium test requiring authoritative child nodes on the next visual frame after first entry.
- [x] 2.2 Run scoped server/bridge tests and the complete Web critical journeys; independently rerun and clear any unrelated threshold-only failure.

## 3. Delivery

- [x] 3.1 Validate the OpenSpec change strictly and run only the affected server, bridge, Chromium first-frame, and Web journey nodes; classify unrelated failures locally instead of rerunning the full repository.
- [ ] 3.2 Update Issue #23 and its #1/#10 backlinks, integrate the verified revision, deploy it to 4784, and record real first-entry timing.
