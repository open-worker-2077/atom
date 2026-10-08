import { test, expect } from '@playwright/test';
test.setTimeout(90_000);

function child(path, id) {
  let hash = 2166136261;
  for (const c of id) { hash ^= c.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `${path}/${(hash >>> 0).toString(36)}`;
}
const parentPath = child('root', 'parent');
const leftPath = child(parentPath, 'left');
const rightPath = child(parentPath, 'right');
const knowledge = { revision: 1, nodes: [
  ['parent', 'root', '总域', true],
  ['left', parentPath, '左团', true], ['right', parentPath, '右团', true],
  ['l1', leftPath, '左一', false], ['l2', leftPath, '左二', false],
  ['r1', rightPath, '右一', false], ['r2', rightPath, '右二', false]
].map(([id, path, label, hasChildren]) => ({ id, key: `${path}::${id}`, path, label, atomPath: label, hasChildren, detail: '' })), edges: [] };
async function open(page) {
  await page.route('**/__spatial/api/state*', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, scope: { path: new URL(route.request().url()).searchParams.get('path') || 'root' }, knowledge }) }));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.spatialLab?.selectByLabel('总域'))).toBe(true);
  if (await page.locator('#helpPanel').isVisible()) await page.locator('[data-close="help"]').click();
}
async function enter(page, label, path) {
  await expect.poll(() => page.evaluate(label => window.spatialLab.selectByLabel(label), label)).toBe(true);
  await page.evaluate(() => window.spatialLab.dispatch('applyImmersiveInwardView'));
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().path)).toBe(path);
  await expect(page.locator('body')).toHaveAttribute('data-spatial-scope-state', 'loaded');
  await page.waitForTimeout(600);
}
async function expand(page) {
  const region = await page.evaluate(() => window.spatialLab.state().clusterRegions.find(r => r.path === window.spatialLab.state().path));
  await page.mouse.move(region.clientX, region.clientY);
  await page.locator('canvas').focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => window.spatialLab.state().clusterPaths.length)).toBe(3);
  await page.waitForTimeout(600);
}

async function shellBlank(page, path) {
  return page.evaluate(path => {
    const s = window.spatialLab.state(), r = s.clusterRegions.find(r => r.path === path);
    const points = r.envelope.points;
    const inside = (x,y) => {
      let hit = false;
      for (let i=0,j=points.length-1;i<points.length;j=i++) {
        const a=points[i], b=points[j];
        if ((a.y>y)!==(b.y>y) && x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) hit=!hit;
      }
      return hit;
    };
    for (let y=Math.max(30,r.envelope.bounds.top+10);y<Math.min(innerHeight-60,r.envelope.bounds.bottom-10);y+=8) {
      for (let x=Math.max(30,r.envelope.bounds.left+10);x<Math.min(innerWidth-60,r.envelope.bounds.right-10);x+=8) {
        if (inside(x,y) && !s.interactionTargets.some(t => !t.clusterShellProxy && Math.hypot(x-t.clientX,y-t.clientY)<(t.radius+3)*1.14+12)
          && document.elementFromPoint(x,y)?.id==='spaceCanvas') return {x,y};
      }
    }
    throw Error('no shell blank');
  },path);
}

test('hold in an expanded child group enters that group before release', async ({page}) => {
  await open(page); await enter(page,'总域',parentPath); await expand(page);
  const point = await shellBlank(page,leftPath);
  const delay = Number(await page.locator('#secondaryNavigationDelay').inputValue());
  await page.mouse.move(point.x,point.y); await page.mouse.down({button:'right'});
  await page.waitForTimeout(delay+180);
  await expect.poll(()=>page.evaluate(()=>window.spatialLab.state().path)).toBe(leftPath);
  await page.mouse.up({button:'right'});
  await page.waitForTimeout(600);
  expect(await page.evaluate(()=>window.spatialLab.state().path)).toBe(leftPath);
  const events=await page.evaluate(()=>window.SpatialDiagnostics.snapshot().events);
  expect(events).toEqual(expect.arrayContaining([
    expect.objectContaining({event:'secondary-press',status:'expanded-child',intent:'applyImmersiveInwardView',target:{path:leftPath}}),
    expect.objectContaining({event:'secondary-hold',intent:'applyImmersiveInwardView'})
  ]));
});

