import { fmtInt, fmtMs } from './format';
import { BACKEND_LABEL, type Backend } from './types';

export type CrossCheckState =
  | { status: 'running'; main: Backend; other: Backend }
  | { status: 'match' | 'mismatch'; main: Backend; other: Backend; mainMs: number; otherMs: number; total: number; otherTotal: number };

/** Live evidence for the demo: the same request answered by the other backend, compared record by record. */
export function CrossCheck({ state }: { state: CrossCheckState | null }) {
  if (!state) return null;
  if (state.status === 'running') {
    return (
      <div className="small text-body-secondary cross-check" role="status">
        <span className="spinner-border spinner-border-sm me-2" />
        Cross-checking this page with {BACKEND_LABEL[state.other]}…
      </div>
    );
  }
  if (state.status === 'mismatch') {
    return (
      <div className="alert alert-danger py-2 mb-0 small" role="alert">
        <i className="bi bi-x-octagon me-2" />
        Backends disagree: {BACKEND_LABEL[state.main]} found {fmtInt(state.total)} matches, {BACKEND_LABEL[state.other]}{' '}
        found {fmtInt(state.otherTotal)} (or returned a different page). Please report this request.
      </div>
    );
  }
  const engineMs = state.main === 'engine' ? state.mainMs : state.otherMs;
  const pgMs = state.main === 'postgres' ? state.mainMs : state.otherMs;
  const ratio = engineMs > 0.05 ? pgMs / engineMs : null;
  return (
    <div className="small cross-check cross-check-ok" role="status">
      <i className="bi bi-check2-circle me-2" />
      Cross-check: {BACKEND_LABEL[state.other]} returned the <strong>identical page</strong> ({fmtInt(state.total)} matches).
      <span className="font-monospace ms-2">
        C++ engine {fmtMs(engineMs)} · PostgreSQL {fmtMs(pgMs)}
        {ratio !== null && ratio >= 1.05 && <> · engine {ratio.toFixed(1)}× faster</>}
      </span>
    </div>
  );
}
