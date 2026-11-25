import { useState } from 'react';
import { fmtInt, fmtMoney, fmtMs, fmtRecordId, maskedSsn } from './format';
import type { QueryResponse, RecipientRecord, SortKey } from './types';

interface Props {
  /** Which backend answered, shown beside the timing badge (server mode). */
  timingLabel?: string;
  data: QueryResponse | null;
  loading: boolean;
  sort: SortKey;
  desc: boolean;
  onSort: (k: SortKey) => void;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  onSelect: (r: RecipientRecord) => void;
}

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: 'id', label: 'Record ID' },
  { key: 'lastName', label: 'Last name' },
  { key: 'firstName', label: 'First name' },
  { key: 'state', label: 'State' },
  { key: 'birthYear', label: 'Born', className: 'text-end' },
  { key: 'entitlementYear', label: 'Entitled', className: 'text-end' },
  { key: 'benefit', label: 'Monthly benefit', className: 'text-end' },
];

const STATUS_BADGE: Record<string, string> = {
  Active: 'text-bg-success',
  Pending: 'text-bg-info',
  Suspended: 'text-bg-warning',
  Terminated: 'text-bg-danger',
};

function toCsv(rows: RecipientRecord[]): string {
  const head = ['id', 'lastName', 'firstName', 'state', 'zip3', 'birthYear', 'entitlementYear', 'type', 'status', 'monthlyBenefit'];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [fmtRecordId(r.id), r.lastName, r.firstName, r.state, r.zip3, r.birthYear, r.entitlementYear, r.type, r.status, (r.monthlyCents / 100).toFixed(2)]
      .map(esc)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}

