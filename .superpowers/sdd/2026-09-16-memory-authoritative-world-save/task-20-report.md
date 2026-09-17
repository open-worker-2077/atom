# Task 20 — indexed memory Program recovery

- **Base/scope:** `edd4d33d9b369d69df9ca2e3f4e94bf481a46fcc`. Product change is confined to `memory-transaction-ports.mjs`; one focused test file was added. Root's two dirty plan/ledger files are excluded. No production/private-copy access, remote, full suite, deletion, new persisted format, endpoint or state source.
- **Result:** Direct index/history/capacity chain 39/39 GREEN; critical public Program/memory/lifecycle chain 66/66 GREEN. Synthetic operation counts remove the completed-history multiplier. This is not real-world latency or E3 acceptance; root owns the independently reviewed real-copy measurement.

## Boundary and implementation

- **Derived identities:** Source-by-interaction, first-child-by-source, original source ordinal and pending-source IDs are built in one receipt-order pass. Maps/Sets contain only IDs and ordinal numbers, never record or patch bodies. The existing accepted/durable maps remain the receipt lookup authority.
- **Incremental updates:** Accepted receipts update their source/child identities synchronously after acceptance and before callbacks. Outcome publication updates only that source's pending membership. A normal child derives completion as before; explicit hard-capacity pending overrides it. Initial/re-entering pending enumeration sorts only selected P IDs by original source ordinal, so hard pending re-entry cannot move an older source behind a newer one.
- **Clone boundary:** Internal execution decisions use a private assembled view. Public single-source/interaction reads and selected pending executions still receive `structuredClone` copies with unchanged fields and alias relationships. The child-derived return from outcome recording is explicitly cloned as well. Engine mutation of a returned event/child cannot mutate indexes, stored receipts, outcomes or another reader.
- **Save/history:** `markSaved` does not rebuild indexes: IDs remain valid while `receiptFor` changes its backing lookup from accepted records to durable metadata. Thus no index pins Task14 full bodies. Wrong/old ACK, A→B→A and save-versus-newer-accept cannot reorder identities. `findCommitted` and durable hydration are unchanged. Close admits no new receipts/outcomes and leaves existing readable indexes intact.
- **Complexity:** Startup O(N), new receipt/outcome maintenance O(1) expected Map/Set operations, public single-source lookup O(1) plus selected payload clone, enumeration O(P log P) plus selected payload clones. Previously enumeration rebuilt/mapped all N receipts for all S sources, then cloned all S executions before filtering.

## RED and operation evidence

All commands below ran in `D:/Project/〇/subprojects/atom/.worktrees/memory-authoritative-save` with `$env:ATOM_RUNTIME_BACKUP_REPO=''`. Test temporary writes used authorized escalation. The new index tests are in-memory; existing affected suites' synthetic fixture directories were retained. Content-free probes count getter visits to receipt metadata and calls to `structuredClone`. The byte column is UTF-8 JSON encoding of clone inputs, measured only inside the test; it is a reproducible payload-volume proxy, not actual V8 allocation/RSS and not native alias-deduplicated clone bytes. No instrumentation/stringification was added to the product hot path.

RED command: `node --test tests/atom-memory-program-index.test.mjs`

```text
ℹ tests 7
ℹ suites 0
ℹ pass 1
ℹ fail 6
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 208.932
```

Five genuine failures were completed-execution cloning (four N/P combinations) and unnecessary internal execution cloning. The sixth failure was a fixture missing snapshot `worldId`; corrected before implementation and not counted as a runtime defect. Baseline semantic command `node --test --test-name-pattern='first correlation|incremental pending' tests/atom-memory-program-index.test.mjs` then passed tests2/pass2/fail0/cancelled0/skipped0/todo0/suites0, duration123.1884ms against the unchanged product.

Measured totals for **two repeated pending enumerations**, after startup counters reset:

