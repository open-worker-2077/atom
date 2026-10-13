import {test,expect} from '@playwright/test';
const hash=id=>{let h=2166136261;for(const c of id){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return(h>>>0).toString(36);};
test('unrelated import preserves valid ancestor expansions after immersion',async({page})=>{
  const p='root/'+hash('parent');
  const knowledge={revision:1,nodes:[{id:'parent',key:'root::parent',path:'root',label:'父团',hasChildren:true},
    {id:'child',key:p+'::child',path:p,label:'子节点',hasChildren:false}],edges:[]};
  await page.route('**/__spatial/api/state*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,
    scope:{path:new URL(r.request().url()).searchParams.get('path')||'root'},knowledge})}));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>window.spatialLab?.selectByLabel('父团'))).toBe(true);
  await page.evaluate(()=>window.spatialLab.dispatch('applyInwardView'));
  await expect.poll(()=>page.evaluate(()=>window.spatialLab.exportField().expandedPaths)).toContain(p);
  await page.evaluate(()=>window.spatialLab.dispatch('applyImmersiveInwardView'));
  await expect.poll(()=>page.evaluate(()=>window.spatialLab.state().path)).toBe(p);
  const before=await page.evaluate(()=>window.spatialLab.exportField().expandedPaths);
  expect(before).toContain(p);
  knowledge.revision=2;
  await page.evaluate(k=>window.spatialLab.importKnowledge(k),knowledge);
  expect(await page.evaluate(()=>window.spatialLab.exportField().expandedPaths)).toEqual(before);
});

test('malformed optional nodes and logger failure cannot interrupt authoritative refresh',async({page})=>{
  const knowledge={revision:1,nodes:[{id:'probe',key:'root::probe',path:'root',label:'原名'}],edges:[]};
  await page.route('**/__spatial/api/state*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,scope:{path:'root'},knowledge})}));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>window.spatialLab?.selectByLabel('原名'))).toBe(true);
  knowledge.nodes[0].label='新名';knowledge.nodes.push(null);
  expect(await page.evaluate(k=>window.spatialLab.importKnowledge(k),knowledge)).toBe(true);
  expect(await page.evaluate(k=>{
    window.SpatialDiagnostics={record(){throw Error('logging unavailable');}};
    return window.spatialLab.importKnowledge(k);
  },knowledge)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.spatialLab.state().interactionTargets.some(n=>n.label==='新名'))).toBe(true);
});
