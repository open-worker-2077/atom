import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSpatialServer } from '../cli/lib/server.mjs';

test('local diagnostic receipt does not wait for disk and the bounded sanitized records can be read', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'atom-diagnostic-'));
  const instance=await createSpatialServer({storeFile:path.join(dir,'knowledge.json')});
  await new Promise(r=>instance.server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>instance.server.close(r)));
  const url=`http://127.0.0.1:${instance.server.address().port}/__spatial/api/diagnostics`;
  const response=await fetch(url,{method:'POST',body:JSON.stringify({session:'test',events:[
    {event:'knowledge-import',revision:3,detail:'private',nodes:[{key:'root::test',labelHash:'abcd'}]}
  ]})});
  assert.equal(response.status,202);
  const denied=await fetch(url,{method:'POST',headers:{Origin:'https://evil.example','sec-fetch-site':'cross-site'},body:'{}'});
  assert.equal(denied.status,403);
  const gateway=await fetch(url,{method:'POST',headers:{Origin:'https://atom.private.example','sec-fetch-site':'same-origin'},body:'{"events":[]}'});
  assert.equal(gateway.status,202);
  const oversized=await fetch(url,{method:'POST',body:'x'.repeat(33000)});
  assert.equal(oversized.status,413);
  let result;
  for(let i=0;i<40;i++) { result=await(await fetch(url)).json();if(result.events?.length)break;await new Promise(r=>setTimeout(r,50)); }
  assert.equal(result.events[0].revision,3);
  assert.equal(result.events[0].nodes[0].labelHash,'abcd');
  assert.doesNotMatch(JSON.stringify(result),/private/);
  for(let revision=10;revision<20;revision++) {
    await fetch(url,{method:'POST',body:JSON.stringify({session:'bounded',events:[{event:'knowledge-import',revision,
      nodes:Array.from({length:96},()=>({key:'x'.repeat(160),labelHash:'abcd'}))}]})});
    await new Promise(r=>setTimeout(r,50));
  }
  let raw;
  for(let i=0;i<40;i++) {raw=await(await fetch(url)).text();if(JSON.parse(raw).events?.at(-1)?.revision===19)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(JSON.parse(raw).events.at(-1).revision,19);
  assert.ok(Buffer.byteLength(raw)<=96000);
});
