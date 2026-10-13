import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startAtomGraphServer} from '../../work-engine/atom-language/graph-server.mjs';

test('real create, rename and detail edits update an expanded page and persist matching render diagnostics',async({page})=>{
  test.setTimeout(90_000);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'atom-rename-diagnostics-'));
  const contextFile=path.join(dir,'atom.json');
  await fs.writeFile(contextFile,JSON.stringify([{'thing@program':'验收入口',
    situation:'agent({"labels":["^"],"functions":{"groups":[],"names":["explore","transform"]}})',
    slot:[{thing:'旧团',situation:'旧正文',slot:[{thing:'孩子',situation:'子正文',slot:[],strut:[]}],strut:[]}],strut:[]}]));
  const running=await startAtomGraphServer({host:'127.0.0.1',port:0,contextFile,
    graphFile:path.join(dir,'graph.json'),storeFile:path.join(dir,'knowledge.json'),backupRepository:''});
  const cli=async source=>promisify(execFile)(process.execPath,[path.resolve('work-engine/atom-language/cli.mjs'),
    '--endpoint',`${running.url}/__atom/api/command`,'--agent','验收入口',...source],{cwd:path.resolve('.'),timeout:15000});
  await page.addInitScript(()=>{
    window.actualLabels=[];
    const clear=CanvasRenderingContext2D.prototype.clearRect,draw=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.clearRect=function(...a){if(this.canvas.id==='spaceCanvas')window.actualLabels=[];return clear.apply(this,a);};
    CanvasRenderingContext2D.prototype.fillText=function(t,...a){if(this.canvas.id==='spaceCanvas')window.actualLabels.push(String(t));return draw.call(this,t,...a);};
  });
  try {
    await page.goto(running.url);
    for(const label of ['atom.json','验收入口']){
      await expect.poll(()=>page.evaluate(l=>window.spatialLab?.selectByLabel(l),label)).toBe(true);
      await page.evaluate(()=>window.spatialLab.dispatch('applyImmersiveInwardView'));
      await expect(page.locator('body')).toHaveAttribute('data-spatial-scope-state','loaded');
    }
    await expect.poll(()=>page.evaluate(()=>window.spatialLab.selectByLabel('旧团'))).toBe(true);
    await page.evaluate(()=>window.spatialLab.dispatch('applyInwardView'));
    await expect.poll(()=>page.evaluate(()=>window.spatialLab.state().clusterPaths.length)).toBeGreaterThan(1);
    await cli(['transform','{"thing.ren.新团":"验收入口/旧团"}']);
    await cli(['transform','{"thing":"验收入口/新团","situation.rep.新正文"}']);
    await cli(['transform','new','{"thing":"验收入口/测试节点","situation":"创建正文","slot":[],"strut":[]}']);
    await cli(['transform','{"thing.ren.修改节点":"验收入口/测试节点"}']);
    await expect.poll(()=>page.evaluate(()=>window.spatialLab.exportKnowledge().nodes.filter(n=>n.label==='新团').length)).toBe(1);
    await expect.poll(()=>page.evaluate(()=>window.spatialLab.exportKnowledge().nodes.some(n=>n.label==='修改节点'))).toBe(true);
    await expect.poll(()=>page.evaluate(()=>window.actualLabels.some(t=>t.includes('旧团')||t.includes('测试节点')))).toBe(false);
    const diagnostics=async()=> (await(await fetch(`${running.url}/__spatial/api/diagnostics`)).json()).events||[];
    await expect.poll(async()=> (await diagnostics()).some(e=>e.event==='knowledge-rendered'),{timeout:12000}).toBe(true);
    const events=await diagnostics();
    expect(events.some(e=>e.event==='knowledge-import'&&e.nodes?.length)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('新正文');
  } finally {await page.close();await running.close();}
});
