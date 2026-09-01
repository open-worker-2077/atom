# Atom Agent as Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Remove Agent from Atom Key semantics and make every active Agent a normal thing@program whose source contains exactly one top-level literal agent({...}) declaration, using Program's ordinary execution, authorization, transaction, timeout, and receipt paths.

**Architecture:** The Python Program validator remains the only parser for agent({...}) declarations. ProgramRuntimeScheduler derives the Agent registry from every active Program source at a bound world revision; all runtime, CLI, admin, lock, jump, and delegation decisions consume that derived registry instead of reading an agent Key type. A revision-bound maintenance migration converts active legacy Agents, demotes archived legacy Agents, verifies a private backup, commits atomically, and supports receipt-driven rollback.

**Tech Stack:** Node.js 24, ECMAScript modules, node:test, Python 3 isolated Program worker, JSON world persistence, GitNexus, official Superpowers 6.3.0 workflow.

**Spec:** docs/superpowers/specs/2026-08-31-atom-agent-authorization-design.md, with docs/superpowers/specs/2026-08-31-atom-world-program-design.md and docs/superpowers/specs/2026-08-31-atom-acceptance-operations-design.md

## Global Constraints

- Agent is never a Key type or label. thing@agent, thing@program@agent, and every other Key containing @agent are retired.
- The sole active Agent representation is thing@program with exactly one statically recognizable top-level literal agent({...}) declaration.
- A Program without agent({...}) remains an ordinary Program; a valid declaration makes that same Program an Agent Program.
- Agent construction, context resolution, dispatch, composition, authorization, revision binding, timeout, transaction, and receipt recovery use normal Program paths. No Agent-only execution bypass is allowed.
- Program-to-Program dispatch continues through use_program; an Agent Program is dispatchable because it is a Program, not because it owns a separate runtime type.
- Active legacy Agent content is preserved during upgrade. Archived legacy Agents become inactive ordinary recoverable facts and cannot grant authority.
- Key parsing may expose retired structure only through an explicit maintenance option; every ordinary parse and public runtime path fails with RETIRED_AGENT_KEY_TYPE.
- Sidecar registration snapshots and Session memory never become authority.
- Zero-Agent genesis remains the separately specified future capability from Issue 14 and is not implemented here.
- Real Atom worlds, business text, credentials, and private backup paths are never committed.
- Official Superpowers 6.3.0 files remain read-only; this plan modifies only Atom product and project files.
- Every symbol edit starts with GitNexus impact analysis. HIGH or CRITICAL results are reported before code changes, and detect_changes runs before every commit.
- Execution occurs in a Superpowers-created isolated worktree. Commits are local; no push, pull request, release, or deployment outside the configured local Atom world is authorized.

## File Map

- work-engine/atom-language/key-parser.mjs: default retired-Key rejection plus a maintenance-only read option.
- work-engine/atom-language/program-worker.py: static literal declaration validation; agent() no longer emits a registration mutation.
- work-engine/atom-language/program-runtime.mjs: revision-bound Agent Program discovery, security derivation, dispatch ownership, lock and jump consumption.
- work-engine/atom-language/engine.mjs: candidate-world Agent declaration delegation checks and removal of Key mutation.
- work-engine/atom-language/window-lock-v1.mjs: label/function delegation only; no registration writer.
- src/atom-system/adapters/transactional-world-persistence.mjs: semantic-neutral transaction persistence.
- work-engine/atom-language/cli.mjs, admin.mjs, graph-server.mjs: resolve and issue sessions from derived Agent Program paths.
- src/atom-system/operations/agent-program-migration.mjs: pure plan, verified apply, and rollback contract.
- scripts/deploy-agent-program-world.mjs: dry-run, apply, postcheck, and rollback operator entry.
- tests/atom-agent-key-retirement.test.mjs: Key rejection contract.
- tests/atom-agent-program-runtime.test.mjs: source-derived identity and Program dispatch contract.
- tests/atom-agent-program-migration.test.mjs: active upgrade, archived demotion, backup, atomicity, and rollback.
- tests/atom-agent-program-source-boundary.test.mjs: repository-wide prevention of active @agent Key semantics.

---

### Task 1: Add a Maintenance-Readable Agent Key Retirement Diagnostic

**Files:**
- Modify: work-engine/atom-language/key-parser.mjs
- Create: tests/atom-agent-key-retirement.test.mjs

**Interfaces:**
- Consumes: parseAtomKey(rawKey, options).
- Produces: diagnostic RETIRED_AGENT_KEY_TYPE when allowRetiredAgentKey is false; maintenance callers pass allowRetiredAgentKey: true and still receive parsed type metadata. Task 7 flips ordinary parsing to the final reject-by-default behavior after active fixtures have migrated.

- [ ] **Step 1: Run GitNexus impact for parseAtomKey**

Call:

    impact({
      target: "parseAtomKey",
      file_path: "work-engine/atom-language/key-parser.mjs",
      direction: "upstream",
      includeTests: true,
      summaryOnly: true,
      repo: "D:\\Project\\〇\\subprojects\\atom"
    })

Expected: record direct callers, affected processes, and risk before editing. Warn the user before continuing if the result is HIGH or CRITICAL.

- [ ] **Step 2: Write the failing Key retirement tests**

Create tests/atom-agent-key-retirement.test.mjs:

    import test from 'node:test';
    import assert from 'node:assert/strict';

    import { parseAtomKey } from '../work-engine/atom-language/key-parser.mjs';

    test('strict Agent Program parsing rejects Agent as a type', () => {
      for (const rawKey of ['thing@agent', 'thing@program@agent', 'thing@agent@program#legacy']) {
        const parsed = parseAtomKey(rawKey, { allowRetiredAgentKey: false });
        assert.equal(parsed.errors.find((error) => error.code === 'RETIRED_AGENT_KEY_TYPE')?.details.rawKey, rawKey);
      }
      assert.deepEqual(parseAtomKey('thing@program').errors, []);
    });

    test('maintenance parsing exposes legacy structure without making it valid at runtime', () => {
      const parsed = parseAtomKey('thing@program@agent#legacy', {
        allowRetiredAgentKey: true,
        descriptionSymbolWarnings: false
      });
      assert.deepEqual(parsed.errors, []);
      assert.deepEqual(parsed.types.map((type) => type.raw), ['program', 'agent']);
      assert.equal(parsed.description, 'legacy');
    });

- [ ] **Step 3: Run the test and observe missing retirement diagnostics**

Run:

    node --test tests/atom-agent-key-retirement.test.mjs

Expected: FAIL because the parser does not yet expose the retirement diagnostic.

- [ ] **Step 4: Add the default retired-Key diagnostic after type parsing**

Add this rule in parseAtomKey after the sections have populated types:

    if (baseKey === 'thing'
      && options.allowRetiredAgentKey === false
      && types.some((type) => type.raw === 'agent')) {
      errors.push(diagnostic(
        'RETIRED_AGENT_KEY_TYPE',
        'Agent 不再是 Key 类型；请使用包含一个顶层字面量 agent({...}) 的 thing@program',
        { rawKey, replacement: 'thing@program with one literal agent({...}) declaration' }
      ));
    }

Do not remove the parsed type entry; the maintenance migration needs to identify the retired structure explicitly. This temporary opt-in diagnostic keeps the existing suite readable while Tasks 2–6 replace every consumer; Task 7 changes the condition to options.allowRetiredAgentKey !== true.

- [ ] **Step 5: Run parser and world-law tests**

