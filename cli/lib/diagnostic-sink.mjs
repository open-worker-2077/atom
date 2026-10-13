import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
export function createDiagnosticSink(directory) {
  const file=path.join(directory,'diagnostics','recent.json');
  let worker=null, queued=0, disabled=false;
  function accept(raw) {
    if(disabled || queued>=4 || raw.length>32000) return false;
    try {
      if(!worker) {
        worker=new Worker(new URL('./diagnostic-writer.mjs',import.meta.url),{workerData:{file}});
        worker.on('message',()=>{queued=Math.max(0,queued-1);});
        worker.on('error',()=>{disabled=true;queued=0;});
        worker.unref();
      }
      queued++; worker.postMessage(raw); return true;
    } catch {disabled=true;return false;}
  }
  return { accept, async read() {try{return await fs.readFile(file,'utf8');}catch{return '{"version":1,"events":[]}';}},
    close:()=>worker?.terminate() };
}
