## Why

Atom Web currently commits the target breadcrumb before the target scope has any authoritative nodes, so a first entry renders an apparently empty domain for roughly 2–10 seconds. Existing tests only prove that a later request eventually fills the scope and therefore do not protect the user-visible first frame.

## What Changes

- Make a scoped spatial-state response include the requested path plus exactly one level of child-domain lookahead.
- Keep deeper descendants out of that response so progressive loading remains bounded.
- Require the first visual frame after entering a prefetched child domain to contain its authoritative nodes instead of a normal-looking empty scene.
- Record request, import, and first-visible-frame evidence on GitHub Issue #23 and link the accepted result to #1 and #10.

## Capabilities

### New Capabilities

- `web-domain-first-entry`: Defines bounded one-level spatial lookahead and the non-empty first-frame contract for Web domain entry.

### Modified Capabilities

None.

## Impact

- `GET /__spatial/api/state?path=...` returns nodes, patches, deletions, and relevant edges for the requested path and its direct child domains.
- `cli/lib/server.mjs` owns the bounded projection.
- Browser bridge behavior remains progressive and still fetches an entered path to obtain the following level.
- Server contract tests and Chromium critical-journey tests enforce the scope and first-frame boundaries.