Run:

    node --test tests/atom-agent-key-retirement.test.mjs tests/atom-world-laws.test.mjs

Expected: PASS without changing ordinary runtime behavior before its consumers and fixtures are migrated.

- [ ] **Step 6: Inspect and commit the parser boundary**

Call:

    detect_changes({ scope: "unstaged" })

Run:

    git diff --check
    git add work-engine/atom-language/key-parser.mjs tests/atom-agent-key-retirement.test.mjs
    git commit -m "feat: retire Agent Key semantics"

Expected: the commit changes only parser behavior and its focused contract test.

---

### Task 2: Derive Agent Identity From Program Source

**Files:**
- Modify: work-engine/atom-language/program-worker.py
- Modify: work-engine/atom-language/program-runtime.mjs
- Create: tests/atom-agent-program-runtime.test.mjs
- Modify: tests/atom-agent-symbolic-security.test.mjs
- Modify: tests/atom-program-function-registry.test.mjs

**Interfaces:**
- Consumes: active programRecords and Python validate-only output.
- Produces: ProgramRuntimeScheduler.deriveAgentSecurity(atoms) returning Map<programPath, AgentSecurity>; rebuildAgentSecurity(atoms) caches that map by the fingerprint of all active Program source definitions; inspectAgentRegistration(atoms, selector) validates one thing@program source.
- AgentSecurity shape: labels: string[], functionScopes: { groups: string[], names: string[] }, functions: string[].

- [ ] **Step 1: Re-run exact GitNexus impact on the high-risk scheduler method**

Call with the indexed UID:

    impact({
      target_uid: "Method:work-engine/atom-language/program-runtime.mjs:ProgramRuntimeScheduler.rebuildAgentSecurity#1",
      target: "rebuildAgentSecurity",
      direction: "upstream",
      includeTests: true,
      summaryOnly: true,
      repo: "D:\\Project\\〇\\subprojects\\atom"
    })

Expected: HIGH risk with refresh, current, and computeRefresh affected. Read every depth-1 caller before editing and report any difference from this plan.

- [ ] **Step 2: Write failing source-derived registry tests**

Create tests/atom-agent-program-runtime.test.mjs with this fixture and assertions:

    import test from 'node:test';
    import assert from 'node:assert/strict';

    import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

    function atom(key, name, situation = '', slot = []) {
      return { [key]: name, situation, slot, strut: [] };
    }

    const agentSource = [
      'agent({"labels":["^"],"functions":{"groups":[],"names":["explore","use_program"]}})',
      'def main(arguments):',
      '    return arguments'
    ].join('\n');

    test('Agent registry is derived from literal declarations on ordinary Programs', async () => {
      const scheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });
      const world = [
        atom('thing@program', 'AgentProgram', agentSource),
        atom('thing@program', 'OrdinaryProgram', 'value = 1')
      ];
      const security = await scheduler.deriveAgentSecurity(world);
      assert.deepEqual([...security.keys()], ['AgentProgram']);
      assert.deepEqual(security.get('AgentProgram'), {
        labels: ['^'],
        functionScopes: { groups: [], names: ['explore', 'use_program'] },
        functions: ['explore', 'use_program']
      });
      assert.equal(world[0]['thing@program'], 'AgentProgram');
      assert.equal(Object.keys(world[0]).some((key) => key.includes('@agent')), false);
    });

    test('ordinary Programs stay ordinary and nonliteral Agent declarations fail closed', async () => {
      const scheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });
      assert.deepEqual(
        [...(await scheduler.deriveAgentSecurity([
          atom('thing@program', 'Ordinary', 'value = 1')
        ])).keys()],
        []
      );
      await assert.rejects(
        scheduler.deriveAgentSecurity([
          atom('thing@program', 'Dynamic', 'spec = {"functions":{"groups":[],"names":["explore"]}}\nagent(spec)')
        ]),
        (error) => error.code === 'AGENT_REGISTRATION_LITERAL_REQUIRED'
      );
    });

    test('executing an Agent Program does not emit a registration mutation', async () => {
      const scheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });
      const result = await scheduler.refresh([
        atom('thing@program', 'AgentProgram', agentSource)
      ], { programSelector: 'AgentProgram', isolateFailures: false });
      assert.deepEqual(result.agentRegistrations, []);
      assert.equal(scheduler.agentSecurity.get('AgentProgram').functions.includes('explore'), true);
    });

- [ ] **Step 3: Run the focused tests and observe Key-derived behavior**

Run:

    node --test tests/atom-agent-program-runtime.test.mjs tests/atom-agent-symbolic-security.test.mjs

Expected: FAIL because rebuildAgentSecurity filters Program Keys by agent type and deriveAgentSecurity does not yet exist.

- [ ] **Step 4: Make agent() declarative during normal execution**

In program-worker.py replace the runtime agent implementation with:

    def agent(specification):
        try:
            declaration = validate_agent_specification(require_object(specification, "agent"))
        except TypeError as error:
            raise EngineCallError("INVALID_AGENT_REGISTRATION", str(error)) from error
        return {
            "declared": True,
            "path": current_atom().path,
            "labels": declaration["labels"],
            "functionScopes": declaration["functionScopes"],
            "functions": declaration["functions"],
        }

Keep extract_agent_declaration as the sole static parser. Keep validate-only output as one agents entry when and only when the source contains the one legal declaration. Normal execution must leave effects["agents"] empty.

- [ ] **Step 5: Implement uncached derivation and all-Program fingerprinting**

Change agentSecurityFingerprint to:

    function agentSecurityFingerprint(programs) {
      return sourceDefinitionFingerprint(programs);
    }

Add this method before rebuildAgentSecurity:

    async deriveAgentSecurity(atoms) {
      const records = worldRecords(atoms);
      const programs = programRecords(records);
      const inspected = await Promise.all(programs.map((program) => (
        this.runBounded(() => this.inspectProgram({
          python: this.python,
          records,
          programs: [program],
          program,
          timeoutMs: this.timeoutMs,
          executeExplore: async () => {
            throw Object.assign(
              new Error('Agent declaration inspection cannot execute Graph functions'),
              { code: 'INVALID_AGENT_REGISTRATION_RECONSTRUCTION_EFFECT' }
            );
          },
          validateOnly: true
        }))
      )));
      const derived = new Map();
      for (const [index, program] of programs.entries()) {
        const declarations = inspected[index].agentRegistrations ?? [];
        if (declarations.length === 0) continue;
        if (declarations.length !== 1) {
          throw Object.assign(
            new Error('Agent Program requires exactly one literal agent() declaration: ' + program.path),
            { code: 'AGENT_REGISTRATION_SOURCE_REQUIRED' }
          );
        }
        const declaration = declarations[0];
        derived.set(program.path, {
          labels: [...declaration.labels],
          functionScopes: structuredClone(declaration.functionScopes),
          functions: [...declaration.functions]
        });
      }
      return derived;
    }

Make rebuildAgentSecurity fingerprint every active Program, call deriveAgentSecurity, assign the returned map, and bind the fingerprint. Make inspectAgentRegistration require only an existing Program and exactly one literal declaration; remove every types.includes('agent') precondition.

- [ ] **Step 6: Permit agent() only for source-derived Agent Programs**

Replace runtime checks that add the agent Program function from a Key type with:

    const isAgentProgram = this.agentSecurity.has(program.path);
    const allowed = this.agentSecurity.get(agentScopePath(options.agentOrigin))?.functions ?? null;
    const allowedFunctions = !allowed || !isAgentProgram
      ? allowed
      : [...new Set([...allowed, 'agent'])];