test('moving before the hold threshold records cancellation without navigating', async ({page}) => {
  await page.clock.install();
  await open(page); await enter(page,'总域',parentPath); await expand(page);
  const point=await shellBlank(page,leftPath);
  await page.clock.pauseAt(await page.evaluate(()=>Date.now()+60_000));
  const before=await page.evaluate(()=>window.SpatialDiagnostics.snapshot().events.at(-1)?.sequence || 0);
  await page.mouse.move(point.x,point.y); await page.mouse.down({button:'right'});
  await page.mouse.move(point.x+12,point.y);
  await page.mouse.up({button:'right'});
  await page.clock.runFor(1200);
  expect(await page.evaluate(()=>window.spatialLab.state().path)).toBe(parentPath);
  const events=await page.evaluate(sequence=>window.SpatialDiagnostics.snapshot().events.filter(e=>e.sequence>sequence),before);
  expect(events.filter(e=>e.event==='secondary-cancel')).toEqual([
    expect.objectContaining({status:'movement',distance:12})
  ]);
  expect(events.some(e=>e.event==='secondary-hold'||e.event==='secondary-tap')).toBe(false);
});

test('short press in an expanded child group still collapses that group', async ({page}) => {
  await open(page); await enter(page,'总域',parentPath); await expand(page);
  const point = await shellBlank(page,leftPath);
  await page.mouse.click(point.x,point.y,{button:'right'});
  await expect.poll(()=>page.evaluate(path=>window.spatialLab.state().clusterPaths.includes(path),leftPath)).toBe(false);
  expect(await page.evaluate(()=>window.spatialLab.state().path)).toBe(parentPath);
});

test('hold on a real child of an expanded group enters that child', async ({page}) => {
  await open(page); await enter(page,'总域',parentPath); await expand(page);
  const target=await page.evaluate(()=>window.spatialLab.state().interactionTargets.find(t=>t.label==='左一'&&!t.clusterShellProxy));
  const delay=Number(await page.locator('#secondaryNavigationDelay').inputValue());
  await page.mouse.move(target.clientX,target.clientY); await page.mouse.down({button:'right'});
  await page.waitForTimeout(delay+180); await page.mouse.up({button:'right'});
  await expect.poll(()=>page.evaluate(()=>window.spatialLab.state().path)).toBe(child(leftPath,'l1'));
});

test('hold inside the current immersive shell still returns to its parent', async ({page}) => {
  await open(page); await enter(page,'总域',parentPath); await expand(page);
  await enter(page,'左团',leftPath);
  const point=await shellBlank(page,leftPath);
  const delay=Number(await page.locator('#secondaryNavigationDelay').inputValue());
  await page.mouse.move(point.x,point.y); await page.mouse.down({button:'right'});
  await page.waitForTimeout(delay+180); await page.mouse.up({button:'right'});
  await expect.poll(()=>page.evaluate(()=>window.spatialLab.state().path)).toBe(parentPath);
});

test('delayed expanded scopes keep the PageDown domain centered', async ({page}) => {
  await page.route('**/__spatial/api/state*', async route => {
    const path = new URL(route.request().url()).searchParams.get('path') || 'root';
    if (path === leftPath || path === rightPath) await new Promise(resolve => setTimeout(resolve, 1200));
    const scoped = {...knowledge, nodes:knowledge.nodes.filter(node => node.path === path)};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,scope:{path},knowledge:scoped})});
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => window.spatialLab?.selectByLabel('总域'))).toBe(true);
  if (await page.locator('#helpPanel').isVisible()) await page.locator('[data-close="help"]').click();
  await enter(page,'总域',parentPath);
  await expand(page);
  await page.waitForTimeout(3500);
  const s = await page.evaluate(() => window.spatialLab.state());
  const region=s.clusterRegions.find(r=>r.path===parentPath);
  expect(Math.hypot(region.clientX-720,region.clientY-480)).toBeLessThan(5);
});

