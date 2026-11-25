"""NumPy oracle for the SSA engine.

Loads the exact columns exported by the C++ engine, re-implements filter / text search / sort /
paginate / aggregate independently in NumPy, then fuzzes both with random JSON queries and
compares: total, page ids, and every aggregate. Any mismatch is a bug in one of the two.

Usage:  python3 oracle.py [records=1000000] [queries=300] [seed=1]
Needs:  numpy, and the native build at ../../engine/build/ssa_cli
"""
import json, math, os, subprocess, sys, tempfile, time
import numpy as np

N = int(sys.argv[1]) if len(sys.argv) > 1 else 1_000_000
Q = int(sys.argv[2]) if len(sys.argv) > 2 else 300
SEED = int(sys.argv[3]) if len(sys.argv) > 3 else 1
CLI = os.environ.get("SSA_CLI") or os.path.join(os.path.dirname(__file__), "../../engine/build/ssa_cli")

STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
          "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","PR","RI","SC",
          "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"]
TYPES = ["Retirement", "Disability", "Survivor", "SSI", "Spouse", "Child"]
STATUSES = ["Active", "Pending", "Suspended", "Terminated"]

tmp = tempfile.mkdtemp(prefix="ssa-oracle-")

# ---------------------------------------------------------------- random queries
rnd = np.random.default_rng(SEED)

def read_dict(name):
    return [w.rstrip("\n") for w in open(os.path.join(tmp, name))]

def pick(seq, k):
    return [seq[i] for i in rnd.choice(len(seq), size=k, replace=False)]

def random_request(first_dict, last_dict):
    r = {}
    if rnd.random() < .5:  # 1-2 tokens, mostly real name fragments, sometimes garbage
        toks = []
        for _ in range(int(rnd.integers(1, 3))):
            if rnd.random() < .1: toks.append("zzq")
            else:
                w = (first_dict if rnd.random() < .5 else last_dict)[int(rnd.integers(0, 100))].lower()
                a = int(rnd.integers(0, max(1, len(w) - 2))); toks.append(w[a:a + int(rnd.integers(2, 5))])
        r["text"] = " ".join(toks) if rnd.random() < .8 else "  " + toks[0].upper() + "  "
    if rnd.random() < .4: r["states"] = pick(STATES, int(rnd.integers(0, 8)))
    if rnd.random() < .4: r["types"] = pick(TYPES, int(rnd.integers(0, 4)))
    if rnd.random() < .4: r["statuses"] = pick(STATUSES, int(rnd.integers(0, 4)))
    if rnd.random() < .4: r["minBenefit"] = round(float(rnd.uniform(0, 3000)), 2)
    if rnd.random() < .4: r["maxBenefit"] = round(float(rnd.uniform(500, 4500)), 2)  # may be < min: impossible case
    for key, lo, hi in [("minBirthYear", 1925, 2010), ("maxBirthYear", 1925, 2010),
                        ("minEntYear", 1974, 2026), ("maxEntYear", 1974, 2026)]:
        if rnd.random() < .3: r[key] = int(rnd.integers(lo, hi))
    if rnd.random() < .1: r["last4"] = int(rnd.integers(0, 10000))
    if rnd.random() < .08: r["id"] = int(rnd.integers(0, N + 3))  # includes 0 and out-of-range
    r["sort"] = ["id", "lastName", "firstName", "benefit", "birthYear", "entitlementYear", "state"][int(rnd.integers(0, 7))]
    r["desc"] = bool(rnd.integers(0, 2))
    r["offset"] = int(rnd.choice([0, 0, 0, 7, 50, 1000, 20000]))
    r["limit"] = int(rnd.choice([1, 10, 50, 100, 1000]))
    return r

