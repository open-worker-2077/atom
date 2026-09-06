# Task 5 I2 — committed tuple projection and cold authority consumers

## Scope and conclusion

- **Finding closed:** projection, cold composition, Agent resolution and the resident Graph server Agent directory now consume `facts`, `revision` and `compatibilityManifest` from the same committed snapshot boundary.
- **Preserved fallback:** standalone/custom legacy adapters without `readCommittedSnapshot()` retain their existing baseline plus manifest path. The formal runtime uses the authoritative seam exposed by `createLegacyWorldService()`.
- **Excluded:** I1 cache recovery and I3 legacy prepared cutover were implemented by their own owners. This change does not edit persistence, the commit coordinator, production data, main, generated bundles, `AGENTS.md` or stash state.

## Root cause and RED

- `legacy-projection-orchestrator.mjs` independently read the latest manifest and `atom.json`. A committed local record newer than the baseline was therefore absent from Graph and Spatial after a cold start.
- `resolveAgentContext()` and `primeAgentDirectory()` independently read the same stale baseline, so an Agent activated by the committed local record remained `AGENT_TYPE_REQUIRED` or `AGENT_NOT_FOUND`.
- A real new Node process over `baseline=old + committed local log=new` reproduced `projectionStatus=pending` and `AGENT_TYPE_REQUIRED` while World Service initialization returned the new revision.
- Tuple-specific REDs reproduced `STALE_WORLD_PROJECTION` for both null and versioned manifests. The same error reproduced when an un-compacted rollback was newer than a compacted baseline and when a post-generation commit was newer than a Windows-frozen baseline.

## Minimal implementation

- `createLegacyProjectionOrchestrator()` accepts an optional `committedSnapshotProvider`; when present it reads the tuple once, verifies the revision, and routes it through the existing committed-snapshot context reader so legacy compatibility metadata remains attached.
- `createLegacyRuntimeComposition()` connects the World Service snapshot seam to both projection and Agent resolution. Agent cache identity now includes the committed revision as well as manifest and security revisions.
- `resolveAgentContext()` and `primeAgentDirectory()` accept the committed tuple and use the existing `readAtomContext(..., { committedSnapshot })` path after checking its revision.
- `startAtomGraphServer()` uses the same committed tuple for HTTP Agent resolution and startup directory priming. No new state source, polling loop or baseline repair path was added.

## GREEN and affected chain

- **Core I2 cases:** `6/6 PASS` — null manifest, versioned manifest with retained legacy relation metadata, true new-process local-log startup, local rollback, and Windows frozen-baseline generation.
- **Composition:** `32/32 PASS` including both real cold-process journeys.
- **Same product revision affected chain:** CLI/Graph server/Program projection/projection pipeline `78/78 PASS`; together with composition, `110/110 PASS`, zero fail/skip.
- **Static checks:** Node syntax checks for all four modified production modules and the cold-process fixture passed; selected `git diff --check` passed with only the repository's existing LF-to-CRLF notices.

## Evidence boundary

- The cold-process tests assert initialization, Graph, Spatial, exact Explore and Agent resolution all observe the same new local fact.
- The versioned cold-process test additionally proves the legacy Strut compatibility relation survives with the committed manifest.
- The rollback test leaves a newer compacted baseline on disk and places the inverse in the local log, proving projection follows committed authority rather than whichever complete JSON file is newest.
- The Windows test creates an `EPERM` directory-sync generation, appends a later local commit and proves projection reads the later committed fact after repository restart.
