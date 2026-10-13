(function (global) {
  'use strict';
  const key = 'atom:web-diagnostics:v1';
  const scalars = new Set(['depth', 'revision', 'sceneRevision', 'count', 'compression', 'distance', 'duration', 'sequence', 'at', 'width', 'height']);
  const strings = new Set(['event', 'path', 'intent', 'status', 'build', 'session', 'key', 'labelHash']);
  function encodedSize(value) {
    const text = JSON.stringify(value);
    let bytes = 0;
    for (let i=0;i<text.length;i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) bytes++;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i+1) >= 0xdc00 && text.charCodeAt(i+1) <= 0xdfff) {
        bytes += 4; i++;
      } else bytes += 3;
    }
    return bytes;
  }
  function compact(value, level = 0) {
    const result = {};
    if (!value || typeof value !== 'object' || level > 2) return result;
    for (const [name, field] of Object.entries(value)) {
      if (scalars.has(name) && Number.isFinite(field)) result[name] = field;
      else if (strings.has(name) && typeof field === 'string') result[name] = field.slice(0, 160);
      else if (['x','y','z','yaw','pitch','radius'].includes(name) && Number.isFinite(field)) result[name] = field;
      else if (['camera','target','bounds'].includes(name)) result[name] = compact(field, level + 1);
      else if (name === 'clusters' && Array.isArray(field)) result[name] = field.slice(0,16).map(item => compact(item, level + 1));
      else if (name === 'nodes' && Array.isArray(field)) result[name] = field.slice(0,96).map(item => compact(item, level + 1));
    }
    return result;
  }
  function createDiagnostics(options = {}) {
    const capacity = Math.max(1, Math.min(256, options.capacity || 128));
    const schedule = options.schedule || (fn => setTimeout(fn, 250));
    let events = [], dropped = 0, sequence = 0, pending = false, delivered = 0;
    let bytes = 0;
    const maxBytes = 95000; // Leave room for the JSON envelope and array separators.
    function trim() {
      while (events.length > capacity || bytes > maxBytes) {
        bytes -= encodedSize(events.shift()); dropped++;
      }
    }
    let storage = options.storage;
    if (storage === undefined) { try { storage = global.sessionStorage; } catch {} }
    try {
      const saved = storage?.getItem(key);
      if (saved && saved.length < 256000) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.events)) {
          dropped = Number.isSafeInteger(parsed.dropped) && parsed.dropped >= 0 ? parsed.dropped : 0;
          events = parsed.events.slice(-capacity).map(item => compact(item));
          dropped += parsed.events.length - events.length;
        }
      }
    } catch {}
    bytes = events.reduce((sum,event) => sum + encodedSize(event), 0);
    trim();
    sequence = Math.max(0, ...events.map(event => event.sequence || 0));
    function snapshot() { return { version:1, dropped, events:events.map(item => compact(item)) }; }
    function record(event, metadata = {}) {
      const entry = compact({ ...metadata, event, sequence:++sequence, at:Date.now() });
      events.push(entry); bytes += encodedSize(entry);
      trim();
      if (pending) return;
      pending = true;
      try { schedule(() => {
        pending = false;
        try { storage?.setItem(key, JSON.stringify(snapshot())); } catch {}
        if (typeof options.transport === 'function') {
          const batch = events.filter(entry => entry.sequence > delivered);
          delivered = sequence;
          if (batch.length) try { options.transport({version:1, events:batch}); } catch {}
        }
      }); } catch { pending = false; }
    }
    return Object.freeze({ record, snapshot, export:() => JSON.stringify(snapshot(), null, 2) });
  }
  if (typeof module === 'object' && module.exports) module.exports = { createDiagnostics };
  else {
    let worker = null;
    try {
      const script = document.currentScript?.src;
      const workerUrl = new URL('spatial-diagnostics-worker.js', script || location.href);
      workerUrl.search = new URL(script || location.href).search;
      worker = new Worker(workerUrl);
      worker.onerror = () => { worker?.terminate(); worker = null; };
    } catch {}
    global.SpatialDiagnostics = createDiagnostics({ storage:null, transport: batch => worker?.postMessage(batch), schedule: fn => {
      global.setTimeout(() => {
        if (typeof global.requestIdleCallback === 'function') global.requestIdleCallback(fn, { timeout:1000 });
        else fn();
      }, 250);
    } });
    global.addEventListener('DOMContentLoaded', () => {
      document.getElementById('exportSpatialDiagnostics')?.addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([global.SpatialDiagnostics.export()], {type:'application/json'}));
        const link = document.createElement('a'); link.href=url; link.download='atom-web-diagnostics.json'; link.click();
        global.setTimeout(() => URL.revokeObjectURL(url),1000);
      });
    });
  }
})(typeof window === 'object' ? window : globalThis);
