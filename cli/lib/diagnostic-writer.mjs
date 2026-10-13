import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createDiagnostics } = createRequire(import.meta.url)('../../spatial-diagnostics.js');
let timer = null, writing = false, dirty = false;
const logger = createDiagnostics({ capacity:128, storage:null, schedule:()=>{} });
async function flush() {
  timer = null;
  if (writing) return;
  writing = true; dirty = false;
  try {
    await fs.mkdir(path.dirname(workerData.file),{recursive:true});
    const temporary = `${workerData.file}.pending`;
    await fs.writeFile(temporary,JSON.stringify(logger.snapshot()),'utf8');
    await fs.rename(temporary,workerData.file);
  } catch { /* Bounded diagnostics are disposable and must not affect service. */ }
  finally { writing = false; if(dirty) schedule(); }
}
function schedule() { dirty = true; if(!timer && !writing) timer=setTimeout(flush,500); }
parentPort.on('message', raw => {
  try {
    const batch=JSON.parse(raw);
    for(const entry of (Array.isArray(batch.events)?batch.events:[]).slice(-24)) {
      logger.record(String(entry.event||'unknown').slice(0,80),{...entry,session:String(batch.session||'').slice(0,80)});
    }
    schedule();
  } catch {}
  parentPort.postMessage('ready');
});
