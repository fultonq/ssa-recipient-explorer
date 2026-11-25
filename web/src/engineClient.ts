import type {
  Backend,
  EngineMeta,
  FilterState,
  InitResult,
  QueryResponse,
  RecipientRecord,
  SortKey,
  StatsResponse,
} from './types';

/** Turns UI filter state into the JSON request understood by the C++ engine (and the SQL backend). */
export function filterToRequest(f: FilterState): Record<string, unknown> {
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const req: Record<string, unknown> = {};
  if (f.text.trim()) req.text = f.text.trim();
  if (f.states.length) req.states = f.states;
  if (f.types.length) req.types = f.types;
  if (f.statuses.length) req.statuses = f.statuses;
  const put = (key: string, v: string) => {
    const n = num(v);
    if (n !== undefined && Number.isFinite(n)) req[key] = n;
  };
  put('minBenefit', f.minBenefit);
  put('maxBenefit', f.maxBenefit);
  put('minBirthYear', f.minBirthYear);
  put('maxBirthYear', f.maxBirthYear);
  put('minEntYear', f.minEntYear);
  put('maxEntYear', f.maxEntYear);
  put('last4', f.last4);
  put('id', f.id);
  return req;
}

/** One API, two transports: ssa_server over HTTP, or the WebAssembly engine in a Web Worker. */
export interface EngineApi {
  readonly mode: 'server' | 'wasm';
  init(count: number): Promise<InitResult>;
  query(f: FilterState, sort: SortKey, desc: boolean, offset: number, limit: number, backend?: Backend): Promise<QueryResponse>;
  stats(f: FilterState, backend?: Backend): Promise<StatsResponse>;
  get(id: number, backend?: Backend): Promise<RecipientRecord>;
  dispose(): void;
}

// ---------------------------------------------------------------- HTTP (ssa_server)
const API = `${import.meta.env.BASE_URL}api`;

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: 'no-store', ...init });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok || (body && body.error)) throw new Error(body?.error ?? `server error ${res.status}`);
  return body as T;
}

export class HttpEngineClient implements EngineApi {
  readonly mode = 'server' as const;

  async init(): Promise<InitResult> {
    const [health, meta] = await Promise.all([
      http<{ records: number; loadSeconds: number }>('/health'),
      http<EngineMeta>('/meta'),
    ]);
    return { count: health.records, buildMs: health.loadSeconds * 1000, meta, mode: 'server' };
  }

  query(f: FilterState, sort: SortKey, desc: boolean, offset: number, limit: number, backend: Backend = 'engine') {
    return http<QueryResponse>(`/query?backend=${backend}`, {
      method: 'POST',
      body: JSON.stringify({ ...filterToRequest(f), sort, desc, offset, limit }),
    });
  }

  stats(f: FilterState, backend: Backend = 'engine') {
    return http<StatsResponse>(`/stats?backend=${backend}`, { method: 'POST', body: JSON.stringify(filterToRequest(f)) });
  }

  get(id: number, backend: Backend = 'engine') {
    return http<RecipientRecord>(`/records/${id}?backend=${backend}`);
  }

  dispose() {}
}

// ---------------------------------------------------------------- WebAssembly (no server)
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class WorkerEngineClient implements EngineApi {
  readonly mode = 'wasm' as const;
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(`${import.meta.env.BASE_URL}engine.worker.js`);
    this.worker.onmessage = (ev: MessageEvent) => {
      const { id, ok, result, error } = ev.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      ok ? p.resolve(result) : p.reject(new Error(error));
    };
    this.worker.onerror = (ev) => {
      const err = new Error(ev.message || 'engine worker crashed');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  private call<T>(op: string, payload?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, payload });
    });
  }

  async init(count: number, seed = 2026): Promise<InitResult> {
    const r = await this.call<Omit<InitResult, 'mode'>>('init', { count, seed });
    return { ...r, mode: 'wasm' };
  }

  query(f: FilterState, sort: SortKey, desc: boolean, offset: number, limit: number): Promise<QueryResponse> {
    return this.call('query', { json: JSON.stringify({ ...filterToRequest(f), sort, desc, offset, limit }) });
  }

  stats(f: FilterState): Promise<StatsResponse> {
    return this.call('stats', { json: JSON.stringify(filterToRequest(f)) });
  }

  get(id: number): Promise<RecipientRecord> {
    return this.call('get', { id });
  }

  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }
}

/** Prefer ssa_server when one answers on the same origin; otherwise run the engine in the browser. */
export async function createEngineClient(): Promise<EngineApi> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2000);
    const res = await fetch(`${API}/health`, { cache: 'no-store', signal: ctl.signal });
    clearTimeout(t);
    if (res.ok) {
      const h = await res.json();
      if (Array.isArray(h?.backends)) return new HttpEngineClient();
    }
  } catch {
    /* no server: fall through to WebAssembly */
  }
  return new WorkerEngineClient();
}
