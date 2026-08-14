# Spatial CLI Bridge Blueprint

> 历史蓝图：其“只控制内存、不做持久化”的限制已经由 `2026-07-20-spatial-kb-cli-design.md` 取代。当前正式试点包含全局 `spatial` 命令、JSON 知识库与本地页面桥；本文保留用于解释最初的命令边界。

## Objective

Expose the same spatial workspace operations used by the 3D page through a local command-line interface. The CLI must return machine-readable information about the current domain, visible nodes, relations, selection, camera, and edit results without simulating mouse input or reading Canvas pixels.

This blueprint does not add persistence. The initial bridge controls the running in-memory visual workspace only.

## Recommended architecture

1. `spatial-command-core.js` defines allowlisted query and command handlers independent of DOM events.
2. `spatial-browser-bridge.js` connects the page to a loopback WebSocket and adapts command-core results to JSON.
3. `spatial-bridge-server.mjs` accepts one authenticated browser session and local CLI requests.
4. `spatial-cli.mjs` parses human-friendly commands, sends one request, prints one JSON result, and exits with a stable status code.
5. A later `persistence-json.mjs` adapter may subscribe to committed graph edits. It is not part of the visual core or the first bridge version.

The page remains authoritative for live camera and current-domain state. The command core remains authoritative for memory-only graph edits. The bridge transports messages only.

## Transport

- Bind only to `127.0.0.1`.
- Generate a random session token when the bridge starts.
- Require the token in the browser WebSocket URL and every CLI request.
- Reject unknown origins and all commands outside the allowlist.
- Use JSON Lines for CLI standard input/output and JSON messages over WebSocket.
- Set a request timeout of 3000 ms and return a structured timeout error when the page is not connected.

## Identity

Every node endpoint uses a fully-qualified key:

```text
<domain-path>::<node-id>
```

Examples:

```text
root::workspace-node-2
root/portal-3::sphere-5
```

Relations use their stable workspace identity:

```text
relation:<sorted-endpoint-a><-><sorted-endpoint-b>
```

## Request envelope

```json
{"id":"req-17","method":"node.update","params":{"key":"root::workspace-node-2","label":"深空索引"}}
```

## Success envelope

```json
{"id":"req-17","ok":true,"result":{"key":"root::workspace-node-2","label":"深空索引","revision":8}}
```

## Error envelope

```json
{"id":"req-17","ok":false,"error":{"code":"NODE_NOT_FOUND","message":"Node does not exist in the indexed visited field","details":{"key":"root::missing"}}}
```

## Query methods

### `field.get`

Returns the complete currently visible interaction projection:

```json
{
  "path":"root/portal-3",
  "pathLabels":["全域","递归球域"],
  "depth":1,
  "selection":"root/portal-3::sphere-5",
  "camera":{"yaw":0.2,"pitch":-0.1,"distance":17.2},
  "nodes":[
    {
      "key":"root/portal-3::sphere-5",
      "label":"临时片段",
      "carrier":"tunnel",
      "surfaceVisible":true,
      "revealed":false,
      "description":"视觉详情摘要",
      "attachment":{"name":"note.pdf","type":"application/pdf","size":18122}
    }
  ],
  "relations":[]
}
```

### Other queries

- `view.get`: current path, depth, camera, selection, transition phase, and visible count.
- `node.list`: nodes in `current`, an explicit path, or all indexed visited paths.
- `node.get`: one fully-qualified node including visual flags and sanitized attachment metadata.
- `edge.list`: relations in `current`, an explicit path, or all indexed visited paths.
- `search`: visited-domain path and node-name search with fully-qualified results.
- `input.list`: current grouped input mappings and active preset.

## Graph edit methods

- `node.create`: create a memory-only node in the current or explicit indexed domain.
- `node.update`: update label, detail, or attachment metadata already available to the page.
- `node.delete`: enter delete-warning state or confirm deletion when `confirm: true`.
- `edge.create`: create a same-domain or cross-domain relation from two qualified endpoints.
- `edge.delete`: enter delete-warning state or confirm deletion.
- `edit.confirm`: confirm the active visual transaction.
- `edit.cancel`: cancel the active visual transaction.

All graph edit responses include `transaction`, `revision`, and the affected fully-qualified keys.

## View methods

- `view.focus <node-key>`: select without camera zoom.
- `view.enter <node-key>`: enter a tunnel node.
- `view.exit`: return one semantic depth.
- `view.overview`: return to root overview.
- `view.surface <node-key> --show|--hide|--toggle`: control the mirror surface.
- `view.children <node-key> --show|--hide|--toggle`: control same-layer child expansion.
- `view.rotate --yaw <number> --pitch <number>`: set an explicit view orientation.
- `view.zoom --distance <number>`: set an explicit bounded camera distance.

These commands invoke visual intents. They do not change business data.

## CLI examples

```powershell
spatial field get --json
spatial node list --scope current --json
spatial node create --name "深空索引" --detail "当前视觉详情" --json
spatial node update "root::workspace-node-2" --name "证据索引" --json
spatial edge create "root::sphere-2" "root/portal-3::sphere-5" --json
spatial view enter "root::sphere-2" --json
spatial view surface "root/portal-3::sphere-5" --show --json
spatial edit cancel --json
```

## Exit codes

- `0`: success.
- `2`: invalid CLI arguments.
- `3`: bridge unavailable or page disconnected.
- `4`: target domain, node, or relation not found.
- `5`: command rejected because another transaction is active.
- `6`: command violates the visual-command allowlist.
- `7`: request timed out.

## Implementation order

1. Extract read-only `field.get`, `view.get`, `node.list`, and `edge.list` from existing state.
2. Add an in-page command dispatcher and test it without networking.
3. Add the loopback bridge with token authentication.
4. Add the JSON-only CLI and verify read-only queries.
5. Add visual navigation commands.
6. Add node and relation edits using the existing transaction API.
7. Add a persistence adapter only after the live command layer is stable.

## Acceptance criteria

- The CLI never generates pointer or keyboard events.
- One `field.get` call returns everything Codex needs to understand the current visible field.
- Cross-domain endpoints remain fully qualified.
- Every mutation uses the same transaction and confirmation rules as the page.
- The page functions normally when the bridge is absent.
- No CLI command can invoke arbitrary JavaScript, filesystem paths, or shell commands.