| N / S / P | Before receipt visits | Before clones | Before JSON-input B | After visits | After clones | After JSON-input B |
|---|---:|---:|---:|---:|---:|---:|
| 128 / 32 / 0 | 8,512 | 64 | 1,086,520 | 0 | 0 | 0 |
| 128 / 32 / 2 | 8,512 | 64 | 1,053,480 | 4 | 4 | 34,836 |
| 512 / 128 / 0 | 132,352 | 256 | 4,347,256 | 0 | 0 | 0 |
| 512 / 128 / 2 | 132,352 | 256 | 4,314,216 | 4 | 4 | 34,836 |

Original single-source + interaction + internal terminal decision probe: 2,049 receipt visits / 3 execution clones. Implemented probe without child: 3 visits / 2 public execution clones. The strengthened final probe includes an existing child: 6 visits / 2 public execution clones, and asserts correct child identity. Startup receipt visits are additionally bounded by 2N in each N/P test; the implemented projection itself reads each startup receipt once.

## GREEN verification

### Direct affected chain

```powershell
$env:ATOM_RUNTIME_BACKUP_REPO=''
node --test tests/atom-memory-program-index.test.mjs tests/atom-memory-transaction-ports.test.mjs tests/atom-memory-history-retention.test.mjs tests/atom-memory-save-capacity.test.mjs tests/atom-program-capacity-recovery.test.mjs
```

Exit0, final run after strengthening the child/startup assertions:

```text
ℹ tests 39
ℹ suites 0
ℹ pass 39
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 819.8041
```

Coverage: first correlation/child matching including child-before-source and effectsCommitted self-order; detached old readers; source→pending→child→hard pending→explicit final with original pending order; live-to-metadata demotion; wrong/old ACK and newer accepts; A→B→A; saved rollback/disjoint rebase hydration; exact capacity release; actual hard-pending worker save/restart; active-release coalescing; completed/failed-without-result real-engine replay; close rejection. Representative retained real-worker fixtures: `C:/Users/worker/AppData/Local/Temp/atom-save-capacity-CnvdDy` and `atom-memory-history-retention-D5JWBS`.

### Critical public Program / lifecycle journey

```powershell
$env:ATOM_RUNTIME_BACKUP_REPO=''
node --test tests/atom-memory-persistence-integration.test.mjs tests/atom-memory-authoritative-interaction.test.mjs tests/atom-world-service-contract.test.mjs tests/atom-writer-lifecycle.test.mjs tests/atom-world-shutdown.test.mjs
```

Exit0:

```text
ℹ tests 66
ℹ suites 0
ℹ pass 66
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3199.6013
```

Includes actual public Program source+child memory execution before save, owned old readers, blocked/failing saver, lost ACK and worker replacement, history recovery, newer acceptance during in-flight save, close/quarantine and snapshot atomic-link regressions. Representative retained fixtures: `atom-owned-real-memory-Z6OMdB`, `atom-writer-lifecycle-FPheYv`, `atom-world-shutdown-Zhk0vI` under `C:/Users/worker/AppData/Local/Temp/`. No unhandled rejection/runtime warning appeared. `git diff --check` passed with repository CRLF warnings only.

## Self-review / remaining scope

- Public execution shapes and exact receipt/outcome contents are untouched; no terminal result truncation, archive omission, disk index, hydration shortcut or new cleanup hook.
- First-match indexes intentionally do not overwrite earlier correlation/child identities. Pending status uses outcome and child presence without reading unrelated receipts. The sort compares only scalar ordinals, bounded by P rather than N/S.
- Full selected receipt/result clones can still be large. `latestReceipt`, transform-log projection and explicit `readState` retain their previous costs. This task removes the measured all-completed-history amplification, not every historical query cost or flatSHA validation cost.
- No product change followed final verification. Independent review and one root-owned real-copy timing remain required; tests and operation counts alone do not establish the full interaction latency target.
