## 1. Local Read Path

- [x] 1.1 Add failing service tests proving unchanged `explore` does not replace or persist spatial knowledge
- [x] 1.2 Add failing concurrency and revision-cache tests for two reads against one immutable snapshot
- [x] 1.3 Implement intent-aware read/write scheduling and change-driven projection publication
- [x] 1.4 Implement revision-bound world/query/Program preparation reuse and verify CLI/Web compatibility

## 2. Incremental Transaction History

- [x] 2.1 Add failing repository tests for bounded append writes, content-addressed snapshots, and duplicate-command handling
- [x] 2.2 Add failing recovery and rollback tests spanning legacy and incremental journal records
- [x] 2.3 Implement the append event log, compressed snapshot object store, fsync, and incomplete-tail recovery
- [x] 2.4 Integrate dual-read history without modifying the existing monolithic journal

## 3. Event-Local Programs

- [x] 3.1 Add failing large-world tests proving unmatched triggers reuse revision preparation and launch no workers
- [x] 3.2 Reuse revision Program indexes and remove redundant whole-world fingerprints from cached and triggered paths
- [x] 3.3 Apply matched non-structural effects through one prepared exact index and preserve structural fallback

## 4. Production Verification

- [x] 4.1 Run focused CLI, Web, Program, transaction, recovery, rollback, and performance tests
- [x] 4.2 Run the complete test suite and OpenSpec strict validation
- [x] 4.3 Benchmark the live 10k-node read path without modifying business data and document the before/after evidence
- [x] 4.4 Commit and push the verified change while excluding the pre-existing `AGENTS.md` modification
