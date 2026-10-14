import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {executeAtomCommandEndpoint,executeAtomWorkOrderRegistryEndpoint,executeAtomProgramFunctionRegistryEndpoint,runAtomCli} from '../work-engine/atom-language/cli.mjs';
import {ATOM_RUNTIME_CONTRACT} from '../work-engine/atom-language/runtime-contract.mjs';

for(const [code,category,extra] of [
  ['EACCES','permission-denied',{errno:10013}], ['EPERM','permission-denied',{}],
  ['','permission-denied',{SocketError:10013,NativeError:10013}],
  ['ECONNREFUSED','connection-refused',{}], ['ETIMEDOUT','timeout',{}],
  ['UND_ERR_CONNECT_TIMEOUT','timeout',{}], ['ECONNRESET','unknown',{}]
]) test(`fetch cause ${code || '10013'} remains visible without asserting service stopped`,async t=>{
  const cause=Object.assign(new Error('socket failure'),{code,...extra});
  t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('fetch failed',{cause});});
  for(const execute of [()=>executeAtomCommandEndpoint({source:'explore {}',interaction:{id:'original-request'}}),
    ()=>executeAtomWorkOrderRegistryEndpoint(),()=>executeAtomProgramFunctionRegistryEndpoint()]) {
    await assert.rejects(execute(),error=>{
      assert.equal(error.code,'ATOM_ENGINE_UNAVAILABLE');
      assert.equal(error.details.connection.category,category);
      assert.match(error.message,new RegExp(code || '10013'));
      assert.doesNotMatch(error.message,/service is unavailable/);
      return true;
    });
  }
});

test('aggregate and cyclic causes are bounded and original write correlation survives',async t=>{
  const loop=Object.assign(new Error('blocked'),{code:'EACCES'});loop.cause=loop;
  t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('fetch failed',{
    cause:new AggregateError([loop,Object.assign(new Error('refused'),{code:'ECONNREFUSED'})],'multiple addresses')});});
  await assert.rejects(executeAtomCommandEndpoint({source:'transform {}',interaction:{id:'write-original'}}),error=>{
    assert.equal(error.details.interactionId,'write-original');
    assert.ok(error.details.connection.causes.length<=8);
    assert.equal(error.details.connection.category,'mixed');
    assert.match(error.message,/EACCES/);assert.match(error.message,/ECONNREFUSED/);
    return true;
  });
});

test('real refused endpoint differs from a reachable approved endpoint for the same read',async t=>{
  const server=http.createServer((request,response)=>response.end(JSON.stringify({ok:true,result:{runtimeContract:ATOM_RUNTIME_CONTRACT,rows:[]}})));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const endpoint=`http://127.0.0.1:${server.address().port}/command`;
  const options={source:'explore {}',interaction:{id:'read-proof'}};
  const result=await executeAtomCommandEndpoint(options,endpoint);
  assert.equal(result.runtimeContract,ATOM_RUNTIME_CONTRACT);
  await new Promise(r=>server.close(r));
  await assert.rejects(executeAtomCommandEndpoint(options,endpoint),error=>{
    assert.equal(error.details.connection.category,'connection-refused');return true;
  });
});

test('a response interrupted after headers preserves the original write correlation',async()=>{
  const server=http.createServer((request,response)=>{
    response.writeHead(200,{'content-type':'application/json'});
    response.write('{"ok":true,');
    setTimeout(()=>response.destroy(),30);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {
    await assert.rejects(executeAtomCommandEndpoint({source:'transform {}',interaction:{id:'write-response-original'}},
      `http://127.0.0.1:${server.address().port}/command`),error=>{
      assert.equal(error.details?.interactionId,'write-response-original');
      assert.equal(error.details.connection.phase,'response');
      assert.match(error.message,/UND_ERR_SOCKET/);
      return true;
    });
  } finally {await new Promise(r=>server.close(r));}
});

test('Help distinguishes execution environment, permission and service with approved read-only comparisons',async()=>{
  let text='';
  assert.equal(await runAtomCli(['--help'],{stdout:{write:s=>text+=s},stderr:{write:()=>{}}}),0);
  for(const phrase of ['Get-Command atom.cmd','10013','fetch failed','最小只读','全局沙箱','无条件','原关联号']) assert.ok(text.includes(phrase),phrase);
});
