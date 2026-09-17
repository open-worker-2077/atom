# Task 15 — finite pending-save admission

- **Scope:** Implemented against `a9eea4080e8414e6c972527b4bd251249b97737e`. Root plan/ledger changes are excluded. No production, remote, full-suite, private-copy, backup-target or deletion operation was performed. All new synthetic fixtures are retained.
- **Result:** Atomic logical capacity reservations protect memory publication and Program outcomes. Final affected chain: 101 tests, 101 pass, 0 fail. Independent review remains the root's next gate.

## Implementation and invariants

- **Admission:** New owner-local `pending-world-capacity.mjs` defaults to `maxBytes: 536870912`, `maxEvents: 2048`, `maxEventBytes: 67108864`; configurable through persistence/legacy-service `pendingLimits`. Count and UTF-8 logical payload bytes are separate bounds. `journal.prepare` reserves the final record before inserting it; commit completes clone/measurement/reservation before `authority.accept`. A rejection cannot publish facts, advance version, create a receipt, or gate reads. Status adds content-free `capacity` limits/usage/reservations/pressure.
- **Release:** Reservation tokens travel with the owner's ordered events, not in worker payloads. Only the exact sequence prefix validated by the saver and `ports.markSaved` releases accepted tokens. Wrong acknowledgments, failed saves, repeated revisions and newer concurrent acceptance retain their evidence. Abort/close release unaccepted preparation/future-outcome slots; accepted evidence remains for final flush. Task14 saved-body demotion and Task11 close gates remain in place.
- **Programs:** Source preparation atomically reserves source + first-pending + final-outcome slots. Each outcome slot initially reserves the single-event maximum; actual recording shrinks it to measured bytes. Saving the source does not release the final slot. Repeated pending uses ordinary budget. Historical pending reserves incrementally, not during startup. Capacity failure remains pending; only an actual release schedules a coalesced recovery. Existing `activeInteractions`/`recoveringWorlds` stay authoritative; an active invocation gets one completion-triggered follow-up, and joining older recovery retains one follow-up request. Close unsubscribes/suppresses all such rearming.
- **Oversize:** Oversized outcome bodies are not retained by the adapter/ports outside accounting. A bounded, measured `pending` outcome with `capacityBlocked.code = WORLD_SAVE_EVENT_TOO_LARGE`, required/limit bytes and child identity is saved through the existing outcome path. It cannot auto-retry on release or become a child-derived synthetic completion. Explicit bounded final resolution remains possible. Ordinary capacity shortages retain automatic recovery and child idempotency.
- **Compatibility:** Root approved the necessary narrow journal/worker additions. `json-world-repository` does not synthesize completion over this explicit pending marker and does not overwrite it with another pending attempt; `durable-world-save-worker` does not skip that marker merely because a child currently yields derived completion. Existing receipts, hashes, schema/path layout, snapshot atomic-link publication, recovery proof, default disk writes and final-outcome semantics are unchanged. Older software that does not understand `capacityBlocked` does not gain this new honesty guarantee; no blanket old-reader guarantee is claimed for the new explicit state.

## Evidence: commands and original summaries

All commands ran in `D:/Project/〇/subprojects/atom/.worktrees/memory-authoritative-save`, with `$env:ATOM_RUNTIME_BACKUP_REPO=''` before Node. Temporary writes were authorized/escalated. The Node reporter used its native summary format below.

### RED: admission and source reservation

Command: `node --test tests/atom-memory-save-capacity.test.mjs`

Initial three tests failed with missing expected rejection (exit 1):

```text
ℹ tests 3
ℹ suites 0
ℹ pass 0
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 149.5459
```

The subsequent six-test stage had four pass/two fail (123.5755 ms): a pending outcome did not consume its reservation, and oversized child-associated outcome was incorrectly completed. After implementation, capacity + existing memory-port files passed 13/13 (170.0091 ms). One initial byte fixture was corrected because its first 3247-byte record exceeded the fixture's 3000-byte event cap; that invalid fixture failure was not counted as a runtime defect.

### RED: exact owner release and real restart

Command: `node --test --test-name-pattern='hard pending survives|owner retains capacity' tests/atom-memory-save-capacity.test.mjs`

```text
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 349.8927
```