Normalize agentRegistrations to an empty array whenever isAgentProgram is true. Do not call a registration mutator.

- [ ] **Step 7: Run registry tests**

Run:

    node --test tests/atom-agent-program-runtime.test.mjs tests/atom-agent-symbolic-security.test.mjs tests/atom-program-function-registry.test.mjs tests/atom-program-runtime-scheduling.test.mjs

Expected: PASS for declaration extraction, ordinary Program exclusion, source fingerprint refresh, and zero registration mutation.

- [ ] **Step 8: Inspect and commit source-derived identity**

Call:

    detect_changes({ scope: "unstaged" })

Run:

    git diff --check
    git add work-engine/atom-language/program-worker.py work-engine/atom-language/program-runtime.mjs tests/atom-agent-program-runtime.test.mjs tests/atom-agent-symbolic-security.test.mjs tests/atom-program-function-registry.test.mjs
    git commit -m "feat: derive Agents from Program declarations"

Expected: the diff contains no Key mutation and no new Agent registry sidecar.

---

### Task 3: Make Program Dispatch, Ownership, Locks, and Jump Use the Derived Registry

**Files:**
- Modify: work-engine/atom-language/program-runtime.mjs
- Modify: src/atom-system/public/request-driven-lock-contract.mjs
- Modify: tests/atom-program-runtime-scheduling.test.mjs
- Modify: tests/atom-program-lock-source-authority.test.mjs
- Modify: tests/atom-window-aware-program-locks.test.mjs
- Modify: tests/atom-window-controlled-jump-authorization.test.mjs
- Modify: tests/atom-legacy-runtime-composition.test.mjs
- Modify: tests/atom-agent-program-runtime.test.mjs

**Interfaces:**
- Consumes: ProgramRuntimeScheduler.agentSecurity Map and ordinary use_program dispatch.
- Produces: owningAgentPath(program, recordsByRef, agentProgramPaths); validateProgramResult receives agentProgramPaths; every allowed-window and jump check asks the derived registry.

- [ ] **Step 1: Write failing Program-dispatch and ownership tests**

Add to tests/atom-agent-program-runtime.test.mjs:

    test('an Agent Program dispatches another Agent Program through use_program', async () => {
      const scheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });
      const child = [
        'agent({"labels":[],"functions":{"groups":[],"names":["agent"]}})',
        'def main(arguments):',
        '    return {"value": arguments["value"] + "-child"}'
      ].join('\n');
      const parent = [
        'agent({"labels":[],"functions":{"groups":[],"names":["agent","message","use_program"]}})',
        'result = use_program({"name":"Parent/Child","arguments":{"value":"program"}})',
        'message({"level":"info","text":result["value"]})'
      ].join('\n');
      const world = [atom('thing@program', 'Parent', parent, [
        atom('thing@program', 'Child', child)
      ])];
      await scheduler.rebuildAgentSecurity(world);
      const cycle = await scheduler.refresh(world, {
        programSelector: 'Parent',
        isolateFailures: false
      });
      assert.deepEqual(cycle.failures, []);
      assert.deepEqual(cycle.messages.map((message) => message.text), ['program-child']);
    });

    test('Agent ownership follows the nearest declared Program, not a Key type', async () => {
      const scheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });
      const world = [atom('thing@program', 'Window', agentSource, [
        atom('thing@program', 'Worker', 'value = 1')
      ])];
      await scheduler.rebuildAgentSecurity(world);
      assert.equal(scheduler.agentSecurity.has('Window'), true);
      assert.equal(scheduler.agentSecurity.has('Window/Worker'), false);
    });

- [ ] **Step 2: Run the affected runtime tests**

Run:

    node --test tests/atom-agent-program-runtime.test.mjs tests/atom-program-lock-source-authority.test.mjs tests/atom-window-aware-program-locks.test.mjs tests/atom-window-controlled-jump-authorization.test.mjs

Expected: FAIL at remaining record.types agent checks.

- [ ] **Step 3: Thread Agent Program paths through result validation**

Extend runWorker and validateProgramResult options with agentProgramPaths. At scheduler call sites pass:

    agentProgramPaths: [...this.agentSecurity.keys()]

Replace jump window validation with:

    const agentPaths = new Set(options.agentProgramPaths ?? []);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !agentPaths.has(window?.path)
      || !source?.types.includes('program')
      || !destination
      || !recordsByPath.get(sourceProgramPath)?.types.includes('program')
      || !source.path.startsWith(window.path + '/')) {
      throw Object.assign(
        new Error('jump_authorize() returned an invalid controlled migration effect'),
        { code: 'INVALID_JUMP_AUTHORIZATION_EFFECT' }
      );
    }

- [ ] **Step 4: Change ownership and allowed-window checks**

Replace owningAgentPath with:

    function owningAgentPath(program, recordsByRef, agentProgramPaths) {
      let record = program;
      while (record) {
        if (agentProgramPaths.has(record.path)) return record.path;
        record = record.parentRef ? recordsByRef.get(record.parentRef) ?? null : null;
      }
      return null;
    }

At every call site pass new Set(this.agentSecurity.keys()). Replace allowed-window and enclosing-Agent Key checks with this.agentSecurity.has(record.path) or a longest-prefix lookup over this.agentSecurity keys. Do not infer Agent identity from names, paths, Session state, or cache-only data.

- [ ] **Step 5: Remove manual registry lifecycle methods**

Delete registerAgentWindow, unregisterAgentWindow, and moveAgentWindow from ProgramRuntimeScheduler after all callers use rebuildAgentSecurity. Replace test setup that calls registerAgentWindow with worlds containing a literal Agent Program followed by:

    await scheduler.rebuildAgentSecurity(world);

The only writable source of the registry is now a successful world revision.

- [ ] **Step 6: Correct the request-driven lock message**

In src/atom-system/public/request-driven-lock-contract.mjs replace the old declaration wording with:

    'Agent security is reconstructed from one literal agent({...}) declaration in each active thing@program source'

- [ ] **Step 7: Run the complete affected runtime group**

Run:

    node --test tests/atom-agent-program-runtime.test.mjs tests/atom-program-runtime-scheduling.test.mjs tests/atom-program-lock-source-authority.test.mjs tests/atom-window-aware-program-locks.test.mjs tests/atom-window-controlled-jump-authorization.test.mjs tests/atom-legacy-runtime-composition.test.mjs

Expected: PASS; Program-to-Program dispatch, nearest declared owner, lock reconstruction, jump authorization, cache refresh, and cold-start composition agree.

- [ ] **Step 8: Inspect and commit unified Program paths**

Call:

    detect_changes({ scope: "unstaged" })

Run:

    git diff --check
    git add work-engine/atom-language/program-runtime.mjs src/atom-system/public/request-driven-lock-contract.mjs tests/atom-agent-program-runtime.test.mjs tests/atom-program-runtime-scheduling.test.mjs tests/atom-program-lock-source-authority.test.mjs tests/atom-window-aware-program-locks.test.mjs tests/atom-window-controlled-jump-authorization.test.mjs tests/atom-legacy-runtime-composition.test.mjs
    git commit -m "refactor: route Agent behavior through Program runtime"

Expected: no active runtime branch reads types.includes('agent').

---

### Task 4: Authorize Agent Declaration Changes and Remove Key Mutation

