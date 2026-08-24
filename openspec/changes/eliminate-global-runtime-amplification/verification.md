# Verification Evidence

## Automated verification

- `npm test`: 980 passed, 0 failed on 2026-08-24.
- `openspec validate eliminate-global-runtime-amplification --strict`: valid.
- Focused coverage includes unchanged/concurrent Explore, immutable revision and index reuse, Program trigger/effect performance, incremental history, recovery, rollback, CLI/Web compatibility, and work-order end-to-end transactions.

## Live primary-world read benchmark

- Scope: exact read of the existing `ESG计划` Atom through `atom.cmd --agent 🧊`; no business write was issued.
- Before: approximately 3.7–4.1 seconds per CLI read.
- After restart, first read: 444.5 ms.
- After restart, warm samples: 178.6, 182.6, 162.5, 183.2, 167.3, 186.1, 172.8 ms; median 177.7 ms.
- Two simultaneous resident-service reads: 155.8 ms total, both successful.
- `graph.json` modification time: unchanged across the benchmark.
- `knowledge.json` modification time: unchanged across the benchmark.
- 4784 health: healthy after the benchmark; no pending spatial projection.

The live result demonstrates that an unchanged local Explore no longer rebuilds or persists whole-world projections, and repeated CLI processes no longer reload the whole world merely to resolve the Agent selector.
