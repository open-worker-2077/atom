import assert from 'node:assert/strict';

async function command(source) {
  const response = await fetch('http://127.0.0.1:4784/__atom/api/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      source,
      interaction: { agent: { ref: 'resolved-by-service', path: '推进流总控' } }
    })
  });
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  assert.equal(payload.ok, true, JSON.stringify(payload));
  return payload.result;
}

async function humanStatus(path, detail) {
  const state = await (await fetch('http://127.0.0.1:4784/__spatial/api/state')).json();
  const projected = state.knowledge.nodes.find((node) => node.label === '状态' && node.detail === '已冻结');
  assert.ok(projected, `No projected frozen status found for ${path}`);
  const response = await fetch('http://127.0.0.1:4784/__atom/api/human-status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: projected.key, detail })
  });
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  assert.equal(payload.ok, true, JSON.stringify(payload));
  assert.equal(payload.result?.ok, true, JSON.stringify(payload));
  return payload;
}

function replaceDetail(path, detail) {
  return `transform {"name":${JSON.stringify(path)},${JSON.stringify(`detail.rep.${detail}`)}}`;
}

function firstDetail(result) {
  return result.items?.[0]?.matches?.[0]?.detail;
}

async function refresh() {
  return command('atom');
}

async function read(path) {
  return command(`explore {"name":${JSON.stringify(path)},"detail$full"}`);
}

const directionStatus = '推进流总控/设标/定向/状态';
const navigationPath = '推进流总控/导航坐标';
const closingStatus = '推进流总控/收尾/沉淀/状态';
const closingResult = '推进流总控/收尾/沉淀/成果';

try {
  assert.equal((await command(replaceDetail(directionStatus, '已通过'))).ok, true);
  await refresh();
  assert.equal(firstDetail(await read(navigationPath)), '调研');

  assert.equal((await command(replaceDetail(directionStatus, '进行中'))).ok, true);
  await refresh();
  assert.equal(firstDetail(await read(navigationPath)), '定向');

  assert.equal((await command(replaceDetail(closingStatus, '已冻结'))).ok, true);
  await refresh();
  const denied = await command(replaceDetail(closingResult, '不应写入'));
  assert.equal(denied.ok, false);
  assert.equal(denied.errors?.[0]?.code, 'PROGRAM_LOCK_DENIED');

  const agentCannotUnfreeze = await command(replaceDetail(closingStatus, '未进入'));
  assert.equal(agentCannotUnfreeze.ok, false);
  assert.equal(agentCannotUnfreeze.errors?.[0]?.code, 'PROGRAM_LOCK_DENIED');

  // Web 人工入口可越过 Program 写锁，但只接受状态 detail。
  await humanStatus(closingStatus, '未进入');
  await refresh();
  assert.equal(firstDetail(await read(closingStatus)), '未进入');
  assert.equal(firstDetail(await read(closingResult)), '');
} finally {
  // 即使中途断言失败，也尽力恢复试验用状态。
  await command(replaceDetail(directionStatus, '进行中')).catch(() => {});
  await command(replaceDetail(closingStatus, '未进入')).catch(() => {});
  await refresh().catch(() => {});
}

console.log('推进流导航与冻结锁验收通过');