**Files:**
- Modify: work-engine/atom-language/engine.mjs
- Modify: work-engine/atom-language/window-lock-v1.mjs
- Modify: src/atom-system/adapters/transactional-world-persistence.mjs
- Modify: tests/atom-agent-registration-path-authorization.test.mjs
- Modify: tests/atom-window-lock-v1.test.mjs
- Modify: tests/atom-language-transform-p1.test.mjs
- Modify: tests/atom-system-failure-recovery.test.mjs

**Interfaces:**
- Consumes: ProgramRuntimeScheduler.deriveAgentSecurity(beforeAtoms|afterAtoms), creator AgentSecurity, and normal Transform path authorization.
- Produces: validateAgentProgramDelegation returning { ok: boolean, errors: Diagnostic[] }; no registerCurrentProgramAsAgent function; persistence commits facts without Key-type counting.

- [ ] **Step 1: Run exact impact analysis before editing**

Call:

    impact({
      target_uid: "Function:work-engine/atom-language/engine.mjs:validateRegisteredAgentSourceDelegation",
      target: "validateRegisteredAgentSourceDelegation",
      direction: "upstream",
      includeTests: true,
      summaryOnly: true,
      repo: "D:\\Project\\〇\\subprojects\\atom"
    })

Also call:

    impact({
      target_uid: "Function:src/atom-system/adapters/transactional-world-persistence.mjs:agentRegistrationCount",
      target: "agentRegistrationCount",
      direction: "upstream",
      includeTests: true,
      summaryOnly: true,
      repo: "D:\\Project\\〇\\subprojects\\atom"
    })

Expected: validate the executeAtomLanguage and transition call chains before editing.

- [ ] **Step 2: Write failing declaration-change tests**

