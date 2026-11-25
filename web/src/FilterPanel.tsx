import { useEffect, useRef, useState } from 'react';
import type { EngineMeta, FilterState } from './types';

interface Props {
  meta: EngineMeta;
  filter: FilterState;
  onChange: (f: FilterState) => void;
  onReset: () => void;
}

function StateMultiSelect({
  states,
  value,
  onChange,
}: {
  states: EngineMeta['states'];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const shown = states.filter(
    (s) => s.name.toLowerCase().includes(q.toLowerCase()) || s.code.toLowerCase() === q.toLowerCase(),
  );
  const toggle = (code: string) =>
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);

  return (
    <div className="position-relative" ref={ref}>
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm w-100 text-start d-flex justify-content-between align-items-center"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="text-truncate">
          {value.length === 0
            ? 'All states & territories'
            : value.length <= 4
              ? value.join(', ')
              : `${value.length} selected`}
        </span>
        <i className={`bi bi-chevron-${open ? 'up' : 'down'} ms-2`} />
      </button>
      {open && (
        <div className="card shadow position-absolute w-100 mt-1 state-pop">
          <div className="p-2 border-bottom d-flex gap-2">
            <input
              autoFocus
              className="form-control form-control-sm"
              placeholder="Filter states…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onChange([])}>
              Clear
            </button>
          </div>
          <div className="state-list p-2">
            {shown.map((s) => (
              <div className="form-check" key={s.code}>
                <input
                  className="form-check-input"
                  type="checkbox"
                  id={`st-${s.code}`}
                  checked={value.includes(s.code)}
                  onChange={() => toggle(s.code)}
                />
                <label className="form-check-label" htmlFor={`st-${s.code}`}>
                  <span className="badge text-bg-secondary me-2 font-monospace">{s.code}</span>
                  {s.name}
                </label>
              </div>
            ))}
            {shown.length === 0 && <div className="text-body-secondary small">No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function ChipGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="mb-3">
      <label className="form-label small text-uppercase fw-semibold mb-1">{label}</label>
      <div className="d-flex flex-wrap gap-1">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button
              type="button"
              key={o}
              className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline-secondary'}`}
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Range({
  label,
  prefix,
  lo,
  hi,
  onLo,
  onHi,
  placeholders,
}: {
  label: string;
  prefix?: string;
  lo: string;
  hi: string;
  onLo: (v: string) => void;
  onHi: (v: string) => void;
  placeholders: [string, string];
}) {
  return (
    <div className="mb-3">
      <label className="form-label small text-uppercase fw-semibold mb-1">{label}</label>
      <div className="input-group input-group-sm">
        {prefix && <span className="input-group-text">{prefix}</span>}
        <input
          className="form-control"
          inputMode="numeric"
          placeholder={placeholders[0]}
          value={lo}
          onChange={(e) => onLo(e.target.value.replace(/[^\d.]/g, ''))}
          aria-label={`${label} minimum`}
        />
        <span className="input-group-text">to</span>
        {prefix && <span className="input-group-text">{prefix}</span>}
        <input
          className="form-control"
          inputMode="numeric"
          placeholder={placeholders[1]}
          value={hi}
          onChange={(e) => onHi(e.target.value.replace(/[^\d.]/g, ''))}
          aria-label={`${label} maximum`}
        />
      </div>
    </div>
  );
}

export function FilterPanel({ meta, filter, onChange, onReset }: Props) {
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) => onChange({ ...filter, [k]: v });

  return (
    <div className="card h-100">
      <div className="card-header d-flex justify-content-between align-items-center">
        <span className="fw-semibold">
          <i className="bi bi-funnel me-2" />
          Search &amp; filter
        </span>
        <button className="btn btn-sm btn-outline-secondary" onClick={onReset}>
          Reset
        </button>
      </div>
      <div className="card-body">
        <div className="mb-3">
          <label htmlFor="q" className="form-label small text-uppercase fw-semibold mb-1">
            Name
          </label>
          <div className="input-group input-group-sm">
            <span className="input-group-text">
              <i className="bi bi-search" />
            </span>
            <input
              id="q"
              className="form-control"
              placeholder="e.g. smith, mar smi"
              value={filter.text}
              onChange={(e) => set('text', e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="form-text">Each word matches part of a first or last name.</div>
        </div>

        <div className="row g-2 mb-3">
          <div className="col-6">
            <label htmlFor="rid" className="form-label small text-uppercase fw-semibold mb-1">
              Record ID
            </label>
            <input
              id="rid"
              className="form-control form-control-sm"
              inputMode="numeric"
              placeholder="e.g. 1234567"
              value={filter.id}
              onChange={(e) => set('id', e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div className="col-6">
            <label htmlFor="l4" className="form-label small text-uppercase fw-semibold mb-1">
              SSN last 4
            </label>
            <input
              id="l4"
              className="form-control form-control-sm font-monospace"
              inputMode="numeric"
              maxLength={4}
              placeholder="0000"
              value={filter.last4}
              onChange={(e) => set('last4', e.target.value.replace(/\D/g, ''))}
            />
          </div>
        </div>

        <div className="mb-3">
          <label className="form-label small text-uppercase fw-semibold mb-1">State / territory</label>
          <StateMultiSelect states={meta.states} value={filter.states} onChange={(v) => set('states', v)} />
        </div>

        <ChipGroup label="Benefit type" options={meta.types} value={filter.types} onChange={(v) => set('types', v)} />
        <ChipGroup label="Status" options={meta.statuses} value={filter.statuses} onChange={(v) => set('statuses', v)} />

        <Range
          label="Monthly benefit"
          prefix="$"
          lo={filter.minBenefit}
          hi={filter.maxBenefit}
          onLo={(v) => set('minBenefit', v)}
          onHi={(v) => set('maxBenefit', v)}
          placeholders={['min', 'max']}
        />
        <Range
          label="Birth year"
          lo={filter.minBirthYear}
          hi={filter.maxBirthYear}
          onLo={(v) => set('minBirthYear', v)}
          onHi={(v) => set('maxBirthYear', v)}
          placeholders={['1925', '2025']}
        />
        <Range
          label="Entitlement year"
          lo={filter.minEntYear}
          hi={filter.maxEntYear}
          onLo={(v) => set('minEntYear', v)}
          onHi={(v) => set('maxEntYear', v)}
          placeholders={['1974', '2026']}
        />
      </div>
    </div>
  );
}