Real worker restart returned child-derived `completed`; the owner also admitted a second event despite capacity. Narrow GREEN was 2/2 (510.3711 ms). During development, `WORLD_SAVE_OUTCOME_CONFLICT` exposed that the marker must retain the same childCommandId that the journal adds; this was corrected rather than weakening comparison. RED fixtures: `atom-save-capacity-H8kBcA`, `atom-save-capacity-waDsUJ`; final real restart fixture: `C:/Users/worker/AppData/Local/Temp/atom-save-capacity-m3Dzvm`.

### RED: adapter semantics

Command: `node --test tests/atom-program-capacity-recovery.test.mjs`

```text
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 243.6355
```

The adapter converted effects backpressure into business failure and returned an oversized final result as completed. Initial GREEN was 2/2 (239.7692 ms). The later close regression showed unused future slots remained counted (actual 3, expected 1); close now cancels only those slots. A restored-seed test initially used different arrays for sealing and initialSnapshot; the fixture was corrected to use the same sealed array, not a product change.

### RED/GREEN: release while invocation remains active

Command: `node --test --test-name-pattern='release during an active' tests/atom-program-capacity-recovery.test.mjs`

With the completion rearm hook removed, the corrected isolated race oracle failed (exit 1):

```text
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2195.8045
```

It retained pending forever after the release had skipped the active interaction. Fixture: `C:/Users/worker/AppData/Local/Temp/atom-program-capacity-cTzoM3`. This oracle injects one classified pressure error with spare eventual capacity; the earlier three-slot variant also encountered legitimate pressure from repeated pending and was refined to isolate the notification race. Restoring the hook yielded the five-case Program chain 5/5 (260.5689 ms); final verification below rechecks the restored source.

### Final direct affected chain

```powershell
$env:ATOM_RUNTIME_BACKUP_REPO=''
node --test tests/atom-memory-save-capacity.test.mjs tests/atom-program-capacity-recovery.test.mjs tests/atom-memory-transaction-ports.test.mjs tests/atom-memory-history-retention.test.mjs tests/atom-world-shutdown.test.mjs tests/atom-world-service-contract.test.mjs tests/atom-memory-authoritative-interaction.test.mjs tests/atom-memory-persistence-integration.test.mjs tests/atom-independent-world-saver.test.mjs tests/atom-writer-lifecycle.test.mjs
```

Exit 0:

```text
ℹ tests 101
ℹ suites 0
ℹ pass 101
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3036.2364
```

Includes 17 new cases plus existing sealed-candidate transfer, saved-body hydration/rebase/rollback, source+child memory execution, failed/wrong/lost-ACK replay, dead-worker replacement, closing/publication/quarantine and atomic snapshot-link regressions. No unhandled rejection appeared. Final Program fixtures include `atom-program-capacity-lE9OBJ`, `Lw090E`, `5xaraU`, `YsLt1T`, `ZL5yGX`, `Ib5gey` under the retained temporary directory family. `git diff --check` passed; only repository CRLF-normalization warnings were emitted. The only post-verification runtime edit was indentation of two status fields.

## Self-review and boundaries

- **Accounting:** Bytes are logical ordered evidence, not heap/RSS: object overhead, current authority, metadata history, transient engine candidates and worker copies are outside this quota. Local events measure local evidence only. Full snapshots reuse cached sealed serialization; the focused test checks exact UTF-8 equivalence and prevents a second full-world serialization. No arbitrary accepted-body eviction or full-world serialization was added for local edits.
- **Safety:** Rejected preparation does not enqueue; accepted callbacks cannot reject capacity. Release notification exceptions are absorbed after state transitions, and owner callbacks run later in a microtask. WeakSet completion joining cannot accumulate duplicate waiters for an active invocation. No timer-based full-capacity retry loop was introduced.
- **Configuration:** A budget too small for source plus two maximum outcome reservations intentionally rejects the new source before acceptance. Raising limits/configuring an explicit bounded final outcome is an engineering/operational resolution for hard oversize; no automatic shortened terminal result or spill store is offered. Existing owners retain the configuration of their first facade, consistent with existing owner composition.
- **Remaining limits:** Metadata history growth and startup historical replay are separate from unsaved capacity. This change does not claim a physical-memory cap, eliminate flatSHA CPU, or solve oversized arbitrary business results. An exceptionally tiny single-event cap can also be too small for the compact diagnostic; it remains a capacity rejection, not permission to accept an unaccounted body. Real-scale/performance and rollout gates remain root-owned.