First change the fixture's Creator Key from program@agent to program; its existing CREATOR_SOURCE already supplies the declaration. Then add:

    test('authorized creation of an Agent Program keeps the Key as thing@program', async (t) => {
      const files = await fixture(t);
      const scheduler = createProgramRuntimeScheduler();
      const childPath = 'Root/Task/Creator/CreatedChild';
      const childSource = 'agent({"labels":[],"functions":{"groups":[],"names":["message"]}})';
      const result = await executeAtomLanguage({
        source: 'transform new ' + JSON.stringify({
          'thing@program': childPath,
          situation: childSource,
          slot: [],
          strut: []
        }),
        ...files,
        programScheduler: scheduler,
        interaction: {
          id: 'create-declared-child',
          agent: { path: 'Root/Task/Creator' }
        }
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
      assert.equal(findAtom(stored, 'CreatedChild').key, 'thing@program');
      assert.equal(scheduler.agentSecurity.has(childPath), true);
      assert.equal(JSON.stringify(stored).includes('@agent'), false);
    });

    test('declaration escalation fails without changing world bytes', async (t) => {
      const files = await fixture(t);
      const scheduler = createProgramRuntimeScheduler();
      const childPath = 'Root/Task/Creator/AllowedChild';
      const escalated = 'agent({"labels":["^^"],"functions":{"groups":[],"names":["message"]}})';
      const before = await fs.readFile(files.contextFile, 'utf8');
      const result = await executeAtomLanguage({
        source: 'transform {' + JSON.stringify('thing') + ':' + JSON.stringify(childPath)
          + ',' + JSON.stringify('situation.rep.' + escalated) + '}',
        ...files,
        programScheduler: scheduler,
        interaction: {
          id: 'reject-declaration-escalation',
          agent: { path: 'Root/Task/Creator' }
        }
      });
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.ok(result.errors.some((error) => (
        error.code === 'AGENT_JURISDICTION_ESCALATION'
      )), JSON.stringify(result));
      assert.equal(await fs.readFile(files.contextFile, 'utf8'), before);
    });

    test('an authorized parent may demote its child Program without mutating its Key', async (t) => {
      const files = await fixture(t);
      const scheduler = createProgramRuntimeScheduler();
      const childPath = 'Root/Task/Creator/AllowedChild';
      const result = await executeAtomLanguage({
        source: 'transform {' + JSON.stringify('thing') + ':' + JSON.stringify(childPath)
          + ',' + JSON.stringify('situation.rep.value = 1') + '}',
        ...files,
        programScheduler: scheduler,
        interaction: {
          id: 'demote-declared-child',
          agent: { path: 'Root/Task/Creator' }
        }
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      const stored = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
      assert.equal(findAtom(stored, 'AllowedChild').key, 'thing@program');
      assert.equal(scheduler.agentSecurity.has(childPath), false);
    });

- [ ] **Step 3: Run the focused authorization tests**

Run:

    node --test tests/atom-agent-registration-path-authorization.test.mjs tests/atom-window-lock-v1.test.mjs tests/atom-language-transform-p1.test.mjs

Expected: FAIL because the engine still searches and writes Agent Key types.

- [ ] **Step 4: Replace Key-based comparison with declaration-map comparison**

Rename the engine helper to validateAgentProgramDelegation and implement its core as:

    async function validateAgentProgramDelegation({
      beforeAtoms,
      afterAtoms,
      creatorSecurity,
      programScheduler
    }) {
      if (typeof programScheduler?.deriveAgentSecurity !== 'function') {
        return {
          ok: false,
          errors: [diagnostic(
            'AGENT_RECONFIGURATION_VALIDATOR_UNAVAILABLE',
            'Agent Program source changes require the Program declaration validator'
          )]
        };
      }
      try {
        const before = await programScheduler.deriveAgentSecurity(beforeAtoms);
        const after = await programScheduler.deriveAgentSecurity(afterAtoms);
        const changed = [...new Set([...before.keys(), ...after.keys()])]
          .filter((programPath) => (
            JSON.stringify(before.get(programPath) ?? null)
              !== JSON.stringify(after.get(programPath) ?? null)
          ));
        if (changed.length > 0 && !creatorSecurity) {
          throw Object.assign(
            new Error('Agent Program changes require a current creator Agent'),
            { code: 'AGENT_RECONFIGURATION_CREATOR_REQUIRED' }
          );
        }
        for (const programPath of changed) {
          const child = after.get(programPath);
          if (child) validateAgentDelegation({ creator: creatorSecurity, child });
        }
        return { ok: true, errors: [] };
      } catch (error) {
        return {
          ok: false,
          errors: [diagnostic(error.code ?? 'INVALID_AGENT_DELEGATION', error.message, error.details ?? {})]
        };
      }
    }

Keep normal path and lock authorization around the Transform; this helper validates only the declaration authority delta.

- [ ] **Step 5: Delete the registration-effect transaction path**

In engine.mjs:

- remove the registerCurrentProgramAsAgent import;
- remove pendingAgentRegistrations, its conflict block, its Key mutation, and its post-commit registerAgentWindow call;
- call validateAgentProgramDelegation on every candidate world whose Program Situation or Thing type changes;
- after a successful commit, rebuild Agent security from the committed atoms before returning the receipt.

In window-lock-v1.mjs delete registerCurrentProgramAsAgent and its now-unused parseAtomKey import. Preserve validateAgentDelegation, label normalization, function-scope delegation, and fixed-window checks.

- [ ] **Step 6: Make persistence semantic-neutral**

In transactional-world-persistence.mjs remove:

    function agentRegistrationCount(atoms) { ... }
    function explicitlyChangesRegistration(source) { ... }

Remove the AGENT_REGISTRATION_LOSS count guard from transition. Keep revision checking, coordinator atomicity, compatibility-manifest advancement, projection recovery, and rollback unchanged. Agent declaration protection now occurs before commit in the engine where Program source can be validated.

- [ ] **Step 7: Run authorization, transaction, and recovery tests**

Run:

    node --test tests/atom-agent-registration-path-authorization.test.mjs tests/atom-window-lock-v1.test.mjs tests/atom-language-transform-p1.test.mjs tests/atom-system-failure-recovery.test.mjs tests/atom-world-transaction.test.mjs

Expected: PASS; authorized declaration changes commit once, escalation/removal failures preserve world and revision, and persistence no longer counts a retired Key type.

- [ ] **Step 8: Inspect and commit the mutation removal**

Call:

    detect_changes({ scope: "unstaged" })

Run:

    git diff --check
    git add work-engine/atom-language/engine.mjs work-engine/atom-language/window-lock-v1.mjs src/atom-system/adapters/transactional-world-persistence.mjs tests/atom-agent-registration-path-authorization.test.mjs tests/atom-window-lock-v1.test.mjs tests/atom-language-transform-p1.test.mjs tests/atom-system-failure-recovery.test.mjs
    git commit -m "refactor: authorize Agent Program declarations"

Expected: registerCurrentProgramAsAgent and agentRegistrationCount no longer exist.

---

### Task 5: Resolve CLI, Admin, and Server Agents From Program Declarations

**Files:**
- Modify: work-engine/atom-language/cli.mjs
- Modify: work-engine/atom-language/admin.mjs
- Modify: work-engine/atom-language/graph-server.mjs
- Modify: work-engine/atom-language/admin-cli.mjs
- Modify: work-engine/atom-language/feedback-log.mjs
- Modify: work-engine/atom-language/query-capability.mjs
- Modify: work-engine/atom-language/transform-executor.mjs
- Modify: tests/atom-agent-cli-contract.test.mjs
- Modify: tests/atom-agent-window.test.mjs
- Modify: tests/atom-language-cli-graph.test.mjs
- Modify: tests/atom-language-graph-server.test.mjs
- Modify: tests/atom-language-operational-cli.test.mjs

**Interfaces:**
- Consumes: ProgramRuntimeScheduler.rebuildAgentSecurity(atoms).
- Produces: resolveAgentContext(contextFile, selector, { programScheduler, compatibilityManifest, worldRevision }); issueWorldAgentSession accepts an optional injected programScheduler; graph server injects its shared scheduler.

- [ ] **Step 1: Run CLI impact analysis**

Call:

    impact({
      target_uid: "Function:work-engine/atom-language/cli.mjs:resolveAgentContext",
      target: "resolveAgentContext",
      direction: "upstream",
      includeTests: true,
      summaryOnly: true,
      repo: "D:\\Project\\〇\\subprojects\\atom"
    })

Expected: MEDIUM risk with direct CLI, server, and test callers. Read all depth-1 callers before changing the signature.

- [ ] **Step 2: Write failing CLI and admin selection tests**

Update fixtures to use:

    {
      'thing@program': 'Operator',
      situation: 'agent({"labels":[],"functions":{"groups":[],"names":["explore"]}})',
      slot: [],
      strut: []
    }

Import createProgramRuntimeScheduler into tests/atom-agent-cli-contract.test.mjs and create the scheduler inside each test:

    const programScheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });

Assert:

    const selected = await resolveAgentContext(contextFile, 'Operator', { programScheduler });
    assert.equal(selected.path, 'Operator');
    await assert.rejects(
      resolveAgentContext(contextFile, 'OrdinaryProgram', { programScheduler }),
      (error) => error.code === 'AGENT_TYPE_REQUIRED'
    );

For issueWorldAgentSession, inject the same scheduler and assert only declared Program paths can be issued.

- [ ] **Step 3: Run CLI, admin, and graph tests**

Run:

    node --test tests/atom-agent-cli-contract.test.mjs tests/atom-agent-window.test.mjs tests/atom-language-cli-graph.test.mjs tests/atom-language-graph-server.test.mjs tests/atom-language-operational-cli.test.mjs

Expected: FAIL because atomEntries and windowsIn still read the Agent Key type.

- [ ] **Step 4: Build the CLI directory from derived paths**

Import createProgramRuntimeScheduler in cli.mjs. Change atomEntries to receive a Set:

    function atomEntries(atoms, agentProgramPaths, parentPath = [], parentAddress = '') {
      const entries = [];
      for (const [index, atom] of (atoms ?? []).entries()) {
        const nameField = storedField(atom, 'thing');
        if (typeof nameField?.value !== 'string') continue;
        const pathParts = [...parentPath, nameField.value];
        const atomPath = pathParts.join('/');
        const address = parentAddress ? parentAddress + '/' + index : String(index);
        entries.push({
          name: nameField.value,
          types: nameField.parsed.types.map((type) => type.raw),
          path: atomPath,
          address,
          parentAddress,
          detail: storedField(atom, 'situation')?.value ?? '',
          agent: agentProgramPaths.has(atomPath)
        });
        const children = storedField(atom, 'slot')?.value;
        if (Array.isArray(children)) {
          entries.push(...atomEntries(children, agentProgramPaths, pathParts, address));
        }
      }
      return entries;
    }

In resolveAgentContext:

    const scheduler = options.programScheduler ?? createProgramRuntimeScheduler({});
    const security = await scheduler.rebuildAgentSecurity(atoms);
    const directory = agentDirectoryFor(atoms, new Set(security.keys()), options);

Remove the Key-type-derived agent property. formatAgentEntryContext may trust its already-resolved agentPath and must not reclassify it from the Key.

- [ ] **Step 5: Use the same derived registry in admin and server**

In admin.mjs create or accept a ProgramRuntimeScheduler, rebuild from the current world, and resolve requested windows from security.keys(). Keep exact-name/path ambiguity behavior.

In graph-server.mjs pass the shared scheduler to both calls:

    resolveAgentContext(configuration.contextFile, selector, {
      programScheduler,
      compatibilityManifest
    })

    primeAgentDirectory(configuration.contextFile, {
      programScheduler,
      compatibilityManifest: startupManifest,
      worldRevision: startupManifest?.currentWorldRevision
    })

- [ ] **Step 6: Rewrite public wording without changing selector syntax**

Keep the --agent option name for user compatibility, but describe its value as an exact Agent Program name or path. Replace active messages such as “@agent Atom” with:

    包含一个顶层字面量 agent({...}) 声明的 thing@program

Keep stable error codes AGENT_REQUIRED, AMBIGUOUS_AGENT, AGENT_TYPE_REQUIRED, and AGENT_NOT_FOUND. Update feedback-log, query-capability, transform-executor, admin, graph-server, and Help text consistently.

- [ ] **Step 7: Run real CLI and graph tests**

Run:

    node --test tests/atom-agent-cli-contract.test.mjs tests/atom-agent-window.test.mjs tests/atom-language-cli-graph.test.mjs tests/atom-language-graph-server.test.mjs tests/atom-language-operational-cli.test.mjs

Expected: PASS; CLI, admin, and server select the same declared Agent Programs, reject ordinary Programs, and remain exact/unique.

- [ ] **Step 8: Inspect and commit public resolution**

Call:

    detect_changes({ scope: "unstaged" })

Run:

    git diff --check
    git add work-engine/atom-language/cli.mjs work-engine/atom-language/admin.mjs work-engine/atom-language/graph-server.mjs work-engine/atom-language/admin-cli.mjs work-engine/atom-language/feedback-log.mjs work-engine/atom-language/query-capability.mjs work-engine/atom-language/transform-executor.mjs tests/atom-agent-cli-contract.test.mjs tests/atom-agent-window.test.mjs tests/atom-language-cli-graph.test.mjs tests/atom-language-graph-server.test.mjs tests/atom-language-operational-cli.test.mjs
    git commit -m "feat: resolve Agents as declared Programs"

Expected: public selection uses one shared product definition and no Key type.

---

### Task 6: Add a Recoverable Legacy-Agent World Migration

**Files:**
- Create: src/atom-system/operations/agent-program-migration.mjs
- Create: scripts/deploy-agent-program-world.mjs
- Create: tests/atom-agent-program-migration.test.mjs
- Modify: package.json
- Reuse: src/atom-system/adapters/transactional-world-persistence.mjs
- Reuse: work-engine/atom-language/program-runtime.mjs

**Interfaces:**
- Consumes: revision-bound snapshot { facts, revision }, ProgramRuntimeScheduler, verified backup port, transactional persistence port.
- Produces: planAgentProgramMigration({ snapshot, programScheduler }); applyAgentProgramMigration({ plan, confirmation, backup, persistence, attemptId, correlationId }); rollbackAgentProgramMigration({ migration, persistence, correlationId }).
- Migration plan contract: atom.agent-program-migration-plan version 1.

- [ ] **Step 1: Write failing pure-plan tests for every legacy category**

Create tests/atom-agent-program-migration.test.mjs with this prelude:

    import test from 'node:test';
    import assert from 'node:assert/strict';

    import {
      applyAgentProgramMigration,
      planAgentProgramMigration,
      rollbackAgentProgramMigration
    } from '../src/atom-system/operations/agent-program-migration.mjs';
    import { revisionOfWorldFacts } from '../src/atom-system/world-runtime/world-revision.mjs';
    import { createProgramRuntimeScheduler } from '../work-engine/atom-language/program-runtime.mjs';

    function atom(key, name, situation = '', slot = []) {
      return { [key]: name, situation, slot, strut: [] };
    }

    const programScheduler = createProgramRuntimeScheduler({ timeoutMs: 2000 });

    async function validPlan() {
      const facts = [atom('thing@agent', 'LegacyWindow', 'original human context')];
      return planAgentProgramMigration({
        snapshot: { facts, revision: revisionOfWorldFacts(facts) },
        programScheduler
      });
    }

    function backupPort(verified) {
      return {
        async create() {
          return { id: 'backup-1', hash: 'sha256:verified-source' };
        },
        async verify() {
          return verified;
        }
      };
    }

    function persistencePort(plan) {
      const calls = [];
      return {
        calls,
        async commit(request) {
          calls.push({ operation: 'commit', request: structuredClone(request) });
          return {
            commandId: 'agent-migration-command-1',
            beforeRevision: request.expectedRevision,
            afterRevision: request.nextRevision
          };
        },
        async rollback(request) {
          calls.push({ operation: 'rollback', request: structuredClone(request) });
          return {
            commandId: 'agent-migration-rollback-1',
            beforeRevision: request.expectedRevision,
            afterRevision: plan.expectedRevision
          };
        }
      };
    }

Then add these cases:

    test('migration upgrades active legacy Agents and demotes archived ones', async () => {
      const world = [
        atom('thing@agent', 'LegacyWindow', 'original human context'),
        atom(
          'thing@program@agent',
          'LegacyProgram',
          'agent({"labels":["^"],"functions":{"groups":[],"names":["explore"]}})'
        ),
        atom('thing@backup@default', 'Backup', '', [
          atom('thing@program@agent', 'ArchivedProgram', 'archived bytes')
        ])
      ];
      const snapshot = { facts: world, revision: revisionOfWorldFacts(world) };
      const plan = await planAgentProgramMigration({ snapshot, programScheduler });
      assert.equal(JSON.stringify(plan.facts).includes('@agent'), false);
      assert.equal(plan.facts[0]['thing@program'], 'LegacyWindow');
      assert.match(plan.facts[0].situation, /LEGACY_AGENT_SITUATION/);
      assert.match(plan.facts[0].situation, /original human context/);
      assert.equal(plan.facts[1]['thing@program'], 'LegacyProgram');
      assert.equal(plan.facts[1].situation, world[1].situation);
      assert.equal(plan.facts[2].slot[0].thing, 'ArchivedProgram');
      assert.equal(plan.facts[2].slot[0].situation, 'archived bytes');
      assert.deepEqual(plan.summary, {
        activePureAgentsUpgraded: 1,
        activeProgramAgentsUpgraded: 1,
        archivedAgentsDemoted: 1,
        ambiguousSources: 0
      });
    });

    test('migration fails the whole plan on a dynamic or multiple Agent declaration', async () => {
      const world = [atom('thing@program@agent', 'Broken', 'spec = {}\nagent(spec)')];
      await assert.rejects(
        planAgentProgramMigration({
          snapshot: { facts: world, revision: revisionOfWorldFacts(world) },
          programScheduler
        }),
        (error) => error.code === 'AGENT_MIGRATION_SOURCE_AMBIGUOUS'
      );
      assert.equal(world[0]['thing@program@agent'], 'Broken');
    });

    test('apply requires verified backup and rollback restores the exact source revision', async () => {
      const plan = await validPlan();
      const rejectedPersistence = persistencePort(plan);
      await assert.rejects(
        applyAgentProgramMigration({
          plan,
          confirmation: true,
          backup: backupPort(false),
          persistence: rejectedPersistence,
          attemptId: 'agent-program-test-rejected'
        }),
        (error) => error.code === 'AGENT_MIGRATION_BACKUP_VERIFICATION_FAILED'
      );
      assert.deepEqual(rejectedPersistence.calls, []);

      const persistence = persistencePort(plan);
      const applied = await applyAgentProgramMigration({
        plan,
        confirmation: true,
        backup: backupPort(true),
        persistence,
        attemptId: 'agent-program-test-applied'
      });
      assert.equal(persistence.calls[0].operation, 'commit');
      const restored = await rollbackAgentProgramMigration({
        migration: applied,
        persistence,
        correlationId: 'agent-program-test-rollback'
      });
      assert.equal(persistence.calls[1].operation, 'rollback');
      assert.equal(restored.afterRevision, plan.expectedRevision);
    });

Use local atom and port helpers fully defined in this test file, following tests/atom-graph-four-axis-migration.test.mjs.

- [ ] **Step 2: Run the migration test and observe the missing module**

Run:

    node --test tests/atom-agent-program-migration.test.mjs

Expected: FAIL with ERR_MODULE_NOT_FOUND for agent-program-migration.mjs.

- [ ] **Step 3: Implement collision-safe Key reconstruction and pure-Agent wrapping**

Use parseAtomKey(rawKey, { allowRetiredAgentKey: true }) and preserve all non-agent types and descriptions. For active legacy records:

    function legacyAgentProgramSource(originalSituation) {
      return [
        'LEGACY_AGENT_SITUATION = ' + JSON.stringify(String(originalSituation)),
        'agent({"labels":[],"functions":{"groups":[],"names":["explore"]}})'
      ].join('\n');
    }

- active thing@agent becomes thing@program and uses legacyAgentProgramSource so the exact old Situation remains recoverable inside the Program source;
- active thing@program@agent loses only the agent type and preserves its Situation bytes;
- an active Program with a missing declaration receives no inferred privileged labels or functions; if it is a pure legacy Agent, the fixed minimal explore declaration above is used; if it already contains dynamic or multiple agent calls, fail the complete plan as ambiguous;
- inside the one typed thing@backup@default subtree, remove agent and program types and keep name, Situation, slot, strut, remaining types, and description unchanged.

Reject duplicate reconstructed keys before changing the cloned object.

- [ ] **Step 4: Bind planning to source and target revisions**

The plan must include:

    {
      contract: 'atom.agent-program-migration-plan',
      version: 1,
      migrationId,
      expectedRevision: snapshot.revision,
      nextRevision: revisionOfWorldFacts(facts),
      sourceFactsHash,
      nextFactsHash,
      sourceFacts: structuredClone(snapshot.facts),
      facts: structuredClone(facts),
      summary
    }

Before returning, call programScheduler.deriveAgentSecurity(facts), verify every upgraded active path is present, verify every archived demoted path is absent, and scan the cloned facts to prove no Key contains the agent type.

- [ ] **Step 5: Implement verified apply and receipt rollback**

Follow the existing graph-four-axis migration ports:

- confirmation must equal true;
- the current revision must equal expectedRevision;
- backup.create runs before persistence.commit;
- backup.verify must return true before the first world write;
- persistence.commit receives one correlation id, expected revision, next revision, facts, and source agent-program-migration plus migrationId;
- the returned receipt exposes targetCommandId and expectedRevision for rollback;
- rollback calls persistence.rollback and never reconstructs facts from memory.

Use stable codes AGENT_MIGRATION_CONFIRMATION_REQUIRED, INVALID_AGENT_MIGRATION_PLAN, AGENT_MIGRATION_BACKUP_REQUIRED, AGENT_MIGRATION_BACKUP_VERIFICATION_FAILED, AGENT_MIGRATION_TRANSACTION_REQUIRED, and INVALID_AGENT_MIGRATION_RECEIPT.

- [ ] **Step 6: Implement the operator entry**

scripts/deploy-agent-program-world.mjs must strut exactly:

    node scripts/deploy-agent-program-world.mjs --dry-run --attempt agent-program-20260831
    node scripts/deploy-agent-program-world.mjs --apply --attempt agent-program-20260831
    node scripts/deploy-agent-program-world.mjs --rollback <deployment-receipt.json>

Use resolveAtomRuntime for the configured world, create a private sibling migration-backups/agent-program directory, copy the source world with exclusive file creation, record SHA-256 hashes, verify copied bytes, and write a redacted deployment receipt containing paths, hashes, revisions, counts, and transaction receipts but no Atom facts or Situation content. --apply must be mutually exclusive with --dry-run and --rollback.

Add to package.json:

    "migrate:agent-program": "node scripts/deploy-agent-program-world.mjs --dry-run"

- [ ] **Step 7: Run migration and persistence tests**

Run:

    node --test tests/atom-agent-program-migration.test.mjs tests/atom-graph-four-axis-migration.test.mjs tests/atom-world-transaction.test.mjs tests/atom-system-failure-recovery.test.mjs

Expected: PASS; planning is pure, ambiguous sources stop the whole plan, backup precedes commit, failed verification writes nothing, and rollback restores the exact source revision.

- [ ] **Step 8: Inspect and commit the migration capability**

Call:

    detect_changes({ scope: "unstaged" })

Run:

    git diff --check
    git add src/atom-system/operations/agent-program-migration.mjs scripts/deploy-agent-program-world.mjs tests/atom-agent-program-migration.test.mjs package.json
    git commit -m "feat: add recoverable Agent Program migration"

Expected: no private world, backup, receipt, or absolute path is staged.

---

### Task 7: Migrate Fixtures, Public Contracts, and Runtime Version

**Files:**
- Create: tests/atom-agent-program-source-boundary.test.mjs
- Modify: work-engine/atom-language/key-parser.mjs
- Modify: work-engine/atom-language/runtime-contract.mjs
- Modify: work-engine/atom-language/program-function-registry.json
- Modify: work-engine/atom-language/program-worker.py
- Modify: work-engine/atom-language/work-order-registry.json
- Modify: scripts/night-watch-isolated-cli-fixture.mjs
- Modify: scripts/night-watch-isolated-cli-live.mjs
- Modify: scripts/night-watch-shared-cli-live.mjs
- Modify: scripts/accept-real-world-write-copy.mjs
- Modify: docs/atom-program-runtime-2.5.md
- Modify: docs/architecture/program-function-ecosystem.md
- Modify: docs/architecture/atom-capability-graph.json
- Modify: README.md
- Modify: affected tests under tests/

**Interfaces:**
- Consumes: the completed Agent-as-Program runtime.
- Produces: atom-interaction/4, Program function registry version 6, fixtures containing thing@program plus literal declarations, and a source-boundary scan.

- [ ] **Step 1: Write the failing source-boundary scan**

Create tests/atom-agent-program-source-boundary.test.mjs:

    import test from 'node:test';
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';

    const root = path.resolve(import.meta.dirname, '..');
    const scannedRoots = ['src', 'work-engine', 'scripts', 'tests'];
    const allowedFiles = new Set([
      'src/atom-system/operations/agent-program-migration.mjs',
      'tests/atom-agent-key-retirement.test.mjs',
      'tests/atom-agent-program-migration.test.mjs',
      'tests/atom-agent-program-source-boundary.test.mjs'
    ]);

    function filesBelow(relativeDirectory) {
      const absolute = path.join(root, relativeDirectory);
      return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
        const relativePath = path.posix.join(relativeDirectory, entry.name);
        return entry.isDirectory() ? filesBelow(relativePath) : [relativePath];
      });
    }

    test('retired Agent Key syntax survives only in rejection and migration contracts', () => {
      const offenders = scannedRoots
        .flatMap(filesBelow)
        .filter((file) => /\.(?:js|mjs|json|py)$/u.test(file))
        .filter((file) => !allowedFiles.has(file))
        .filter((file) => /thing@agent|thing@program@agent|program@agent|@agent Atom/u.test(
          fs.readFileSync(path.join(root, file), 'utf8')
        ));
      assert.deepEqual(offenders, []);
    });

