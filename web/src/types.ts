export interface StateInfo {
  code: string;
  name: string;
}

export interface EngineMeta {
  count: number;
  memoryBytes: number;
  states: StateInfo[];
  types: string[];
  statuses: string[];
  histBucketCents: number;
  /** Present when served by ssa_server: which backends can answer queries. */
  backends?: Backend[];
  /** Where the engine's data came from: 'postgres' or 'generate' (server) - absent in WebAssembly mode. */
  source?: string;
  server?: boolean;
}

export type Backend = 'engine' | 'postgres';
export const BACKEND_LABEL: Record<Backend, string> = { engine: 'C++ engine', postgres: 'PostgreSQL' };

export interface RecipientRecord {
  id: number;
  firstName: string;
  lastName: string;
  last4: string;
  birthYear: number;
  state: string;
  stateName: string;
  zip3: string;
  type: string;
  status: string;
  monthlyCents: number;
  entitlementYear: number;
}

export type SortKey =
  | 'id'
  | 'lastName'
  | 'firstName'
  | 'benefit'
  | 'birthYear'
  | 'entitlementYear'
  | 'state';

/** UI-side filter state; empty arrays / empty strings mean "no restriction". */
export interface FilterState {
  text: string;
  states: string[];
  types: string[];
  statuses: string[];
  minBenefit: string;
  maxBenefit: string;
  minBirthYear: string;
  maxBirthYear: string;
  minEntYear: string;
  maxEntYear: string;
  last4: string;
  id: string;
}

export const emptyFilter: FilterState = {
  text: '',
  states: [],
  types: [],
  statuses: [],
  minBenefit: '',
  maxBenefit: '',
  minBirthYear: '',
  maxBirthYear: '',
  minEntYear: '',
  maxEntYear: '',
  last4: '',
  id: '',
};

export interface QueryResponse {
  total: number;
  offset: number;
  limit: number;
  elapsedMs: number;
  records: RecipientRecord[];
}

export interface StatsResponse {
  count: number;
  sumCents: number;
  minCents: number;
  maxCents: number;
  avgCents: number;
  byState: number[];
  byType: number[];
  byStatus: number[];
  benefitHist: number[];
  elapsedMs: number;
}

export interface InitResult {
  count: number;
  buildMs: number;
  meta: EngineMeta;
  /** 'server': ssa_server over HTTP (engine + PostgreSQL); 'wasm': engine in a Web Worker, no server. */
  mode: 'server' | 'wasm';
}
