/* Hosts the C++/WebAssembly engine off the main thread so a 5M-record scan
 * never blocks the UI. Protocol: {id, op, payload} -> {id, ok, result|error}.
 * Ops: init {count, seed}, meta, query {json}, stats {json}, get {id}.
 * The Emscripten glue (MODULARIZE, EXPORT_NAME=createSsaEngine) is produced by
 * `cmake --build engine/build-wasm` into ./wasm/ssa_engine.{js,wasm}. */
'use strict';

let api = null;
let loadError = null;

async function boot() {
  try {
    importScripts(new URL('wasm/ssa_engine.js', self.location.href).href);
  } catch (e) {
    loadError =
      'WebAssembly engine not found (public/wasm/ssa_engine.js). Build it with: ' +
      'cd engine && emcmake cmake -B build-wasm && cmake --build build-wasm';
    return;
  }
  try {
    const M = await createSsaEngine({
      locateFile: (p) => new URL('wasm/' + p, self.location.href).href,
    });
    api = {
      init: M.cwrap('ssa_init', 'number', ['number', 'number']),
      meta: M.cwrap('ssa_meta', 'string', []),
      query: M.cwrap('ssa_query', 'string', ['string']),
      stats: M.cwrap('ssa_stats', 'string', ['string']),
      get: M.cwrap('ssa_get', 'string', ['number']),
    };
  } catch (e) {
    loadError = 'Failed to start WebAssembly engine: ' + (e && e.message ? e.message : String(e));
  }
}

const ready = boot();

self.onmessage = async (ev) => {
  const { id, op, payload } = ev.data;
  await ready;
  if (loadError) {
    self.postMessage({ id, ok: false, error: loadError });
    return;
  }
  try {
    let result;
    switch (op) {
      case 'init': {
        const t0 = performance.now();
        const n = api.init(payload.count >>> 0, payload.seed >>> 0);
        result = { count: n, buildMs: performance.now() - t0, meta: JSON.parse(api.meta()) };
        break;
      }
      case 'meta':
        result = JSON.parse(api.meta());
        break;
      case 'query':
        result = JSON.parse(api.query(payload.json));
        break;
      case 'stats':
        result = JSON.parse(api.stats(payload.json));
        break;
      case 'get':
        result = JSON.parse(api.get(payload.id >>> 0));
        break;
      default:
        throw new Error('unknown op ' + op);
    }
    if (result && result.error) throw new Error(result.error);
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e && e.message ? e.message : String(e) });
  }
};