- [ ] **Step 2: Run the scan and record every remaining active source**

Run:

    node --test tests/atom-agent-program-source-boundary.test.mjs
    rg -n "@agent|thing@agent|program@agent" src work-engine scripts tests docs --glob "!docs/history/**" --glob "!docs/superpowers/specs/**" --glob "!docs/superpowers/plans/**"

Expected: the test FAILS and the search names the exact fixtures, Help strings, contracts, docs, and legacy tests that still encode Key semantics.

- [ ] **Step 3: Convert fixtures and test worlds structurally**

For each active fixture:

- change thing@program@agent or program@agent to thing@program or program;
- keep or add exactly one top-level literal agent({...}) in Situation;
- replace pure thing@agent with thing@program and a minimal literal declaration plus any existing synthetic text encoded in LEGACY_AGENT_SITUATION;
- replace manual scheduler.registerAgentWindow setup with rebuildAgentSecurity(world);
- preserve retired syntax only in the four source-boundary allowlist files.

Do not perform a raw text replacement inside historical docs or migration rejection cases.

- [ ] **Step 4: Bump the public runtime and function registry**

First activate final parser behavior by changing the Task 1 condition to:

    if (baseKey === 'thing'
      && options.allowRetiredAgentKey !== true
      && types.some((type) => type.raw === 'agent')) {

Update the first atom-agent-key-retirement test to call parseAtomKey(rawKey) without options. Only agent-program-migration.mjs may pass allowRetiredAgentKey: true.

Set:

    export const ATOM_RUNTIME_CONTRACT = 'atom-interaction/4';

Set program-function-registry.json to version 6 and runtimeContract atom-interaction/4. Change the agent function contract to:

    "role": "one static top-level declaration on the current thing@program",
    "identity": "source-derived Agent Program",
    "keyType": "forbidden",
    "dispatch": "ordinary use_program and Program scheduler paths",
    "persistence": "world Program source",
    "sidecarAuthority": "forbidden"

Set the Python worker's required registry version and runtime contract to 6 and atom-interaction/4. Update work-order-registry.json and direct contract assertions to atom-interaction/4 without changing work-order behavior.

- [ ] **Step 5: Update active docs and Help**

Document:

- Agent is a Program capability, never a Key type;
- exactly one literal declaration identifies an Agent Program;
- use_program supplies Program-to-Program and Agent-Program dispatch;
- derived registries are revision-bound caches;
- active legacy conversion and archived demotion use the migration receipt;
- @agent appears only when explaining the retired format.

Update README Agent wording, docs/atom-program-runtime-2.5.md, docs/architecture/program-function-ecosystem.md, and docs/architecture/atom-capability-graph.json. Remove obsolete OpenSpec validation wording from active architecture docs; point implementation history to docs/history/development-control.

- [ ] **Step 6: Run source boundary, contract, and fixture tests**

Run:

    node --test tests/atom-agent-program-source-boundary.test.mjs tests/atom-agent-key-retirement.test.mjs tests/atom-agent-program-runtime.test.mjs tests/atom-agent-cli-contract.test.mjs tests/atom-language-cli-graph.test.mjs tests/atom-program-function-registry.test.mjs tests/atom-work-order-interfaces.test.mjs tests/spatial-work-order-registry-model.test.js

Expected: PASS.

- [ ] **Step 7: Verify the remaining retired syntax is intentional**

Run:

    rg -n "@agent|thing@agent|program@agent" src work-engine scripts tests docs --glob "!docs/history/**" --glob "!docs/superpowers/specs/**" --glob "!docs/superpowers/plans/**"

Expected: matches occur only in agent-program-migration.mjs, atom-agent-key-retirement.test.mjs, atom-agent-program-migration.test.mjs, atom-agent-program-source-boundary.test.mjs, and active documentation sentences explicitly naming the retired format. Any runtime Help, fixture, normal test, or executable branch match is a failure.

- [ ] **Step 8: Inspect and commit the contract migration**

Call:

    detect_changes({ scope: "unstaged" })

Run:

    git diff --check
    git add work-engine/atom-language/key-parser.mjs work-engine/atom-language/runtime-contract.mjs work-engine/atom-language/program-function-registry.json work-engine/atom-language/program-worker.py work-engine/atom-language/work-order-registry.json scripts/night-watch-isolated-cli-fixture.mjs scripts/night-watch-isolated-cli-live.mjs scripts/night-watch-shared-cli-live.mjs scripts/accept-real-world-write-copy.mjs docs/atom-program-runtime-2.5.md docs/architecture/program-function-ecosystem.md docs/architecture/atom-capability-graph.json README.md tests
    git commit -m "docs: complete Agent Program contract migration"

Expected: the commit contains synthetic fixtures and code only; no local world data is staged.

---

### Task 8: Verify Code, Migrate the Configured World, and Prove Cold-Start Recovery

**Files:**
- Verify: all code and tests changed in Tasks 1–7
- Runtime-only write: configured private Atom world and its private migration backup/receipt directory

**Interfaces:**
- Consumes: complete Agent-as-Program code and the configured private world.
- Produces: current test evidence, a verified migration receipt, a world with zero retired Agent Keys, a rebuilt Agent Program registry, and a usable public CLI after cold start.

- [ ] **Step 1: Run the focused Agent and migration suite**

Run:

    node --test tests/atom-agent-key-retirement.test.mjs tests/atom-agent-program-runtime.test.mjs tests/atom-agent-registration-path-authorization.test.mjs tests/atom-agent-symbolic-security.test.mjs tests/atom-agent-cli-contract.test.mjs tests/atom-agent-window.test.mjs tests/atom-agent-program-migration.test.mjs tests/atom-agent-program-source-boundary.test.mjs tests/atom-window-lock-v1.test.mjs tests/atom-window-aware-program-locks.test.mjs tests/atom-window-controlled-jump-authorization.test.mjs

Expected: PASS.

- [ ] **Step 2: Run the complete repository suite**

Run:

    npm.cmd test

Expected: PASS with zero failures. If any test fails or behavior is unexpected, invoke superpowers:systematic-debugging, establish the root cause, fix through a new RED-to-GREEN cycle, and repeat this step.

- [ ] **Step 3: Dry-run the configured private world migration**

Run:

    node scripts/deploy-agent-program-world.mjs --dry-run --attempt agent-program-20260831

Expected: a redacted plan reports exact counts for active pure upgrades, active Program upgrades, archived demotions, and ambiguous sources; it writes no world facts. A nonzero ambiguousSources count is a failed gate: inspect only those exact Program sources locally, repair each source through the approved Agent Program contract, and rerun dry-run until the count is zero. Do not weaken the parser or migrate an ambiguous source partially.

- [ ] **Step 4: Apply only after backup verification**

Run:

    node scripts/deploy-agent-program-world.mjs --apply --attempt agent-program-20260831

Expected: the script creates and hashes a private source backup, verifies copied bytes, commits one revision, rebuilds the Agent registry, performs its postcheck, and writes a redacted deployment receipt. If backup verification or postcheck fails, the command returns a stable failure and either writes nothing or performs receipt-driven compensation.

- [ ] **Step 5: Prove the migrated world and archived boundary**

Run:

    node scripts/deploy-agent-program-world.mjs --dry-run --attempt agent-program-postcheck-20260831

Expected: zero active pure upgrades, zero active Program upgrades, zero archived demotions, zero ambiguous sources, and no Key containing the agent type. The private receipt confirms archived former Agents are absent from the derived registry.

- [ ] **Step 6: Prove cold-start public use**

Restart the local Atom service through its normal project command, then run:

    atom.cmd --help
    node --test tests/atom-language-cli-graph.test.mjs tests/atom-language-operational-cli.test.mjs

The two tests spawn the public CLI against isolated worlds with a known Operator Agent Program and send exact read-only requests through standard input. Expected: Help describes Agent Programs, exact selection succeeds, the requests use rebuilt source-derived security contexts, and no registration sidecar or previous Session memory is required. The configured private-world apply postcheck independently creates a fresh scheduler, derives every active Agent Program, and records only counts, revision, and stable error/success codes.

- [ ] **Step 7: Run independent review and completion verification**

Invoke superpowers:requesting-code-review against the approved specs and this plan. Process findings through superpowers:receiving-code-review. Then invoke superpowers:verification-before-completion and rerun every command it requires against the final revision.

Expected: no unresolved contract, security, migration, recovery, or test-quality finding.

- [ ] **Step 8: Inspect final scope before the completion claim**

Call:

    detect_changes({ scope: "compare", base_ref: "main" })

Run:

    git diff --check main...HEAD
    git status --short
    git log --oneline --decorate main..HEAD

Expected: only planned Atom code, tests, docs, and migration tooling changed; no private world, backup, receipt, global Superpowers file, unrelated user file, or GitHub push is present. Use superpowers:finishing-a-development-branch for the local integration choice.
