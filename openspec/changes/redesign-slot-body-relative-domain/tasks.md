## 1. Existing Foundation at cdc763d

- [x] 1.1 Establish the common-baseline test result and run impact analysis before editing shared runtime, query, scheduler and Help symbols.
- [x] 1.2 Replace the physical `空槽例` layout with candidate DataFlow seal, a visible deterministic `print@program`, stable role/revision evidence and direct instance printing.
- [x] 1.3 Implement strict `.`／`./…` selectors, runtime-owned development and instance scopes, nested-domain rejection and inherited `use_program()` scope.
- [x] 1.4 Route one mapped instance event through only its revision-local support plan, deduplicate shared Programs and preserve exact Explore/unrelated-Program isolation.
- [x] 1.5 Commit the initial implementation locally as `cdc763d` without push or merge.

## 2. Formal v1 Contract Correction

- [x] 2.1 Revise proposal, four delta specs, design and tasks to define abstract mapped slots, contract-only `detail`／`situation`, unmapped local material Thing subtrees, one-call reseal and outside-variable local materialization.
- [x] 2.2 Add red tests proving slot contract metadata never becomes material, the visible plan has no `default_detail`, and a newly printed instance contains no material Thing.
- [x] 2.3 Add red tests with two instances containing distinct nested material subtrees; capture and compare complete material Graph bytes before and after slot rename/move/add/support reseal.
- [x] 2.4 Add red tests proving an added slot appears everywhere, deletion of an empty slot succeeds, and deletion of any slot containing local material returns `SLOT_MATERIAL_CONTAINMENT_CONFLICT` with exact paths and whole-transaction rollback.
- [x] 2.5 Add red Help, registry, Program-validation and runtime tests proving `limit`, `cursor`, `next_cursor` and related continuation errors are absent or rejected.
- [x] 2.6 Add a red integration test in which outside orchestration materializes a variable as an unmapped local Thing and a subsequent mapped-slot event triggers only that instance.

## 3. Implementation

- [x] 3.1 Replace `default_detail` with explicit slot-contract metadata in canonical plans and printers; never synthesize material nodes or copy shared Program nodes.
- [x] 3.2 Replace three-way detail merging and customized-role detachment with stable mapped-slot synchronization plus byte-preserving detach/reattach of opaque unmapped material subtrees.
- [x] 3.3 Detect material below deleted mapped roles, return exact `SLOT_MATERIAL_CONTAINMENT_CONFLICT`, and preserve candidate-world atomic rollback.
- [x] 3.4 Remove public and internal reseal batching inputs, cursors, continuation receipts, registry entries, Help text and obsolete error codes; make one `seal` process all body instances.
- [x] 3.5 Keep normal support events instance-local, preserve Program de-duplication and scope rejection, and support local-variable material reads solely through existing `./` resolution.

## 4. Automated Verification

- [x] 4.1 Run focused slot plan, reseal, scoped Program, integration, scheduler, registry and Help tests; record red-to-green evidence for each corrected contract.
- [x] 4.2 Run the complete automated suite and record totals; do not treat focused or partial passing tests as delivery.
- [x] 4.3 Run strict OpenSpec validation and scan runtime, Help, registry, specs and tests for forbidden default-material and batch-cursor contract remnants.
- [x] 4.4 Run GitNexus change detection against the common baseline, independently review the diff against every requirement, and resolve all in-scope findings.
- [x] 4.5 Create a new follow-up local commit on top of `cdc763d`, containing only authorized source, tests and OpenSpec artifacts; do not push or merge.

## 5. External Delivery Gates

- [ ] 5.1 Total control schedules a real user-task trial with real ESG activity material in Atom `test`, proving positive seal/print/local-material/trigger/reseal/readback and negative material-conflict/over-scope cases without modifying ESG files or formal nodes.
- [ ] 5.2 A human reviewer audits the visible plan, no-default-material evidence, per-instance revision evidence, byte-preserved material, Help-only workflow and real-trial evidence; unresolved findings return to implementation.
- [ ] 5.3 Total control merges both local commits with `feature/graph-four-axis-support`, resolves only the contain/support adapter seam, and reruns combined automated and exclusive 4784 acceptance.
- [ ] 5.4 Total control pushes only after merge, human review and real-use gates pass; until then OpenSpec remains incomplete and no local result may be presented as final delivery.
