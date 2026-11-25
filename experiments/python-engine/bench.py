"""Python comparison for the SSA engine's core queries on 5M synthetic rows.
Same column layout as the C++ engine (struct-of-arrays, dictionary-coded names).
Data distribution is approximate (not bit-identical to the C++ generator); the
workload shape - scan, filter, top-50 - is what is being compared."""
import sys, time
import numpy as np

N = int(sys.argv[1]) if len(sys.argv) > 1 else 5_000_000
rng = np.random.default_rng(2026)
typ = rng.choice(6, N, p=[.54, .13, .09, .12, .05, .07]).astype(np.uint8)
status = rng.choice(4, N, p=[.92, .03, .02, .03]).astype(np.uint8)
state = rng.integers(0, 52, N, dtype=np.uint8)
cents = rng.integers(10_000, 420_000, N, dtype=np.uint32)
last = rng.integers(0, 560, N, dtype=np.uint16)
first = rng.integers(0, 128, N, dtype=np.uint16)

def best(f, reps=5):
    b, out = 1e9, None
    for _ in range(reps):
        t = time.perf_counter(); out = f(); b = min(b, time.perf_counter() - t)
    return b * 1000, out

def topk(idx, key, k=50, desc=False):
    v = key[idx]
    v = -v.astype(np.int64) if desc else v
    part = np.argpartition(v, k)[:k]
    return idx[part[np.argsort(v[part], kind="stable")]]

print(f"numpy {np.__version__}, {N:,} rows")

# --- NumPy (vectorised; C loops underneath) ---
def q_disability():
    m = (typ == 1) & (status == 0) & (cents >= 120_000) & (cents <= 200_000)
    idx = np.flatnonzero(m)
    return len(idx), topk(idx, cents)
ms, (tot, _) = best(q_disability); print(f"numpy  Disability+Active+$1.2-2k, top50 by benefit {ms:8.1f} ms  total={tot}")

fm = rng.random(128) < .03; lm = rng.random(560) < .05   # per-dictionary-entry token match tables
def q_text():
    m = fm[first] | lm[last]
    return int(m.sum()), np.flatnonzero(m)[:50]
ms, (tot, _) = best(q_text); print(f"numpy  name search via dictionary tables, first 50   {ms:8.1f} ms  total={tot}")

def q_unfiltered_top():
    idx = np.arange(N, dtype=np.uint32)
    return N, topk(idx, cents, desc=True)
ms, _ = best(q_unfiltered_top); print(f"numpy  unfiltered top50 by benefit                   {ms:8.1f} ms")

def q_stats():
    return (np.bincount(state, minlength=52), np.bincount(typ, minlength=6),
            np.bincount(status, minlength=4), int(cents.sum(dtype=np.uint64)),
            np.bincount(np.minimum(cents // 50_000, 11), minlength=12))
ms, _ = best(q_stats); print(f"numpy  aggregates (bincounts + sum)                  {ms:8.1f} ms")

# --- Pure Python (what a naive list-of-records version costs) ---
n_py = min(N, 1_000_000)
typ_l, status_l, cents_l = typ[:n_py].tolist(), status[:n_py].tolist(), cents[:n_py].tolist()
def q_pure():
    out = [i for i in range(n_py) if typ_l[i] == 1 and status_l[i] == 0 and 120_000 <= cents_l[i] <= 200_000]
    return len(out)
ms, tot = best(q_pure, reps=3)
print(f"pure   Disability+Active+$1.2-2k on {n_py:,} rows (filter only) {ms:8.1f} ms  -> ~{ms*N/n_py:,.0f} ms at {N:,}")