# ---------------------------------------------------------------- NumPy implementation
class Oracle:
    def __init__(self, d):
        L = lambda f, t: np.fromfile(os.path.join(d, f), dtype=t)
        self.first, self.last = L("first.u16", "<u2"), L("last.u16", "<u2")
        self.last4, self.birth, self.ent = L("last4.u16", "<u2"), L("birth.u16", "<u2"), L("ent.u16", "<u2")
        self.cents = L("cents.u32", "<u4")
        self.state, self.typ, self.status = L("state.u8", "u1"), L("type.u8", "u1"), L("status.u8", "u1")
        self.n = len(self.cents)
        self.fd = [w.lower() for w in read_dict("first_dict.txt")]
        self.ld = [w.lower() for w in read_dict("last_dict.txt")]

    @staticmethod
    def cents_of(dollars):  # C++ llround(clamp(d, 0, 1e7) * 100): round half away from zero
        return int(math.floor(min(max(dollars, 0.0), 1e7) * 100 + 0.5))

    def mask(self, r):
        n = self.n
        m = np.ones(n, dtype=bool)
        if r.get("states"): m &= np.isin(self.state, [STATES.index(s) for s in r["states"]])
        if r.get("types"): m &= np.isin(self.typ, [TYPES.index(s) for s in r["types"]])
        if r.get("statuses"): m &= np.isin(self.status, [STATUSES.index(s) for s in r["statuses"]])
        if "minBenefit" in r: m &= self.cents >= self.cents_of(r["minBenefit"])
        if "maxBenefit" in r: m &= self.cents <= self.cents_of(r["maxBenefit"])
        if "minBirthYear" in r: m &= self.birth >= r["minBirthYear"]
        if "maxBirthYear" in r: m &= self.birth <= r["maxBirthYear"]
        if "minEntYear" in r: m &= self.ent >= r["minEntYear"]
        if "maxEntYear" in r: m &= self.ent <= r["maxEntYear"]
        if "last4" in r: m &= self.last4 == r["last4"]
        tokens = r.get("text", "").lower().split()[:8]
        for t in tokens:  # every token must hit first OR last name (dictionary-level lookup, then gather)
            fm = np.fromiter((t in w for w in self.fd), dtype=bool, count=len(self.fd))
            lm = np.fromiter((t in w for w in self.ld), dtype=bool, count=len(self.ld))
            m &= fm[self.first] | lm[self.last]
        if "id" in r:
            only = np.zeros(n, dtype=bool)
            if 1 <= r["id"] <= n: only[r["id"] - 1] = True
            m &= only
        return m

    def query(self, r):
        idx = np.flatnonzero(self.mask(r))
        total = len(idx)
        key = r["sort"]
        cols = {"id": (), "lastName": (self.last, self.first), "firstName": (self.first, self.last),
                "benefit": (self.cents,), "birthYear": (self.birth,), "entitlementYear": (self.ent,),
                "state": (self.state,)}[key]
        # ascending total order = (primary, secondary, row); descending is its exact reverse
        order = np.lexsort(tuple([idx] + [c[idx] for c in reversed(cols)])) if cols else np.arange(total)
        idx = idx[order]
        if r["desc"]: idx = idx[::-1]
        off, lim = r["offset"], min(r["limit"], 1000)
        return total, (idx[off:off + lim] + 1).tolist()

    def stats(self, r):
        idx = np.flatnonzero(self.mask(r))
        c = self.cents[idx].astype(np.uint64)
        return {"count": len(idx), "sumCents": int(c.sum()),
                "minCents": int(c.min()) if len(idx) else 0, "maxCents": int(c.max()) if len(idx) else 0,
                "byState": np.bincount(self.state[idx], minlength=52).tolist(),
                "byType": np.bincount(self.typ[idx], minlength=6).tolist(),
                "byStatus": np.bincount(self.status[idx], minlength=4).tolist(),
                "benefitHist": np.bincount(np.minimum(c // 50_000, 11).astype(np.int64), minlength=12).tolist()}

# ---------------------------------------------------------------- run
t0 = time.time()
# Phase 1: start the C++ CLI just to generate + export columns (no queries yet)
subprocess.run([CLI, str(N), "2026", tmp], input="", text=True, check=True)
oracle = Oracle(tmp)
fd, ld = read_dict("first_dict.txt"), read_dict("last_dict.txt")
reqs = [random_request(fd, ld) for _ in range(Q)]

lines = []
for r in reqs:
    lines.append("query " + json.dumps(r))
    lines.append("stats " + json.dumps({k: v for k, v in r.items() if k not in ("sort", "desc", "offset", "limit")}))
out = subprocess.run([CLI, str(N), "2026"], input="\n".join(lines) + "\n", text=True, capture_output=True, check=True).stdout.splitlines()

mismatch, np_ms, cpp_ms = 0, [], []
for i, r in enumerate(reqs):
    cq, cs = json.loads(out[2 * i]), json.loads(out[2 * i + 1])
    t = time.perf_counter(); total, ids = oracle.query(r); np_ms.append((time.perf_counter() - t) * 1000)
    st = oracle.stats({k: v for k, v in r.items() if k not in ("sort", "desc", "offset", "limit")})
    cpp_ms.append(cq["elapsedMs"])
    bad = []
    if "error" in cq or "error" in cs: bad.append(f"C++ error: {cq.get('error') or cs.get('error')}")
    else:
        if cq["total"] != total: bad.append(f"total C++={cq['total']} numpy={total}")
        if [x["id"] for x in cq["records"]] != ids: bad.append("page ids differ")
        for k, v in st.items():
            if cs[k] != v: bad.append(f"stats.{k} differs")
    if bad:
        mismatch += 1
        if mismatch <= 5: print("MISMATCH", json.dumps(r), bad)

nonempty = sum(1 for i in range(Q) if json.loads(out[2 * i])["total"] > 0)
print(f"{Q} random queries on {N:,} rows: {Q - mismatch} agree, {mismatch} mismatches "
      f"({nonempty} had non-empty results)  [{time.time() - t0:.0f}s total]")
print(f"per-query median: C++ {np.median(cpp_ms):.1f} ms vs NumPy {np.median(np_ms):.0f} ms (query+sort only)")
sys.exit(1 if mismatch else 0)