test('movement after a committed right hold cannot drag using the departed scene anchor', async ({page}) => {
  await open(page); await enter(page,'总域',parentPath); await expand(page);
  const point=await shellBlank(page,leftPath);
  const delay=Number(await page.locator('#secondaryNavigationDelay').inputValue());
  await page.mouse.move(point.x,point.y); await page.mouse.down({button:'right'});
  await page.waitForTimeout(delay+600);
  await expect.poll(()=>page.evaluate(()=>window.spatialLab.state().path)).toBe(leftPath);
  const before=await page.evaluate(()=>window.spatialLab.state().camera);
  await page.mouse.move(point.x+30,point.y+10); await page.mouse.up({button:'right'});
  await page.waitForTimeout(600);
  const after=await page.evaluate(()=>window.spatialLab.state().camera);
  expect(after.target).toEqual(before.target);
  expect(after.distance).toEqual(before.distance);
  const events=await page.evaluate(()=>window.SpatialDiagnostics.snapshot().events);
  const committed=events.findLastIndex(e=>e.event==='secondary-hold');
  expect(committed).toBeGreaterThanOrEqual(0);
  expect(events.slice(committed+1).some(e=>e.event==='secondary-cancel')).toBe(false);
});

test('holding blank in an entered expanded domain goes to its actual parent', async ({page}) => {
  await open(page); await enter(page,'总域',parentPath); await expand(page);
  await enter(page,'左团',leftPath);
  const delay=Number(await page.locator('#secondaryNavigationDelay').inputValue());
  await page.mouse.move(120,100); await page.mouse.down({button:'right'});
  await page.waitForTimeout(delay+180); await page.mouse.up({button:'right'});
  await expect.poll(()=>page.evaluate(()=>window.spatialLab.state().path)).toBe(parentPath);
  await expect.poll(()=>page.evaluate(()=>window.spatialLab.state().clusterPaths)).toEqual([parentPath]);
  await expect.poll(()=>page.evaluate(()=>{
    const s=window.spatialLab.state(),r=s.clusterRegions.find(r=>r.path===s.path);
    return Math.hypot(r.clientX-innerWidth/2,r.clientY-innerHeight/2);
  })).toBeLessThan(5);
});

test('diagnostics export has navigation checkpoints and bursts do not write per event', async ({page})=>{
  await open(page); await enter(page,'总域',parentPath);
  await page.waitForTimeout(1500);
  const result=await page.evaluate(async()=>{
    let writes=0; const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){if(k==='atom:web-diagnostics:v1')writes++; return original.call(this,k,v);};
    try {
      for(let i=0;i<1000;i++) window.SpatialDiagnostics.record('burst',{depth:i,detail:'PRIVATE_SENTINEL'});
      const immediate=writes; await new Promise(resolve=>setTimeout(resolve,1500));
      return {immediate,writes,log:window.SpatialDiagnostics.export()};
    } finally {Storage.prototype.setItem=original;}
  });
  expect(result.immediate).toBe(0); expect(result.writes).toBe(1);
  expect(JSON.parse(result.log).events.length).toBeLessThanOrEqual(128);
  expect(result.log).not.toContain('PRIVATE_SENTINEL');
  await page.evaluate(()=>window.spatialLab.dispatch('exit'));
  await page.waitForTimeout(600);
  const events=await page.evaluate(()=>window.SpatialDiagnostics.snapshot().events.map(e=>e.event));
  expect(events).toContain('scene-built'); expect(events).toContain('camera-settled');
});
