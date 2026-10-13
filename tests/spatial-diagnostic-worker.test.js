const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('oversized valid metadata is reduced and sent asynchronously within the byte budget',async()=>{
  const timers=[],sent=[],self={};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../spatial-diagnostics-worker.js'),'utf8'),{
    self,crypto:{randomUUID:()=> 'test'},Date,TextEncoder,AbortController,
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},
    fetch:async(url,options)=>{sent.push(options.body);return {ok:true};}
  });
  self.onmessage({data:{events:[{event:'knowledge-import',nodes:Array.from({length:96},()=>({key:'中'.repeat(160),labelHash:'123'}))}]}});
  assert.equal(sent.length,0);assert.equal(timers.length,1);
  await timers.shift()();
  assert.equal(sent.length,1);
  assert.ok(Buffer.byteLength(sent[0])<=32000);
  assert.ok(JSON.parse(sent[0]).events[0].nodes.length>0);
});
