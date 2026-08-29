## Context

See `proposal.md` for motivation and `specs/night-watch-acceptance/spec.md` for behavior. Atom already has public CLI, isolated runtime fixtures, targeted acceptance scripts, browser journeys, private-mobile gateway checks, and transaction/restart evidence, but no single operator flow proves their ordered delivery relationship.

## Goals / Non-Goals

**Goals:**

- Drive real commands through the PATH-resolved `atom.cmd` contract with one exact test Agent.
- Keep the acceptance journey external to the kernel and use small synthetic facts below `🧊manage/工务/work/test/<run-id>` without adding a top-level Atom beyond the approved `🧊manage` and default backup warehouse set.
- Produce one ordered, resumable, redacted report and always restore service health.
- Make the required capability set explicit so a large test count cannot hide a missing journey.

**Non-Goals:**

- Load, scale, soak, or many-work-order testing.
- Encoding slot, work-order, ESG, or other application semantics into runtime production modules.
- Reading or copying business-world content into fixtures or reports.
- Changing authentication, authorization, persistence authority, Funnel, or first-Agent bootstrap.

## Decisions

### External manifest and runner

Implement night-watch as a `scripts/` runner plus a versioned manifest. The runner owns ordering, dependency checks, evidence, checkpointing, and process cleanup; capability behavior stays in the existing public CLI and application Programs. This is preferred over a kernel `night_watch()` function because acceptance orchestration is not an Atom fact or permission primitive.

### CLI-first live lane plus isolated supporting lanes

The main lane invokes `atom.cmd --help`, resolves one exact authorized Agent, and performs the live synthetic journey with CLI stdin to avoid shell quoting. Browser and mobile-entry checks remain supporting steps because they cannot be expressed as Atom Language commands. Existing targeted test modules may supply deterministic negative cases, but their pass result cannot replace the live CLI positive path.

### Versioned capability manifest and scenario catalog

Each required step has an id, capability, dependencies, mutation class, command kind, timeout, and evidence policy. A separate external catalog maps each capability to its explicit stable required case IDs and declares concrete public prerequisites, operation, expected and negative assertions, read-back, evidence policy, IssueNode/TestCase reference, and pending state. The runner validates both documents before any live action and rejects missing or duplicate case IDs, incomplete contracts, mismapped capabilities, manifest duplicates, missing dependencies, cycles, or a capability set that differs from the required night-watch version. It never manufactures cases from a generic capability/category matrix.

### Desensitized BusinessCase projection

`BC-ESG-ACTIVITY-001@v1` is modeled in a separate external application-side catalog, not in `work-engine/`. The catalog carries only the approved synthetic shapes, minimal context, declared prohibited reads, four-gate expected states, and bounded steps for its five named scenarios. Issue #3 owns those business scenario TestCase/Evidence triples and their Structure/Quantity/Conservation/Semantic conclusions. Issue #10 owns only explicitly named mechanism TestCase/Evidence triples for Explore, Transform, Program, Form, slot isolation, jump, authorization, cold start, and CLI/Web parity; it cannot be used to infer or promote the Issue #3 business gates. All evidence starts `pending`; pending SemanticGate is a declared business outcome only when PENDING-03 returns the precise missing fact and refuses role selection. RESUME-05 marks its immutable conservation evidence so its re-computation boundary is testable.

### Authority receipt before live mutation

The run consumes a local authority receipt naming the allowed Agent, the exact `🧊manage/工务/work/test/<run-id>` domain, synthetic cleanup policy, restart scope, GitHub publication scope, expiry, and issuer. The receipt authorizes actions but contains no credentials. Missing authority blocks only the affected step and prevents an unattended run from expanding its own scope.

### Checkpointed report without payloads

Write append-safe JSON evidence under an ignored local runtime directory. Evidence records hashes, revisions, error codes, timing, and bounded summaries; it never stores CLI command bodies, Program source, Atom details, identities beyond the approved Agent path, or business facts. Resume rechecks health, manifest version, Agent path, and last committed synthetic coordinates before continuing.

### Command readiness after cold start

Treat HTTP health and command readiness as separate observations. After a bounded restart, the runner waits for health and then proves the first public Agent command before allowing dependent steps. The readiness probe must preserve required Agent-context lock compilation while preventing isolated failures from leaking into unrelated commands. Every restart adapter restores the runtime in `finally`, including timeout, assertion, and operator-interruption paths.

### Issue-rooted status projection

Keep the delivery-control source external to Atom: its sole root is Issue #1 (`https://github.com/open-worker-2077/atom/issues/1`), with concrete Issues as child instance nodes. Each instance maps to requirement, test-case, and evidence nodes; the root alone aggregates delivery gates. A pure generator renders the graph as redacted GitHub Markdown, preserves individual status rather than aggregating counts, and returns the first node not in a closed state. Real-device acceptance is a distinct `pending-user-acceptance` node; local gateway, viewport/control-panel, and entry-recovery evidence do not silently promote it, but also do not block unrelated local nodes.

Evidence attachments are separate only in storage, not in control. The external schema models a stable `IssueNode ID ↔ TestCase ID ↔ Evidence ID` triple: each Issue instance points to its own test cases and evidence; each test case points back to exactly one owning Issue and its evidence; every evidence attachment points back to both and declares per-node proof. The root renders the full projection, while a requested instance renders a managed backlink block to #1 plus only its own mappings. Evidence carries run id, candidate commit and version, timestamp, scope, redacted command classification, result, and validity. The generator cross-validates both directions, excludes unmapped attachments and information, and derives each gate from all required node states and mapped evidence validity. A missing, stale, mismatched, inconclusive, or one-sided reference yields `revalidation-required`; no prose summary can override that computation.

## Risks / Trade-offs

- **Shared-runtime test writes could interfere with use** → use one unique subtree below `🧊manage/工务/work/test`, expected revisions, and an explicit authority receipt; stop on any ambiguity.
- **Restart verification briefly interrupts users** → require separate restart authorization, bound the outage, keep gateways up, and restore service in `finally`.
- **A scripted runner can look like real use while bypassing UI** → require `atom.cmd` for the main fact path and retain separate Chromium/private-entry steps.
- **Application evolution can stale the manifest** → version the manifest and fail closed when required Help/registry contracts no longer match.
- **Reports could leak data** → whitelist evidence fields and test redaction with synthetic sentinel strings.

## Migration Plan

1. Add the manifest validator, authority receipt validator, report/checkpoint writer, and dry-run mode.
2. Add CLI-driven synthetic steps and supporting browser/mobile/restart adapters with focused tests.
3. Run dry-run locally, then run the authorized shared-runtime journey under `🧊manage/工务/work/test/<run-id>` and verify restart/read-back.
4. Add the package command and CI-safe dry-run contract; shared-runtime execution remains an explicit operator action.
5. Roll back by removing the package command and runner; generated evidence and synthetic test facts remain separately recoverable and are never silently deleted.