export function ResultsTable(p: Props) {
  const [goto, setGoto] = useState('');
  const total = p.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / p.pageSize));
  const first = total === 0 ? 0 : p.page * p.pageSize + 1;
  const last = Math.min(total, (p.page + 1) * p.pageSize);

  const exportPage = () => {
    if (!p.data) return;
    const blob = new Blob([toCsv(p.data.records)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ssa-synthetic-page-${p.page + 1}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const submitGoto = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(goto, 10);
    if (Number.isFinite(n)) p.onPage(Math.min(pages, Math.max(1, n)) - 1);
    setGoto('');
  };

  return (
    <div className="card">
      <div className="card-header d-flex flex-wrap gap-2 justify-content-between align-items-center">
        <div>
          <span className="fw-semibold">
            <i className="bi bi-table me-2" />
            {p.data ? fmtInt(total) : '—'} matching recipients
          </span>
          {p.data && (
            <span className="badge text-bg-secondary ms-2 font-monospace" title="Engine query time (C++/WASM)">
              {fmtMs(p.data.elapsedMs)}
              {p.timingLabel && ` · ${p.timingLabel}`}
            </span>
          )}
          {p.loading && <span className="spinner-border spinner-border-sm ms-2" role="status" aria-label="Loading" />}
        </div>
        <div className="d-flex gap-2 align-items-center">
          <label className="small text-body-secondary" htmlFor="ps">
            Rows
          </label>
          <select
            id="ps"
            className="form-select form-select-sm w-auto"
            value={p.pageSize}
            onChange={(e) => p.onPageSize(Number(e.target.value))}
          >
            {[25, 50, 100, 250].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <button className="btn btn-sm btn-outline-secondary" onClick={exportPage} disabled={!p.data?.records.length}>
            <i className="bi bi-download me-1" />
            CSV
          </button>
        </div>
      </div>

      <div className="table-responsive results-scroll">
        <table className="table table-sm table-hover align-middle mb-0">
          <thead className="sticky-top">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={`sortable ${c.className ?? ''}`}
                  onClick={() => p.onSort(c.key)}
                  aria-sort={p.sort === c.key ? (p.desc ? 'descending' : 'ascending') : 'none'}
                  scope="col"
                >
                  {c.label}
                  {p.sort === c.key && <i className={`bi ms-1 bi-caret-${p.desc ? 'down' : 'up'}-fill`} />}
                </th>
              ))}
              <th scope="col">Type</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody className={p.loading ? 'opacity-50' : ''}>
            {p.data?.records.map((r) => (
              <tr key={r.id} role="button" tabIndex={0} onClick={() => p.onSelect(r)} onKeyDown={(e) => e.key === 'Enter' && p.onSelect(r)}>
                <td className="font-monospace">{fmtRecordId(r.id)}</td>
                <td>{r.lastName}</td>
                <td>{r.firstName}</td>
                <td>
                  <span className="badge text-bg-secondary font-monospace">{r.state}</span>
                </td>
                <td className="text-end">{r.birthYear}</td>
                <td className="text-end">{r.entitlementYear}</td>
                <td className="text-end font-monospace">{fmtMoney(r.monthlyCents)}</td>
                <td>{r.type}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[r.status] ?? 'text-bg-secondary'}`}>{r.status}</span>
                </td>
              </tr>
            ))}
            {p.data && p.data.records.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-body-secondary py-5">
                  No recipients match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card-footer d-flex flex-wrap gap-2 justify-content-between align-items-center">
        <span className="small text-body-secondary">
          {fmtInt(first)}–{fmtInt(last)} of {fmtInt(total)}
        </span>
        <div className="d-flex gap-2 align-items-center">
          <div className="btn-group btn-group-sm">
            <button className="btn btn-outline-secondary" disabled={p.page === 0} onClick={() => p.onPage(0)} aria-label="First page">
              <i className="bi bi-chevron-double-left" />
            </button>
            <button className="btn btn-outline-secondary" disabled={p.page === 0} onClick={() => p.onPage(p.page - 1)} aria-label="Previous page">
              <i className="bi bi-chevron-left" />
            </button>
            <span className="btn btn-outline-secondary disabled font-monospace">
              {fmtInt(p.page + 1)} / {fmtInt(pages)}
            </span>
            <button className="btn btn-outline-secondary" disabled={p.page >= pages - 1} onClick={() => p.onPage(p.page + 1)} aria-label="Next page">
              <i className="bi bi-chevron-right" />
            </button>
            <button className="btn btn-outline-secondary" disabled={p.page >= pages - 1} onClick={() => p.onPage(pages - 1)} aria-label="Last page">
              <i className="bi bi-chevron-double-right" />
            </button>
          </div>
          <form onSubmit={submitGoto} className="d-flex">
            <input
              className="form-control form-control-sm text-center"
              style={{ width: '5.5rem' }}
              placeholder="Go to…"
              inputMode="numeric"
              aria-label="Go to page"
              value={goto}
              onChange={(e) => setGoto(e.target.value.replace(/\D/g, ''))}
            />
          </form>
        </div>
      </div>
    </div>
  );
}

export function RecordModal({ record, onClose }: { record: RecipientRecord | null; onClose: () => void }) {
  if (!record) return null;
  const rows: [string, string][] = [
    ['Record ID', fmtRecordId(record.id)],
    ['Name', `${record.firstName} ${record.lastName}`],
    ['SSN (masked)', maskedSsn(record.last4)],
    ['Birth year', String(record.birthYear)],
    ['State / ZIP3', `${record.stateName} (${record.state}) · ${record.zip3}xx`],
    ['Benefit type', record.type],
    ['Status', record.status],
    ['Monthly benefit', fmtMoney(record.monthlyCents)],
    ['Annualized', fmtMoney(record.monthlyCents * 12)],
    ['Entitlement year', String(record.entitlementYear)],
  ];
  return (
    <>
      <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" onClick={onClose}>
        <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                <i className="bi bi-person-vcard me-2" />
                Recipient record
              </h5>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              <dl className="row mb-0">
                {rows.map(([k, v]) => (
                  <div className="row mb-1" key={k}>
                    <dt className="col-5 text-body-secondary fw-normal">{k}</dt>
                    <dd className="col-7 mb-0 font-monospace">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="modal-footer justify-content-between">
              <span className="small text-body-secondary">Synthetic data — not a real person.</span>
              <button className="btn btn-secondary btn-sm" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
  );
}
