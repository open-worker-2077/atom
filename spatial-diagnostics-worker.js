/* Event-driven telemetry: no idle polling, one bounded request at a time. */
let pending = [], timer = null, sending = false, lastSent = 0;
const session = crypto.randomUUID();
function schedule() {
  if (!pending.length || sending || timer) return;
  timer = setTimeout(flush, Math.max(1000, 2000 - (Date.now() - lastSent)));
}
async function flush() {
  timer = null;
  if (sending || !pending.length) return;
  const events = [];
  let bytes = 100;
  while (pending.length && events.length < 24) {
    const next = pending[0];
    let size = new TextEncoder().encode(JSON.stringify(next)).length + 1;
    if (size > 12000) {
      for (const key of ['nodes','clusters']) {
        if (Array.isArray(next[key])) next[key] = next[key].slice(0, Math.max(1,Math.floor(next[key].length * 10000 / size)));
      }
      size = new TextEncoder().encode(JSON.stringify(next)).length + 1;
    }
    if (size > 30000) { pending.shift(); continue; }
    if (bytes + size > 30000) break;
    events.push(pending.shift()); bytes += size;
  }
  sending = true; lastSent = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const body = JSON.stringify({ session, events });
    if (events.length) await fetch('/__spatial/api/diagnostics', {
      method:'POST', headers:{'content-type':'application/json'}, body, signal:controller.signal,
      credentials:'same-origin', cache:'no-store'
    });
  } catch { /* Logging failures never retry or propagate into the application. */ }
  finally { clearTimeout(timeout); sending = false; schedule(); }
}
self.onmessage = ({data}) => {
  if (!Array.isArray(data?.events)) return;
  pending.push(...data.events.slice(-128));
  pending = pending.slice(-128);
  schedule();
};
