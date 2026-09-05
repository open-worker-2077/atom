import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { startAtomGraphServer } from '../work-engine/atom-language/graph-server.mjs';
import { executeAtomCommandEndpoint } from '../work-engine/atom-language/cli.mjs';
import { walkAtoms } from '../work-engine/atom-language/query-capability.mjs';
import { shortcutMetadata } from '../work-engine/atom-language/shortcut-runtime.mjs';
import { rewriteProgramSourcePathLiterals } from '../work-engine/atom-language/transform-executor.mjs';

const arg = (key) => process.argv[process.argv.indexOf(key) + 1];
for (const key of ['--context', '--agent', '--target', '--name']) {
  if (!process.argv.includes(key)) throw new Error(`Required ${key}`);
}
const source = path.resolve(arg('--context'));
const agent = arg('--agent');
const target = arg('--target');
const renamed = `${target.slice(0, target.lastIndexOf('/'))}/${arg('--name')}`;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atom-rename-acceptance-'));
const files = { contextFile: path.join(dir, 'atom.json'), graphFile: path.join(dir, 'graph.json'), storeFile: path.join(dir, 'knowledge.json') };
const original = await fs.readFile(source);
await fs.writeFile(files.contextFile, original);
try { await fs.copyFile(path.join(path.dirname(source), 'program-projection.json'), path.join(dir, 'program-projection.json')); }
catch (e) { if (e.code !== 'ENOENT') throw e; }
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const entries = (atoms) => new Map(walkAtoms(atoms).map((m) => [m.path.join('/'), m.atom]));
const axisField = (atom, base) => Object.entries(atom).find(([key]) => (
  key === base || (key.startsWith(base) && /^[@#]/u.test(key.slice(base.length)))
));
const beforeFacts = JSON.parse(original);
const before = entries(beforeFacts);
const relocate = (p) => p === target || p.startsWith(`${target}/`) ? renamed + p.slice(target.length) : p;
const report = { directory: dir, sourceHash: hash(original), target, renamed };

function resolveStrutTarget(sourceMatch, selector, matches, rootName) {
  if (typeof selector !== 'string' || !selector) return null;
  const normalized = rootName && selector.startsWith(`${rootName}/`)
    ? selector.slice(rootName.length + 1)
    : selector;
  const byPath = new Map(matches.map((match) => [match.path.join('/'), match]));
  if (normalized.includes('/')) return byPath.get(normalized) ?? null;
  const sibling = byPath.get([...sourceMatch.path.slice(0, -1), normalized].join('/'));
  if (sibling) return sibling;
  const named = matches.filter((match) => axisField(match.atom, 'thing')?.[1] === normalized);
  for (let depth = sourceMatch.path.length - 2; depth >= 0; depth -= 1) {
    const domain = sourceMatch.path.slice(0, depth + 1);
    const scoped = named.filter((match) => domain.every((part, index) => match.path[index] === part));
    if (scoped.length === 1) return scoped[0];
    if (scoped.length > 1) return null;
  }
  return named.length === 1 ? named[0] : null;
}

function canonicalStruts(atoms, mapPath) {
  const matches = walkAtoms(atoms);
  const rootName = path.basename(files.contextFile);
  const normalizeExpr = (expr, owner) => {
    if (!expr || typeof expr !== 'object' || Array.isArray(expr)) return;
    for (const key of ['thing', 'thing@program']) {
      if (typeof expr[key] !== 'string') continue;
      const resolved = resolveStrutTarget(owner, expr[key], matches, rootName);
      if (resolved) expr[key] = mapPath(resolved.path.join('/'));
    }
    for (const operator of ['and', 'or']) {
      if (Array.isArray(expr[operator])) expr[operator].forEach((child) => normalizeExpr(child, owner));
    }
  };
  return matches.map((owner) => {
    const [rawKey, sourceRules] = axisField(owner.atom, 'strut');
    const rules = structuredClone(sourceRules);
    for (const rule of rules) {
      if (Array.isArray(rule?.if)) rule.if.forEach((expr) => normalizeExpr(expr, owner));
      if (Array.isArray(rule?.then)) rule.then.forEach((expr) => normalizeExpr(expr, owner));
    }
    return { owner: mapPath(owner.path.join('/')), rawKey, rules };
  }).sort((left, right) => left.owner.localeCompare(right.owner));
}

function canonicalReferences(atoms, mapPath) {
  return walkAtoms(atoms).flatMap((match) => {
    const metadata = shortcutMetadata(match.atom);
    if (!metadata) return [];
    if (metadata.target.state === 'linked') metadata.target.path = mapPath(metadata.target.path);
    const referencePath = mapPath(match.path.join('/'));
    return [{
      path: referencePath,
      thing: referencePath.split('/').at(-1),
      rawKey: axisField(match.atom, 'thing')[0],
      metadata
    }];
  }).sort((left, right) => left.path.localeCompare(right.path));
}

let running;
try {
  running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, ...files });
  assert.notEqual(running.port, 4784);
  const command = async (commandSource, interactionId = crypto.randomUUID()) => executeAtomCommandEndpoint({
    source: commandSource,
    interaction: { id: interactionId, agentSelector: agent, agent: { path: agent } }
  }, `${running.url}/__atom/api/command`);
  const interactionId = `rename-acceptance-${crypto.randomUUID()}`;
  const writeSource = `transform ${JSON.stringify({ [`thing.ren.${arg('--name')}`]: target })}`;
  report.interactionId = interactionId;
  const t0 = performance.now();
  const write = await command(writeSource, interactionId);
  report.writeMs = Math.round(performance.now() - t0);
  report.write = write;
  await fs.writeFile(path.join(dir, 'receipt.json'), JSON.stringify(write, null, 2));
  assert.equal(write.ok, true, JSON.stringify(write.errors));
  const afterFacts = JSON.parse(await fs.readFile(files.contextFile, 'utf8'));
  const after = entries(afterFacts);
  assert.equal(after.size, before.size);
  assert.equal(after.has(target), false);
  let programsRewritten = 0;
  for (const [p, a] of before) {
    const b = after.get(relocate(p));
    assert.ok(b, `Missing ${p}`);
    const oldThing = Object.keys(a).find((k) => /^thing(?:[@#]|$)/u.test(k));
    assert.equal(Object.keys(b).find((k) => /^thing(?:[@#]|$)/u.test(k)), oldThing, `Types changed ${p}`);
    assert.equal(b[oldThing], p === target ? arg('--name') : a[oldThing]);
    assert.equal(axisField(b, 'situation')[0], axisField(a, 'situation')[0], `Situation axis changed ${p}`);
    assert.equal(axisField(b, 'slot')[0], axisField(a, 'slot')[0], `Slot axis changed ${p}`);
    assert.equal(axisField(b, 'strut')[0], axisField(a, 'strut')[0], `Strut axis changed ${p}`);
    for (const key of Object.keys(a).filter((k) => k.startsWith('situation'))) {
      const reference = shortcutMetadata(a);
      if (reference?.target.state === 'linked') reference.target.path = relocate(reference.target.path);
      const expected = oldThing.split(/[@#]/u).includes('program')
        ? rewriteProgramSourcePathLiterals(a[key], [{ sourcePath: target, resultPath: renamed }])
        : reference && reference.target.path !== shortcutMetadata(a).target.path
          ? JSON.stringify(reference)
          : a[key];
      assert.equal(b[key], expected, `Unexpected Situation change ${p}`);
      if (expected !== a[key] && oldThing.split(/[@#]/u).includes('program')) programsRewritten++;
    }
    // Compare direct child names in order; descendants must keep their topology.
    const childNames = (n) => (n.slot ?? []).map((child) => child[Object.keys(child).find((k) => /^thing(?:[@#]|$)/u.test(k))]);
    const oldNames = childNames(a);
    const expectedNames = p === target.slice(0, target.lastIndexOf('/'))
      ? oldNames.map((n) => n === target.split('/').at(-1) ? arg('--name') : n) : oldNames;
    assert.deepEqual(childNames(b), expectedNames, `Topology changed ${p}`);
  }
  report.thingConserved = true;
  report.situationConserved = true;
  report.slotConserved = true;
  const beforeStruts = canonicalStruts(beforeFacts, relocate);
  const afterStruts = canonicalStruts(afterFacts, (value) => value);
  assert.deepEqual(beforeStruts, afterStruts);
  report.strutConserved = true;
  report.strutClauseCount = beforeStruts.reduce((count, entry) => count + entry.rules.length, 0);
  const beforeReferences = canonicalReferences(beforeFacts, relocate);
  const afterReferences = canonicalReferences(afterFacts, (value) => value);
  assert.deepEqual(beforeReferences, afterReferences);
  report.shortcutReferencesConserved = true;
  report.shortcutReferenceCount = beforeReferences.length;
  report.fourAxesConserved = report.thingConserved && report.situationConserved
    && report.slotConserved && report.strutConserved;
  report.nodes = before.size;
  report.programsRewritten = programsRewritten;
  const read = await command(`explore ${JSON.stringify({ thing: renamed, 'slot$latitude-1': true })}`);
  assert.equal(read.ok, true, JSON.stringify(read.errors));
  await fs.writeFile(path.join(dir, 'immediate-readback.json'), JSON.stringify(read, null, 2));
  report.immediateReadback = {
    ok: read.ok,
    interactionId: read.interactionId,
    target: renamed,
    targetFound: read.items?.some((item) => item.matches?.some((match) => match.path === renamed)) ?? false
  };
  assert.equal(report.immediateReadback.targetFound, true, 'Immediate exact read did not return the renamed target');
  const finalDeadline = Date.now() + 10_000;
  let finalReceipt;
  do {
    finalReceipt = await command(writeSource, interactionId);
    if (finalReceipt.subsequentExecution?.status !== 'pending') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < finalDeadline);
  await fs.writeFile(path.join(dir, 'final-receipt.json'), JSON.stringify(finalReceipt, null, 2));
  assert.ok(['completed', 'failed'].includes(finalReceipt.subsequentExecution?.status), JSON.stringify(finalReceipt));
  if (finalReceipt.subsequentExecution.status === 'failed') {
    assert.ok(finalReceipt.subsequentExecution.errors?.length > 0, JSON.stringify(finalReceipt));
  }
  report.finalReceipt = finalReceipt;
  report.subsequentExecution = finalReceipt.subsequentExecution;
  report.programErrors = finalReceipt.subsequentExecution.errors ?? [];
  await running.close();
  running = await startAtomGraphServer({ host: '127.0.0.1', port: 0, ...files });
  const cold = await command(`explore ${JSON.stringify({ thing: renamed, 'slot$latitude-1': true })}`);
  assert.equal(cold.ok, true, JSON.stringify(cold.errors));
  report.coldReadback = cold.ok;
  report.sourceUnchanged = hash(await fs.readFile(source)) === hash(original);
  assert.equal(report.sourceUnchanged, true, 'Live source changed during acceptance; inspect concurrent activity');
  report.ok = true;
} catch (e) {
  report.ok = false;
  report.error = { message: e.message, stack: e.stack };
  process.exitCode = 1;
} finally {
  if (running) await running.close();
  await fs.writeFile(path.join(dir, 'acceptance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ...report,
    write: report.write && { ok: report.write.ok, errors: report.write.errors, warnings: report.write.warnings },
    finalReceipt: report.finalReceipt && {
      ok: report.finalReceipt.ok,
      interactionId: report.finalReceipt.interactionId,
      warnings: report.finalReceipt.warnings,
      errors: report.finalReceipt.errors,
      subsequentExecution: report.finalReceipt.subsequentExecution
    }
  }, null, 2));
}
