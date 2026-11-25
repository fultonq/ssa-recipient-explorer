import { fmtInt, fmtMoney, fmtMoneyCompact, fmtMs } from './format';
import type { EngineMeta, StatsResponse } from './types';

function Card({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
  return (
    <div className="col-6 col-xl-3">
      <div className="card h-100">
        <div className="card-body py-2">
          <div className="small text-uppercase text-body-secondary">
            <i className={`bi ${icon} me-1`} />
            {label}
          </div>
          <div className="fs-4 fw-semibold font-monospace">{value}</div>
          {sub && <div className="small text-body-secondary">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function BarList({ title, items, total }: { title: string; items: { label: string; n: number }[]; total: number }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  return (
    <div className="card h-100">
      <div className="card-header fw-semibold">{title}</div>
      <div className="card-body py-2">
        {items.map((i) => (
          <div className="bar-row" key={i.label} title={`${i.label}: ${fmtInt(i.n)}`}>
            <span className="bar-label text-truncate">{i.label}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(i.n / max) * 100}%` }} />
            </div>
            <span className="bar-n font-monospace">
              {fmtInt(i.n)}
              <span className="text-body-secondary"> {total ? ((i.n / total) * 100).toFixed(1) : '0.0'}%</span>
            </span>
          </div>
        ))}
        {items.length === 0 && <div className="text-body-secondary small">No data</div>}
      </div>
    </div>
  );
}

function Histogram({ hist, bucketCents }: { hist: number[]; bucketCents: number }) {
  const max = Math.max(1, ...hist);
  const W = 480, H = 120, pad = 18;
  const bw = (W - pad * 2) / hist.length;
  return (
    <div className="card h-100">
      <div className="card-header fw-semibold">Monthly benefit distribution</div>
      <div className="card-body py-2">
        <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-100" role="img" aria-label="Histogram of monthly benefit amounts">
          {hist.map((n, i) => {
            const h = (n / max) * H;
            return (
              <g key={i}>
                <rect className="hist-bar" x={pad + i * bw + 2} y={H - h} width={bw - 4} height={h}>
                  <title>
                    {fmtMoney(i * bucketCents)}
                    {i === hist.length - 1 ? '+' : `–${fmtMoney((i + 1) * bucketCents)}`}: {fmtInt(n)}
                  </title>
                </rect>
                <text className="hist-label" x={pad + i * bw + bw / 2} y={H + 14} textAnchor="middle">
                  {i === hist.length - 1 ? `${(i * bucketCents) / 100000}k+` : `${((i * bucketCents) / 100000).toFixed(1)}k`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function StatsPanel({
  stats,
  meta,
  timingLabel,
}: {
  stats: StatsResponse | null;
  meta: EngineMeta;
  timingLabel?: string;
}) {
  if (!stats) {
    return (
      <div className="text-body-secondary small py-3">
        <span className="spinner-border spinner-border-sm me-2" />
        Computing aggregates…
      </div>
    );
  }
  const states = stats.byState
    .map((n, i) => ({ label: meta.states[i].name, n }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const types = stats.byType.map((n, i) => ({ label: meta.types[i], n }));
  const statuses = stats.byStatus.map((n, i) => ({ label: meta.statuses[i], n }));

  return (
    <div className="row g-3">
      <Card icon="bi-people" label="Recipients" value={fmtInt(stats.count)} sub={`aggregated in ${fmtMs(stats.elapsedMs)}${timingLabel ? ` · ${timingLabel}` : ''}`} />
      <Card icon="bi-cash-stack" label="Monthly outlay" value={fmtMoneyCompact(stats.sumCents)} sub={`${fmtMoneyCompact(stats.sumCents * 12)} / year`} />
      <Card icon="bi-calculator" label="Average benefit" value={fmtMoney(stats.avgCents)} />
      <Card icon="bi-arrows-expand" label="Min / max" value={`${fmtMoneyCompact(stats.minCents)} – ${fmtMoneyCompact(stats.maxCents)}`} />
      <div className="col-12 col-lg-6 col-xl-3">
        <BarList title="By benefit type" items={types} total={stats.count} />
      </div>
      <div className="col-12 col-lg-6 col-xl-3">
        <BarList title="By status" items={statuses} total={stats.count} />
      </div>
      <div className="col-12 col-lg-6 col-xl-3">
        <BarList title="Top states" items={states} total={stats.count} />
      </div>
      <div className="col-12 col-lg-6 col-xl-3">
        <Histogram hist={stats.benefitHist} bucketCents={meta.histBucketCents} />
      </div>
    </div>
  );
}
