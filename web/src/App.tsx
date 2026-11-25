import { useEffect, useMemo, useRef, useState } from 'react';
import { CrossCheck, type CrossCheckState } from './CrossCheck';
import { createEngineClient, type EngineApi } from './engineClient';
import { FilterPanel } from './FilterPanel';
import { fmtInt, fmtMB } from './format';
import { RecordModal, ResultsTable } from './ResultsTable';
import { StatsPanel } from './StatsPanel';
import {
  BACKEND_LABEL,
  emptyFilter,
  type Backend,
  type FilterState,
  type InitResult,
  type QueryResponse,
  type RecipientRecord,
  type SortKey,
  type StatsResponse,
} from './types';

const SIZES = [100_000, 1_000_000, 2_500_000, 5_000_000];
type Theme = '3270' | 'standard';

function loadTheme(): Theme {
  try {
    return localStorage.getItem('ssa-theme') === 'standard' ? 'standard' : '3270';
  } catch {
    return '3270';
  }
}

export default function App() {
  const [client, setClient] = useState<EngineApi | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [size, setSize] = useState(1_000_000);
  const [init, setInit] = useState<InitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterState>(emptyFilter);
  const [sort, setSort] = useState<SortKey>('id');
  const [desc, setDesc] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const [data, setData] = useState<QueryResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<RecipientRecord | null>(null);
  const [backend, setBackend] = useState<Backend>('engine');
  const [crossCheckOn, setCrossCheckOn] = useState(true);
  const [check, setCheck] = useState<CrossCheckState | null>(null);

  const querySeq = useRef(0);
  const statsSeq = useRef(0);

  // Theme -> <html> attributes (Bootstrap 5.3 reads data-bs-theme).
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-theme', theme);
    el.setAttribute('data-bs-theme', theme === '3270' ? 'dark' : 'light');
    try {
      localStorage.setItem('ssa-theme', theme);
    } catch {
      /* storage unavailable - non-fatal */
    }
  }, [theme]);

  // One client for the lifetime of the app: ssa_server if one answers, else the WebAssembly worker.
  useEffect(() => {
    let disposed = false;
    let made: EngineApi | null = null;
    createEngineClient().then((c) => {
      if (disposed) return c.dispose();
      made = c;
      setClient(c);
    });
    return () => {
      disposed = true;
      made?.dispose();
    };
  }, []);

  const serverMode = init?.mode === 'server';
  const canCompare = serverMode && (init?.meta.backends ?? []).includes('postgres');

  // (Re)build the dataset whenever the size changes.
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setInit(null);
    setData(null);
    setStats(null);
    setError(null);
    client
      .init(size)
      .then((r) => !cancelled && setInit(r))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [client, size]);

  // Page of results (debounced; stale responses are dropped). With cross-check on, the same request is
  // then answered by the other backend and compared record by record.
  useEffect(() => {
    if (!client || !init) return;
    const seq = ++querySeq.current;
    const live = () => seq === querySeq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const offset = page * pageSize;
        const r = await client.query(filter, sort, desc, offset, pageSize, backend);
        if (!live()) return;
        setData(r);
        setLoading(false);
        if (!(canCompare && crossCheckOn)) return setCheck(null);
        const other: Backend = backend === 'engine' ? 'postgres' : 'engine';
        setCheck({ status: 'running', main: backend, other });
        const o = await client.query(filter, sort, desc, offset, pageSize, other);
        if (!live()) return;
        const same =
          o.total === r.total &&
          o.records.length === r.records.length &&
          o.records.every((x, i) => x.id === r.records[i].id && x.monthlyCents === r.records[i].monthlyCents);
        setCheck({
          status: same ? 'match' : 'mismatch',
          main: backend,
          other,
          mainMs: r.elapsedMs,
          otherMs: o.elapsedMs,
          total: r.total,
          otherTotal: o.total,
        });
      } catch (e) {
        if (live()) {
          setError((e as Error).message);
          setLoading(false);
          setCheck(null);
        }
      }
    }, 120);
    return () => clearTimeout(t);
  }, [client, init, filter, sort, desc, page, pageSize, backend, crossCheckOn, canCompare]);

  // Aggregates depend on the filter only.
  useEffect(() => {
    if (!client || !init) return;
    const seq = ++statsSeq.current;
    const t = setTimeout(() => {
      client
        .stats(filter, backend)
        .then((r) => seq === statsSeq.current && setStats(r))
        .catch((e: Error) => seq === statsSeq.current && setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [client, init, filter, backend]);

  const changeFilter = (f: FilterState) => {
    setFilter(f);
    setPage(0);
  };
  const onSort = (k: SortKey) => {
    if (k === sort) setDesc(!desc);
    else {
      setSort(k);
      setDesc(false);
    }
    setPage(0);
  };

  const activeFilters = useMemo(
    () => Object.entries(filter).filter(([, v]) => (Array.isArray(v) ? v.length : String(v).trim() !== '')).length,
    [filter],
  );

  return (
    <>
      <nav className="navbar app-nav border-bottom">
        <div className="container-fluid gap-3 flex-wrap">
          <div className="d-flex align-items-center gap-3">
            <i className="bi bi-shield-check fs-3" />
            <div className="lh-sm">
              <div className="navbar-brand fw-bold mb-0 p-0">SSA Recipient Explorer</div>
              <div className="small text-body-secondary">
                {serverMode ? 'C++23 engine · PostgreSQL · React + Bootstrap' : 'C++23 engine · WebAssembly · React + Bootstrap'}
              </div>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            {init && (
              <span className="small text-body-secondary d-none d-md-inline font-monospace">
                {fmtInt(init.count)} records · {fmtMB(init.meta.memoryBytes)} ·{' '}
                {serverMode && init.meta.source === 'postgres'
                  ? `loaded from PostgreSQL in ${(init.buildMs / 1000).toFixed(1)} s`
                  : `built in ${Math.round(init.buildMs)} ms`}
              </span>
            )}
            {canCompare && (
              <>
                <div className="btn-group btn-group-sm" role="group" aria-label="Query backend">
                  {(['engine', 'postgres'] as Backend[]).map((b) => (
                    <button
                      key={b}
                      type="button"
                      className={`btn ${backend === b ? 'btn-primary' : 'btn-outline-secondary'}`}
                      aria-pressed={backend === b}
                      onClick={() => {
                        setBackend(b);
                        setPage(0);
                      }}
                    >
                      <i className={`bi ${b === 'engine' ? 'bi-cpu' : 'bi-database'} me-1`} />
                      {BACKEND_LABEL[b]}
                    </button>
                  ))}
                </div>
                <div className="form-check form-switch mb-0 small">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    role="switch"
                    id="xcheck"
                    checked={crossCheckOn}
                    onChange={(e) => setCrossCheckOn(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="xcheck">
                    Cross-check
                  </label>
                </div>
              </>
            )}
            {!serverMode && <select
              className="form-select form-select-sm w-auto"
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(0);
              }}
              aria-label="Dataset size"
            >
              {SIZES.map((n) => (
                <option key={n} value={n}>
                  {fmtInt(n)} records
                </option>
              ))}
            </select>}
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => setTheme(theme === '3270' ? 'standard' : '3270')}
              title="Switch between 3270 phosphor-green and standard Bootstrap"
            >
              <i className={`bi ${theme === '3270' ? 'bi-sun' : 'bi-terminal'} me-1`} />
              {theme === '3270' ? 'Standard' : '3270'}
            </button>
          </div>
        </div>
      </nav>

      <div className="alert alert-warning rounded-0 border-0 border-bottom mb-0 py-1 small">
        <i className="bi bi-exclamation-triangle me-2" />
        Demonstration system: every record is <strong>synthetic</strong>. No real SSNs or personal data are
        generated, stored, or transmitted.
      </div>

      <main className="container-fluid py-3">
        {error && (
          <div className="alert alert-danger d-flex justify-content-between align-items-start" role="alert">
            <div>
              <i className="bi bi-x-octagon me-2" />
              {error}
            </div>
            <button type="button" className="btn-close" aria-label="Dismiss" onClick={() => setError(null)} />
          </div>
        )}

        {!init && !error && (
          <div className="text-center py-5">
            <div className="spinner-border mb-3" role="status" />
            <div>{client?.mode === 'server' ? 'Connecting to ssa_server…' : `Building ${fmtInt(size)} records in the WebAssembly engine…`}</div>
          </div>
        )}

        {init && (
          <div className="row g-3">
            <div className="col-12 col-lg-4 col-xl-3">
              <FilterPanel
                meta={init.meta}
                filter={filter}
                onChange={changeFilter}
                onReset={() => changeFilter(emptyFilter)}
              />
            </div>
            <div className="col-12 col-lg-8 col-xl-9 d-flex flex-column gap-3">
              <div className="small text-body-secondary">
                {activeFilters === 0 ? 'Showing all recipients' : `${activeFilters} filter${activeFilters > 1 ? 's' : ''} active`}
              </div>
              <StatsPanel stats={stats} meta={init.meta} timingLabel={serverMode ? BACKEND_LABEL[backend] : undefined} />
              <CrossCheck state={canCompare && crossCheckOn ? check : null} />
              <ResultsTable
                data={data}
                loading={loading}
                timingLabel={serverMode ? BACKEND_LABEL[backend] : undefined}
                sort={sort}
                desc={desc}
                onSort={onSort}
                page={page}
                pageSize={pageSize}
                onPage={setPage}
                onPageSize={(n) => {
                  setPageSize(n);
                  setPage(0);
                }}
                onSelect={setSelected}
              />
            </div>
          </div>
        )}
      </main>

      <RecordModal record={selected} onClose={() => setSelected(null)} />
    </>
  );
}
